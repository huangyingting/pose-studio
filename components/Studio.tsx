'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronDown, Download, Ellipsis, Eye, Hand, X, LayoutPanelTop, Lock, LockOpen, Move3d, PanelLeft, PanelRightClose, PanelRightOpen, Scale3d, SlidersHorizontal,
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
import { actionsOf } from '@/lib/evaluate';
import { styleDef } from '@/lib/styles';
import type { GizmoMode, Scene, Vec3, View } from '@/lib/types';
import Board from './Board';
import { ExportDialog, HelpDialog, PhotoDialog, ProjectSettingsDialog } from './dialogs';
// Accounts, library sync and AI: the server edition only (null in the static build).
import { Account, SaveState, ServerRoot } from '@edition/server';
import SaveIndicator from './SaveIndicator';
import ErrorBoundary from './ErrorBoundary';
import Inspector, { type InspectorContext } from './Inspector';
import ScenePicker from './ScenePicker';
import SidePanel from './side/SidePanel';
import { useReferenceUrl } from './reference';
import { StoreContext, useFilm, useScene, useStore, useStudio } from './store-context';
import { PracticeMode } from './Practice';
import { Clock, startPlayback } from './clock';
import { STYLE_ICONS } from './icons';
import Timeline from './Timeline';
import { IconButton, Menu, Segmented, Toasts, type Notify, type Toast } from './ui';
import Viewport, { type CanvasHit, type FrameRequest, type ViewportApi } from './Viewport';
import { ContextMenuHost, openContextMenu } from './ContextMenu';
import { TooltipHost } from './Tooltip';
import { COMMANDS, choices, command, commandForKey, figureMenu, matchesKey, menu, menuItems, selectionCtx, setApp, shortcutOf, stepHint, tipOf, titleOf } from './commands';
import { CommandButton } from './CommandButton';
import CommandPalette from './CommandPalette';
import ViewBall from './ViewBall';
import type { Placing } from './placing';
import SelectionLabel from './SelectionLabel';
import Letterbox from './Letterbox';
import CameraPip from './CameraPip';
import { FLOOR_HINT, useCanvasPointer, usePointerHint } from './hints';
import { nextStep, stepDone } from './nextStep';

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

type Dialog = null | 'export' | 'export-story' | 'photo' | 'help' | 'practice' | 'board' | 'project' | 'palette';

function App() {
  const store = useStore();
  const scene = useScene();
  const referenceUrl = useReferenceUrl(scene.reference?.image);
  const selection = useStudio((s) => s.selection);
  const activeFigure = useStudio((s) => s.activeFigure);
  const settings = useStudio((s) => s.settings);
  const film = useFilm();
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

  const viewNow = useCallback(() => apiRef.current?.getView() ?? null, []);
  const labelPoint = useCallback((sel: NonNullable<typeof selection>) => apiRef.current?.labelPoint(sel) ?? null, []);
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
    const only = sel?.kind === 'figure' || sel?.kind === 'joint' ? sel.figure : sel?.kind === 'prop' ? sel.prop : sel?.kind === 'light' ? 'light' : sel?.kind === 'many' ? [...sel.figures, ...sel.props] : undefined;
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
      notify('Could not save to browser storage. Use Save project in the main menu to keep a copy.', 'error');
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
      const data = JSON.parse(await file.text());
      const lib = parseLibrary(data);
      const what = `${lib.scenes.length} scene${lib.scenes.length === 1 ? '' : 's'}`;
      addMotions(store, clipsIn(data));
      if (mode === 'replace') {
        replaceLibrary(store, lib.scenes, lib.board);
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
    });
  }, [notify, notifyUndo, frameCurrent, frameSelection, frame, saveFile, openFilePicker, clock, togglePlay, stopPlayback, onion, isolate, store]);

  // Keyboard shortcuts: the command a key is bound to, on the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      const typing = el.closest('textarea, select, [contenteditable="true"]')
        || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(el.type));
      if (typing) return;
      // The arrow and Page keys belong to what has focus if it uses them (a slider, a menu, a list, tabs), and
      // scroll a side panel last clicked in; a plain button just clicked keeps no hold on them.
      if ((e.key.startsWith('Arrow') || e.key.startsWith('Page')) && (el === document.body ? inPanel
        : el.closest('input, select, [role="slider"], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="listbox"], [role="option"], [role="combobox"], [role="radiogroup"], [role="radio"], [role="tablist"], [role="tab"], [role="grid"], [role="tree"], [role="list"] [tabindex], .tl-lanes'))) return;
      // Space presses the button that has the focus (as browsers have it), not play.
      if (e.key === ' ' && el.closest('button, [role="button"]')) return;
      // Tab goes from thing to thing only with the focus on the canvas (last clicked, nothing focused);
      // elsewhere, and before the canvas is clicked, it moves the focus.
      if (e.key === 'Tab' && (el !== document.body || !onCanvas)) return;
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
    let onCanvas = false;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      inPanel = !!t.closest?.('aside');
      onCanvas = t instanceof HTMLCanvasElement && !!t.closest('.stage');
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
      store.select({ kind: 'light' });
      openContextMenu(e, menu('light', { store, light: true }), 'Light');
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
    projectSettings: () => setDialog('project'),
  };

  // Move works on any figure; Scale only on props.
  const gizmoForSelection = selection?.kind === 'prop' || (settings.gizmo === 'translate' && !!activeFigure);
  const style = styleDef(film.style);
  const StyleIcon = STYLE_ICONS[film.style];

  return (
    <div
      className={`studio${drawer ? ` drawer-${drawer}` : ''}${settings.inspector ? '' : ' inspector-closed'}`}
      style={settings.widths.inspector ? ({ '--panel-w': `${settings.widths.inspector}px` } as CSSProperties) : undefined}
      onPointerDownCapture={(e) => { if (!(e.target as HTMLElement).closest('.timeline')) stopPlayback(); }}
    >
      <header className="topbar">
        <div className="tb-left">
          <IconButton icon={PanelLeft} label="Side panel" className="only-mobile" onClick={() => setDrawer(drawer === 'library' ? null : 'library')} />
          <Menu label="Main menu" className="brand" items={() => menu('main', cx)}>
            <Logo />
            <span className="brand-name">Pose Studio</span>
            <ChevronDown size={14} className="brand-chevron" aria-hidden />
          </Menu>
          <span className="tb-sep hide-mobile" />
          <div className="toolbar" role="toolbar" aria-label="Canvas tools">
            <Segmented<GizmoMode>
              label="Gizmo"
              value={settings.gizmo}
              onChange={(g) => command(g === 'rotate' ? 'tool.pose' : g === 'translate' ? 'tool.move' : 'tool.scale').run!(cx)}
              iconOnly
              options={[
                { value: 'rotate', label: 'Pose', icon: Hand, title: tipOf('tool.pose', 'Pose: drag parts (Shift twists), floor rings turn') },
                { value: 'translate', label: 'Move', icon: Move3d, title: tipOf('tool.move', 'Move figure or prop') },
                { value: 'scale', label: 'Scale', icon: Scale3d, title: tipOf('tool.scale', selection?.kind === 'prop' ? 'Scale the prop' : 'Scale a prop (select one first)'), disabled: selection?.kind !== 'prop' },
              ]}
            />
            {settings.gizmo === 'rotate' && (
              // The Pose tool's option: joints bend only as far as a body's do (dragging, IK, sliders).
              <IconButton
                icon={settings.limits ? Lock : LockOpen}
                label={titleOf(command('tool.limits'), cx)}
                pressed={settings.limits}
                active={settings.limits}
                onClick={() => command('tool.limits').run!(cx)}
              />
            )}
            <span className="tb-sep" />
            <Menu
              label="View"
              className="btn ghost"
              tip="The angle, what to look through and what the canvas shows"
              items={() => menu('view', cx)}
            >
              <Eye size={15} strokeWidth={1.75} aria-hidden /> <span className="hide-sm">View</span> <ChevronDown size={13} aria-hidden />
            </Menu>
            <CommandButton id="view.frameAll" ctx={cx} />
            <span className="tb-sep" />
            <Menu
              label="Render style"
              className="btn ghost"
              tip={tipOf('view.nextStyle', 'Render style')}
              items={() => choices('view.style', cx)}
            >
              <StyleIcon size={15} strokeWidth={1.75} aria-hidden /> <span className="hide-sm">{style.label}</span> <ChevronDown size={13} aria-hidden />
            </Menu>
          </div>
        </div>
        <div className="tb-hint hide-mobile">
          <Hint
            pick={pick}
            note={settings.gizmo !== 'rotate' && !gizmoForSelection
              ? `Select a prop to ${settings.gizmo === 'translate' ? 'move' : 'scale'} it`
              : (scene.animation && !through ? correction(scene, activeFigure, time) : null)
                ?? (isolate && !through ? `Only ${(scene.figures.find((f) => f.id === isolate) ?? scene.props.find((p) => p.id === isolate))!.name} · / shows the others` : null)}
            keys={!through && selection ? stepHint(selectionCtx(store)) : null}
            quiet={!!through || clock.playing}
            // (A part selected with the handles hidden: its card, and the dots, are hidden too.)
            alert={!settings.showHandles && !through && selection?.kind === 'joint' && !scene.figures.find((f) => f.id === selection.figure)?.proxy
              ? `The drag handles are hidden: press ${shortcutOf('view.handles') ?? 'H'} (or View → Drag handles) for the joint's card and the dots`
              : null}
          />
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
            <Download size={15} strokeWidth={2} aria-hidden /> <span>Export</span>
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
            <Ellipsis size={16} aria-hidden />
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
        <SelectionLabel labelPoint={labelPoint} hidden={!!through || !!pick} />
        {referenceUrl && scene.reference?.visible && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="reference" src={referenceUrl} alt="" style={{ opacity: scene.reference.opacity }} />
        )}
        <Timeline clock={clock} notify={notify} />
      </main>

      <Inspector ctx={ctx} onHide={toggleInspector} />
      {drawer && <div className="scrim only-mobile" onClick={() => setDrawer(null)} />}

      {(dialog === 'export' || dialog === 'export-story') && (
        <ExportDialog onClose={() => setDialog(null)} notify={notify} editorCamera={ctx.editorCamera} initial={dialog === 'export-story' ? 'board' : undefined} />
      )}
      {dialog === 'photo' && (
        <PhotoDialog
          onClose={() => setDialog(null)}
          notify={notify}
        />
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'palette' && <CommandPalette onClose={() => setDialog(null)} ui={{ notify, notifyUndo }} />}
      {dialog === 'project' && <ProjectSettingsDialog onClose={() => setDialog(null)} />}
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
  const what = src.kind === 'travel' ? `${f.name}'s ${src.mode}` : `${f.name}'s ${clipById(src.kind === 'clip' ? src.clip : '')?.name ?? 'motion'}${over.layer === 'upper' ? ' (upper body)' : ''}`;
  return `Posing here corrects ${what}`;
}

/**
 * The hint in the header bar (its own component: it changes as the pointer moves): what a pick in
 * progress wants; what each gesture does on what is under the pointer; the tool's, a correction's
 * or Isolate's note; else a next step for the scene, with its commands as buttons (the floor's
 * gestures while the pointer is on the empty canvas).
 */
function Hint({ pick, note, quiet, alert, keys }: { pick: { hint: string; ghost?: Placing } | null; note: string | null; quiet: boolean; alert: string | null; keys: string | null }) {
  const store = useStore();
  useScene();
  const pointerHint = usePointerHint();
  const overCanvas = useCanvasPointer();
  const [, setSteps] = useState(0);
  const hint = pick ? (pick.ghost ? pointerHint ?? pick.hint : pick.hint) : pointerHint ?? alert ?? note;
  if (hint) return <div className="bar-hint" role="status">{hint}</div>;
  const step = !quiet ? nextStep(store) : null;
  // (Else what the keys do for what is selected; else, over the canvas, the floor's gestures.)
  if (!step) return keys && !quiet ? <div className="bar-hint" role="status">{keys}</div> : overCanvas && !quiet ? <div className="bar-hint" role="status">{FLOOR_HINT}</div> : null;
  return (
    <div className="bar-hint step" role="status" aria-label="Next step">
      <span>{step.text}</span>
      {step.actions.map((a) => (
        <button key={a.label} type="button" className="hint-action" onClick={() => { a.run(); setSteps((n) => n + 1); }}>{a.label}</button>
      ))}
      <button type="button" className="hint-dismiss" aria-label="Not now" data-tip="Not now" onClick={() => { stepDone(store.scene.id, step.id); setSteps((n) => n + 1); }}>
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
