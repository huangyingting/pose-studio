import { grown, lastTime, normalize, propKeyOf } from './animation';
import { clipIdsOf } from './assets';
import { loadClips } from './assetstore';
import { setFilm } from './film';
import { setModels } from './model';
import { newScene, parseLibrary } from './doc';
import { sceneAt } from './evaluate';
import { keepProps, setPropKey } from './propmotion';
import { setPoseAt } from './track';
import { shotSpans } from './shots';
import type { Figure, GizmoMode, Library, Pose, Prop, Scene, Selection } from './types';

/** The device's preferences (the project's look is its film's: lib/film.ts). */
export interface Settings {
  showHandles: boolean;
  showGrid: boolean;
  limits: boolean;
  gizmo: GizmoMode;
  /** Outline width in the editor (CSS px). */
  editorLine: number;
  /** The left side panel's open section, or 'none' when it is collapsed to the rail. */
  side: SideSection;
  /** The library's open tab. */
  libraryTab: LibraryTab;
  /** The right-hand inspector is open (it folds away for more canvas). */
  inspector: boolean;
  /** The timeline shows only its toolbar (more canvas). */
  timelineFolded: boolean;
  /** Height of the timeline's tracks (px), or 0 to fit them (up to a limit). */
  timelineHeight: number;
  /** Looking through the shot camera, show the rule-of-thirds lines and safe areas. */
  guides: boolean;
  /** Widths the side panels were dragged to (px): each left section's, and the inspector's. */
  widths: Partial<Record<(typeof SIDE_SECTIONS)[number] | 'inspector', number>>;
  /** The chrome's colours: as the system's, or light or dark. */
  theme: Theme;
}

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** How wide a side panel can be dragged. */
export const PANEL_WIDTH = { min: 200, max: 520 };

export const LIBRARY_TABS = ['templates', 'characters', 'poses', 'motions', 'camera'] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

export const SIDE_SECTIONS = ['scene', 'library', 'ai'] as const;
export type SideSection = (typeof SIDE_SECTIONS)[number] | 'none';

export type SaveStatus = 'saved' | 'pending' | 'error';

/** What is selected when a scene opens: its first figure (nothing in a scene without one). */
export const openingSelection = (scene: Scene | undefined): Selection => {
  const f = scene?.figures.find((x) => !x.hidden) ?? scene?.figures[0];
  return f ? { kind: 'figure', figure: f.id } : null;
};

/** What the canvas looks through: the editor's own view (null), the cut (what the shots show), or one camera. */
export type Through = { camera?: string } | null;

export interface State {
  library: Library;
  sceneIndex: number;
  selection: Selection;
  /** Figure that body/hand/pose tools act on. */
  activeFigure: string | null;
  settings: Settings;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: SaveStatus;
  /** Animation time (seconds) of the open pose; its figures always show the pose at this time. */
  time: number;
  through: Through;
  /** The figure, prop or camera under the pointer in the outline or on the canvas: the other one shows it too. */
  linked: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  showHandles: true, showGrid: true, limits: true, gizmo: 'rotate', editorLine: 1.6, side: 'scene', libraryTab: 'poses', inspector: true, timelineFolded: false, timelineHeight: 0, guides: false, widths: {}, theme: 'system',
};

const STORAGE = { library: 'pose-studio-library', settings: 'pose-studio-settings', index: 'pose-studio-index' };
const HISTORY_LIMIT = 200;
/** Continuous edits with the same key within this window merge into one undo step. */
const MERGE_MS = 800;

type Listener = () => void;

/** An undo/redo step: the library to restore, and which pose to show before and after it. */
interface HistoryEntry {
  library: Library;
  /** Pose shown when this library is restored. */
  index: number;
  /** Pose shown when the step is re-applied. */
  after: number;
}

function loadLibrary(storage: Storage | null): Library {
  try {
    const raw = storage?.getItem(STORAGE.library);
    if (raw) {
      return parseLibrary(JSON.parse(raw));
    }
  } catch {
    // Corrupt entry: start a new project.
  }
  // A new project: one empty scene (the built-in poses live in the pose library).
  return { version: 3, scenes: [newScene('Scene 1')] };
}

function loadSettings(storage: Storage | null): Settings {
  try {
    const raw = storage?.getItem(STORAGE.settings);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return {
        showHandles: s.showHandles !== false,
        showGrid: s.showGrid !== false,
        limits: s.limits !== false,
        gizmo: s.gizmo === 'translate' || s.gizmo === 'scale' ? s.gizmo : 'rotate',
        editorLine: typeof s.editorLine === 'number' ? Math.min(4, Math.max(0.5, s.editorLine)) : DEFAULT_SETTINGS.editorLine,
        side: s.side === 'none' || SIDE_SECTIONS.includes(s.side as (typeof SIDE_SECTIONS)[number]) ? (s.side as SideSection) : 'scene',
        libraryTab: LIBRARY_TABS.includes(s.libraryTab as LibraryTab) ? (s.libraryTab as LibraryTab) : 'poses',
        inspector: s.inspector !== false,
        timelineFolded: s.timelineFolded === true,
        timelineHeight: typeof s.timelineHeight === 'number' ? Math.min(2000, Math.max(0, s.timelineHeight)) : 0,
        guides: s.guides === true,
        widths: Object.fromEntries(Object.entries(s.widths ?? {}).filter(([k, v]) => (k === 'inspector' || SIDE_SECTIONS.includes(k as (typeof SIDE_SECTIONS)[number])) && typeof v === 'number')
          .map(([k, v]) => [k, Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, v as number))])),
        theme: THEMES.includes(s.theme as Theme) ? (s.theme as Theme) : 'system',
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

export class Store {
  private state: State;
  private listeners = new Set<Listener>();
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private lastKey = '';
  /** Inside `group`: whether its first edit has been recorded (the rest join it). */
  private grouped: boolean | null = null;
  private lastTime = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pose copied with Ctrl+C. */
  clipboard: Pick<Figure, 'bones' | 'hands'> | null = null;
  /** Set when localStorage is full or unavailable. */
  saveError: string | null = null;
  /** Library object last written to storage. */
  private savedLibrary: Library | null = null;

  constructor(private storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage) {
    const library = loadLibrary(storage);
    setModels(library.models);
    setFilm(library.film);
    const idx = Number(storage?.getItem(STORAGE.index) ?? 0);
    const sceneIndex = Number.isInteger(idx) && idx >= 0 && idx < library.scenes.length ? idx : 0;
    this.state = this.normalize({
      library, sceneIndex, selection: openingSelection(library.scenes[sceneIndex]), activeFigure: null, settings: loadSettings(storage), canUndo: false, canRedo: false, saveStatus: 'saved', time: 0, through: null, linked: null,
    });
    // An animated pose opens at its first frame.
    this.state = { ...this.state, library: this.withFrame(this.state.library, this.state.sceneIndex, 0) };
    void this.loadClips();
  }

  /**
   * Bring the imported clips the library uses to hand, from where they are kept (lib/assetstore.ts).
   * Returns the ids of those not kept here (another device has them: the server may).
   */
  loadClips() {
    return loadClips(clipIdsOf(this.state.library));
  }

  getState = () => this.state;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  get scene(): Scene {
    return this.state.library.scenes[this.state.sceneIndex];
  }

  get figure(): Figure | null {
    return this.scene.figures.find((f) => f.id === this.state.activeFigure) ?? null;
  }

  /** Keep the index, selection and active figure pointing at things that exist. */
  private normalize(s: State): State {
    const sceneIndex = Math.min(Math.max(0, s.sceneIndex), s.library.scenes.length - 1);
    const scene = s.library.scenes[sceneIndex];
    let selection = s.selection;
    if (selection?.kind === 'joint' || selection?.kind === 'figure') {
      const fig = selection.figure;
      if (!scene.figures.some((f) => f.id === fig)) selection = null;
    } else if (selection?.kind === 'prop') {
      const prop = selection.prop;
      if (!scene.props.some((p) => p.id === prop)) selection = null;
    } else if (selection?.kind === 'action') {
      const { action, figure } = selection;
      if (!scene.animation?.actions.some((x) => x.id === action && x.roles.some((r) => r.figure === figure))) selection = null;
    } else if (selection?.kind === 'shot') {
      const shot = selection.shot;
      if (!scene.animation || !shotSpans(scene.animation).some((sp) => sp.shot.id === shot)) selection = null;
    } else if (selection?.kind === 'camera') {
      const camera = selection.camera;
      if (!scene.cameras.some((c) => c.id === camera)) selection = null;
    } else if (selection?.kind === 'many') {
      // Those that are still there: one left is selected alone.
      const figures = selection.figures.filter((id) => scene.figures.some((f) => f.id === id));
      const props = selection.props.filter((id) => scene.props.some((p) => p.id === id));
      if (figures.length + props.length > 1) selection = figures.length === selection.figures.length && props.length === selection.props.length ? selection : { kind: 'many', figures, props };
      else selection = figures.length ? { kind: 'figure', figure: figures[0] } : props.length ? { kind: 'prop', prop: props[0] } : null;
    }
    const through = s.through?.camera && !scene.cameras.some((c) => c.id === s.through!.camera) ? null : s.through;
    let activeFigure = selection?.kind === 'joint' || selection?.kind === 'figure' || selection?.kind === 'action' ? selection.figure : s.activeFigure;
    if (!scene.figures.some((f) => f.id === activeFigure)) activeFigure = scene.figures[0]?.id ?? null;
    return { ...s, sceneIndex, selection, activeFigure, through, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
  }

  private set(patch: Partial<State>, persist = true) {
    if (patch.library && patch.library.models !== this.state.library.models) setModels(patch.library.models);
    if (patch.library && patch.library.film !== this.state.library.film) setFilm(patch.library.film);
    const pending = persist && this.storage !== null;
    this.state = this.normalize({ ...this.state, ...patch, ...(pending ? { saveStatus: 'pending' as const } : {}) });
    if (pending) this.scheduleSave();
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  /** Write pending changes to storage now (also called when the page is hidden or closed). */
  save() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.storage) return;
    try {
      // The library is by far the largest item; skip it when only the settings or index changed.
      if (this.state.library !== this.savedLibrary) {
        this.storage.setItem(STORAGE.library, JSON.stringify(this.state.library));
        this.savedLibrary = this.state.library;
      }
      this.storage.setItem(STORAGE.settings, JSON.stringify(this.state.settings));
      this.storage.setItem(STORAGE.index, String(this.state.sceneIndex));
      this.saveError = null;
    } catch (err) {
      this.saveError = (err as Error).message || 'Storage is full';
    }
    const saveStatus = this.saveError ? 'error' : 'saved';
    if (this.state.saveStatus !== saveStatus) {
      this.state = { ...this.state, saveStatus };
      this.emit();
    }
  }

  /* ---------- document edits (undoable) ---------- */

  commit(update: (lib: Library) => Library, key = '', extra: Partial<State> = {}) {
    const prev = this.state.library;
    const prevIndex = this.state.sceneIndex;
    let next = update(prev);
    if (next === prev) return;
    next = this.grown(this.autoKey(prev, next));
    const now = Date.now();
    const merge = (this.grouped === true && this.past.length > 0) || (key && key === this.lastKey && now - this.lastTime < MERGE_MS && this.past.length > 0);
    if (this.grouped === false) this.grouped = true;
    if (!merge) {
      this.past.push({ library: prev, index: prevIndex, after: prevIndex });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.future = [];
    this.lastKey = key;
    this.lastTime = now;
    this.set({ library: next, ...extra });
    this.past[this.past.length - 1].after = this.state.sceneIndex;
  }

  /**
   * Auto-key: in an animated pose, a change to a figure's pose is recorded at the current time on
   * that figure's own track (lib/track.ts setPoseAt; other figures' tracks are untouched). Deleted
   * figures lose their actions; new ones hold their pose.
   */
  private autoKey(prev: Library, next: Library): Library {
    const i = this.state.sceneIndex;
    const before = prev.scenes[i];
    const after = next.scenes[i];
    if (!after?.animation || !before || before.id !== after.id || (before.figures === after.figures && before.props === after.props)) return next;
    const pose = (f: Figure): Pose => ({ bones: f.bones, position: f.position, hands: f.hands, grounded: f.grounded });
    const was = new Map(before.figures.map((f) => [f.id, JSON.stringify(pose(f))]));
    let animation = normalize(after.animation, after.figures);
    for (const f of after.figures) {
      if (was.has(f.id) && was.get(f.id) !== JSON.stringify(pose(f))) animation = setPoseAt({ ...after, animation }, f.id, this.state.time, pose(f));
    }
    // Props too: moving one, or putting it in a hand, keys it here (the first time, from where it was).
    const wasProp = new Map(before.props.map((p) => [p.id, p]));
    for (const p of after.props) {
      const old = wasProp.get(p.id);
      if (old && JSON.stringify(propKeyOf(old, 0)) !== JSON.stringify(propKeyOf(p, 0))) animation = setPropKey(animation, this.state.time, p, {}, old);
    }
    animation = keepProps(animation, new Set(after.props.map((p) => p.id)));
    if (animation === after.animation) return next;
    return { ...next, scenes: next.scenes.map((x, j) => (j === i ? { ...after, animation } : x)) };
  }

  /** The open scene's animation lengthened to what was put past its end. */
  private grown(lib: Library): Library {
    const i = this.state.sceneIndex;
    const s = lib.scenes[i];
    const g = s && grown(s);
    return g === s ? lib : { ...lib, scenes: lib.scenes.map((x, j) => (j === i ? g : x)) };
  }

  /** The library with an animated scene's figures posed for `time`. */
  private withFrame(lib: Library, index: number, time: number): Library {
    const s = lib.scenes[index];
    if (!s?.animation) return lib;
    return { ...lib, scenes: lib.scenes.map((x, j) => (j === index ? sceneAt(x, time) : x)) };
  }

  /** Edits made by `fn` (an action made of several) undo as one step. */
  group<T>(fn: () => T): T {
    if (this.grouped !== null) return fn();
    this.grouped = false;
    try {
      return fn();
    } finally {
      this.grouped = null;
      this.lastKey = '';
    }
  }

  updateScene(fn: (s: Scene) => Scene, key = '') {
    const i = this.state.sceneIndex;
    // (Nothing changed: no undo step.)
    this.commit((lib) => {
      const next = fn(lib.scenes[i]);
      return next === lib.scenes[i] ? lib : { ...lib, scenes: lib.scenes.map((s, j) => (j === i ? next : s)) };
    }, key);
  }

  updateFigure(id: string, fn: (f: Figure) => Figure, key = '') {
    this.updateScene((s) => ({ ...s, figures: s.figures.map((f) => (f.id === id ? fn(f) : f)) }), key);
  }

  updateActiveFigure(fn: (f: Figure) => Figure, key = '') {
    const id = this.state.activeFigure;
    if (id) this.updateFigure(id, fn, key);
  }

  updateProp(id: string, fn: (p: Prop) => Prop, key = '') {
    this.updateScene((s) => ({ ...s, props: s.props.map((p) => (p.id === id ? fn(p) : p)) }), key);
  }

  /** Undo/redo also bring the affected pose into view, so a change is never undone off-screen. */
  undo() {
    const e = this.past.pop();
    if (!e) return;
    this.future.push({ library: this.state.library, index: e.after, after: e.index });
    this.lastKey = '';
    this.set({ library: this.withFrame(e.library, e.index, this.state.time), sceneIndex: e.index });
  }

  redo() {
    const e = this.future.pop();
    if (!e) return;
    this.past.push({ library: this.state.library, index: e.after, after: e.index });
    this.lastKey = '';
    this.set({ library: this.withFrame(e.library, e.index, this.state.time), sceneIndex: e.index });
  }

  /**
   * Adopt a library saved by another tab (storage event). The undo history is dropped because
   * it describes a different document. Returns false if the data is unusable.
   */
  adoptExternal(raw: string | null) {
    if (!raw) return false;
    let library: Library;
    try {
      library = parseLibrary(JSON.parse(raw));
    } catch {
      return false;
    }
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.past = [];
    this.future = [];
    this.lastKey = '';
    const id = this.scene.id;
    const same = library.scenes.findIndex((s) => s.id === id);
    this.savedLibrary = library;
    this.set({ library, sceneIndex: same >= 0 ? same : this.state.sceneIndex, saveStatus: 'saved' }, false);
    void this.loadClips();
    return true;
  }

  /** Take the library from elsewhere (server-side library sync): saved here; resets undo. */
  adoptLibrary(library: Library) {
    this.past = [];
    this.future = [];
    this.lastKey = '';
    const same = library.scenes.findIndex((s) => s.id === this.scene.id);
    const sceneIndex = same >= 0 ? same : Math.min(this.state.sceneIndex, library.scenes.length - 1);
    this.set({ library: this.withFrame(library, sceneIndex, this.state.time), sceneIndex });
    void this.loadClips();
  }

  static readonly LIBRARY_KEY = STORAGE.library;

  /* ---------- UI state (not undoable) ---------- */

  setSceneIndex(sceneIndex: number) {
    this.set({ sceneIndex, selection: openingSelection(this.state.library.scenes[sceneIndex]), activeFigure: null, time: 0, library: this.withFrame(this.state.library, sceneIndex, 0) });
  }

  /** Move the animation playhead; the figures take the pose for that time (not an undo step). */
  setTime(time: number) {
    const a = this.scene.animation;
    const t = a ? Math.min(lastTime(a), Math.max(0, time)) : 0;
    this.set({ time: t, library: this.withFrame(this.state.library, this.state.sceneIndex, t) });
  }

  select(selection: Selection) {
    this.set({ selection }, false);
  }

  lookThrough(through: Through) {
    this.set({ through }, false);
  }

  /** What the pointer rests on, in the outline or on the canvas (the other shows it too). */
  setLinked(linked: string | null) {
    if (linked !== this.state.linked) this.set({ linked }, false);
  }

  setActiveFigure(activeFigure: string) {
    const sel = this.state.selection;
    // A selected figure follows (the inspector shows the active one); another figure's part or action is let go.
    const selection: Selection = sel?.kind === 'figure' ? { kind: 'figure', figure: activeFigure } : (sel?.kind === 'joint' || sel?.kind === 'action') && sel.figure !== activeFigure ? null : sel;
    this.set({ activeFigure, selection }, false);
  }

  setSettings(patch: Partial<Settings>) {
    this.set({ settings: { ...this.state.settings, ...patch } });
  }
}
