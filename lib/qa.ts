import * as THREE from 'three';
import { frameTimes } from './animation';
import { missedCatchesOf, sceneAt, travelAt } from './evaluate';
import { JOINT_LABELS, jointLimits, wrapDeg } from './joints';
import { Ink } from './ink';
import { PropObject } from './props';
import { Rig, capsules, type Capsule } from './relations';
import { angle, fromQuat } from './pose';
import { SceneView } from './sceneview';
import { groundOf } from './surfaces';
import { SHOT_ASPECT, cameraAt, placeCamera, subjectAt } from './shot';
import { shotSpans } from './shots';
import { JOINTS, type JointName, type Prop, type Scene, type Vec3 } from './types';

/*
 * Motion QA: play the animation frame by frame and flag what usually gives a shot away:
 * feet sliding while planted, figures passing through each other or
 * through props, joints bent past their natural range, and pops (a joint snapping in a frame).
 * Bodies are approximated by capsules around the bones, so only clear overlaps are reported.
 */

export type IssueKind = 'slide' | 'overlap' | 'limit' | 'pop' | 'hidden' | 'miss';

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
  slide: 'Foot slide', overlap: 'Interpenetration', limit: 'Joint limit', pop: 'Pop', hidden: 'Hidden from the camera', miss: 'Missed catch',
};

const HINTS: Record<IssueKind, string> = {
  slide: 'Keep the foot still while it is on the floor: match its position at both keys, or lift it.',
  overlap: 'Move the figures apart or adjust the pose at these keys.',
  limit: 'Re-pose this key with “Natural joint limits” on.',
  pop: 'Add an in-between key, or move the keys further apart.',
  hidden: 'Move the camera, the prop, or the figure out from behind it.',
  miss: 'Something got in its way, or the hand cannot reach it then: clear the way, or move the catch.',
};

/** Thresholds (metres, degrees). */
const SLIDE_MIN = 0.06;
const PLANTED = 0.025;
/** Faster than this (m/s) a foot near the floor is swinging, not planted (unless both feet move: gliding). */
const CONTACT_SPEED = 0.4;
/** Both feet moving at least this far in a frame (m) on the floor: the figure glides. */
const GLIDE_STEP = 0.008;
const LIMIT_SLACK = 4;
/** A pop is a sudden change of speed from one frame to the next (fast but smooth is fine). */
const POP_STEP = 25;
const LEGS = new Set<string>(['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot']);
const POP_ROOT = 0.12;
/** Capsules closer than this fraction of their radii overlap clearly (resting on each other is fine). */
const OVERLAP = 0.5;


/**
 * Capsules around the bones (radius at 1.7 m height). Hands and the shoulder caps are left out:
 * holding hands and a hand on a shoulder are contact, not overlap.
 */

const BONE_LABELS: Record<string, string> = {
  hips: 'body', head: 'head', leftUpperArm: 'left upper arm', leftLowerArm: 'left forearm', rightUpperArm: 'right upper arm', rightLowerArm: 'right forearm',
  leftUpperLeg: 'left thigh', leftLowerLeg: 'left shin', rightUpperLeg: 'right thigh', rightLowerLeg: 'right shin',
};

/** Arms crossing arms is usually a hold, and the capsules are roughest there: not checked. */
const ARMS = new Set<JointName>(['leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm']);


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
  const propNames = new Map(scene.props.map((p) => [p.id, p.name]));
  const who = (id: string) => (figures.length > 1 ? `${names.get(id)}: ` : '');

  const rig = new Rig();
  const ink = new Ink();
  // Props are obstacles where they are at each frame. Held props move with the hand that holds
  // them (part of the pose), and ones on the move (thrown, falling) only touch in passing.
  const props = new Map(scene.props.map((p) => [p.id, new PropObject(ink, p.kind, p.id)]));
  const placeOf = (props: Prop[] | undefined, id: string) => {
    const p = props?.find((x) => x.id === id);
    return p && JSON.stringify([p.position, p.rotation, p.scale]);
  };
  /** The props standing still at a frame (where they are the frame before and after). */
  const piecesAt = (now: Prop[], before?: Prop[], after?: Prop[]) => now.flatMap((p) => {
    const where = placeOf(now, p.id);
    const still = [placeOf(before, p.id), placeOf(after, p.id)].every((w) => w === undefined || w === where);
    if (p.hold || !still) return [];
    const o = props.get(p.id)!;
    o.apply(p);
    o.object.updateMatrixWorld(true);
    return o.solids.map((mesh) => {
      mesh.geometry.computeBoundingBox();
      // A little in from its surface (touching is fine), but no thinner than half of a thin part (a bar).
      const box = mesh.geometry.boundingBox!.clone();
      const size = box.getSize(new THREE.Vector3());
      const inset = new THREE.Vector3(Math.min(0.01, size.x / 4), Math.min(0.01, size.y / 4), Math.min(0.01, size.z / 4));
      return { box: new THREE.Box3(box.min.add(inset), box.max.sub(inset)), inverse: mesh.matrixWorld.clone().invert() };
    });
  });

  const stamps = a.loop ? [...times, a.duration] : times;
  const ranges = new Ranges(stamps, (key, worst, d) => {
    switch (d.kind) {
      case 'hidden': case 'miss': return null; // found shot by shot (hiddenInShots), and on the props' timelines
      case 'slide': return worst >= SLIDE_MIN ? `${who(d.figure)}${d.joint === 'leftFoot' ? 'Left' : 'Right'} foot slides ${cm(worst)} while planted` : null;
      case 'limit': return `${who(d.figure)}${JOINT_LABELS[d.joint!]} bends ${Math.round(worst)}° past its natural range`;
      case 'pop': return d.joint === 'hips' && key.endsWith(':move')
        ? `${who(d.figure)}Body jerks (${cm(worst)} more in one frame)`
        : `${who(d.figure)}${JOINT_LABELS[d.joint!]} snaps (${Math.round(worst)}° more in one frame)`;
      case 'overlap': {
        const [, , boneA, other, boneB] = key.split(':');
        if (other === 'ball') return `${propNames.get(boneB)} flies through ${names.get(d.figure)}’s ${BONE_LABELS[boneA]}`;
        return other === 'prop'
          ? `${who(d.figure)}The ${BONE_LABELS[boneA]} goes through a prop`
          : `${names.get(d.figure)}’s ${BONE_LABELS[boneA]} passes ${cm(worst)} into ${names.get(other)}’s ${BONE_LABELS[boneB]}`;
      }
    }
  });

  const prevAnkle = new Map<string, THREE.Vector3>();
  const prevQ = new Map<string, THREE.Quaternion>();
  const prevRoot = new Map<string, THREE.Vector3>();
  const prevCaps = new Map<string, Capsule[]>();
  const prevStep = new Map<string, number>();
  /** Report a pop when the per-frame change jumps (or drops) by more than `limit`. */
  const pop = (key: string, change: number, limit: number) => {
    const before = prevStep.get(key);
    prevStep.set(key, change);
    return before !== undefined && Math.abs(change - before) > limit ? Math.abs(change - before) : 0;
  };
  const minAnkle = new Map<string, number>();
  const point = new THREE.Vector3();
  const ray = new THREE.Ray();
  const tri = new THREE.Triangle();

  // Floor level of each foot: its lowest point over the clip.
  const frames = times.map((t) => sceneAt(scene, t));
  for (const s of frames) {
    rig.ground = groundOf(s.props);
    for (const f of s.figures) {
      if (!figures.some((x) => x.id === f.id)) continue;
      const m = rig.model(f);
      for (const k of ['leftFoot', 'rightFoot'] as const) {
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
    const pieces = wrap ? [] : piecesAt(s.props, frames[i - 1]?.props, frames[i + 1]?.props);
    // Balls in the air (not held, and not where they were the frame before): their centres and radii.
    const flying = wrap ? [] : s.props.filter((p) => p.kind === 'sphere' && !p.hold && placeOf(frames[i - 1]?.props, p.id) !== placeOf(s.props, p.id)).map((p) => {
      const [rx, ry, rz] = p.rotation.map((v) => v * (Math.PI / 180)) as Vec3;
      const lift = new THREE.Vector3(0, 0.5 * p.scale[1], 0).applyEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
      return { id: p.id, c: new THREE.Vector3(...p.position).add(lift), r: 0.5 * Math.min(...p.scale) };
    });
    rig.ground = groundOf(s.props);
    for (const f of visible) {
      const m = rig.model(f);
      // Foot slide: a planted foot (at its floor level and slow) should not drift, and a figure
      // should not glide along with both feet on the floor (in a step only one foot moves).
      // Stand-ins glide from place to place by design: no foot slide or joint limits for them; nor
      // does someone carried (lying on a stretcher) have feet on the floor.
      const carried = a.constraints?.some((c) => c.figure === f.id && c.bone === 'hips' && 'prop' in c.target && c.start <= times[i] && times[i] <= c.end);
      const feet = (f.proxy || carried ? [] : (['leftFoot', 'rightFoot'] as const)).map((k) => {
        const p = m.joints[k].getWorldPosition(new THREE.Vector3());
        const prev = prevAnkle.get(f.id + k);
        const floor = minAnkle.get(f.id + k)!;
        prevAnkle.set(f.id + k, p);
        const planted = !!prev && p.y - floor < PLANTED && prev.y - floor < PLANTED;
        return { k, planted, moved: prev ? Math.hypot(p.x - prev.x, p.z - prev.z) : 0 };
      });
      const gliding = feet.length === 2 && feet.every((x) => x.planted && x.moved > GLIDE_STEP);
      for (const { k, planted, moved } of feet) {
        if (planted && moved > 0.003 && (gliding || moved * a.fps < CONTACT_SPEED)) ranges.add(`slide:${f.id}:${k}`, step, moved, { kind: 'slide', figure: f.id, joint: k });
      }
      // Pops: a large rotation, or the body jumping, in a single frame. Walks, runs and jumps are
      // generated smooth (tests sample them finely), and legs really move that fast when running
      // or taking off: their legs and body are not checked for pops.
      const generated = !!travelAt(a, f.id, times[i]) || generatedBefore.has(f.id);
      if (travelAt(a, f.id, times[i])) generatedBefore.add(f.id); else generatedBefore.delete(f.id);
      for (const j of JOINTS) {
        if (generated && (LEGS.has(j) || j === 'hips')) {
          prevStep.delete(f.id + j);
          prevQ.delete(f.id + j);
          continue;
        }
        const q = fromQuat(f.bones[j]);
        const pq = prevQ.get(f.id + j);
        if (pq) {
          const jump = pop(f.id + j, (pq.angleTo(q) * 180) / Math.PI, POP_STEP);
          if (jump) ranges.hit(`pop:${f.id}:${j}`, step, jump, { kind: 'pop', figure: f.id, joint: j });
        }
        prevQ.set(f.id + j, q);
      }
      const root = m.joints.hips.getWorldPosition(new THREE.Vector3());
      const pr = generated ? undefined : prevRoot.get(f.id);
      if (generated) prevStep.delete(`${f.id}:move`);
      const jump = pr ? pop(`${f.id}:move`, root.distanceTo(pr), POP_ROOT) : 0;
      if (jump) ranges.hit(`pop:${f.id}:hips:move`, step, jump, { kind: 'pop', figure: f.id, joint: 'hips' });
      prevRoot.set(f.id, root);
      if (wrap) continue;

      // Joint limits.
      for (const j of JOINTS) {
        if (j === 'hips' || f.proxy) continue;
        const r = angle(f.bones, j);
        const lim = jointLimits(j);
        const over = Math.max(...r.map((v, k) => {
          const w = wrapDeg(v);
          return Math.max(lim[k][0] - w, w - lim[k][1], 0);
        }));
        if (over > LIMIT_SLACK) ranges.hit(`limit:${f.id}:${j}`, step, over, { kind: 'limit', figure: f.id, joint: j });
      }
      const c = capsules(rig, f);
      caps.set(f.id, c);
      const before = prevCaps.get(f.id);
      prevCaps.set(f.id, c);
      // Through a prop: a bone's axis passing through a prop piece, now or on its way here since
      // the frame before (a leg swung through a thin bar between two frames).
      // A ball on the move (thrown, bounced) through the body or legs; not while it is at a hand
      // (being let go of, or caught), and arms catch and hold it.
      const hands = (['leftHand', 'rightHand'] as const).map((j) => rig.model(f).joints[j].getWorldPosition(new THREE.Vector3()));
      for (const ball of flying) {
        if (hands.some((h) => h.distanceTo(ball.c) < 0.4)) continue;
        for (const cap of c) {
          if (/^(shoulder|elbow|wrist)/.test(cap.bone)) continue;
          const depth = ball.r + cap.r - segmentDistance(ball.c, ball.c, cap.p, cap.q);
          if (depth > 0.02) ranges.hit(`overlap:${f.id}:${cap.bone}:ball:${ball.id}`, step, depth, { kind: 'overlap', figure: f.id, joint: cap.bone });
        }
      }
      for (const [n, cap] of c.entries()) {
        const was = before?.[n];
        const hit = pieces.some((pc) => {
          const p = cap.p.clone().applyMatrix4(pc.inverse);
          const q = cap.q.clone().applyMatrix4(pc.inverse);
          if (pc.box.containsPoint(p)) return true;
          const len = p.distanceTo(q);
          const at = len > 1e-6 && ray.set(p, q.clone().sub(p).divideScalar(len)).intersectBox(pc.box, point);
          if (at && at.distanceTo(p) <= len) return true;
          if (!was) return false;
          const p0 = was.p.clone().applyMatrix4(pc.inverse);
          const q0 = was.q.clone().applyMatrix4(pc.inverse);
          return pc.box.intersectsTriangle(tri.set(p0, q0, q)) || pc.box.intersectsTriangle(tri.set(p0, q, p));
        });
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
  const order2: IssueKind[] = ['miss', 'hidden', 'overlap', 'slide', 'pop', 'limit'];
  // A prop that should have been caught (or picked up) but was not within reach.
  const misses: Issue[] = missedCatchesOf(scene).map((m) => ({
    kind: 'miss', figure: m.figure, start: m.t, end: m.t, hint: HINTS.miss,
    message: `${names.get(m.figure) ?? 'Someone'} misses ${scene.props.find((p) => p.id === m.prop)?.name ?? 'the prop'}`,
  }));
  return [...ranges.finish(), ...hiddenInShots(scene), ...misses].sort((p, q) => p.start - q.start || order2.indexOf(p.kind) - order2.indexOf(q.kind));
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
      placeCamera(cam, cameraAt(scene, t), SHOT_ASPECT);
      const blockers = now.props.filter((p) => !p.hold).flatMap((p) => (view.props.get(p.id)?.solids ?? []).map((mesh) => ({ mesh, name: p.name })));
      if (!blockers.length) continue;
      for (const f of now.figures.filter((x) => !x.hidden && (!subject || x.id === subject))) {
        const m = view.figures.get(f.id);
        if (!m) continue;
        let blocked = 0;
        let behind = '';
        for (const j of ['head', 'chest', 'hips'] as const) {
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
