import type { Bones } from './pose';

export type Vec3 = [number, number, number];

/**
 * The joints a pose is made of and edited by (22, #30): the spine (an upper chest above the chest),
 * the neck and head, each arm from its shoulder (the collarbone) to its hand, each leg from its hip
 * to its toes. Each comes after its parent (lib/skeleton.ts PARENT).
 */
export const JOINTS = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
] as const;
export type JointName = (typeof JOINTS)[number];

/**
 * The rest of the VRM 1.0 humanoid skeleton (but the eyes and jaw): the fingers' bones, which the
 * mannequin draws from its hands' presets and an imported model or motion may have (lib/skeleton.ts).
 */
export const FINGER_BONES = [
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;
export type FingerBone = (typeof FINGER_BONES)[number];
/** A bone of the skeleton: the 22 joints and the 30 finger bones. */
export type Bone = JointName | FingerBone;
export const BONES: readonly Bone[] = [...JOINTS, ...FINGER_BONES];

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
  /** 0: a man (Mixamo's Y Bot), 1: a woman (X Bot). */
  sex: number;
  /** Standing height in metres. */
  height: number;
  /** Its build, how broad: 1 the bot as made (not set), less slimmer, more heavier (body.ts BUILD). */
  breadth?: number;
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
  /** Holds still in the gaps of an animated scene (no idle life: breathing, shifting, glances). */
  still?: boolean;
  /** Its row on the timeline is locked (#22): what it does can't be changed until unlocked. */
  locked?: boolean;
  /** Its row is muted (#22): what it does doesn't play; it stands as it is posed. */
  muted?: boolean;
  /** Keeps its eyes on another figure or a prop: the head and neck turn to it, all the time. */
  gaze?: { figure: string } | { prop: string };
  /** A tint to tell figures apart (teams, sides), as a CSS colour. */
  color?: string;
  /** Drawn as an imported character (a model in the library, by id) instead of the mannequin. */
  model?: string;
  /** What its face shows at a moment (a character with expressions: lib/face.ts), worked out from what it does; not saved. */
  face?: Face;
  /** The moment it is posed at, in an animation (for what swings as it moves: lib/springs.ts); not saved. */
  t?: number;
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
  /**
   * The scene's cameras (lib/cameras.ts), at least one: a still scene is filmed by the first, an
   * animated one by its shots' (lib/shots.ts).
   */
  cameras: Camera[];
  /** The coverage its cameras and cuts were made with, and the figures playing its roles (lib/coverage.ts). */
  coverage?: { id: string; roles: Record<string, string>; live?: boolean };
  /** The scene's lights and ambient light (lib/lighting.ts DEFAULT_LIGHTING without them). */
  lighting?: Lighting;
  /** The set it is played in (a built-in one's id, lib/sets.ts), behind its people and props. */
  set?: string;
  /** What happens in it (a still scene's caption in the story; an animated one's are its shots'). */
  caption?: string;
  /** Left out of the story (the storyboard and its exports); the scene list's order is the story's. */
  offStory?: boolean;
  /** How long a still scene is on screen in the story (s; DEFAULT_HOLD if not set). */
  hold?: number;
  /** Optional animation (see lib/animation.ts). */
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
  /** How each key goes on to the next, by key (smooth where not given): a hand-keyed part's, per key. */
  eases?: ClipTrack['interpolation'][];
  /**
   * The way its person faces at the start (yaw, degrees): where they look, which motion capture
   * often has apart from the pelvis (a stance turned to one side). The pelvis's when not given.
   */
  facing?: number;
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
  /** (`repeat`: a clip that does not loop played so many times, one after another.) */
  /** (`from`, `to`: the part of a clip that does not loop it plays, seconds of it (#22): all of it when not given.) */
  /**
   * (Repeated (#23): `seam`, seconds each repeat blends in from the last over (0: a cut; none: a short
   * blend where a repeat ends far from how the next starts); `alternate`, every other one mirrored.)
   */
  /** (`inPlace`, #23: its travel taken out: it stays where it starts. `lead`: seconds its first pose is held before it plays.) */
  | { kind: 'clip'; clip: string; speed?: number; mirror?: boolean; repeat?: number; from?: number; to?: number; seam?: number; alternate?: boolean; inPlace?: boolean; lead?: number; loops?: boolean }
  /** Poses keyed by hand: a one-part Clip of the action's own, in world space. One key: a held pose. */
  | { kind: 'keys'; clip: Clip }
  /** Walking, running or jumping to the role's end mark (via other marks), its steps generated. */
  /** `gait`: a Library cycle (a captured walk or run) it goes with, instead of generated steps (#26). */
  | { kind: 'travel'; mode: Travel; strafe?: boolean; spin?: number; flip?: number; via?: Mark[]; gait?: string };

/** A figure taking part in an Action, and where the action leaves it (world). */
export interface Role {
  figure: string;
  end?: Mark;
}

/** The upper body: what an upper-body action plays over the base (waving while walking). */
export const UPPER_BODY: readonly JointName[] = ['spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'];

/** The body parts an action over another plays on (#23: its `mask`; the upper body when it has none). */
export const MASKS: Record<NonNullable<Action['mask']>, readonly JointName[]> = {
  arms: ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'],
  head: ['neck', 'head'],
  legs: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'],
};

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
  /** How that blend goes (#23): evenly, easing in (slow, then quicker) or out; smoothly (easing both) when not given. */
  blendCurve?: 'linear' | 'in' | 'out';
  /** How much of it shows (#23, 0–1): an action over another (a subtler wave), a correction (half of it). All when not given. */
  strength?: number;
  /** What an action over another plays on (#23): the upper body when not given, the arms, the head and neck, or the legs. */
  mask?: 'arms' | 'head' | 'legs';
  /** The strike it reacts to (#23: React to): it stays timed to its blow as that moves. */
  reactsTo?: string;
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

/** A scene's timing: what everyone does, props' keys, contacts, and the cameras and shots filming it. */
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
  /**
   * The camera track: shots sorted by start, at least one; each runs until the next one starts
   * (a cut) or the animation ends, filmed by one of the scene's cameras.
   */
  shots: Shot[];
  /** Beats to time things to (#22): named moments on the ruler, which drags snap to. */
  markers?: Marker[];
  /** In and out (#22): playback goes round this stretch; a video may film just it. */
  range?: { from: number; to: number };
}

/** Frame shapes the shots can be filmed in. */
export const FRAME_SHAPES = ['16:9', '9:16', '1:1', '2.39:1'] as const;
export type FrameShape = (typeof FRAME_SHAPES)[number];

/** A shot: a span of the animation's time, filmed by one of the scene's cameras. */
export interface Shot {
  id: string;
  /** Seconds from the start of the animation. */
  start: number;
  name: string;
  /** What happens in the shot (used in prompts, storyboards and cut lists). */
  caption?: string;
  /** The camera filming it (one of the scene's). */
  camera: string;
  /** Comes in by blending from the camera before over this long (s); none: a cut. */
  blend?: number;
  /** Taken over by hand from the director (#14): kept as it is, this long (s), when it cuts anew. */
  pinned?: number;
}

/**
 * A camera of the scene: what it films, and either the path it takes (points in time, each with
 * where it looks and its lens) or the rig that places it from its subject every frame. Shots
 * refer to cameras; one camera can film several shots.
 */
export type Camera = PathCamera | RigCamera;

interface CameraBase {
  id: string;
  name: string;
  /** The figure it films (none: everyone). */
  subject?: string;
  /** A point it films instead of a figure (#16: its aim dropped there, or clicked through it). */
  point?: Vec3;
  /** Figures it frames with its subject (a two-shot). */
  also?: string[];
  /** Made by the scene's coverage, as its camera with this key (lib/coverage.ts). */
  made?: string;
  /** Hand-held shake, 0–1. */
  shake?: number;
}

/** A camera that goes along a path. */
export interface PathCamera extends CameraBase {
  kind: 'path';
  /** Where its path is: fixed in the world, or riding along with its subject. */
  anchor: 'world' | 'subject';
  /** Where it looks: at its subject, at a point, or along its path. */
  aim: 'subject' | 'point' | 'path';
  /** The path's points in time order (animation time), at least one. */
  points: CameraPoint[];
  /** Its path's shape: a smooth curve through its points, or straight lines between them. */
  ease?: 'smooth' | 'linear';
  /** Its pace: as its points' times say, or at an even speed along its whole path. */
  pace?: 'even';
}

/** A camera that places itself every frame from its subject's body (see CameraRig). */
export interface RigCamera extends CameraBase {
  kind: 'rig';
  rig: CameraRig;
}

/** How much of the body a shot holds: extreme wide … extreme close-up (lib/cameras.ts SHOT_SIZES). */
export type ShotSize = 'ews' | 'ws' | 'fs' | 'mws' | 'ms' | 'mcu' | 'cu' | 'ecu';

/** Where the subject sits in the frame: in the middle, on the left or right third, or (auto) with room in front of where it faces. */
export type Placement = 'center' | 'left' | 'right' | 'auto';

/**
 * A camera that works out where it is every frame from its subject's body, so its shot holds
 * when the blocking or a body changes: it keeps an angle and a shot size on the subject,
 * following it (moving with it, and turning with it too if `turn`), and moves from there over a
 * shot as its `move` says (an arc round it, a push in, a crane up…). Angles are
 * the subject's own (from its front, + from its left; or from the direction towards another
 * figure, the line of action), so a camera set-up works in any scene.
 */
export interface CameraRig {
  /** Degrees around the subject from its front (+ from its left), and above it. */
  yaw: number;
  pitch: number;
  /** The angle turns as the subject turns (else it is kept from how the subject faced at the camera's first shot). */
  turn?: boolean;
  /** Turned about the line of sight (degrees, + clockwise as seen through it: a Dutch angle). */
  roll?: number;
  /** How it moves over each shot it films, from this framing (none: it holds it). */
  move?: CameraMove;
  /** Angles from the direction towards this figure, rather than from the subject's facing. */
  toward?: string;
  /** Keep this figure out of the frame (a clean single): the camera comes round further, away from it, as far as that takes. */
  clear?: string;
  size: ShotSize;
  place?: Placement;
  /** Focal length (mm, full frame). */
  lens: number;
  /** Seconds the subject's motion is smoothed over (a window centred on each moment). */
  smooth?: number;
  /**
   * Fixed (#21): where it stands in the scene, a tripod (it does not follow its subject), and
   * where it looks: there (locked), or turning to keep its subject in frame (`aim: 'subject'`).
   */
  fixed?: { position: Vec3; look: Vec3; aim?: 'subject' };
}

/**
 * How a camera moves over a shot, from its framing at the shot's start (#16): kept as what it does
 * (an arc of 90°, a push to a close-up), worked out every frame, so it holds when the blocking or
 * the cut changes.
 */
export const MOVE_KINDS = ['push', 'arc', 'crane', 'truck', 'pan', 'tilt', 'zoom', 'dolly', 'roll'] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];
export interface CameraMove {
  kind: MoveKind;
  /** The size it ends at (a push or pull; any move may also end closer or wider). */
  size?: ShotSize;
  /** How far: degrees (arc, crane, pan, tilt, roll), metres sideways (truck), the lens it ends at (zoom, dolly; mm). */
  by?: number;
  /** A pan: the figure it ends on (rather than a number of degrees). */
  to?: string;
  /** How it goes: easing in and out (smooth), at an even pace, or holding, then fast (snap: a whip pan, a crash zoom). */
  pace?: 'smooth' | 'even' | 'snap';
  /** Seconds it holds its framing first (into the run), and holds where it ended last. */
  wait?: number;
  hold?: number;
}

/** A point of a camera's path. */
export interface CameraPoint {
  /** Seconds (animation time). */
  t: number;
  /** Where the camera is: in the world, or (anchored to the subject) from the subject's place on the floor. */
  position: Vec3;
  /** Where it looks: aiming at the subject, from the subject's place; at a point, as the position is. */
  look: Vec3;
  /** Focal length (mm, on a full-frame sensor). */
  lens: number;
  /** Turn about the line of sight (degrees, + clockwise as seen through it). */
  roll?: number;
  /** The camera eases to a stop here (and on from it): its path may turn sharply here, a corner. */
  stop?: true;
  /** What it looks at here, its own (a figure, or a spot); none: as the camera aims. Between two points, it turns from one to the other. */
  aim?: { figure: string } | { point: Vec3 };
}

/** A beat on the timeline (#22): "the punch lands", "she turns". */
export interface Marker {
  id: string;
  t: number;
  name: string;
  /** Its colour, to tell kinds of beat apart (the accent if none). */
  color?: MarkerColor;
}
export const MARKER_COLORS = ['red', 'yellow', 'green', 'grey'] as const;
export type MarkerColor = (typeof MARKER_COLORS)[number];

export interface Library {
  /** The project's scenes: each a set, a cast and their animation and shots. */
  scenes: Scene[];
  /** The project's settings: its frame and its render style (lib/project.ts). */
  settings?: ProjectSettings;
  /** Poses saved by the user, to apply to any figure (the built-in ones are not stored). */
  poses?: PoseAsset[];
  /**
   * Motions the user imported (BVH, FBX, glTF), to apply to any figure like the built-in ones: what
   * they are. Their frames are kept apart, as assets (lib/assetstore.ts).
   */
  clips?: ClipInfo[];
  /** Characters the user imported, to draw figures as (their files are assets). */
  models?: ModelInfo[];
  /** Scene templates the user saved (lib/templates.ts). */
  templates?: TemplateAsset[];
  /** Shoot presets the user made: a template paired with a coverage (lib/templates.ts). */
  shoots?: ShootPreset[];
}

/** A shoot preset: a template (by id) filmed with a coverage (by id); it holds no scene and no cameras. */
export interface ShootPreset {
  id: string;
  name: string;
  template: string;
  coverage: string;
  /** Seconds, for a template that does not move. */
  duration?: number;
  /** Who plays its coverage's roles (A, B), by their place in the template's cast: else the first and the one nearest them. */
  cast?: number[];
}

/** A scene saved as a template: its cast, set, actions and light, around the stage origin; no cameras or cuts. */
export interface TemplateAsset {
  id: string;
  name: string;
  scene: Scene;
}

/**
 * An imported character (a glTF or FBX file with a skinned mesh): how the library lists it, and
 * which of its bones is each of the skeleton's. The file is an asset (lib/assetstore.ts).
 */
export interface ModelInfo {
  id: string;
  name: string;
  format: 'glb' | 'fbx';
  bones: Partial<Record<Bone, string>>;
  /** The body under it, if known (the built-in characters): a figure drawn as it takes it, its height and build. */
  body?: BodyParams;
  /** Its thumbnail for the library (an imported one's, drawn as it is imported). */
  thumb?: string;
  /** Who made it and on what terms, as its file says (a VRM avatar's): shown with it. */
  credit?: string;
}

/** An imported clip as the library lists it: its name, length and people (the frames are an asset). */
export interface ClipInfo {
  id: string;
  name: string;
  duration: number;
  loop: boolean;
  /** Its parts' names: one per person. */
  people: string[];
}

/** A pose in the library: bone rotations and hands, applied to a figure without moving it. */
export interface PoseAsset {
  id: string;
  name: string;
  /** The pose in words, detailed enough to make it again (the built-in ones). */
  description?: string;
  bones: Bones;
  hands: Figure['hands'];
  /** Camera for its thumbnail. */
  view: View;
}

/** The project's settings: one frame shape, one render style. */
export interface ProjectSettings {
  frame: FrameShape;
  style: Style;
}

export type Selection =
  | { kind: 'joint'; figure: string; joint: JointName }
  /** A whole figure (picked in the outline): delete, duplicate, rename, move it. */
  /** (Picked: its move gizmo; a click on it then picks the part there.) */
  | { kind: 'figure'; figure: string }
  | { kind: 'prop'; prop: string }
  /**
   * An action on a figure's track (a walk, a motion, posed keys), picked on the timeline from that
   * figure's row; `also`: other blocks picked with it (Shift-click, #22), moved, deleted, duplicated
   * and copied with it (its inspector is the first one's).
   */
  | { kind: 'action'; action: string; figure: string; also?: string[] }
  /** A shot of the animation (see lib/shots.ts; 'main' when it is not cut). */
  | { kind: 'shot'; shot: string }
  /** A camera of the animation (picked in the outline or on the canvas). */
  | { kind: 'camera'; camera: string }
  /** One of the scene's lights (picked in the outline, or its lamp on the canvas). */
  | { kind: 'light'; light: string }
  /** The scene's lighting as a whole (#17: its look, where it is, its sky): the first row of the outline's lights. */
  | { kind: 'lighting' }
  /** Several figures and props at once (Shift-click adds one or takes it away): moved, turned, duplicated and deleted together. */
  | { kind: 'many'; figures: string[]; props: string[] }
  /** Nothing: the scene itself.  */
  | null;

/** A character's face (#15): what a VRM avatar's shape keys show (its eyes shut, the mouth's vowels, a feeling). */
export const EXPRESSIONS = ['blink', 'aa', 'ih', 'ou', 'ee', 'oh', 'happy', 'angry', 'sad', 'relaxed', 'surprised'] as const;
export type Expression = (typeof EXPRESSIONS)[number];
/** How far each expression shows, 0–1. */
export type Face = Partial<Record<Expression, number>>;

/** Rendering styles (see lib/styles.ts). 'shaded' is shown as "Clay". */
export const STYLES = ['line', 'sketch', 'ink', 'watercolor', 'anime', 'pixel', 'render', 'shaded', 'minimal'] as const;
export type Style = (typeof STYLES)[number];
/** What a selected prop's gizmo does: move it, or (R) scale it. */
export type GizmoMode = 'translate' | 'scale';

/**
 * What a light is: the sun (parallel rays from a direction: the one that casts shadows), a lamp (a
 * point in the scene, all round or a spot aimed at someone or something, reaching so far), or a
 * window (a soft light from a pane in the scene, towards the people).
 */
export const LIGHT_KINDS = ['sun', 'lamp', 'window'] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];

/**
 * What a light is for (#17): the key (the one direction that casts shadows, fixed in the scene), a
 * fill or a rim (no shadows; placed for the shot's camera when `relative`), a practical (a lamp or a
 * window lighting what is near it: a set's own, or added), a follow light (going with a figure).
 */
export const LIGHT_ROLES = ['key', 'fill', 'rim', 'practical', 'follow'] as const;
export type LightRole = (typeof LIGHT_ROLES)[number];

/** A light of the scene (the lit styles show it). */
export interface Light {
  id: string;
  kind: LightKind;
  /** Its name ("Key light", "Fill light", "Desk lamp"): what it is for, or where it is. */
  name: string;
  /** The sun's direction: azimuth 0 = from the front, elevation 90 = from above. */
  azimuth: number;
  elevation: number;
  /** A lamp's or a window's place in the scene (m; y its height). */
  position: Vec3;
  /** A lamp made a spot: its cone (degrees across); none: it lights all round. */
  spot?: number;
  /** What a spot (or a window) points at: a figure, or a point; none: straight down (a spot), at the people (a window). */
  aim?: { figure: string } | { point: Vec3 };
  /** How far a lamp reaches (m). */
  range: number;
  /** Brightness (1: normal). */
  intensity: number;
  /** Its colour (#rrggbb), and the colour temperature it was picked by (K), if it was. */
  color: string;
  kelvin?: number;
  /** The sun's shadows. */
  shadows: boolean;
  /** What it is for (none: a light of its own). */
  role?: LightRole;
  /** A fill or a rim placed for the shot's camera: its azimuth from the camera, on the side away from the key. */
  relative?: 'shot';
  /** A follow light's figure: its position is from where that figure stands. */
  follows?: string;
  /** One of the set's own (a practical that came with it): it goes with the set. */
  ofSet?: true;
  /** How soft its light and shadows are, 0–1 (0: hard). */
  soft?: number;
}

/** The light from all around: a brightness, the sky's colour above and the ground's below. */
export interface Ambient {
  intensity: number;
  sky: string;
  ground: string;
}

/** Where a scene is lit (#17): indoors (no sun: its key a studio key, the set casting none of its shadows) or out; the time of day (hours) and the weather the sun and the sky were set from. */
export interface Environment {
  indoors?: true;
  time?: number;
  weather?: 'overcast';
}

/** A scene's lights (up to MAX_LIGHTS) and its ambient light; the scheme it was set from, until it is changed; where it is. */
export interface Lighting {
  lights: Light[];
  ambient: Ambient;
  scheme?: string;
  environment?: Environment;
}
