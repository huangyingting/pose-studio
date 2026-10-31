import { faceAt } from './face';
import * as THREE from 'three';
import { keyPose, keyTimes, mirrorPose, partFromPoses, samplePart, startFacing } from './clip';
import { clipsVersion, playedClip } from './assets';
import { DEFAULT_BODY } from './body';
import { mirrorJointName, wrapDeg } from './joints';
import { feetOf, legsOf, locomote, footprints as stepsOf, type AnglePose, type Chain, type Ground } from './locomotion';
import { scaleOf } from './mannequin';
import { angle as angleOf, angleToQuat, anglesOf, bonesOf, facingOf, fromQuat, quatToAngle, toQuat, turnBones, withAngles } from './pose';
import { GLANCE_TURN, glanceAt, idleTurns } from './idle';
import { PropTimeline, animated, inHand, placeInWorld, propOn, ribbonTrail } from './propmotion';
import { Rig } from './relations';
import { groundOf, surfacesKey } from './surfaces';
import { uid } from './uid';
import { detectContacts, detectGrips, solveHolds, type Hold } from './constraints';
import { HZ, physicsReady } from './physics';
import { UPPER_BODY, type Action, type Animation, type Clip, type ClipPart, type ConstraintTarget, type Figure, type Holder, type JointName, type Mark, type Pose, type Prop, type Scene, type Vec3 } from './types';

/*
 * Evaluation: where everything is at a time. For each figure, its actions on the base layer give
 * a pose (one at a time; a gap holds the pose an action ends in, or glides to the keys that come
 * next), placed in the world: a clip from where the figure's previous action left it, warped to
 * the mark it ends on; a walk, run or jump from mark to mark. Correction actions add hand edits
 * on top, and planted feet stay planted on any body. Props follow (lib/propmotion.ts).
 *
 * Results are cached per animation (and cast and ground), so playing, scrubbing and checking a
 * motion work each thing out once.
 */

const EPS = 1e-6;
/** The most times a looping clip goes round (a short loop over a five-minute film). */
const MAX_LAPS = 1000;
/**
 * How far each clip's floor-touch correction moves a figure (by its mirroring, the clip's time and
 * the figure's body): the same wherever the figure is and whichever way it faces, so worked out
 * once, not again for each edit's new evaluator.
 */
const touchFixes = new WeakMap<ClipPart, Map<string, number>>();
/** Idle life eases in and out over this long at the edges of what a figure does (s). */
const IDLE_EASE = 0.6;
/** Easing into another stance, a foot that goes further than this (m) steps there; one that goes less stays. */
const STEP_MIN = 0.06;
/** Easing with steps takes at least this long, longer the further the feet go (s, s per m), and at most this. */
const STEP_BLEND = 0.3;
const STEP_PER_M = 1;
const STEP_BLEND_MAX = 0.8;
/** A foot whose ankle is no higher than this above standing's is on the ground (m). */
const GROUNDED = 0.05;
/** How high a stepping foot lifts on its way (m). */
const STEP_LIFT = 0.06;
/** How long a planted foot takes to be let go when it lifts in a clip (s). */
const RELEASE = 0.12;
/** How long a hand takes to take hold of a partner and let go (clip time, s): on other bodies it may have further to go. */
const GRIP_EASE = 0.3;
/** How long a hold asked for takes to take hold and let go (s). */
const EASE = 0.25;
/** How long a hand reaches out for a pass before it arrives (s). */
export const CATCH_LEAD = 0.3;
/** How long an upper-body action takes to take over and to hand back (s). */
export const UPPER_EASE = 0.25;
const D2R = Math.PI / 180;

const end = (a: Action) => a.start + a.duration;
const markOf = (p: Pose): Mark => ({ at: [p.position[0], p.position[2]], facing: facingOf(p.bones) });
const toAngles = (p: Pose): AnglePose => ({ joints: anglesOf(p.bones), position: p.position, hands: p.hands, grounded: p.grounded });
const fromAngles = (p: AnglePose): Pose => ({ bones: bonesOf(p.joints), position: p.position, hands: p.hands, grounded: p.grounded });
const smooth = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

/** A floor offset turned by `deg` about the vertical (the same sense as turning a figure). */
function turn(x: number, z: number, deg: number): [number, number] {
  const a = deg * D2R;
  return [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
}

/** The pose turned by `deg` about the vertical (its root's rotation; its place is not moved). */
const turned = (p: Pose, deg: number): Pose => ({ ...p, bones: turnBones(p.bones, deg) });

/** Blend two poses (u = 0: a, 1: b). */
function blend(a: Pose, b: Pose, u: number): Pose {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const bones: Pose['bones'] = {};
  for (const j of new Set([...Object.keys(a.bones), ...Object.keys(b.bones)]) as Set<keyof Pose['bones']>) bones[j] = toQuat(fromQuat(a.bones[j]).slerp(fromQuat(b.bones[j]), u));
  const mix = (x: number, y: number) => x + (y - x) * u;
  const hand = (s: 'L' | 'R') => ({ curl: a.hands[s].curl.map((c, i) => mix(c, b.hands[s].curl[i])) as Pose['hands']['L']['curl'], spread: mix(a.hands[s].spread, b.hands[s].spread) });
  return { bones, position: a.position.map((v, i) => mix(v, b.position[i])) as Vec3, hands: { L: hand('L'), R: hand('R') }, grounded: u < 0.5 ? a.grounded : b.grounded };
}

/** A figure's actions on one layer, in order. */
export function actionsOf(a: Animation, figure: string, layer?: Action['layer']): Action[] {
  return a.actions
    .filter((x) => x.layer === layer && x.roles.some((r) => r.figure === figure))
    .sort((p, q) => p.start - q.start || p.duration - q.duration);
}

/** A clip action's clip (null: missing). */
function clipOf(act: Action): Clip | null {
  return act.source.kind === 'keys' ? act.source.clip : act.source.kind === 'clip' ? playedClip(act.source) : null;
}

/** A figure's own pose (as posed, not animated). */
const own = (f: Figure): Pose => ({ bones: f.bones, position: f.position, hands: f.hands, grounded: f.grounded });

class Evaluator {
  private readonly a: Animation;
  private readonly ground: Ground;
  private readonly rig = new Rig();
  private readonly figures: Map<string, Figure>;
  private readonly poses = new Map<string, Pose>();
  private readonly marks = new Map<string, Mark>();
  private readonly chains = new Map<string, Chain>();
  /** Each walk's upper body on the way (from the pose it leaves in to the one it arrives in). */
  private readonly uppers = new WeakMap<Chain, ClipPart>();
  private readonly anchors = new Map<string, ReturnType<typeof feetOf>>();
  /** How long each figure takes to ease into each action (blendOf). */
  private readonly blends = new Map<string, number>();
  private readonly timelines = new Map<string, PropTimeline | null>();

  constructor(private readonly scene: Scene) {
    this.a = scene.animation!;
    this.ground = groundOf(scene.props);
    this.rig.ground = this.ground;
    this.figures = new Map(scene.figures.map((f) => [f.id, f]));
  }

  dispose() {
    this.rig.dispose();
  }

  /** A figure's pose at time t: its actions, its corrections, then its contacts held (one pass for everyone). */
  pose(id: string, t: number): Pose | null {
    const f = this.figures.get(id);
    if (!f) return null;
    // (Muted, #22: as posed, what it does not played.)
    if (f.muted) return own(f);
    const key = `${id}@${t}`;
    let p = this.poses.get(key);
    if (!p) {
      // Played on and on, every moment is new: what was worked out is let go now and then.
      if (this.poses.size > 20000) this.poses.clear();
      const free = this.free(f, t);
      const holds = this.holds(f, t, free);
      p = holds.length ? { ...free, ...solveHolds(this.rig, { ...f, ...free }, holds) } : free;
      this.poses.set(key, p);
    }
    return p;
  }

  /**
   * Where a figure is at t: its pose's place before contacts are held (holding on with its hands
   * and feet does not move it), but with them when its hips are held (carried, lying on something).
   */
  root(id: string, t: number): Vec3 | null {
    const f = this.figures.get(id);
    if (!f) return null;
    const carried = this.a.constraints?.some((c) => c.figure === id && c.bone === 'hips' && t >= c.start - EASE && t <= c.end + EASE);
    return carried ? this.pose(id, t)!.position : this.free(f, t).position;
  }

  /** A figure's pose at t before contacts are held (what others' holds on it are measured on). */
  free(f: Figure, t: number): Pose {
    if (f.muted) return own(f);
    const key = `free:${f.id}@${t}`;
    let p = this.poses.get(key);
    if (!p) {
      p = this.corrected(f, t, this.layered(f, t));
      this.poses.set(key, p);
    }
    return p;
  }

  /** The base layer with upper-body actions over it (what corrections are made on). */
  layered(f: Figure, t: number): Pose {
    return this.upper(f, t, this.base(f, t));
  }

  /** Upper-body actions over the base: their spine, arms and head (and hands), eased in and out. */
  private upper(f: Figure, t: number, pose: Pose): Pose {
    for (const x of actionsOf(this.a, f.id, 'upper')) {
      // Easing into its first frame before it starts, and out of its last after it ends.
      if (t < x.start - UPPER_EASE || t > end(x) + UPPER_EASE) continue;
      const clip = clipOf(x);
      if (!clip) continue;
      const src = x.source as { speed?: number; mirror?: boolean };
      let u = (Math.min(end(x), Math.max(x.start, t)) - x.start) * (src.speed ?? 1);
      if (clip.loop && clip.duration > EPS && u > EPS) u = u % clip.duration || (u > EPS ? clip.duration : 0);
      const raw = samplePart(clip.parts[0], Math.min(clip.duration, u), clip.duration, clip.loop);
      const over = src.mirror ? mirrorPose(raw) : raw;
      const w = smooth(1 - Math.max(x.start - t, t - end(x), 0) / UPPER_EASE);
      // Eased in joint angles, so an arm swings within its range on the way.
      const bones = { ...pose.bones };
      for (const j of UPPER_BODY) {
        if (w >= 1) { bones[j] = over.bones[j]; continue; }
        const from = quatToAngle(j, pose.bones[j]);
        const to = quatToAngle(j, over.bones[j], from);
        bones[j] = angleToQuat(j, from.map((v, i) => v + wrapDeg(to[i] - v) * w) as Vec3);
      }
      pose = { ...pose, bones, hands: blend(pose, over, w).hands };
    }
    return pose;
  }

  /** Where one of a figure's bones is at t (before holds), with a point in its frame. */
  private onBody(id: string, bone: JointName, at: Vec3, t: number, scale = 1): THREE.Vector3 | null {
    const f = this.figures.get(id);
    if (!f) return null;
    return this.rig.model({ ...f, ...this.free(f, t) }).joints[bone].localToWorld(new THREE.Vector3(...at).multiplyScalar(scale));
  }

  /**
   * The contacts a figure holds at t: from the clip it plays (feet planted where they landed, hands
   * on the person they hold) and the ones asked for ("hold on to …"), each eased in and out.
   */
  private holds(f: Figure, t: number, free: Pose): Hold[] {
    const act = actionsOf(this.a, f.id).filter((x) => x.source.kind === 'clip' && x.start - EPS <= t && t <= end(x) + EPS).at(-1);
    let out = act ? this.clipHolds(f, act, t, free) : [];
    // Easing into what comes next: the feet step there (the clip's planted feet let go).
    const steps = this.steps(f, t, free);
    if (steps) out = [...out.filter((h) => h.bone !== 'leftFoot' && h.bone !== 'rightFoot'), ...steps];
    // Reaching for a pass as it comes: the hand goes out to meet it, and back with it.
    for (const c of this.scene.props.flatMap((p) => this.timeline(p.id)?.catches ?? [])) {
      if (c.figure !== f.id || t < c.t - CATCH_LEAD || t > c.t + CATCH_LEAD) continue;
      const bone = c.hand === 'L' ? 'leftHand' : 'rightHand';
      const w = smooth(1 - Math.abs(c.t - t) / CATCH_LEAD);
      const wrist = this.rig.model({ ...f, ...free }).joints[bone].getWorldPosition(new THREE.Vector3());
      out.push({ bone, at: wrist.add(new THREE.Vector3(...c.reach)), weight: w, relative: true });
    }
    for (const c of this.a.constraints ?? []) {
      if (c.figure !== f.id || t < c.start - EASE || t > c.end + EASE) continue;
      const weight = t < c.start ? smooth(1 - (c.start - t) / EASE) : t <= c.end ? 1 : 1 - smooth((t - c.end) / EASE);
      const at = this.targetOf(c.target, t);
      if (at) out.push({ bone: c.bone, at, weight });
    }
    return out;
  }

  /** The pose an action leaves a figure in, its contacts held (what comes next starts from it). */
  private ending(f: Figure, act: Action): Pose {
    const pose = this.at(f, act, end(act));
    if (act.source.kind !== 'clip') return pose;
    const key = `ending:${act.id}:${f.id}`;
    let p = this.poses.get(key);
    if (!p) {
      const holds = this.clipHolds(f, act, end(act), pose);
      p = holds.length ? { ...pose, ...solveHolds(this.rig, { ...f, ...pose }, holds) } : pose;
      this.poses.set(key, p);
    }
    return p;
  }

  /** The contacts of the clip an action plays: feet planted where they landed, hands on the person they hold. */
  private clipHolds(f: Figure, act: Action, t: number, free: Pose): Hold[] {
    const out: Hold[] = [];
    const clip = clipOf(act);
    if (clip) {
      const index = act.roles.findIndex((r) => r.figure === f.id);
      const speed = (act.source as { speed?: number }).speed ?? 1;
      const { u, mirror } = this.placed(f, act, t);
      const flip = (j: JointName) => (mirror ? mirrorJointName(j) : j);
      const figure = { ...f, ...free };
      clip.contacts.forEach((c, n) => {
        const ease = c.on ? GRIP_EASE : RELEASE;
        if (c.part !== index || u < c.start - (c.on ? ease : EPS) || u > c.end + ease) return;
        const bone = flip(c.bone) as Holder;
        // Held from where it lands until it lifts, and let go over a moment (a hand eases onto its hold too).
        const weight = u < c.start ? smooth(1 - (c.start - u) / ease) : u <= c.end ? 1 : 1 - smooth((u - c.end) / ease);
        if (!c.on) {
          const side = bone === 'leftFoot' ? 'L' : 'R';
          // (Each time round a clip played again, where the foot lands then.)
          const repeat = (act.source as { repeat?: number }).repeat;
          const lap = (clip.loop || repeat) && clip.duration > EPS ? Math.min(clip.loop ? MAX_LAPS : repeat! - 1, lapOf((t - act.start) * speed, clip.duration)) : 0;
          const key = `${act.id}:${f.id}:${n}:${lap}`;
          let at = this.anchors.get(key);
          if (!at) {
            const landed = this.placed(f, act, act.start + (lap * clip.duration + c.start) / speed).pose;
            at = feetOf(this.rig, { ...f, ...landed }, [side]);
            this.anchors.set(key, at);
          }
          // Only where it is on the floor is held: the foot lifts and turns as the clip has it.
          const now = feetOf(this.rig, figure, [side])[0].p;
          out.push({ bone, at: new THREE.Vector3(at[0].p.x, now.y, at[0].p.z), weight, relative: true });
          return;
        }
        const partner = act.roles[c.on.part]?.figure;
        const body = this.figures.get(partner ?? '')?.body;
        if (!partner || !body) return;
        // Where on the partner's body the clip has the hand now, on the partner as it is (however big).
        const k = scaleOf(body) / scaleOf(clip.parts[c.on.part].body ?? body);
        const spot = this.onBody(partner, flip(c.on.bone), this.gripSpot(clip, index, c.on.part, bone, flip(c.on.bone), u, mirror), t, k);
        if (spot) out.push({ bone, at: spot, weight, relative: true });
      });
    }
    return out;
  }

  /** Where a clip has a hand of one part on another part's bone at clip time u (in that bone's frame). */
  private gripSpot(clip: Clip, part: number, other: number, hand: JointName, bone: JointName, u: number, mirror: boolean): Vec3 {
    const pose = (i: number) => {
      const p = samplePart(clip.parts[i], u, clip.duration, clip.loop);
      return { id: `clip:${clip.id}:${i}`, name: '', body: clip.parts[i].body ?? DEFAULT_BODY, ...(mirror ? mirrorPose(p) : p) };
    };
    const w = this.rig.model(pose(part)).joints[hand].getWorldPosition(new THREE.Vector3());
    return this.rig.model(pose(other)).joints[bone].worldToLocal(w).toArray() as Vec3;
  }

  /* ---------- props ---------- */

  /** A prop's timeline: held, flying, resting (null: it does nothing over time). */
  timeline(id: string): PropTimeline | null {
    if (!this.timelines.has(id)) {
      const p = this.scene.props.find((x) => x.id === id);
      this.timelines.set(id, p && animated(this.a, id) ? new PropTimeline(this.scene, p, this.figureAt, this.freeAt) : null);
    }
    return this.timelines.get(id)!;
  }

  /** A prop as it is at t. */
  propAt(id: string, t: number): Prop | null {
    const p = this.scene.props.find((x) => x.id === id);
    if (!p) return null;
    const tl = this.timeline(id);
    return inHand(tl ? propOn(tl, this.scene, p, t) : p, this.figureAt, t);
  }

  /** Where a prop is in the world at t (in a hand: where `figureAt` has the hand). */
  propWorld(id: string, t: number, figureAt: (id: string, t: number) => Figure | null = this.figureAt) {
    const p = this.propAt(id, t);
    return p ? placeInWorld(p, figureAt, t) : null;
  }

  /** A figure as it is at t. */
  readonly figureAt = (id: string, t: number): Figure | null => {
    const f = this.figures.get(id);
    const p = f && this.pose(id, t);
    return f && p ? { ...f, ...p } : null;
  };

  /**
   * A figure with its idle life at t (#14): in the gaps between what it does (eased in and out at
   * their edges), it breathes, sways, and now and then looks at the nearest figure.
   */
  lived(f: Figure, t: number, scene: Scene): Figure {
    const w = this.gap(f.id, t);
    if (w <= 0) return f;
    // (A looping film: its idle life loops with it, no jump where it starts over.)
    const cycle = this.a.loop ? this.a.duration : 0;
    const turns = idleTurns(f.id, t, cycle);
    // Holding something in a hand: the arms keep still (a two-handed hold stays on its handles).
    if (scene.props.some((p) => this.propAt(p.id, t)?.hold?.figure === f.id)) {
      for (const j of ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'] as const) delete turns[j];
    }
    // A look at the nearest figure now and then (the head and neck turn to it, as far as they go).
    const g = glanceAt(f.id, t, cycle);
    if (g > 0) {
      const others = scene.figures.filter((o) => o.id !== f.id && !o.hidden);
      const near = others.map((o) => this.pose(o.id, t)).filter((p): p is Pose => !!p)
        .map((p) => ({ p, d: Math.hypot(p.position[0] - f.position[0], p.position[2] - f.position[2]) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 8) {
        const to = Math.atan2(near.p.position[0] - f.position[0], near.p.position[2] - f.position[2]) * (180 / Math.PI);
        const turn = Math.max(-GLANCE_TURN, Math.min(GLANCE_TURN, wrapDeg(to - facingOf(f.bones)))) * g;
        turns.head = [turns.head![0], turns.head![1] + turn * 0.6, turns.head![2]];
        turns.neck = [turns.neck![0], turns.neck![1] + turn * 0.4, turns.neck![2]];
      }
    }
    const angles: Partial<Record<JointName, Vec3>> = {};
    for (const [j, d] of Object.entries(turns) as [JointName, Vec3][]) {
      const a = angleOf(f.bones, j);
      angles[j] = [a[0] + d[0] * w, a[1] + d[1] * w, a[2] + d[2] * w];
    }
    return { ...f, bones: withAngles(f.bones, angles) };
  }

  /** How much idle life a figure has at t: none during what it does, full in a gap, eased between (over half a second). */
  private gap(id: string, t: number): number {
    const spans = busySpans(this.a, id);
    // (A looping film: what it does at the start comes right after its end.)
    const laps = this.a.loop ? [-this.a.duration, 0, this.a.duration] : [0];
    let d = Infinity;
    for (const [a0, b0] of spans) {
      for (const k of laps) {
        const [a, b] = [a0 + k, b0 + k];
        if (t >= a - EPS && t <= b + EPS) return 0;
        d = Math.min(d, t < a ? a - t : t - b);
      }
    }
    return smooth(Math.min(1, d / IDLE_EASE));
  }

  /** A figure's pose before holds, as figures go (for props: aiming and catching). */
  private readonly freeAt = (id: string, t: number): Figure | null => {
    const f = this.figures.get(id);
    return f ? { ...f, ...this.free(f, t) } : null;
  };

  /** Where a constraint's target is at t. */
  private targetOf(target: ConstraintTarget, t: number): THREE.Vector3 | null {
    if ('point' in target) return new THREE.Vector3(...target.point);
    if ('figure' in target) return this.onBody(target.figure, target.bone, target.at, t);
    const place = this.propWorld(target.prop, t, this.freeAt);
    if (!place) return null;
    const d = Math.PI / 180;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...place.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(place.rotation[0] * d, place.rotation[1] * d, place.rotation[2] * d)), new THREE.Vector3(1, 1, 1));
    return new THREE.Vector3(...target.at).applyMatrix4(m);
  }

  /** The base layer's pose: the action at t (the later one, where they overlap), or a hold or glide between them. */
  base(f: Figure, t: number): Pose {
    const acts = actionsOf(this.a, f.id);
    if (!acts.length) return f;
    const active = acts.filter((x) => x.start - EPS <= t && t <= end(x) + EPS);
    if (!active.length) {
      const prev = acts.filter((x) => end(x) < t).at(-1);
      const next = acts.find((x) => x.start > t);
      if (!prev) return this.at(f, next!, next!.start);
      const held = this.ending(f, prev);
      // Keys to come are glided to (in a loop, the first ones again by the end); anything else
      // starts from the held pose.
      const wrap = !next && this.a.loop;
      if (!wrap && next?.source.kind !== 'keys') return this.easeInto(f, acts, t, held);
      const to = wrap ? this.base(f, acts[0].start) : this.at(f, next!, next!.start);
      const part = partFromPoses('', [{ t: end(prev), pose: held }, { t: wrap ? this.a.duration + acts[0].start : next!.start, pose: to }], 'smooth');
      return samplePart(part, t, 0, false);
    }
    // Overlapping actions: the later one plays.
    return this.easeInto(f, acts, t, this.at(f, active[active.length - 1], t));
  }

  /**
   * Before an action with a blend-in, the figure eases into its first pose over that time (the
   * action then plays as made); but not from a walk or run that arrives in it (its steps planted).
   */
  private easeInto(f: Figure, acts: Action[], t: number, pose: Pose): Pose {
    const next = this.easing(f, acts, t);
    return next ? blend(pose, this.at(f, next.act, next.act.start), next.w) : pose;
  }

  /** The action a figure eases into at t, how far (0–1) and from when; null when it is not easing into one. */
  private easing(f: Figure, acts: Action[], t: number): { act: Action; w: number; from: number } | null {
    const next = acts.find((x) => x.start > t + EPS);
    if (!next?.blendIn || next.start - t >= Math.max(next.blendIn, STEP_BLEND_MAX)) return null;
    if (acts.some((x) => x.source.kind === 'travel' && x.start - EPS <= t && Math.abs(end(x) - next.start) < EPS)) return null;
    const time = this.blendOf(f, next);
    if (next.start - t >= time) return null;
    return { act: next, w: smooth(1 - (next.start - t) / time), from: next.start - time };
  }

  /** Whether both feet are on the ground (their ankles no higher above it than standing has them). */
  private grounded(f: Figure, feet: ReturnType<typeof feetOf>) {
    const ankle = legsOf(f.body).ankleY;
    return feet.every((x) => x.p.y - this.ground(x.p.x, x.p.z) < ankle + GROUNDED);
  }

  /**
   * How long a figure takes to ease into an action: its blend-in, or longer where its feet have
   * further to go (time to step there).
   */
  private blendOf(f: Figure, act: Action): number {
    const key = `${act.id}:${f.id}`;
    let time = this.blends.get(key);
    if (time === undefined) {
      // (Where its feet are before any easing into it could begin.)
      const a = feetOf(this.rig, { ...f, ...this.free(f, act.start - STEP_BLEND_MAX - EPS) });
      const b = feetOf(this.rig, { ...f, ...this.at(f, act, act.start) });
      const d = this.grounded(f, a) && this.grounded(f, b) ? Math.max(...a.map((x, i) => Math.hypot(b[i].p.x - x.p.x, b[i].p.z - x.p.z))) : 0;
      // (Not back past where something else starts or ends: what it eases from would change on the way.)
      const before = actionsOf(this.a, f.id).flatMap((x) => [x.start, end(x)]).filter((x) => x < act.start - EPS);
      const room = act.start - Math.max(-Infinity, ...before);
      time = d < STEP_MIN ? act.blendIn! : Math.max(act.blendIn!, Math.min(STEP_BLEND_MAX, room, STEP_BLEND + d * STEP_PER_M));
      this.blends.set(key, time);
    }
    return time;
  }

  /**
   * Easing from one stance into the next action's, the feet step there one at a time (the left,
   * then the right), each lifted on its way, instead of sliding with the blend; where a foot
   * barely moves, it stays planted. Null when not easing (or nothing to step).
   */
  private steps(f: Figure, t: number, free: Pose): Hold[] | null {
    const acts = actionsOf(this.a, f.id);
    const next = this.easing(f, acts, t);
    if (!next) return null;
    // (Where its feet were as it began. Before holds: what they hold may be worked out from this.)
    const from = this.free(f, next.from - EPS);
    const to = this.at(f, next.act, next.act.start);
    const a = feetOf(this.rig, { ...f, ...from });
    const b = feetOf(this.rig, { ...f, ...to });
    // (Only from standing to standing: not out of a leap or a fall.)
    if (!this.grounded(f, a) || !this.grounded(f, b)) return null;
    const now = feetOf(this.rig, { ...f, ...free });
    const m = this.rig.model({ ...f, ...free });
    const legs = legsOf(f.body);
    const reach = (legs.rootY - legs.ankleY) * 0.97;
    const out: Hold[] = [];
    (['L', 'R'] as const).forEach((side, i) => {
      const p = a[i].p;
      const q = b[i].p;
      if (Math.hypot(q.x - p.x, q.z - p.z) < STEP_MIN) return;
      // (The left foot steps first, the right as it lands: one after the other, overlapping a little.)
      const s = Math.min(1, Math.max(0, (next.w - i * 0.35) / 0.65));
      const k = smooth(s);
      const at = new THREE.Vector3(p.x + (q.x - p.x) * k, now[i].p.y + STEP_LIFT * Math.sin(Math.PI * s), p.z + (q.z - p.z) * k);
      // (Never further from the hip than the leg reaches: it would snap straight.)
      const hip = m.joints[side === 'L' ? 'leftUpperLeg' : 'rightUpperLeg'].getWorldPosition(new THREE.Vector3());
      if (at.distanceTo(hip) > reach) at.sub(hip).setLength(reach).add(hip);
      out.push({ bone: side === 'L' ? 'leftFoot' : 'rightFoot', at, weight: 1, relative: true });
    });
    return out;
  }

  /** One action's pose for a figure at t (within the action). */
  at(f: Figure, act: Action, t: number): Pose {
    const time = Math.min(end(act), Math.max(act.start, t));
    const key = `${act.id}:${f.id}@${time}`;
    let p = this.poses.get(key);
    if (!p) {
      const src = act.source;
      p = src.kind === 'travel' ? this.travel(f, act, time) : src.kind === 'keys' ? this.keys(act, time) : this.clip(f, act, time);
      this.poses.set(key, p);
    }
    return p;
  }

  private keys(act: Action, t: number): Pose {
    const clip = (act.source as { clip: Clip }).clip;
    return samplePart(clip.parts[0], t - act.start, clip.duration, clip.loop);
  }

  /** Where an action leaves a figure. */
  endMark(f: Figure, act: Action): Mark {
    const key = `end:${act.id}:${f.id}`;
    let m = this.marks.get(key);
    if (!m) {
      const role = act.roles.find((r) => r.figure === f.id);
      if (act.source.kind === 'keys') {
        const part = act.source.clip.parts[0];
        m = markOf(keyPose(part, keyTimes(part).length - 1));
      } else m = role?.end ?? (act.source.kind === 'clip' ? this.natural(f, act) : this.startMark(f, act));
      this.marks.set(key, m);
    }
    return m;
  }

  /** Where a figure is when an action starts: where its previous action left it. */
  startMark(f: Figure, act: Action): Mark {
    const key = `start:${act.id}:${f.id}`;
    let m = this.marks.get(key);
    if (!m) {
      const acts = actionsOf(this.a, f.id);
      const prev = acts.slice(0, acts.indexOf(act)).at(-1);
      m = prev ? this.endMark(f, prev) : markOf(f);
      this.marks.set(key, m);
    }
    return m;
  }

  /* ---------- clips ---------- */

  /**
   * A clip's part for a figure at t, placed: its start turned and moved to where the figure is
   * when the action starts (travel and heights scaled to the figure's size), and warped on the
   * way to the role's end mark. `warp` false: where the clip by itself would take it.
   */
  private placed(f: Figure, act: Action, t: number, warp = true): { pose: Pose; mark: Mark; part: ClipPart | null; u: number; mirror: boolean } {
    const src = act.source as Extract<Action['source'], { kind: 'clip' }>;
    const clip = clipOf(act);
    const index = act.roles.findIndex((r) => r.figure === f.id);
    const part = clip?.parts[index] ?? null;
    const start = this.startMark(f, act);
    if (!clip || !part) {
      const pose = this.held(f, act);
      return { pose, mark: start, part: null, u: 0, mirror: false };
    }
    const mirror = !!src.mirror;
    const sample = (u: number, loop = clip.loop) => (mirror ? mirrorPose(samplePart(part, u, clip.duration, loop)) : samplePart(part, u, clip.duration, loop));
    // Time in the clip; a loop played longer than once goes round again from where it got to.
    let u = (t - act.start) * (src.speed ?? 1);
    let laps = 0;
    if ((clip.loop || src.repeat) && clip.duration > EPS) {
      // (On a lap's end exactly — the action's own end — the end of that lap, not the start of the
      // next: a loop not quite closed would otherwise jump back to its first frame there.)
      laps = Math.min(clip.loop ? MAX_LAPS : src.repeat! - 1, lapOf(u, clip.duration));
      u = Math.min(clip.duration, Math.max(0, u - laps * clip.duration));
    } else u = Math.min(clip.duration, Math.max(0, u));
    const first = sample(0);
    // (At a lap's end, its last frame: not wrapped round to its first.)
    let raw = sample(u, u < clip.duration - EPS ? clip.loop : false);
    if (laps) {
      // (Where a lap ends: its last frame, not wrapped round to its first.)
      const last = sample(clip.duration, false);
      const lapTurn = facingOf(last.bones) - facingOf(first.bones);
      for (let k = 0; k < laps; k++) {
        const [dx, dz] = turn(raw.position[0] - first.position[0], raw.position[2] - first.position[2], lapTurn);
        raw = turned({ ...raw, position: [last.position[0] + dx, raw.position[1], last.position[2] + dz] }, lapTurn);
      }
    }
    const size = legsOf(f.body).rootY / legsOf(part.body ?? f.body).rootY;
    // (Turned so it starts facing the figure's way: where its person looks, not just its pelvis.)
    const facing0 = startFacing(part, first, mirror);
    const by = start.facing - facing0;
    const [dx, dz] = turn((raw.position[0] - first.position[0]) * size, (raw.position[2] - first.position[2]) * size, by);
    let y = raw.grounded ? raw.position[1] : legsOf(f.body).rootY + (raw.position[1] - legsOf(part.body ?? f.body).rootY) * size;
    // Off the ground, what touches the floor in the clip (a hand in a cartwheel) touches it on any body.
    if (!raw.grounded && part.body && JSON.stringify(part.body) !== JSON.stringify(f.body)) {
      let fixes = touchFixes.get(part);
      if (!fixes || fixes.size > 20000) touchFixes.set(part, (fixes = new Map()));
      const key = `${mirror}:${u}:${f.body.sex}:${f.body.height}`;
      let fix = fixes.get(key);
      if (fix === undefined) {
        fix = 0;
        const touch = this.rig.model({ ...f, id: `clip:${part.name}`, body: part.body, ...raw }).lowest();
        // (Fully while it touches, less as it rises off the floor: no step as it leaves it.)
        const w = 1 - smooth((touch - 0.03) / 0.12);
        if (w > 0) {
          // (The model is lifted out of the floor, if it went in: measured from where it was put.)
          const m = this.rig.model({ ...f, ...raw, position: [0, y, 0] });
          fix = w * (m.lowest() - (m.joints.hips.position.y - y) - touch);
        }
        fixes.set(key, fix);
      }
      y -= fix;
    }
    let pose = turned({ ...raw, position: [start.at[0] + dx, y, start.at[1] + dz] }, by);
    const role = act.roles[index];
    if (warp && role.end) {
      // Warped to the end mark: the difference from where it would end is made up on the way.
      const natural = this.natural(f, act);
      const w = smooth(act.duration > EPS ? (t - act.start) / act.duration : 1);
      const turnBy = wrapDeg(role.end.facing - natural.facing) * w;
      // Turning about where it would end up, then moving the rest of the way.
      const [ox, oz] = turn(pose.position[0] - natural.at[0], pose.position[2] - natural.at[1], turnBy);
      const shift = [(role.end.at[0] - natural.at[0]) * w, (role.end.at[1] - natural.at[1]) * w];
      pose = turned({ ...pose, position: [natural.at[0] + ox + shift[0], pose.position[1], natural.at[1] + oz + shift[1]] }, turnBy);
    }
    pose = { ...pose, position: pose.position.map((v) => Math.round(v * 1000) / 1000 || 0) as Vec3 };
    // Where it is left facing: as it started, turned as far as its pelvis has turned since.
    const mark = markOf(pose);
    if (part.facing !== undefined) mark.facing = Math.round(wrapDeg(mark.facing - facingOf(first.bones) + facing0) * 10) / 10 || 0;
    return { pose, mark, part, u, mirror };
  }

  /** Where a clip action would leave a figure, unwarped. */
  natural(f: Figure, act: Action): Mark {
    const key = `natural:${act.id}:${f.id}`;
    let m = this.marks.get(key);
    if (!m) {
      m = this.placed(f, act, end(act), false).mark;
      this.marks.set(key, m);
    }
    return m;
  }

  private clip(f: Figure, act: Action, t: number): Pose {
    return this.placed(f, act, t).pose;
  }

  /** A figure with no clip to play holds where it is. */
  private held(f: Figure, act: Action): Pose {
    const acts = actionsOf(this.a, f.id);
    const prev = acts.slice(0, acts.indexOf(act)).at(-1);
    return prev ? this.ending(f, prev) : f;
  }

  /* ---------- travel ---------- */

  /** The walk, run or jump of a travel action: from the pose it leaves in to the one it arrives in. */
  chain(f: Figure, act: Action): Chain {
    const key = `${act.id}:${f.id}`;
    let c = this.chains.get(key);
    if (c) return c;
    const src = act.source as Extract<Action['source'], { kind: 'travel' }>;
    const acts = actionsOf(this.a, f.id);
    const i = acts.indexOf(act);
    const prev = acts.slice(0, i).at(-1);
    const from = prev ? this.ending(f, prev) : (f as Pose);
    const start = this.startMark(f, act);
    const to = act.roles.find((r) => r.figure === f.id)?.end ?? start;
    // It arrives in the pose the next action starts with, or (none, or another travel) as it left, at the mark.
    const next = acts[i + 1];
    // (Not into a clip not at hand yet, still coming: as it left, until it comes.)
    const arrive = next && next.source.kind !== 'travel' && Math.abs(next.start - end(act)) < 1e-3 && (next.source.kind !== 'clip' || clipOf(next))
      ? this.at(f, next, next.start)
      : turned({ ...from, position: [to.at[0], from.position[1], to.at[1]] }, wrapDeg(to.facing - facingOf(from.bones)));
    const via = src.mode === 'jump' ? [] : src.via ?? [];
    c = {
      kind: src.mode,
      t0: act.start,
      t1: end(act),
      start: toAngles(from),
      end: toAngles(arrive),
      path: [start.at, ...via.map((m) => m.at), to.at],
      yaws: [start.facing, ...via.map((m) => m.facing), to.facing],
      ...(src.strafe ? { strafe: true } : {}),
      ...(src.spin ? { spin: src.spin } : {}),
      ...(src.flip ? { flip: src.flip } : {}),
    };
    this.chains.set(key, c);
    return c;
  }

  private travel(f: Figure, act: Action, t: number): Pose {
    const c = this.chain(f, act);
    // The upper body goes from the pose it leaves in to the one it arrives in; the legs, root and arm swing are generated.
    let part = this.uppers.get(c);
    if (!part) {
      part = partFromPoses('', [{ t: c.t0, pose: fromAngles(c.start) }, { t: c.t1, pose: fromAngles(c.end) }], 'smooth');
      this.uppers.set(c, part);
    }
    const on = samplePart(part, t, 0, false);
    if (t <= c.t0 + EPS) return fromAngles(c.start);
    if (t >= c.t1 - EPS) return fromAngles(c.end);
    return fromAngles(locomote(c, f.body, t, toAngles(on), this.ground));
  }

  /* ---------- corrections ---------- */

  /** Hand edits on top: each correction adds its rotations and offset to the pose under it. */
  private corrected(f: Figure, t: number, pose: Pose): Pose {
    const fixes = actionsOf(this.a, f.id, 'correction').filter((x) => x.start - EPS <= t && t <= end(x) + EPS);
    for (const x of fixes) {
      const clip = clipOf(x);
      if (!clip) continue;
      const d = samplePart(clip.parts[0], t - x.start, clip.duration, false);
      const bones: Pose['bones'] = { ...pose.bones };
      for (const [j, q] of Object.entries(d.bones) as [keyof Pose['bones'], [number, number, number, number]][]) bones[j] = toQuat(fromQuat(pose.bones[j]).multiply(fromQuat(q)));
      pose = { ...pose, bones, position: pose.position.map((v, i) => Math.round((v + d.position[i]) * 1000) / 1000 || 0) as Vec3 };
    }
    return pose;
  }
}

/** The difference `edited` makes to `base`: what a correction keys (rotations in each bone's frame, and an offset). */
export function correctionOf(base: Pose, edited: Pose): Pose {
  const bones: Pose['bones'] = {};
  for (const j of Object.keys(edited.bones) as (keyof Pose['bones'])[]) bones[j] = toQuat(fromQuat(base.bones[j]).invert().multiply(fromQuat(edited.bones[j])));
  return { bones, position: edited.position.map((v, i) => Math.round((v - base.position[i]) * 1000) / 1000 || 0) as Vec3, hands: edited.hands, grounded: edited.grounded };
}

const cache = new WeakMap<Animation, { key: string; ev: Evaluator }>();
/**
 * The evaluators made last: one older than these gives its mannequins back to be used again (an
 * edit makes a new animation, so a new evaluator; building mannequins for each is what costs). It
 * still works if its animation comes back (an undo): it takes them again.
 */
const recent: Evaluator[] = [];
/** Each evaluator by its animation's actions, with what else it was made for. */
const byMoves = new WeakMap<Action[], { key: string; ev: Evaluator; a: Animation; figures: Figure[] }>();
const RECENT = 4;

/** The evaluator of a scene's animation (shared while the animation, cast and ground stay the same). */
function evaluator(scene: Scene): Evaluator {
  const a = scene.animation!;
  // What it depends on besides the animation: the cast's bodies, what stands in the scene, the
  // props (their places, those that do not move by themselves), whether physics is loaded, and
  // the imported clips at hand.
  const props = scene.props.map((p) => (animated(a, p.id) ? [p.id, p.kind, p.scale, p.physics] : [p.id, p.kind, p.scale, p.position, p.rotation, p.hold]));
  const key = JSON.stringify([scene.figures.map((f) => [f.id, f.body, !!f.muted]), surfacesKey(scene.props), props, physicsReady(), clipsVersion()]);
  const hit = cache.get(a);
  if (hit && hit.key === key) {
    // (In use again: the last to give its mannequins back; one that gave them back already, among
    // the recent again, to give back the ones it takes now.)
    const i = recent.indexOf(hit.ev);
    if (i !== recent.length - 1) {
      if (i >= 0) recent.splice(i, 1);
      recent.push(hit.ev);
      if (recent.length > RECENT) recent.shift()!.dispose();
    }
    return hit.ev;
  }
  // (The same moves in another animation, only its shots or cameras changed (the director cutting
  // it, a camera set): what was worked out for them still holds.)
  const same = !hit && byMoves.get(a.actions);
  if (same && same.key === key && same.figures === scene.figures && same.a.constraints === a.constraints && same.a.props === a.props
    && same.a.duration === a.duration && same.a.fps === a.fps && same.a.loop === a.loop) {
    cache.set(a, { key, ev: same.ev });
    return evaluator(scene);
  }
  hit?.ev.dispose();
  const ev = new Evaluator(scene);
  cache.set(a, { key, ev });
  byMoves.set(a.actions, { key, ev, a, figures: scene.figures });
  recent.push(ev);
  if (recent.length > RECENT) recent.shift()!.dispose();
  return ev;
}

/**
 * What stands for how a scene's figures move: the same object as long as they move the same (no
 * edit, no clip come in, the same bodies and ground), for what is worked out from it to be kept.
 */
export function movesOf(scene: Scene): object {
  return scene.animation ? evaluator(scene) : scene.figures;
}

/** One figure as it is at time t. */
export function figurePoseAt(scene: Scene, id: string, t: number): Figure | null {
  const f = scene.figures.find((x) => x.id === id);
  if (!f || !scene.animation) return f ?? null;
  const p = evaluator(scene).pose(id, t)!;
  return { ...f, bones: p.bones, position: p.position, hands: p.hands, grounded: p.grounded };
}

/** Where a figure is at time t (its root: on the floor, or its pelvis's height off it). */
export function figureRootAt(scene: Scene, id: string, t: number): Vec3 | null {
  const f = scene.figures.find((x) => x.id === id);
  if (!f || !scene.animation) return f?.position ?? null;
  return evaluator(scene).root(id, t);
}

/** A figure's pose at t under its corrections (its base actions, with upper-body ones over them). */
export function basePoseAt(scene: Scene, id: string, t: number): Pose | null {
  const f = scene.figures.find((x) => x.id === id);
  return f && scene.animation ? evaluator(scene).layered(f, t) : null;
}

/** An action's pose for one of its figures at t. */
export function actionPoseAt(scene: Scene, act: Action, id: string, t: number): Pose | null {
  const f = scene.figures.find((x) => x.id === id);
  return f && scene.animation ? evaluator(scene).at(f, act, t) : null;
}

/**
 * When a figure is doing something (an action, a keyed block, from its blend-in on) or holds on to
 * someone, or is held: idle life fills the rest.
 */
export function busySpans(a: Animation, id: string): [number, number][] {
  const acting = [...actionsOf(a, id), ...actionsOf(a, id, 'upper')].filter((x) => x.duration > EPS).map((x): [number, number] => [x.start - (x.blendIn ?? 0), end(x)]);
  const holding = (a.constraints ?? []).filter((c) => c.figure === id || ('figure' in c.target && c.target.figure === id)).map((c): [number, number] => [c.start, c.end]);
  return [...acting, ...holding].sort((p, q) => p[0] - q[0]);
}

/** Where an action starts and ends for one of its figures. */
export function marksOf(scene: Scene, act: Action, id: string): { start: Mark; end: Mark } | null {
  const f = scene.figures.find((x) => x.id === id);
  if (!f || !scene.animation) return null;
  const ev = evaluator(scene);
  return { start: ev.startMark(f, act), end: ev.endMark(f, act) };
}

/** Which time round a clip played again is at u (its own seconds): a lap's end is that lap's, not the next one's start. */
const lapOf = (u: number, duration: number) => Math.max(0, Math.ceil(u / duration - EPS) - 1);

/** How far a clip may be warped to its end mark: in distance (a fraction of its own) and direction (degrees). */
export const WARP = { distance: 0.25, angle: 30 };
/** A clip done in place is warped no further than this (m). */
const IN_PLACE = 0.3;

/**
 * The nearest end mark a clip can be warped to for a figure, from the one it has: within ±25% of
 * the way the clip goes by itself and ±30° of its direction (a clip done in place: within a step).
 * Null: not a clip, or no mark of its own.
 */
export function warpLimit(scene: Scene, act: Action, id: string): Mark | null {
  const f = scene.figures.find((x) => x.id === id);
  const end = act.roles.find((r) => r.figure === id)?.end;
  if (!f || !end || act.source.kind !== 'clip' || !scene.animation) return null;
  const ev = evaluator(scene);
  const s = ev.startMark(f, act).at;
  const natural = ev.natural(f, act).at;
  const n = [natural[0] - s[0], natural[1] - s[1]];
  const e = [end.at[0] - s[0], end.at[1] - s[1]];
  const ln = Math.hypot(n[0], n[1]);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  if (ln < IN_PLACE) {
    const d = [e[0] - n[0], e[1] - n[1]];
    const k = Math.min(1, IN_PLACE / Math.max(1e-9, Math.hypot(d[0], d[1])));
    return { ...end, at: [r3(natural[0] + d[0] * k), r3(natural[1] + d[1] * k)] };
  }
  const u = [n[0] / ln, n[1] / ln];
  const turn = Math.atan2(u[0] * e[1] - u[1] * e[0], u[0] * e[0] + u[1] * e[1]);
  const a = Math.max(-WARP.angle, Math.min(WARP.angle, turn * (180 / Math.PI))) * (Math.PI / 180);
  const len = Math.max(1 - WARP.distance, Math.min(1 + WARP.distance, Math.hypot(e[0], e[1]) / ln)) * ln;
  const dir = [Math.cos(a) * u[0] - Math.sin(a) * u[1], Math.cos(a) * u[1] + Math.sin(a) * u[0]];
  return { ...end, at: [r3(s[0] + dir[0] * len), r3(s[1] + dir[1] * len)] };
}

/** Where a clip action would leave a figure by itself, unwarped; null: not a clip. */
export function naturalEnd(scene: Scene, act: Action, id: string): Mark | null {
  const f = scene.figures.find((x) => x.id === id);
  if (!f || act.source.kind !== 'clip' || !scene.animation) return null;
  return evaluator(scene).natural(f, act);
}

/** How far a clip action is warped for a figure, from where the clip by itself would leave them to its end mark (m, degrees); null: not a warped clip. */
export function warpOf(scene: Scene, act: Action, id: string): { distance: number; angle: number } | null {
  const f = scene.figures.find((x) => x.id === id);
  const end = act.roles.find((r) => r.figure === id)?.end;
  if (!f || !end || act.source.kind !== 'clip' || !scene.animation) return null;
  const natural = evaluator(scene).natural(f, act);
  return { distance: Math.hypot(end.at[0] - natural.at[0], end.at[1] - natural.at[1]), angle: Math.abs(wrapDeg(end.facing - natural.facing)) };
}

/** Whether a clip's end mark for a figure is further than it can be warped to. */
export function overWarp(scene: Scene, act: Action, id: string): boolean {
  const limit = warpLimit(scene, act, id);
  const end = act.roles.find((r) => r.figure === id)?.end;
  return !!limit && !!end && Math.hypot(limit.at[0] - end.at[0], limit.at[1] - end.at[1]) > 0.005;
}

/**
 * The scene as it looks at time t: every figure posed by its actions, the props where they are
 * then. `live`: as a film plays (idle life in the gaps); not while posing, where the pose shown is
 * the one keyed.
 */
export function sceneAt(scene: Scene, t: number, live = false): Scene {
  if (!scene.animation) return scene;
  const ev = evaluator(scene);
  // The pose from the animation, all else from the figure as it is now (its name, colour, whether it
  // has idle life: none of it changes how it is posed, so the evaluator kept for the animation may
  // have them as they were).
  const figures = scene.figures.map((f) => {
    const p = ev.figureAt(f.id, t)!;
    // (A character's face too, from what it does: lib/face.ts.)
    const posed = { ...f, bones: p.bones, position: p.position, hands: p.hands, grounded: p.grounded, ...(f.model && !f.proxy ? { face: faceAt(scene.animation!, f.id, t), t } : {}) };
    return live && !f.proxy && !f.hidden && !f.still && !f.muted ? ev.lived(posed, t, scene) : posed;
  });
  // A ribbon trails where its stick's tip has just been.
  const props = scene.props.map((p) => {
    const now = ev.propAt(p.id, t)!;
    return p.kind === 'ribbon' ? { ...now, trail: ribbonTrail(scene, p.id, t, ev.figureAt, (at) => ev.propWorld(p.id, at)) ?? undefined } : now;
  });
  return { ...scene, figures, props };
}

/** Where a prop is in the world at time t (in a hand: where the hand has it). */
export function propWorldAt(scene: Scene, id: string, t: number) {
  if (!scene.animation) {
    const p = scene.props.find((x) => x.id === id);
    return p ? placeInWorld(p, (fid) => scene.figures.find((f) => f.id === fid) ?? null, t) : null;
  }
  return evaluator(scene).propWorld(id, t);
}

/** When a prop let go at `release` gets where it was sent (null: it was not let go then). */
export function arrivalAt(scene: Scene, id: string, release: number): number | null {
  if (!scene.animation) return null;
  return evaluator(scene).timeline(id)?.arrivals.find((x) => Math.abs(x.release - release) < 1e-3)?.arrive ?? null;
}

/** When a prop let go at `release` is down to stay (null: it is caught first, or never settles). */
export function settledAt(scene: Scene, id: string, release: number): number | null {
  const s = scene.animation ? evaluator(scene).timeline(id)?.stretches.find((x) => x.kind === 'free' && Math.abs(x.t - release) < 1e-3) : null;
  if (!s || s.kind !== 'free') return null;
  return s.flight.down ?? s.flight.t0 + s.flight.positions.length / 3 / HZ;
}

/** A prop's time in stretches, for the timeline: in someone's hand, flying, resting. */
export function propStretchesOf(scene: Scene, id: string): { t0: number; t1: number; kind: 'held' | 'free' | 'rest'; figure?: string }[] {
  const tl = scene.animation ? evaluator(scene).timeline(id) : null;
  if (!tl) return [];
  return tl.stretches.map((s, i) => ({ t0: s.t, t1: tl.stretches[i + 1]?.t ?? scene.animation!.duration, kind: s.kind, ...(s.kind === 'held' ? { figure: s.figure } : {}) }));
}

/** Grabs and catches that missed (the prop was not within reach then). */
export function missedCatchesOf(scene: Scene): { t: number; figure: string; prop: string }[] {
  if (!scene.animation) return [];
  const ev = evaluator(scene);
  return scene.props.flatMap((p) => (ev.timeline(p.id)?.misses ?? []).map((m) => ({ ...m, prop: p.id })));
}

/** The travel action a figure is on at t, if any. */
export function travelAt(a: Animation, id: string, t: number): Action | null {
  return actionsOf(a, id).find((x) => x.source.kind === 'travel' && x.start <= t + EPS && t <= end(x) + EPS) ?? null;
}

/** Where a figure's feet land on its walks and runs (drawn on the floor while editing). */
export function footprints(scene: Scene, id: string) {
  const f = scene.figures.find((x) => x.id === id);
  if (!f || !scene.animation) return [];
  const ev = evaluator(scene);
  const chains = actionsOf(scene.animation, id).filter((x) => x.source.kind === 'travel').map((x) => ev.chain(f, x));
  return stepsOf(chains, f.body, groundOf(scene.props));
}

/**
 * A scene's motion as a Clip: each figure's part sampled every frame (a built-in motion, made
 * with keys and travels, becomes one thing that plays anywhere). Its planted feet are found.
 */
export function bakeClip(scene: Scene, id = uid('clip'), name = scene.name): Clip {
  const a = scene.animation!;
  const frames = Math.max(1, Math.round(a.duration * a.fps));
  const times = Array.from({ length: frames + 1 }, (_, i) => i / a.fps);
  const parts = scene.figures.map((f) => partFromPoses(f.name, times.map((t) => ({ t, pose: figurePoseAt(scene, f.id, Math.min(t, a.duration))! })), 'linear', f.body));
  const clip: Clip = { id, name, duration: frames / a.fps, loop: a.loop, parts, events: [], contacts: [] };
  return { ...clip, contacts: [...parts.flatMap((p, i) => detectContacts(clip, i, a.fps)), ...detectGrips(clip, a.fps)] };
}
