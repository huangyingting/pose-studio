import * as THREE from 'three';
import { Ink } from './ink';
import { sided } from './joints';
import { IK_CHAINS, Mannequin, setWorldQuaternion, torsoHalfWidth, worldPos } from './mannequin';
import { angle, facingOf, turnBones } from './pose';
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
  return facingOf(f.bones);
}

/** The figure turned (about the vertical) to face `yaw`, its pose otherwise kept. */
export function withFacing(f: Figure, yaw: number): Figure {
  return { ...f, bones: turnBones(f.bones, round(wrap(yaw), 0.1) - facing(f)) };
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
/*
 * Mannequins to work things out with (where hands reach, feet land, cameras frame), never drawn:
 * bare (no outlines or lines), and kept between rigs by body, as building one is what costs (a rig
 * is made for each thing worked out; its mannequins go back when it is done with).
 */
const spare = new Map<string, Mannequin[]>();
const SPARE_PER_BODY = 4;
const calculating = new Ink();
const bodyKey = (f: Figure) => `${JSON.stringify(f.body)}${f.proxy ? ':stand-in' : ''}`;

/** Figures' mannequins, posed as asked, to work things out with. */
export class Rig {
  private models = new Map<string, { m: Mannequin; key: string }>();
  /** What grounded figures stand on (the tops of props, as in the scene), or the floor (null). */
  ground: ((x: number, z: number) => number) | null = null;

  model(f: Figure) {
    let held = this.models.get(f.id);
    if (!held) {
      const key = bodyKey(f);
      const m = spare.get(key)?.pop() ?? new Mannequin(calculating, f.body, f.id, false, true);
      m.retag(f.id);
      held = { m, key };
      this.models.set(f.id, held);
    }
    held.m.setGround(this.ground);
    held.m.apply(f);
    held.key = bodyKey(f);
    return held.m;
  }

  /** Done with: its mannequins kept for the next rig (as many as are worth keeping). */
  dispose() {
    for (const { m, key } of this.models.values()) {
      const list = spare.get(key) ?? [];
      if (list.length < SPARE_PER_BODY) {
        list.push(m);
        spare.set(key, list);
      } else m.dispose();
    }
    this.models.clear();
  }
}

/** Parts of a figure a hand can reach for (another figure's, or its own: hands on hips or knees). */
export const CONTACTS = ['head', 'leftUpperArm', 'rightUpperArm', 'chest', 'back', 'waist', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftHand', 'rightHand'] as const;
export type Contact = (typeof CONTACTS)[number];

export const CONTACT_LABELS: Record<Contact, string> = {
  head: 'Head',
  leftUpperArm: 'Left shoulder',
  rightUpperArm: 'Right shoulder',
  chest: 'Chest',
  back: 'Upper back',
  waist: 'Waist',
  leftUpperLeg: 'Left hip',
  rightUpperLeg: 'Right hip',
  leftLowerLeg: 'Left knee',
  rightLowerLeg: 'Right knee',
  leftHand: 'Left hand',
  rightHand: 'Right hand',
};

/** World position of a contact point on a posed figure (on the surface, not inside). */
export function contactPoint(m: Mannequin, f: Figure, c: Contact) {
  const k = f.body.height / 1.8;
  const at = (j: JointName, local: Vec3) => m.joints[j].localToWorld(new THREE.Vector3(...local));
  switch (c) {
    case 'head': return at('head', [0, 0.17 * k, 0]);
    // On top of the shoulder in the chest's frame, so it stays put when the arm is raised.
    case 'leftUpperArm': case 'rightUpperArm': {
      const s = m.joints[c].position;
      return at(m.joints[c].parent!.name as JointName, [s.x, s.y + 0.06 * k, s.z]);
    }
    case 'chest': return at('chest', [0, 0.13 * k, 0.15 * k]);
    case 'back': return at('chest', [0, 0.13 * k, -0.15 * k]);
    case 'waist': return at('spine', [0, 0.08 * k, 0.12 * k]);
    case 'leftUpperLeg': case 'rightUpperLeg': {
      // (Its side, just out from the torso there.)
      const x = torsoHalfWidth(f.body, 0.01 * k) + 0.01 * k;
      return at('hips', [c === 'leftUpperLeg' ? x : -x, 0.01 * k, 0]);
    }
    case 'leftLowerLeg': case 'rightLowerLeg': {
      // The kneecap: out along the bend (thigh direction minus shin direction), or the front of a straight leg.
      const side = c === 'leftLowerLeg' ? 'L' : 'R';
      const hip = m.joints[sided('UpperLeg', side)].getWorldPosition(new THREE.Vector3());
      const knee = m.joints[sided('LowerLeg', side)].getWorldPosition(new THREE.Vector3());
      const ankle = m.joints[sided('Foot', side)].getWorldPosition(new THREE.Vector3());
      const out = knee.clone().sub(hip).normalize().sub(ankle.clone().sub(knee).normalize());
      if (out.length() < 0.3) out.copy(at(sided('LowerLeg', side), [0, 0, 1]).sub(knee));
      return knee.addScaledVector(out.normalize(), 0.065 * k);
    }
    case 'leftHand': return at('leftHand', [0, -0.06 * k, 0]);
    case 'rightHand': return at('rightHand', [0, -0.06 * k, 0]);
  }
}

/** The bone a contact point moves with (to hold on to it as the figure moves). */
export const CONTACT_BONES: Record<Contact, JointName> = {
  head: 'head', leftUpperArm: 'chest', rightUpperArm: 'chest', chest: 'chest', back: 'chest', waist: 'spine',
  leftUpperLeg: 'hips', rightUpperLeg: 'hips', leftLowerLeg: 'leftLowerLeg', rightLowerLeg: 'rightLowerLeg', leftHand: 'leftHand', rightHand: 'rightHand',
};

/** A contact point on a posed figure as a spot on the bone it moves with (in that bone's frame). */
export function contactSpot(m: Mannequin, f: Figure, c: Contact): { bone: JointName; at: Vec3 } {
  const bone = CONTACT_BONES[c];
  const p = m.joints[bone].worldToLocal(contactPoint(m, f, c));
  return { bone, at: [p.x, p.y, p.z].map((v) => Math.round(v * 1000) / 1000) as Vec3 };
}

/**
 * Pose `f`'s arm so its hand rests on `target` (world space). The wrist stops a palm's length
 * short of the point. Returns the new joints and whether the hand actually got there.
 */
export function reach(rig: Rig, f: Figure, side: Side, target: THREE.Vector3, limits = true) {
  const m = rig.model(f);
  const k = f.body.height / 1.8;
  const shoulder = worldPos(m.joints[sided('UpperArm', side)]);
  const wristTarget = target.clone().add(shoulder.clone().sub(target).normalize().multiplyScalar(0.07 * k));
  const wrist = m.joints[sided('Hand', side)];
  const solve = () => {
    m.solveIK(IK_CHAINS[sided('Hand', side) as 'leftHand' | 'rightHand'], wristTarget, undefined, limits);
    // Point the hand at the target.
    const dir = target.clone().sub(worldPos(wrist)).normalize();
    const parentQ = wrist.parent!.getWorldQuaternion(new THREE.Quaternion());
    const handDown = new THREE.Vector3(0, -1, 0).applyQuaternion(parentQ);
    setWorldQuaternion(wrist, new THREE.Quaternion().setFromUnitVectors(handDown, dir).multiply(parentQ));
    if (limits) m.constrain([sided('Hand', side)]);
    return worldPos(wrist).distanceTo(wristTarget);
  };
  m.setGroundLock(true);
  let miss = solve();
  if (miss >= 0.04 * k) {
    // The IK keeps the arm's bend plane: from an awkward start (say, an arm raised overhead) try
    // again from a relaxed arm hanging at the side, and keep whichever gets closer.
    const first = m.read().bones;
    const s = side === 'L' ? 1 : -1;
    m.joints[sided('UpperArm', side)].rotation.set(0, 0, s * 10 * THREE.MathUtils.DEG2RAD);
    m.joints[sided('LowerArm', side)].rotation.set(-8 * THREE.MathUtils.DEG2RAD, 0, 0);
    wrist.rotation.set(0, 0, 0);
    m.object.updateMatrixWorld(true);
    const again = solve();
    if (again < miss) miss = again;
    else m.apply({ ...f, bones: first });
  }
  const reached = miss < 0.04 * k;
  const bones = m.read().bones;
  m.setGroundLock(false);
  return { bones, reached };
}

/**
 * Turn the head (and neck, and the chest for big turns) so the figure looks at `target`,
 * without tilting the head sideways: each joint turns (yaw) and then nods (pitch).
 */
export function lookAt(rig: Rig, f: Figure, target: THREE.Vector3, limits = true): Figure['bones'] {
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
    const c = angle(f.bones, 'chest');
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
  return m.read().bones;
}

/** Head centre of a posed figure, for looking at someone. */
export function headPoint(m: Mannequin, f: Figure) {
  return m.joints.head.localToWorld(new THREE.Vector3(0, 0.1 * (f.body.height / 1.8), 0.02));
}

/* ---------- the body as capsules (bodies through each other, a ball through someone) ---------- */

interface Bone { a: JointName; b: JointName | null; r: number; from?: number; to?: number }

/** The body's main bones as capsules (radii for a 1.7 m figure of medium build). */
const BONES: Bone[] = [
  { a: 'hips', b: 'neck', r: 0.1 },
  { a: 'head', b: null, r: 0.09 },
  { a: 'leftUpperArm', b: 'leftLowerArm', r: 0.045, from: 0.2 }, { a: 'leftLowerArm', b: 'leftHand', r: 0.035, to: 0.7 },
  { a: 'rightUpperArm', b: 'rightLowerArm', r: 0.045, from: 0.2 }, { a: 'rightLowerArm', b: 'rightHand', r: 0.035, to: 0.7 },
  { a: 'leftUpperLeg', b: 'leftLowerLeg', r: 0.07 }, { a: 'leftLowerLeg', b: 'leftFoot', r: 0.045 },
  { a: 'rightUpperLeg', b: 'rightLowerLeg', r: 0.07 }, { a: 'rightLowerLeg', b: 'rightFoot', r: 0.045 },
];

/** A bone as a capsule in the world. */
export interface Capsule { p: THREE.Vector3; q: THREE.Vector3; r: number; bone: JointName }

/** A posed figure's bones as capsules. */
export function capsules(rig: Rig, f: Figure): Capsule[] {
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
