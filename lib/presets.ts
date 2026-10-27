import { HAND_PRESETS } from './hands';
import { bonesOf, type Angles } from './pose';
import type { Hand, PoseAsset, View } from './types';

interface RawPose {
  name: string;
  view: View;
  joints: Angles;
}

const v = (yaw: number, pitch: number): View => ({ yaw, pitch, fov: 20 });

/** Approximations of the 20 poses in the original Pose.jpg sheet, in reading order. */
const RAW: RawPose[] = [
  {
    name: 'Hand on head', view: v(0, 4), joints: {
      hips: [0, 0, -3], spine: [0, -4, 3], chest: [0, -6, -6], neck: [0, 0, 4], head: [6, 8, 10],
      leftUpperArm: [-10, 90, 150], leftLowerArm: [-135, 0, 0], rightUpperArm: [10, 90, -40], rightLowerArm: [-100, 0, 0],
      leftUpperLeg: [-12, -10, 4], leftLowerLeg: [22, 0, 0], leftFoot: [35, 0, 0], rightUpperLeg: [2, 0, -7], rightLowerLeg: [3, 0, 0],
    },
  },
  {
    name: 'Hands behind head', view: v(0, 4), joints: {
      chest: [-5, 0, 0], head: [-5, 0, 0],
      leftUpperArm: [5, 90, 145], leftLowerArm: [-150, 0, 0], rightUpperArm: [5, -90, -145], rightLowerArm: [-150, 0, 0],
      leftUpperLeg: [0, 0, 5], rightUpperLeg: [0, 0, -5],
    },
  },
  {
    name: 'Back view, hand on hip', view: v(180, 4), joints: {
      hips: [0, 0, -3], chest: [0, 15, 0], neck: [0, 10, 0], head: [5, 35, -5],
      rightUpperArm: [10, 90, -40], rightLowerArm: [-100, 0, 0], leftUpperArm: [5, 0, 12], leftLowerArm: [-8, 0, 0],
      leftUpperLeg: [-8, -10, 8], leftLowerLeg: [18, 0, 0], leftFoot: [30, 0, 0], rightUpperLeg: [2, 0, -6],
    },
  },
  {
    name: 'Leaning, hands on knees', view: v(0, 4), joints: {
      hips: [25, 0, 0], spine: [8, 0, 0], chest: [5, 0, 0], neck: [-15, 0, 0], head: [-20, 0, 0],
      leftUpperArm: [-40, 0, 10], leftLowerArm: [-10, 0, 0], rightUpperArm: [-40, 0, -10], rightLowerArm: [-10, 0, 0],
      leftUpperLeg: [-32, 0, 12], leftLowerLeg: [18, 0, 0], leftFoot: [-11, 0, 0], rightUpperLeg: [-32, 0, -12], rightLowerLeg: [18, 0, 0], rightFoot: [-11, 0, 0],
    },
  },
  {
    name: 'Side sit, leaning on arm', view: v(0, 8), joints: {
      hips: [0, 20, 8], spine: [0, 0, 6], chest: [0, -10, 4], head: [0, -20, -8],
      rightUpperArm: [0, 0, -30], leftUpperArm: [-30, 0, 10], leftLowerArm: [-50, 0, 0],
      leftUpperLeg: [-85, -60, 10], leftLowerLeg: [140, 0, 0], leftFoot: [40, 0, 0], rightUpperLeg: [-75, -70, -5], rightLowerLeg: [150, 0, 0], rightFoot: [40, 0, 0],
    },
  },
  {
    name: 'Kneeling, hands on knees', view: v(0, 15), joints: {
      head: [5, 0, 0],
      leftUpperArm: [-25, 0, 12], leftLowerArm: [-25, 0, 0], rightUpperArm: [-25, 0, -12], rightLowerArm: [-25, 0, 0],
      leftUpperLeg: [-35, 0, 10], leftLowerLeg: [125, 0, 0], leftFoot: [70, 0, 0], rightUpperLeg: [-35, 0, -10], rightLowerLeg: [125, 0, 0], rightFoot: [70, 0, 0],
    },
  },
  {
    name: 'Kneeling, hands behind head', view: v(0, 6), joints: {
      hips: [0, 0, -4], spine: [0, 0, -6], chest: [0, 0, 6], head: [-5, 0, -5],
      leftUpperArm: [5, 90, 145], leftLowerArm: [-150, 0, 0], rightUpperArm: [5, -90, -145], rightLowerArm: [-150, 0, 0],
      leftUpperLeg: [-5, 0, 12], leftLowerLeg: [95, 0, 0], leftFoot: [75, 0, 0], rightUpperLeg: [-5, 0, -12], rightLowerLeg: [95, 0, 0], rightFoot: [75, 0, 0],
    },
  },
  {
    name: 'Crouch, hands on floor', view: v(0, 10), joints: {
      hips: [35, 0, 0], spine: [10, 0, 0], neck: [-25, 0, 0], head: [-25, 0, 0],
      leftUpperArm: [-65, 0, 18], rightUpperArm: [-65, 0, -18],
      leftUpperLeg: [-95, 0, 18], leftLowerLeg: [140, 0, 0], leftFoot: [-10, 0, 0], rightUpperLeg: [-60, 0, -15], rightLowerLeg: [125, 0, 0], rightFoot: [40, 0, 0],
    },
  },
  {
    name: 'Lying, head propped', view: v(0, 15), joints: {
      hips: [-35, 0, 90], spine: [0, 0, -10], chest: [0, 0, -10], neck: [0, 0, -10],
      rightUpperArm: [-30, 0, -160], rightLowerArm: [-130, 0, 0], leftUpperArm: [-10, -90, 40], leftLowerArm: [-100, 0, 0],
      leftUpperLeg: [-70, 0, 0], leftLowerLeg: [100, 0, 0], rightUpperLeg: [-15, 0, 0], rightLowerLeg: [30, 0, 0],
    },
  },
  {
    name: 'Prone, chin in hands', view: v(0, 25), joints: {
      hips: [90, 0, 0], spine: [-25, 0, 0], chest: [-25, 0, 0], neck: [-20, 0, 0], head: [-25, 0, 0],
      leftUpperArm: [-60, 0, 15], leftLowerArm: [-120, 0, 0], rightUpperArm: [-60, 0, -15], rightLowerArm: [-120, 0, 0],
      leftUpperLeg: [0, 0, 6], leftLowerLeg: [100, 0, 0], leftFoot: [30, 0, 0], rightUpperLeg: [0, 0, -6], rightLowerLeg: [100, 0, 0], rightFoot: [30, 0, 0],
    },
  },
  {
    name: 'Cobra', view: v(30, 5), joints: {
      hips: [90, 90, 0], spine: [-30, 0, 0], chest: [-30, 0, 0], neck: [-10, 0, 0], head: [-15, 0, 0],
      leftUpperArm: [-40, 0, 8], leftLowerArm: [-5, 0, 0], rightUpperArm: [-40, 0, -8], rightLowerArm: [-5, 0, 0],
      leftUpperLeg: [0, 0, 3], leftLowerLeg: [5, 0, 0], leftFoot: [60, 0, 0], rightUpperLeg: [0, 0, -3], rightLowerLeg: [5, 0, 0], rightFoot: [60, 0, 0],
    },
  },
  {
    name: 'Sitting, knees up', view: v(0, 12), joints: {
      hips: [-10, 0, 0],
      leftUpperArm: [25, 0, 25], rightUpperArm: [25, 0, -25],
      leftUpperLeg: [-110, 0, 38], leftLowerLeg: [115, 0, 0], rightUpperLeg: [-110, 0, -38], rightLowerLeg: [115, 0, 0],
    },
  },
  {
    name: 'Deep squat', view: v(0, 8), joints: {
      hips: [15, 0, 0], spine: [5, 0, 0], head: [-15, 0, 0],
      leftUpperArm: [-35, 0, 28], leftLowerArm: [-45, 0, 0], rightUpperArm: [-35, 0, -28], rightLowerArm: [-45, 0, 0],
      leftUpperLeg: [-115, 0, 32], leftLowerLeg: [145, 0, 0], leftFoot: [-25, 0, 0], rightUpperLeg: [-115, 0, -32], rightLowerLeg: [145, 0, 0], rightFoot: [-25, 0, 0],
    },
  },
  {
    name: 'Sitting, legs wide', view: v(0, 35), joints: {
      hips: [-28, 0, 0], spine: [8, 0, 0], head: [10, 0, 0],
      leftUpperArm: [30, 0, 30], rightUpperArm: [30, 0, -30],
      leftUpperLeg: [-62, 0, 32], leftFoot: [20, 0, 0], rightUpperLeg: [-62, 0, -32], rightFoot: [20, 0, 0],
    },
  },
  {
    name: 'Table-top', view: v(70, 10), joints: {
      hips: [-68, 0, 0], neck: [-20, 0, 0], head: [-20, 0, 0],
      leftUpperArm: [68, 0, 10], rightUpperArm: [68, 0, -10],
      leftUpperLeg: [-22, 0, 8], leftLowerLeg: [90, 0, 0], rightUpperLeg: [-22, 0, -8], rightLowerLeg: [90, 0, 0],
    },
  },
  {
    name: 'Standing, hugging knee', view: v(0, 4), joints: {
      hips: [0, -15, 0], chest: [12, 0, 0], head: [8, 0, 0],
      leftUpperArm: [-50, 0, 5], leftLowerArm: [-80, 0, 0], rightUpperArm: [-45, 0, -5], rightLowerArm: [-90, 0, 0],
      leftUpperLeg: [-105, 0, 5], leftLowerLeg: [125, 0, 0], leftFoot: [30, 0, 0], rightUpperLeg: [0, 0, -3],
    },
  },
  {
    name: 'Kneeling wide, sitting back', view: v(0, 10), joints: {
      hips: [-5, 0, 0], head: [-15, 0, 0],
      leftUpperArm: [-20, 0, 15], leftLowerArm: [-20, 0, 0], rightUpperArm: [-20, 0, -15], rightLowerArm: [-20, 0, 0],
      leftUpperLeg: [-25, 0, 22], leftLowerLeg: [140, 0, 0], leftFoot: [70, 0, 0], rightUpperLeg: [-25, 0, -22], rightLowerLeg: [140, 0, 0], rightFoot: [70, 0, 0],
    },
  },
  {
    name: 'Lying, leg raised', view: v(0, 15), joints: {
      hips: [-90, 0, 90], spine: [-5, 0, 0], head: [10, 0, 0],
      leftUpperArm: [-170, 0, 15], rightUpperArm: [-170, 0, -15],
      leftUpperLeg: [-90, 0, 0], leftFoot: [40, 0, 0], rightUpperLeg: [-50, 0, 0], rightLowerLeg: [100, 0, 0],
    },
  },
  {
    name: 'Sitting, holding leg up', view: v(0, 8), joints: {
      hips: [-15, 0, 0], spine: [5, 0, 0], head: [0, 15, 0],
      leftUpperArm: [-150, 0, 8], leftLowerArm: [-20, 0, 0], rightUpperArm: [25, 0, -30],
      leftUpperLeg: [-150, 0, 8], leftFoot: [40, 0, 0], rightUpperLeg: [-80, -70, -15], rightLowerLeg: [140, 0, 0],
    },
  },
  {
    name: 'Lunge, pushing', view: v(0, 4), joints: {
      hips: [0, 60, 0], spine: [10, 0, 0], chest: [10, 0, 0],
      leftUpperArm: [-80, 0, 5], leftLowerArm: [-8, 0, 0], rightUpperArm: [-80, 0, -5], rightLowerArm: [-8, 0, 0],
      leftUpperLeg: [-45, 0, 5], leftLowerLeg: [55, 0, 0], leftFoot: [-10, 0, 0], rightUpperLeg: [20, 0, -5], rightLowerLeg: [15, 0, 0], rightFoot: [10, 0, 0],
    },
  },
];

const HAND_HINTS: Record<string, [string, string]> = {
  'Leaning, hands on knees': ['Grip', 'Grip'],
  'Kneeling, hands on knees': ['Grip', 'Grip'],
  'Crouch, hands on floor': ['Open', 'Open'],
  'Side sit, leaning on arm': ['Relaxed', 'Open'],
  'Prone, chin in hands': ['Grip', 'Grip'],
  'Cobra': ['Flat', 'Flat'],
  'Sitting, knees up': ['Open', 'Open'],
  'Deep squat': ['Grip', 'Grip'],
  'Sitting, legs wide': ['Open', 'Open'],
  'Table-top': ['Open', 'Open'],
  'Standing, hugging knee': ['Grip', 'Grip'],
  'Sitting, holding leg up': ['Grip', 'Open'],
  'Lunge, pushing': ['Open', 'Open'],
};

const hand = (name: string): Hand => {
  const h = (HAND_PRESETS.find((p) => p.name === name) ?? HAND_PRESETS[0]).hand;
  return { curl: [...h.curl] as Hand['curl'], spread: h.spread };
};

/** Groups of the pose library, by what the body rests on. */
export const POSE_GROUPS = ['Standing', 'Sitting & squatting', 'Kneeling & all fours', 'Lying'] as const;
export type PoseGroup = (typeof POSE_GROUPS)[number];

const GROUP: Record<string, PoseGroup> = {
  'Hand on head': 'Standing', 'Hands behind head': 'Standing', 'Back view, hand on hip': 'Standing', 'Leaning, hands on knees': 'Standing',
  'Standing, hugging knee': 'Standing', 'Lunge, pushing': 'Standing',
  'Side sit, leaning on arm': 'Sitting & squatting', 'Crouch, hands on floor': 'Sitting & squatting', 'Sitting, knees up': 'Sitting & squatting',
  'Deep squat': 'Sitting & squatting', 'Sitting, legs wide': 'Sitting & squatting', 'Sitting, holding leg up': 'Sitting & squatting',
  'Kneeling, hands on knees': 'Kneeling & all fours', 'Kneeling, hands behind head': 'Kneeling & all fours', 'Table-top': 'Kneeling & all fours',
  'Kneeling wide, sitting back': 'Kneeling & all fours',
  'Lying, head propped': 'Lying', 'Prone, chin in hands': 'Lying', 'Cobra': 'Lying', 'Lying, leg raised': 'Lying',
};

/** The built-in poses (from the drawing reference sheet), with stable ids. */
export const BUILT_IN_POSES: (PoseAsset & { group: PoseGroup })[] = RAW.map((p, i) => {
  const [l, r] = HAND_HINTS[p.name] ?? ['Relaxed', 'Relaxed'];
  return { id: `preset${i + 1}`, name: p.name, bones: bonesOf(p.joints), hands: { L: hand(l), R: hand(r) }, view: p.view, group: GROUP[p.name] };
});
