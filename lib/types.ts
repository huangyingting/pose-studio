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
  /** A capsule stand-in for blocking (no joints to pose), in the given posture. */
  proxy?: Posture;
  /** Keeps its eyes on another figure or a prop: the head and neck turn to it, all the time. */
  gaze?: { figure: string } | { prop: string };
  /** A tint to tell figures apart (teams, sides), as a CSS colour. */
  color?: string;
}

/** Tints for telling figures apart. */
export const FIGURE_COLORS = ['#e5484d', '#3b6cff', '#30a46c', '#f59e0b', '#8b5cf6', '#14b8a6'] as const;

export const POSTURES = ['stand', 'sit', 'lie'] as const;
export type Posture = (typeof POSTURES)[number];

export const PROP_KINDS = ['box', 'sphere', 'cylinder', 'chair', 'stool', 'step', 'wall', 'stick', 'phone', 'cup', 'book'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export const PROP_LABELS: Record<PropKind, string> = {
  box: 'Box', sphere: 'Ball', cylinder: 'Cylinder', chair: 'Chair', stool: 'Stool', step: 'Step', wall: 'Wall',
  stick: 'Stick', phone: 'Phone', cup: 'Cup', book: 'Book',
};

/** Props made to be held: added to the selected figure's hand. */
export const HANDHELD: readonly PropKind[] = ['stick', 'phone', 'cup', 'book'];

export interface Prop {
  id: string;
  name: string;
  kind: PropKind;
  position: Vec3;
  /** Degrees, XYZ order. */
  rotation: Vec3;
  scale: Vec3;
  /** Held in a figure's hand: then position and rotation are relative to that hand. */
  hold?: { figure: string; hand: Side };
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
  /** The scene's key light (lib/lighting.ts DEFAULT_LIGHT without one). */
  light?: Light;
  /** Optional keyframe animation (see lib/animation.ts). */
  animation?: Animation;
}

/* ---------- animation ---------- */

/** One figure's pose in a keyframe. */
/** How a figure gets to a key from its previous key (without one: it glides, interpolated). */
export const TRAVELS = ['walk', 'run', 'jump'] as const;
export type Travel = (typeof TRAVELS)[number];

export interface PoseKey {
  joints: Figure['joints'];
  position: Vec3;
  hands: Figure['hands'];
  grounded: boolean;
  /** Generated locomotion from the previous key: legs, root and arm swing follow the path. */
  travel?: Travel;
  /** Keep the keyed facing on the way (side steps, backing up) instead of facing where it goes. */
  strafe?: boolean;
  /** A jump's turns in the air: about the vertical (spin) and head over heels (flip, + forwards). */
  spin?: number;
  flip?: number;
}

export interface Keyframe {
  /** Seconds from the start. */
  t: number;
  /** Pose per figure id. */
  poses: Record<string, PoseKey>;
  /** Place per prop id (props without keys stay where they are). */
  props?: Record<string, PropKey>;
}

/** One prop's place in a keyframe. */
export interface PropKey {
  /** World place, or (held) relative to the holding hand. */
  position: Vec3;
  rotation: Vec3;
  /** In a figure's hand from this key on. */
  hold?: { figure: string; hand: Side };
  /** Let go here: it starts from where the hand had it (and falls, or flies if thrown on). */
  release?: boolean;
  /** Thrown here from the previous key: it flies under gravity (into a hand if this key holds it). */
  throw?: boolean;
}

/**
 * A shot camera key: an orbit around the (auto-framed) subject.
 * zoom 1 frames everything; > 1 moves closer. pan shifts the frame (fractions of half the frame).
 */
export interface CameraKey {
  t: number;
  yaw: number;
  pitch: number;
  fov: number;
  zoom: number;
  pan: [number, number];
}

export interface CameraTrack {
  keys: CameraKey[];
  /** Re-centre on the figures every frame (tracking shot) instead of a fixed frame. */
  follow: boolean;
  /** Hand-held camera shake, 0–1. */
  shake: number;
}

export interface Animation {
  /** Length in seconds. */
  duration: number;
  fps: number;
  loop: boolean;
  /** Sorted by time. */
  keys: Keyframe[];
  camera?: CameraTrack;
  /**
   * Shots (cuts) along the timeline, sorted by start; each runs until the next one. The camera
   * does not move smoothly across a cut: every shot is framed by its own camera keys.
   */
  shots?: Shot[];
  /** Video model the shots are cut for (see lib/shots.ts), which limits a shot's length. */
  target?: string;
}

export interface Shot {
  id: string;
  /** Seconds from the start of the animation. */
  start: number;
  name: string;
  /** What happens in the shot (used in prompts, storyboards and cut lists). */
  caption?: string;
  /** The figure the shot is about: the camera frames (and follows) just them. */
  subject?: string;
}

export interface Library {
  version: 2;
  /** The project's scenes: each a set, a cast and their animation and shots. */
  scenes: Scene[];
  /** Storyboard: panels in story order, each showing one scene (see lib/board.ts). */
  board?: Panel[];
  /** Poses saved by the user, to apply to any figure (the built-in ones are not stored). */
  poses?: PoseAsset[];
}

/** A pose in the library: joint angles and hands, applied to a figure without moving it. */
export interface PoseAsset {
  id: string;
  name: string;
  joints: Figure['joints'];
  hands: Figure['hands'];
  /** Camera for its thumbnail. */
  view: View;
}

export interface Panel {
  id: string;
  /** The pose shown in this panel. */
  sceneId: string;
  caption?: string;
  /** Seconds on screen in the animatic. */
  hold: number;
}

export type Selection =
  | { kind: 'joint'; figure: string; joint: JointName }
  /** A whole figure (picked in the outline): delete, duplicate, rename, move it. */
  | { kind: 'figure'; figure: string }
  | { kind: 'prop'; prop: string }
  /** A shot of the animation (see lib/shots.ts; 'main' when it is not cut). */
  | { kind: 'shot'; shot: string }
  | null;

/** Rendering styles (see lib/styles.ts). 'shaded' is shown as "Clay". */
export const STYLES = ['line', 'sketch', 'ink', 'anime', 'shaded', 'minimal', 'silhouette'] as const;
export type Style = (typeof STYLES)[number];
export type GizmoMode = 'rotate' | 'translate' | 'scale';

/** Key light for the shaded style. azimuth 0 = from the front, elevation 90 = from above. */
export interface Light {
  azimuth: number;
  elevation: number;
  shadows: boolean;
  /** Brightness of the key light (1: normal). */
  intensity: number;
  /** Colour of the light: −1 cool (moonlight) … 0 white … 1 warm (sunset). */
  warmth: number;
}
