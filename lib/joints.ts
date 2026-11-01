import type { Bone, JointName, Side, Vec3 } from './types';

/** The parts of a limb, as in VRM bone names (`leftUpperArm`, `rightFoot`, …). */
type LimbPart = 'Shoulder' | 'UpperArm' | 'LowerArm' | 'Hand' | 'UpperLeg' | 'LowerLeg' | 'Foot' | 'Toes';

/** A limb's bone on one side: `sided('UpperArm', 'L')` is `leftUpperArm`. */
export const sided = (part: LimbPart, side: Side) => `${side === 'L' ? 'left' : 'right'}${part}` as JointName;

/** Which side a bone is on (null for the spine and head). */
export const sideOf = (j: JointName): Side | null => (j.startsWith('left') ? 'L' : j.startsWith('right') ? 'R' : null);

/** Which part of a limb a bone is (null for the spine and head). */
export const partOf = (j: JointName): LimbPart | null => (sideOf(j) ? (j.replace(/^(left|right)/, '') as LimbPart) : null);

/*
 * Rotation conventions (figure faces +Z, its left side is +X):
 *   root                    X+ pitch forward, Y+ turn to own left, Z+ lean to own right
 *   spine/chest/upper chest/neck/head   X+ bend forward, Y+ twist left, Z+ tilt right
 *   collarbone (shoulder)   Z raises it (a shrug: + for L, − for R), Y takes it forward (− for L, + for R), X rolls
 *   upper arm / hip         X− swing forward, X+ swing back, Z spreads out (+ for L, − for R), Y twists
 *   elbow X− bends · knee X+ bends · ankle X+ points the toes · toes X+ curl down, X− bend up
 */

export const JOINT_LABELS: Record<JointName, string> = {
  hips: 'Pelvis', spine: 'Waist', chest: 'Chest', upperChest: 'Upper chest', neck: 'Neck', head: 'Head',
  leftShoulder: 'Left shoulder', leftUpperArm: 'Left upper arm', leftLowerArm: 'Left forearm', leftHand: 'Left hand',
  rightShoulder: 'Right shoulder', rightUpperArm: 'Right upper arm', rightLowerArm: 'Right forearm', rightHand: 'Right hand',
  leftUpperLeg: 'Left thigh', leftLowerLeg: 'Left shin', leftFoot: 'Left foot', leftToes: 'Left toes',
  rightUpperLeg: 'Right thigh', rightLowerLeg: 'Right shin', rightFoot: 'Right foot', rightToes: 'Right toes',
};

export function axisLabels(j: JointName): [string, string, string] {
  if (j === 'hips') return ['Pitch (+ forward)', 'Turn (+ left)', 'Roll (+ right)'];
  if (j === 'spine' || j === 'chest' || j === 'upperChest' || j === 'neck' || j === 'head') return ['Bend (+ forward)', 'Twist (+ left)', 'Tilt (+ right)'];
  const out = sideOf(j) === 'L' ? '+' : '−';
  switch (partOf(j)) {
    case 'Shoulder': return ['Roll', `Forward (${sideOf(j) === 'L' ? '−' : '+'})`, `Raise (${out} up)`];
    case 'Toes': return ['Curl (+ down)', 'Twist', 'Side'];
    case 'UpperArm': return ['Swing (− forward)', 'Twist', `Raise (${out} out)`];
    case 'UpperLeg': return ['Swing (− forward)', 'Twist', `Spread (${out} out)`];
    case 'LowerArm': return ['Bend (−)', 'Twist', 'Side'];
    case 'LowerLeg': return ['Bend (+)', 'Twist', 'Side'];
    case 'Foot': return ['Point (+) / flex (−)', 'Twist', 'Roll'];
    // (A hand: with the palm to the thigh, its first turn bends it sideways, its last the palm.)
    default: return ['Side', 'Twist', 'Flex'];
  }
}

/** What turning each slider of a joint down (−) and up (+) does, in a word ('' where no word says it). */
export function axisEnds(j: JointName): [[string, string], [string, string], [string, string]] {
  if (j === 'hips' || j === 'spine' || j === 'chest' || j === 'upperChest' || j === 'neck' || j === 'head') return [['back', 'forward'], ['right', 'left'], ['left', 'right']];
  const out: [string, string] = sideOf(j) === 'L' ? ['in', 'out'] : ['out', 'in'];
  switch (partOf(j)) {
    case 'Shoulder': return [['', ''], sideOf(j) === 'L' ? ['forward', 'back'] : ['back', 'forward'], sideOf(j) === 'L' ? ['down', 'up'] : ['up', 'down']];
    case 'Toes': return [['up', 'down'], ['', ''], ['', '']];
    case 'UpperArm': case 'UpperLeg': return [['forward', 'back'], ['', ''], out];
    case 'LowerArm': return [['bend', 'straight'], ['', ''], ['', '']];
    case 'LowerLeg': return [['straight', 'bend'], ['', ''], ['', '']];
    case 'Foot': return [['flex', 'point'], ['', ''], ['', '']];
    default: return [['', ''], ['', ''], ['', '']];
  }
}

type Range = [number, number];
type Limits = [Range, Range, Range];

const FREE: Range = [-180, 180];
const sym = (a: number): Range => [-a, a];

/** Comfortable anatomical ranges for the left side; right-side ranges are mirrored. */
const LEFT_LIMITS: Partial<Record<JointName, Limits>> = {
  spine: [[-35, 50], sym(35), sym(30)],
  chest: [[-35, 45], sym(40), sym(30)],
  upperChest: [[-20, 25], sym(25), sym(20)],
  // (Down far enough for a captured shoulder's: a hanging arm's collarbone drops a little.)
  leftShoulder: [sym(15), sym(30), [-35, 40]],
  neck: [[-45, 55], sym(65), sym(40)],
  head: [[-45, 45], sym(55), sym(35)],
  leftUpperArm: [[-180, 75], sym(100), [-35, 180]],
  leftLowerArm: [[-155, 0], sym(90), sym(15)],
  leftHand: [[-85, 85], sym(40), sym(85)],
  leftUpperLeg: [[-155, 50], sym(75), [-40, 95]],
  leftLowerLeg: [[0, 165], sym(35), sym(8)],
  leftFoot: [[-45, 85], sym(35), sym(35)],
  leftToes: [[-60, 40], sym(10), sym(10)],
};

export function jointLimits(j: JointName): Limits {
  if (j === 'hips') return [FREE, FREE, FREE];
  const l = LEFT_LIMITS[sideOf(j) === 'R' ? mirrorJointName(j) : j]!;
  if (sideOf(j) !== 'R') return l;
  // Mirroring negates Y and Z.
  return [l[0], [-l[1][1], -l[1][0]], [-l[2][1], -l[2][0]]];
}

export function clampRotation(j: JointName, r: Vec3): Vec3 {
  const lim = jointLimits(j);
  return r.map((v, i) => Math.min(lim[i][1], Math.max(lim[i][0], v))) as Vec3;
}

export function mirrorJointName(j: JointName): JointName {
  return mirrorBone(j) as JointName;
}

/** The same bone on the other side (any bone of the skeleton). */
export const mirrorBone = (b: Bone): Bone => (b.startsWith('left') ? `right${b.slice(4)}` : b.startsWith('right') ? `left${b.slice(5)}` : b) as Bone;

/** Wrap an angle into (-180, 180]. */
export function wrapDeg(a: number) {
  // Leave in-range angles untouched (the modulo arithmetic below adds float noise).
  if (a > -180 && a <= 180) return a;
  const w = ((((a + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}
