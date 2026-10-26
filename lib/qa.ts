import * as THREE from 'three';
import { frameTimes, sceneAt } from './animation';
import { chainAt } from './locomotion';
import { JOINT_LABELS, jointLimits, wrapDeg } from './joints';
import { Ink } from './ink';
import { PropObject } from './props';
import { Rig } from './relations';
import { SceneView } from './sceneview';
import { groundOf } from './surfaces';
import { SHOT_ASPECT, figuresCenter, placeShot, shotAt, shotFramer, subjectAt } from './shot';
import { shotSpans } from './shots';
import { JOINTS, type Figure, type JointName, type Prop, type Scene } from './types';

/*
 * Motion QA: play the animation frame by frame and flag what usually gives a shot away:
 * feet sliding while planted, figures passing through each other or
 * through props, joints bent past their natural range, and pops (a joint snapping in a frame).
 * Bodies are approximated by capsules around the bones, so only clear overlaps are reported.
 */

export type IssueKind = 'slide' | 'overlap' | 'limit' | 'pop' | 'hidden';

export interface Issue {
  kind: IssueKind;
  figure: string;
  joint?: JointName;
  /** Seconds. */
  start: number;
  end: number;
  message: string;
  hint: string;
}

export const ISSUE_LABELS: Record<IssueKind, string> = {
  slide: 'Foot slide', overlap: 'Interpenetration', limit: 'Joint limit', pop: 'Pop', hidden: 'Hidden from the camera',
};

const HINTS: Record<IssueKind, string> = {
  slide: 'Keep the foot still while it is on the floor: match its position at both keys, or lift it.',
  overlap: 'Move the figures apart or adjust the pose at these keys.',
  limit: 'Re-pose this key with “Natural joint limits” on.',
  pop: 'Add an in-between key, or move the keys further apart.',
  hidden: 'Move the camera, the prop, or the figure out from behind it.',
};

/** Thresholds (metres, degrees). */
const SLIDE_MIN = 0.06;
const PLANTED = 0.025;
/** Faster than this (m/s) a foot near the floor is swinging, not planted. */
const CONTACT_SPEED = 0.4;
const LIMIT_SLACK = 4;
/** A pop is a sudden change of speed from one frame to the next (fast but smooth is fine). */
const POP_STEP = 25;
const LEGS = new Set<string>(['hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']);
const POP_ROOT = 0.12;
/** Capsules closer than this fraction of their radii overlap clearly (resting on each other is fine). */
const OVERLAP = 0.5;

interface Bone { a: JointName; b: JointName | null; r: number; from?: number; to?: number }

/**
 * Capsules around the bones (radius at 1.7 m height). Hands and the shoulder caps are left out:
 * holding hands and a hand on a shoulder are contact, not overlap.
 */
const BONES: Bone[] = [
  { a: 'root', b: 'neck', r: 0.1 },
  { a: 'head', b: null, r: 0.09 },
  { a: 'shoulderL', b: 'elbowL', r: 0.045, from: 0.2 }, { a: 'elbowL', b: 'wristL', r: 0.035, to: 0.7 },
  { a: 'shoulderR', b: 'elbowR', r: 0.045, from: 0.2 }, { a: 'elbowR', b: 'wristR', r: 0.035, to: 0.7 },
  { a: 'hipL', b: 'kneeL', r: 0.07 }, { a: 'kneeL', b: 'ankleL', r: 0.045 },
  { a: 'hipR', b: 'kneeR', r: 0.07 }, { a: 'kneeR', b: 'ankleR', r: 0.045 },
];

const BONE_LABELS: Record<string, string> = {
  root: 'body', head: 'head', shoulderL: 'left upper arm', elbowL: 'left forearm', shoulderR: 'right upper arm', elbowR: 'right forearm',
  hipL: 'left thigh', kneeL: 'left shin', hipR: 'right thigh', kneeR: 'right shin',
};

/** Arms crossing arms is usually a hold, and the capsules are roughest there: not checked. */
const ARMS = new Set<JointName>(['shoulderL', 'elbowL', 'shoulderR', 'elbowR']);

interface Capsule { p: THREE.Vector3; q: THREE.Vector3; r: number; bone: JointName }

/** Closest distance between segments p1q1 and p2q2. */
export function segmentDistance(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3) {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) return r.length();
  if (a <= 1e-9) t = THREE.MathUtils.clamp(f / e, 0, 1);
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) s = THREE.MathUtils.clamp(-c / a, 0, 1);
    else {
      const b = d1.dot(d2);
      const den = a * e - b * b;
      s = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

function capsules(rig: Rig, f: Figure): Capsule[] {
  const m = rig.model(f);
  const s = f.body.height / 1.7;
  const w = (k: JointName) => m.joints[k].getWorldPosition(new THREE.Vector3());
  return BONES.map((b) => {
    const a = w(b.a);
    if (!b.b) return { p: a, q: m.joints.head.localToWorld(new THREE.Vector3(0, 0.12 * s, 0)), r: b.r * s, bone: b.a };
    const end = w(b.b);
    const p = a.clone().lerp(end, b.from ?? 0);
    const q = a.clone().lerp(end, b.to ?? 1);
    return { p, q, r: b.r * s * (0.85 + f.body.build * 0.3), bone: b.a };
  });
}

/** Group frame-level hits into time ranges (gaps of one frame are bridged). */
class Ranges {
  private open = new Map<string, { start: number; end: number; worst: number; last: number; data: Omit<Issue, 'start' | 'end' | 'message' | 'hint'> }>();
  readonly issues: Issue[] = [];
  constructor(private times: number[], private describe: (key: string, worst: number, d: Omit<Issue, 'start' | 'end' | 'message' | 'hint'>) => string | null) {}

  hit(key: string, frame: number, amount: number, data: Omit<Issue, 'start' | 'end' | 'message' | 'hint'>) {
    const o = this.open.get(key);
    if (o && frame - o.last <= 2) {
      o.end = this.times[frame];
      o.last = frame;
      o.worst = Math.max(o.worst, amount);
      return;
    }
    if (o) this.close(key);
    this.open.set(key, { start: this.times[frame], end: this.times[frame], worst: amount, last: frame, data });
  }

  /** Add to the running total of a range (foot slide accumulates distance). */
  add(key: string, frame: number, amount: number, data: Omit<Issue, 'start' | 'end' | 'message' | 'hint'>) {
    const o = this.open.get(key);
    if (o && frame - o.last <= 2) {
      o.end = this.times[frame];
      o.last = frame;
      o.worst += amount;
      return;
    }
    this.hit(key, frame, amount, data);
  }

  private close(key: string) {
    const o = this.open.get(key)!;
    this.open.delete(key);
    const message = this.describe(key, o.worst, o.data);
    if (message) this.issues.push({ ...o.data, start: o.start, end: o.end, message, hint: HINTS[o.data.kind] });
  }

  finish() {
    for (const key of [...this.open.keys()]) this.close(key);
    return this.issues;
  }
}

const cm = (m: number) => `${Math.round(m * 100)} cm`;

/** Check an animated scene. Returns the issues found, sorted by time. */
export function checkMotion(scene: Scene): Issue[] {
  const a = scene.animation;
  if (!a) return [];
  const figures = scene.figures.filter((f) => !f.hidden);
  if (!figures.length) return [];
  const times = frameTimes(a);
  if (!a.loop && times[times.length - 1] < a.duration) times.push(a.duration);
  const names = new Map(scene.figures.map((f) => [f.id, f.name]));
  const who = (id: string) => (figures.length > 1 ? `${names.get(id)}: ` : '');

  const rig = new Rig();
  const ink = new Ink();
  // Props are obstacles where they are at each frame. Held props move with the hand that holds
  // them (part of the pose), and ones on the move (thrown, falling) only touch in passing.
  const props = new Map(scene.props.map((p) => [p.id, new PropObject(ink, p.kind, p.id)]));
  const placed = new Map<string, string>();
  const piecesAt = (now: Prop[]) => now.flatMap((p) => {
    const where = JSON.stringify([p.position, p.rotation, p.scale]);
    const still = placed.get(p.id) === undefined || placed.get(p.id) === where;
    placed.set(p.id, where);
    if (p.hold || !still) return [];
    const o = props.get(p.id)!;
    o.apply(p);
    o.object.updateMatrixWorld(true);
    return o.parts.bodies.map((mesh) => {
      mesh.geometry.computeBoundingBox();
      return { box: mesh.geometry.boundingBox!.clone().expandByScalar(-0.01), inverse: mesh.matrixWorld.clone().invert() };
    });
  });

  const stamps = a.loop ? [...times, a.duration] : times;
  const ranges = new Ranges(stamps, (key, worst, d) => {
    switch (d.kind) {
      case 'hidden': return null; // found shot by shot (hiddenInShots)
      case 'slide': return worst >= SLIDE_MIN ? `${who(d.figure)}${d.joint === 'ankleL' ? 'Left' : 'Right'} foot slides ${cm(worst)} while planted` : null;
      case 'limit': return `${who(d.figure)}${JOINT_LABELS[d.joint!]} bends ${Math.round(worst)}° past its natural range`;
      case 'pop': return d.joint === 'root' && key.endsWith(':move')
        ? `${who(d.figure)}Body jerks (${cm(worst)} more in one frame)`
        : `${who(d.figure)}${JOINT_LABELS[d.joint!]} snaps (${Math.round(worst)}° more in one frame)`;
      case 'overlap': {
        const [, , boneA, other, boneB] = key.split(':');
        return other === 'prop'
          ? `${who(d.figure)}The ${BONE_LABELS[boneA]} goes through a prop`
          : `${names.get(d.figure)}’s ${BONE_LABELS[boneA]} passes ${cm(worst)} into ${names.get(other)}’s ${BONE_LABELS[boneB]}`;
      }
    }
  });

  const prevAnkle = new Map<string, THREE.Vector3>();
  const prevQ = new Map<string, THREE.Quaternion>();
  const prevRoot = new Map<string, THREE.Vector3>();
  const prevStep = new Map<string, number>();
  /** Report a pop when the per-frame change jumps (or drops) by more than `limit`. */
  const pop = (key: string, change: number, limit: number) => {
    const before = prevStep.get(key);
    prevStep.set(key, change);
    return before !== undefined && Math.abs(change - before) > limit ? Math.abs(change - before) : 0;
  };
  const minAnkle = new Map<string, number>();
  const euler = new THREE.Euler();
  const point = new THREE.Vector3();

  // Floor level of each foot: its lowest point over the clip.
  const frames = times.map((t) => sceneAt(scene, t));
  for (const s of frames) {
    rig.ground = groundOf(s.props);
    for (const f of s.figures) {
      if (!figures.some((x) => x.id === f.id)) continue;
      const m = rig.model(f);
      for (const k of ['ankleL', 'ankleR'] as const) {
        const y = m.joints[k].getWorldPosition(point).y;
        minAnkle.set(f.id + k, Math.min(minAnkle.get(f.id + k) ?? Infinity, y));
      }
    }
  }

  // A loop also checks the wrap from its last frame back to the first (as a frame at the end).
  const order = a.loop ? [...frames.keys(), 0] : [...frames.keys()];
  const generatedBefore = new Set<string>();
  order.forEach((i, step) => {
    const s = frames[i];
    const wrap = step === frames.length;
    const visible = s.figures.filter((f) => figures.some((x) => x.id === f.id));
    const caps = new Map<string, Capsule[]>();
    const pieces = wrap ? [] : piecesAt(s.props);
    rig.ground = groundOf(s.props);
    for (const f of visible) {
      const m = rig.model(f);
      // Foot slide: a planted foot (at its floor level and slow) should not drift.
      // Stand-ins glide from place to place by design: no foot slide or joint limits for them.
      for (const k of f.proxy ? [] : (['ankleL', 'ankleR'] as const)) {
        const p = m.joints[k].getWorldPosition(new THREE.Vector3());
        const prev = prevAnkle.get(f.id + k);
        const floor = minAnkle.get(f.id + k)!;
        if (prev && p.y - floor < PLANTED && prev.y - floor < PLANTED) {
          const moved = Math.hypot(p.x - prev.x, p.z - prev.z);
          if (moved > 0.003 && moved * a.fps < CONTACT_SPEED) ranges.add(`slide:${f.id}:${k}`, step, moved, { kind: 'slide', figure: f.id, joint: k });
        }
        prevAnkle.set(f.id + k, p);
      }
      // Pops: a large rotation, or the body jumping, in a single frame. Walks, runs and jumps are
      // generated smooth (tests sample them finely), and legs really move that fast when running
      // or taking off: their legs and body are not checked for pops.
      const generated = !!chainAt(a, f.id, times[i]) || generatedBefore.has(f.id);
      if (chainAt(a, f.id, times[i])) generatedBefore.add(f.id); else generatedBefore.delete(f.id);
      for (const j of JOINTS) {
        if (generated && (LEGS.has(j) || j === 'root')) {
          prevStep.delete(f.id + j);
          prevQ.delete(f.id + j);
          continue;
        }
        const r = f.joints[j] ?? [0, 0, 0];
        euler.set(r[0] * THREE.MathUtils.DEG2RAD, r[1] * THREE.MathUtils.DEG2RAD, r[2] * THREE.MathUtils.DEG2RAD, j === 'root' ? 'YXZ' : 'XZY');
        const q = new THREE.Quaternion().setFromEuler(euler);
        const pq = prevQ.get(f.id + j);
        if (pq) {
          const jump = pop(f.id + j, (pq.angleTo(q) * 180) / Math.PI, POP_STEP);
          if (jump) ranges.hit(`pop:${f.id}:${j}`, step, jump, { kind: 'pop', figure: f.id, joint: j });
        }
        prevQ.set(f.id + j, q);
      }
      const root = m.joints.root.getWorldPosition(new THREE.Vector3());
      const pr = generated ? undefined : prevRoot.get(f.id);
      if (generated) prevStep.delete(`${f.id}:move`);
      const jump = pr ? pop(`${f.id}:move`, root.distanceTo(pr), POP_ROOT) : 0;
      if (jump) ranges.hit(`pop:${f.id}:root:move`, step, jump, { kind: 'pop', figure: f.id, joint: 'root' });
      prevRoot.set(f.id, root);
      if (wrap) continue;

      // Joint limits.
      for (const j of JOINTS) {
        if (j === 'root' || f.proxy) continue;
        const r = f.joints[j] ?? [0, 0, 0];
        const lim = jointLimits(j);
        const over = Math.max(...r.map((v, k) => {
          const w = wrapDeg(v);
          return Math.max(lim[k][0] - w, w - lim[k][1], 0);
        }));
        if (over > LIMIT_SLACK) ranges.hit(`limit:${f.id}:${j}`, step, over, { kind: 'limit', figure: f.id, joint: j });
      }
      const c = capsules(rig, f);
      caps.set(f.id, c);
      // Through a prop: a bone's axis inside a prop piece.
      for (const cap of c) {
        const hit = pieces.some((pc) => [0, 0.25, 0.5, 0.75, 1].some((u) => pc.box.containsPoint(point.lerpVectors(cap.p, cap.q, u).applyMatrix4(pc.inverse))));
        if (hit) ranges.hit(`overlap:${f.id}:${cap.bone}:prop`, step, 1, { kind: 'overlap', figure: f.id, joint: cap.bone });
      }
    }
    if (wrap) return;
    // Through each other: capsules overlapping by more than half (touching and holding are fine).
    for (let x = 0; x < visible.length; x++) {
      for (let y = x + 1; y < visible.length; y++) {
        const A = caps.get(visible[x].id)!;
        const B = caps.get(visible[y].id)!;
        for (const ca of A) {
          for (const cb of B) {
            if (ARMS.has(ca.bone) && ARMS.has(cb.bone)) continue;
            const d = segmentDistance(ca.p, ca.q, cb.p, cb.q);
            const depth = ca.r + cb.r - d;
            if (d < OVERLAP * (ca.r + cb.r)) ranges.hit(`overlap:${visible[x].id}:${ca.bone}:${visible[y].id}:${cb.bone}`, step, depth, { kind: 'overlap', figure: visible[x].id, joint: ca.bone });
          }
        }
      }
    }
  });

  rig.dispose();
  for (const p of props.values()) p.dispose();
  ink.dispose();
  const order2: IssueKind[] = ['hidden', 'overlap', 'slide', 'pop', 'limit'];
  return [...ranges.finish(), ...hiddenInShots(scene)].sort((p, q) => p.start - q.start || order2.indexOf(p.kind) - order2.indexOf(q.kind));
}

/**
 * Who a shot cannot see: seen through each shot's own camera, a figure (the shot's subject, or
 * everyone) is hidden when a prop blocks the line of sight to at least two of its head, chest and
 * hips.
 */
function hiddenInShots(scene: Scene): Issue[] {
  const a = scene.animation;
  if (!a || !scene.props.some((p) => !p.hold)) return [];
  const view = new SceneView();
  const cam = new THREE.PerspectiveCamera(30, SHOT_ASPECT);
  const frameAt = shotFramer(scene);
  const ray = new THREE.Raycaster();
  const issues: Issue[] = [];
  for (const span of shotSpans(a)) {
    const runs = new Map<string, { start: number; end: number; behind: string }>();
    const samples = 5;
    for (let i = 0; i < samples; i++) {
      const t = span.start + ((span.end - span.start) * i) / samples;
      const now = sceneAt(scene, t);
      view.sync(now);
      const subject = subjectAt(scene, t);
      placeShot(cam, frameAt(t), shotAt(scene, t), SHOT_ASPECT, { follow: a.camera?.follow ? figuresCenter(view, subject) : null, t });
      cam.updateMatrixWorld();
      const blockers = now.props.filter((p) => !p.hold).flatMap((p) => (view.props.get(p.id)?.parts.bodies ?? []).map((mesh) => ({ mesh, name: p.name })));
      if (!blockers.length) continue;
      for (const f of now.figures.filter((x) => !x.hidden && (!subject || x.id === subject))) {
        const m = view.figures.get(f.id);
        if (!m) continue;
        let blocked = 0;
        let behind = '';
        for (const j of ['head', 'chest', 'root'] as const) {
          const p = m.joints[j].getWorldPosition(new THREE.Vector3());
          const d = p.clone().sub(cam.position);
          const dist = d.length();
          ray.set(cam.position, d.normalize());
          ray.far = dist - 0.05;
          const hit = ray.intersectObjects(blockers.map((b) => b.mesh), false)[0];
          if (hit) {
            blocked++;
            behind = blockers.find((b) => b.mesh === hit.object)?.name ?? 'a prop';
          }
        }
        if (blocked < 2) continue;
        const run = runs.get(f.id);
        if (run) run.end = t;
        else runs.set(f.id, { start: t, end: t, behind });
      }
    }
    for (const [id, run] of runs) {
      const name = scene.figures.find((f) => f.id === id)?.name ?? 'A figure';
      issues.push({ kind: 'hidden', figure: id, start: run.start, end: Math.max(run.end, run.start + 1 / a.fps), message: `${name} is hidden behind ${run.behind} in ${span.shot.name}`, hint: HINTS.hidden });
    }
  }
  view.dispose();
  return issues;
}
