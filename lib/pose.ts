import * as THREE from 'three';
import { mirrorBone, partOf, sideOf, wrapDeg } from './joints';
import { JOINTS, type Bone, type JointName, type Vec3 } from './types';

/*
 * Poses on the standard skeleton. A bone's rotation is a quaternion (x, y, z, w), local to its
 * parent, relative to the VRM T-pose (glTF conventions: metres, Y up, the figure facing +Z).
 *
 * People think in angles, though: the joint sliders, the anatomical limits and poses written in
 * code use each joint's own angles (lib/joints.ts: hips YXZ, every other bone XZY, with the arms
 * hanging down at zero). This module converts between the two; nothing else does.
 */

export type Quat = [number, number, number, number];
/** Bone rotations of a pose (bones left out are at rest; see lib/skeleton.ts for the bones beyond the mannequin's). */
export type Bones = Partial<Record<Bone, Quat>>;
/** The same pose as joint angles in degrees (see lib/joints.ts). */
export type Angles = Partial<Record<JointName, Vec3>>;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const orderOf = (j: JointName): THREE.EulerOrder => (j === 'hips' ? 'YXZ' : 'XZY');

/**
 * Angles are measured with the arms hanging down; the skeleton's rest has them out to the sides.
 * The difference is a quarter turn of the arm's frame about the forward axis (the left arm up to
 * +X, the right to −X): an upper arm's rotation takes it on the right, and the bones below it
 * see it on both sides.
 */
const ARM_DOWN: Record<'L' | 'R', THREE.Quaternion> = {
  L: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
  R: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
};

const isArm = (j: JointName) => { const p = partOf(j); return p === 'UpperArm' || p === 'LowerArm' || p === 'Hand'; };

/** A rotation as the mannequin's rig holds it (arms-down frames) → as the skeleton stores it. */
export function rigToBone(j: JointName, q: THREE.Quaternion): THREE.Quaternion {
  if (!isArm(j)) return q.clone();
  const c = ARM_DOWN[sideOf(j)!];
  return partOf(j) === 'UpperArm' ? q.clone().multiply(c.clone().invert()) : c.clone().multiply(q).multiply(c.clone().invert());
}

/** A stored rotation → as the mannequin's rig holds it. */
export function boneToRig(j: JointName, q: THREE.Quaternion): THREE.Quaternion {
  if (!isArm(j)) return q.clone();
  const c = ARM_DOWN[sideOf(j)!];
  return partOf(j) === 'UpperArm' ? q.clone().multiply(c) : c.clone().invert().multiply(q).multiply(c);
}

const r5 = (v: number) => Math.round(v * 1e5) / 1e5 || 0;
export const toQuat = (q: THREE.Quaternion): Quat => {
  // One sign for the same rotation (w ≥ 0), so equal poses compare equal.
  const s = q.w < 0 ? -1 : 1;
  return [r5(q.x * s), r5(q.y * s), r5(q.z * s), r5(q.w * s)];
};
/** A stored rotation as a unit quaternion (stored values are rounded). */
export const fromQuat = (q: Quat | undefined) => (q ? new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize() : new THREE.Quaternion());

/** The rest rotation of a bone, as stored (the arms out to the sides is identity). */
export const REST: Quat = [0, 0, 0, 1];

/** A joint's angles → the bone's rotation. */
export function angleToQuat(j: JointName, v: Vec3): Quat {
  const rig = new THREE.Quaternion().setFromEuler(new THREE.Euler(v[0] * D2R, v[1] * D2R, v[2] * D2R, orderOf(j)));
  return toQuat(rigToBone(j, rig));
}

/**
 * A bone's rotation → the joint's angles. The same rotation has two sets of angles; this picks the
 * one nearest `near` (the previous value, or rest), so values do not jump between them.
 */
export function quatToAngle(j: JointName, q: Quat | undefined, near: Vec3 = [0, 0, 0]): Vec3 {
  const e = new THREE.Euler().setFromQuaternion(boneToRig(j, fromQuat(q)), orderOf(j));
  return nearer(j, [e.x * R2D, e.y * R2D, e.z * R2D], near);
}

/** Of the two sets of angles for the same rotation as `v`, the one nearest `near` (rounded to 0.1°). */
export function nearer(j: JointName, v: Vec3, near: Vec3): Vec3 {
  const mid = orderOf(j) === 'YXZ' ? 0 : 2;
  const fix = (v: Vec3) => v.map((x) => Math.round(wrapDeg(x) * 10) / 10 || 0) as Vec3;
  const dist = (v: Vec3) => v.reduce((s, x, i) => s + Math.abs(wrapDeg(x - near[i])), 0);
  const [a, b] = [fix(v), fix(v.map((x, i) => (i === mid ? 180 - x : x + 180)) as Vec3)];
  return dist(b) < dist(a) ? b : a;
}

/* ---------- the joints as the body hangs together (#30) ---------- */

/**
 * Each joint's parent in the body (the mannequin's hierarchy): the neck and the shoulders hang
 * from the upper chest, each upper arm from its shoulder. A pose's stored turns keep their older
 * parents (lib/skeleton.ts PARENT: the neck, shoulders and upper arms turned from the chest), so
 * what was saved and shipped means what it did; a joint's own turn in the body (what its angles,
 * its sliders and the mannequin's rig hold) is from its parent here. These two convert.
 */
export const RIG_PARENT: Record<Exclude<JointName, 'hips'>, JointName> = {
  spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot',
};

/** The joints whose stored turn is from another than their parent in the body: from what (the chest) instead. */
const STORED_FROM: Partial<Record<JointName, JointName>> = {
  neck: 'chest', leftShoulder: 'chest', rightShoulder: 'chest', leftUpperArm: 'chest', rightUpperArm: 'chest',
};

/** The joints whose own turn and stored turn can differ, or whose turn moves those that can. */
const FAMILY = new Set<JointName>(['upperChest', 'neck', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm']);

/** The chest-relative turn of a joint stored from the chest, as stored (rest when absent). */
const stored = (bones: Bones, j: JointName) => fromQuat(bones[j]);

/** A joint's own turn in the body (from its parent there), from a pose's stored turns. */
export function rigTurn(bones: Bones, j: JointName): THREE.Quaternion {
  if (!STORED_FROM[j]) return stored(bones, j);
  // (Both from the chest: the parent's taken out. The upper chest is turned from the chest as stored.)
  const parent = RIG_PARENT[j as Exclude<JointName, 'hips'>];
  return stored(bones, parent).invert().multiply(stored(bones, j));
}

/** Every joint's own turn in the body, from a pose's stored turns. */
export function rigTurns(bones: Bones): Record<JointName, THREE.Quaternion> {
  return Object.fromEntries(JOINTS.map((j) => [j, rigTurn(bones, j)])) as Record<JointName, THREE.Quaternion>;
}

/** Stored turns from the joints' own turns in the body (every joint). */
export function storedTurns(rig: Record<JointName, THREE.Quaternion>): Bones {
  const out: Bones = {};
  // (Each from the chest: its parent's chest-relative turn, then its own.)
  const fromChest = (j: JointName): THREE.Quaternion => (j === 'upperChest' ? rig.upperChest.clone() : fromChest(RIG_PARENT[j as Exclude<JointName, 'hips'>]).multiply(rig[j]));
  for (const j of JOINTS) out[j] = toQuat(STORED_FROM[j] ? fromChest(j) : rig[j]);
  return out;
}

/** A joint's own turn in the body as stored values (its stored one, where they are the same). */
const ownQuat = (bones: Bones, j: JointName): Quat | undefined => (STORED_FROM[j] ? toQuat(rigTurn(bones, j)) : bones[j]);

/** A pose's angles (only joints away from rest): each joint's own, in the body. */
export function anglesOf(bones: Bones, near: Angles = {}): Angles {
  const out: Angles = {};
  for (const j of JOINTS) {
    const v = quatToAngle(j, ownQuat(bones, j), near[j]);
    if (v.some((x) => x !== 0)) out[j] = v;
  }
  return out;
}

/** A pose from angles (joints left out are at zero: standing straight, the arms hanging down). Every joint is in it. */
export function bonesOf(angles: Angles): Bones {
  const out: Bones = {};
  for (const j of JOINTS) out[j] = angleToQuat(j, angles[j] ?? [0, 0, 0]);
  // (Where the upper chest or a shoulder is turned, those hanging from them are stored from the chest.)
  if (!angles.upperChest && !angles.leftShoulder && !angles.rightShoulder) return out;
  return storedTurns(Object.fromEntries(JOINTS.map((j) => [j, fromQuat(out[j])])) as Record<JointName, THREE.Quaternion>);
}

/** One joint's angles in a pose (its own, in the body). */
export const angle = (bones: Bones, j: JointName, near?: Vec3): Vec3 => quatToAngle(j, ownQuat(bones, j), near);

/**
 * A pose with some joints set by angles (the others as they were in the body: raising a shoulder
 * raises its arm, twisting the upper chest turns the neck and the arms with it). Bones beyond the
 * joints (the fingers) kept.
 */
export function withAngles(bones: Bones, angles: Angles): Bones {
  const entries = Object.entries(angles) as [JointName, Vec3][];
  // (Most set none of the five's family: as stored, joint by joint.)
  if (!entries.some(([j]) => FAMILY.has(j))) {
    const out: Bones = { ...bones };
    for (const [j, v] of entries) out[j] = angleToQuat(j, v);
    return out;
  }
  const rig = rigTurns(bones);
  for (const [j, v] of entries) rig[j] = fromQuat(angleToQuat(j, v));
  const out = { ...bones, ...storedTurns(rig) };
  // (A joint at rest that was not in the pose stays out of it.)
  for (const j of JOINTS) if (!bones[j] && !angles[j] && out[j]?.every((x, i) => x === REST[i])) delete out[j];
  return out;
}

/** The pose's own facing (degrees, the hips' turn about the vertical; 0 faces +Z). */
export function facingOf(bones: Bones): number {
  return quatToAngle('hips', bones.hips)[1];
}

/** A pose mirrored left ↔ right: each rotation reflected across the plane x = 0, on the other side's bone. */
export function mirrorBones(bones: Bones): Bones {
  const out: Bones = {};
  for (const [j, q] of Object.entries(bones) as [Bone, Quat][]) out[mirrorBone(j)] = [q[0], -q[1] || 0, -q[2] || 0, q[3]];
  return out;
}

/** The pose turned by `deg` about the vertical (its root's rotation). */
export function turnBones(bones: Bones, deg: number): Bones {
  if (Math.abs(deg) < 1e-9) return bones;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * D2R).multiply(fromQuat(bones.hips));
  return { ...bones, hips: toQuat(q) };
}
