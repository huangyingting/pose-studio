import * as THREE from 'three';
import { Ink } from './ink';
import { IK_CHAINS, Mannequin, setWorldQuaternion, worldPos } from './mannequin';
import type { Figure, JointName, Side, Vec3 } from './types';

/*
 * Spatial relationships between figures: facing, distance, side-by-side / back-to-back
 * placement, looking at someone and reaching for a point on another figure (IK).
 *
 * A figure faces +Z with yaw 0; its yaw is the root joint's Y rotation (turn, + to its left).
 * Positions are root (pelvis) positions on the floor plane; y is left alone.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const round = (v: number, step = 0.001) => Math.round(v / step) * step || 0; // `|| 0` turns -0 into 0
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

export function facing(f: Figure) {
  return f.joints.root?.[1] ?? 0;
}

export function withFacing(f: Figure, yaw: number): Figure {
  const r = f.joints.root ?? [0, 0, 0];
  return { ...f, joints: { ...f.joints, root: [r[0], round(wrap(yaw), 0.1), r[2]] } };
}

export function withPosition(f: Figure, x: number, z: number): Figure {
  return { ...f, position: [round(x), f.position[1], round(z)] };
}

/** Unit vector the figure faces, on the floor plane. */
export function forward(f: Figure): [number, number] {
  const y = facing(f) * D2R;
  return [Math.sin(y), Math.cos(y)];
}

/** Unit vector towards the figure's own left. */
export function leftward(f: Figure): [number, number] {
  const y = facing(f) * D2R;
  return [Math.cos(y), -Math.sin(y)];
}

/** Yaw that makes a figure at `from` face the point `to` (x, z). */
export function yawTowards(from: Vec3, to: Vec3) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  if (Math.hypot(dx, dz) < 1e-6) return null;
  return Math.atan2(dx, dz) * R2D;
}

/** Floor distance between two figures' pelvises. */
export function distance(a: Figure, b: Figure) {
  return Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
}

/** Turn `a` to face `b`. */
export function turnTowards(a: Figure, b: Figure): Figure {
  const yaw = yawTowards(a.position, b.position);
  return yaw === null ? a : withFacing(a, yaw);
}

/** Turn both figures towards each other. */
export function faceEachOther(a: Figure, b: Figure): [Figure, Figure] {
  return [turnTowards(a, b), turnTowards(b, a)];
}

/** Move `a` so its pelvis is `d` metres from `b`'s, along the line between them. */
export function atDistance(a: Figure, b: Figure, d: number): Figure {
  let dx = a.position[0] - b.position[0];
  let dz = a.position[2] - b.position[2];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) [dx, dz] = forward(b);
  else { dx /= len; dz /= len; }
  return withPosition(a, b.position[0] + dx * d, b.position[2] + dz * d);
}

/** Place `a` beside `b` (on b's left or right), facing the same way. */
export function besides(a: Figure, b: Figure, side: Side, gap = 0.6): Figure {
  const [lx, lz] = leftward(b);
  const s = side === 'L' ? 1 : -1;
  return withFacing(withPosition(a, b.position[0] + lx * gap * s, b.position[2] + lz * gap * s), facing(b));
}

/** Place `a` back to back with `b`. */
export function backToBack(a: Figure, b: Figure, gap = 0.3): Figure {
  const [fx, fz] = forward(b);
  return withFacing(withPosition(a, b.position[0] - fx * gap, b.position[2] - fz * gap), facing(b) + 180);
}

/** Place `a` in front of `b`, facing it. */
export function inFrontOf(a: Figure, b: Figure, d = 1): Figure {
  const [fx, fz] = forward(b);
  return withFacing(withPosition(a, b.position[0] + fx * d, b.position[2] + fz * d), facing(b) + 180);
}

/* ---------- posing against other figures (needs the 3D model) ---------- */

/** Builds and caches posed mannequins for a set of figures, to measure and solve against. */
export class Rig {
  private ink = new Ink();
  private models = new Map<string, Mannequin>();
  /** What grounded figures stand on (the tops of props, as in the scene), or the floor (null). */
  ground: ((x: number, z: number) => number) | null = null;

  model(f: Figure) {
    let m = this.models.get(f.id);
    if (!m) {
      m = new Mannequin(this.ink, f.body, f.id);
      this.models.set(f.id, m);
    }
    m.setGround(this.ground);
    m.apply(f);
    return m;
  }

  dispose() {
    for (const m of this.models.values()) m.dispose();
    this.models.clear();
    this.ink.dispose();
  }
}

/** Parts of a figure a hand can reach for (another figure's, or its own: hands on hips or knees). */
export const CONTACTS = ['head', 'shoulderL', 'shoulderR', 'chest', 'back', 'waist', 'hipL', 'hipR', 'kneeL', 'kneeR', 'wristL', 'wristR'] as const;
export type Contact = (typeof CONTACTS)[number];

export const CONTACT_LABELS: Record<Contact, string> = {
  head: 'Head',
  shoulderL: 'Left shoulder',
  shoulderR: 'Right shoulder',
  chest: 'Chest',
  back: 'Upper back',
  waist: 'Waist',
  hipL: 'Left hip',
  hipR: 'Right hip',
  kneeL: 'Left knee',
  kneeR: 'Right knee',
  wristL: 'Left hand',
  wristR: 'Right hand',
};

/** World position of a contact point on a posed figure (on the surface, not inside). */
export function contactPoint(m: Mannequin, f: Figure, c: Contact) {
  const k = f.body.height / 1.8;
  const at = (j: JointName, local: Vec3) => m.joints[j].localToWorld(new THREE.Vector3(...local));
  switch (c) {
    case 'head': return at('head', [0, 0.17 * k, 0]);
    // On top of the shoulder in the chest's frame, so it stays put when the arm is raised.
    case 'shoulderL': case 'shoulderR': {
      const s = m.joints[c].position;
      return at(m.joints[c].parent!.name as JointName, [s.x, s.y + 0.06 * k, s.z]);
    }
    case 'chest': return at('chest', [0, 0.13 * k, 0.15 * k]);
    case 'back': return at('chest', [0, 0.13 * k, -0.15 * k]);
    case 'waist': return at('spine', [0, 0.08 * k, 0.12 * k]);
    case 'hipL': return at('root', [0.17 * k, 0.01 * k, 0]);
    case 'hipR': return at('root', [-0.17 * k, 0.01 * k, 0]);
    case 'kneeL': case 'kneeR': {
      // The kneecap: out along the bend (thigh direction minus shin direction), or the front of a straight leg.
      const side = c === 'kneeL' ? 'L' : 'R';
      const hip = m.joints[`hip${side}`].getWorldPosition(new THREE.Vector3());
      const knee = m.joints[`knee${side}`].getWorldPosition(new THREE.Vector3());
      const ankle = m.joints[`ankle${side}`].getWorldPosition(new THREE.Vector3());
      const out = knee.clone().sub(hip).normalize().sub(ankle.clone().sub(knee).normalize());
      if (out.length() < 0.3) out.copy(at(`knee${side}`, [0, 0, 1]).sub(knee));
      return knee.addScaledVector(out.normalize(), 0.065 * k);
    }
    case 'wristL': return at('wristL', [0, -0.06 * k, 0]);
    case 'wristR': return at('wristR', [0, -0.06 * k, 0]);
  }
}

/** Where a figure's feet are in the world (ankles, and how they are turned). */
export function feetOf(rig: Rig, f: Figure, sides: Side[] = ['L', 'R']) {
  const m = rig.model(f);
  return sides.map((side) => {
    const j = m.joints[side === 'L' ? 'ankleL' : 'ankleR'];
    return { side, p: j.getWorldPosition(new THREE.Vector3()), q: j.getWorldQuaternion(new THREE.Quaternion()) };
  });
}

/**
 * The pose with its feet (or one) put where they are in `ref` (or at `feet`), turned as they were
 * (leg IK): planted feet do not slide from key to key.
 */
export function plantFeet(rig: Rig, pose: Figure, ref: Figure | ReturnType<typeof feetOf>, sides: Side[] = ['L', 'R']): Figure {
  const want = Array.isArray(ref) ? ref : feetOf(rig, ref, sides);
  let f = pose;
  // A grounded figure settles on its new lowest point: solve again until the feet stay.
  for (let i = 0; i < 3; i++) {
    const m = rig.model(f);
    for (const w of want) m.solveIK(IK_CHAINS[w.side === 'L' ? 'ankleL' : 'ankleR'], w.p, w.q, true);
    f = { ...f, joints: m.read().joints };
  }
  return f;
}

/**
 * Pose `f`'s arm so its hand rests on `target` (world space). The wrist stops a palm's length
 * short of the point. Returns the new joints and whether the hand actually got there.
 */
export function reach(rig: Rig, f: Figure, side: Side, target: THREE.Vector3, limits = true) {
  const m = rig.model(f);
  const k = f.body.height / 1.8;
  const shoulder = worldPos(m.joints[`shoulder${side}`]);
  const wristTarget = target.clone().add(shoulder.clone().sub(target).normalize().multiplyScalar(0.07 * k));
  const wrist = m.joints[`wrist${side}`];
  const solve = () => {
    m.solveIK(IK_CHAINS[`wrist${side}`], wristTarget, undefined, limits);
    // Point the hand at the target.
    const dir = target.clone().sub(worldPos(wrist)).normalize();
    const parentQ = wrist.parent!.getWorldQuaternion(new THREE.Quaternion());
    const handDown = new THREE.Vector3(0, -1, 0).applyQuaternion(parentQ);
    setWorldQuaternion(wrist, new THREE.Quaternion().setFromUnitVectors(handDown, dir).multiply(parentQ));
    if (limits) m.constrain([`wrist${side}`]);
    return worldPos(wrist).distanceTo(wristTarget);
  };
  m.setGroundLock(true);
  let miss = solve();
  if (miss >= 0.04 * k) {
    // The IK keeps the arm's bend plane: from an awkward start (say, an arm raised overhead) try
    // again from a relaxed arm hanging at the side, and keep whichever gets closer.
    const first = m.read().joints;
    const s = side === 'L' ? 1 : -1;
    m.joints[`shoulder${side}`].rotation.set(0, 0, s * 10 * THREE.MathUtils.DEG2RAD);
    m.joints[`elbow${side}`].rotation.set(-8 * THREE.MathUtils.DEG2RAD, 0, 0);
    wrist.rotation.set(0, 0, 0);
    m.object.updateMatrixWorld(true);
    const again = solve();
    if (again < miss) miss = again;
    else m.apply({ ...f, joints: first });
  }
  const reached = miss < 0.04 * k;
  const joints = m.read().joints;
  m.setGroundLock(false);
  return { joints, reached };
}

/**
 * Turn the head (and neck, and the chest for big turns) so the figure looks at `target`,
 * without tilting the head sideways: each joint turns (yaw) and then nods (pitch).
 */
export function lookAt(rig: Rig, f: Figure, target: THREE.Vector3, limits = true): Figure['joints'] {
  const m = rig.model(f);
  const k = f.body.height / 1.8;
  /** Direction to the target as yaw / pitch-down (degrees) in the chest's frame. */
  const aim = () => {
    const eye = m.joints.head.localToWorld(new THREE.Vector3(0, 0.1 * k, 0.05 * k));
    const chestQ = m.joints.chest.getWorldQuaternion(new THREE.Quaternion());
    const d = target.clone().sub(eye).applyQuaternion(chestQ.invert()).normalize();
    return { yaw: Math.atan2(d.x, d.z) * R2D, pitch: Math.asin(THREE.MathUtils.clamp(-d.y, -1, 1)) * R2D };
  };
  // Beyond what the neck can turn, twist the chest as well.
  const { yaw } = aim();
  const extra = Math.sign(yaw) * Math.max(0, Math.abs(yaw) - 100);
  if (extra) {
    const c = f.joints.chest ?? [0, 0, 0];
    m.joints.chest.rotation.y = THREE.MathUtils.clamp(c[1] + extra, -40, 40) * D2R;
    m.object.updateMatrixWorld(true);
  }
  const turn = (j: JointName, y: number, p: number) => {
    m.joints[j].quaternion
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), y * D2R)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), p * D2R));
    m.object.updateMatrixWorld(true);
  };
  // The eye moves as the head turns, so refine a few times.
  for (let pass = 0; pass < 3; pass++) {
    const a = aim();
    turn('neck', a.yaw * 0.45, a.pitch * 0.4);
    turn('head', a.yaw * 0.55, a.pitch * 0.6);
  }
  if (limits) m.constrain(['neck', 'head']);
  return m.read().joints;
}

/** Head centre of a posed figure, for looking at someone. */
export function headPoint(m: Mannequin, f: Figure) {
  return m.joints.head.localToWorld(new THREE.Vector3(0, 0.1 * (f.body.height / 1.8), 0.02));
}
