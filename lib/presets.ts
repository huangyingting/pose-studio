import GALLERY from './gallery-poses.json';
import { HAND_PRESETS } from './hands';
import { bonesOf, type Angles, type Bones } from './pose';
import type { Hand, PoseAsset, View } from './types';

interface RawPose {
  name: string;
  description: string;
  view: View;
  joints: Angles;
}

const v = (yaw: number, pitch: number): View => ({ yaw, pitch, fov: 20 });

/** Approximations of the 20 poses in the original Pose.jpg sheet, in reading order. */
const RAW: RawPose[] = [
  {
    name: 'Hand on head',
    description: 'Standing with weight on the right leg, the left knee bent in with the heel raised. The left hand rests on top of the head, elbow out; the right hand on the right hip. The head tilts toward the raised arm.',
    view: v(0, 4), joints: {
      hips: [0, 0, -4], spine: [0, -4, 3], chest: [0, -6, -4], neck: [0, 0, -4], head: [6, 8, -8],
      leftUpperArm: [-25, 52, 134], leftLowerArm: [-114, 90, 0], leftHand: [-18, 4, -40], rightUpperArm: [26, 39, -62], rightLowerArm: [-131, -55, 0], rightHand: [19, 0, -45],
      leftUpperLeg: [-14, -12, 2], leftLowerLeg: [51, 0, 0], leftFoot: [38, 0, 0], rightUpperLeg: [1, 0, -5], rightLowerLeg: [2, 0, 0], rightFoot: [0, 0, 4],
    },
  },
  {
    name: 'Hands behind head',
    description: 'Standing with feet slightly apart and weight even. Both hands are clasped behind the head with the elbows wide; the chest lifts a little.',
    view: v(0, 4), joints: {
      chest: [-5, 0, 0], head: [-5, 0, 0],
      leftUpperArm: [-22, 87, 136], leftLowerArm: [-142, -2, 0], leftHand: [20, 0, 0], rightUpperArm: [-22, -87, -136], rightLowerArm: [-142, 3, 0], rightHand: [20, 0, 0],
      leftUpperLeg: [0, 0, 5], rightUpperLeg: [0, 0, -5],
    },
  },
  {
    name: 'Back view, hand on hip',
    description: 'Seen from behind: standing with weight on the right leg, the left knee relaxed. The right hand is on the right hip; the left arm hangs. The upper body and head turn to look back over the left shoulder.',
    view: v(180, 4), joints: {
      hips: [0, 0, -3], chest: [0, 15, 0], neck: [0, 10, 0], head: [5, 35, -5],
      leftUpperArm: [5, 0, 12], leftLowerArm: [-8, 0, 0], rightUpperArm: [19, 65, -74], rightLowerArm: [-135, -57, 0], rightHand: [12, 0, -45],
      leftUpperLeg: [-8, -10, 6], leftLowerLeg: [45, 0, 0], leftFoot: [20, 0, 0], rightUpperLeg: [1, 0, -5], rightFoot: [0, 0, 3],
    },
  },
  {
    name: 'Leaning, hands on knees',
    description: 'Feet apart, knees slightly bent, hips pushed back. The torso leans forward with a flat back, both hands resting on the knees, the head up looking ahead.',
    view: v(0, 4), joints: {
      hips: [25, 0, 0], spine: [8, 0, 0], chest: [5, 0, 0], neck: [-15, 0, 0], head: [-20, 0, 0],
      leftUpperArm: [-28, -15, 3], leftLowerArm: [-7, 0, 0], leftHand: [4, 0, 0], rightUpperArm: [-28, 16, -3], rightLowerArm: [-7, 0, 0], rightHand: [4, 0, 0],
      leftUpperLeg: [-32, 0, 12], leftLowerLeg: [18, 0, 0], leftFoot: [-11, 0, 0], rightUpperLeg: [-32, 0, -12], rightLowerLeg: [18, 0, 0], rightFoot: [-11, 0, 0],
    },
  },
  {
    name: 'Side sit, leaning on arm',
    description: "Sitting on the floor with both legs folded to the figure's left. The torso leans right onto the straight right arm, palm on the floor; the left hand rests on the thigh.",
    view: v(0, 8), joints: {
      hips: [0, 20, 8], spine: [0, 0, 6], chest: [0, -10, 4], head: [0, -20, -8],
      leftUpperArm: [-24, -68, 21], leftLowerArm: [-65, 0, 0], leftHand: [32, 0, 0], rightUpperArm: [43, -8, -51], rightLowerArm: [-5, 25, 0], rightHand: [-24, -1, -45],
      leftUpperLeg: [-91, -67, 9], leftLowerLeg: [137, 0, 0], leftFoot: [45, 0, 0], rightUpperLeg: [-84, -75, -5], rightLowerLeg: [140, 0, 0], rightFoot: [45, 0, 0],
    },
  },
  {
    name: 'Kneeling, hands on knees',
    description: 'Kneeling and sitting back on the heels, knees slightly apart, back straight. Both hands rest on the knees.',
    view: v(0, 15), joints: {
      head: [5, 0, 0],
      leftUpperArm: [-43, -29, 2], leftLowerArm: [-7, 0, 0], leftHand: [4, 0, 0], rightUpperArm: [-43, 29, -2], rightLowerArm: [-7, 0, 0], rightHand: [4, 0, 0],
      leftUpperLeg: [-78, 0, 8], leftLowerLeg: [160, 0, 0], leftFoot: [72, 0, 0], rightUpperLeg: [-78, 0, -8], rightLowerLeg: [160, 0, 0], rightFoot: [72, 0, 0],
    },
  },
  {
    name: 'Kneeling, hands behind head',
    description: 'Kneeling upright on both knees, the thighs vertical. Both hands are clasped behind the head, elbows wide.',
    view: v(0, 6), joints: {
      hips: [0, 0, -4], spine: [0, 0, -6], chest: [0, 0, 6], head: [-5, 0, -5],
      leftUpperArm: [-22, 87, 135], leftLowerArm: [-143, -1, 0], leftHand: [20, 0, 0], rightUpperArm: [-22, -87, -137], rightLowerArm: [-141, -59, 0], rightHand: [16, 0, -28],
      leftUpperLeg: [-5, 0, 12], leftLowerLeg: [95, 0, 0], leftFoot: [75, 0, 0], rightUpperLeg: [-5, 0, -12], rightLowerLeg: [95, 0, 0], rightFoot: [75, 0, 0],
    },
  },
  {
    name: 'Crouch, hands on floor',
    description: 'Crouching low with the right knee forward and the left knee lower, leaning forward. Both arms reach down with the hands on the floor in front; the head looks ahead.',
    view: v(0, 10), joints: {
      hips: [55, 0, 0], spine: [18, 0, 0], chest: [10, 0, 0], neck: [-45, 0, 0], head: [-40, 0, 0],
      leftUpperArm: [-102, -3, 3], leftLowerArm: [-10, -85, 0], leftHand: [-7, -6, 45], rightUpperArm: [-102, 3, -2], rightLowerArm: [-10, 85, 0], rightHand: [-7, 6, -45],
      leftUpperLeg: [-98, 0, 12], leftLowerLeg: [146, 0, 0], leftFoot: [-20, 0, 0], rightUpperLeg: [-135, 0, -15], rightLowerLeg: [150, 0, 0], rightFoot: [-45, 0, 0],
    },
  },
  {
    name: 'Lying, head propped',
    description: 'Lying on the left side, propped on the left elbow with the head resting on the left hand. The top (right) knee is bent forward over the lower leg; the right hand rests in front.',
    view: v(0, 15), joints: {
      hips: [0, 0, -90], spine: [0, 0, 22], chest: [0, 0, 22], neck: [0, 0, -15], head: [0, 0, -15],
      leftUpperArm: [-53, 11, 68], leftLowerArm: [-149, 0, 0], rightUpperArm: [-35, -14, 35], rightLowerArm: [-25, 80, 0], rightHand: [6, -1, -38],
      leftUpperLeg: [-15, 0, 0], leftLowerLeg: [20, 0, 0], leftFoot: [20, 0, 0], rightUpperLeg: [-75, 0, -5], rightLowerLeg: [95, 0, 0], rightFoot: [20, 0, 0],
    },
  },
  {
    name: 'Prone, chin in hands',
    description: 'Lying on the stomach propped on both elbows, the chin resting in the hands. Both knees bend so the feet point up behind.',
    view: v(0, 25), joints: {
      hips: [90, 0, 0], spine: [-7, 0, 0], chest: [-25, 0, 0], neck: [-20, 0, 0], head: [-25, 0, 0],
      leftUpperArm: [-82, -23, -11], leftLowerArm: [-139, 14, 0], leftHand: [0, 0, 12], rightUpperArm: [-82, 23, 11], rightLowerArm: [-139, -14, 0], rightHand: [0, 0, -12],
      leftUpperLeg: [0, 0, 6], leftLowerLeg: [100, 0, 0], leftFoot: [30, 0, 0], rightUpperLeg: [0, 0, -6], rightLowerLeg: [100, 0, 0], rightFoot: [30, 0, 0],
    },
  },
  {
    name: 'Cobra',
    description: 'Lying face down, legs straight together behind. Both arms push the chest up off the floor into a backbend, the hips staying down; the head looks forward and up.',
    view: v(30, 5), joints: {
      hips: [88, 90, 0], spine: [-35, 0, 0], chest: [-35, 0, 0], neck: [-10, 0, 0], head: [-15, 0, 0],
      leftUpperArm: [37, -11, 19], leftLowerArm: [-110, -75, 0], leftHand: [17, 0, 38], rightUpperArm: [36, 11, -19], rightLowerArm: [-110, 75, 0], rightHand: [17, 0, -38],
      leftUpperLeg: [0, 0, 3], leftLowerLeg: [3, 0, 0], leftFoot: [60, 0, 0], rightUpperLeg: [0, 0, -3], rightLowerLeg: [3, 0, 0], rightFoot: [60, 0, 0],
    },
  },
  {
    name: 'Sitting, knees up',
    description: 'Sitting on the floor with both knees bent up and apart, feet flat. The arms hang down behind, hands on the floor beside the hips.',
    view: v(0, 12), joints: {
      hips: [-10, 0, 0],
      leftUpperArm: [51, 4, 11], leftLowerArm: [-5, 0, 0], leftHand: [-14, 9, 45], rightUpperArm: [51, -4, -11], rightLowerArm: [-5, 0, 0], rightHand: [-14, -9, -45],
      leftUpperLeg: [-128, 0, 28], leftLowerLeg: [93, 0, 0], leftFoot: [41, 0, 0], rightUpperLeg: [-128, 0, -28], rightLowerLeg: [93, 0, 0], rightFoot: [41, 0, 0],
    },
  },
  {
    name: 'Deep squat',
    description: 'Squatting as low as possible on flat feet, knees spread wide. The forearms rest on the knees, hands hanging between them; the head up.',
    view: v(0, 8), joints: {
      hips: [15, 0, 0], spine: [8, 0, 0], neck: [-10, 0, 0], head: [-15, 0, 0],
      leftUpperArm: [-42, -42, 8], leftLowerArm: [-48, 0, 0], leftHand: [24, 0, 0], rightUpperArm: [-42, 42, -7], rightLowerArm: [-48, 0, 0], rightHand: [24, 0, 0],
      leftUpperLeg: [-125, 0, 32], leftLowerLeg: [149, 0, 0], leftFoot: [-42, 0, 0], rightUpperLeg: [-125, 0, -32], rightLowerLeg: [149, 0, 0], rightFoot: [-42, 0, 0],
    },
  },
  {
    name: 'Sitting, legs wide',
    description: 'Sitting on the floor with both legs straight and spread in a wide V. The torso leans back a little on both hands placed behind the hips.',
    view: v(0, 35), joints: {
      hips: [-22, 0, 0], spine: [8, 0, 0], head: [10, 0, 0],
      leftUpperArm: [52, 3, 8], leftLowerArm: [-5, 45, 0], leftHand: [-8, 5, 45], rightUpperArm: [52, -3, -8], rightLowerArm: [-5, -45, 0], rightHand: [-8, -5, -45],
      leftUpperLeg: [-70, 0, 32], leftFoot: [20, 0, 0], rightUpperLeg: [-70, 0, -32], rightFoot: [20, 0, 0],
    },
  },
  {
    name: 'Table-top',
    description: 'Facing up, the body held level like a table: hands on the floor under the shoulders, feet flat under the knees, knees bent at 90°, the hips lifted in line with the chest; the head looks up.',
    view: v(70, 10), joints: {
      hips: [-90, 0, 0],
      leftUpperArm: [52, 12, 25], leftLowerArm: [-3, -90, 0], leftHand: [-35, -13, 43], rightUpperArm: [52, -12, -25], rightLowerArm: [-3, 90, 0], rightHand: [-35, 14, -43],
      leftUpperLeg: [0, 0, 8], leftLowerLeg: [90, 0, 0], leftFoot: [0, -8, 0], rightUpperLeg: [0, 0, -8], rightLowerLeg: [90, 0, 0], rightFoot: [0, 8, 0],
    },
  },
  {
    name: 'Standing, hugging knee',
    description: 'Standing on the right leg. The left knee is pulled up to the chest and hugged with both arms; the back stays straight.',
    view: v(0, 4), joints: {
      hips: [0, -15, 0], chest: [8, 0, 0], head: [8, 0, 0],
      leftUpperArm: [-37, -26, 16], leftLowerArm: [-58, 0, 0], leftHand: [29, 0, 0], rightUpperArm: [-60, 63, 12], rightLowerArm: [-20, 0, 0], rightHand: [10, 0, 0],
      leftUpperLeg: [-128, 0, 5], leftLowerLeg: [125, 0, 0], leftFoot: [30, 0, 0], rightUpperLeg: [0, 0, -3],
    },
  },
  {
    name: 'Kneeling wide, sitting back',
    description: 'Kneeling with the knees spread wide and the hips sitting back toward the heels, torso upright. The arms hang down in front, hands near the thighs.',
    view: v(0, 10), joints: {
      hips: [-5, 0, 0], head: [-10, 0, 0],
      leftUpperArm: [-26, -47, 8], leftLowerArm: [-7, 0, 0], leftHand: [4, 0, 0], rightUpperArm: [-25, 11, -6], rightLowerArm: [-7, 0, 0], rightHand: [4, 0, 0],
      leftUpperLeg: [-43, 0, 24], leftLowerLeg: [135, 0, 0], leftFoot: [72, 0, 0], rightUpperLeg: [-43, 0, -24], rightLowerLeg: [135, 0, 0], rightFoot: [72, 0, 0],
    },
  },
  {
    name: 'Lying, leg raised',
    description: 'Lying on the back with both arms stretched up over the head along the floor. The left leg is raised straight up toward the ceiling; the right knee is bent with the foot on the floor.',
    view: v(0, 15), joints: {
      hips: [-90, 90, 0], spine: [-5, 0, 0], head: [10, 0, 0],
      leftUpperArm: [-170, 0, 15], rightUpperArm: [-170, 0, -15],
      leftUpperLeg: [-90, 0, 0], leftFoot: [40, 0, 0], rightUpperLeg: [-43, 0, 0], rightLowerLeg: [100, 0, 0],
    },
  },
  {
    name: 'Sitting, holding leg up',
    description: 'Sitting on the floor with the right leg folded in front. The left leg is raised straight up and held at the ankle with the left hand; the right hand props on the floor behind.',
    view: v(0, 8), joints: {
      hips: [-10, 0, 0], spine: [5, 0, 0], head: [-10, 15, 0],
      leftUpperArm: [24, 28, 171], leftLowerArm: [-67, 0, 0], leftHand: [33, 0, 0], rightUpperArm: [45, -3, -10], rightLowerArm: [-5, 0, 0], rightHand: [-11, -11, -45],
      leftUpperLeg: [-152, 0, 0], leftFoot: [30, 0, 0], rightUpperLeg: [-97, -65, -56], rightLowerLeg: [143, 0, 0], rightFoot: [40, 0, 0],
    },
  },
  {
    name: 'Lunge, pushing',
    description: 'A deep forward lunge on the left foot, the right leg straight behind, as if pushing something. Both arms stretch forward at shoulder height, palms out; the body leans into the push.',
    view: v(0, 4), joints: {
      hips: [0, 60, 0], spine: [10, 0, 0], chest: [10, 0, 0],
      leftUpperArm: [-113, 0, 0], leftLowerArm: [-8, 0, 0], rightUpperArm: [-113, 0, 0], rightLowerArm: [-8, 0, 0],
      leftUpperLeg: [-50, 0, 5], leftLowerLeg: [76, 0, 0], leftFoot: [-26, 0, 0], rightUpperLeg: [45, 0, -5], rightLowerLeg: [5, 0, 0], rightFoot: [5, 0, 0],
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

/** Groups of the pose library, by what the body rests on (and the stretches: bridges, splits). */
export const POSE_GROUPS = ['Standing', 'Sitting & squatting', 'Kneeling & all fours', 'Lying', 'Stretches & bends'] as const;
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

/** The reference poses (from the drawing reference sheet), with stable ids. */
export const BUILT_IN_POSES: (PoseAsset & { group: PoseGroup })[] = RAW.map((p, i) => {
  const [l, r] = HAND_HINTS[p.name] ?? ['Relaxed', 'Relaxed'];
  return { id: `preset${i + 1}`, name: p.name, description: p.description, bones: bonesOf(p.joints), hands: { L: hand(l), R: hand(r) }, view: p.view, group: GROUP[p.name] };
});

/**
 * The gallery poses: full-body pose drawings made library poses (scripts/poses/gallery.ts), each
 * in its group, its hands relaxed.
 */
export const GALLERY_POSES: (PoseAsset & { group: PoseGroup })[] = (GALLERY as { id: string; name: string; description: string; group: PoseGroup; bones: Bones; view: View }[]).map((p) => ({
  ...p, hands: { L: hand('Relaxed'), R: hand('Relaxed') },
}));
