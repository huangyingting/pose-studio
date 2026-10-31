import * as THREE from 'three';
import { MAX_DURATION, propKeyOf } from './animation';
import { playedClip } from './assets';
import { grip } from './hold';
import { Ink } from './ink';
import { FLOOR_BOUNCE, GRAVITY, aim, aimBounce, flightAt, fly, type Body, type Flight, type Solid } from './physics';
import { facingOf } from './pose';
import { PropObject, RIBBON, RIM, handlesOf, localBounds } from './props';
import { Rig, capsules } from './relations';
import { groundOf } from './surfaces';
import type { Action, Animation, Figure, Prop, PropKey, Scene, Side, Vec3 } from './types';

/*
 * Props over time. A prop is held in a hand (it follows the hand), flies free (simulated, lib/
 * physics.ts) or rests (where it was put, or moved by hand on its own track). What happens to it
 * comes from its own keys (put in a hand, let go, moved) and from the actions handling it: the
 * releases and grabs of their clips (a throw, a shot, a dribble), each release sent where its
 * action says. Hands are found where the figures have them at that moment, so a throw still
 * leaves the hand after the arm is re-animated.
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
export function propTrack(a: Animation, id: string): PropKey[] {
  return a.props?.[id] ?? [];
}

export function propKeyTimes(a: Animation, id: string) {
  return propTrack(a, id).map((k) => k.t);
}

const onFrame = (a: Animation, t: number) => Math.round(t * a.fps) / a.fps;
const withTrack = (a: Animation, id: string, keys: PropKey[]): Animation => {
  const { [id]: _, ...rest } = a.props ?? {};
  void _;
  const props = keys.length ? { ...rest, [id]: [...keys].sort((p, q) => p.t - q.t) } : rest;
  if (Object.keys(props).length) return { ...a, props };
  const { props: _old, ...out } = a;
  void _old;
  return out;
};

/** One prop's key at a time (on a frame), replacing one there. */
export function putPropKey(a: Animation, t: number, id: string, key: Omit<PropKey, 't'>): Animation {
  const time = onFrame(a, t);
  return withTrack(a, id, [...propTrack(a, id).filter((k) => Math.abs(k.t - time) >= 0.5 / a.fps), { ...key, t: time }]);
}

/**
 * Key a prop at time t with its current place; an existing key keeps whether it was let go or
 * thrown there. The first key of a prop also keys where it was before (`was`) at the start, so it
 * moves from there.
 */
export function setPropKey(a: Animation, t: number, prop: Prop, extra: Partial<PropKey> = {}, was?: Prop): Animation {
  const time = Math.min(a.duration, Math.max(0, onFrame(a, t)));
  let out = a;
  if (was && !propTrack(a, prop.id).length && time > 0) out = putPropKey(out, 0, prop.id, propKeyOf(was, 0));
  const old = propTrack(out, prop.id).find((k) => Math.abs(k.t - time) < 0.5 / a.fps);
  return putPropKey(out, time, prop.id, { ...propKeyOf(prop, time), ...(old?.release ? { release: true } : {}), ...extra });
}

/** Remove one prop's key at time t. */
export function removePropKey(a: Animation, t: number, id: string): Animation {
  return withTrack(a, id, propTrack(a, id).filter((k) => Math.abs(k.t - t) >= 0.5 / a.fps));
}

/** Move one prop's keys after `after` later by `by` seconds. */
export function shiftPropTrack(a: Animation, id: string, after: number, by: number): Animation {
  const keys = propTrack(a, id).map((k) => (k.t <= after + 1e-6 ? k : { ...k, t: Math.min(MAX_DURATION, onFrame(a, k.t + by)) }));
  return { ...withTrack(a, id, keys), duration: Math.min(MAX_DURATION, Math.max(a.duration, ...keys.map((k) => k.t))) };
}

/** Only the keys of these props, and only these handled by actions (after props are deleted). */
export function keepProps(a: Animation, ids: Set<string>): Animation {
  const gone = (x: Animation['actions'][number]) => (x.prop && !ids.has(x.prop)) || (x.target && 'hoop' in x.target && !ids.has(x.target.hoop));
  let out = a;
  if (a.actions.some(gone)) {
    out = { ...out, actions: a.actions.map((x) => {
      if (!gone(x)) return x;
      const { prop: _p, target: _t, ...rest } = x;
      void _p; void _t;
      return rest;
    }) };
  }
  if (Object.keys(out.props ?? {}).every((id) => ids.has(id))) return out;
  return Object.keys(out.props ?? {}).reduce((b, id) => (ids.has(id) ? b : withTrack(b, id, [])), out);
}

/** A figure's pose at a time (the hands, for what they hold; the bodies, for what flies into them). */
export type FigureAt = (id: string, t: number) => Figure | null;

/** The longest a prop flies free before it is left where it is (s). */
const FLIGHT = 6;
/** How long past when it is to be taken hold of again a flight is worked out (s): to be caught a moment late. */
const TAKEN_BY = 0.5;

/** A hand catches what comes within this of its palm (m). */
const CATCH_REACH = 0.35;

/** One stretch of a prop's time, from `t` on: in a hand, flying free, or resting somewhere. */
type Stretch =
  | { t: number; kind: 'held'; figure: string; hand: Side; local: { position: Vec3; rotation: Vec3 } }
  | { t: number; kind: 'free'; flight: Flight; whole?: () => Flight }
  | { t: number; kind: 'rest'; position: Vec3; rotation: Vec3; glide: boolean };

/** Something that happens to a prop: a key on its own track, or a hand of an action letting go or taking hold. */
type ByHand = { t: number; kind: 'release' | 'grab'; figure: string; hand: Side; act: Action };
type Happening = { t: number; kind: 'key'; key: PropKey } | ByHand;

/** A catch: who, with which hand, when, and how far the hand has to go to meet the prop then. */
export interface Catch { t: number; figure: string; hand: Side; reach: Vec3 }

/** How a prop of a kind bounces and grips, unless set for it. */
export const defaultPhysics = (kind: Prop['kind']) => (kind === 'sphere' ? { bounce: 0.7, friction: 0.15 } : { bounce: 0.3, friction: 0.6 });

/** How a prop bounces and grips when it flies free (0–1). */
export const physicsOf = (p: Prop) => p.physics ?? defaultPhysics(p.kind);

/** What a prop is, to fly: its body, and where its centre is in its own frame. */
function bodyOf(p: Prop): { body: Body; centre: THREE.Vector3 } {
  const { bounce, friction } = physicsOf(p);
  if (p.kind === 'sphere') {
    const r = p.scale[0] / 2;
    return { body: { shape: 'ball', size: [r, r, r], bounce, friction }, centre: new THREE.Vector3(0, r, 0) };
  }
  const box = localBounds(p.kind).clone();
  box.min.multiply(new THREE.Vector3(...p.scale));
  box.max.multiply(new THREE.Vector3(...p.scale));
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.01, 0.01, 0.01));
  return { body: { shape: 'box', size: [half.x, half.y, half.z], bounce, friction }, centre: box.getCenter(new THREE.Vector3()) };
}

let ink: Ink | null = null;

/** What stands in the scene, for a free prop to hit: the props (a hoop's rim as a ring of capsules) but this one and the held ones. */
function solidsOf(scene: Scene, except: string): Solid[] {
  const out: Solid[] = [];
  ink ??= new Ink();
  for (const p of scene.props) {
    if (p.id === except || p.hold) continue;
    const o = new PropObject(ink, p.kind, p.id);
    o.apply(p);
    o.liftAboveFloor();
    o.object.updateMatrixWorld(true);
    for (const m of o.solids) {
      // The rim: a ring of short capsules the ball can hit and drop through.
      if (p.kind === 'hoop' && (m.geometry as THREE.BufferGeometry).type === 'TorusGeometry') continue;
      const b = new THREE.Box3().setFromObject(m);
      out.push({ box: { min: b.min.toArray() as Vec3, max: b.max.toArray() as Vec3 } });
    }
    if (p.kind === 'hoop') {
      const centre = new THREE.Vector3(...rimOf(p));
      const r = RIM.radius * p.scale[0];
      for (let k = 0; k < 16; k++) {
        const a0 = (k / 16) * Math.PI * 2;
        const a1 = ((k + 1) / 16) * Math.PI * 2;
        out.push({ capsule: { a: [centre.x + r * Math.cos(a0), centre.y, centre.z + r * Math.sin(a0)], b: [centre.x + r * Math.cos(a1), centre.y, centre.z + r * Math.sin(a1)], r: 0.012 } });
      }
    }
    o.dispose();
  }
  return out;
}

/**
 * The people's bodies for a free prop to hit (not their hands and forearms, which reach for it),
 * always the same list; `clear`'s are put out of the way (far under the floor).
 */
function bodiesAt(scene: Scene, freeAt: FigureAt, t: number, clear: string[] = [], only?: Set<string>): Solid[] {
  rig ??= new Rig();
  return scene.figures.filter((f) => !f.hidden && !f.proxy && (!only || only.has(f.id))).flatMap((f) => {
    const now = freeAt(f.id, t) ?? f;
    const away = clear.includes(f.id) ? -100 : 0;
    return capsules(rig!, now).filter((c) => !c.bone.endsWith('LowerArm')).map((c) => ({ capsule: { a: [c.p.x, c.p.y + away, c.p.z] as Vec3, b: [c.q.x, c.q.y + away, c.q.z] as Vec3, r: c.r } }));
  });
}

/** The world matrix of a figure's wrist at a time. */
function wristAt(figureAt: FigureAt, figure: string, hand: Side, t: number): THREE.Matrix4 | null {
  const f = figureAt(figure, t);
  if (!f) return null;
  rig ??= new Rig();
  const j = rig.model(f).joints[hand === 'L' ? 'leftHand' : 'rightHand'];
  j.updateWorldMatrix(true, false);
  return j.matrixWorld.clone();
}

/** What happens to a prop, in time order: its keys, and the releases and grabs of the actions handling it. */
function happenings(a: Animation, id: string): Happening[] {
  const out: Happening[] = (a.props?.[id] ?? []).map((key) => ({ t: key.t, kind: 'key', key }));
  for (const act of a.actions) {
    if (act.prop !== id || act.source.kind !== 'clip') continue;
    const clip = playedClip(act.source);
    if (!clip) continue;
    const speed = act.source.speed ?? 1;
    const laps = clip.loop && clip.duration > 1e-6 ? Math.max(1, Math.round((act.duration * speed) / clip.duration)) : (act.source.repeat ?? 1);
    for (let lap = 0; lap < laps; lap++) {
      for (const e of clip.events) {
        const t = act.start + ((act.source as { lead?: number }).lead ?? 0) + (e.t + lap * clip.duration) / speed;
        const figure = act.roles[e.part]?.figure;
        if (!figure || t > act.start + act.duration + 1e-6) continue;
        // (Every other repeat mirrored, if so: its hand the other one, #23.)
        const mirrored = !!act.source.mirror !== (!!act.source.alternate && lap % 2 === 1);
        const hand: Side = mirrored ? (e.hand === 'L' ? 'R' : 'L') : e.hand;
        out.push({ t, kind: e.kind, figure, hand, act });
      }
    }
  }
  return out.sort((p, q) => p.t - q.t || (p.kind === 'key' ? -1 : 0));
}

/**
 * A prop's time, stretch by stretch: held, flying (simulated, lib/physics.ts) or resting, as its
 * keys and the actions handling it have it. Releases are aimed where their action sends the prop
 * (a pass at where the catcher's hand will be when it gets there); a hand takes hold of a free
 * prop when it is within reach then (otherwise it flies on, and the check says so).
 */
export class PropTimeline {
  readonly stretches: Stretch[] = [];
  readonly catches: Catch[] = [];
  readonly misses: { t: number; figure: string }[] = [];
  /** Each release, and when it gets where it was sent. */
  readonly arrivals: { release: number; arrive: number }[] = [];

  /** `figureAt`: the figures as they are (for what is held); `freeAt`: before anyone reaches for anything (for aiming and catching). */
  constructor(private scene: Scene, private prop: Prop, private figureAt: FigureAt, private freeAt: FigureAt) {
    const a = scene.animation!;
    const shape = bodyOf(prop);
    const end = a.duration;
    const events = happenings(a, prop.id);
    // How it starts: as its first key has it, or as the scene does.
    const first = events.find((e) => e.kind === 'key' && e.t <= 1e-6) as Extract<Happening, { kind: 'key' }> | undefined;
    const start = first?.key ?? prop;
    this.stretches.push(start.hold
      ? { t: 0, kind: 'held', figure: start.hold.figure, hand: start.hold.hand, local: { position: start.position, rotation: start.rotation } }
      : { t: 0, kind: 'rest', position: start.position, rotation: start.rotation, glide: false });
    const pending: { t: number; figure: string; hand: Side }[] = [];
    const queue = [...events];
    while (queue.length || pending.length) {
      const next = pending.length && (!queue.length || pending[0].t <= queue[0].t) ? { ...pending.shift()!, kind: 'catch' as const } : queue.shift()!;
      const now = this.stretches[this.stretches.length - 1];
      if (next.kind === 'key') {
        const k = next.key;
        if (k.hold) {
          // Taken from someone else's hand (a handoff), or out of the air (an intercept): only if
          // the hand can reach it then; it reaches out for it.
          const other = (now.kind === 'held' && (now.figure !== k.hold.figure || now.hand !== k.hold.hand)) || now.kind === 'free';
          if (other && k.t > 1e-6) {
            const at = this.placeAt(k.t, now, this.freeAt);
            const palm = this.palmAt(k.hold.figure, k.hold.hand, k.t);
            if (!at || !palm || palm.distanceTo(at.centre) > CATCH_REACH) {
              this.misses.push({ t: k.t, figure: k.hold.figure });
              if (now.kind === 'free') this.flyOn(now);
              continue;
            }
            this.catches.push({ t: k.t, figure: k.hold.figure, hand: k.hold.hand, reach: at.centre.clone().sub(palm).toArray() as Vec3 });
          }
          this.stretches.push({ t: k.t, kind: 'held', figure: k.hold.figure, hand: k.hold.hand, local: { position: k.position, rotation: k.rotation } });
        }
        else if (k.release) this.stretches.push({ t: k.t, kind: 'free', flight: this.flight(shape, k.t, [0, 0, 0], Math.max(end, k.t + FLIGHT)) });
        else if (k.t > 1e-6 || !first) this.stretches.push({ t: k.t, kind: 'rest', position: k.position, rotation: k.rotation, glide: now.kind === 'rest' });
        continue;
      }
      if (next.kind === 'release') {
        // Only what the hand holds is let go.
        if (now.kind !== 'held' || now.figure !== next.figure || now.hand !== next.hand) continue;
        const aim = this.aim(shape, next, queue);
        this.arrivals.push({ release: next.t, arrive: aim.arrive });
        // Not stopped by the thrower's own body as it leaves, nor the catcher's as it comes in.
        // (A dribble comes back to the one dribbling: their body does not stop it either.)
        const back = next.act.target && 'bounce' in next.act.target ? next.figure : undefined;
        // (Flown only a little past where it is to be taken hold of again, as it nearly always is;
        // all the way if it is not: see `whole`.)
        const fly = (until: number) => this.flight(shape, next.t, aim.velocity, until, next.figure, aim.catch?.figure ?? back);
        // (Due back in a hand: caught, dribbled back, or picked up by whoever takes it next.)
        const taken = queue.find((q) => q.kind === 'grab' || (q.kind === 'key' && !!q.key.hold))?.t;
        const due = aim.catch?.t ?? (back ? aim.arrive : taken);
        this.stretches.push(due !== undefined
          ? { t: next.t, kind: 'free', flight: fly(Math.min(Math.max(end, next.t + FLIGHT), due + TAKEN_BY)), whole: () => fly(Math.max(end, next.t + FLIGHT)) }
          : { t: next.t, kind: 'free', flight: fly(Math.max(end, next.t + FLIGHT)) });
        if (aim.catch) {
          pending.push(aim.catch);
          pending.sort((p, q) => p.t - q.t);
        }
        continue;
      }
      // A grab, or a catch: the hand takes hold of it if it is free and within reach.
      if (now.kind === 'held' && now.figure === next.figure && now.hand === next.hand) continue;
      // A pass someone else has taken out of the air (intercepted) is not caught.
      if (next.kind === 'catch' && now.kind !== 'free') continue;
      const at = this.placeAt(next.t, now, this.freeAt);
      const palm = this.palmAt(next.figure, next.hand, next.t);
      const catcher = this.scene.figures.find((f) => f.id === next.figure);
      if (!at || !palm || !catcher) continue;
      const g = grip(prop, next.hand, catcher.body);
      if (now.kind === 'free' && palm.distanceTo(at.centre) > CATCH_REACH) {
        this.misses.push({ t: next.t, figure: next.figure });
        this.flyOn(now);
        continue;
      }
      if (next.kind === 'catch') this.catches.push({ t: next.t, figure: next.figure, hand: next.hand, reach: at.centre.clone().sub(palm).toArray() as Vec3 });
      this.stretches.push({ t: next.t, kind: 'held', figure: next.figure, hand: next.hand, local: { position: g.position, rotation: g.rotation } });
    }
  }

  /** Not taken hold of where it was to be: flown on all the way. */
  private flyOn(now: Stretch) {
    if (now.kind !== 'free' || !now.whole) return;
    now.flight = now.whole();
    delete now.whole;
  }

  /** Let go at t with a velocity: its flight from where the hand has it then (through the thrower's body as it leaves, and the catcher's as it comes in). */
  private flight(shape: ReturnType<typeof bodyOf>, t: number, velocity: Vec3, end: number, thrower?: string, catcher?: string): Flight {
    const at = this.placeAt(t, this.stretches[this.stretches.length - 1], this.freeAt)!;
    // (Only the people it could come near in that time: from where it starts, as far as it could go and more.)
    const reach = 2 + Math.hypot(...velocity) * Math.min(end - t, 3);
    const near = new Set(this.scene.figures.filter((f) => {
      const p = (this.freeAt(f.id, t) ?? f).position;
      return Math.hypot(p[0] - at.centre.x, p[2] - at.centre.z) < reach;
    }).map((f) => f.id));
    // Flown until it lies still (or a while), whatever the animation's length (it may run on until then).
    return fly(shape.body, { t, position: at.centre.toArray() as Vec3, velocity, rotation: at.turn.toArray() as [number, number, number, number] }, end, solidsOf(this.scene, this.prop.id),
      (time) => bodiesAt(this.scene, this.freeAt, time, [...(thrower && time - t < 0.25 ? [thrower] : []), ...(catcher ? [catcher] : [])], near));
  }

  /** Where a release sends the prop: the velocity, and the catch it leads to (into a hand, or back into the one dribbling). */
  private aim(shape: ReturnType<typeof bodyOf>, e: ByHand, queue: Happening[]): { velocity: Vec3; arrive: number; catch?: { t: number; figure: string; hand: Side } } {
    const from = this.placeAt(e.t, this.stretches[this.stretches.length - 1], this.freeAt)!.centre;
    const p0 = from.toArray() as Vec3;
    const target = e.act.target;
    const fps = this.scene.animation!.fps;
    const onFrame = (t: number) => Math.max(e.t + 1 / fps, Math.round(t * fps) / fps);
    const low = shape.body.shape === 'ball' ? shape.body.size[0] : shape.body.size[1];
    if (!target) return { velocity: [0, 0, 0], arrive: e.t };
    if ('bounce' in target) {
      // Into the hand again when it next takes hold (a dribble).
      const grab = queue.find((q): q is ByHand => q.kind === 'grab' && q.act === e.act && q.figure === e.figure && q.hand === e.hand);
      const into = grab && this.palmAt(grab.figure, grab.hand, grab.t);
      if (!grab || !into) return { velocity: [0, 0, 0], arrive: e.t };
      return { velocity: aimBounce(p0, into.toArray() as Vec3, grab.t - e.t, low, (shape.body.bounce + FLOOR_BOUNCE) / 2), arrive: grab.t };
    }
    if ('at' in target) {
      const ground = groundOf(this.scene.props, this.prop.id);
      const to: Vec3 = [target.at[0], ground(target.at[0], target.at[1]) + low, target.at[1]];
      const T = onFrame(e.t + throwTime(p0, to));
      return { velocity: aim(p0, to, T - e.t), arrive: T };
    }
    if ('hoop' in target) {
      const hoop = this.scene.props.find((p) => p.id === target.hoop && p.kind === 'hoop');
      if (!hoop) return { velocity: [0, 0, 0], arrive: e.t };
      const rim = new THREE.Vector3(...rimOf(hoop));
      // Through the rim's centre, or onto its front.
      const toward = rim.clone().sub(from).setY(0).normalize();
      const to = target.miss ? rim.clone().addScaledVector(toward, -RIM.radius * hoop.scale[0]).add(new THREE.Vector3(0, 0.02, 0)) : rim;
      const p1 = to.toArray() as Vec3;
      const T = onFrame(e.t + throwTime(p0, p1));
      return { velocity: aim(p0, p1, T - e.t), arrive: T };
    }
    // Into someone's hand (or one's own, tossed up): where it will be when it gets there.
    let T = onFrame(e.t + throwTime(p0, (this.palmAt(target.figure, target.hand, e.t) ?? from).toArray() as Vec3, target.rise));
    let to = from;
    for (let k = 0; k < 3; k++) {
      to = this.palmAt(target.figure, target.hand, T) ?? from;
      T = onFrame(e.t + throwTime(p0, to.toArray() as Vec3, target.rise));
    }
    to = this.palmAt(target.figure, target.hand, T) ?? from;
    return { velocity: aim(p0, to.toArray() as Vec3, T - e.t), arrive: T, catch: { t: T, figure: target.figure, hand: target.hand } };
  }

  /** Where a hand holds a prop of this kind at a time (its centre), before anything reaches for it. */
  private palmAt(figure: string, hand: Side, t: number) {
    const w = wristAt(this.freeAt, figure, hand, t);
    const f = this.scene.figures.find((x) => x.id === figure);
    if (!w || !f) return null;
    const g = grip(this.prop, hand, f.body);
    const centre = bodyOf(this.prop).centre;
    return centre.applyMatrix4(compose(g.position, g.rotation)).applyMatrix4(w);
  }

  /** The stretch at time t. */
  at(t: number) {
    let i = this.stretches.length - 1;
    while (i > 0 && this.stretches[i].t > t + 1e-9) i--;
    return { now: this.stretches[i], next: this.stretches[i + 1] };
  }

  /**
   * Where the prop is at t in a stretch: its world matrix, centre and turn. In a hand, where
   * `figureAt` has the hand (working the timeline out, where the hand is before anyone reaches).
   */
  placeAt(t: number, s: Stretch, figureAt = this.figureAt): { matrix: THREE.Matrix4; centre: THREE.Vector3; turn: THREE.Quaternion } | null {
    const shape = bodyOf(this.prop);
    let matrix: THREE.Matrix4;
    if (s.kind === 'held') {
      const m = heldMatrix(this.prop, figureAt, s, s.local, t);
      if (!m) return null;
      matrix = m;
    } else if (s.kind === 'free') {
      const f = flightAt(s.flight, t);
      // A ball rolls as it likes; it is drawn upright (its place right under its centre).
      const turn = shape.body.shape === 'ball' ? new THREE.Quaternion() : f.rotation;
      const base = f.position.clone().sub(shape.centre.clone().applyQuaternion(turn));
      matrix = new THREE.Matrix4().compose(base, turn, new THREE.Vector3(1, 1, 1));
    } else {
      const { next } = this.at(t);
      const to = next?.kind === 'rest' && next.glide ? next : null;
      const u = to ? smooth((t - s.t) / (to.t - s.t)) : 0;
      const w = to ? lerpPlace(s, to, u) : s;
      matrix = compose(w.position, w.rotation);
    }
    const centre = shape.centre.clone().applyMatrix4(matrix);
    return { matrix, centre, turn: new THREE.Quaternion().setFromRotationMatrix(matrix) };
  }
}

/** Whether a prop does anything over time (keys of its own, or actions handling it). */
export const animated = (a: Animation, id: string) => !!a.props?.[id]?.length || a.actions.some((x) => x.prop === id);

/** The prop as it is at t on its timeline (held: its place in the hand, as a held prop keeps it). */
export function propOn(tl: PropTimeline, scene: Scene, p: Prop, t: number): Prop {
  const { now } = tl.at(t);
  const { hold: _, ...free } = p;
  void _;
  if (now.kind === 'held') return { ...free, position: now.local.position, rotation: now.local.rotation, hold: { figure: now.figure, hand: now.hand } };
  const place = tl.placeAt(t, now);
  return place ? { ...free, ...decompose(place.matrix) } : p;
}

/** Where a prop is in the world (in a hand: where the hand has it). */
export function placeInWorld(p: Prop, figureAt: FigureAt, t: number): { position: Vec3; rotation: Vec3 } | null {
  if (!p.hold) return { position: p.position, rotation: p.rotation };
  const m = heldMatrix(p, figureAt, p.hold, p, t);
  return m ? decompose(m) : null;
}

/**
 * Where a prop in a hand is in the world: as the hand has it or, carried by a handle (a stretcher,
 * a bench), level from the hand along the way the carrier faces.
 */
function heldMatrix(p: Prop, figureAt: FigureAt, hold: { figure: string; hand: Side }, local: { position: Vec3; rotation: Vec3 }, t: number): THREE.Matrix4 | null {
  const w = wristAt(figureAt, hold.figure, hold.hand, t);
  if (!w) return null;
  const m = w.multiply(compose(local.position, local.rotation));
  const handles = handlesOf(p);
  if (handles.length < 2) return m;
  const handle = new THREE.Vector3(...handles[0]);
  const turn = new THREE.Matrix4().makeRotationY((facingOf(figureAt(hold.figure, t)!.bones) - 90) * D2R);
  return new THREE.Matrix4().makeTranslation(handle.clone().applyMatrix4(m)).multiply(turn).multiply(new THREE.Matrix4().makeTranslation(handle.negate()));
}

/** A prop in a hand, placed in it as it is in the world (a carried one kept level). */
export function inHand(p: Prop, figureAt: FigureAt, t: number): Prop {
  if (!p.hold || handlesOf(p).length < 2) return p;
  const m = heldMatrix(p, figureAt, p.hold, p, t);
  const w = wristAt(figureAt, p.hold.figure, p.hold.hand, t);
  return m && w ? { ...p, ...decompose(w.invert().multiply(m)) } : p;
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
export function ribbonTrail(scene: Scene, id: string, t: number, figureAt: FigureAt, placeAt: (at: number) => { position: Vec3; rotation: Vec3 } | null): Vec3[] | null {
  const prop = scene.props.find((p) => p.id === id);
  if (!prop || prop.kind !== 'ribbon') return null;
  const scale = new THREE.Vector3(...prop.scale);
  // Held all along (no keys of its own): straight from the hand, the quick way.
  const steady = prop.hold && !(scene.animation && animated(scene.animation, id)) ? prop.hold : null;
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
    const w = placeAt(Math.max(0, at));
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
