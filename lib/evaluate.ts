import * as THREE from 'three';
import { keyPose, keyTimes, mirrorPose, partFromPoses, samplePart } from './clip';
import { clipById } from './assets';
import { DEFAULT_BODY } from './body';
import { mirrorJointName, wrapDeg } from './joints';
import { feetOf, legsOf, locomote, footprints as stepsOf, type AnglePose, type Chain, type Ground } from './locomotion';
import { angleToQuat, anglesOf, bonesOf, facingOf, fromQuat, quatToAngle, toQuat, turnBones } from './pose';
import { propsAt, ribbonTrail, worldOfProp } from './propmotion';
import { Rig } from './relations';
import { groundOf, surfacesKey } from './surfaces';
import { uid } from './uid';
import { detectContacts, detectGrips, solveHolds, type Hold } from './constraints';
import { UPPER_BODY, type Action, type Animation, type Clip, type ClipPart, type ConstraintTarget, type Figure, type Holder, type JointName, type Mark, type Pose, type Scene, type Vec3 } from './types';

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
/** How long a planted foot takes to be let go when it lifts in a clip (s). */
const RELEASE = 0.12;
/** How long a hold asked for takes to take hold and let go (s). */
const EASE = 0.25;
/** How long an upper-body action takes to take over and to hand back (s). */
const UPPER_EASE = 0.25;
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
  return act.source.kind === 'keys' ? act.source.clip : act.source.kind === 'clip' ? clipById(act.source.clip) : null;
}

class Evaluator {
  private readonly a: Animation;
  private readonly ground: Ground;
  private readonly rig = new Rig();
  private readonly figures: Map<string, Figure>;
  private readonly poses = new Map<string, Pose>();
  private readonly marks = new Map<string, Mark>();
  private readonly chains = new Map<string, Chain>();
  private readonly anchors = new Map<string, ReturnType<typeof feetOf>>();

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

  /** A figure's pose at t before contacts are held (what others' holds on it are measured on). */
  private free(f: Figure, t: number): Pose {
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
      if (t < x.start - EPS || t > end(x) + EPS) continue;
      const clip = clipOf(x);
      if (!clip) continue;
      const src = x.source as { speed?: number; mirror?: boolean };
      let u = (t - x.start) * (src.speed ?? 1);
      if (clip.loop && clip.duration > EPS) u %= clip.duration;
      const raw = samplePart(clip.parts[0], Math.min(clip.duration, u), clip.duration, clip.loop);
      const over = src.mirror ? mirrorPose(raw) : raw;
      const ease = Math.min(1, x.duration > EPS ? Math.min(t - x.start, end(x) - t) / Math.min(UPPER_EASE, x.duration / 2) : 1);
      const w = smooth(ease);
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
    const out = act ? this.clipHolds(f, act, t, free) : [];
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
        if (c.part !== index || u < c.start - (c.on ? RELEASE : EPS) || u > c.end + RELEASE) return;
        const bone = flip(c.bone) as Holder;
        // Held from where it lands until it lifts, and let go over a moment (a hand eases onto its hold too).
        const weight = u < c.start ? smooth(1 - (c.start - u) / RELEASE) : u <= c.end ? 1 : 1 - smooth((u - c.end) / RELEASE);
        if (!c.on) {
          const side = bone === 'leftFoot' ? 'L' : 'R';
          const key = `${act.id}:${f.id}:${n}`;
          let at = this.anchors.get(key);
          if (!at) {
            const landed = this.placed(f, act, act.start + c.start / speed).pose;
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
        const size = legsOf(body).rootY / legsOf(clip.parts[c.on.part].body ?? body).rootY;
        const spot = this.onBody(partner, flip(c.on.bone), this.gripSpot(clip, index, c.on.part, bone, flip(c.on.bone), u, mirror), t, size);
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

  /** Where a constraint's target is at t. */
  private targetOf(target: ConstraintTarget, t: number): THREE.Vector3 | null {
    if ('point' in target) return new THREE.Vector3(...target.point);
    if ('figure' in target) return this.onBody(target.figure, target.bone, target.at, t);
    const place = worldOfProp(this.scene, target.prop, (id, at) => {
      const f = this.figures.get(id);
      return f ? { ...f, ...this.free(f, at) } : null;
    }, t);
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

  /** Before an action with a blend-in, the figure eases into its first pose over that time (the action then plays as made). */
  private easeInto(f: Figure, acts: Action[], t: number, pose: Pose): Pose {
    const next = acts.find((x) => x.start > t + EPS);
    if (!next?.blendIn || next.start - t >= next.blendIn) return pose;
    return blend(pose, this.at(f, next, next.start), smooth(1 - (next.start - t) / next.blendIn));
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
    const sample = (u: number) => (mirror ? mirrorPose(samplePart(part, u, clip.duration, clip.loop)) : samplePart(part, u, clip.duration, clip.loop));
    // Time in the clip; a loop played longer than once goes round again from where it got to.
    let u = (t - act.start) * (src.speed ?? 1);
    let laps = 0;
    if (clip.loop && clip.duration > EPS) {
      laps = Math.min(50, Math.floor(u / clip.duration + EPS));
      u = Math.max(0, u - laps * clip.duration);
    } else u = Math.min(clip.duration, Math.max(0, u));
    const first = sample(0);
    let raw = sample(u);
    if (laps) {
      const last = sample(clip.duration);
      const lapTurn = facingOf(last.bones) - facingOf(first.bones);
      for (let k = 0; k < laps; k++) {
        const [dx, dz] = turn(raw.position[0] - first.position[0], raw.position[2] - first.position[2], lapTurn);
        raw = turned({ ...raw, position: [last.position[0] + dx, raw.position[1], last.position[2] + dz] }, lapTurn);
      }
    }
    const size = legsOf(f.body).rootY / legsOf(part.body ?? f.body).rootY;
    const by = start.facing - facingOf(first.bones);
    const [dx, dz] = turn((raw.position[0] - first.position[0]) * size, (raw.position[2] - first.position[2]) * size, by);
    let y = raw.grounded ? raw.position[1] : legsOf(f.body).rootY + (raw.position[1] - legsOf(part.body ?? f.body).rootY) * size;
    // Off the ground, what touches the floor in the clip (a hand in a cartwheel) touches it on any body.
    if (!raw.grounded && part.body && JSON.stringify(part.body) !== JSON.stringify(f.body)) {
      const touch = this.rig.model({ ...f, id: `clip:${part.name}`, body: part.body, ...raw }).lowest();
      if (touch < 0.05) {
        // (The model is lifted out of the floor, if it went in: measured from where it was put.)
        const m = this.rig.model({ ...f, ...raw, position: [0, y, 0] });
        y -= m.lowest() - (m.joints.hips.position.y - y) - touch;
      }
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
    return { pose, mark: markOf(pose), part, u, mirror };
  }

  /** Where a clip action would leave a figure, unwarped. */
  private natural(f: Figure, act: Action): Mark {
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
    const arrive = next && next.source.kind !== 'travel' && Math.abs(next.start - end(act)) < 1e-3
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
    const part = partFromPoses('', [{ t: c.t0, pose: fromAngles(c.start) }, { t: c.t1, pose: fromAngles(c.end) }], 'smooth');
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

/** The evaluator of a scene's animation (shared while the animation, cast and ground stay the same). */
function evaluator(scene: Scene): Evaluator {
  const a = scene.animation!;
  const key = JSON.stringify([scene.figures.map((f) => [f.id, f.body]), surfacesKey(scene.props)]);
  const hit = cache.get(a);
  if (hit && hit.key === key) return hit.ev;
  hit?.ev.dispose();
  const ev = new Evaluator(scene);
  cache.set(a, { key, ev });
  return ev;
}

/** One figure as it is at time t. */
export function figurePoseAt(scene: Scene, id: string, t: number): Figure | null {
  const f = scene.figures.find((x) => x.id === id);
  if (!f || !scene.animation) return f ?? null;
  const p = evaluator(scene).pose(id, t)!;
  return { ...f, bones: p.bones, position: p.position, hands: p.hands, grounded: p.grounded };
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

/** Where an action starts and ends for one of its figures. */
export function marksOf(scene: Scene, act: Action, id: string): { start: Mark; end: Mark } | null {
  const f = scene.figures.find((x) => x.id === id);
  if (!f || !scene.animation) return null;
  const ev = evaluator(scene);
  return { start: ev.startMark(f, act), end: ev.endMark(f, act) };
}

/** The scene as it looks at time t: every figure posed by its actions, the props where they are then. */
export function sceneAt(scene: Scene, t: number): Scene {
  if (!scene.animation) return scene;
  const ev = evaluator(scene);
  const posed = (f: Figure, at: number): Figure => {
    const p = ev.pose(f.id, at)!;
    return { ...f, bones: p.bones, position: p.position, hands: p.hands, grounded: p.grounded };
  };
  const figures = scene.figures.map((f) => posed(f, t));
  // Props ride in hands, fly and fall: they need the figures' hands at their key times too.
  const figureAt = (id: string, at: number) => {
    const f = scene.figures.find((x) => x.id === id);
    return f ? (Math.abs(at - t) < 1e-9 ? figures.find((x) => x.id === id)! : posed(f, at)) : null;
  };
  // A ribbon trails where its stick's tip has just been.
  const props = propsAt(scene, t, figureAt).map((p) => (p.kind === 'ribbon' ? { ...p, trail: ribbonTrail(scene, p.id, t, figureAt) ?? undefined } : p));
  return { ...scene, figures, props };
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
