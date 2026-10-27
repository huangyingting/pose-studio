import * as THREE from 'three';
import { GRAVITY } from './locomotion';
import { RIBBON, RIM } from './props';
import { Rig } from './relations';
import { groundOf } from './surfaces';
import type { Animation, Figure, Prop, PropKey, Scene, Side, Vec3 } from './types';

/*
 * Props over time. A prop with keys moves between them: it glides, rides in a hand (its place
 * relative to the hand), flies when thrown (under gravity, from the releasing hand to a floor
 * point or into another hand) or falls when let go. Hands are found where the figures have them
 * at that moment, so a throw still leaves the hand after the arm is re-animated.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

let rig: Rig | null = null;

/** A pose as a matrix. */
const compose = (position: Vec3, rotation: Vec3) => new THREE.Matrix4().compose(
  new THREE.Vector3(...position),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0] * D2R, rotation[1] * D2R, rotation[2] * D2R, 'XYZ')),
  new THREE.Vector3(1, 1, 1),
);

/** A matrix as a place and turn (degrees, XYZ). */
function decompose(m: THREE.Matrix4): { position: Vec3; rotation: Vec3 } {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  m.decompose(p, q, new THREE.Vector3());
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const r1 = (v: number) => Math.round(v * R2D * 10) / 10;
  return { position: [r3(p.x), r3(p.y), r3(p.z)], rotation: [r1(e.x), r1(e.y), r1(e.z)] };
}

/** The keys of one prop, in time order. */
export function propTrack(a: Animation, id: string) {
  return a.keys.filter((k) => k.props?.[id]).map((k) => ({ t: k.t, key: k.props![id] }));
}

export function propKeyTimes(a: Animation, id: string) {
  return propTrack(a, id).map((k) => k.t);
}

/**
 * Where every prop is at time t. `figureAt` gives a figure's pose at a time (for the hands).
 */
export function propsAt(scene: Scene, t: number, figureAt: (id: string, t: number) => Figure | null): Prop[] {
  const a = scene.animation;
  if (!a || !a.keys.some((k) => k.props && Object.keys(k.props).length)) return scene.props;
  rig ??= new Rig();
  rig.ground = groundOf(scene.props);
  const wrists = new Map<string, THREE.Matrix4 | null>();
  /** The world matrix of a figure's wrist at time `at`. */
  const wrist = (figure: string, hand: Side, at: number) => {
    const key = `${figure}:${hand}:${at}`;
    if (!wrists.has(key)) {
      const f = figureAt(figure, at);
      if (!f) wrists.set(key, null);
      else {
        const j = rig!.model(f).joints[hand === 'L' ? 'leftHand' : 'rightHand'];
        j.updateWorldMatrix(true, false);
        wrists.set(key, j.matrixWorld.clone());
      }
    }
    return wrists.get(key)!;
  };
  return scene.props.map((p) => {
    const track = propTrack(a, p.id);
    if (!track.length) return p;
    const ground = groundOf(scene.props, p.id);
    const held = (k: PropKey) => !!k.hold && scene.figures.some((f) => f.id === k.hold!.figure);
    /** A key's world place: in the hand at that time if held, or where the hand let go. */
    const world = (i: number): { position: Vec3; rotation: Vec3 } => {
      const { t: at, key } = track[i];
      const hand = held(key) ? key.hold! : key.release && i > 0 && held(track[i - 1].key) ? track[i - 1].key.hold! : null;
      const local = held(key) ? key : key.release && i > 0 ? track[i - 1].key : key;
      if (hand) {
        const m = wrist(hand.figure, hand.hand, at);
        if (m) return decompose(m.clone().multiply(compose(local.position, local.rotation)));
      }
      return { position: key.position, rotation: key.rotation };
    };
    const asProp = (w: { position: Vec3; rotation: Vec3 }, hold?: PropKey['hold']): Prop => {
      const { hold: _, ...free } = p;
      void _;
      return hold ? { ...free, position: w.position, rotation: w.rotation, hold } : { ...free, position: w.position, rotation: w.rotation };
    };

    // Before the first key: as at the first key.
    if (t <= track[0].t) return held(track[0].key) ? asProp(track[0].key, track[0].key.hold) : asProp(world(0));
    let i = track.length - 1;
    while (i > 0 && track[i].t > t) i--;
    const a0 = track[i];
    // After the last key: held, at rest, or falling from where it was let go.
    if (i === track.length - 1) {
      if (held(a0.key)) return asProp(a0.key, a0.key.hold);
      const w = world(i);
      if (!a0.key.release) return asProp(w);
      const fall = t - a0.t;
      const floor = ground(w.position[0], w.position[2]);
      return asProp({ position: [w.position[0], Math.max(floor, w.position[1] - (GRAVITY * fall * fall) / 2), w.position[2]], rotation: w.rotation });
    }
    const b0 = track[i + 1];
    const u = (t - a0.t) / (b0.t - a0.t);
    // In a hand: it rides along (easing to the next place in the same hand).
    if (held(a0.key) && !b0.key.release) {
      const same = held(b0.key) && b0.key.hold!.figure === a0.key.hold!.figure && b0.key.hold!.hand === a0.key.hold!.hand;
      return asProp(same ? lerpPlace(a0.key, b0.key, smooth(u)) : a0.key, a0.key.hold);
    }
    if (held(a0.key)) return asProp(a0.key, a0.key.hold);
    const wa = world(i);
    const wb = world(i + 1);
    if (b0.key.throw) {
      // In flight: straight across, and up and down under gravity.
      const T = b0.t - a0.t;
      const p0 = lerpPlace(wa, wb, u);
      p0.position[1] += (GRAVITY * T * T * u * (1 - u)) / 2;
      return asProp(p0);
    }
    return asProp(lerpPlace(wa, wb, smooth(u)));
  });
}

const smooth = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

function lerpPlace(a: { position: Vec3; rotation: Vec3 }, b: { position: Vec3; rotation: Vec3 }, u: number) {
  const angle = (x: number, y: number) => x + ((((y - x) % 360) + 540) % 360 - 180) * u;
  return {
    position: a.position.map((v, i) => v + (b.position[i] - v) * u) as Vec3,
    rotation: a.rotation.map((v, i) => angle(v, b.rotation[i])) as Vec3,
  };
}

/** How long a throw from `from` to `to` takes, rising a little over the higher end, or by `rise` metres (s). */
export function throwTime(from: Vec3, to: Vec3, rise?: number) {
  const d = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const top = Math.max(from[1], to[1]) + (rise ?? 0.25 + 0.12 * d);
  return Math.sqrt((2 * (top - from[1])) / GRAVITY) + Math.sqrt((2 * (top - to[1])) / GRAVITY);
}

/** Where a ribbon's tip was at moments of a scene (as played). */
const tips = new WeakMap<Scene, Map<string, THREE.Vector3 | null>>();

/**
 * A ribbon's line through the air at time t: along where the stick's tip has just been (each
 * moment of the last second dropped by how long the ribbon has been falling since), at a fixed
 * length; what that path does not cover hangs straight down, and what reaches the floor lies on it.
 */
export function ribbonTrail(scene: Scene, id: string, t: number, figureAt: (fid: string, at: number) => Figure | null): Vec3[] | null {
  const prop = scene.props.find((p) => p.id === id);
  if (!prop || prop.kind !== 'ribbon') return null;
  const scale = new THREE.Vector3(...prop.scale);
  // Held all along (no keys of its own): straight from the hand, the quick way.
  const steady = prop.hold && !(scene.animation && propTrack(scene.animation, id).length) ? prop.hold : null;
  const local = compose(prop.position, prop.rotation).scale(scale);
  rig ??= new Rig();
  const seen = tips.get(scene) ?? new Map<string, THREE.Vector3 | null>();
  tips.set(scene, seen);
  const tip = (at: number) => {
    const key = `${id}:${at}`;
    if (!seen.has(key)) seen.set(key, tipAt(at));
    return seen.get(key)?.clone() ?? null;
  };
  const tipAt = (at: number) => {
    if (steady) {
      const f = figureAt(steady.figure, Math.max(0, at));
      if (!f) return null;
      const j = rig!.model(f).joints[steady.hand === 'L' ? 'leftHand' : 'rightHand'];
      j.updateWorldMatrix(true, false);
      return new THREE.Vector3(0, RIBBON.stick, 0).applyMatrix4(j.matrixWorld.clone().multiply(local));
    }
    const w = worldOfProp(scene, id, figureAt, Math.max(0, at));
    return w && new THREE.Vector3(0, RIBBON.stick, 0).applyMatrix4(compose(w.position, w.rotation).scale(scale));
  };
  const start = tip(t);
  if (!start) return null;
  // Moments on a fixed grid (so playing on, frame after frame, they are worked out once).
  const DT = 1 / 16;
  const grid = Math.floor(t / DT) * DT;
  const path = [start];
  for (let k = 0; k < 16 && grid - k * DT >= 0; k++) path.push(tip(grid - k * DT)!.add(new THREE.Vector3(0, -0.25 * GRAVITY * (t - grid + k * DT) ** 2, 0)));
  const ground = groundOf(scene.props, id);
  const seg = RIBBON.length / RIBBON.segments;
  const pts = [start];
  // Walk the path a segment at a time.
  let i = 0;
  let at = start.clone();
  let way = new THREE.Vector3(1, 0, 0);
  for (let n = 1; n <= RIBBON.segments; n++) {
    let left = seg;
    while (i < path.length - 1 && left > 1e-6) {
      const to = path[i + 1];
      const d = at.distanceTo(to);
      if (d <= left) { left -= d; if (d > 1e-6) way = to.clone().sub(at).normalize(); at = to.clone(); i++; }
      else { way = to.clone().sub(at).normalize(); at.addScaledVector(way, left); left = 0; }
    }
    // Past the path: straight down, then along the floor the way it was going.
    if (left > 1e-6) at.y -= left;
    const floor = ground(at.x, at.z) + 0.004;
    if (at.y < floor) {
      const flat = new THREE.Vector3(way.x, 0, way.z);
      if (flat.lengthSq() < 1e-8) flat.set(1, 0, 0);
      const prev = pts[pts.length - 1];
      const drop = Math.max(0, prev.y - floor);
      at = new THREE.Vector3(prev.x, floor, prev.z).addScaledVector(flat.normalize(), Math.sqrt(Math.max(0, seg * seg - drop * drop)));
      i = path.length;
    }
    pts.push(at.clone());
  }
  if (seen.size > 2000) seen.clear();
  return pts.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000, Math.round(p.z * 1000) / 1000]);
}

/** Where a basketball hoop's rim centre is, in the world. */
export function rimOf(hoop: Prop): Vec3 {
  const m = compose(hoop.position, hoop.rotation).scale(new THREE.Vector3(...hoop.scale));
  const p = new THREE.Vector3(...RIM.at).applyMatrix4(m);
  return [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000, Math.round(p.z * 1000) / 1000];
}

/** Where a figure's hand (wrist) is, in the world (standing on the tops of `props`, if given). */
export function handPosition(f: Figure, hand: Side, props?: Prop[]): Vec3 {
  rig ??= new Rig();
  rig.ground = props ? groundOf(props) : null;
  const p = rig.model(f).joints[hand === 'L' ? 'leftHand' : 'rightHand'].getWorldPosition(new THREE.Vector3());
  return [p.x, p.y, p.z];
}

/** A prop's world place at time t in a scene (for throwing and letting go). */
export function worldOfProp(scene: Scene, id: string, figureAt: (fid: string, at: number) => Figure | null, t: number) {
  const p = propsAt(scene, t, figureAt).find((x) => x.id === id);
  if (!p) return null;
  if (!p.hold) return { position: p.position, rotation: p.rotation };
  rig ??= new Rig();
  rig.ground = groundOf(scene.props);
  const f = figureAt(p.hold.figure, t);
  if (!f) return { position: p.position, rotation: p.rotation };
  const j = rig.model(f).joints[p.hold.hand === 'L' ? 'leftHand' : 'rightHand'];
  j.updateWorldMatrix(true, false);
  return decompose(j.matrixWorld.clone().multiply(compose(p.position, p.rotation)));
}
