import type { JointName, Vec3 } from './types';

/*
 * Rotation conventions (figure faces +Z, its left side is +X):
 *   root                    X+ pitch forward, Y+ turn to own left, Z+ lean to own right
 *   spine/chest/neck/head   X+ bend forward, Y+ twist left, Z+ tilt right
 *   shoulder / hip          X− swing forward, X+ swing back, Z spreads out (+ for L, − for R), Y twists
 *   elbow X− bends · knee X+ bends · ankle X+ points the toes
 */

export const JOINT_LABELS: Record<JointName, string> = {
  root: 'Pelvis', spine: 'Waist', chest: 'Chest', neck: 'Neck', head: 'Head',
  shoulderL: 'Left upper arm', elbowL: 'Left forearm', wristL: 'Left hand',
  shoulderR: 'Right upper arm', elbowR: 'Right forearm', wristR: 'Right hand',
  hipL: 'Left thigh', kneeL: 'Left shin', ankleL: 'Left foot',
  hipR: 'Right thigh', kneeR: 'Right shin', ankleR: 'Right foot',
};

export const SHORT_LABELS: Record<JointName, string> = {
  root: 'Pelvis', spine: 'Waist', chest: 'Chest', neck: 'Neck', head: 'Head',
  shoulderL: 'L arm', elbowL: 'L forearm', wristL: 'L hand',
  shoulderR: 'R arm', elbowR: 'R forearm', wristR: 'R hand',
  hipL: 'L thigh', kneeL: 'L shin', ankleL: 'L foot',
  hipR: 'R thigh', kneeR: 'R shin', ankleR: 'R foot',
};

export function axisLabels(j: JointName): [string, string, string] {
  if (j === 'root') return ['Pitch (+ forward)', 'Turn (+ left)', 'Roll (+ right)'];
  if (j === 'spine' || j === 'chest' || j === 'neck' || j === 'head') return ['Bend (+ forward)', 'Twist (+ left)', 'Tilt (+ right)'];
  const out = j.endsWith('L') ? '+' : '−';
  if (j.startsWith('shoulder')) return ['Swing (− forward)', 'Twist', `Raise (${out} out)`];
  if (j.startsWith('hip')) return ['Swing (− forward)', 'Twist', `Spread (${out} out)`];
  if (j.startsWith('elbow')) return ['Bend (−)', 'Twist', 'Side'];
  if (j.startsWith('knee')) return ['Bend (+)', 'Twist', 'Side'];
  if (j.startsWith('ankle')) return ['Point (+) / flex (−)', 'Twist', 'Roll'];
  return ['Flex', 'Twist', 'Side'];
}

type Range = [number, number];
type Limits = [Range, Range, Range];

const FREE: Range = [-180, 180];
const sym = (a: number): Range => [-a, a];

/** Comfortable anatomical ranges for the left side; right-side ranges are mirrored. */
const LEFT_LIMITS: Partial<Record<JointName, Limits>> = {
  spine: [[-35, 50], sym(35), sym(30)],
  chest: [[-35, 45], sym(40), sym(30)],
  neck: [[-45, 55], sym(65), sym(40)],
  head: [[-45, 45], sym(55), sym(35)],
  shoulderL: [[-180, 75], sym(100), [-35, 180]],
  elbowL: [[-155, 0], sym(90), sym(15)],
  wristL: [[-85, 85], sym(40), sym(45)],
  hipL: [[-155, 50], sym(75), [-40, 95]],
  kneeL: [[0, 160], sym(35), sym(8)],
  ankleL: [[-45, 85], sym(35), sym(35)],
};

export function jointLimits(j: JointName): Limits {
  if (j === 'root') return [FREE, FREE, FREE];
  const left = (j.endsWith('R') ? j.slice(0, -1) + 'L' : j) as JointName;
  const l = LEFT_LIMITS[left]!;
  if (!j.endsWith('R')) return l;
  // Mirroring negates Y and Z.
  return [l[0], [-l[1][1], -l[1][0]], [-l[2][1], -l[2][0]]];
}

export function clampRotation(j: JointName, r: Vec3): Vec3 {
  const lim = jointLimits(j);
  return r.map((v, i) => Math.min(lim[i][1], Math.max(lim[i][0], v))) as Vec3;
}

export function mirrorJointName(j: JointName): JointName {
  if (j.endsWith('L')) return (j.slice(0, -1) + 'R') as JointName;
  if (j.endsWith('R')) return (j.slice(0, -1) + 'L') as JointName;
  return j;
}

/** Wrap an angle into (-180, 180]. */
export function wrapDeg(a: number) {
  // Leave in-range angles untouched (the modulo arithmetic below adds float noise).
  if (a > -180 && a <= 180) return a;
  const w = ((((a + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}
