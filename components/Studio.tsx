'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronDown, CircleHelp, Cloud, CloudCheck, CloudOff, Copy, Download, Eye, FilePlus2, FileUp, Focus, FolderOpen,
  Hand, Keyboard, LayoutPanelTop, Link, Move3d, PanelLeft, PanelRightClose, PanelRightOpen, Redo2, Save, Scale3d, ScanFace, SlidersHorizontal, Timer, Undo2,
} from 'lucide-react';
import {
  addKeyframe, addMotions, addScene, appendScenes, cutShot, copyPose, deleteSelection, duplicateCurrentScene, duplicateSelection, mirrorPose, pastePose, replaceLibrary,
} from '@/lib/actions';
import { clipsIn, parseLibrary, uid } from '@/lib/doc';
import { withBase } from '@/lib/paths';
import { downloadBlob } from '@/lib/render';
import { decodeScene, sceneParam, shareUrl } from '@/lib/share';
import { Store, type SaveStatus } from '@/lib/store';
import { snapTime } from '@/lib/animation';
import { loadPhysics, onPhysicsReady } from '@/lib/physics';
import { clipById, clipIdsOf, onClips } from '@/lib/assets';
import { angleAt, frameAspect } from '@/lib/cameras';
import { actionsOf } from '@/lib/evaluate';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { STYLES, type GizmoMode, type Scene, type View } from '@/lib/types';
import { VIEW_PRESETS } from '@/lib/views';
import Board from './Board';
import { ExportDialog, HelpDialog, PhotoDialog } from './dialogs';
// Accounts, library sync and AI: the server edition only (null in the static build).
import { Account, ServerRoot } from '@edition/server';
import ErrorBoundary from './ErrorBoundary';
import Inspector, { type InspectorContext } from './Inspector';
import ScenePicker from './ScenePicker';
import SidePanel from './side/SidePanel';
import { StoreContext, useScene, useStore, useStudio } from './store-context';
import { PracticeMode } from './Practice';
import { Clock, startPlayback } from './clock';
import { STYLE_ICONS } from './icons';
import Timeline from './Timeline';
import { IconButton, Menu, Segmented, Toasts, type Notify, type Toast } from './ui';
import Viewport, { type CanvasHit, type FrameRequest, type ViewportApi } from './Viewport';
import { ContextMenuHost, openContextMenu } from './ContextMenu';
import { TooltipHost } from './Tooltip';
import { canvasMenu, figureMenu, propMenu, renameInOutline } from './menus';

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

type Dialog = null | 'export' | 'photo' | 'help' | 'practice' | 'board';
type Reference = { url: string | null; opacity: number; visible: boolean };

function App() {
  const store = useStore();
  const scene = useScene();
  const selection = useStudio((s) => s.selection);
  const activeFigure = useStudio((s) => s.activeFigure);
  const settings = useStudio((s) => s.settings);
  const canUndo = useStudio((s) => s.canUndo);
  const canRedo = useStudio((s) => s.canRedo);

  const toggleInspector = () => store.setSettings({ inspector: !store.getState().settings.inspector });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [reference, setReferenceState] = useState<Reference>({ url: null, opacity: 0.45, visible: true });
  const [frameRequest, setFrameRequest] = useState<FrameRequest>({ view: { yaw: 0, pitch: 4 }, n: 0 });
  const [drawer, setDrawer] = useState<null | 'library' | 'inspector'>(null);
  const apiRef = useRef<ViewportApi | null>(null);
  // Animation: playback clock and director tools (UI state, not saved).
  const [clock] = useState(() => new Clock());
  const time = useStudio((s) => s.time);
  const [shotMode, setShotMode] = useState(false);
  const [onion, setOnion] = useState(false);
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
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' || action ? 6000 : 3000);
  }, []);

  /** Toast with an Undo button, for destructive actions. */
  const notifyUndo = useCallback((text: string) => {
    notify(text, 'info', { label: 'Undo', run: () => store.undo() });
  }, [notify, store]);

  const frame = useCallback((view: Partial<View> & Pick<View, 'yaw' | 'pitch'>) => {
    setFrameRequest((r) => ({ view, n: r.n + 1 }));
  }, []);

  const frameCurrent = useCallback(() => {
    const cur = apiRef.current?.getView();
    frame(cur ? { yaw: cur.yaw, pitch: cur.pitch } : angleAt(store.scene, store.getState().time));
  }, [frame, store]);

  const setReference = useCallback((patch: Partial<Reference>) => {
    setReferenceState((r) => {
      if ('url' in patch && r.url && r.url !== patch.url) URL.revokeObjectURL(r.url);
      return { ...r, ...patch };
    });
  }, []);

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
      notify('Could not save to browser storage. Use File → Save library to keep a copy.', 'error');
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

  const share = useCallback(async () => {
    try {
      const url = await shareUrl(store.scene);
      try {
        await navigator.clipboard.writeText(url);
        notify('Share link copied to the clipboard');
      } catch {
        prompt('Copy this link:', url);
      }
    } catch (err) {
      notify(`Could not create a link: ${(err as Error).message}`, 'error');
    }
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

  const setGizmo = useCallback((gizmo: GizmoMode) => store.setSettings({ gizmo }), [store]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      const typing = el.closest('textarea, select, [contenteditable="true"]')
        || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(el.type));
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => unknown) => { e.preventDefault(); fn(); };
      if (mod) {
        if (k === 'z') run(() => (e.shiftKey ? store.redo() : store.undo()));
        else if (k === 'y') run(() => store.redo());
        else if (k === 'c' && !window.getSelection()?.toString()) run(() => copyPose(store) && notify('Pose copied'));
        else if (k === 'v') run(() => pastePose(store) || notify('Copy a pose first (Ctrl+C)', 'error'));
        else if (k === 'd') run(() => duplicateSelection(store));
        else if (k === 'e') run(() => setDialog('export'));
        else if (k === 's') run(saveFile);
        return;
      }
      if (e.altKey) return;
      const view = VIEW_PRESETS.find((v) => v.key === e.key);
      if (view) return run(() => frame(view));
      switch (e.key) {
        case 'w': case 'W': return run(() => setGizmo('translate'));
        case 'e': case 'E': return run(() => setGizmo('rotate'));
        case 'r': case 'R': return run(() => setGizmo('scale'));
        case 'f': case 'F': return run(frameCurrent);
        case 'm': case 'M': return run(() => mirrorPose(store));
        case 'h': case 'H': return run(() => store.setSettings({ showHandles: !store.getState().settings.showHandles }));
        case 'i': case 'I': return run(() => store.setSettings({ inspector: !store.getState().settings.inspector }));
        case 'l': case 'L': return run(() => {
          const style = store.getState().settings.style;
          store.setSettings({ style: STYLES[(STYLES.indexOf(style) + 1) % STYLES.length] });
        });
        case 'p': case 'P': return run(() => setDialog('practice'));
        case 'b': case 'B': return run(() => { stopPlayback(); setDialog('board'); });
        case ' ': if (store.scene.animation) run(togglePlay); return;
        case 'c': case 'C': if (store.scene.animation) run(() => { stopPlayback(); cutShot(store); }); return;
        case 'k': case 'K': if (store.scene.animation) run(() => { stopPlayback(); addKeyframe(store); }); return;
        case ',': case '.': {
          const a = store.scene.animation;
          if (!a) return;
          return run(() => { stopPlayback(); store.setTime(snapTime(a, store.getState().time + (e.key === ',' ? -1 : 1) / a.fps)); });
        }
        case '[': return run(() => store.setSceneIndex(Math.max(0, store.getState().sceneIndex - 1)));
        case ']': return run(() => store.setSceneIndex(Math.min(store.getState().library.scenes.length - 1, store.getState().sceneIndex + 1)));
        case 'Delete': case 'Backspace': {
          const name = deleteSelection(store);
          if (name) run(() => notifyUndo(`Deleted ${name}`));
          return;
        }
        case 'F2': {
          const sel = store.getState().selection;
          const id = sel?.kind === 'prop' ? sel.prop : sel?.kind === 'shot' ? sel.shot : sel?.kind === 'camera' ? sel.camera : sel?.kind === 'joint' || sel?.kind === 'figure' ? sel.figure : sel ? null : store.getState().activeFigure;
          if (id) run(() => renameInOutline(store, id));
          return;
        }
        case 'Escape': return run(() => store.select(null));
        case '?': return run(() => setDialog('help'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, store, notify, notifyUndo, frame, frameCurrent, saveFile, setGizmo, togglePlay, stopPlayback]);

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
    const ui = { notify, notifyUndo };
    const sel = store.getState().selection;
    if (hit.prop) {
      store.select({ kind: 'prop', prop: hit.prop });
      openContextMenu(e, propMenu(store, hit.prop, ui), store.scene.props.find((p) => p.id === hit.prop)?.name);
    } else if (hit.figure) {
      if (!(sel?.kind === 'joint' && sel.figure === hit.figure)) store.select({ kind: 'figure', figure: hit.figure });
      openContextMenu(e, figureMenu(store, hit.figure, ui), store.scene.figures.find((f) => f.id === hit.figure)?.name);
    } else {
      openContextMenu(e, canvasMenu(store, hit.floor, frameCurrent));
    }
  };

  const ctx: InspectorContext = {
    editorCamera: () => apiRef.current?.editorCamera() ?? null,
    rootPosition: (id) => apiRef.current?.rootPosition(id) ?? null,
    notify,
    notifyUndo,
    reference,
    setReference,
  };

  // Move works on any figure; Scale only on props.
  const gizmoForSelection = selection?.kind === 'prop' || (settings.gizmo === 'translate' && !!activeFigure);
  const openFilePicker = (mode: 'append' | 'replace') => {
    fileRef.current!.dataset.mode = mode;
    fileRef.current!.click();
  };
  const style = styleDef(settings.style);
  const StyleIcon = STYLE_ICONS[settings.style];

  return (
    <div
      className={`studio${drawer ? ` drawer-${drawer}` : ''}${settings.inspector ? '' : ' inspector-closed'}`}
      onPointerDownCapture={(e) => { if (!(e.target as HTMLElement).closest('.timeline')) stopPlayback(); }}
    >
      <header className="topbar">
        <div className="tb-left">
          <IconButton icon={PanelLeft} label="Side panel" className="only-mobile" onClick={() => setDrawer(drawer === 'library' ? null : 'library')} />
          <Menu
            label="Main menu"
            className="brand"
            items={[
              { label: 'New scene', icon: FilePlus2, onSelect: () => addScene(store) },
              { label: 'Duplicate scene', icon: Copy, onSelect: () => duplicateCurrentScene(store) },
              '-',
              { label: 'Save library (.json)', icon: Save, shortcut: 'Ctrl S', onSelect: saveFile },
              { label: 'Import scenes…', icon: FileUp, onSelect: () => openFilePicker('append') },
              { label: 'Open library (replace)…', icon: FolderOpen, onSelect: () => openFilePicker('replace') },
              '-',
              { label: 'Pose from photo…', icon: ScanFace, onSelect: () => setDialog('photo') },
              { label: 'Copy share link', icon: Link, onSelect: share },
              { label: 'Storyboard', icon: LayoutPanelTop, shortcut: 'B', onSelect: () => setDialog('board') },
              { label: 'Gesture practice', icon: Timer, shortcut: 'P', onSelect: () => setDialog('practice') },
              { label: 'Keyboard shortcuts', icon: Keyboard, shortcut: '?', onSelect: () => setDialog('help') },
            ]}
          >
            <Logo />
            <span className="brand-name">Pose Studio</span>
            <ChevronDown size={14} className="brand-chevron" aria-hidden />
          </Menu>
          <span className="tb-sep hide-mobile" />
          <div className="toolbar" role="toolbar" aria-label="Canvas tools">
            <Segmented<GizmoMode>
              label="Gizmo"
              value={settings.gizmo}
              onChange={setGizmo}
              iconOnly
              options={[
                { value: 'rotate', label: 'Pose', icon: Hand, title: 'Pose: drag parts (Shift twists), floor rings turn  E' },
                { value: 'translate', label: 'Move', icon: Move3d, title: 'Move figure or prop  W' },
                { value: 'scale', label: 'Scale', icon: Scale3d, title: 'Scale prop  R' },
              ]}
            />
            <span className="tb-sep" />
            <Menu
              label="View"
              className="btn ghost"
              tip="Camera angle and what the canvas shows"
              items={[
                { group: 'Camera' },
                ...VIEW_PRESETS.map((v) => ({ label: v.label, shortcut: v.key, onSelect: () => frame(v) })),
                { group: 'Show' },
                { label: 'Drag handles', shortcut: 'H', checked: settings.showHandles, onSelect: () => store.setSettings({ showHandles: !settings.showHandles }) },
                { label: 'Floor grid', checked: settings.showGrid, onSelect: () => store.setSettings({ showGrid: !settings.showGrid }) },
              ]}
            >
              <Eye size={15} strokeWidth={1.75} aria-hidden /> <span className="hide-sm">View</span> <ChevronDown size={13} aria-hidden />
            </Menu>
            <IconButton icon={Focus} label="Frame all" shortcut="F" onClick={frameCurrent} />
            <span className="tb-sep" />
            <Menu
              label="Render style"
              className="btn ghost"
              tip="Render style  L"
              items={STYLE_LIST.map((s) => ({
                label: s.label, icon: STYLE_ICONS[s.id], checked: s.id === settings.style, onSelect: () => store.setSettings({ style: s.id }),
              }))}
            >
              <StyleIcon size={15} strokeWidth={1.75} aria-hidden /> <span className="hide-sm">{style.label}</span> <ChevronDown size={13} aria-hidden />
            </Menu>
          </div>
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
          <ScenePicker notifyUndo={notifyUndo} />
          <SaveIndicator status={saveStatus} />
        </div>
        <div className="tb-right">
          <IconButton icon={Undo2} label="Undo" shortcut="Ctrl Z" onClick={() => store.undo()} disabled={!canUndo} />
          <IconButton icon={Redo2} label="Redo" shortcut="Ctrl Shift Z" onClick={() => store.redo()} disabled={!canRedo} />
          <span className="tb-sep hide-mobile" />
          <IconButton icon={CircleHelp} label="Help" shortcut="?" onClick={() => setDialog('help')} className="hide-mobile" />
          {Account && <Account />}
          <button type="button" className="btn primary" onClick={() => setDialog('export')} data-tip="Export image  Ctrl E">
            <Download size={15} strokeWidth={2} aria-hidden /> <span>Export</span>
          </button>
          <IconButton
            icon={settings.inspector ? PanelRightClose : PanelRightOpen}
            label={settings.inspector ? 'Hide the inspector' : 'Show the inspector'}
            shortcut="I"
            className="hide-mobile"
            pressed={settings.inspector}
            onClick={toggleInspector}
          />
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
        actions={[{ label: 'Storyboard', icon: LayoutPanelTop, shortcut: 'B', onSelect: () => { stopPlayback(); setDialog('board'); } }]}
      />

      <main className={`stage${scene.animation ? ' animated' : ''}`} style={{ background: style.background }}>
        <Viewport
          store={store}
          scene={scene}
          selection={selection}
          activeFigure={activeFigure}
          settings={settings}
          frameRequest={frameRequest}
          apiRef={apiRef}
          clock={clock}
          time={time}
          shotMode={shotMode}
          onion={onion}
          onMenu={openCanvasMenu}
        />
        {shotMode && <Letterbox aspect={frameAspect(scene)} guides={settings.guides} />}
        {scene.animation && !shotMode && <CorrectionBadge scene={scene} figureId={activeFigure} time={time} />}
        {settings.tips && (
          <section className="tips" aria-label="Tips">
            <ul>
              <li><b>Drag</b> an arm, a leg or the head to pose it</li>
              <li><b>Drag</b> the body to move a figure, the <b>ring</b> under it to turn it</li>
              <li><kbd>Shift</kbd>-drag to twist a part or turn a figure</li>
              <li><b>Right-click</b> anything for what you can do with it</li>
            </ul>
            <button type="button" className="btn subtle" onClick={() => store.setSettings({ tips: false })}>Got it</button>
          </section>
        )}
        {reference.url && reference.visible && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="reference" src={reference.url} alt="" style={{ opacity: reference.opacity }} />
        )}
        {scene.animation && (
          <Timeline
            clock={clock}
            shotMode={shotMode}
            setShotMode={setShotMode}
            onion={onion}
            setOnion={setOnion}
            captureShot={() => apiRef.current?.captureShot() ?? null}
            notify={notify}
            notifyUndo={notifyUndo}
          />
        )}
        {settings.gizmo !== 'rotate' && !gizmoForSelection && (
          <div className="hint">Select a prop to {settings.gizmo === 'translate' ? 'move' : 'scale'} it</div>
        )}
      </main>

      <Inspector ctx={ctx} onHide={toggleInspector} />
      {drawer && <div className="scrim only-mobile" onClick={() => setDrawer(null)} />}

      {dialog === 'export' && (
        <ExportDialog onClose={() => setDialog(null)} notify={notify} editorCamera={ctx.editorCamera} />
      )}
      {dialog === 'photo' && (
        <PhotoDialog
          onClose={() => setDialog(null)}
          notify={notify}
          onReference={(url) => setReference({ url, visible: true })}
        />
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'practice' && <PracticeMode onClose={() => setDialog(null)} />}
      {dialog === 'board' && <Board onClose={() => setDialog(null)} notify={notify} />}
      <ContextMenuHost />
      <TooltipHost />
      <Toasts toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#18181b" />
      <circle cx="16" cy="7.6" r="3.1" fill="#3b6cff" />
      <path d="M16 12v8M16 13.5l-5.5 3.5M16 13.5l5.5-4.5M16 20l-3.5 6.5M16 20l4.5 6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text = status === 'saved' ? 'Saved' : status === 'pending' ? 'Saving…' : 'Not saved';
  const Icon = status === 'error' ? CloudOff : status === 'saved' ? CloudCheck : Cloud;
  return (
    <span
      className={`save-status ${status}`}
      title={status === 'error' ? 'Browser storage is full or blocked. Use Save library in the main menu.' : 'Poses are saved in this browser automatically'}
    >
      <Icon size={14} aria-hidden />
      <span className="hide-sm">{text}</span>
    </span>
  );
}

/** Over a motion or a walk, edits to the figure correct it: this says which (and that it is a correction). */
function CorrectionBadge({ scene, figureId, time }: { scene: Scene; figureId: string | null; time: number }) {
  const a = scene.animation!;
  const f = scene.figures.find((x) => x.id === figureId);
  if (!f || f.proxy) return null;
  const over = (['upper', undefined] as const).flatMap((layer) => actionsOf(a, f.id, layer)).find((x) => x.source.kind !== 'keys' && x.start < time - 1e-6 && time < x.start + x.duration - 1e-6);
  if (!over) return null;
  const src = over.source;
  const what = src.kind === 'travel' ? `${f.name}'s ${src.mode}` : `${f.name}'s ${clipById(src.kind === 'clip' ? src.clip : '')?.name ?? 'motion'}${over.layer === 'upper' ? ' (upper body)' : ''}`;
  return <div className="correcting" role="status">Posing here corrects {what}</div>;
}

/** The shot's frame over the canvas (its shape), with rule-of-thirds lines and safe areas if asked for. */
function Letterbox({ aspect, guides }: { aspect: number; guides: boolean }) {
  return (
    <div className="letterbox" aria-hidden>
      <div style={{ '--aspect': aspect } as CSSProperties}>
        {guides && (
          <>
            <i className="third v1" /><i className="third v2" /><i className="third h1" /><i className="third h2" />
            <i className="safe action" /><i className="safe title" />
          </>
        )}
      </div>
    </div>
  );
}
