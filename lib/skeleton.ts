import * as THREE from 'three';
import { fromQuat, toQuat, type Bones } from './pose';
import { BONES, EXTRA_BONES, type Bone, type ExtraBone, type Hand, type Side } from './types';

/*
 * The standard skeleton: the VRM 1.0 humanoid's bones, each rotation local to its parent and
 * relative to the T-pose (every bone's rest is no turn; the figure faces +Z, its left is +X).
 *
 * The mannequin moves the core bones (types JOINTS) and draws its fingers from the hand presets.
 * The rest (the upper chest, shoulders, toes and finger bones) are detail for models and motions
 * that have them, kept so the core bones still say it all: each bone's turn is from its parent
 * here (below), so a shoulder's turn is in the upper arm's too and the mannequin, which has no
 * shoulder, shows the arm where it is. Models are posed from the bones' turns in the world.
 */

/** Each bone's parent here: the mannequin's joint above it (the extras hang off those). */
export const PARENT: Record<Exclude<Bone, 'hips'>, Bone> = {
  ...fingers('left'), ...fingers('right'),
  spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'chest', head: 'neck',
  leftShoulder: 'chest', leftUpperArm: 'chest', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'chest', rightUpperArm: 'chest', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot',
} as Record<Exclude<Bone, 'hips'>, Bone>;

function fingers(side: 'left' | 'right') {
  const out: Record<string, Bone> = {};
  const chain = (names: string[]) => names.forEach((n, i) => { out[`${side}${n}`] = (i ? `${side}${names[i - 1]}` : `${side}Hand`) as Bone; });
  chain(['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal']);
  for (const f of ['Index', 'Middle', 'Ring', 'Little']) chain([`${f}Proximal`, `${f}Intermediate`, `${f}Distal`]);
  return out as Partial<Record<ExtraBone, Bone>>;
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

const CURL = [75, 95, 65].map((a) => (a * Math.PI) / 180);
const SPREAD = [-0.28, -0.08, 0.1, 0.28];
const FINGER = ['Index', 'Middle', 'Ring', 'Little'] as const;
const SEGMENT = ['Proximal', 'Intermediate', 'Distal'] as const;

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
    FINGER.forEach((f, i) => SEGMENT.forEach((seg, n) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, n === 0 ? -k * SPREAD[i] * h.spread : 0, k * CURL[n] * h.curl[i + 1]));
      out[`${side}${f}${seg}` as ExtraBone] = toQuat(q);
    }));
    // The thumb folds in across the palm.
    const c = h.curl[0];
    out[`${side}ThumbMetacarpal` as ExtraBone] = toQuat(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, k * 0.4 * c, k * 0.3 * c)));
    out[`${side}ThumbProximal` as ExtraBone] = toQuat(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, k * 0.5 * c, 0)));
    out[`${side}ThumbDistal` as ExtraBone] = toQuat(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, k * 0.6 * c, 0)));
  }
  return out;
}

/** Whether a bone is one of the extras (not the mannequin's own). */
export const isExtra = (b: Bone): b is ExtraBone => (EXTRA_BONES as readonly string[]).includes(b);
