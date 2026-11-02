import * as THREE from 'three';
import { anglesOf, withAngles, type Angles } from './pose';
import type { JointName, Pose, Vec3 } from './types';

/*
 * Life in a made motion: what a person's body does that keys posed one after another do not. A
 * motion built key by key (lib/motions.ts) moves every joint at once and stops dead; a person's
 * moves through the body (the hips lead, the chest, the head and the arms follow a moment later),
 * carries on a little past where it stops and settles, and is never quite still (breathing).
 *
 * First the whole body takes part, as a person's does where a motion was keyed joint by joint: a
 * bend of the back curves through the spine, the chest and the upper chest (not a hinge at the
 * waist), the neck and head carry the curve on, and a collarbone lifts with an arm raised past the
 * shoulder (each only where the motion leaves that joint still). Then each joint of the trunk, the
 * head and (where the hands do not hold the floor) the arms follows
 * what it is keyed to as a damped spring does: the further out from the hips, the softer, so it
 * lags and overshoots a little more. The legs are as keyed (the feet are planted where they land),
 * as are where the body is and which way it faces. Then the chest breathes. Used on the made
 * motions as they are baked into clips (lib/evaluate.ts bakeClip).
 */

/** How quickly each joint follows (Hz) and how much it is damped (1: no overshoot). Not in this list: as keyed. */
const SPRINGS: Partial<Record<JointName, { hz: number; damping: number }>> = {
  spine: { hz: 5.5, damping: 0.7 },
  chest: { hz: 4.8, damping: 0.62 },
  upperChest: { hz: 4.4, damping: 0.6 },
  neck: { hz: 4, damping: 0.56 },
  head: { hz: 3.6, damping: 0.52 },
};
const ARMS: Partial<Record<JointName, { hz: number; damping: number }>> = {
  leftShoulder: { hz: 5, damping: 0.68 }, rightShoulder: { hz: 5, damping: 0.68 },
  leftUpperArm: { hz: 4.4, damping: 0.6 }, rightUpperArm: { hz: 4.4, damping: 0.6 },
  leftLowerArm: { hz: 3.8, damping: 0.55 }, rightLowerArm: { hz: 3.8, damping: 0.55 },
  leftHand: { hz: 3.4, damping: 0.5 }, rightHand: { hz: 3.4, damping: 0.5 },
};
/** A breath: how long (s), and how far the chest and upper chest rise with it (degrees, back). */
const BREATH = { period: 4.2, chest: 1.1, upperChest: 0.7 };
/** Steps of the spring's working for each frame (it is stiff: small steps keep it steady). */
const SUBSTEPS = 24;

const q = new THREE.Quaternion();
const r = new THREE.Quaternion();
const v = new THREE.Vector3();

/** The rotation vector (axis × angle) from `a` to `b`: a's inverse times b, as a vector. */
function between(a: THREE.Quaternion, b: THREE.Quaternion, out: THREE.Vector3) {
  r.copy(a).invert().multiply(b);
  if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
  const s = Math.sqrt(Math.max(0, 1 - r.w * r.w));
  const angle = 2 * Math.acos(Math.min(1, r.w));
  return s < 1e-6 ? out.set(0, 0, 0) : out.set(r.x / s, r.y / s, r.z / s).multiplyScalar(angle);
}

/** `a` turned on by the rotation vector `w` (in a's own frame). */
function turned(a: THREE.Quaternion, w: THREE.Vector3) {
  const angle = w.length();
  if (angle < 1e-9) return a;
  r.setFromAxisAngle(v.copy(w).divideScalar(angle), angle);
  return a.multiply(r).normalize();
}

/**
 * Frames of a made motion (a pose each, at `fps`) with life in them. `loop`: it goes round (its
 * springs are run through it once first, so its first frame follows on from its last). `arms`:
 * whether the arms follow loosely too (not where the hands hold the floor or a thing).
 */
export function humanize(given: { t: number; pose: Pose }[], fps: number, loop: boolean, arms: boolean): { t: number; pose: Pose }[] {
  if (given.length < 3) return given;
  const frames = coordinated(given);
  const springs = { ...SPRINGS, ...(arms ? ARMS : {}) };
  const joints = Object.keys(springs) as JointName[];
  const dt = 1 / fps / SUBSTEPS;
  const out = frames.map((f) => ({ t: f.t, pose: { ...f.pose, bones: { ...f.pose.bones } } }));
  for (const j of joints) {
    const { hz, damping } = springs[j]!;
    const k = (2 * Math.PI * hz) ** 2;
    const c = 2 * damping * 2 * Math.PI * hz;
    const target = frames.map((f) => new THREE.Quaternion(...(f.pose.bones[j] ?? [0, 0, 0, 1])));
    const now = target[0].clone();
    const speed = new THREE.Vector3();
    const pull = new THREE.Vector3();
    const run = (i: number, write: boolean) => {
      // (Towards where it is keyed, in steps, the key moving on within the frame as it does.)
      const from = target[Math.max(0, i - 1)];
      for (let s = 1; s <= SUBSTEPS; s++) {
        q.copy(from).slerp(target[i], s / SUBSTEPS);
        between(now, q, pull);
        speed.addScaledVector(pull, k * dt).addScaledVector(speed, -c * dt);
        turned(now, v.copy(speed).multiplyScalar(dt));
      }
      if (write) out[i].pose.bones[j] = [now.x, now.y, now.z, now.w];
    };
    // (Going round: once through first, so it is already moving as it comes round again.)
    if (loop) for (let i = 0; i < frames.length; i++) run(i, false);
    for (let i = 0; i < frames.length; i++) run(i, true);
  }
  // Breathing: the chest rising and falling a little all through (the same at the end of a loop as at its start).
  const period = loop ? frames[frames.length - 1].t / Math.max(1, Math.round(frames[frames.length - 1].t / BREATH.period)) : BREATH.period;
  for (const f of out) {
    const w = Math.sin((2 * Math.PI * f.t) / period);
    for (const [j, deg] of [['chest', BREATH.chest], ['upperChest', BREATH.upperChest]] as const) {
      const b = f.pose.bones[j] ?? [0, 0, 0, 1];
      q.set(b[0], b[1], b[2], b[3]).multiply(r.setFromAxisAngle(v.set(1, 0, 0), (-deg * w * Math.PI) / 180));
      f.pose.bones[j] = [q.x, q.y, q.z, q.w];
    }
  }
  return out;
}

/** How a bend keyed at the spine is shared along the back (spine, chest, upper chest), and carried on by the neck and head. */
const CURVE: [JointName, number][] = [['spine', 0.5], ['chest', 0.3], ['upperChest', 0.2]];
const CARRY: [JointName, number][] = [['neck', 0.15], ['head', 0.1]];
/** An arm raised past this (degrees, forward or out) lifts its collarbone, by this much of the rest (at most so far). */
const SHRUG = { from: 60, by: 0.25, most: 22 };

/** Whether a motion leaves these joints still (within 3°) all through. */
function still(frames: Angles[], joints: JointName[]) {
  return joints.every((j) => [0, 1, 2].every((k) => {
    const v = frames.map((f) => f[j]?.[k] ?? 0);
    return Math.max(...v) - Math.min(...v) < 3;
  }));
}

/** The whole body taking part in a motion keyed joint by joint (see above). */
function coordinated(frames: { t: number; pose: Pose }[]): { t: number; pose: Pose }[] {
  const angles = frames.map((f) => anglesOf(f.pose.bones));
  const curve = still(angles, ['chest', 'upperChest']);
  const carry = still(angles, ['neck', 'head']);
  const shrug = { L: still(angles, ['leftShoulder']), R: still(angles, ['rightShoulder']) };
  if (!curve && !carry && !shrug.L && !shrug.R) return frames;
  return frames.map((f, i) => {
    const a = angles[i];
    const out: Angles = {};
    const spine = a.spine ?? [0, 0, 0];
    const add = (j: JointName, v: Vec3, k: number) => { out[j] = (out[j] ?? a[j] ?? [0, 0, 0]).map((x, n) => x + v[n] * k) as Vec3; };
    // (The spine's pitch and roll shared along the back; its twist too, as a back twists along its length.)
    if (curve) {
      out.spine = spine.map((v) => v * CURVE[0][1]) as Vec3;
      for (const [j, k] of CURVE.slice(1)) add(j, spine, k);
    }
    if (carry) for (const [j, k] of CARRY) add(j, [spine[0], 0, spine[2]], k);
    for (const side of ['L', 'R'] as const) {
      if (!shrug[side]) continue;
      const s = side === 'L' ? 1 : -1;
      const arm = a[side === 'L' ? 'leftUpperArm' : 'rightUpperArm'] ?? [0, 0, 0];
      const raised = Math.max(-arm[0], s * arm[2]);
      const lift = Math.min(SHRUG.most, Math.max(0, raised - SHRUG.from) * SHRUG.by);
      if (lift > 0) add(side === 'L' ? 'leftShoulder' : 'rightShoulder', [0, 0, s * lift], 1);
    }
    return { t: f.t, pose: { ...f.pose, bones: withAngles(f.pose.bones, out) } };
  });
}
