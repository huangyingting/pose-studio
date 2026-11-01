import * as THREE from 'three';
import type RapierModule from '@dimforge/rapier3d-compat';
import type { Vec3 } from './types';

/*
 * Physics for props that fly free (thrown, let go, knocked loose): Rapier (WebAssembly), loaded
 * when a scene first needs it. A free stretch is simulated once at 240 Hz and kept (baked):
 * frames, scrubbing, playback, the motion check and exports all read the same flight. Until
 * Rapier has loaded, a flight falls under gravity and bounces on the floor alone.
 */

type Rapier = typeof RapierModule;

let rapier: Rapier | null = null;
let loading: Promise<void> | null = null;
const waiting = new Set<() => void>();

/** Load the physics engine (once); resolves when it is ready. */
export function loadPhysics(): Promise<void> {
  loading ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    await m.default.init();
    rapier = m.default;
    for (const f of waiting) f();
    waiting.clear();
  });
  return loading;
}

export const physicsReady = () => rapier !== null;

/** Call `f` when the physics engine is ready (now, if it is). Returns a function that cancels it. */
export function onPhysicsReady(f: () => void) {
  if (rapier) {
    f();
    return () => {};
  }
  waiting.add(f);
  return () => { waiting.delete(f); };
}

/** Steps a second. */
export const HZ = 240;
/** How long something down on the floor rolls freely before it slows to a stop (s). */
const ROLL = 4;
export const GRAVITY = 9.81;
/** How the floor gives a bounce back (a body's bounce on it is the mean of the two). */
export const FLOOR_BOUNCE = 0.5;

/** Something solid for a free prop to hit: a box (axis-aligned) or a capsule (a bone, a rim). */
export type Solid = { box: { min: Vec3; max: Vec3 } } | { capsule: { a: Vec3; b: Vec3; r: number } };

/** What flies: a ball (radius) or a box (half sizes), how it bounces and grips. */
export interface Body {
  shape: 'ball' | 'box';
  size: Vec3;
  bounce: number;
  friction: number;
}

/** How it is let go: its centre, velocity and turn at a time. */
interface Launch {
  t: number;
  position: Vec3;
  velocity: Vec3;
  rotation: [number, number, number, number];
}

/** A flight, every 1/240 s from its start: centres and turns (x, y, z, w). */
export interface Flight {
  t0: number;
  positions: Float32Array;
  rotations: Float32Array;
  /** When it came down to stay (no more bounces), if it did. */
  down?: number;
}

/** Where a flight has it at time t (held at its last step after it). */
export function flightAt(f: Flight, t: number): { position: THREE.Vector3; rotation: THREE.Quaternion } {
  const n = f.positions.length / 3;
  const x = Math.min(n - 1, Math.max(0, (t - f.t0) * HZ));
  const i = Math.min(n - 2, Math.floor(x));
  if (n < 2) return { position: new THREE.Vector3().fromArray(f.positions, 0), rotation: new THREE.Quaternion().fromArray(f.rotations, 0) };
  const u = x - i;
  const p = new THREE.Vector3().fromArray(f.positions, i * 3).lerp(new THREE.Vector3().fromArray(f.positions, (i + 1) * 3), u);
  const q = new THREE.Quaternion().fromArray(f.rotations, i * 4).slerp(new THREE.Quaternion().fromArray(f.rotations, (i + 1) * 4), u);
  return { position: p, rotation: q };
}

/**
 * Fly a body from its launch until `until` (or until it lies still), hitting the floor, the
 * solids and the movers (people, whose bones move: given for any time).
 */
export function fly(body: Body, launch: Launch, until: number, solids: Solid[], movers?: (t: number) => Solid[]): Flight {
  const steps = Math.max(1, Math.min(HZ * 30, Math.ceil((until - launch.t) * HZ)));
  return rapier ? simulate(rapier, body, launch, steps, solids, movers) : fall(body, launch, steps);
}

const UP = new THREE.Vector3(0, 1, 0);

function simulate(R: Rapier, body: Body, launch: Launch, steps: number, solids: Solid[], movers?: (t: number) => Solid[]): Flight {
  const world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = 1 / HZ;
  try {
    // The floor, and what stands in the scene.
    world.createCollider(R.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, -1, 0).setRestitution(FLOOR_BOUNCE).setFriction(0.6));
    const capsule = (desc: RapierModule.RigidBodyDesc | null, a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const len = a.distanceTo(b);
      const q = len > 1e-6 ? new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()) : new THREE.Quaternion();
      const c = R.ColliderDesc.capsule(len / 2, r).setRestitution(0.6).setFriction(0.5);
      if (!desc) world.createCollider(c.setTranslation(mid.x, mid.y, mid.z).setRotation(q));
      else {
        const rb = world.createRigidBody(desc.setTranslation(mid.x, mid.y, mid.z).setRotation(q));
        world.createCollider(c, rb);
        return rb;
      }
      return null;
    };
    for (const s of solids) {
      if ('box' in s) {
        const [min, max] = [new THREE.Vector3(...s.box.min), new THREE.Vector3(...s.box.max)];
        const half = max.clone().sub(min).multiplyScalar(0.5);
        const mid = min.clone().add(half);
        world.createCollider(R.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(mid.x, mid.y, mid.z).setRestitution(0.6).setFriction(0.6));
      } else capsule(null, new THREE.Vector3(...s.capsule.a), new THREE.Vector3(...s.capsule.b), s.capsule.r);
    }
    // People: bones that move (placed again every frame of the scene, 24 a second).
    const people = movers ? movers(launch.t).map((s) => ('capsule' in s ? capsule(R.RigidBodyDesc.kinematicPositionBased(), new THREE.Vector3(...s.capsule.a), new THREE.Vector3(...s.capsule.b), s.capsule.r) : null)) : [];
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(...launch.position)
      .setLinvel(...launch.velocity)
      .setRotation({ x: launch.rotation[0], y: launch.rotation[1], z: launch.rotation[2], w: launch.rotation[3] })
      .setCcdEnabled(true)
      .setAngularDamping(1.5);
    const rb = world.createRigidBody(desc);
    const shape = body.shape === 'ball' ? R.ColliderDesc.ball(body.size[0]) : R.ColliderDesc.cuboid(...body.size);
    world.createCollider(shape.setRestitution(body.bounce).setFriction(body.friction).setDensity(300), rb);

    const positions = new Float32Array((steps + 1) * 3);
    const rotations = new Float32Array((steps + 1) * 4);
    const put = (i: number) => {
      const p = rb.translation();
      const q = rb.rotation();
      positions.set([p.x, p.y, p.z], i * 3);
      rotations.set([q.x, q.y, q.z, q.w], i * 4);
    };
    put(0);
    let before = Math.hypot(...launch.velocity);
    let still = 0;
    let level = 0;
    let down: number | undefined;
    let last = steps;
    const frame = Math.round(HZ / 24);
    for (let i = 1; i <= steps; i++) {
      if (movers && i % frame === 1) {
        const now = movers(launch.t + (i - 1 + frame) / HZ);
        now.forEach((s, k) => {
          const b = people[k];
          if (!b || !('capsule' in s)) return;
          const [a, c] = [new THREE.Vector3(...s.capsule.a), new THREE.Vector3(...s.capsule.b)];
          const mid = a.clone().add(c).multiplyScalar(0.5);
          b.setNextKinematicTranslation({ x: mid.x, y: mid.y, z: mid.z });
          if (a.distanceTo(c) > 1e-6) b.setNextKinematicRotation(new THREE.Quaternion().setFromUnitVectors(UP, c.clone().sub(a).normalize()));
        });
      }
      world.step();
      // (A bone moved a long way in a frame (someone set somewhere else) does not send it flying:
      // someone walking into it knocks it on at a walking pace, 5 m/s at most, faster only if it
      // was going faster already.)
      const fast = rb.linvel();
      const speed = Math.hypot(fast.x, fast.y, fast.z);
      const cap = Math.max(5, before + GRAVITY / HZ * 1.5);
      if (speed > cap) rb.setLinvel({ x: (fast.x * cap) / speed, y: (fast.y * cap) / speed, z: (fast.z * cap) / speed }, true);
      put(i);
      const v = rb.linvel();
      before = Math.hypot(v.x, v.y, v.z);
      // Down to stay: barely moving up or down for a moment (it may roll on).
      level = Math.abs(v.y) < 0.05 ? level + 1 : 0;
      if (down === undefined && level > HZ / 4) down = launch.t + (i - level) / HZ;
      // (Rolling on the floor a while: it slows to a stop, as on a court's grip, not on and on.)
      if (down !== undefined && launch.t + i / HZ - down > ROLL && rb.linearDamping() < 1) rb.setLinearDamping(1.5);
      // Lying still for a moment: the rest of the stretch it stays there.
      still = Math.hypot(v.x, v.y, v.z) < 0.02 ? still + 1 : 0;
      if (still > HZ / 4) {
        last = i;
        break;
      }
    }
    return { t0: launch.t, positions: positions.slice(0, (last + 1) * 3), rotations: rotations.slice(0, (last + 1) * 4), ...(down !== undefined ? { down } : {}) };
  } finally {
    world.free();
  }
}

/** Without the engine: under gravity, bouncing on the floor (its lowest point there), turning as it was. */
function fall(body: Body, launch: Launch, steps: number): Flight {
  const low = body.shape === 'ball' ? body.size[0] : body.size[1];
  const positions = new Float32Array((steps + 1) * 3);
  const rotations = new Float32Array((steps + 1) * 4);
  const p = [...launch.position];
  const v = [...launch.velocity];
  const dt = 1 / HZ;
  for (let i = 0; i <= steps; i++) {
    positions.set(p, i * 3);
    rotations.set(launch.rotation, i * 4);
    v[1] -= GRAVITY * dt;
    for (let c = 0; c < 3; c++) p[c] += v[c] * dt;
    if (p[1] < low) {
      p[1] = low;
      const e = (body.bounce + FLOOR_BOUNCE) / 2;
      v[1] = Math.abs(v[1]) * e < 0.3 ? 0 : -v[1] * e;
      v[0] *= 0.8;
      v[2] *= 0.8;
    }
  }
  return { t0: launch.t, positions, rotations };
}

/**
 * The velocity that takes a body from `from` to `to` in `time` seconds, under gravity (no drag),
 * stepped as the simulation steps it (so it gets there on the dot).
 */
export function aim(from: Vec3, to: Vec3, time: number): Vec3 {
  const n = Math.max(1, Math.round(time * HZ));
  const dt = 1 / HZ;
  // Each step the velocity drops by g·dt before it moves the body: n steps fall g·dt²·n(n+1)/2.
  return [(to[0] - from[0]) / (n * dt), (to[1] - from[1] + (GRAVITY * dt * dt * n * (n + 1)) / 2) / (n * dt), (to[2] - from[2]) / (n * dt)];
}

/**
 * The velocity that bounces a ball once on the floor (its centre `low` above it) from `from` into
 * `to` after `time` seconds: a dribble.
 */
export function aimBounce(from: Vec3, to: Vec3, time: number, low: number, bounce: number): Vec3 {
  // Down at speed v, up again with `bounce` of the speed it hits the floor with: find v by halving.
  const arrive = (v: number) => {
    const h = from[1] - low;
    // Down: h = v t + g t² / 2.
    const t1 = (-v + Math.sqrt(v * v + 2 * GRAVITY * h)) / GRAVITY;
    const up = (v + GRAVITY * t1) * bounce;
    const t2 = time - t1;
    return t2 < 0 ? -1 : low + up * t2 - (GRAVITY * t2 * t2) / 2;
  };
  let [lo, hi] = [0, 30];
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (arrive(mid) < to[1]) lo = mid;
    else hi = mid;
  }
  const T = Math.max(1e-3, time);
  return [(to[0] - from[0]) / T, -(lo + hi) / 2, (to[2] - from[2]) / T];
}
