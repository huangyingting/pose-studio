export type Vec3 = [number, number, number];

export const JOINTS = [
  'root', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR',
  'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR',
] as const;
export type JointName = (typeof JOINTS)[number];

export type Side = 'L' | 'R';

/** Finger order used by curl arrays. */
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type Curl = [number, number, number, number, number];

export interface Hand {
  /** 0 = straight, 1 = fully curled, per finger (thumb → pinky). */
  curl: Curl;
  /** 0 = together, 1 = fully spread. */
  spread: number;
}

export interface BodyParams {
  /** 0 = male, 1 = female; values in between blend proportions. */
  sex: number;
  /** Standing height in metres. */
  height: number;
  /** 0 = slim, 1 = heavy. */
  build: number;
  /** Relative head size. */
  head: number;
  /** Relative leg length. */
  legs: number;
  /** Chest volume (mainly visible on female figures). */
  bust: number;
}

export interface Figure {
  id: string;
  name: string;
  body: BodyParams;
  /** Euler rotations in degrees. root uses order YXZ, every other joint XZY. */
  joints: Partial<Record<JointName, Vec3>>;
  hands: Record<Side, Hand>;
  /** Root position. y is ignored while `grounded` is on (the figure rests on the floor). */
  position: Vec3;
  grounded: boolean;
  /** Hidden figures stay in the document but are not drawn or exported. */
  hidden?: boolean;
}

export const PROP_KINDS = ['box', 'sphere', 'cylinder', 'chair', 'stool', 'step', 'wall'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export interface Prop {
  id: string;
  kind: PropKind;
  position: Vec3;
  /** Degrees, XYZ order. */
  rotation: Vec3;
  scale: Vec3;
}

/** Camera for thumbnails and export. yaw 0 = front, pitch > 0 = from above. */
export interface View {
  yaw: number;
  pitch: number;
  fov: number;
}

export interface Scene {
  id: string;
  name: string;
  figures: Figure[];
  props: Prop[];
  view: View;
}

export interface Library {
  version: 2;
  scenes: Scene[];
}

export type Selection =
  | { kind: 'joint'; figure: string; joint: JointName }
  | { kind: 'prop'; prop: string }
  | null;

export const STYLES = ['line', 'shaded', 'silhouette'] as const;
export type Style = (typeof STYLES)[number];
export type GizmoMode = 'rotate' | 'translate' | 'scale';

/** Key light for the shaded style. azimuth 0 = from the front, elevation 90 = from above. */
export interface Light {
  azimuth: number;
  elevation: number;
  shadows: boolean;
}
