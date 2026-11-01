import * as THREE from 'three';
import { fromQuat, toQuat, type Bones } from './pose';
import { BONES, type Bone, type FingerBone, type Hand, type JointName, type Side } from './types';

/*
 * The standard skeleton: the VRM 1.0 humanoid's bones, each rotation local to its parent and
 * relative to the T-pose (every bone's rest is no turn; the figure faces +Z, its left is +X).
 *
 * The mannequin moves the 22 joints (types JOINTS) and draws its fingers from the hand presets
 * (the finger bones are for models and motions that have them). Each bone's turn is from its
 * parent in the body (below): the neck and the shoulders hang from the upper chest, each upper
 * arm from its shoulder, the toes from their foot. Models are posed from the bones' turns in the
 * world.
 */

/** Each bone's parent in the body. */
export const PARENT: Record<Exclude<Bone, 'hips'>, Bone> = {
  ...fingers('left'), ...fingers('right'),
  spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot',
} as Record<Exclude<Bone, 'hips'>, Bone>;

/** Each joint's parent (a joint too). */
export const JOINT_PARENT = PARENT as Record<Exclude<JointName, 'hips'>, JointName>;

function fingers(side: 'left' | 'right') {
  const out: Record<string, Bone> = {};
  const chain = (names: string[]) => names.forEach((n, i) => { out[`${side}${n}`] = (i ? `${side}${names[i - 1]}` : `${side}Hand`) as Bone; });
  chain(['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal']);
  for (const f of ['Index', 'Middle', 'Ring', 'Little']) chain([`${f}Proximal`, `${f}Intermediate`, `${f}Distal`]);
  return out as Partial<Record<FingerBone, Bone>>;
}

/** Bones in an order where each comes after its parent. */
const ORDER: Bone[] = (() => {
  const out: Bone[] = ['hips'];
  while (out.length < BONES.length) for (const b of BONES) if (!out.includes(b) && out.includes(PARENT[b as Exclude<Bone, 'hips'>])) out.push(b);
  return out;
})();

/** Every bone's turn in the world (hips: the figure's turn), from a pose's local turns. */
export function worldTurns(bones: Bones): Map<Bone, THREE.Quaternion> {
  const out = new Map<Bone, THREE.Quaternion>();
  for (const b of ORDER) {
    const local = fromQuat(bones[b]);
    out.set(b, b === 'hips' ? local : out.get(PARENT[b])!.clone().multiply(local));
  }
  return out;
}

/* ---------- fingers from the hand presets ---------- */

/** How far each segment of a finger curls in a fist, and how far each finger turns out as a hand spreads. */
export const FINGER_CURL = [75, 95, 65].map((a) => (a * Math.PI) / 180);
export const FINGER_SPREAD = [-0.28, -0.08, 0.1, 0.28];
export const FINGER_NAMES = ['Index', 'Middle', 'Ring', 'Little'] as const;
export const SEGMENTS = ['Proximal', 'Intermediate', 'Distal'] as const;

/**
 * The finger bones' turns for hands as the presets have them (curl and spread), for a model with
 * fingers when the pose has none of its own. In the T-pose the fingers point out along ±X, palms
 * down: they curl about Z towards the palm, and spread about Y.
 */
export function fingerBones(hands: Record<Side, Hand>): Bones {
  const out: Bones = {};
  for (const s of ['L', 'R'] as const) {
    const side = s === 'L' ? 'left' : 'right';
    const k = s === 'L' ? -1 : 1;
    const h = hands[s];
    FINGER_NAMES.forEach((f, i) => SEGMENTS.forEach((seg, n) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, n === 0 ? -k * FINGER_SPREAD[i] * h.spread : 0, k * FINGER_CURL[n] * h.curl[i + 1]));
      out[`${side}${f}${seg}` as FingerBone] = toQuat(q);
    }));
    // The thumb folds down under the palm and across it (in the T-pose it points forward, the
    // palm down: about X), a little in towards the wrist.
    const c = h.curl[0];
    out[`${side}ThumbMetacarpal` as FingerBone] = toQuat(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5 * c, k * 0.15 * c, 0)));
    out[`${side}ThumbProximal` as FingerBone] = toQuat(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6 * c, 0, 0)));
    out[`${side}ThumbDistal` as FingerBone] = toQuat(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7 * c, 0, 0)));
  }
  return out;
}
