'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import {
  ChevronDown, Crosshair, Download, Ellipsis, Eye, EyeOff, Info, Keyboard, Lightbulb, Maximize2, Minimize2, MousePointer2, RectangleHorizontal, X, LayoutPanelTop, PanelLeft, PanelRightClose, PanelRightOpen, SlidersHorizontal, type LucideIcon,
} from 'lucide-react';
import { addMotions, appendScenes, replaceLibrary } from '@/lib/actions';
import { clipsIn, parseLibrary, uid } from '@/lib/doc';
import { withBase } from '@/lib/paths';
import { downloadBlob } from '@/lib/render';
import { decodeScene, sceneParam } from '@/lib/share';
import { Store } from '@/lib/store';
import { loadPhysics, onPhysicsReady } from '@/lib/physics';
import { clipById, clipIdsOf, onClips } from '@/lib/assets';
import { angleAt, frameAspect } from '@/lib/cameras';
import { actionLabel } from '@/lib/track';
import { modelTemplate, onModels } from '@/lib/model';
import { actionsOf } from '@/lib/evaluate';
import { styleDef } from '@/lib/styles';
import { lightingOf } from '@/lib/lighting';
import type { Scene, Vec3, View } from '@/lib/types';
import Board from './Board';
import { ExportDialog, HelpDialog, PhotoDialog } from './dialogs';
import { StartDialog } from './StartDialog';
// Accounts, library sync and AI: the server edition only (null in the static build).
import { Account, SaveState, ServerRoot } from '@edition/server';
import SaveIndicator from './SaveIndicator';
import ErrorBoundary from './ErrorBoundary';
import Inspector, { type InspectorContext } from './Inspector';
import ScenePicker from './ScenePicker';
import SidePanel from './side/SidePanel';
import { StoreContext, useProjectSettings, useScene, useStore, useStudio } from './store-context';
import { PracticeMode } from './Practice';
import { Clock, startPlayback } from './clock';
import { STYLE_ICONS } from './icons';
import Timeline from './Timeline';
import { IconButton, Menu, Toasts, Toolbar, type Notify, type Toast } from './ui';
import { onOutdated } from '@/lib/assetstore';
import Viewport, { type CanvasHit, type FrameRequest, type ViewportApi } from './Viewport';
import { ContextMenuHost, openContextMenu } from './ContextMenu';
import { TooltipHost } from './Tooltip';
import { COMMANDS, choices, command, commandForKey, figureMenu, matchesKey, menu, menuItems, selectionCtx, setApp, shortcutOf, stepHint, tipOf, titleOf } from './commands';
import { CommandButton } from './CommandButton';
import CommandPalette from './CommandPalette';
import ViewBall from './ViewBall';
import type { Placing } from './placing';
import Letterbox from './Letterbox';
import CameraPip from './CameraPip';
import { FLOOR_HINT, useCanvasPointer, usePointerHint } from './hints';
import { nextStep, onStepDone, stepDone } from './nextStep';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    // Release the probe context right away; browsers cap the number of live contexts.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

export default function Studio() {
  const [store] = useState(() => new Store());
  const [supported] = useState(webglAvailable);
  if (!supported) {
    return (
      <div className="fatal" role="alert">
        <h1>WebGL is not available</h1>
        <p>Pose Studio needs a browser with WebGL enabled (any recent Chrome, Edge or Firefox).</p>
      </div>
    );
  }
  return (
    <ErrorBoundary>
      <StoreContext.Provider value={store}>
        {ServerRoot ? <ServerRoot><App /></ServerRoot> : <App />}
      </StoreContext.Provider>
    </ErrorBoundary>
  );
}

type Dialog = null | 'export' | 'export-story' | 'export-video' | 'photo' | 'help' | 'practice' | 'board' | 'palette' | 'start';

function App() {
  const store = useStore();
  const scene = useScene();
  const selection = useStudio((s) => s.selection);
  const activeFigure = useStudio((s) => s.activeFigure);
  const settings = useStudio((s) => s.settings);
  const look = useProjectSettings();
  const canUndo = useStudio((s) => s.canUndo);
  const canRedo = useStudio((s) => s.canRedo);

  const toggleInspector = () => store.setSettings({ inspector: !store.getState().settings.inspector });

  // The chrome's theme: as the system's (and following it as it changes), or chosen.
  useLayoutEffect(() => {
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = settings.theme === 'system' ? (dark.matches ? 'dark' : 'light') : settings.theme; };
    apply();
    dark.addEventListener('change', apply);
    return () => dark.removeEventListener('change', apply);
  }, [settings.theme]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [frameRequest, setFrameRequest] = useState<FrameRequest>({ view: { yaw: 0, pitch: 4 }, n: 0 });
  const [drawer, setDrawer] = useState<null | 'library' | 'inspector'>(null);
  const apiRef = useRef<ViewportApi | null>(null);
  // Animation: playback clock and director tools (UI state, not saved).
  const [clock] = useState(() => new Clock());
  const time = useStudio((s) => s.time);
  const through = useStudio((s) => s.through);
  const [onion, setOnion] = useState(false);
  // Isolate: the canvas shows only this figure or prop (and what it holds), until toggled off or it is gone.
  const [isolated, setIsolated] = useState<string | null>(null);
  const isolate = isolated && (scene.figures.some((f) => f.id === isolated) || scene.props.some((p) => p.id === isolated)) ? isolated : null;
  const shown = useMemo(() => (isolate && !through ? isolatedScene(scene, isolate) : scene), [scene, isolate, through]);
  const togglePlay = useCallback(() => {
    if (!store.scene.animation) return;
    if (clock.playing) {
      clock.pause();
      store.setTime(clock.time);
      return;
    }
    startPlayback(clock, store);
  }, [clock, store]);
  /** Stop playback before any edit, so changes are keyed at the frame on screen. */
  const stopPlayback = useCallback(() => {
    if (!clock.playing) return;
    clock.pause();
    store.setTime(clock.time);
  }, [clock, store]);
  useEffect(() => stopPlayback, [scene.id, stopPlayback]);
  // Props that fly free need the physics engine: loaded when a scene first lets one go, and the
  // frame on show worked out again once it is there.
  const flies = !!scene.animation && (scene.animation.actions.some((x) => x.prop) || Object.values(scene.animation.props ?? {}).some((keys) => keys.some((k) => k.release)));
  useEffect(() => {
    if (!flies) return;
    void loadPhysics();
    return onPhysicsReady(() => store.setTime(store.getState().time));
  }, [flies, store]);
  // Imported clips come from the asset store after the first frame: what uses them is shown again.
  useEffect(() => onClips(() => store.setTime(store.getState().time)), [store]);
  const fileRef = useRef<HTMLInputElement>(null);

  const notify = useCallback<Notify>((text, kind = 'info', action) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, kind, action }]);
  }, []);

  // A newer build opened in another tab has the browser's storage: this one says so, once.
  useEffect(() => onOutdated(() => notify('Pose Studio was updated in another tab: reload this one to keep saving', 'error', { label: 'Reload', run: () => location.reload() })), [notify]);

  const viewNow = useCallback(() => apiRef.current?.getView() ?? null, []);
  const projectChest = useCallback((figure: string) => apiRef.current?.project(figure, 'chest') ?? null, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  /** Toast with an Undo button, for destructive actions. */
  const notifyUndo = useCallback((text: string) => {
    notify(text, 'info', { label: 'Undo', run: () => store.undo() });
  }, [notify, store]);

  const frame = useCallback((view: Partial<View> & Pick<View, 'yaw' | 'pitch'>, only?: string | string[]) => {
    setFrameRequest((r) => ({ view, n: r.n + 1, ...(only ? { only } : {}) }));
  }, []);

  /** Frame the selected figure or prop from where the view looks now (F), or everything if nothing is. */
  const frameCurrent = useCallback(() => {
    const cur = apiRef.current?.getView();
    const sel = store.getState().selection;
    // (Close up on it, in the middle: a figure, a part of one, a prop, a light, a camera; several together.)
    const only = sel?.kind === 'figure' ? sel.figure : sel?.kind === 'joint' ? `joint:${sel.figure}:${sel.joint}` : sel?.kind === 'prop' ? sel.prop
      : sel?.kind === 'light' ? `light:${sel.light}` : sel?.kind === 'camera' ? `camera:${sel.camera}` : sel?.kind === 'many' ? [...sel.figures, ...sel.props] : undefined;
    frame(cur ? { yaw: cur.yaw, pitch: cur.pitch } : angleAt(store.scene, store.getState().time), only);
  }, [frame, store]);
  /** Frame the selection only if it is out of view (something added from the keyboard, beyond the edge). */
  const frameSelection = useCallback(() => {
    requestAnimationFrame(() => {
      const sel = store.getState().selection;
      const at = sel && apiRef.current?.labelPoint(sel);
      const box = document.querySelector('.stage canvas')?.getBoundingClientRect();
      if (!at || !box || at.x < box.left || at.x > box.right || at.y < box.top || at.y > box.bottom) frameCurrent();
    });
  }, [frameCurrent, store]);

  // A figure drawn as another character (taller, broader than the mannequin) kept in sight: once its
  // model is in, if its head or feet are out of the view, the view frames it.
  useEffect(() => {
    const models = new Map(store.scene.figures.map((f) => [f.id, f.model ?? null]));
    let pending: { id: string; model: string | null } | null = null;
    const check = () => {
      const p = pending;
      if (!p || (p.model && !modelTemplate(p.model))) return;
      pending = null;
      // (Two frames on: the model drawn at its size.)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const api = apiRef.current;
        const box = document.querySelector('.stage canvas')?.getBoundingClientRect();
        if (!api || !box || store.getState().through) return;
        // (The head's joint is at its neck: the top of the head well above it.)
        const room = { head: box.height * 0.12, leftFoot: box.height * 0.04, rightFoot: box.height * 0.04 };
        const out = (['head', 'leftFoot', 'rightFoot'] as const).some((j) => {
          const at = api.project(p.id, j);
          return !at || at.x < box.left || at.x > box.right || at.y < box.top + room[j] || at.y > box.bottom - room[j];
        });
        const cur = api.getView();
        if (out && cur) frame({ yaw: cur.yaw, pitch: cur.pitch }, p.id);
      }));
    };
    const offStore = store.subscribe(() => {
      for (const f of store.scene.figures) {
        const m = f.model ?? null;
        if (models.has(f.id) && models.get(f.id) !== m) pending = { id: f.id, model: m };
        models.set(f.id, m);
      }
      check();
    });
    const offModels = onModels(check);
    return () => { offStore(); offModels(); };
  }, [store, frame]);

  // Open a shared pose from the URL fragment.
  useEffect(() => {
    const encoded = sceneParam();
    if (!encoded) return;
    // Clear the fragment first so a second effect run (React StrictMode) cannot import it twice.
    history.replaceState(null, '', location.pathname + location.search);
    decodeScene(encoded)
      .then((s) => {
        appendScenes(store, [{ ...s, id: uid('s') }]);
        notify(`Opened shared scene “${s.name}”`);
      })
      .catch((err) => notify(`Could not open the shared link: ${(err as Error).message}`, 'error'));
  }, [store, notify]);

  // Flush unsaved changes when leaving or backgrounding (mobile browsers may never fire
  // beforeunload), and surface storage errors once.
  useEffect(() => {
    const flush = () => { if (store.getState().saveStatus === 'pending') store.save(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [store]);

  const saveStatus = useStudio((s) => s.saveStatus);
  const warnedRef = useRef(false);
  useEffect(() => {
    if (saveStatus === 'error' && !warnedRef.current) {
      warnedRef.current = true;
      notify('Could not save to browser storage. Use Save in the main menu to keep a copy.', 'error');
    }
    if (saveStatus === 'saved') warnedRef.current = false;
  }, [saveStatus, notify]);

  // Another tab changed the library: adopt it rather than overwrite it on our next save.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== Store.LIBRARY_KEY || e.storageArea !== localStorage) return;
      if (store.adoptExternal(e.newValue)) notify('Your scenes were updated in another tab');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [store, notify]);

  const saveFile = useCallback(() => {
    // The file carries the imported clips' frames too (the library itself only lists them).
    const lib = store.getState().library;
    const frames = clipIdsOf(lib).flatMap((id) => clipById(id) ?? []);
    const clips = [...frames, ...(lib.clips ?? []).filter((c) => !clipById(c.id))];
    const json = JSON.stringify({ ...lib, ...(clips.length ? { clips } : {}) }, null, 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), 'pose-studio.json');
  }, [store]);

  const openFile = async (file: File, mode: 'replace' | 'append') => {
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error(`${file.name} is not a Pose Studio project`);
      }
      const lib = parseLibrary(data);
      // (A file with no scenes in it does not empty the project.)
      if (!lib.scenes.length) throw new Error(`there are no scenes in ${file.name}`);
      const what = `${lib.scenes.length} scene${lib.scenes.length === 1 ? '' : 's'}`;
      addMotions(store, clipsIn(data));
      if (mode === 'replace') {
        replaceLibrary(store, lib.scenes);
        notifyUndo(`Opened ${what}`);
      } else {
        appendScenes(store, lib.scenes.map((s) => ({ ...s, id: uid('s') })));
        notify(`Loaded ${what}`);
      }
    } catch (err) {
      notify(`Could not open the file: ${(err as Error).message}`, 'error');
    }
  };


  // A pick mode (Walk to…, Throw to…): the next click on the floor; Esc or picking anything else
  // (another selection, another scene) cancels.
  // The scene alone, filling the window (the button in its corner, Shift + F).
  const [stageOnly, setStageOnly] = useState(false);
  // Esc goes back (first, before it clears the selection; a menu or a dialog open: it closes that).
  useEffect(() => {
    if (!stageOnly) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      e.preventDefault();
      e.stopPropagation();
      setStageOnly(false);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [stageOnly]);
  const [picked, setPick] = useState<{ hint: string; done(at: Vec3): void; take?(hit: CanvasHit): void; ghost?: Placing; selection: typeof selection; scene: string } | null>(null);
  const pick = picked && picked.selection === selection && picked.scene === scene.id ? picked : null;

  const openFilePicker = useCallback((mode: 'append' | 'replace') => {
    fileRef.current!.dataset.mode = mode;
    fileRef.current!.click();
  }, []);
  // What the commands reach outside the store.
  useEffect(() => {
    setApp({
      notify, notifyUndo, dialog: setDialog, frameAll: () => frame(apiRef.current?.getView() ?? angleAt(store.scene, store.getState().time)), frameSelected: frameCurrent, frameView: frame, view: () => apiRef.current?.getView() ?? null, saveFile, openFile: openFilePicker,
      playing: () => clock.playing, togglePlay, stopPlayback, speed: () => clock.speed, setSpeed: (x) => clock.setSpeed(x),
      repeatShot: () => clock.repeatShot, setRepeatShot: (on) => clock.setRepeatShot(on), onion: () => onion, setOnion,
      isolated: () => isolate, setIsolated,
      captureShot: () => apiRef.current?.captureShot() ?? null,
      pickFloor: (hint, done) => setPick({ hint, done, selection: store.getState().selection, scene: store.scene.id }),
      pickThing: (hint, take) => setPick({ hint, done: () => {}, take, selection: store.getState().selection, scene: store.scene.id }),
      place: (ghost) => setPick({ hint: ghost.hint, done: () => {}, ghost, selection: store.getState().selection, scene: store.scene.id }),
      frameSelection: () => frameSelection(),
      stageOnly: () => stageOnly, setStageOnly,
    });
  }, [notify, notifyUndo, frameCurrent, frameSelection, frame, saveFile, openFilePicker, clock, togglePlay, stopPlayback, onion, isolate, store, stageOnly]);

  // Whether the keyboard (Tab), not the pointer, last moved the focus; whether the canvas was last clicked.
  const tabbing = useRef(false);
  const onCanvas = useRef(false);
  // Keyboard shortcuts: the command a key is bound to, on the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') tabbing.current = true;
      if (dialog || e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      const typing = el.closest('textarea, select, [contenteditable="true"]')
        || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(el.type));
      if (typing) return;
      // The arrow and Page keys belong to what has focus if it uses them (a slider, a menu, a list, tabs), and
      // scroll a side panel last clicked in; a plain button just clicked keeps no hold on them.
      if ((e.key.startsWith('Arrow') || e.key.startsWith('Page')) && (el === document.body ? inPanel
        : el.closest('input, select, [role="slider"], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="listbox"], [role="option"], [role="combobox"], [role="radiogroup"], [role="radio"], [role="tablist"], [role="tab"], [role="grid"], [role="tree"], [role="list"] [tabindex], .tl-tracks'))) return;
      // Space presses the button that has the focus when the keyboard brought it there (Tab, as
      // browsers have it); after the pointer was last used (a click, a dialog closed), Space plays.
      // (In a menu or a list, Space chooses the item it is on, however the focus got there.)
      if (e.key === ' ' && (el.closest?.('[role="menu"], [role^="menuitem"], [role="listbox"], [role="option"], .action-picker')
        || (tabbing.current && el.closest?.('button, [role="button"]')))) return;
      // Tab goes from thing to thing only with the focus on the canvas (last clicked, nothing focused);
      // elsewhere, and before the canvas is clicked, it moves the focus.
      if (e.key === 'Tab' && (el !== document.body || !onCanvas.current)) return;
      if (pick && e.key === 'Escape') {
        e.preventDefault();
        setPick(null);
        return;
      }
      const c = selectionCtx(store);
      const cmd = commandForKey(e, c);
      if (!cmd) {
        // A Ctrl key of ours that does nothing here still does not reach the browser (Ctrl D would bookmark the page).
        // (Not Ctrl C with text selected: that copies the text.)
        if ((e.ctrlKey || e.metaKey) && !window.getSelection()?.toString() && COMMANDS.some((x) => x.keys?.some((k) => matchesKey(k, e)))) e.preventDefault();
        return;
      }
      e.preventDefault();
      cmd.run!(c);
    };
    let inPanel = false;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      tabbing.current = false;
      inPanel = !!t.closest?.('aside');
      onCanvas.current = t instanceof HTMLCanvasElement && !!t.closest('.stage');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [dialog, store, pick]);

  // Right-click is the app's everywhere: the browser's own menu shows only in text fields (to copy and paste).
  useEffect(() => {
    const menu = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest?.('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', menu);
    return () => window.removeEventListener('contextmenu', menu);
  }, []);

  // Offline support (production only: in development the cache would serve stale code).
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(withBase('/sw.js'), { scope: withBase('/') }).catch((err) => console.warn('Service worker registration failed', err));
  }, []);

  // Read-only hook for automated tests and power users (e.g. `__poseStudio.store.getState()` in the console).
  useEffect(() => {
    (window as unknown as { __poseStudio?: unknown }).__poseStudio = { store, viewport: apiRef };
  }, [store]);

  // Right-click on the canvas: the menu of what is under the pointer, or of the empty floor.
  const openCanvasMenu = (e: { clientX: number; clientY: number }, hit: CanvasHit) => {
    const sel = store.getState().selection;
    if (hit.light) {
      store.select({ kind: 'light', light: hit.light });
      const lighting = lightingOf(store.scene);
      const l = lighting.lights.find((x) => x.id === hit.light);
      openContextMenu(e, menu('light', { store, light: hit.light }), l ? l.name : 'Light');
      return;
    }
    // Several selected: a right-click on one of them is the menu of them all.
    if (sel?.kind === 'many' && ((hit.figure && sel.figures.includes(hit.figure)) || (hit.prop && sel.props.includes(hit.prop)))) {
      openContextMenu(e, menu('many', { store, many: { figures: sel.figures, props: sel.props } }), `${sel.figures.length + sel.props.length} selected`);
      return;
    }
    if (hit.camera) {
      store.select({ kind: 'camera', camera: hit.camera });
      openContextMenu(e, menu('camera', { store, camera: hit.camera, at: hit.point }), store.scene.cameras.find((c) => c.id === hit.camera)?.name);
    } else if (hit.prop) {
      store.select({ kind: 'prop', prop: hit.prop });
      openContextMenu(e, menu('prop', { store, prop: hit.prop }), store.scene.props.find((p) => p.id === hit.prop)?.name);
    } else if (hit.figure) {
      // (Its selected joint stays selected, and the menu has the joint's commands.)
      const joint = sel?.kind === 'joint' && sel.figure === hit.figure ? sel.joint : undefined;
      if (!joint) store.select({ kind: 'figure', figure: hit.figure });
      openContextMenu(e, figureMenu(store, hit.figure, joint), store.scene.figures.find((f) => f.id === hit.figure)?.name);
    } else {
      const floor = hit.floor && ([Math.round(hit.floor[0] * 100) / 100, 0, Math.round(hit.floor[2] * 100) / 100] as Vec3);
      openContextMenu(e, menu('floor', { store, floor }));
    }
  };
  // The commands' context in the top bar and menus here: the selection.
  const cx = selectionCtx(store);

  const ctx: InspectorContext = {
    editorCamera: () => apiRef.current?.editorCamera() ?? null,
    rootPosition: (id) => apiRef.current?.rootPosition(id) ?? null,
    notify,
    notifyUndo,
  };

  const style = styleDef(look.style);
  const StyleIcon = STYLE_ICONS[look.style];

  return (
    <div
      className={`studio${drawer ? ` drawer-${drawer}` : ''}${settings.inspector ? '' : ' inspector-closed'}${stageOnly ? ' stage-only' : ''}`}
      style={settings.widths.inspector ? ({ '--panel-w': `${settings.widths.inspector}px` } as CSSProperties) : undefined}
      onPointerDownCapture={(e) => { if (!(e.target as HTMLElement).closest('.timeline')) stopPlayback(); }}
    >
      <header className="topbar">
        <div className="tb-left">
          <IconButton icon={PanelLeft} label="Side panel" className="only-mobile" onClick={() => setDrawer(drawer === 'library' ? null : 'library')} />
          <Menu label="Main menu" className="brand" items={() => menu('main', cx)}>
            <Logo />
            <span className="brand-name">Pose Studio</span>
            <ChevronDown size={15} className="brand-chevron" aria-hidden />
          </Menu>
          <span className="tb-sep hide-mobile" />
          <Toolbar className="toolbar" label="Canvas tools">
            <Menu
              label="View"
              className="btn ghost"
              tip="Look through, and what the canvas shows"
              items={() => menu('view', cx)}
            >
              <Eye size={16} strokeWidth={1.75} aria-hidden /> <span className="hide-sm">View</span> <ChevronDown size={14} aria-hidden />
            </Menu>
            <span className="tb-sep" />
            <Menu label="Frame" className="btn ghost" tip="The frame every scene is filmed in" items={() => choices('view.aspect', cx)}>
              <RectangleHorizontal size={16} strokeWidth={1.75} aria-hidden /> <span className="hide-sm">{look.frame}</span> <ChevronDown size={14} aria-hidden />
            </Menu>
            <Menu
              label="Render style"
              className="btn ghost"
              tip={tipOf('view.nextStyle', 'Render style')}
              items={() => choices('view.style', cx)}
            >
              <StyleIcon size={16} strokeWidth={1.75} aria-hidden /> <span className="hide-sm">{style.label}</span> <ChevronDown size={14} aria-hidden />
            </Menu>
          </Toolbar>
        </div>
        <div className="tb-center">
          <input
            className="scene-name"
            type="text"
            value={scene.name}
            onChange={(e) => store.updateScene((s) => ({ ...s, name: e.target.value }), 'rename')}
            aria-label="Scene name"
            spellCheck={false}
          />
          <ScenePicker />
          {SaveState ? <SaveState status={saveStatus} /> : <SaveIndicator status={saveStatus} />}
        </div>
        <div className="tb-right">
          <CommandButton id="app.undo" ctx={cx} disabled={!canUndo} />
          <CommandButton id="app.redo" ctx={cx} disabled={!canRedo} className="hide-narrow" />
          <span className="tb-sep hide-mobile" />
          <CommandButton id="app.palette" ctx={cx} className="hide-mobile" />
          {Account && <Account />}
          <button type="button" className="btn primary" onClick={() => command('app.export').run!(cx)} data-tip={tipOf('app.export')}>
            <Download size={16} strokeWidth={2} aria-hidden /> <span>Export</span>
          </button>
          <IconButton
            icon={settings.inspector ? PanelRightClose : PanelRightOpen}
            label={settings.inspector ? 'Hide the inspector' : 'Show the inspector'}
            shortcut={shortcutOf('app.inspector')}
            className="hide-mobile"
            pressed={settings.inspector}
            onClick={toggleInspector}
          />
          {/* Narrow: what is used less folds into one menu. */}
          <Menu
            label="More"
            className="ibtn only-narrow"
            align="end"
            tip="More"
            items={() => menuItems(['app.redo', 'app.inspector'], cx)}
          >
            <Ellipsis size={17} aria-hidden />
          </Menu>
          <IconButton icon={SlidersHorizontal} label="Inspector" className="only-mobile" onClick={() => setDrawer(drawer === 'inspector' ? null : 'inspector')} />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openFile(f, (e.target.dataset.mode as 'replace' | 'append') ?? 'append');
            e.target.value = '';
          }}
        />
      </header>

      <SidePanel
        onPick={() => setDrawer(null)}
        notify={notify}
        notifyUndo={notifyUndo}
        drawer={drawer === 'library'}
        onPhoto={() => setDialog('photo')}
        actions={[{ label: titleOf(command('app.board'), cx), icon: LayoutPanelTop, shortcut: shortcutOf('app.board'), onSelect: () => command('app.board').run!(cx) }]}
      />

      <main className="stage" style={{ background: style.background }}>
        <Viewport
          store={store}
          scene={shown}
          selection={selection}
          activeFigure={activeFigure}
          settings={settings}
          frameRequest={frameRequest}
          apiRef={apiRef}
          clock={clock}
          time={time}
          through={through}
          onion={onion}
          onMenu={openCanvasMenu}
          onPick={pick && ((hit) => {
            if (pick.ghost) {
              // (Where it goes, worked out again from the click itself: a tap on touch may have no move
              // before it, or an orbit drag's.)
              pick.ghost.ghost(hit.floor, pick.ghost.alt, hit);
              pick.ghost.drop(hit);
            }
            else if (pick.take) pick.take(hit);
            else if (hit.floor && !hit.figure && !hit.prop && !hit.camera) pick.done(hit.floor);
            setPick(null);
          })}
          placing={pick?.ghost ?? null}
        />
        {through && <Letterbox aspect={frameAspect()} guides={settings.guides} camera={through.camera} project={projectChest} />}
        {!through && selection?.kind === 'camera' && <CameraPip camera={selection.camera} clock={clock} />}
        {!through && <ViewBall ctx={cx} view={viewNow} />}
        <StageOnlyButton on={stageOnly} toggle={() => setStageOnly((on) => !on)} />
        {/* What the pointer, the keys or the next step say, over the canvas's foot. */}
          <div className="stage-hint hide-mobile">
            <Hint
              clock={clock}
              pick={pick}
              note={(scene.animation && !through ? correction(scene, activeFigure, time) : null)
                  ?? (isolate && !through ? `Only ${(scene.figures.find((f) => f.id === isolate) ?? scene.props.find((p) => p.id === isolate))!.name} · / shows the others` : null)}
              keys={!through && selection ? stepHint(selectionCtx(store)) : null}
              quiet={!!through || clock.playing}
              // (A part selected with the handles hidden: its gizmo is hidden too.)
              alert={!settings.showHandles && !through && selection?.kind === 'joint' && !scene.figures.find((f) => f.id === selection.figure)?.proxy
                ? { icon: EyeOff, text: 'Handles hidden', action: { label: `Show · ${shortcutOf('view.handles') ?? 'H'}`, run: () => command('view.handles').run!(cx) } }
                : null}
            />
          </div>
        <Timeline clock={clock} notify={notify} />
      </main>

      <Inspector ctx={ctx} />
      {drawer && <div className="scrim only-mobile" onClick={() => setDrawer(null)} />}

      {(dialog === 'export' || dialog === 'export-story' || dialog === 'export-video') && (
        <ExportDialog onClose={() => setDialog(null)} notify={notify} editorCamera={ctx.editorCamera} initial={dialog === 'export-story' ? 'board' : dialog === 'export-video' ? 'video' : undefined} />
      )}
      {dialog === 'photo' && (
        <PhotoDialog
          onClose={() => setDialog(null)}
          notify={notify}
        />
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'start' && <StartDialog onClose={() => setDialog(null)} />}
      {dialog === 'palette' && <CommandPalette onClose={() => setDialog(null)} ui={{ notify, notifyUndo }} />}
      {dialog === 'practice' && <PracticeMode onClose={() => setDialog(null)} />}
      {dialog === 'board' && <Board onClose={() => setDialog(null)} onExport={() => setDialog('export-story')} />}
      <ContextMenuHost />
      <TooltipHost />
      <Toasts toasts={toasts} dismiss={dismissToast} />
    </div>
  );
}

/** The scene as the canvas shows it while isolating one figure (and the props it handles) or one prop. */
function isolatedScene(scene: Scene, id: string): Scene {
  // The props it handles at any time: holds, is handed, throws, catches.
  const a = scene.animation;
  const handled = new Set(scene.props.filter((p) => p.id === id || p.hold?.figure === id).map((p) => p.id));
  for (const [prop, keys] of Object.entries(a?.props ?? {})) if (keys.some((k) => k.hold?.figure === id)) handled.add(prop);
  for (const x of a?.actions ?? []) {
    if (x.prop && (x.roles.some((r) => r.figure === id) || (x.target && 'figure' in x.target && x.target.figure === id))) handled.add(x.prop);
  }
  return {
    ...scene,
    figures: scene.figures.map((f) => (f.id === id ? f : { ...f, hidden: true })),
    props: scene.props.filter((p) => handled.has(p.id)),
  };
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden>
      <rect className="logo-bg" width="32" height="32" rx="8" />
      <circle className="logo-head" cx="16" cy="7.6" r="3.1" />
      <path d="M16 12v8M16 13.5l-5.5 3.5M16 13.5l5.5-4.5M16 20l-3.5 6.5M16 20l4.5 6" className="logo-body" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Over a motion or a walk, edits to the figure correct it: this says which (and that it is a correction). */
function correction(scene: Scene, figureId: string | null, time: number) {
  const a = scene.animation!;
  const f = scene.figures.find((x) => x.id === figureId);
  if (!f || f.proxy) return null;
  const over = (['upper', undefined] as const).flatMap((layer) => actionsOf(a, f.id, layer)).find((x) => x.source.kind !== 'keys' && x.start < time - 1e-6 && time < x.start + x.duration - 1e-6);
  if (!over) return null;
  const src = over.source;
  const what = src.kind === 'travel' ? `${f.name}'s ${actionLabel(over, scene).toLowerCase()}` : `${f.name}'s ${clipById(src.kind === 'clip' ? src.clip : '')?.name ?? 'motion'}${over.layer === 'upper' ? ' (upper body)' : ''}`;
  return `Posing here corrects ${what}`;
}

/** A warning in the header bar: what is wrong, in a word or two, and the button that puts it right. */
interface Alert { icon: LucideIcon; text: string; action?: { label: string; run(): void } }

/**
 * The hint in the header bar (its own component: it changes as the pointer moves), a pill whose
 * icon and tone say what it is: what a pick in progress wants (accent); a warning with its fix
 * (amber); what each gesture does on what is under the pointer, or the keys for what is selected
 * (plain); a correction's or Isolate's note (soft accent); else a next step for the scene, with its
 * commands as buttons (accent).
 */
function Hint({ clock, pick, note, quiet, alert, keys }: { clock: Clock; pick: { hint: string; ghost?: Placing } | null; note: string | null; quiet: boolean; alert: Alert | null; keys: string | null }) {
  const store = useStore();
  // (Nothing while the film plays, whatever the pointer passes over: followed from the clock itself.)
  const playing = useSyncExternalStore(clock.subscribe, () => clock.playing, () => false);
  useScene();
  const pointerHint = usePointerHint();
  const overCanvas = useCanvasPointer();
  const [, setSteps] = useState(0);
  useEffect(() => onStepDone(() => setSteps((n) => n + 1)), []);
  if (playing) return null;
  if (pick) return <Pill tone="accent" icon={Crosshair}>{pick.ghost ? pointerHint ?? pick.hint : pick.hint}</Pill>;
  if (pointerHint) return <Pill tone="plain" icon={MousePointer2}>{pointerHint}</Pill>;
  if (alert) {
    return (
      <Pill tone="warn" icon={alert.icon}>
        {alert.text}
        {alert.action && <button type="button" className="hint-action" onClick={alert.action.run}>{alert.action.label}</button>}
      </Pill>
    );
  }
  if (note) return <Pill tone="note" icon={Info}>{note}</Pill>;
  const step = !quiet ? nextStep(store) : null;
  // (Else what the keys do for what is selected; else, over the canvas, the floor's gestures.)
  if (!step) return keys && !quiet ? <Pill tone="plain" icon={Keyboard}>{keys}</Pill> : overCanvas && !quiet ? <Pill tone="plain" icon={MousePointer2}>{FLOOR_HINT}</Pill> : null;
  return (
    <Pill tone="accent" icon={Lightbulb} label="Next step">
      {step.text}
      {step.actions.map((a) => (
        <button key={a.label} type="button" className="hint-action" onClick={() => a.run()}>{a.label}</button>
      ))}
      <button type="button" className="hint-dismiss" aria-label="Not now" data-tip="Not now" onClick={() => stepDone(store.scene.id, step.id)}>
        <X size={14} aria-hidden />
      </button>
    </Pill>
  );
}

/** One hint: its icon, its words (the first child) and any buttons after them. */
function Pill({ tone, icon: Icon, label, children }: { tone: 'plain' | 'note' | 'accent' | 'warn'; icon: LucideIcon; label?: string; children: ReactNode }) {
  const [text, ...rest] = Array.isArray(children) ? children : [children];
  return (
    <div className={`bar-hint ${tone}`} role="status" aria-label={label}>
      <Icon size={15} strokeWidth={2} className="bar-hint-icon" aria-hidden />
      <span className="bar-hint-text">{typeof text === 'string' ? <Keys text={text} /> : text}</span>
      {rest}
    </div>
  );
}

/** A gesture or a key, as written in a hint (Drag, Right-click, Alt, ←, H…). */
const KEYISH = /^(Drag|Click|Right-click|Double-click|Wheel|Shift|Ctrl|Alt|Tab|Esc|Enter|Space|Page|Up|Down|Arrows|Del|F2|[A-Z]|[←→↑↓]|←→|(Shift|Ctrl|Alt)-(drag|click))$/;

/**
 * A hint's words with its gestures and keys as key caps: in each part (between the · ), what comes
 * before the colon, where it is keys ("Alt ← →: turn"). The words themselves unchanged.
 */
/** In the canvas's corner: the scene alone, filling the window, or back with its panels. */
function StageOnlyButton({ on, toggle }: { on: boolean; toggle(): void }) {
  const label = on ? 'Back to the panels' : 'Scene only';
  const keys = on ? 'Esc' : shortcutOf('view.stageOnly');
  return (
    <button type="button" className="stage-pop" aria-label={label} aria-pressed={on} data-tip={keys ? `${label} · ${keys}` : label} onClick={toggle}>
      {on ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
    </button>
  );
}

function Keys({ text }: { text: string }) {
  const parts = text.split(' · ');
  return parts.map((part, i) => {
    const m = /^([^:]{1,28}):(\s.*)$/.exec(part);
    // (Before the colon, keys: drawn as caps, the words between them, Hold, or, /, as they are.)
    const keys = m && m[1].split(' ').some((w) => KEYISH.test(w)) ? m[1] : null;
    // (A tip kept on one line with its dot: a long hint breaks between tips.)
    return (
      <span key={i}>
        <span className="hint-part">
          {keys ? (
            <>
              {keys.split(/( )/).map((w, j) => (KEYISH.test(w) ? <kbd key={j}>{w}</kbd> : w))}
              :{m![2]}
            </>
          ) : part}
          {i < parts.length - 1 && <span className="hint-sep">{'\u00a0·'}</span>}
        </span>
        {i < parts.length - 1 && ' '}
      </span>
    );
  });
}
