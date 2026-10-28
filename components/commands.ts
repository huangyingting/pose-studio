import {
  Activity, Aperture, ArrowDown, ArrowDownToLine, ArrowUp, ChevronDown, ChevronUp, ArrowLeftRight, ArrowUpFromDot, BedSingle, BookmarkPlus, Camera, ChevronsDown, Clapperboard, ClipboardCopy, ClipboardPaste, Copy, Diamond, Download,
  Eye, EyeOff, FileUp, Film, FlipHorizontal2, Focus, FolderOpen, Footprints, Ghost, Goal, Grid3x3, Hand, Keyboard, LayoutPanelTop, Link, Lock, Move3d, MoveHorizontal, MoveUpRight,
  PanelRightClose, Pause, Pencil, PersonStanding, Play, Plus, Redo2, Scan, RefreshCw, Repeat, Repeat1, RotateCcw, RotateCw, Save, Scale3d, ScanFace, Scissors, Search, Send, Settings2,
  Lightbulb, Spline, StepBack, StepForward, SunMedium, SunMoon, Timer, Trash2, Undo2, UserRound, Video, Wind, X, ZoomIn, ZoomOut, type LucideIcon,
} from 'lucide-react';
import {
  addCamera, addFigure, addKeyframe, addProp, addStandIn, addToBoard, carryProblem, copyMotion, copyPose, cutShot, deleteAction, deleteCamera, deleteCameraPoint, deleteFigure,
  deleteKeyframe, deleteProp, deleteScene, dribbleProp, duplicateCamera, duplicateCurrentScene, duplicateFigure, duplicateProp, editFilm, editShot, holdHandle, holdProp, lieOn,
  mirrorPose, pastePose, propNow, removeAnimation, removeShotCut, resetPose, saveAsShoot, savePose, saveTemplate, setAnimationOptions, setCameraPoint, setClipOptions,
  setFigureHidden, setGaze, setJumpHeight, setTravel, startAnimation, symmetrizePose, throwProp, travelTo, setJoint, holdOn, addCameraPoint, editRig, frameShot, setLens,
  setSceneLight, deleteMany, duplicateMany,
} from '@/lib/actions';
import { DEFAULT_LIGHT, LIGHT_PRESETS, lightFrom } from '@/lib/lighting';
import { snapTime } from '@/lib/animation';
import { cameraById, liveCamera, type CameraView } from '@/lib/cameras';
import { actionsOf } from '@/lib/evaluate';
import { filmOf } from '@/lib/film';
import { HOLDABLE } from '@/lib/hold';
import { JUMP_PREP, jumpHeight } from '@/lib/locomotion';
import { handlesOf } from '@/lib/props';
import { describeSpan } from '@/lib/prompt';
import { shareUrl } from '@/lib/share';
import { shotSpans } from '@/lib/shots';
import { THEMES, type Store } from '@/lib/store';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { actionLabel, keyAtTime, keyTimesOf, moments, travelInto } from '@/lib/track';
import { HANDHELD, JOINTS, PROP_KINDS, PROP_LABELS, STYLES, type JointName, type Light, type Travel, type Vec3 } from '@/lib/types';
import { CONTACT_LABELS, type Contact } from '@/lib/relations';
import { JOINT_LABELS, mirrorJointName } from '@/lib/joints';
import { PARENT } from '@/lib/skeleton';
import { mirrorBones } from '@/lib/pose';
import { LENSES, SHOT_SIZES, viewOf } from '@/lib/cameras';
import { VIEW_PRESETS } from '@/lib/views';
import { PROP_ICONS, STYLE_ICONS } from './icons';
import { startRename } from './rename';
import type { MenuItem, Notify } from './ui';
import { placingFigure, placingProp, type Placing } from './placing';
import type { CanvasHit } from './Viewport';
import { viaPointer } from './hints';

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
  dialog(d: 'export' | 'export-story' | 'photo' | 'help' | 'practice' | 'board' | 'project' | 'palette'): void;
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
  /** Ask for a spot on the floor (a pick mode), then do something there. */
  pickFloor?(hint: string, done: (at: Vec3) => void): void;
  /** Ask for something on the canvas (a figure, a point of its body, a prop), then do something with it. */
  pickThing?(hint: string, take: (hit: CanvasHit) => void): void;
  /** Place something new: its ghost follows the pointer until a click drops it. */
  place?(p: Placing): void;
  /** Frame the selection (if it is out of view, say). */
  frameSelection?(): void;
}

// Until the studio has set it (menus are built while it first renders): nothing playing, nothing to open.
const none = () => {};
let app: App = {
  notify: none, notifyUndo: none, dialog: none, frameAll: none, frameSelected: none, frameView: none, saveFile: none, openFile: none,
  playing: () => false, togglePlay: none, stopPlayback: none, speed: () => 1, setSpeed: none, repeatShot: () => false, setRepeatShot: none,
  onion: () => false, setOnion: none, isolated: () => null, setIsolated: none, captureShot: () => null,
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
  /** A scene of the project (the scene picker). */
  scene?: number;
  /** A spot on the floor. */
  floor?: Vec3;
  /** A time on a track (a key, a camera's point). */
  at?: number;
  /** The scene's key light. */
  light?: boolean;
  /** Several figures and props at once. */
  many?: { figures: string[]; props: string[] };
}

/** A choice of a command that takes one ("Copy moves to: Kai"). */
export interface Choice { title: string; icon?: LucideIcon; checked?: boolean; disabled?: boolean; run(): void }

export interface Command {
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
/** "3 things" (several selected). */
const count = (c: Ctx) => { const n = (c.many?.figures.length ?? 0) + (c.many?.props.length ?? 0); return `${n} things`; };
const lightOf = (c: Ctx) => c.store.scene.light ?? DEFAULT_LIGHT;
const sameLight = (a: Light, b: Light) => (['azimuth', 'elevation', 'intensity', 'warmth', 'shadows'] as const).every((k) => a[k] === b[k]);
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
    case 'action': return { store, action: sel.action, figure: sel.figure };
    case 'light': return { store, light: true };
    case 'many': return { store, many: { figures: sel.figures, props: sel.props } };
  }
}

/** Rename in the scene outline (opening it if another section is showing). */
export function renameInOutline(store: Store, id: string) {
  if (store.getState().settings.side !== 'scene') store.setSettings({ side: 'scene' });
  startRename(id);
}

/** Save the open scene as a template of my own, under a name asked for. */
export function saveAsTemplate(store: Store, { notifyUndo }: { notifyUndo(text: string): void }) {
  const name = window.prompt('Template name', store.scene.name)?.trim();
  if (!name) return;
  saveTemplate(store, name);
  notifyUndo(`Saved “${name}” to My templates`);
}

const hand = (h: 'L' | 'R') => (h === 'L' ? 'left' : 'right');
const spanOf = (c: Ctx) => { const a = c.store.scene.animation; return a && c.shot ? shotSpans(a).find((sp) => sp.shot.id === c.shot) : undefined; };
const actionOf = (c: Ctx) => c.store.scene.animation?.actions.find((x) => x.id === c.action);
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
  const go = (at: Vec3) => travelTo(c.store, f.id, [Math.round(at[0] * 100) / 100, Math.round(at[2] * 100) / 100], kind, opts);
  if (c.floor) go(c.floor);
  else App().pickFloor?.(`Click the floor where ${f.name} should ${opts.strafe ? 'step' : kind} · Esc to cancel`, go);
};

/* ---------------- the commands ---------------- */

export const COMMANDS: Command[] = [
  // The app.
  { id: 'app.undo', title: 'Undo', icon: Undo2, keys: ['mod+z'], enabled: (c) => c.store.getState().canUndo, run: (c) => c.store.undo() },
  { id: 'app.redo', title: 'Redo', icon: Redo2, keys: ['mod+shift+z', 'mod+y'], enabled: (c) => c.store.getState().canRedo, run: (c) => c.store.redo() },
  { id: 'app.save', title: 'Save project (.json)', icon: Save, keys: ['mod+s'], run: () => App().saveFile() },
  { id: 'app.import', title: 'Import scenes from a project…', icon: FileUp, run: () => App().openFile('append') },
  { id: 'app.open', title: 'Open project (replace)…', icon: FolderOpen, run: () => App().openFile('replace') },
  { id: 'app.export', title: 'Export', icon: Download, keys: ['mod+e'], run: () => App().dialog('export') },
  { id: 'app.project', title: 'Project settings…', icon: Settings2, run: () => App().dialog('project') },
  { id: 'app.photo', title: 'Figures from a photo…', icon: ScanFace, run: () => App().dialog('photo') },
  { id: 'app.practice', title: 'Gesture practice', icon: Timer, keys: ['p'], run: () => App().dialog('practice') },
  { id: 'app.board', title: 'Storyboard', icon: LayoutPanelTop, keys: ['b'], run: () => { App().stopPlayback(); App().dialog('board'); } },
  { id: 'app.help', title: 'Keyboard shortcuts', icon: Keyboard, keys: ['?'], run: () => App().dialog('help') },
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
    id: 'app.deselect', title: (c) => (c.store.getState().through ? 'Stop looking through' : 'Deselect'), help: 'Deselect (looking through a camera: stop)', icon: X, keys: ['escape'],
    run: (c) => (c.store.getState().through ? c.store.lookThrough(null) : c.store.select(null)),
  },

  // The canvas's tools.
  { id: 'tool.pose', title: 'Pose tool', icon: Hand, keys: ['e'], checked: (c) => c.store.getState().settings.gizmo === 'rotate', run: (c) => c.store.setSettings({ gizmo: 'rotate' }) },
  { id: 'tool.move', title: 'Move tool', icon: Move3d, keys: ['w'], checked: (c) => c.store.getState().settings.gizmo === 'translate', run: (c) => c.store.setSettings({ gizmo: 'translate' }) },
  {
    id: 'tool.scale', title: 'Scale tool', icon: Scale3d, keys: ['r'], enabled: (c) => c.store.getState().selection?.kind === 'prop',
    checked: (c) => c.store.getState().settings.gizmo === 'scale', run: (c) => c.store.setSettings({ gizmo: 'scale' }),
  },
  { id: 'tool.limits', title: 'Natural joint limits', icon: Lock, checked: (c) => c.store.getState().settings.limits, run: (c) => c.store.setSettings({ limits: !c.store.getState().settings.limits }) },

  // The view.
  ...VIEW_PRESETS.map((v): Command => ({ id: `view.${v.key}`, title: v.label, keys: [v.key], run: (c) => { c.store.lookThrough(null); App().frameView(v); } })),
  { id: 'view.frameAll', title: 'Frame all', icon: Focus, run: () => App().frameAll() },
  {
    id: 'view.frame', title: (c) => (['figure', 'joint', 'prop', 'light', 'many'].includes(c.store.getState().selection?.kind ?? '') ? 'Frame the selection' : 'Frame all'), help: 'Frame the selection (everything when nothing is selected)',
    icon: Focus, keys: ['f'], run: () => App().frameSelected(),
  },
  {
    // Only the selection on the canvas (the scene, the shot camera and exports are not affected).
    id: 'view.isolate', title: 'Isolate the selection', icon: Focus, keys: ['/'],
    when: (c) => !!App().isolated() || !!(c.prop || (c.figure && !c.action)), checked: () => !!App().isolated(),
    run: (c) => App().setIsolated(App().isolated() ? null : c.prop ?? c.figure ?? null),
  },
  {
    id: 'view.through', title: 'Look through', icon: Video,
    items: (c) => {
      const through = c.store.getState().through;
      return [
        { title: 'The editor’s view', checked: !through, run: () => c.store.lookThrough(null) },
        { title: 'The shot camera (the cut)', checked: !!through && !through.camera, run: () => c.store.lookThrough({}) },
        ...sceneOf(c).cameras.map((cam) => ({ title: cam.name, icon: Video, checked: through?.camera === cam.id, run: () => c.store.lookThrough({ camera: cam.id }) })),
      ];
    },
  },
  { id: 'view.handles', title: 'Drag handles', keys: ['h'], checked: (c) => c.store.getState().settings.showHandles, run: (c) => c.store.setSettings({ showHandles: !c.store.getState().settings.showHandles }) },
  { id: 'view.grid', title: 'Floor grid', checked: (c) => c.store.getState().settings.showGrid, run: (c) => c.store.setSettings({ showGrid: !c.store.getState().settings.showGrid }) },
  { id: 'view.onion', title: 'Onion skin (the keys either side)', icon: Ghost, when: animated, checked: () => App().onion(), run: () => App().setOnion(!App().onion()) },
  { id: 'view.guides', title: 'Framing guides (thirds, safe areas)', icon: Grid3x3, checked: (c) => c.store.getState().settings.guides, run: (c) => c.store.setSettings({ guides: !c.store.getState().settings.guides }) },
  {
    id: 'view.line', title: 'Line weight', when: (c) => !!styleDef(filmOf(c.store.getState().library).style).outline,
    items: (c) => [{ label: 'Thin', px: 1 }, { label: 'Medium', px: 1.6 }, { label: 'Bold', px: 2.4 }].map((w) => ({
      title: w.label, checked: Math.abs(c.store.getState().settings.editorLine - w.px) < 0.05, run: () => c.store.setSettings({ editorLine: w.px }),
    })),
  },
  {
    id: 'view.style', title: 'Render style', iconFor: (c) => STYLE_ICONS[filmOf(c.store.getState().library).style],
    items: (c) => STYLE_LIST.map((s) => ({ title: s.label, icon: STYLE_ICONS[s.id], checked: s.id === filmOf(c.store.getState().library).style, run: () => editFilm(c.store, { style: s.id }) })),
  },
  {
    id: 'view.nextStyle', title: 'Next render style', keys: ['l'],
    run: (c) => { const style = filmOf(c.store.getState().library).style; editFilm(c.store, { style: STYLES[(STYLES.indexOf(style) + 1) % STYLES.length] }); },
  },

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

  // The scene's key light.
  {
    id: 'light.preset', title: 'Lighting preset', icon: SunMedium, when: (c) => !!c.light,
    items: (c) => LIGHT_PRESETS.map((p) => ({ title: p.name, checked: sameLight(lightOf(c), p.light), run: () => setSceneLight(c.store, p.light, '') })),
  },
  {
    id: 'light.fromView', title: 'Light from here (from the view)', icon: Lightbulb, when: (c) => !!c.light || onScene(c),
    run: (c) => {
      const v = App().captureShot();
      if (v) setSceneLight(c.store, lightFrom(lightOf(c), v.position.clone().sub(v.target)), '');
    },
  },
  {
    id: 'light.shadows', title: 'Shadows', icon: SunMedium, when: (c) => !!c.light, checked: (c) => lightOf(c).shadows,
    run: (c) => setSceneLight(c.store, { ...lightOf(c), shadows: !lightOf(c).shadows }, ''),
  },
  {
    id: 'light.clay', title: 'Show the light: switch to Clay', icon: SunMedium, when: (c) => !!c.light && !styleDef(filmOf(c.store.getState().library).style).lit,
    run: (c) => editFilm(c.store, { style: 'shaded' }),
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
  { id: 'pose.copy', title: 'Copy pose', icon: ClipboardCopy, keys: ['mod+c'], when: () => !window.getSelection()?.toString(), run: (c) => { if (copyPose(c.store)) App().notify('Pose copied'); } },
  { id: 'pose.paste', title: 'Paste pose', icon: ClipboardPaste, keys: ['mod+v'], run: (c) => { if (!pastePose(c.store)) App().notify('Copy a pose first', 'error'); } },
  { id: 'pose.reset', title: 'Reset pose', icon: RotateCcw, run: (c) => resetPose(c.store) },

  // A part of a figure (the selected joint).
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
    id: 'joint.otherSide', title: 'The same joint on the other side', icon: ArrowLeftRight, keys: ['arrowleft', 'arrowright'],
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
    run: (c) => { c.store.select({ kind: 'figure', figure: c.figure! }); c.store.setSettings({ side: 'library', libraryTab: 'poses' }); },
  },
  {
    id: 'figure.motion', title: 'Choose a motion…', icon: Film, when: (c) => !!figureOf(c) && !figureOf(c)!.proxy && !c.action,
    run: (c) => { c.store.select({ kind: 'figure', figure: c.figure! }); c.store.setSettings({ side: 'library', libraryTab: 'motions' }); },
  },
  {
    id: 'figure.savePose', title: 'Save pose to library', icon: BookmarkPlus, when: (c) => !!figureOf(c) && !figureOf(c)!.proxy && !c.action,
    run: (c) => { const saved = savePose(c.store, c.figure!, `${c.store.scene.name} · ${figureOf(c)!.name}`); if (saved) App().notifyUndo(`Saved “${saved.name}” to the library`); },
  },
  // Getting somewhere: picked on the floor (or the spot right-clicked).
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
    id: 'prop.delete', title: 'Delete', icon: Trash2, keys: ['delete', 'backspace'], danger: true, when: (c) => !!c.prop,
    run: (c) => { const p = sceneOf(c).props.find((x) => x.id === c.prop); deleteProp(c.store, c.prop!); if (p) App().notifyUndo(`Deleted ${p.name}`); },
  },

  // A shot.
  {
    id: 'shot.move', title: 'Choose a camera move…', icon: Video, when: (c) => !!spanOf(c),
    run: (c) => { c.store.setTime(spanOf(c)!.start); c.store.select({ kind: 'shot', shot: c.shot! }); c.store.setSettings({ side: 'library', libraryTab: 'camera' }); },
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
      App().notify(`${cameraById(sceneOf(c), c.camera)?.name} set from the view`);
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
    run: (c) => { const cam = cameraById(sceneOf(c), c.camera); deleteCamera(c.store, c.camera!); if (cam) App().notifyUndo(`Deleted ${cam.name}`); },
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
    id: 'scene.board', title: 'Add to storyboard', icon: LayoutPanelTop, when: (c) => c.scene !== undefined,
    run: (c) => { const s = c.store.getState().library.scenes[c.scene!]; addToBoard(c.store, s.id); App().notifyUndo(`Added “${s.name}” to the storyboard (B)`); },
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
    id: 'scene.delete', title: 'Delete', icon: Trash2, danger: true, when: (c) => c.scene !== undefined, enabled: (c) => c.store.getState().library.scenes.length > 1,
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
    id: 'travel.facing', title: 'Keep facing (side steps, backing up)', icon: ArrowLeftRight,
    when: (c) => { const k = travelHow(c)?.kind; return k === 'walk' || k === 'run'; }, checked: (c) => !!travelHow(c)?.keep.strafe,
    run: (c) => { const h = travelHow(c)!; setTravelOf(c, h.kind, { strafe: !h.keep.strafe }); },
  },
  {
    id: 'travel.height', title: (c) => `Height · ${jumpNow(c).toFixed(2)} m`, when: (c) => travelHow(c)?.kind === 'jump',
    items: (c) => ([['Low (0.3 m)', 0.3], ['Medium (0.5 m)', 0.5], ['High (0.8 m)', 0.8], ['Very high (1.2 m)', 1.2]] as const).map(([title, h]) => ({
      title, checked: Math.abs(jumpNow(c) - h) < 0.06, run: () => setJumpHeight(c.store, c.figure!, travelHow(c)!.t, h),
    })),
  },
  {
    id: 'travel.turns', title: 'In the air', when: (c) => travelHow(c)?.kind === 'jump',
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
  { id: 'action.edit', title: 'Edit in the inspector', icon: Pencil, when: (c) => !!actionOf(c), run: (c) => c.store.select({ kind: 'action', action: c.action!, figure: c.figure! }) },
  {
    id: 'action.remove', title: (c) => `Remove ${actionOf(c) ? actionLabel(actionOf(c)!) : ''}`, icon: Trash2, keys: ['delete', 'backspace'], danger: true, when: (c) => !!actionOf(c),
    run: (c) => { const act = actionOf(c)!; deleteAction(c.store, act.id); App().notifyUndo(`Deleted ${actionLabel(act)}`); },
  },

  // A key on a figure's track (`at`).
  {
    id: 'key.delete', title: 'Delete key', icon: Trash2, danger: true, when: (c) => !!c.figure && c.at !== undefined && !c.action,
    enabled: (c) => keyTimesOf(sceneOf(c).animation!, c.figure!).length > 1, run: (c) => deleteKeyframe(c.store, c.figure!),
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
    id: 'timeline.prevKey', title: 'Previous keyframe', icon: StepBack, when: animated,
    enabled: (c) => stops(c).some((t) => t < c.store.getState().time - 1e-3), run: (c) => stepTo(c, (now) => [...stops(c)].reverse().find((x) => x < now - 1e-3)),
  },
  {
    id: 'timeline.nextKey', title: 'Next keyframe', icon: StepForward, when: animated,
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
      } else addKeyframe(c.store);
    },
  },
  {
    id: 'timeline.deleteKey', title: (c) => `Delete ${keyName(c)}`, icon: Trash2, when: animated,
    enabled: (c) => keysHere(c).on && keysHere(c).times.length > 1, run: (c) => deleteKeyframe(c.store),
  },
  {
    id: 'timeline.cut', title: (c) => (c.store.getState().through ? 'Cut here, filmed from this view by a new camera' : 'Cut: start a new shot here'),
    help: 'Cut: start a new shot here (looking through a camera: filmed from this view by a new camera)', icon: Scissors, keys: ['c'], when: animated,
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
      App().notify(`${cam.name} set from the view`);
    },
  },
  {
    id: 'timeline.deleteCameraPoint', title: (c) => `Delete ${rowCamera(c).name}’s point`, icon: Trash2, when: animated,
    enabled: (c) => { const cam = rowCamera(c); return cam.kind === 'path' && cam.points.length > 1 && onCameraPoint(c); },
    run: (c) => deleteCameraPoint(c.store, c.store.getState().time, rowCamera(c).id),
  },
  { id: 'timeline.check', title: 'Check the motion', icon: Activity, when: animated, run: () => App().checkMotion?.() },
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

/** The joint below another (the first, where it branches: the chest's is the neck). */
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
  return `keyframe${sceneOf(c).figures.length > 1 && f ? ` (${f.name})` : ''}`;
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
  const names: Record<string, string> = { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', space: 'Space', delete: 'Del', backspace: 'Backspace', escape: 'Esc' };
  const parts = spec.split('+');
  const key = parts.pop()!;
  // A symbol typed with Shift ('?') shows as itself.
  const mods = parts.filter((p) => !(p === 'shift' && key.length === 1 && !/[a-z0-9]/.test(key)));
  return [...mods.map((p) => names[p] ?? p), names[key] ?? key.toUpperCase()].join(' ');
}
/** A command's shortcut as shown. */
export const shortcutOf = (id: string) => { const k = command(id).keys?.[0]; return k ? keyLabel(k) : undefined; };
/** A tooltip with a command's shortcut ("Label  Ctrl E": the tooltip shows the keys apart). */
export const tipOf = (id: string, label?: string) => { const k = shortcutOf(id); const t = label ?? (typeof command(id).title === 'string' ? command(id).title as string : id); return k ? `${t}  ${k}` : t; };

/** Whether a key press is this key ('mod+z' is not 'mod+shift+z'; a symbol's Shift is the symbol's). */
export function matchesKey(spec: string, e: KeyboardEvent) {
  const parts = spec.split('+');
  const key = parts.pop()!;
  if (parts.includes('mod') !== (e.ctrlKey || e.metaKey) || parts.includes('alt') !== e.altKey) return false;
  const letter = /^[a-z]$/.test(key);
  if (letter && parts.includes('mod') && parts.includes('shift') !== e.shiftKey) return false;
  const pressed = e.key === ' ' ? 'space' : e.key.toLowerCase();
  return pressed === key;
}

/** The command a key press runs here, if any. */
export function commandForKey(e: KeyboardEvent, c: Ctx) {
  return COMMANDS.find((cmd) => cmd.keys?.some((k) => matchesKey(k, e)) && applies(cmd, c) && enabled(cmd, c) && cmd.run);
}

/* ---------------- menus ---------------- */

/** A menu: commands by id, dividers, and group titles. A command with choices shows them under its title. */
export type MenuEntry = string | '-' | { group: string };

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
      for (const ch of choices) out.push({ label: ch.title, icon: ch.icon, checked: ch.checked, disabled: ch.disabled, onSelect: ch.run });
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

export const MENUS = {
  main: ['app.save', 'app.import', 'app.open', '-', 'app.project', 'app.practice', 'app.help', 'app.theme'],
  view: [
    { group: 'Angle' }, ...VIEW_PRESETS.map((v) => `view.${v.key}`), 'view.isolate', 'view.through',
    { group: 'Show' }, 'view.handles', 'view.grid', 'view.onion', 'view.guides', 'view.line',
  ],
  figure: [
    'rename', 'duplicate', 'figure.hide', '-', 'figure.pose', 'figure.motion', 'figure.savePose',
    { group: 'Move to' }, 'figure.walk', 'figure.run', 'figure.jump', 'figure.step', 'figure.throw',
    'figure.eyes', 'figure.holdOn', 'figure.copyMoves', '-', 'figure.delete',
  ],
  // A selected part of a figure: added to the figure's menu (see figureMenu).
  joint: ['joint.reset', 'joint.mirror', 'joint.parent', 'joint.child', 'joint.otherSide'],
  prop: [
    'rename', 'duplicate', '-', 'prop.hold', 'prop.give', 'prop.take', 'prop.letGo', 'prop.drop', 'prop.throwTo', 'prop.toss', 'prop.dribble', 'prop.shoot',
    '-', 'prop.otherEnd', 'prop.lieOn', '-', 'prop.delete',
  ],
  shot: ['rename', 'shot.move', 'shot.camera', '-', 'shot.describe', '-', 'shot.removeCut'],
  camera: [
    'camera.deletePoint', '-', 'rename', 'camera.through', 'camera.fromView', 'camera.pointHere', 'duplicate',
    'camera.size', 'camera.lens', '-', 'camera.delete',
  ],
  scene: ['scene.rename', 'scene.duplicate', 'scene.share', 'scene.board', 'scene.template', 'scene.shoot', '-', 'scene.delete'],
  action: ['travel.how', 'travel.facing', 'travel.height', 'travel.turns', '-', 'action.mirror', '-', 'action.edit', 'action.remove'],
  key: ['travel.how', 'travel.facing', 'travel.height', 'travel.turns', '-', 'key.delete'],
  light: ['light.clay', 'light.preset', '-', 'light.fromView', 'light.shadows'],
  many: ['many.duplicate', 'many.hide', '-', 'many.delete'],
  floor: [
    { group: 'Move here' }, 'figure.walk', 'figure.run', 'figure.jump', 'figure.step', 'figure.throw', '-',
    'floor.figure', 'floor.standIn', 'floor.prop', '-', 'view.frameAll',
  ],
  timeline: ['timeline.check', 'timeline.repeat', 'timeline.loop', '-', 'timeline.deleteCameraPoint', 'timeline.remove'],
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
export const choices = (id: string, c: Ctx): MenuItem[] => (command(id).items?.(c) ?? []).map((ch) => ({ label: ch.title, icon: ch.icon, checked: ch.checked, disabled: ch.disabled, onSelect: ch.run }));

/** Gestures are not commands: the help dialog lists them with the keys. */
export const GESTURES: [string, string][] = [
  ['Select a body part', 'Click'],
  ['Menu for a figure, prop, camera, shot or scene', 'Right click (touch: long press)'],
  ['Pose a limb · move a hand or foot', 'Drag it'],
  ['Twist a part · turn a figure or prop', 'Shift drag'],
  ['Move a figure or prop on the floor', 'Drag its torso / it'],
  ['Turn a figure or prop', 'Drag its floor ring (Ctrl: 15° steps)'],
  ['Snap a drag to steps (5°, 15°, the 25 cm grid)', 'Ctrl drag (Cmd on macOS)'],
  ['Drag finely', 'Shift drag (joint arcs, one slider)'],
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
  ['Reorder scenes (scene picker)', 'Alt + arrows'],
];
