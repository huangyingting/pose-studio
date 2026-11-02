import {
  Activity, Aperture, Magnet, Flag, VolumeX, ArrowLeftToLine, ArrowRightToLine, SquareSplitHorizontal, CircleStop, ArrowDown, ArrowDownToLine, ArrowUp, ChevronDown, ChevronUp, ArrowLeftRight, ArrowUpFromDot, Armchair, BedSingle, BookmarkPlus, Briefcase, Camera, ChevronsDown, Clapperboard, ClipboardCopy, ClipboardPaste, Copy, Diamond, Download,
  Crosshair, Eye, EyeOff, FilePlus2, FileUp, Film, FlipHorizontal2, Focus, FolderOpen, Frame, Footprints, Ghost, Goal, Grid3x3, Hand, Keyboard, LayoutPanelTop, Link, Lock, Maximize, Maximize2, Move3d, MoveHorizontal, MoveUpRight,
  PanelRightClose, Pause, Pencil, PenLine, RectangleHorizontal, PersonStanding, Play, Plus, Redo2, Scan, RefreshCw, Repeat, Repeat1, RotateCcw, RotateCw, Save, Scale3d, ScanFace, Scissors, Search, Send, 
  Lightbulb, Spline, Bone, Move, Pin, Rotate3d, StepBack, StepForward, SunMedium, SunMoon, Timer, Trash2, Undo2, UserRound, Video, Wind, X, Zap, ZoomIn, ZoomOut, type LucideIcon,
} from 'lucide-react';
import {
  addCamera, stepRig, addFigure, addMarker, editAsKeys, unlinkReaction, setTrack, setRange, setRangeAt, applyUpperBody, reactTo, splitAt, splitIntoRepeats, trim, rippleDeleteActions, duplicateBlocks, copyActions, pasteActions, hasCopiedActions, moveAction, addKey, addProp, addStandIn, setInStory, carryProblem, copyMotion, copyPose, cutShot, deleteAction, deleteCamera, deleteCameraPoint, deleteFigure,
  deleteKey, sitAt, deleteProp, deleteScene, dribbleProp, duplicateCamera, duplicateCurrentScene, duplicateFigure, duplicateProp, editProjectSettings, editShot, holdHandle, holdProp, lieOn, sitOn, sittingAt, standUp, turnTo, STRIKES, strikeFigure,
  holdKey, setDirector, unpinShot, mirrorPose, pastePose, propNow, repeatAction, saveKeysAsMotion, setKeyEase, removeAnimation, removeShotCut, resetPose, saveAsShoot, savePose, saveTemplate, setAnimationOptions, setCameraPoint, setClipOptions,
  setFigureHidden, setGaze, setJumpHeight, setTravel, startAnimation, symmetrizePose, throwProp, travelTo, lastSteps, setGait, setJoint, holdOn, addCameraPoint, setCameraPointAim, setCameraPointStop, editRig, frameShot, setLens,
  addLight, applyLightingPreset, deleteLight, editLight, placeSceneLight, setLightRole, subjectOf, deleteMany, duplicateMany, stepFigure, turnFigure, stepProp, turnProp, stepMany, stepJoint, stepCamera, offsetPerformance,
} from '@/lib/actions';
import { KIND_NAMES, LIGHTING_PRESETS, MAX_LIGHTS, ROLE_NAMES, clampLight, keyLight, lightFrom, lightText, lightingOf } from '@/lib/lighting';
import { snapTime } from '@/lib/animation';
import { cameraById, liveCamera, rigAngle, rigPitch, type CameraView } from '@/lib/cameras';
import { actionsOf, sceneAt } from '@/lib/evaluate';
import { fetchLibraryClip } from '@/lib/librarymotions';
import { FRAME_LABELS, projectSettingsOf } from '@/lib/project';
import { HOLDABLE } from '@/lib/hold';
import { JUMP_PREP, jumpHeight } from '@/lib/locomotion';
import { handlesOf } from '@/lib/props';
import { describeSpan } from '@/lib/prompt';
import { shareUrl } from '@/lib/share';
import { shotSpans } from '@/lib/shots';
import { THEMES, type PinEnd, type Store } from '@/lib/store';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { actionLabel, keyAtTime, keyEaseAt, keyTimesOf, moments, travelInto } from '@/lib/track';
import { clipById, loopsOf } from '@/lib/assets';
import { FRAME_SHAPES, HANDHELD, JOINTS, LIGHT_KINDS, LIGHT_ROLES, PROP_KINDS, PROP_LABELS, STYLES, type Figure, type JointName, type PathCamera, type RigCamera, type Selection, type Travel, type Vec3 } from '@/lib/types';
import { CONTACT_LABELS, facing, type Contact } from '@/lib/relations';
import { JOINT_LABELS, mirrorJointName, wrapDeg } from '@/lib/joints';
import { angle, mirrorBones } from '@/lib/pose';
import { JOINT_PARENT as PARENT } from '@/lib/skeleton';
import { LENSES, SHOT_SIZES, viewOf } from '@/lib/cameras';
import { VIEW_PRESETS } from '@/lib/views';
import { seatAt } from '@/lib/sets';
import { PROP_ICONS, STYLE_ICONS } from './icons';
import { startRename } from './rename';
import type { MenuItem, Notify } from './ui';
import { placingFigure, placingProp, type Placing } from './placing';
import type { CanvasHit } from './Viewport';
import { flashReadout, metres, sliderText, viaPointer } from './hints';
import { heldAxis } from './modifiers';
import { DIRECTOR_STYLES, coverageById } from '@/lib/coverage';

/*
 * Every operation, written once: its title, icon, keys, when it applies and what it does. Key
 * handling, the context and main menus, the toolbars, the command palette and the help dialog
 * are all built from this list. A command acts on a context: the selected (or right-clicked)
 * thing, a spot on the floor, a time on a track.
 */

/** What the app does around the store: dialogs, the view, playback, files (set by the studio and the timeline). */
export interface App {
  notify: Notify;
  notifyUndo(text: string): void;
  dialog(d: 'export' | 'export-story' | 'export-video' | 'photo' | 'help' | 'practice' | 'board' | 'palette' | 'start'): void;
  frameAll(): void;
  /** Frame what is selected (everything when nothing is). */
  frameSelected(): void;
  frameView(v: { yaw: number; pitch: number }): void;
  saveFile(): void;
  openFile(mode: 'append' | 'replace'): void;
  playing(): boolean;
  togglePlay(): void;
  stopPlayback(): void;
  speed(): number;
  setSpeed(x: number): void;
  repeatShot(): boolean;
  setRepeatShot(on: boolean): void;
  onion(): boolean;
  setOnion(on: boolean): void;
  /** The one figure or prop the canvas shows (the editor's view only), if any. */
  isolated(): string | null;
  setIsolated(id: string | null): void;
  /** The editor's view, as a camera would take it. */
  captureShot(): CameraView | null;
  /** The timeline's: the motion check, and its zoom. */
  checkMotion?(): void;
  zoomTimeline?(how: 'in' | 'out' | 'fit'): void;
  /** The editor's view (its angle), for steps that go the way the screen shows. */
  view?(): { yaw: number; pitch: number } | null;
  /** Ask for a spot on the floor (a pick mode), then do something there. */
  pickFloor?(hint: string, done: (at: Vec3) => void): void;
  /** Ask for something on the canvas (a figure, a point of its body, a prop), then do something with it. */
  pickThing?(hint: string, take: (hit: CanvasHit) => void): void;
  /** Place something new: its ghost follows the pointer until a click drops it. */
  place?(p: Placing): void;
  /** Frame the selection (if it is out of view, say). */
  frameSelection?(): void;
  /** The scene alone, filling the window (no top bar, no panels). */
  stageOnly(): boolean;
  setStageOnly(on: boolean): void;
}

// Until the studio has set it (menus are built while it first renders): nothing playing, nothing to open.
const none = () => {};
let app: App = {
  notify: none, notifyUndo: none, dialog: none, frameAll: none, frameSelected: none, frameView: none, saveFile: none, openFile: none,
  playing: () => false, togglePlay: none, stopPlayback: none, speed: () => 1, setSpeed: none, repeatShot: () => false, setRepeatShot: none,
  onion: () => false, setOnion: none, isolated: () => null, setIsolated: none, captureShot: () => null, stageOnly: () => false, setStageOnly: none,
};
export function setApp(patch: Partial<App>) {
  app = { ...app, ...patch };
}
export const App = () => app;

/** Add something: placed with the pointer when asked for with a click; else put where it goes, and framed if out of view. */
export function placeOrAdd(p: Placing, now: () => void) {
  if (viaPointer() && app.place) app.place(p);
  else {
    now();
    app.frameSelection?.();
  }
}
/** What a command acts on. */
export interface Ctx {
  store: Store;
  figure?: string;
  /** A part of the figure is selected (not the figure itself): which. */
  joint?: JointName;
  prop?: string;
  camera?: string;
  shot?: string;
  action?: string;
  /** Other blocks picked with the action (#22). */
  also?: string[];
  /** A scene of the project (the scene picker). */
  scene?: number;
  /** A spot on the floor. */
  floor?: Vec3;
  /** Where on a set's top (a dais, a table, a seat) the spot is, if it is on one. */
  top?: Vec3;
  /** A time on a track (a key, a camera's point). */
  at?: number;
  /** One of the scene's lights. */
  light?: string;
  /** Several figures and props at once. */
  many?: { figures: string[]; props: string[] };
}

/** A choice of a command that takes one ("Copy moves to: Kai"). */
interface Choice { title: string; icon?: LucideIcon; checked?: boolean; disabled?: boolean; run(): void }

interface Command {
  id: string;
  title: string | ((c: Ctx) => string);
  icon?: LucideIcon;
  /** Its icon, when it depends on the context. */
  iconFor?(c: Ctx): LucideIcon;
  /** The keys it answers to ('mod+z', 'shift+?', 'delete'); the first is the one shown. */
  keys?: string[];
  /** Whether it applies here at all (shown in menus, found by the palette, answering its keys). */
  when?(c: Ctx): boolean;
  enabled?(c: Ctx): boolean;
  checked?(c: Ctx): boolean;
  danger?: boolean;
  run?(c: Ctx): void;
  /** Its choices, for a command that takes one. */
  items?(c: Ctx): Choice[];
  /** What the help dialog calls it, where its keys do more than its title says. */
  help?: string;
}

/* ---------------- what a context holds ---------------- */

const sceneOf = (c: Ctx) => c.store.scene;
const figureOf = (c: Ctx) => c.store.scene.figures.find((f) => f.id === c.figure);
const activeFigure = (c: Ctx) => c.store.figure;
const PIN_ENDS: PinEnd[] = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'];
const pinned = (c: Ctx) => !!c.figure && !!c.joint && (c.store.getState().pins[c.figure] ?? []).includes(c.joint as PinEnd);
/** "3 things" (several selected). */
const count = (c: Ctx) => { const n = (c.many?.figures.length ?? 0) + (c.many?.props.length ?? 0); return `${n} things`; };
/** The light of the context (the key light, the scene's). */
const lightOf = (c: Ctx) => { const l = lightingOf(c.store.scene); return l.lights.find((x) => x.id === c.light) ?? keyLight(l)!; };
const animated = (c: Ctx) => !!c.store.scene.animation;
/** About the scene, not one thing in it: the empty floor (a spot on it, or none: off the floor), or nothing selected. */
const onScene = (c: Ctx) => !c.figure && !c.prop && !c.camera && !c.shot && !c.action && !c.light && !c.many && c.scene === undefined;

/** The context of the keyboard and the palette: the selection (and the active figure for pose edits). */
export function selectionCtx(store: Store): Ctx {
  const sel = store.getState().selection;
  if (!sel) return { store };
  switch (sel.kind) {
    case 'figure': return { store, figure: sel.figure };
    case 'joint': return { store, figure: sel.figure, joint: sel.joint };
    case 'prop': return { store, prop: sel.prop };
    case 'camera': return { store, camera: sel.camera };
    case 'shot': return { store, shot: sel.shot };
    case 'action': return { store, action: sel.action, figure: sel.figure, ...(sel.also ? { also: sel.also } : {}) };
    case 'light': return { store, light: sel.light };
    case 'lighting': return { store };
    case 'many': return { store, many: { figures: sel.figures, props: sel.props } };
  }
}

/** Rename in the scene outline (opening it if another section is showing). */
function renameInOutline(store: Store, id: string) {
  if (store.getState().settings.side !== 'scene') store.setSettings({ side: 'scene' });
  startRename(id);
}

/** Save the open scene as a template of my own, under a name asked for. */
function saveAsTemplate(store: Store, { notifyUndo }: { notifyUndo(text: string): void }) {
  const name = window.prompt('Template name', store.scene.name)?.trim();
  if (!name) return;
  saveTemplate(store, name);
  notifyUndo(`Saved “${name}” to My templates`);
}

const hand = (h: 'L' | 'R') => (h === 'L' ? 'left' : 'right');
const spanOf = (c: Ctx) => { const a = c.store.scene.animation; return a && c.shot ? shotSpans(a).find((sp) => sp.shot.id === c.shot) : undefined; };
const actionOf = (c: Ctx) => c.store.scene.animation?.actions.find((x) => x.id === c.action);
/** The other figures' motions (clips at hand) an action can be timed to. */
const othersMotions = (c: Ctx) => {
  const act = actionOf(c);
  return (c.store.scene.animation?.actions ?? []).filter((x) => act && x.source.kind === 'clip' && !!clipById(x.source.clip) && !x.roles.some((r) => act.roles.some((q) => q.figure === r.figure)));
};
/** The prop the selected hand holds at the playhead. */
const heldIn = (c: Ctx) => {
  const side = c.joint === 'leftHand' ? 'L' : c.joint === 'rightHand' ? 'R' : null;
  return side ? c.store.scene.props.find((p) => { const h = propNow(c.store, p.id)?.hold; return h?.figure === c.figure && h?.hand === side; }) : undefined;
};
/** The blocks picked: the action and those with it (#22). */
const blocks = (c: Ctx) => (c.action ? [c.action, ...(c.also ?? [])] : []);

/** Move the picked blocks by frames, each person's first (what follows comes along). */
function nudge(c: Ctx, frames: number) {
  const a = c.store.scene.animation;
  if (!a) return;
  const by = frames / a.fps;
  const acts = blocks(c).map((id) => a.actions.find((x) => x.id === id)!).filter(Boolean).sort((p, q) => p.start - q.start);
  const first = acts.filter((x, i) => !acts.slice(0, i).some((y) => y.roles.some((r) => x.roles.some((q) => q.figure === r.figure))));
  c.store.group(() => first.forEach((x) => moveAction(c.store, x.id, x.start + by, `nudge:${x.id}`)));
}

/** What S splits: the action selected, else what the person picked does at the playhead (#22). */
const splitting = (c: Ctx) => {
  const act = actionOf(c);
  if (act) return act;
  const a = c.store.scene.animation;
  const who = c.store.getState().activeFigure;
  const t = c.store.getState().time;
  return a && who ? a.actions.find((x) => !x.layer && x.roles.some((r) => r.figure === who) && x.start < t - 1e-6 && t < x.start + x.duration - 1e-6) : undefined;
};
/** An action that can be played again: a motion, or a keyed block of two keys or more. */
const repeatable = (c: Ctx) => {
  const act = actionOf(c);
  return !!act && !act.layer && (act.source.kind === 'clip' || (act.source.kind === 'keys' && act.duration > 1e-6));
};
/** The time a travel ends at: the context's key, or the end of its walk, run or jump. */
const travelAt = (c: Ctx) => {
  const act = actionOf(c);
  return act?.source.kind === 'travel' ? act.start + act.duration : c.at;
};
const travelHow = (c: Ctx) => {
  const a = c.store.scene.animation;
  const t = travelAt(c);
  if (!a || !c.figure || t === undefined) return null;
  const tr = travelInto(a, c.figure, t);
  const how = tr?.source.kind === 'travel' ? tr.source : null;
  if (!how && (!keyAtTime(a, c.figure, t) || !moments(a, c.figure).some((x) => x < t - 1e-6))) return null;
  return { t, tr, how, kind: how?.mode ?? null, keep: { strafe: how?.strafe, spin: how?.spin, flip: how?.flip } };
};
const setTravelOf = (c: Ctx, k: Travel | null, patch: { strafe?: boolean; spin?: number; flip?: number } = {}) => {
  const h = travelHow(c);
  if (h && c.figure) setTravel(c.store, c.figure, h.t, k, { ...h.keep, ...patch });
};
/** The key times of the active figure, and whether the playhead is on one. */
const keysHere = (c: Ctx) => {
  const a = c.store.scene.animation;
  const f = activeFigure(c);
  if (!a || !f) return { times: [] as number[], on: false };
  const times = keyTimesOf(a, f.id);
  const t = c.store.getState().time;
  return { times, on: times.some((x) => Math.abs(x - t) < 0.5 / a.fps) };
};
/** The camera the timeline's camera row shows: the selected one, or the one filming at the playhead. */
const rowCamera = (c: Ctx) => {
  const { selection, time } = c.store.getState();
  return cameraById(c.store.scene, selection?.kind === 'camera' ? selection.camera : undefined) ?? liveCamera(c.store.scene, time);
};
/** Go to a time worked out from the playhead (playback stops first: the stored time is the frame on screen then). */
const stepTo = (c: Ctx, to: (now: number) => number | undefined) => {
  App().stopPlayback();
  const t = to(c.store.getState().time);
  if (t !== undefined) c.store.setTime(snapTime(c.store.scene.animation!, t));
};
const stops = (c: Ctx) => { const a = c.store.scene.animation!; const f = activeFigure(c); return f ? moments(a, f.id) : moments(a); };
/** Walk, run, jump or step the figure to a spot (the context's, or one picked on the floor). */
const goTo = (c: Ctx, kind: Travel, opts: { strafe?: boolean } = {}) => {
  const f = c.figure ? figureOf(c) : activeFigure(c);
  if (!f) return;
  // (A walk or run with the Steps last chosen for one, #26.)
  const steps = kind === 'walk' || kind === 'run' ? lastSteps(kind) : null;
  const go = (at: Vec3) => c.store.group(() => {
    const done = travelTo(c.store, f.id, [Math.round(at[0] * 100) / 100, Math.round(at[2] * 100) / 100], kind, opts);
    const act = done && steps && actionsOf(c.store.scene.animation!, f.id).find((x) => x.source.kind === 'travel' && Math.abs(x.start + x.duration - done.to) < 1e-3);
    if (!act) return;
    setGait(c.store, act.id, steps);
    // (At its pace, it arrives at another time: the playhead there.)
    const now = c.store.scene.animation!.actions.find((x) => x.id === act.id)!;
    c.store.setTime(now.start + now.duration);
  });
  if (c.floor) go(c.floor);
  else App().pickFloor?.(`Click the floor where ${f.name} should ${opts.strafe ? 'step' : kind} · Esc to cancel`, go);
};

/** The other person nearest the figure at the playhead (whom it would strike). */
const nearestOther = (c: Ctx) => {
  const f = c.figure ? figureOf(c) : activeFigure(c);
  if (!f) return null;
  const s = sceneAt(c.store.scene, c.store.getState().time);
  const me = s.figures.find((x) => x.id === f.id);
  const others = s.figures.filter((x) => x.id !== f.id && !x.proxy && !x.hidden);
  if (!me || !others.length) return null;
  const d = (x: Figure) => Math.hypot(x.position[0] - me.position[0], x.position[2] - me.position[2]);
  return others.reduce((p, q) => (d(q) < d(p) ? q : p));
};

/* ---------------- the commands ---------------- */

/* ---------------- steps from the keyboard ---------------- */

const STEP_KEYS = [
  { id: 'left', key: 'arrowleft', title: 'Step left', help: 'Move what is selected left (a joint: the other side; X, Y or Z held: that slider down)' },
  { id: 'right', key: 'arrowright', title: 'Step right', help: 'Move what is selected right (a joint, X, Y or Z held: that slider up)' },
  { id: 'up', key: 'arrowup', title: 'Step away', help: 'Move what is selected away (a camera: in)' },
  { id: 'down', key: 'arrowdown', title: 'Step nearer', help: 'Move what is selected nearer (a camera: out)' },
  { id: 'turnLeft', key: 'alt+arrowleft', title: 'Turn left', help: 'Turn what is selected left' },
  { id: 'turnRight', key: 'alt+arrowright', title: 'Turn right', help: 'Turn what is selected right' },
  { id: 'turnUp', key: 'alt+arrowup', title: 'Tilt up', help: 'Tilt a camera up, raise a rig camera' },
  { id: 'turnDown', key: 'alt+arrowdown', title: 'Tilt down', help: 'Tilt a camera down, lower a rig camera' },
  { id: 'raise', key: 'pageup', title: 'Raise', help: 'Raise what is selected (a rig camera: a closer shot; the light: higher)' },
  { id: 'lower', key: 'pagedown', title: 'Lower', help: 'Lower what is selected (a rig camera: a wider shot; the light: lower)' },
] as const;
type StepKey = (typeof STEP_KEYS)[number]['id'];

/** How far one step goes: metres and degrees (Shift: three steps). */
const STEP = { move: 0.05, turn: 15, joint: 5, pan: 5, height: 5 };

/** What a step key acts on here, if anything: the camera looked through first, else the selection. */
function stepping(c: Ctx, k: StepKey): { kind: 'figure' | 'prop' | 'many' | 'camera' | 'rig' | 'light' | 'joint'; id?: string } | null {
  const s = c.store;
  const through = s.getState().through;
  if (through) {
    const cam = through.camera ? cameraById(sceneOf(c), through.camera) : liveCamera(sceneOf(c), s.getState().time);
    // (A fixed camera, #21, steps as one on a path does: it moves itself, not round its subject.)
    return cam ? { kind: cam.kind === 'rig' && !cam.rig.fixed ? 'rig' : 'camera', id: cam.id } : null;
  }
  // (Blocks picked on the timeline: Alt + ← → nudges them, #22; the arrows are not the figure's then.)
  if (c.action) return null;
  // A joint: X, Y or Z held with ← → steps that slider (the arrows alone go to another joint).
  if (c.joint) return heldAxis() !== undefined && (k === 'left' || k === 'right') ? { kind: 'joint' } : null;
  if (c.many) return k === 'turnUp' || k === 'turnDown' || k === 'raise' || k === 'lower' ? null : { kind: 'many' };
  if (c.figure) return k === 'turnUp' || k === 'turnDown' || ((k === 'raise' || k === 'lower') && figureOf(c)?.grounded !== false) ? null : { kind: 'figure', id: c.figure };
  if (c.prop) return k === 'turnUp' || k === 'turnDown' || propNow(s, c.prop)?.hold ? null : { kind: 'prop', id: c.prop };
  if (c.camera) {
    const cam = cameraById(sceneOf(c), c.camera);
    if (!cam) return null;
    if (cam.kind === 'rig' && !cam.rig.fixed) return k === 'turnLeft' || k === 'turnRight' ? null : { kind: 'rig', id: cam.id };
    return { kind: 'camera', id: cam.id };
  }
  if (c.light) return k === 'turnUp' || k === 'turnDown' ? null : { kind: 'light', id: c.light };
  return null;
}

/** n steps across the floor to the right (sx) and away (sy), as the editor's view sees them: (dx, dz). */
function floorStep(sx: number, sy: number, n: number) {
  const yaw = ((App().view?.()?.yaw ?? 0) * Math.PI) / 180;
  return [sx * Math.cos(yaw) - sy * Math.sin(yaw), -sx * Math.sin(yaw) - sy * Math.cos(yaw)].map((v) => v * STEP.move * n) as [number, number];
}

/** Take a step: the way the screen shows for moves, Shift for three. */
function step(c: Ctx, k: StepKey) {
  const at = stepping(c, k);
  if (!at) return;
  const n = lastStepShift ? 3 : 1;
  const s = c.store;
  const sx = k === 'left' || k === 'turnLeft' ? -1 : k === 'right' || k === 'turnRight' ? 1 : 0;
  const sy = k === 'up' || k === 'turnUp' || k === 'raise' ? 1 : k === 'down' || k === 'turnDown' || k === 'lower' ? -1 : 0;
  const moving = k === 'left' || k === 'right' || k === 'up' || k === 'down';
  const lift = k === 'raise' || k === 'lower';
  const [dx, dz] = floorStep(sx, sy, n);
  const name = (id?: string) => sceneOf(c).figures.find((f) => f.id === id)?.name ?? sceneOf(c).props.find((p) => p.id === id)?.name ?? sceneOf(c).cameras.find((x) => x.id === id)?.name ?? '';
  const where = (p: Vec3) => `X ${metres(p[0])}  Z ${metres(p[2])}${p[1] > 0.005 ? `  ↑ ${metres(p[1])}` : ''}`;
  switch (at.kind) {
    case 'figure': {
      // X, Y or Z held with ← →: lean it forward or back, turn it, lean it to the side.
      const axis = sx && !sy ? heldAxis() : undefined;
      if (axis !== undefined) {
        if (axis === 1) turnFigure(s, at.id!, -sx * STEP.joint * n);
        else stepJoint(s, at.id!, 'hips', axis, sx * STEP.joint * n);
        const f = figureOf({ store: s, figure: at.id })!;
        flashReadout(`${name(at.id)} · ${axis === 1 ? `faces ${Math.round(facing(f))}°` : sliderText('hips', axis, angle(f.bones, 'hips')[axis])}`);
        break;
      }
      if (moving) stepFigure(s, at.id!, dx, dz);
      else if (lift) stepFigure(s, at.id!, 0, 0, sy * STEP.move * n);
      else turnFigure(s, at.id!, -sx * STEP.turn * n);
      flashReadout(`${name(at.id)} · ${k.startsWith('turn') ? `faces ${Math.round(facing(figureOf({ store: s, figure: at.id })!))}°` : where(figureOf({ store: s, figure: at.id })!.position)}`);
      break;
    }
    case 'prop':
      if (moving) stepProp(s, at.id!, dx, dz);
      else if (lift) stepProp(s, at.id!, 0, 0, sy * STEP.move * n);
      else turnProp(s, at.id!, -sx * STEP.turn * n);
      flashReadout(`${name(at.id)} · ${where(sceneOf(c).props.find((p) => p.id === at.id)!.position)}`);
      break;
    case 'many':
      if (moving) stepMany(s, c.many!.figures, c.many!.props, { dx, dz });
      else stepMany(s, c.many!.figures, c.many!.props, { turn: -sx * STEP.turn * n });
      flashReadout(moving ? `Moved ${metres(Math.hypot(dx, dz))} m` : `Turned ${-sx * STEP.turn * n}°`);
      break;
    case 'joint': {
      const axis = heldAxis() ?? 0;
      const v = stepJoint(s, c.figure!, c.joint!, axis, sx * STEP.joint * n);
      if (v !== null) flashReadout(sliderText(c.joint!, axis, v));
      break;
    }
    case 'camera':
      stepCamera(s, at.id!, moving
        ? { right: sx * STEP.move * n * 2, forward: sy * STEP.move * n * 2 }
        : lift ? { up: sy * STEP.move * n * 2 } : { pan: sx * STEP.pan * n, tilt: sy * STEP.pan * n });
      flashReadout(`${name(at.id)} · ${moving ? (sx ? 'across' : sy > 0 ? 'in' : 'out') : lift ? (sy > 0 ? 'up' : 'down') : sx ? 'panned' : 'tilted'}`);
      break;
    case 'rig': {
      const cam = cameraById(sceneOf(c), at.id) as RigCamera;
      if (lift || (!sx && moving)) stepRig(s, cam, sy * n, false);
      else if (k === 'turnUp' || k === 'turnDown') editRig(s, cam.id, { pitch: rigPitch(cam.rig.pitch + sy * STEP.height * n) }, `step:${cam.id}`);
      else editRig(s, cam.id, { yaw: cam.rig.yaw + sx * STEP.turn * n }, `step:${cam.id}`);
      const now = cameraById(sceneOf(c), at.id) as RigCamera;
      flashReadout(`${now.name} · ${rigAngle(now.rig.yaw)}, ${Math.round(now.rig.pitch)}° up`);
      break;
    }
    case 'light': {
      const l = lightingOf(sceneOf(c)).lights.find((x) => x.id === at.id);
      if (!l) break;
      // The sun round and up; a lamp or a window across the floor (as the view shows it) and up.
      const next = l.kind !== 'sun'
        ? clampLight({ ...l, position: lift ? [l.position[0], l.position[1] + sy * STEP.move * n * 2, l.position[2]] : [l.position[0] + dx, l.position[1], l.position[2] + dz] })
        : clampLight(lift || sy ? { ...l, elevation: l.elevation + sy * STEP.height * n } : { ...l, azimuth: wrapDeg(l.azimuth - sx * STEP.turn * n) });
      editLight(s, l.id, next, `step:${l.id}`);
      flashReadout(lightText(next));
      break;
    }
  }
}

/** The keys that move whole performances: Ctrl (Cmd) with the arrows; with Alt, ← → turn them. */
const WHOLE_KEYS = [
  { id: 'left', title: 'Move it all left' },
  { id: 'right', title: 'Move it all right' },
  { id: 'up', title: 'Move it all away' },
  { id: 'down', title: 'Move it all nearer' },
  { id: 'turnLeft', title: 'Turn it all left' },
  { id: 'turnRight', title: 'Turn it all right' },
] as const;

/** Whose whole performances the Ctrl keys move: the figure selected, or the figures among several. */
function performers(c: Ctx): string[] | null {
  if (c.store.getState().through || c.joint) return null;
  return c.many?.figures.length ? c.many.figures : c.figure ? [c.figure] : null;
}

/** Move or turn whole performances a step (no key; those acting with them come too). */
function wholeStep(c: Ctx, k: StepKey) {
  const ids = performers(c);
  if (!ids) return;
  const n = lastStepShift ? 3 : 1;
  const sx = k === 'left' || k === 'turnLeft' ? -1 : k === 'right' || k === 'turnRight' ? 1 : 0;
  const sy = k === 'up' ? 1 : k === 'down' ? -1 : 0;
  const [dx, dz] = floorStep(sx, sy, n);
  const turning = k.startsWith('turn');
  const moved = offsetPerformance(c.store, ids, turning ? { turn: -sx * STEP.turn * n } : { dx, dz }, `whole:${ids.join(',')}`);
  flashReadout(`${wholeText(c, ids, moved)} · ${turning ? `turned ${-sx * STEP.turn * n}°` : `moved ${Math.round(Math.hypot(dx, dz) * 100)} cm`}`);
}

/** "Kai's whole performance", "with Ben (they act together)". */
function wholeText(c: Ctx, ids: string[], moved: string[]) {
  const name = (id: string) => sceneOf(c).figures.find((f) => f.id === id)?.name ?? '';
  const who = ids.length === 1 ? `${name(ids[0])}'s whole performance` : 'Their whole performances';
  const others = moved.filter((id) => !ids.includes(id));
  return others.length ? `${who}, with ${others.map(name).join(', ')} (acting together)` : who;
}

/** Select the next (1) or previous (-1) thing in the scene: its figures, props, cameras, then the light. */
function cycleSelection(c: Ctx, dir: 1 | -1) {
  const s = sceneOf(c);
  const things: NonNullable<Selection>[] = [
    ...s.figures.filter((f) => !f.hidden).map((f) => ({ kind: 'figure' as const, figure: f.id })),
    ...s.props.map((p) => ({ kind: 'prop' as const, prop: p.id })),
    ...s.cameras.map((x) => ({ kind: 'camera' as const, camera: x.id })),
    ...lightingOf(s).lights.map((l) => ({ kind: 'light' as const, light: l.id })),
  ];
  const id = (x: Selection) => (!x ? '' : x.kind === 'figure' || x.kind === 'joint' ? x.figure : x.kind === 'prop' ? x.prop : x.kind === 'camera' ? x.camera : x.kind === 'light' ? x.light : x.kind);
  const now = things.findIndex((x) => id(x) === id(c.store.getState().selection));
  const next = things[now < 0 ? (dir > 0 ? 0 : things.length - 1) : (now + dir + things.length) % things.length];
  c.store.select(next);
  App().frameSelection?.();
}

/** What the step keys do for what is selected, for the hint ("← → ↑ ↓: move · Alt ← →: turn"). */
export function stepHint(c: Ctx): string | null {
  // (A joint's keys go with X, Y or Z held: said for it all the same.)
  const at = stepping(c, 'turnLeft') ?? stepping(c, 'left') ?? (c.joint && !c.store.getState().through ? { kind: 'joint' as const } : null);
  const shift = ' · Shift: ×3';
  const whole = animated(c) ? ' · Ctrl: all it does' : '';
  switch (at?.kind) {
    case 'figure': return `Arrows: move ${figureOf(c)?.name} · Alt ← →: turn · Y / X / Z + ← →: turn, lean${figureOf(c)?.grounded === false ? ' · Page ↑ ↓: up, down' : ''}${whole}${shift}`;
    case 'prop': return `Arrows: move · Alt ← →: turn · Page ↑ ↓: up, down · R: ${c.store.getState().settings.gizmo === 'scale' ? 'move' : 'scale'}${shift}`;
    case 'many': return `Arrows: move them · Alt ← →: turn them${c.many?.figures.length ? whole : ''}${shift}`;
    case 'joint': return `X / Y / Z + ← →: Bend / Twist / Side 5° · Arrows: next joint · Esc: the whole figure${shift}`;
    case 'camera': return `← →: across · ↑ ↓: in, out · Page Up / Down: up, down · Alt ← → ↑ ↓: pan, tilt${shift}`;
    case 'rig': return `← →: its angle 15° · Alt ↑ ↓: its height · Page Up / Down: closer, wider${shift}`;
    case 'light': return `← →: round 15° · Page Up / Down: higher, lower${shift}`;
    default: return null;
  }
}

/**
 * Whether the step key just pressed was pressed with Shift (the keys run commands without their
 * event); a step from a menu or the palette is one step.
 */
let lastStepShift = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { lastStepShift = e.shiftKey && /^(Arrow|Page)/.test(e.key); }, true);
  window.addEventListener('pointerdown', () => { lastStepShift = false; }, true);
}

export const COMMANDS: Command[] = [
  // The app.
  { id: 'app.undo', title: 'Undo', icon: Undo2, keys: ['mod+z'], enabled: (c) => c.store.getState().canUndo, run: (c) => c.store.undo() },
  { id: 'app.redo', title: 'Redo', icon: Redo2, keys: ['mod+shift+z', 'mod+y'], enabled: (c) => c.store.getState().canRedo, run: (c) => c.store.redo() },
  { id: 'app.save', title: 'Save', help: 'Save the project to a file', icon: Save, keys: ['mod+s'], run: () => App().saveFile() },
  { id: 'app.newScene', title: 'New scene…', help: 'A new scene: empty or from a template', icon: FilePlus2, run: () => App().dialog('start') },
  { id: 'app.exportVideo', title: 'Export video', icon: Film, when: animated, run: () => App().dialog('export-video') },
  { id: 'app.import', title: 'Add scenes…', help: 'Add the scenes of a project file to this one', icon: FileUp, run: () => App().openFile('append') },
  { id: 'app.open', title: 'Open…', help: 'Open a project in place of this one', icon: FolderOpen, run: () => App().openFile('replace') },
  { id: 'app.export', title: 'Export', icon: Download, keys: ['mod+e'], run: () => App().dialog('export') },
  { id: 'app.photo', title: 'Figures from a photo…', icon: ScanFace, run: () => App().dialog('photo') },
  { id: 'app.practice', title: 'Practice', help: 'Gesture practice: timed poses to draw', icon: Timer, keys: ['p'], run: () => App().dialog('practice') },
  { id: 'app.board', title: 'Storyboard', icon: LayoutPanelTop, keys: ['b'], run: () => { App().stopPlayback(); App().dialog('board'); } },
  { id: 'app.help', title: 'Shortcuts', help: 'Keyboard shortcuts', icon: Keyboard, keys: ['?'], run: () => App().dialog('help') },
  { id: 'app.palette', title: 'Find a command…', icon: Search, keys: ['mod+k'], run: () => App().dialog('palette') },
  {
    id: 'app.inspector', title: 'Show the inspector', help: 'Show / hide the inspector', icon: PanelRightClose, keys: ['i'],
    checked: (c) => c.store.getState().settings.inspector, run: (c) => c.store.setSettings({ inspector: !c.store.getState().settings.inspector }),
  },
  {
    id: 'app.theme', title: 'Theme', icon: SunMoon,
    items: (c) => THEMES.map((t) => ({ title: t === 'system' ? 'As the system' : t === 'light' ? 'Light' : 'Dark', checked: c.store.getState().settings.theme === t, run: () => c.store.setSettings({ theme: t }) })),
  },
  { id: 'app.prevScene', title: 'Previous scene', keys: ['['], enabled: (c) => c.store.getState().sceneIndex > 0, run: (c) => c.store.setSceneIndex(c.store.getState().sceneIndex - 1) },
  {
    id: 'app.nextScene', title: 'Next scene', keys: [']'], enabled: (c) => c.store.getState().sceneIndex < c.store.getState().library.scenes.length - 1,
    run: (c) => c.store.setSceneIndex(c.store.getState().sceneIndex + 1),
  },
  {
    id: 'app.deselect', title: (c) => (c.store.getState().through ? 'Stop looking through' : c.store.getState().selection?.kind === 'joint' ? 'Up to the figure' : 'Deselect'),
    help: 'Up a level: a part to its figure, else nothing selected (looking through a camera: stop)', icon: X, keys: ['escape'],
    run: (c) => {
      const sel = c.store.getState().selection;
      if (c.store.getState().through) c.store.lookThrough(null);
      else c.store.select(sel?.kind === 'joint' ? { kind: 'figure', figure: sel.figure } : null);
    },
  },

  // The canvas's tools (#38): what a drag on a figure does.
  { id: 'tool.pose', title: 'Pose', help: 'Pose: drag a hand or foot to reach (the limb follows), any other part to swing it, the hips to sink or shift', icon: PersonStanding, keys: ['q'], checked: (c) => c.store.getState().tool === 'pose', run: (c) => c.store.setTool('pose') },
  { id: 'tool.move', title: 'Move', help: 'Move: drag any part of a figure, or a prop, to place it on the floor (Shift: turn it)', icon: Move, keys: ['w'], checked: (c) => c.store.getState().tool === 'move', run: (c) => c.store.setTool('move') },
  { id: 'tool.rotate', title: 'Rotate', help: 'Rotate: drag any part to turn it at its joint, hands and feet too', icon: Rotate3d, keys: ['e'], checked: (c) => c.store.getState().tool === 'rotate', run: (c) => c.store.setTool('rotate') },
  {
    id: 'tool.bodyFollows', title: 'Body follows', help: 'Posing: a hand reaching beyond the arm brings the shoulder and the chest along', icon: Bone,
    checked: (c) => c.store.getState().settings.bodyFollows, run: (c) => c.store.setSettings({ bodyFollows: !c.store.getState().settings.bodyFollows }),
  },
  {
    // A selected prop's gizmo: moving it, or (R, again: back) scaling it.
    id: 'tool.moveProp', title: 'Move the prop', help: 'Move the prop with its gizmo, along the floor or up and down (R: scale it)', icon: Move, when: (c) => c.store.getState().selection?.kind === 'prop',
    checked: (c) => c.store.getState().settings.gizmo !== 'scale', run: (c) => c.store.setSettings({ gizmo: 'translate' }),
  },
  {
    id: 'tool.scale', title: 'Scale the prop', help: 'Scale the prop with its gizmo (R again: move it)', icon: Scale3d, keys: ['r'], when: (c) => c.store.getState().selection?.kind === 'prop',
    checked: (c) => c.store.getState().settings.gizmo === 'scale', run: (c) => c.store.setSettings({ gizmo: c.store.getState().settings.gizmo === 'scale' ? 'translate' : 'scale' }),
  },
  { id: 'tool.limits', title: 'Joint limits', help: 'Joint limits: parts bend only as far as a body does', icon: Lock, checked: (c) => c.store.getState().settings.limits, run: (c) => c.store.setSettings({ limits: !c.store.getState().settings.limits }) },

  // The view.
  ...VIEW_PRESETS.map((v): Command => ({ id: `view.${v.key}`, title: v.label, keys: [v.key], run: (c) => { c.store.lookThrough(null); App().frameView(v); } })),
  { id: 'view.frameAll', title: 'Frame all', icon: Maximize, run: () => App().frameAll() },
  { id: 'view.stageOnly', title: 'Scene only', help: 'The scene filling the window, without the panels (Esc, or again: back)', icon: Maximize2, keys: ['shift+f'], checked: () => App().stageOnly(), run: () => App().setStageOnly(!App().stageOnly()) },
  {
    id: 'view.frame', title: (c) => (['figure', 'joint', 'prop', 'light', 'camera', 'many'].includes(c.store.getState().selection?.kind ?? '') ? 'Frame the selection' : 'Frame all'), help: 'The selection in the middle, close up (everything when nothing is selected)',
    icon: Focus, keys: ['f'], run: () => App().frameSelected(),
  },
  {
    // Only the selection on the canvas (the scene, the shot camera and exports are not affected).
    id: 'view.isolate', title: 'Only the selection', icon: Crosshair, keys: ['/'],
    when: (c) => !!App().isolated() || !!(c.prop || (c.figure && !c.action)), checked: () => !!App().isolated(),
    run: (c) => App().setIsolated(App().isolated() ? null : c.prop ?? c.figure ?? null),
  },
  {
    id: 'view.through', title: 'Look through', icon: Video,
    items: (c) => {
      const through = c.store.getState().through;
      return [
        { title: 'Free view', checked: !through, run: () => c.store.lookThrough(null) },
        { title: 'Shot camera', checked: !!through && !through.camera, run: () => c.store.lookThrough({}) },
        ...sceneOf(c).cameras.map((cam) => ({ title: cam.name, icon: Video, checked: through?.camera === cam.id, run: () => c.store.lookThrough({ camera: cam.id }) })),
      ];
    },
  },
  { id: 'view.handles', title: 'Handles', icon: Move3d, help: 'Show the handles: a joint’s rotate gizmo, the floor rings', keys: ['h'], checked: (c) => c.store.getState().settings.showHandles, run: (c) => c.store.setSettings({ showHandles: !c.store.getState().settings.showHandles }) },
  { id: 'view.grid', title: 'Grid', help: 'The floor grid', icon: Grid3x3, checked: (c) => c.store.getState().settings.showGrid, run: (c) => c.store.setSettings({ showGrid: !c.store.getState().settings.showGrid }) },
  { id: 'view.onion', title: 'Onion skin', help: 'Onion skin: the keys before and after, faint', icon: Ghost, when: animated, checked: () => App().onion(), run: () => App().setOnion(!App().onion()) },
  { id: 'view.guides', title: 'Guides', help: 'Framing guides: thirds and safe areas', icon: Frame, checked: (c) => c.store.getState().settings.guides, run: (c) => c.store.setSettings({ guides: !c.store.getState().settings.guides }) },
  {
    id: 'view.line', title: 'Line weight', icon: PenLine, when: (c) => !!styleDef(projectSettingsOf(c.store.getState().library).style).outline,
    items: (c) => [{ label: 'Thin', px: 1 }, { label: 'Medium', px: 1.6 }, { label: 'Bold', px: 2.4 }].map((w) => ({
      title: w.label, checked: Math.abs(c.store.getState().settings.editorLine - w.px) < 0.05, run: () => c.store.setSettings({ editorLine: w.px }),
    })),
  },
  {
    // The frame every scene is filmed in: the letterbox, the storyboard, videos and keyframe packs.
    id: 'view.aspect', title: 'Frame', icon: RectangleHorizontal,
    items: (c) => FRAME_SHAPES.map((f) => ({ title: FRAME_LABELS[f], checked: f === projectSettingsOf(c.store.getState().library).frame, run: () => editProjectSettings(c.store, { frame: f }) })),
  },
  {
    id: 'view.style', title: 'Render style', iconFor: (c) => STYLE_ICONS[projectSettingsOf(c.store.getState().library).style],
    items: (c) => STYLE_LIST.map((s) => ({ title: s.label, icon: STYLE_ICONS[s.id], checked: s.id === projectSettingsOf(c.store.getState().library).style, run: () => editProjectSettings(c.store, { style: s.id }) })),
  },
  {
    id: 'view.nextStyle', title: 'Next render style', keys: ['l'],
    run: (c) => { const style = projectSettingsOf(c.store.getState().library).style; editProjectSettings(c.store, { style: STYLES[(STYLES.indexOf(style) + 1) % STYLES.length] }); },
  },

  // Steps from the keyboard (#13): the arrows move what is selected the way the screen shows,
  // Alt + arrows turn it, Page Up / Down raise or lower it; Shift: three steps. (A joint keeps the
  // arrows to go between joints; Alt + arrows turn its slider.)
  ...STEP_KEYS.map((k): Command => ({
    id: `step.${k.id}`, title: k.title, help: k.help, keys: [k.key, `${k.key.startsWith('alt+') ? 'alt+shift+' + k.key.slice(4) : 'shift+' + k.key}`],
    when: (c) => !!stepping(c, k.id),
    run: (c) => step(c, k.id),
  })),

  // Whole performances (#13, a track offset): Ctrl (Cmd) + the arrows move all a figure does, Ctrl
  // + Alt + ← → turn it, without a key; in a still scene, as the arrows.
  ...WHOLE_KEYS.map((k): Command => {
    const key = STEP_KEYS.find((x) => x.id === k.id)!.key;
    const shift = key.startsWith('alt+') ? `mod+alt+shift+${key.slice(4)}` : `mod+shift+${key}`;
    return { id: `whole.${k.id}`, title: k.title, keys: [`mod+${key}`, shift], when: (c) => !!performers(c), run: (c) => wholeStep(c, k.id) };
  }),
  {
    id: 'figure.wholeTo', title: (c) => (c.floor ? 'Move it all here' : 'Move it all to…'),
    help: 'Move everything the figure does so that it is at a spot at the playhead (no key)', icon: Move3d,
    when: (c) => animated(c) && movable(c),
    run: (c) => {
      const f = c.figure ? figureOf(c) : activeFigure(c);
      if (!f) return;
      const go = (at: Vec3) => {
        const now = figureOf({ store: c.store, figure: f.id })!.position;
        const moved = offsetPerformance(c.store, [f.id], { dx: at[0] - now[0], dz: at[2] - now[2] });
        flashReadout(`${wholeText(c, [f.id], moved)} · moved`);
      };
      if (c.floor) go(c.floor);
      else App().pickFloor?.(`Click the floor where ${f.name} should be now, with all it does · Esc to cancel`, go);
    },
  },

  // Tab: from one thing in the scene to the next (#13), brought into view if it is out of it.
  { id: 'select.next', title: 'Select the next thing', help: 'Select the next thing in the scene (with the focus on the canvas)', keys: ['tab'], run: (c) => cycleSelection(c, 1) },
  { id: 'select.prev', title: 'Select the previous thing', help: 'Select the previous thing in the scene', keys: ['shift+tab'], run: (c) => cycleSelection(c, -1) },

  // Several things at once.
  {
    id: 'many.duplicate', title: (c) => `Duplicate ${count(c)}`, help: 'Duplicate the things selected (Shift-click adds one)', icon: Copy, keys: ['mod+d'], when: (c) => !!c.many,
    run: (c) => duplicateMany(c.store, c.many!.figures, c.many!.props),
  },
  {
    id: 'many.delete', title: (c) => `Delete ${count(c)}`, help: 'Delete the things selected', icon: Trash2, keys: ['delete', 'backspace'], danger: true, when: (c) => !!c.many,
    run: (c) => { const n = deleteMany(c.store, c.many!.figures, c.many!.props); App().notifyUndo(`Deleted ${n} ${n === 1 ? 'thing' : 'things'}`); },
  },
  {
    id: 'many.hide', title: 'Hide the figures', icon: EyeOff, when: (c) => !!c.many?.figures.length,
    run: (c) => c.store.group(() => c.many!.figures.forEach((id) => setFigureHidden(c.store, id, true))),
  },

  // The scene's lights.
  {
    id: 'light.preset', title: 'Lighting scheme', icon: SunMedium, when: (c) => !!c.light || onScene(c),
    items: (c) => LIGHTING_PRESETS.map((p) => ({ title: p.name, checked: lightingOf(sceneOf(c)).scheme === p.id, run: () => applyLightingPreset(c.store, p.id) })),
  },
  {
    id: 'light.add', title: 'Add a light', help: `A sun, a lamp or a window, or a lamp put as a fill or a rim (up to ${MAX_LIGHTS})`, icon: Plus, when: (c) => !!c.light || onScene(c),
    enabled: (c) => lightingOf(sceneOf(c)).lights.length < MAX_LIGHTS,
    items: (c) => ([...LIGHT_KINDS, 'fill', 'rim'] as const).map((w) => ({
      title: w === 'fill' ? 'Fill light' : w === 'rim' ? 'Rim light' : KIND_NAMES[w],
      run: () => { addLight(c.store, w); },
    })),
  },
  {
    id: 'light.fromView', title: 'Light from this view', icon: Lightbulb, when: (c) => !!c.light || onScene(c),
    run: (c) => {
      const v = App().captureShot();
      const l = lightOf(c);
      if (v) editLight(c.store, l.id, lightFrom(l, v.position.clone().sub(v.target), subjectOf(sceneOf(c))));
    },
  },
  {
    id: 'light.place', title: 'Role', help: 'What the light is for: a key, a fill or a rim is put where it goes round the people', icon: SunMedium, when: (c) => !!c.light && !lightOf(c).ofSet,
    // (As the light's inspector has them.)
    items: (c) => [...LIGHT_ROLES, null].map((r) => ({
      title: r ? ROLE_NAMES[r] : 'None',
      checked: (lightOf(c).role ?? null) === r,
      run: () => (r === 'key' || r === 'fill' || r === 'rim' ? placeSceneLight(c.store, lightOf(c).id, r) : setLightRole(c.store, lightOf(c).id, r)),
    })),
  },
  {
    id: 'light.shadows', title: 'Shadows', help: 'Only the key casts shadows', icon: SunMedium, when: (c) => !!c.light && lightOf(c).kind === 'sun' && keyLight(lightingOf(sceneOf(c)))?.id === c.light, checked: (c) => lightOf(c).shadows,
    run: (c) => editLight(c.store, lightOf(c).id, { shadows: !lightOf(c).shadows }),
  },
  {
    id: 'light.clay', title: 'See the light in Clay', icon: SunMedium, when: (c) => !!c.light && !styleDef(projectSettingsOf(c.store.getState().library).style).lit,
    run: (c) => editProjectSettings(c.store, { style: 'shaded' }),
  },
  {
    id: 'light.delete', title: 'Delete', icon: Trash2, keys: ['delete', 'backspace'], danger: true, when: (c) => !!c.light && !lightOf(c).ofSet,
    enabled: (c) => lightingOf(sceneOf(c)).lights.length > 1,
    run: (c) => { const name = lightOf(c).name; if (deleteLight(c.store, lightOf(c).id)) App().notifyUndo(`Deleted ${name}`); },
  },

  // The selection.
  {
    id: 'rename', title: 'Rename', help: 'Rename the selection', icon: Pencil, keys: ['f2'],
    // (With nothing selected: the active figure.)
    when: (c) => (!!(c.figure || c.prop || c.shot || c.camera) && !c.action) || (!c.action && !c.floor && c.scene === undefined && !!c.store.figure),
    run: (c) => renameInOutline(c.store, (c.prop ?? c.shot ?? c.camera ?? c.figure ?? c.store.figure!.id)),
  },
  {
    id: 'duplicate', title: 'Duplicate', help: 'Duplicate the selection', icon: Copy, keys: ['mod+d'],
    when: (c) => !!(c.figure || c.prop || c.camera) && !c.action && !c.shot,
    run: (c) => (c.prop ? duplicateProp(c.store, c.prop) : c.camera ? duplicateCamera(c.store, c.camera) : duplicateFigure(c.store, c.figure!)),
  },

  // A pose (the active figure's).
  { id: 'pose.mirror', title: 'Mirror pose', icon: FlipHorizontal2, keys: ['m'], run: (c) => mirrorPose(c.store) },
  { id: 'pose.leftToRight', title: 'Copy left side onto right', run: (c) => symmetrizePose(c.store, 'L') },
  { id: 'pose.rightToLeft', title: 'Copy right side onto left', run: (c) => symmetrizePose(c.store, 'R') },
  { id: 'pose.copy', title: 'Copy pose', icon: ClipboardCopy, keys: ['mod+c'], when: (c) => !c.action && !window.getSelection()?.toString(), run: (c) => { if (copyPose(c.store)) App().notify('Pose copied'); } },
  { id: 'pose.paste', title: 'Paste pose', icon: ClipboardPaste, keys: ['mod+v'], when: (c) => !c.action, run: (c) => { if (!pastePose(c.store)) App().notify('Copy a pose first', 'error'); } },
  { id: 'pose.reset', title: 'Reset pose', icon: RotateCcw, run: (c) => resetPose(c.store) },

  // A part of a figure (the selected joint).
  {
    // What a selected hand holds: let go of it here (at the playhead; it falls).
    id: 'hand.letGo', title: (c) => `Let go of ${heldIn(c)?.name ?? 'it'} here`, icon: ArrowDownToLine, when: (c) => !!heldIn(c),
    run: (c) => holdProp(c.store, heldIn(c)!.id, null),
  },
  {
    // (#38: held where it is while the rest of the figure is posed.)
    id: 'joint.pin', title: 'Pinned', help: 'Pinned, the hand or foot stays where it is while the rest of the figure is posed', icon: Pin,
    when: (c) => !!c.joint && PIN_ENDS.includes(c.joint as PinEnd), checked: (c) => pinned(c), run: (c) => c.store.togglePin(c.figure!, c.joint as PinEnd),
  },
  { id: 'joint.reset', title: 'Reset the joint', icon: RotateCcw, when: (c) => !!c.joint, run: (c) => setJoint(c.store, c.figure!, c.joint!, [0, 0, 0], '') },
  {
    id: 'joint.mirror', title: 'Mirror to the other side', icon: FlipHorizontal2, when: (c) => !!c.joint && mirrorJointName(c.joint) !== c.joint,
    run: (c) => {
      const other = mirrorJointName(c.joint!);
      c.store.updateFigure(c.figure!, (f) => ({ ...f, bones: { ...f.bones, [other]: mirrorBones(f.bones)[other] } }));
    },
  },
  {
    id: 'joint.parent', title: 'The joint above', icon: ArrowUp, keys: ['arrowup'], when: (c) => !!c.joint && c.joint !== 'hips',
    run: (c) => c.store.select({ kind: 'joint', figure: c.figure!, joint: PARENT[c.joint as Exclude<JointName, 'hips'>] as JointName }),
  },
  {
    id: 'joint.child', title: 'The joint below', icon: ArrowDown, keys: ['arrowdown'], when: (c) => !!c.joint && !!childOf(c.joint),
    run: (c) => c.store.select({ kind: 'joint', figure: c.figure!, joint: childOf(c.joint!)! }),
  },
  {
    id: 'joint.otherSide', title: 'Other side', help: 'The same joint on the other side', icon: ArrowLeftRight, keys: ['arrowleft', 'arrowright'],
    when: (c) => !!c.joint && mirrorJointName(c.joint) !== c.joint,
    run: (c) => c.store.select({ kind: 'joint', figure: c.figure!, joint: mirrorJointName(c.joint!) }),
  },

  // A figure.
  {
    id: 'figure.hide', title: (c) => (figureOf(c)?.hidden ? 'Show' : 'Hide'), iconFor: (c) => (figureOf(c)?.hidden ? Eye : EyeOff), when: (c) => !!c.figure && !c.action,
    run: (c) => setFigureHidden(c.store, c.figure!, !figureOf(c)!.hidden),
  },
  {
    id: 'figure.pose', title: 'Choose a pose…', icon: PersonStanding, when: (c) => !!figureOf(c) && !figureOf(c)!.proxy && !c.action,
    run: (c) => { c.store.select({ kind: 'figure', figure: c.figure! }); c.store.setSettings({ side: 'poses' }); },
  },
  {
    id: 'figure.motion', title: 'Choose a motion…', icon: Film, when: (c) => !!figureOf(c) && !figureOf(c)!.proxy && !c.action,
    run: (c) => { c.store.select({ kind: 'figure', figure: c.figure! }); c.store.setSettings({ side: 'motions' }); },
  },
  {
    id: 'figure.savePose', title: 'Save pose to library', icon: BookmarkPlus, when: (c) => !!figureOf(c) && !figureOf(c)!.proxy && !c.action,
    run: (c) => { const saved = savePose(c.store, c.figure!, `${c.store.scene.name} · ${figureOf(c)!.name}`); if (saved) App().notifyUndo(`Saved “${saved.name}” to the library`); },
  },
  // Getting somewhere: picked on the floor (or the spot right-clicked).
  {
    id: 'figure.standUp', title: 'Gets up', help: 'Stands up from where it sits, at the playhead', icon: ArrowUpFromDot,
    when: (c) => !!c.figure && sittingAt(sceneOf(c), c.figure, c.store.getState().time), run: (c) => { standUp(c.store, c.figure!); },
  },
  {
    // (#18: stepping in to where the blow reaches the nearest other person, turned so it lands, and they react as it does.)
    id: 'figure.strike', title: (c) => `Strike ${nearestOther(c)?.name ?? ''}`, icon: Zap, when: (c) => movable(c) && !!nearestOther(c),
    items: (c) => STRIKES.map((x) => ({
      title: x.name,
      icon: Zap,
      run: () => {
        const f = c.figure ? figureOf(c) : activeFigure(c);
        const them = nearestOther(c);
        if (!f || !them) return;
        void Promise.all([fetchLibraryClip(x.id), fetchLibraryClip(x.reaction)]).then((ok) => {
          if (!ok.every(Boolean) || strikeFigure(c.store, f.id, them.id, x.id) === null) App().notify('Could not load the strike: try again when online');
        });
      },
    })),
  },
  {
    // (Stepping round where it stands, #18.)
    id: 'figure.turn', title: (c) => (c.floor ? 'Turn to face here' : 'Turn to face…'), icon: RotateCw, when: (c) => movable(c),
    run: (c) => {
      const f = c.figure ? figureOf(c) : activeFigure(c);
      if (!f) return;
      const turn = (at: Vec3) => { if (!turnTo(c.store, f.id, [at[0], at[2]])) App().notify(`${f.name} already faces that way`); };
      if (c.floor) turn(c.floor);
      else App().pickFloor?.(`Click the floor where ${f.name} should face · Esc to cancel`, turn);
    },
  },
  {
    // (A set's own seat, a café's chair, a bench: as a chair prop is sat on, facing its table if it is at one.)
    id: 'figure.sitHere', title: 'Sit here', icon: Armchair,
    when: (c) => movable(c) && !!c.top && !!seatAt(sceneOf(c).set, c.top[0], c.top[2]),
    run: (c) => { const f = c.figure ? figureOf(c) : activeFigure(c); if (f && !sitAt(c.store, f.id, c.top![0], c.top![2])) App().notify(`${f.name} cannot get there`); },
  },
  { id: 'figure.walk', title: (c) => (c.floor ? 'Walk here' : 'Walk to…'), icon: Footprints, when: (c) => movable(c), run: (c) => goTo(c, 'walk') },
  { id: 'figure.run', title: (c) => (c.floor ? 'Run here' : 'Run to…'), icon: Wind, when: (c) => movable(c), run: (c) => goTo(c, 'run') },
  { id: 'figure.jump', title: (c) => (c.floor ? 'Jump here' : 'Jump to…'), icon: MoveUpRight, when: (c) => movable(c), run: (c) => goTo(c, 'jump') },
  { id: 'figure.step', title: (c) => (c.floor ? 'Step here, keeping facing' : 'Step to…, keeping facing'), icon: ArrowLeftRight, when: (c) => movable(c), run: (c) => goTo(c, 'walk', { strafe: true }) },
  {
    id: 'figure.throw', title: (c) => (c.floor ? 'Throw here' : 'Throw to…'), icon: Send,
    when: (c) => movable(c) && heldBy(c).length > 0,
    items: (c) => heldBy(c).map((p) => ({
      title: c.floor ? `Throw ${p.name} here` : `${p.name}`,
      icon: Send,
      run: () => {
        const at = (s: Vec3) => throwProp(c.store, p.id, { at: [Math.round(s[0] * 100) / 100, Math.round(s[2] * 100) / 100] });
        if (c.floor) at(c.floor);
        else App().pickFloor?.(`Click the floor where ${p.name} should land · Esc to cancel`, at);
      },
    })),
  },
  {
    id: 'figure.eyes', title: 'Eyes on', icon: Eye,
    when: (c) => !!figureOf(c) && !figureOf(c)!.proxy && !c.action && (sceneOf(c).figures.some((x) => x.id !== c.figure && !x.hidden) || sceneOf(c).props.length > 0),
    items: (c) => {
      const f = figureOf(c)!;
      const on = f.gaze;
      return [
        {
          title: 'What you click…', icon: Eye,
          run: () => App().pickThing?.(`Click a figure or a prop for ${f.name} to look at · Esc cancels`, (hit) => {
            if (hit.figure && hit.figure !== f.id) setGaze(c.store, f.id, { figure: hit.figure });
            else if (hit.prop) setGaze(c.store, f.id, { prop: hit.prop });
          }),
        },
        { title: 'Free (as posed)', icon: Eye, checked: !on, run: () => setGaze(c.store, f.id, null) },
        ...sceneOf(c).figures.filter((x) => x.id !== f.id && !x.hidden).map((x) => ({ title: x.name, icon: Eye, checked: !!on && 'figure' in on && on.figure === x.id, run: () => setGaze(c.store, f.id, { figure: x.id }) })),
        ...sceneOf(c).props.map((p) => ({ title: p.name, icon: Eye, checked: !!on && 'prop' in on && on.prop === p.id, run: () => setGaze(c.store, f.id, { prop: p.id }) })),
      ];
    },
  },
  {
    // A hand kept on someone else's body from now to the end of what it is doing.
    id: 'figure.holdOn', title: 'Hold on to', icon: Hand,
    when: (c) => !!figureOf(c) && !figureOf(c)!.proxy && !c.action && sceneOf(c).figures.some((x) => x.id !== c.figure && !x.hidden && !x.proxy),
    items: (c) => {
      const hold = (b: string, contact: Contact) => {
        if (!holdOn(c.store, c.figure!, 'R', b, contact)) App().notify(`${sceneOf(c).figures.find((x) => x.id === b)?.name} is out of reach`, 'error');
      };
      return [
        {
          title: 'Where you click…', icon: Hand,
          run: () => App().pickThing?.(`Click where ${figureOf(c)!.name} holds on to someone (a head, a shoulder, the chest, the back, the waist, a hand) · Esc cancels`, (hit) => {
            if (hit.figure && hit.figure !== c.figure && hit.contact) hold(hit.figure, hit.contact);
          }),
        },
        ...sceneOf(c).figures.filter((x) => x.id !== c.figure && !x.hidden && !x.proxy).flatMap((x) => (['shoulder', 'waist', 'hand'] as const).map((part) => {
          const contact = part === 'shoulder' ? 'leftUpperArm' : part === 'waist' ? 'waist' : 'rightHand';
          return { title: `${x.name}'s ${CONTACT_LABELS[contact].toLowerCase()}`, icon: Hand, run: () => hold(x.id, contact) };
        })),
      ];
    },
  },
  {
    // The same moves for someone else (a crowd, a synchronised routine).
    id: 'figure.copyMoves', title: 'Copy moves to', icon: Copy,
    when: (c) => !!c.figure && !c.action && !!sceneOf(c).animation && actionsOf(sceneOf(c).animation!, c.figure).length > 1 && sceneOf(c).figures.length > 1,
    items: (c) => sceneOf(c).figures.filter((x) => x.id !== c.figure).map((x) => ({
      title: x.name, icon: Copy, run: () => { if (copyMotion(c.store, c.figure!, x.id)) App().notifyUndo(`${x.name} now moves like ${figureOf(c)!.name}`); },
    })),
  },
  {
    id: 'figure.delete', title: 'Delete', help: 'Delete the selection (a figure, prop, camera, action or cut)', icon: Trash2, keys: ['delete', 'backspace'], danger: true,
    when: (c) => !!c.figure && !c.joint && !c.action && !c.floor, enabled: (c) => sceneOf(c).figures.length > 1,
    run: (c) => { const f = figureOf(c); if (f && deleteFigure(c.store, f.id)) App().notifyUndo(`Deleted ${f.name}`); },
  },

  // A prop (as it is at the playhead: in whose hand, after a catch say).
  {
    id: 'prop.hold', title: 'Hold', icon: Hand,
    when: (c) => { const p = c.prop && propNow(c.store, c.prop); return !!p && HOLDABLE.includes(p.kind) && !!holderOf(c); },
    items: (c) => {
      const p = propNow(c.store, c.prop!)!;
      const f = holderOf(c)!;
      return (['R', 'L'] as const).filter((h) => !(p.hold?.figure === f.id && p.hold.hand === h)).map((h) => ({ title: `In ${f.name}'s ${hand(h)} hand`, icon: Hand, run: () => holdProp(c.store, p.id, { figure: f.id, hand: h }) }));
    },
  },
  {
    // Into anyone's hand.
    id: 'prop.give', title: 'Give to', icon: Hand,
    when: (c) => { const p = c.prop && propNow(c.store, c.prop); return !!p && HOLDABLE.includes(p.kind); },
    items: (c) => [
      {
        title: 'Whom you click…', icon: Hand,
        run: () => App().pickThing?.('Click who takes it (into the hand nearer where you click) · Esc cancels', (hit) => {
          const f = hit.figure && sceneOf(c).figures.find((x) => x.id === hit.figure && !x.proxy);
          if (f) holdProp(c.store, c.prop!, { figure: f.id, hand: hit.contact === 'leftHand' || hit.contact === 'leftUpperArm' ? 'L' : 'R' });
        }),
      },
      // (Anyone but whoever Hold puts it with.)
      ...sceneOf(c).figures.filter((x) => !x.hidden && !x.proxy && x.id !== holderOf(c)?.id).flatMap((x) => (['R', 'L'] as const).map((h) => ({
        title: `${x.name}'s ${hand(h)} hand`, icon: Hand, run: () => holdProp(c.store, c.prop!, { figure: x.id, hand: h }),
      }))),
    ],
  },
  {
    // Someone else takes it from the hand holding it (a handoff).
    id: 'prop.take', title: (c) => `${activeFigure(c)?.name} takes it (right hand)`, icon: Hand,
    when: (c) => { const p = c.prop && propNow(c.store, c.prop); const f = activeFigure(c); return !!p && HOLDABLE.includes(p.kind) && !!f && !!p.hold && f.id !== p.hold.figure; },
    run: (c) => holdProp(c.store, c.prop!, { figure: activeFigure(c)!.id, hand: 'R' }),
  },
  {
    id: 'prop.letGo', title: (c) => (animated(c) ? 'Let go (it falls)' : 'Let go'), icon: ArrowDownToLine,
    when: (c) => !!(c.prop && propNow(c.store, c.prop)?.hold), run: (c) => holdProp(c.store, c.prop!, null),
  },
  {
    id: 'prop.drop', title: 'Drop to floor', icon: ArrowDownToLine,
    when: (c) => { const p = c.prop && propNow(c.store, c.prop); return !!p && !p.hold && p.position[1] > 1e-3; },
    run: (c) => c.store.updateProp(c.prop!, (x) => ({ ...x, position: [x.position[0], 0, x.position[2]] })),
  },
  {
    // Thrown to someone else, caught in a hand.
    id: 'prop.throwTo', title: 'Throw to', icon: Send, when: (c) => !!(c.prop && propNow(c.store, c.prop)?.hold),
    items: (c) => {
      const p = propNow(c.store, c.prop!)!;
      return sceneOf(c).figures.filter((x) => x.id !== p.hold!.figure).flatMap((x) => (['R', 'L'] as const).map((h) => ({
        title: `${x.name}'s ${hand(h)} hand`, icon: Send, run: () => throwProp(c.store, p.id, { figure: x.id, hand: h }),
      })));
    },
  },
  {
    id: 'prop.toss', title: 'Toss up and catch', icon: ArrowUpFromDot, when: (c) => !!(c.prop && propNow(c.store, c.prop)?.hold),
    run: (c) => { const p = propNow(c.store, c.prop!)!; throwProp(c.store, p.id, { figure: p.hold!.figure, hand: p.hold!.hand }); },
  },
  {
    // (The arms kept still from the playhead on, as long as the figure walks or does what it is doing.)
    id: 'prop.carry', title: 'Carry', help: 'Carry it: the arms keep still as the figure walks', icon: Briefcase, when: (c) => !!(c.prop && propNow(c.store, c.prop)?.hold),
    run: (c) => { const p = propNow(c.store, c.prop!)!; applyUpperBody(c.store, p.hold!.figure, 'carry'); },
  },
  { id: 'prop.dribble', title: 'Dribble (2 s)', icon: ChevronsDown, when: (c) => { const p = c.prop && propNow(c.store, c.prop); return !!p && !!p.hold && p.kind === 'sphere'; }, run: (c) => dribbleProp(c.store, c.prop!) },
  {
    id: 'prop.shoot', title: 'Shoot at', icon: Goal,
    when: (c) => { const p = c.prop && propNow(c.store, c.prop); return !!p && !!p.hold && p.kind === 'sphere' && sceneOf(c).props.some((x) => x.kind === 'hoop'); },
    items: (c) => sceneOf(c).props.filter((x) => x.kind === 'hoop').flatMap((x) => [
      { title: x.name, icon: Goal, run: () => throwProp(c.store, c.prop!, { hoop: x.id }) },
      { title: `${x.name}, off the rim`, icon: Goal, run: () => throwProp(c.store, c.prop!, { hoop: x.id, miss: true }) },
    ]),
  },
  {
    // A long prop carried by two: the other one holds its other end.
    id: 'prop.otherEnd', title: 'Takes the other end', icon: Hand,
    when: (c) => { const p = c.prop && propNow(c.store, c.prop); return !!p && !!p.hold && handlesOf(p).length > 1 && carriers(c).length > 0; },
    items: (c) => carriers(c).map((x) => ({
      title: x.name, icon: Hand, run: () => { const why = carryProblem(c.store, x.id, c.prop!); if (why) App().notify(why, 'error'); else holdHandle(c.store, x.id, c.prop!, 'R'); },
    })),
  },
  {
    id: 'prop.lieOn', title: 'Lies on it', icon: BedSingle,
    when: (c) => { const p = c.prop && propNow(c.store, c.prop); return !!p && (p.kind === 'box' || p.kind === 'mat') && carriers(c).length > 0; },
    items: (c) => carriers(c).map((x) => ({ title: x.name, icon: BedSingle, run: () => lieOn(c.store, x.id, c.prop!) })),
  },
  {
    // (#14: walks to it, turns and sits down on it.)
    id: 'prop.sitOn', title: 'Sits on it', icon: Armchair,
    when: (c) => { const p = c.prop && propNow(c.store, c.prop); return !!p && !p.hold && (p.kind === 'chair' || p.kind === 'stool') && carriers(c).length > 0; },
    items: (c) => carriers(c).map((x) => ({ title: x.name, icon: Armchair, run: () => sitOn(c.store, x.id, c.prop!) })),
  },
  {
    id: 'prop.delete', title: 'Delete', icon: Trash2, keys: ['delete', 'backspace'], danger: true, when: (c) => !!c.prop,
    run: (c) => { const p = sceneOf(c).props.find((x) => x.id === c.prop); deleteProp(c.store, c.prop!); if (p) App().notifyUndo(`Deleted ${p.name}`); },
  },

  // A shot.
  {
    // (Its camera's inspector: a move, or a ready-made one (#16).)
    id: 'shot.move', title: 'Choose a camera move…', icon: Video, when: (c) => !!spanOf(c),
    run: (c) => { const sp = spanOf(c)!; c.store.setTime(sp.start); c.store.select({ kind: 'camera', camera: sp.shot.camera ?? sceneOf(c).cameras[0].id }); },
  },
  {
    id: 'shot.camera', title: 'Film with', icon: Camera, when: (c) => !!spanOf(c),
    items: (c) => {
      const span = spanOf(c)!;
      return [
        ...sceneOf(c).cameras.map((cam) => ({ title: cam.name, icon: Camera, checked: cam.id === span.shot.camera, run: () => editShot(c.store, span.shot.id, { camera: cam.id }) })),
        {
          title: 'New camera from the view', icon: Plus, run: () => {
            const t = c.store.getState().time;
            if (t < span.start - 1e-6 || t >= span.end - 1e-6) c.store.setTime(span.start);
            addCamera(c.store);
          },
        },
      ];
    },
  },
  {
    id: 'shot.describe', title: 'Copy description', icon: ClipboardCopy, when: (c) => !!spanOf(c),
    run: (c) => { const text = describeSpan(c.store.scene, spanOf(c)!); navigator.clipboard?.writeText(text).then(() => App().notify('Shot description copied (for AI video tools)'), () => App().notify(text)); },
  },
  {
    id: 'shot.removeCut', title: 'Remove cut', icon: Scissors, keys: ['delete', 'backspace'], danger: true, when: (c) => (spanOf(c)?.index ?? 0) > 0,
    run: (c) => { const sp = spanOf(c)!; removeShotCut(c.store, sp.shot.id); App().notifyUndo(`Removed the cut before ${sp.shot.name}`); },
  },

  // A camera (`at`: one of its path's points).
  {
    // (Its own aim: a figure, the spot it looks at now; or as the camera aims.)
    id: 'camera.pointAim', title: 'Looks at', icon: Crosshair,
    when: (c) => !!c.camera && c.at !== undefined && cameraById(sceneOf(c), c.camera)?.kind === 'path',
    items: (c) => {
      const cam = cameraById(sceneOf(c), c.camera) as PathCamera;
      const p = cam.points.find((q) => Math.abs(q.t - c.at!) < 1e-3);
      const own = p?.aim;
      const here = () => { const v = viewOf(sceneOf(c), cam, c.at!); return { point: v.target.toArray().map((n) => Math.round(n * 1000) / 1000) as Vec3 }; };
      return [
        { title: 'As the camera aims', checked: !own, run: () => setCameraPointAim(c.store, cam.id, c.at!, null) },
        ...sceneOf(c).figures.filter((f) => !f.hidden).map((f) => ({ title: f.name, checked: !!own && 'figure' in own && own.figure === f.id, run: () => setCameraPointAim(c.store, cam.id, c.at!, { figure: f.id }) })),
        { title: 'The spot it looks at now', checked: !!own && 'point' in own, run: () => setCameraPointAim(c.store, cam.id, c.at!, here()) },
      ];
    },
  },
  {
    id: 'camera.stop', title: 'Stops here', help: 'The camera eases to a stop at this point and on from it: its path may turn sharply here', icon: CircleStop,
    when: (c) => !!c.camera && c.at !== undefined && cameraById(sceneOf(c), c.camera)?.kind === 'path',
    checked: (c) => { const cam = cameraById(sceneOf(c), c.camera); return cam?.kind === 'path' && !!cam.points.find((p) => Math.abs(p.t - c.at!) < 1e-3)?.stop; },
    run: (c) => { const cam = cameraById(sceneOf(c), c.camera); if (cam?.kind === 'path') setCameraPointStop(c.store, c.camera!, c.at!, !cam.points.find((p) => Math.abs(p.t - c.at!) < 1e-3)?.stop); },
  },
  {
    id: 'camera.deletePoint', title: (c) => `Delete the point at ${c.at!.toFixed(2)} s`, icon: Trash2, danger: true,
    when: (c) => !!c.camera && c.at !== undefined && cameraById(sceneOf(c), c.camera)?.kind === 'path',
    enabled: (c) => { const cam = cameraById(sceneOf(c), c.camera); return cam?.kind === 'path' && cam.points.length > 1; },
    run: (c) => deleteCameraPoint(c.store, c.at, c.camera),
  },
  {
    id: 'camera.through', title: 'Look through it', icon: Eye, when: (c) => !!c.camera, checked: (c) => c.store.getState().through?.camera === c.camera,
    run: (c) => c.store.lookThrough(c.store.getState().through?.camera === c.camera ? null : { camera: c.camera! }),
  },
  {
    // A path camera's point at the playhead from the editor's view; a rig's angle and size as the view frames its subject.
    id: 'camera.fromView', title: 'Set from the view', icon: Camera, when: (c) => !!c.camera && c.at === undefined,
    run: (c) => {
      const shot = App().captureShot();
      if (!shot) return;
      setCameraPoint(c.store, shot.position, shot.target, shot.fov, '', c.camera);
    },
  },
  {
    id: 'camera.pointHere', title: 'A point here', icon: Plus, when: (c) => cameraById(sceneOf(c), c.camera)?.kind === 'path' && animated(c),
    run: (c) => addCameraPoint(c.store, c.camera!, c.store.getState().time),
  },
  {
    id: 'camera.size', title: 'Shot size', icon: Scan, when: (c) => !!c.camera,
    items: (c) => {
      const cam = cameraById(sceneOf(c), c.camera)!;
      return SHOT_SIZES.map((x) => ({
        title: `${x.short} · ${x.name}`, checked: cam.kind === 'rig' && cam.rig.size === x.id,
        run: () => (cam.kind === 'rig' ? editRig(c.store, cam.id, { size: x.id }) : frameShot(c.store, x.id, { camera: cam.id })),
      }));
    },
  },
  {
    id: 'camera.lens', title: 'Lens', icon: Aperture, when: (c) => !!c.camera,
    items: (c) => {
      const cam = cameraById(sceneOf(c), c.camera)!;
      const now = cam.kind === 'rig' ? cam.rig.lens : viewOf(sceneOf(c), cam, c.store.getState().time).lens;
      return LENSES.map((mm) => ({
        title: `${mm} mm`, checked: Math.round(now) === mm,
        run: () => (cam.kind === 'rig' ? editRig(c.store, cam.id, { lens: mm }) : setLens(c.store, mm, 'size', '', cam.id)),
      }));
    },
  },
  {
    id: 'camera.delete', title: 'Delete', icon: Trash2, keys: ['delete', 'backspace'], danger: true, when: (c) => !!c.camera && c.at === undefined, enabled: (c) => sceneOf(c).cameras.length > 1,
    run: (c) => { const cam = cameraById(sceneOf(c), c.camera); const byHand = deleteCamera(c.store, c.camera!); if (cam) App().notifyUndo(`Deleted ${cam.name}${byHand ? ': the director is off, cameras and cuts by hand from now on' : ''}`); },
  },

  // A scene of the project.
  {
    id: 'scene.rename', title: 'Rename', icon: Pencil, when: (c) => c.scene !== undefined,
    run: (c) => { c.store.setSceneIndex(c.scene!); const input = document.querySelector<HTMLInputElement>('.scene-name'); input?.focus(); input?.select(); },
  },
  { id: 'scene.duplicate', title: 'Duplicate', icon: Copy, when: (c) => c.scene !== undefined, run: (c) => duplicateCurrentScene(c.store, c.scene!) },
  {
    id: 'scene.share', title: 'Copy share link', icon: Link, when: (c) => c.scene !== undefined,
    run: async (c) => {
      const s = c.store.getState().library.scenes[c.scene!];
      try {
        const url = await shareUrl(s);
        await navigator.clipboard.writeText(url).then(() => App().notify('Share link copied to the clipboard'), () => prompt('Copy this link:', url));
      } catch (err) {
        App().notify(`Could not create a link: ${(err as Error).message}`, 'error');
      }
    },
  },
  {
    // (The story is the scene list in its order; a scene can be left out of it.)
    id: 'scene.board', title: 'In the storyboard', icon: LayoutPanelTop, when: (c) => c.scene !== undefined,
    checked: (c) => !c.store.getState().library.scenes[c.scene!]?.offStory,
    run: (c) => { const s = c.store.getState().library.scenes[c.scene!]; setInStory(c.store, s.id, !!s.offStory); },
  },
  { id: 'scene.template', title: 'Save as template…', icon: BookmarkPlus, when: (c) => c.scene !== undefined, run: (c) => { c.store.setSceneIndex(c.scene!); saveAsTemplate(c.store, App()); } },
  {
    // Filmed with a coverage: kept as a template and a shoot preset filming it so.
    id: 'scene.shoot', title: 'Save as shoot preset…', icon: Clapperboard, when: (c) => c.scene !== undefined && !!c.store.getState().library.scenes[c.scene]?.coverage,
    run: (c) => {
      c.store.setSceneIndex(c.scene!);
      const name = window.prompt('Shoot preset name', c.store.scene.name)?.trim();
      if (name && saveAsShoot(c.store, name)) App().notifyUndo(`Saved “${name}” to My presets (and My templates)`);
    },
  },
  {
    id: 'scene.delete', title: 'Delete', icon: Trash2, danger: true, when: (c) => c.scene !== undefined,
    run: (c) => { const s = c.store.getState().library.scenes[c.scene!]; if (deleteScene(c.store, c.scene!)) App().notifyUndo(`Deleted “${s.name}”`); },
  },

  // How a figure gets to a key (from its previous one): glide as keyed, walk, run or jump; for a jump its height and turns.
  {
    id: 'travel.how', title: 'Getting here', icon: Footprints, when: (c) => !!travelHow(c),
    items: (c) => {
      const kind = travelHow(c)!.kind;
      return [
        { title: 'Glide (as keyed)', icon: Spline, checked: !kind, run: () => setTravelOf(c, null) },
        { title: 'Walk', icon: Footprints, checked: kind === 'walk', run: () => setTravelOf(c, 'walk') },
        { title: 'Run', icon: Wind, checked: kind === 'run', run: () => setTravelOf(c, 'run') },
        { title: 'Jump', icon: MoveUpRight, checked: kind === 'jump', run: () => setTravelOf(c, 'jump') },
      ];
    },
  },
  {
    id: 'travel.facing', title: 'Keep facing', help: 'Keep facing: side steps, backing up', icon: ArrowLeftRight,
    when: (c) => { const k = travelHow(c)?.kind; return k === 'walk' || k === 'run'; }, checked: (c) => !!travelHow(c)?.keep.strafe,
    run: (c) => { const h = travelHow(c)!; setTravelOf(c, h.kind, { strafe: !h.keep.strafe }); },
  },
  {
    id: 'travel.height', title: (c) => `Height · ${jumpNow(c).toFixed(2)} m`, icon: ArrowUpFromDot, when: (c) => travelHow(c)?.kind === 'jump',
    items: (c) => ([['Low (0.3 m)', 0.3], ['Medium (0.5 m)', 0.5], ['High (0.8 m)', 0.8], ['Very high (1.2 m)', 1.2]] as const).map(([title, h]) => ({
      title, checked: Math.abs(jumpNow(c) - h) < 0.06, run: () => setJumpHeight(c.store, c.figure!, travelHow(c)!.t, h),
    })),
  },
  {
    id: 'travel.turns', title: 'In the air', icon: RotateCw, when: (c) => travelHow(c)?.kind === 'jump',
    items: (c) => [
      ...([['No turn', 0], ['Half turn', 0.5], ['Full turn', 1], ['Two turns', 2]] as const).map(([title, spin]) => ({ title, icon: RotateCw, checked: (travelHow(c)!.keep.spin ?? 0) === spin, run: () => setTravelOf(c, 'jump', { spin }) })),
      ...([['No flip', 0], ['Front flip', 1], ['Back flip', -1]] as const).map(([title, flip]) => ({ title, icon: RefreshCw, checked: (travelHow(c)!.keep.flip ?? 0) === flip, run: () => setTravelOf(c, 'jump', { flip }) })),
    ],
  },

  // An action on a track.
  {
    id: 'action.mirror', title: 'Mirrored (left for right)', icon: FlipHorizontal2, when: (c) => actionOf(c)?.source.kind === 'clip',
    checked: (c) => { const s = actionOf(c)!.source; return s.kind === 'clip' && !!s.mirror; },
    run: (c) => { const s = actionOf(c)!.source; if (s.kind === 'clip') setClipOptions(c.store, c.action!, { mirror: !s.mirror }); },
  },
  {
    // Played again, one after another (a wave, a nod; a keyed walk cycle walks on); what follows moves on.
    id: 'action.repeat', title: 'Repeat', icon: Repeat, when: (c) => repeatable(c),
    items: (c) => {
      const act = actionOf(c)!;
      const src = act.source;
      const now = src.kind === 'clip' ? (src.repeat ?? (loopsOf(src) ? Math.round(act.duration / (clipById(src.clip)!.duration / (src.speed ?? 1))) : 1)) : 1;
      return (src.kind === 'clip' ? [1, 2, 3, 4] : [2, 3, 4]).map((n) => ({
        title: n === 1 ? 'Once' : src.kind === 'keys' ? `${n} times in all (its keys copied)` : `${n} times`, checked: src.kind === 'clip' ? now === n : undefined, run: () => repeatAction(c.store, act.id, n),
      }));
    },
  },
  {
    id: 'action.saveMotion', title: 'Save as a motion', help: 'Keep a keyed block in My motions, to give to any figure', icon: BookmarkPlus,
    when: (c) => { const act = actionOf(c); return !!act && act.source.kind === 'keys' && !act.layer && act.duration > 1e-6; },
    run: (c) => { const name = saveKeysAsMotion(c.store, c.action!); if (name) App().notify(`Saved as “${name}” in My motions`); },
  },
  {
    // Timed to someone else's motion: it starts just before their blow lands (their hand or foot furthest out).
    id: 'action.reactTo', title: 'React to', help: 'Start as someone else’s blow lands', icon: Zap, when: (c) => !!actionOf(c) && othersMotions(c).length > 0,
    items: (c) => othersMotions(c).map((x) => {
      const who = sceneOf(c).figures.find((f) => f.id === x.roles[0].figure)?.name ?? '';
      return {
        title: `${who}: ${actionLabel(x)} · ${x.start.toFixed(1)} s`, icon: Zap,
        run: () => {
          const own = actionLabel(actionOf(c)!);
          const gap = reactTo(c.store, c.action!, x.id);
          if (gap === null) return;
          // (Out of reach: a blow at a head is within a hand of it.)
          const me = figureOf(c)?.name ?? '';
          if (gap > 0.3) App().notifyUndo(`${own} is timed to ${who}'s ${actionLabel(x)}, but the blow misses ${me} by ${gap.toFixed(1)} m: bring them closer`);
          else App().notifyUndo(`${own} now comes as ${who}'s ${actionLabel(x)} lands`);
        },
      };
    }),
  },
  {
    id: 'action.split', title: 'Split at the playhead', help: 'Split the action at the playhead: two blocks, the second going on from where the first leaves off', icon: SquareSplitHorizontal, keys: ['s'],
    when: (c) => { const x = splitting(c); return !!x && x.source.kind !== 'travel'; },
    run: (c) => { const why = splitAt(c.store, splitting(c)!.id); if (why) App().notify(why, 'error'); },
  },
  {
    id: 'action.splitRepeats', title: 'Split into repeats', help: 'One block for each repeat, to trim, speed up, mirror or remove one by one', icon: SquareSplitHorizontal,
    when: (c) => { const s = actionOf(c)?.source; return s?.kind === 'clip' && (s.repeat ?? 1) > 1; },
    run: (c) => splitIntoRepeats(c.store, c.action!),
  },
  {
    id: 'action.trimStart', title: 'Trim the start to the playhead', icon: ArrowRightToLine, keys: ['alt+['],
    when: (c) => !!actionOf(c) && actionOf(c)!.source.kind !== 'travel' && !actionOf(c)!.layer,
    run: (c) => trim(c.store, c.action!, 'start', c.store.getState().time),
  },
  {
    id: 'action.trimEnd', title: 'Trim the end to the playhead', icon: ArrowLeftToLine, keys: ['alt+]'],
    when: (c) => !!actionOf(c),
    run: (c) => trim(c.store, c.action!, 'end', c.store.getState().time),
  },
  {
    id: 'action.remove', title: (c) => (c.also?.length ? `Remove ${c.also.length + 1} blocks` : `Remove ${actionOf(c) ? actionLabel(actionOf(c)!) : ''}`), icon: Trash2, keys: ['delete', 'backspace'], danger: true, when: (c) => !!actionOf(c),
    run: (c) => {
      const act = actionOf(c)!;
      c.store.group(() => blocks(c).forEach((id) => deleteAction(c.store, id)));
      // (Not if refused: a locked row says so itself.)
      if (actionOf(c)) return;
      App().notifyUndo(c.also?.length ? `Deleted ${blocks(c).length} blocks` : `Deleted ${actionLabel(act)}`);
    },
  },
  {
    id: 'action.rippleDelete', title: (c) => (c.also?.length ? `Remove ${c.also.length + 1} blocks, closing the gaps` : 'Remove, closing the gap'), help: 'Remove the block: what that person does after moves up', icon: Trash2, keys: ['shift+delete', 'shift+backspace'], danger: true,
    when: (c) => !!actionOf(c),
    run: (c) => { const n = blocks(c).length; rippleDeleteActions(c.store, blocks(c)); if (!actionOf(c)) App().notifyUndo(n > 1 ? `Deleted ${n} blocks` : 'Deleted, the gap closed'); },
  },
  {
    id: 'action.duplicate', title: 'Duplicate', help: 'The block again right after itself (what follows moves along)', icon: Copy, keys: ['mod+d'],
    when: (c) => !!actionOf(c) && blocks(c).some((id) => c.store.scene.animation?.actions.find((x) => x.id === id)?.source.kind !== 'travel'),
    run: (c) => duplicateBlocks(c.store, blocks(c)),
  },
  {
    id: 'action.unlink', title: 'Unlink from the blow', help: 'No longer kept on the blow it reacts to (it stays where it is)', icon: Link,
    when: (c) => !!actionOf(c)?.reactsTo, run: (c) => unlinkReaction(c.store, c.action!),
  },
  {
    id: 'action.editAsKeys', title: 'Edit as keys', help: 'Make the motion keys to edit freely: a Posed block of its poses (what it did with a prop is not kept)', icon: Diamond,
    when: (c) => actionOf(c)?.source.kind === 'clip' && !actionOf(c)!.layer,
    run: (c) => { if (editAsKeys(c.store, c.action!)) App().notifyUndo('Made into keys'); },
  },
  {
    id: 'action.copy', title: 'Copy', help: 'Copy the block, to paste on someone at the playhead', icon: ClipboardCopy, keys: ['mod+c'], when: (c) => !!actionOf(c),
    run: (c) => { const n = copyActions(c.store, blocks(c)); App().notify(n > 1 ? `${n} blocks copied` : 'Block copied'); },
  },
  {
    id: 'action.paste', title: 'Paste at the playhead', help: 'Paste the blocks copied on this person at the playhead (what they did there gives way)', icon: ClipboardPaste, keys: ['mod+v'],
    when: (c) => !!actionOf(c) && hasCopiedActions(),
    run: (c) => { const why = pasteActions(c.store, c.figure!, c.store.getState().time); if (why) App().notify(why, 'error'); },
  },
  {
    id: 'action.nudgeLeft', title: 'Nudge a frame earlier', keys: ['alt+arrowleft'], when: (c) => !!actionOf(c), run: (c) => nudge(c, -1),
  },
  { id: 'action.nudgeRight', title: 'Nudge a frame later', keys: ['alt+arrowright'], when: (c) => !!actionOf(c), run: (c) => nudge(c, 1) },
  { id: 'action.nudgeLeft10', title: 'Nudge ten frames earlier', keys: ['alt+shift+arrowleft'], when: (c) => !!actionOf(c), run: (c) => nudge(c, -10) },
  { id: 'action.nudgeRight10', title: 'Nudge ten frames later', keys: ['alt+shift+arrowright'], when: (c) => !!actionOf(c), run: (c) => nudge(c, 10) },

  // A key on a figure's track (`at`): how it goes on to the next, and holding it.
  {
    id: 'key.ease', title: 'Goes on to the next key', icon: Spline, when: (c) => !!c.figure && c.at !== undefined && !c.action && !!keyEaseAt(sceneOf(c).animation!, c.figure, c.at),
    items: (c) => {
      const now = keyEaseAt(sceneOf(c).animation!, c.figure!, c.at!);
      return ([['smooth', 'Smoothly'], ['linear', 'At an even speed (linear)'], ['step', 'Not at all: held until the next (stepped)']] as const)
        .map(([ease, title]) => ({ title, checked: now === ease, run: () => setKeyEase(c.store, c.figure!, c.at!, ease) }));
    },
  },
  {
    id: 'key.hold', title: 'Hold this pose for', icon: Pause, when: (c) => !!c.figure && c.at !== undefined && !c.action && !!keyEaseAt(sceneOf(c).animation!, c.figure, c.at),
    items: (c) => [0.5, 1, 2].map((s) => ({ title: `${s} s (what follows moves on)`, run: () => holdKey(c.store, c.figure!, c.at!, s) })),
  },
  {
    id: 'key.delete', title: 'Delete key', icon: Trash2, danger: true, when: (c) => !!c.figure && c.at !== undefined && !c.action,
    enabled: (c) => keyTimesOf(sceneOf(c).animation!, c.figure!).length > 1, run: (c) => deleteKey(c.store, c.figure!),
  },

  // Empty floor: add things there.
  { id: 'floor.figure', title: 'Add figure', icon: PersonStanding, when: onScene, run: (c) => (c.floor ? addFigure(c.store, c.floor) : placeOrAdd(placingFigure(c.store), () => addFigure(c.store))) },
  { id: 'floor.standIn', title: 'Add stand-in', icon: UserRound, when: onScene, run: (c) => (c.floor ? addStandIn(c.store, c.floor) : placeOrAdd(placingFigure(c.store, true), () => addStandIn(c.store))) },
  {
    id: 'floor.prop', title: 'Add a prop', when: onScene,
    items: (c) => PROP_KINDS.filter((k) => !HANDHELD.includes(k)).map((k) => ({ title: PROP_LABELS[k], icon: PROP_ICONS[k], run: () => (c.floor ? addProp(c.store, k, c.floor) : placeOrAdd(placingProp(c.store, k), () => addProp(c.store, k))) })),
  },

  // The animation and the timeline.
  { id: 'timeline.play', title: () => (App().playing() ? 'Pause' : 'Play'), help: 'Play / pause', iconFor: () => (App().playing() ? Pause : Play), keys: ['space'], when: animated, run: () => App().togglePlay() },
  { id: 'timeline.back', title: 'Back a frame', keys: [','], when: animated, run: (c) => stepTo(c, (now) => now - 1 / sceneOf(c).animation!.fps) },
  { id: 'timeline.forward', title: 'On a frame', keys: ['.'], when: animated, run: (c) => stepTo(c, (now) => now + 1 / sceneOf(c).animation!.fps) },
  {
    id: 'timeline.prevKey', title: 'Previous key', icon: StepBack, when: animated,
    enabled: (c) => stops(c).some((t) => t < c.store.getState().time - 1e-3), run: (c) => stepTo(c, (now) => [...stops(c)].reverse().find((x) => x < now - 1e-3)),
  },
  {
    id: 'timeline.nextKey', title: 'Next key', icon: StepForward, when: animated,
    enabled: (c) => stops(c).some((t) => t > c.store.getState().time + 1e-3), run: (c) => stepTo(c, (now) => stops(c).find((x) => x > now + 1e-3)),
  },
  {
    id: 'timeline.key', title: (c) => (animated(c) ? `${keysHere(c).on ? 'Update' : 'Add'} ${keyName(c)}` : 'Key the pose: animate the scene'),
    help: 'Key the selected figure (in a still scene: start animating it)', icon: Diamond, keys: ['k'], checked: (c) => keysHere(c).on,
    run: (c) => {
      App().stopPlayback();
      // The first key makes a still scene animated: the pose as it is is its first key.
      if (!animated(c)) {
        startAnimation(c.store);
        App().notify('Animated: move the playhead and pose the figures for the next key');
      } else addKey(c.store);
    },
  },
  {
    id: 'timeline.deleteKey', title: (c) => `Delete ${keyName(c)}`, icon: Trash2, when: animated,
    enabled: (c) => keysHere(c).on && keysHere(c).times.length > 1, run: (c) => deleteKey(c.store),
  },
  {
    id: 'timeline.cut', title: (c) => (c.store.getState().through ? 'Cut here, from this view' : 'Cut: start a new shot here'),
    help: 'Start a new shot here (looking through: a new camera from this view)', icon: Scissors, keys: ['c'], when: animated,
    run: (c) => {
      App().stopPlayback();
      const view = c.store.getState().through ? App().captureShot() : null;
      const shots = sceneOf(c).animation!.shots.length;
      // Looking through: the new shot (if a cut was made) is filmed by a new camera as the view is now, and looked through; one undo step.
      const cam = c.store.group(() => {
        cutShot(c.store);
        return view && sceneOf(c).animation!.shots.length > shots ? addCamera(c.store, view) : null;
      });
      if (cam) c.store.lookThrough({ camera: cam });
    },
  },
  {
    id: 'timeline.cameraPoint', title: (c) => { const cam = rowCamera(c); return `${onCameraPoint(c) ? 'Update' : 'Set'} ${cam.name}${cam.kind === 'path' ? '’s point' : ''} from the view`; },
    icon: Camera, when: animated, checked: (c) => onCameraPoint(c),
    run: (c) => {
      const shot = App().captureShot();
      if (!shot) return;
      const cam = rowCamera(c);
      setCameraPoint(c.store, shot.position, shot.target, shot.fov, '', cam.id);
      const picked = c.store.getState().selection?.kind === 'camera';
      if (!c.store.getState().through) c.store.lookThrough(picked ? { camera: cam.id } : {});
      },
  },
  {
    id: 'timeline.deleteCameraPoint', title: (c) => `Delete ${rowCamera(c).name}’s point`, icon: Trash2, when: animated,
    enabled: (c) => { const cam = rowCamera(c); return cam.kind === 'path' && cam.points.length > 1 && onCameraPoint(c); },
    run: (c) => deleteCameraPoint(c.store, c.store.getState().time, rowCamera(c).id),
  },
  { id: 'timeline.check', title: 'Check the motion', icon: Activity, when: animated, run: () => App().checkMotion?.() },
  {
    // The director (#14): the scene filmed in a style, cut again as what they do changes; or by hand.
    id: 'timeline.director', title: 'Director', help: 'Films the scene for you, and keeps up as it changes (or By hand)', icon: Clapperboard, when: animated,
    items: (c) => {
      const cv = sceneOf(c).coverage;
      return [
        { title: 'By hand', checked: !cv?.live, run: () => setDirector(c.store, null) },
        ...DIRECTOR_STYLES.map((d) => ({ title: d.label, checked: !!cv?.live && cv.id === d.id, run: () => {
          if (!setDirector(c.store, d.id)) App().notify(`${d.label} needs ${coverageById(d.id)!.roles.length} people in the scene`);
        } })),
      ];
    },
  },
  {
    id: 'shot.unpin', title: 'Hand back to the director', help: 'A shot taken over by hand: let the director cut it again', icon: Clapperboard,
    when: (c) => !!spanOf(c)?.shot.pinned && !!sceneOf(c).coverage?.live, run: (c) => unpinShot(c.store, spanOf(c)!.shot.id),
  },
  {
    id: 'figure.lockTrack', title: 'Lock the row', help: 'Lock the person\'s row on the timeline: what they do can\'t be changed until unlocked', icon: Lock,
    when: (c) => animated(c) && !!c.figure, checked: (c) => !!figureOf(c)?.locked, run: (c) => setTrack(c.store, c.figure!, { locked: !figureOf(c)?.locked }),
  },
  {
    id: 'figure.muteTrack', title: 'Mute the row', help: 'Mute the person\'s row: what they do doesn\'t play (they stand as posed)', icon: VolumeX,
    when: (c) => animated(c) && !!c.figure, checked: (c) => !!figureOf(c)?.muted, run: (c) => setTrack(c.store, c.figure!, { muted: !figureOf(c)?.muted }),
  },
  { id: 'timeline.rangeIn', title: 'In here', help: 'The playback range starts at the playhead (I with the timeline focused)', when: animated, run: (c) => setRangeAt(c.store, 'in', c.store.getState().time) },
  { id: 'timeline.rangeOut', title: 'Out here', help: 'The playback range ends at the playhead (O with the timeline focused)', when: animated, run: (c) => setRangeAt(c.store, 'out', c.store.getState().time) },
  {
    id: 'timeline.clearRange', title: 'Play all of it', help: 'No in and out: the whole animation plays (X with the timeline focused)', when: (c) => animated(c) && !!c.store.scene.animation?.range,
    run: (c) => setRange(c.store, null),
  },
  {
    id: 'timeline.snap', title: 'Snap', help: 'Drags on the timeline snap to the playhead, blocks\' edges, keys, cuts and markers', icon: Magnet, when: animated,
    checked: (c) => c.store.getState().settings.timelineSnap, run: (c) => c.store.setSettings({ timelineSnap: !c.store.getState().settings.timelineSnap }),
  },
  {
    id: 'timeline.marker', title: 'Add a marker', help: 'A marker at the playhead: a beat to time things to (M with the timeline focused)', icon: Flag, when: animated,
    run: (c) => addMarker(c.store, c.store.getState().time),
  },
  { id: 'timeline.repeat', title: 'Repeat this shot', icon: Repeat1, when: animated, checked: () => App().repeatShot(), run: () => App().setRepeatShot(!App().repeatShot()) },
  { id: 'timeline.loop', title: 'Loop the animation', icon: Repeat, when: animated, checked: (c) => !!sceneOf(c).animation?.loop, run: (c) => setAnimationOptions(c.store, { loop: !sceneOf(c).animation!.loop }) },
  {
    id: 'timeline.speed', title: 'Playback speed', when: animated,
    items: () => [0.25, 0.5, 1].map((x) => ({ title: `${x}×${x === 1 ? ' (real time)' : ''}`, checked: App().speed() === x, run: () => App().setSpeed(x) })),
  },
  { id: 'timeline.zoomOut', title: 'Zoom out', icon: ZoomOut, when: animated, run: () => App().zoomTimeline?.('out') },
  { id: 'timeline.zoomIn', title: 'Zoom in (or Ctrl + wheel)', icon: ZoomIn, when: animated, run: () => App().zoomTimeline?.('in') },
  { id: 'timeline.fit', title: 'Fit the whole animation', icon: MoveHorizontal, when: animated, run: () => App().zoomTimeline?.('fit') },
  {
    id: 'timeline.fold', title: (c) => (c.store.getState().settings.timelineFolded ? 'Show the tracks' : 'Fold the timeline'),
    iconFor: (c) => (c.store.getState().settings.timelineFolded ? ChevronUp : ChevronDown), when: animated,
    run: (c) => c.store.setSettings({ timelineFolded: !c.store.getState().settings.timelineFolded }),
  },
  { id: 'timeline.remove', title: 'Remove animation', icon: Trash2, danger: true, when: animated, run: (c) => { App().stopPlayback(); removeAnimation(c.store); } },
];

/** The joint below another (the first, where it branches: the upper chest's is the neck). */
function childOf(j: JointName): JointName | undefined {
  return JOINTS.find((x) => x !== 'hips' && PARENT[x as Exclude<JointName, 'hips'>] === j);
}

/** Whether a figure can be sent somewhere (the context's, or the selected one), and the props it holds. */
function movable(c: Ctx) {
  const f = c.figure ? figureOf(c) : c.floor ? activeFigure(c) : undefined;
  return !!f && !f.proxy && !c.action && !c.joint && (!c.floor || !c.figure || c.figure === activeFigure(c)?.id);
}
function heldBy(c: Ctx) {
  const f = c.figure ? figureOf(c) : activeFigure(c);
  return f ? sceneOf(c).props.filter((p) => p.hold?.figure === f.id) : [];
}
/** Whose hand a prop goes into: whoever holds it (the other hand), or the active figure. */
function holderOf(c: Ctx) {
  const p = propNow(c.store, c.prop!);
  return sceneOf(c).figures.find((f) => f.id === p?.hold?.figure) ?? activeFigure(c);
}
function carriers(c: Ctx) {
  const p = propNow(c.store, c.prop!);
  return sceneOf(c).figures.filter((x) => x.id !== p?.hold?.figure && !x.proxy);
}
function jumpNow(c: Ctx) {
  const tr = travelHow(c)?.tr;
  return jumpHeight(tr ? Math.max(0, tr.duration - 2 * JUMP_PREP) : 0);
}
function keyName(c: Ctx) {
  const f = activeFigure(c);
  return `key${sceneOf(c).figures.length > 1 && f ? ` (${f.name})` : ''}`;
}
function onCameraPoint(c: Ctx) {
  const cam = rowCamera(c);
  const a = sceneOf(c).animation;
  const t = c.store.getState().time;
  return !!a && cam.kind === 'path' && cam.points.some((p) => Math.abs(p.t - t) < 0.5 / a.fps);
}

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));
export const command = (id: string) => {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`No command ${id}`);
  return c;
};

/* ---------------- reading a command ---------------- */

export const titleOf = (cmd: Command, c: Ctx) => (typeof cmd.title === 'function' ? cmd.title(c) : cmd.title);
export const iconOf = (cmd: Command, c: Ctx): LucideIcon | undefined => (cmd.iconFor ? cmd.iconFor(c) : cmd.icon);
export const applies = (cmd: Command, c: Ctx) => !cmd.when || cmd.when(c);
export const enabled = (cmd: Command, c: Ctx) => !cmd.enabled || cmd.enabled(c);

/** A key as shown ("Ctrl Shift Z", "Del", "?"). */
export function keyLabel(spec: string) {
  const names: Record<string, string> = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', space: 'Space', delete: 'Del', backspace: 'Backspace', escape: 'Esc', tab: 'Tab', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓' };
  const parts = spec.split('+');
  const key = parts.pop()!;
  // A symbol typed with Shift ('?') shows as itself.
  const mods = parts.filter((p) => !(p === 'shift' && key.length === 1 && !/[a-z0-9]/.test(key)));
  return [...mods.map((p) => names[p] ?? p), names[key] ?? key.toUpperCase()].join(' ');
}
/** A command's shortcut as shown. */
export const shortcutOf = (id: string) => { const k = command(id).keys?.[0]; return k ? keyLabel(k) : undefined; };
/** A tooltip with a command's shortcut ("Label  Ctrl E": the tooltip shows the keys apart). */
export const tipOf = (id: string, label?: string) => { const k = shortcutOf(id); const cmd = command(id); const t = label ?? (typeof cmd.title === 'string' ? cmd.title : cmd.help ?? id); return k ? `${t}  ${k}` : t; };

/** Whether a key press is this key ('mod+z' is not 'mod+shift+z'; a symbol's Shift is the symbol's). */
export function matchesKey(spec: string, e: KeyboardEvent, exact = false) {
  const parts = spec.split('+');
  const key = parts.pop()!;
  if (parts.includes('mod') !== (e.ctrlKey || e.metaKey) || parts.includes('alt') !== e.altKey) return false;
  const letter = /^[a-z]$/.test(key);
  // (A letter with Shift is another key (Shift F); one without takes Shift too (Caps Lock, a slip), unless asked exactly.)
  if (letter && (parts.includes('mod') || parts.includes('shift') || exact) && parts.includes('shift') !== e.shiftKey) return false;
  // (The arrows and the Page keys go further with Shift: a step is not a Shift step; Shift + Tab goes back.)
  if (/^(arrow|page|tab)/.test(key) && parts.includes('shift') !== e.shiftKey) return false;
  const pressed = e.key === ' ' ? 'space' : e.key.toLowerCase();
  return pressed === key;
}

/** The command a key press runs here, if any. */
export function commandForKey(e: KeyboardEvent, c: Ctx) {
  const find = (exact: boolean) => COMMANDS.find((cmd) => cmd.keys?.some((k) => matchesKey(k, e, exact)) && applies(cmd, c) && enabled(cmd, c) && cmd.run);
  // (The key as pressed first: Shift F is Scene only, not F's Frame.)
  return find(true) ?? find(false);
}

/* ---------------- menus ---------------- */

/** A menu: commands by id, dividers, and group titles. A command with choices shows them under its title. */
type MenuEntry = string | '-' | { group: string };

/** (`keys`: the context the keys act in, when it is not the menu's: a command's key is shown only if it acts on this there.) */
export function menuItems(entries: MenuEntry[], c: Ctx, keys: Ctx = c): MenuItem[] {
  const out: MenuItem[] = [];
  for (const e of entries) {
    if (e === '-') { if (out.length && out[out.length - 1] !== '-') out.push('-'); continue; }
    if (typeof e === 'object') { out.push(e); continue; }
    const cmd = command(e);
    if (!applies(cmd, c)) continue;
    if (cmd.items) {
      const choices = cmd.items(c);
      if (!choices.length) continue;
      out.push({ group: titleOf(cmd, c) });
      for (const ch of choices) out.push({ label: ch.title, icon: ch.icon, checked: ch.checked, radio: ch.checked !== undefined, disabled: ch.disabled, onSelect: ch.run });
      continue;
    }
    out.push({
      label: titleOf(cmd, c),
      icon: iconOf(cmd, c),
      shortcut: cmd.keys && (keys === c || applies(cmd, keys)) ? keyLabel(cmd.keys[0]) : undefined,
      checked: cmd.checked?.(c),
      disabled: !enabled(cmd, c),
      danger: cmd.danger,
      onSelect: () => cmd.run?.(c),
    });
  }
  // A heading with nothing under it (its commands do not apply here) goes, and so do dividers left doubled or at the ends.
  const kept = out.filter((it, i) => !(typeof it === 'object' && 'group' in it && (i === out.length - 1 || out[i + 1] === '-' || (typeof out[i + 1] === 'object' && 'group' in (out[i + 1] as object)))));
  const tidy = kept.filter((it, i) => !(it === '-' && kept[i - 1] === '-'));
  while (tidy[tidy.length - 1] === '-') tidy.pop();
  while (tidy[0] === '-') tidy.shift();
  return tidy;
}

const MENUS = {
  main: ['app.newScene', '-', 'app.save', 'app.import', 'app.open', '-', 'app.practice', 'app.help', 'app.theme'],
  view: [
    'view.frameAll', 'view.isolate', 'view.through', 'view.stageOnly',
    { group: 'Show' }, 'view.handles', 'view.grid', 'view.onion', 'view.guides', 'view.line',
    // (Joints bend only as far as a body's do: dragging, the gizmo, the keys.)
    { group: 'Posing' }, 'tool.limits',
  ],
  figure: [
    'rename', 'duplicate', 'figure.hide', '-', 'figure.pose', 'figure.motion', 'figure.savePose',
    { group: 'Move to' }, 'figure.walk', 'figure.run', 'figure.jump', 'figure.step', 'figure.turn', 'figure.throw', 'figure.wholeTo', 'figure.standUp',
    'figure.strike', 'figure.eyes', 'figure.holdOn', 'figure.copyMoves', { group: 'Timeline' }, 'figure.lockTrack', 'figure.muteTrack', '-', 'figure.delete',
  ],
  // A selected part of a figure: added to the figure's menu (see figureMenu).
  joint: ['hand.letGo', 'joint.pin', 'joint.reset', 'joint.mirror', 'joint.parent', 'joint.child', 'joint.otherSide'],
  prop: [
    'rename', 'duplicate', '-', 'prop.hold', 'prop.give', 'prop.take', 'prop.letGo', 'prop.drop', 'prop.throwTo', 'prop.toss', 'prop.carry', 'prop.dribble', 'prop.shoot',
    '-', 'prop.otherEnd', 'prop.sitOn', 'prop.lieOn', '-', 'prop.delete',
  ],
  shot: ['rename', 'shot.move', 'shot.camera', 'shot.unpin', '-', 'shot.describe', '-', 'shot.removeCut'],
  camera: [
    'camera.pointAim', 'camera.stop', 'camera.deletePoint', '-', 'rename', 'camera.through', 'camera.fromView', 'camera.pointHere', 'duplicate',
    'camera.size', 'camera.lens', '-', 'camera.delete',
  ],
  scene: ['scene.rename', 'scene.duplicate', 'scene.share', 'scene.board', 'scene.template', 'scene.shoot', '-', 'scene.delete'],
  action: ['travel.how', 'travel.facing', 'travel.height', 'travel.turns', '-', 'action.copy', 'action.paste', 'action.duplicate', '-', 'action.split', 'action.splitRepeats', 'action.trimStart', 'action.trimEnd', '-', 'action.mirror', 'action.repeat', 'action.reactTo', 'action.unlink', 'action.saveMotion', 'action.editAsKeys', '-', 'action.remove', 'action.rippleDelete'],
  key: ['key.ease', 'key.hold', '-', 'travel.how', 'travel.facing', 'travel.height', 'travel.turns', '-', 'key.delete'],
  light: ['light.clay', 'light.preset', '-', 'light.fromView', 'light.place', 'light.shadows', 'light.add', '-', 'light.delete'],
  lighting: ['light.preset', 'light.add'],
  many: ['many.duplicate', 'many.hide', '-', 'many.delete'],
  floor: [
    { group: 'Move here' }, 'figure.sitHere', 'figure.walk', 'figure.run', 'figure.jump', 'figure.step', 'figure.turn', 'figure.throw', 'figure.wholeTo', '-',
    'floor.figure', 'floor.standIn', 'floor.prop', 'light.add', '-', 'view.frameAll',
  ],
  timeline: ['timeline.check', 'timeline.repeat', 'timeline.loop', '-', 'timeline.rangeIn', 'timeline.rangeOut', 'timeline.clearRange', '-', 'timeline.deleteCameraPoint', 'timeline.remove'],
} satisfies Record<string, MenuEntry[]>;

export const menu = (name: keyof typeof MENUS, c: Ctx) => menuItems(MENUS[name], c);

/** A figure's menu; with one of its parts selected, that part's commands too (the figure's own, Delete among them, act on the whole figure). */
export function figureMenu(store: Store, figure: string, joint?: JointName): MenuItem[] {
  if (!joint) return menu('figure', { store, figure });
  // (With a part selected the keys act in its context: the figure's commands show the keys that still reach the figure.)
  const part: Ctx = { store, figure, joint };
  return [...menuItems(MENUS.figure, { store, figure }, part), '-', { group: JOINT_LABELS[joint] }, ...menu('joint', part)];
}

/** A command's choices as a menu of their own (the render styles). */
export const choices = (id: string, c: Ctx): MenuItem[] => (command(id).items?.(c) ?? []).map((ch) => ({ label: ch.title, icon: ch.icon, checked: ch.checked, radio: ch.checked !== undefined, disabled: ch.disabled, onSelect: ch.run }));

/** Gestures are not commands: the help dialog lists them with the keys. */
export const GESTURES: [string, string][] = [
  ['Select a body part', 'Click'],
  ['Menu for a figure, prop, camera, shot or scene', 'Right click (touch: long press)'],
  ['Pose a limb · move a hand or foot', 'Drag it'],
  ['Twist a part · turn a figure or prop', 'Shift drag'],
  ['Move a figure or prop on the floor', 'Drag its torso / it'],
  ['Turn a figure or prop', 'Drag its floor ring (Ctrl: 15° steps)'],
  ['Snap a drag to steps (5°, 15°, the 25 cm grid)', 'Ctrl drag (Cmd on macOS)'],
  ['Turn a joint · 5° steps · type its value', 'Its gizmo’s rings or ball · the inspector’s − + (Shift: 15°) · click the value'],
  ['Drag finely', 'Shift drag (one slider)'],
  ['Walk · run · jump the selected figure there', 'Right click the floor'],
  ['How a figure gets to its next key (walk, run, jump…)', 'Right click between its keys'],
  ['Orbit · pan · zoom', 'Drag empty space or Alt drag · Right drag · Wheel'],
  ['Zoom · scroll the timeline', 'Ctrl wheel · Shift wheel'],
  ['Move a key and the keys after it', 'Shift drag the key'],
  ['Move a cut · its blend', 'Drag the cut · the ramp after it'],
  ['Edit an action (a walk, a motion) in the inspector', 'Click its block'],
  ['Move · retime · blend an action', 'Drag its block · its right edge · its ramp'],
  ['Where an action ends · a formation', 'Drag its numbered mark on the floor'],
  ['Move a camera · up and down · add a point', 'Drag it · Shift drag · double-click its path'],
  ['Rename', 'Double-click'],
  ['Type an exact value', 'Click a slider’s value'],
  ['Turn 15°', 'Alt ← → (Ctrl-drag its floor ring: 15° steps)'],
  ['Pick up a prop', 'Drag a hand onto it'],
  ['How a key goes on · hold its pose for a time', 'Right-click the key'],
  ['Pick several keys · move them together', 'Shift-click them (or Shift-drag a box on the row) · drag one'],
  ['Repeat an action · keep a keyed block as a motion', 'Right-click its block'],
  ['Make the animation longer', 'Key or add past its end (the faint stretch)'],
  ['Reorder scenes (scene picker)', 'Alt + arrows'],
  // (The timeline's own keys, once it is clicked in: Esc or a click on the canvas gives them back. #19)
  ['Timeline (clicked in): a frame · the previous / next key · start / end', '← → · Shift ← → · Home End'],
  ['Timeline (clicked in): the person above / below · zoom in, out, whole', '↑ ↓ · = − 0'],
  ['Drag to the edge of a zoomed timeline', 'It scrolls on'],
];

/** The keys for what is selected (the step commands), for the help: what, and the keys. */
export const SELECTION_KEYS: [string, string][] = [
  ['A figure, a prop, several things: move 5 cm the way the screen shows · turn 15°', '← → ↑ ↓ · Alt ← →'],
  ['A prop (or a figure off the floor): raise · lower', 'Page Up · Page Down'],
  ['A figure: move · turn all it does (no key)', 'Ctrl ← → ↑ ↓ · Ctrl Alt ← →'],
  ['A joint: another joint · Bend, Twist, Side 5°', '← → ↑ ↓ · X, Y or Z with ← →'],
  ['A figure (picked): turn · lean forward, sideways 5°', 'Y with ← → · X or Z with ← →'],
  ['A path camera: across, in and out · up and down · pan, tilt', '← → ↑ ↓ · Page Up / Down · Alt + arrows'],
  ['A rig camera: round its subject · its height · closer, wider', '← → · Alt ↑ ↓ · Page Up / Down'],
  ['The light: round · higher, lower', '← → · Page Up / Down'],
  ['Looking through a camera: move that camera', 'As a camera above'],
  ['Three steps at once', 'Shift + any of these'],
  ['The next thing in the scene · the one before', 'Tab · Shift Tab'],
];
