import { parseLibrary } from './doc';
import { DEFAULT_LIGHT, clampLight } from './lighting';
import { presetScenes } from './presets';
import { STYLES, type Figure, type GizmoMode, type Library, type Light, type Prop, type Scene, type Selection, type Style } from './types';

export interface Settings {
  style: Style;
  showHandles: boolean;
  showGrid: boolean;
  limits: boolean;
  gizmo: GizmoMode;
  /** Outline width in the editor (CSS px). */
  editorLine: number;
  /** Key light for the shaded style (editor and export). */
  light: Light;
  /** Simple face details (nose, ears, eyes, brows, mouth). */
  faces: boolean;
}

export type SaveStatus = 'saved' | 'pending' | 'error';

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
}

export const DEFAULT_SETTINGS: Settings = {
  style: 'line', showHandles: true, showGrid: true, limits: true, gizmo: 'rotate', editorLine: 1.6, light: DEFAULT_LIGHT, faces: true,
};

const STORAGE = { library: 'pose-studio-library-v2', legacy: 'pose-studio-library-v1', settings: 'pose-studio-settings-v1', index: 'pose-studio-index' };
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
  for (const key of [STORAGE.library, STORAGE.legacy]) {
    try {
      const raw = storage?.getItem(key);
      if (raw) return parseLibrary(JSON.parse(raw));
    } catch {
      // Corrupt entry: fall through to the next source.
    }
  }
  return { version: 2, scenes: presetScenes() };
}

function loadSettings(storage: Storage | null): Settings {
  try {
    const raw = storage?.getItem(STORAGE.settings);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return {
        style: STYLES.includes(s.style as Style) ? (s.style as Style) : 'line',
        showHandles: s.showHandles !== false,
        showGrid: s.showGrid !== false,
        limits: s.limits !== false,
        gizmo: s.gizmo === 'translate' || s.gizmo === 'scale' ? s.gizmo : 'rotate',
        editorLine: typeof s.editorLine === 'number' ? Math.min(4, Math.max(0.5, s.editorLine)) : DEFAULT_SETTINGS.editorLine,
        light: clampLight(s.light),
        faces: s.faces !== false,
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
  private lastTime = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pose copied with Ctrl+C. */
  clipboard: Pick<Figure, 'joints' | 'hands'> | null = null;
  /** Set when localStorage is full or unavailable. */
  saveError: string | null = null;
  /** Library object last written to storage. */
  private savedLibrary: Library | null = null;

  constructor(private storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage) {
    const library = loadLibrary(storage);
    const idx = Number(storage?.getItem(STORAGE.index) ?? 0);
    const sceneIndex = Number.isInteger(idx) && idx >= 0 && idx < library.scenes.length ? idx : 0;
    this.state = this.normalize({
      library, sceneIndex, selection: null, activeFigure: null, settings: loadSettings(storage), canUndo: false, canRedo: false, saveStatus: 'saved',
    });
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
    if (selection?.kind === 'joint') {
      const fig = selection.figure;
      if (!scene.figures.some((f) => f.id === fig)) selection = null;
    } else if (selection?.kind === 'prop') {
      const prop = selection.prop;
      if (!scene.props.some((p) => p.id === prop)) selection = null;
    }
    let activeFigure = selection?.kind === 'joint' ? selection.figure : s.activeFigure;
    if (!scene.figures.some((f) => f.id === activeFigure)) activeFigure = scene.figures[0]?.id ?? null;
    return { ...s, sceneIndex, selection, activeFigure, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
  }

  private set(patch: Partial<State>, persist = true) {
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
    const next = update(prev);
    if (next === prev) return;
    const now = Date.now();
    const merge = key && key === this.lastKey && now - this.lastTime < MERGE_MS && this.past.length > 0;
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

  updateScene(fn: (s: Scene) => Scene, key = '') {
    const i = this.state.sceneIndex;
    this.commit((lib) => ({ ...lib, scenes: lib.scenes.map((s, j) => (j === i ? fn(s) : s)) }), key);
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
    this.set({ library: e.library, sceneIndex: e.index });
  }

  redo() {
    const e = this.future.pop();
    if (!e) return;
    this.past.push({ library: this.state.library, index: e.after, after: e.index });
    this.lastKey = '';
    this.set({ library: e.library, sceneIndex: e.index });
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
    return true;
  }

  static readonly LIBRARY_KEY = STORAGE.library;

  /* ---------- UI state (not undoable) ---------- */

  setSceneIndex(sceneIndex: number) {
    this.set({ sceneIndex, selection: null, activeFigure: null });
  }

  select(selection: Selection) {
    this.set({ selection }, false);
  }

  setActiveFigure(activeFigure: string) {
    const sel = this.state.selection;
    this.set({ activeFigure, selection: sel?.kind === 'joint' && sel.figure !== activeFigure ? null : sel }, false);
  }

  setSettings(patch: Partial<Settings>) {
    this.set({ settings: { ...this.state.settings, ...patch } });
  }
}
