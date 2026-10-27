import type { Bones } from './pose';

export type Vec3 = [number, number, number];

export const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
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
  /** Bone rotations (quaternions) on the standard skeleton; see lib/pose.ts. */
  bones: Bones;
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

export const PROP_KINDS = ['box', 'sphere', 'cylinder', 'chair', 'stool', 'step', 'wall', 'mat', 'hoop', 'bar', 'stick', 'ring', 'ribbon', 'phone', 'cup', 'book'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export const PROP_LABELS: Record<PropKind, string> = {
  box: 'Box', sphere: 'Ball', cylinder: 'Cylinder', chair: 'Chair', stool: 'Stool', step: 'Step', wall: 'Wall',
  mat: 'Mat', hoop: 'Basketball hoop', bar: 'High-jump bar', stick: 'Stick', ring: 'Gym hoop', ribbon: 'Ribbon', phone: 'Phone', cup: 'Cup', book: 'Book',
};

/** Props made to be held: added to the selected figure's hand. */
export const HANDHELD: readonly PropKind[] = ['stick', 'ring', 'ribbon', 'phone', 'cup', 'book'];

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
  /** Where hands take hold of it (points in its own frame; its kind's own without). */
  handles?: Vec3[];
  /** How it bounces and grips when it is free (0–1; its kind's own without). */
  physics?: { bounce: number; friction: number };
  /** A ribbon's line through the air at a moment (world points from the stick's tip), worked out from how the tip moved; not saved. */
  trail?: Vec3[];
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

/* ---------- animation (see lib/evaluate.ts) ---------- */

/** A figure's pose: what a Clip gives for one person at a moment. */
export type Pose = Pick<Figure, 'bones' | 'position' | 'hands' | 'grounded'>;

/** Ways of getting from one place to another, generated step by step (lib/locomotion.ts). */
export const TRAVELS = ['walk', 'run', 'jump'] as const;
export type Travel = (typeof TRAVELS)[number];

/** A place on the floor, and the way a figure there faces (degrees; 0 faces +Z). */
export interface Mark {
  at: [number, number];
  facing: number;
}

/**
 * One animated value of a Clip part, as in a three.js AnimationClip / glTF animation: `times` in
 * seconds and `values` (so many per time). Names: `<bone>.quaternion` (x, y, z, w),
 * `hips.position` (x, y, z: the root), `hands.L` / `hands.R` (five curls and the spread) and
 * `grounded` (1 or 0). Smooth tracks are hermite curves through their keys (in joint angles);
 * linear ones are sampled densely (imported or baked motion).
 */
export interface ClipTrack {
  name: string;
  times: number[];
  values: number[];
  interpolation: 'smooth' | 'linear' | 'step';
}

/** One person's part of a Clip. */
export interface ClipPart {
  name: string;
  /** Proportions it was made on (the root's travel and heights scale with the body playing it). */
  body?: BodyParams;
  tracks: ClipTrack[];
}

/** Something that happens at a moment of a Clip (a release, a catch, a footstep). Reserved. */
export interface ClipEvent {
  t: number;
  part: number;
  /** A hand lets a prop go (thrown where the action sends it), or takes hold of it. */
  kind: 'release' | 'grab';
  hand: Side;
}

/** A body part of a part held still from `start` to `end`: a foot on the floor, or a hand on another part's body. */
export interface ClipContact {
  part: number;
  bone: JointName;
  start: number;
  end: number;
  /** On another part's bone (the clip says where on it); without: on the floor. */
  on?: { part: number; bone: JointName };
}

/** Motion data on the standard skeleton: one part per person, with its events and contacts. */
export interface Clip {
  id: string;
  name: string;
  duration: number;
  loop: boolean;
  parts: ClipPart[];
  events: ClipEvent[];
  contacts: ClipContact[];
}

/** What makes an Action's motion. */
export type ActionSource =
  /** A Clip from the library (by id), one part per role, placed from where each role is. */
  | { kind: 'clip'; clip: string; speed?: number; mirror?: boolean }
  /** Poses keyed by hand: a one-part Clip of the action's own, in world space. One key: a held pose. */
  | { kind: 'keys'; clip: Clip }
  /** Walking, running or jumping to the role's end mark (via other marks), its steps generated. */
  | { kind: 'travel'; mode: Travel; strafe?: boolean; spin?: number; flip?: number; via?: Mark[] };

/** A figure taking part in an Action, and where the action leaves it (world). */
export interface Role {
  figure: string;
  end?: Mark;
}

/** The upper body: what an upper-body action plays over the base (waving while walking). */
export const UPPER_BODY: readonly JointName[] = ['spine', 'chest', 'neck', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'];

/**
 * Something done over a span of time by one or more figures. Actions on the base layer follow
 * one another; an upper-body action plays over them from the waist up, and a correction action
 * adds hand edits on top of both.
 */
export interface Action {
  id: string;
  start: number;
  duration: number;
  /** Seconds before it starts over which the figure eases from what it is doing into its first pose (it then plays as made). */
  blendIn?: number;
  layer?: 'upper' | 'correction';
  roles: Role[];
  source: ActionSource;
  /** The prop its clip's events let go of and take hold of (a ball thrown, dribbled). */
  prop?: string;
  /** Where its release sends the prop. */
  target?: PropTarget;
}

/**
 * Where a release sends a prop: to a floor point, into someone's hand (caught there when it
 * arrives, if the hand can reach it), through a basketball hoop (or off its rim), or bouncing once
 * on the floor back up to the hand that takes hold of it next (a dribble).
 */
export type PropTarget =
  | { at: [number, number] }
  | { figure: string; hand: Side; rise?: number }
  | { hoop: string; miss?: boolean }
  | { bounce: true };

/** The body parts a constraint can hold. */
export const HOLDERS = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'hips'] as const;
export type Holder = (typeof HOLDERS)[number];

/** What a constrained body part is held on: someone's body part, a prop or a place (points in their own frame). */
export type ConstraintTarget =
  | { figure: string; bone: JointName; at: Vec3 }
  | { prop: string; at: Vec3 }
  | { point: Vec3 };

/** A contact asked for: a figure's hand, foot or hips held on something from `start` to `end`. */
export interface Constraint {
  id: string;
  figure: string;
  bone: Holder;
  target: ConstraintTarget;
  start: number;
  end: number;
}

/** One prop's place at a time. */
export interface PropKey {
  t: number;
  /** World place, or (held) relative to the holding hand. */
  position: Vec3;
  rotation: Vec3;
  /** In a figure's hand from this key on. */
  hold?: { figure: string; hand: Side };
  /** Let go here: it falls from where the hand had it. */
  release?: boolean;
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
  /** Every figure's actions, by start. */
  actions: Action[];
  /** Contacts asked for ("hold on to …"), solved for the actual bodies. */
  constraints?: Constraint[];
  /** Keys of props that move (by id, in time order). */
  props?: Record<string, PropKey[]>;
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
  version: 3;
  /** The project's scenes: each a set, a cast and their animation and shots. */
  scenes: Scene[];
  /** Storyboard: panels in story order, each showing one scene (see lib/board.ts). */
  board?: Panel[];
  /** Poses saved by the user, to apply to any figure (the built-in ones are not stored). */
  poses?: PoseAsset[];
  /** Motions the user imported (BVH, FBX, glTF), to apply to any figure like the built-in ones. */
  clips?: Clip[];
}

/** A pose in the library: bone rotations and hands, applied to a figure without moving it. */
export interface PoseAsset {
  id: string;
  name: string;
  bones: Bones;
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
  /** The scene itself: its light, look and reference image. */
  | { kind: 'scene' }
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
