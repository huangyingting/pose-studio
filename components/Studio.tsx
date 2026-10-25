'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendScenes, copyPose, deleteSelection, duplicateCurrentScene, mirrorPose, pastePose, replaceLibrary,
} from '@/lib/actions';
import { parseLibrary, uid } from '@/lib/doc';
import { withBase } from '@/lib/paths';
import { downloadBlob } from '@/lib/render';
import { decodeScene, sceneParam, shareUrl } from '@/lib/share';
import { Store, type SaveStatus } from '@/lib/store';
import { STYLES, type GizmoMode, type View } from '@/lib/types';
import { VIEW_PRESETS } from '@/lib/views';
import { ExportDialog, HelpDialog, PhotoDialog } from './dialogs';
import ErrorBoundary from './ErrorBoundary';
import Inspector, { type InspectorContext, type Tab } from './Inspector';
import LibraryPanel from './LibraryPanel';
import { StoreContext, useScene, useStore, useStudio } from './store-context';
import { PracticeMode } from './Practice';
import { Segmented, Toasts, type Notify, type Toast } from './ui';
import Viewport, { type FrameRequest, type ViewportApi } from './Viewport';

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
        <p>Pose Studio needs a browser with WebGL enabled (any recent Chrome, Edge, Firefox or Safari).</p>
      </div>
    );
  }
  return (
    <ErrorBoundary>
      <StoreContext.Provider value={store}>
        <App />
      </StoreContext.Provider>
    </ErrorBoundary>
  );
}

type Dialog = null | 'export' | 'photo' | 'help' | 'practice';
type Reference = { url: string | null; opacity: number; visible: boolean };

function App() {
  const store = useStore();
  const scene = useScene();
  const selection = useStudio((s) => s.selection);
  const activeFigure = useStudio((s) => s.activeFigure);
  const settings = useStudio((s) => s.settings);
  const canUndo = useStudio((s) => s.canUndo);
  const canRedo = useStudio((s) => s.canRedo);

  const [tab, setTab] = useState<Tab>('pose');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [reference, setReferenceState] = useState<Reference>({ url: null, opacity: 0.45, visible: true });
  const [frameRequest, setFrameRequest] = useState<FrameRequest>({ view: { yaw: 0, pitch: 4 }, n: 0 });
  const [drawer, setDrawer] = useState<null | 'library' | 'inspector'>(null);
  const apiRef = useRef<ViewportApi | null>(null);
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
    frame(cur ? { yaw: cur.yaw, pitch: cur.pitch } : store.scene.view);
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
        notify(`Opened shared pose “${s.name}”`);
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
      if (store.adoptExternal(e.newValue)) notify('Your poses were updated in another tab');
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
    const json = JSON.stringify(store.getState().library, null, 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), 'poses.json');
  }, [store]);

  const openFile = async (file: File, mode: 'replace' | 'append') => {
    try {
      const lib = parseLibrary(JSON.parse(await file.text()));
      const what = `${lib.scenes.length} pose${lib.scenes.length === 1 ? '' : 's'}`;
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
        else if (k === 'd') run(() => duplicateCurrentScene(store));
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
        case 'l': case 'L': return run(() => {
          const style = store.getState().settings.style;
          store.setSettings({ style: STYLES[(STYLES.indexOf(style) + 1) % STYLES.length] });
        });
        case 'p': case 'P': return run(() => setDialog('practice'));
        case '[': return run(() => store.setSceneIndex(Math.max(0, store.getState().sceneIndex - 1)));
        case ']': return run(() => store.setSceneIndex(Math.min(store.getState().library.scenes.length - 1, store.getState().sceneIndex + 1)));
        case 'Delete': case 'Backspace':
          if (deleteSelection(store)) { e.preventDefault(); notifyUndo('Prop deleted'); }
          return;
        case 'Escape': return run(() => store.select(null));
        case '?': return run(() => setDialog('help'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, store, notify, notifyUndo, frame, frameCurrent, saveFile, setGizmo]);

  // Offline support (production only: in development the cache would serve stale code).
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(withBase('/sw.js'), { scope: withBase('/') }).catch((err) => console.warn('Service worker registration failed', err));
  }, []);

  // Read-only hook for automated tests and power users (e.g. `__poseStudio.store.getState()` in the console).
  useEffect(() => {
    (window as unknown as { __poseStudio?: unknown }).__poseStudio = { store, viewport: apiRef };
  }, [store]);

  const ctx: InspectorContext = {
    frame,
    currentView: () => apiRef.current?.getView() ?? null,
    rootPosition: (id) => apiRef.current?.rootPosition(id) ?? null,
    notify,
    notifyUndo,
    reference,
    setReference,
  };

  const gizmoForSelection = selection?.kind === 'prop' || (selection?.kind === 'joint' && selection.joint === 'root');

  return (
    <div className={`studio${drawer ? ` drawer-${drawer}` : ''}`}>
      <header className="topbar">
        <button className="icon only-mobile" aria-label="Poses" onClick={() => setDrawer(drawer === 'library' ? null : 'library')}>☰</button>
        <div className="brand"><span className="logo" aria-hidden /> Pose Studio</div>
        <input
          className="scene-name"
          type="text"
          value={scene.name}
          onChange={(e) => store.updateScene((s) => ({ ...s, name: e.target.value }), 'rename')}
          aria-label="Pose name"
        />
        <div className="group">
          <button onClick={() => store.undo()} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
          <button onClick={() => store.redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
        </div>
        <SaveIndicator status={saveStatus} />
        <span className="spacer" />
        <button onClick={() => setDialog('practice')} title="Timed gesture-drawing slideshow (P)">⏱ <span className="hide-sm">Practice</span></button>
        <button onClick={() => setDialog('photo')} title="Detect a pose in a photo">📷 <span className="hide-sm">Pose from photo</span></button>
        <button onClick={share} title="Copy a link to this pose">🔗 <span className="hide-sm">Share</span></button>
        <details className="menu">
          <summary>File</summary>
          <div className="menu-items" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
            <button onClick={saveFile}>Save library (.json)</button>
            <button onClick={() => { fileRef.current!.dataset.mode = 'append'; fileRef.current!.click(); }}>Import poses…</button>
            <button onClick={() => { fileRef.current!.dataset.mode = 'replace'; fileRef.current!.click(); }}>Open library (replace)…</button>
            <button onClick={() => setDialog('practice')}>Gesture practice…</button>
            <button onClick={() => setDialog('help')}>Help &amp; shortcuts</button>
          </div>
        </details>
        <button className="primary" onClick={() => setDialog('export')} title="Export image (Ctrl+E)">Export</button>
        <button className="icon hide-mobile" onClick={() => setDialog('help')} aria-label="Help" title="Help (?)">?</button>
        <button className="icon only-mobile" aria-label="Inspector" onClick={() => setDrawer(drawer === 'inspector' ? null : 'inspector')}>⚙</button>
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

      <LibraryPanel onPick={() => setDrawer(null)} notifyUndo={notifyUndo} />

      <main className="stage">
        <Viewport
          store={store}
          scene={scene}
          selection={selection}
          activeFigure={activeFigure}
          settings={settings}
          frameRequest={frameRequest}
          apiRef={apiRef}
        />
        {reference.url && reference.visible && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="reference" src={reference.url} alt="" style={{ opacity: reference.opacity }} />
        )}
        <div className="viewbar">
          <Segmented<GizmoMode>
            label="Gizmo"
            value={settings.gizmo}
            onChange={setGizmo}
            options={[
              { value: 'rotate', label: 'Rotate', title: 'Rotate (E)' },
              { value: 'translate', label: 'Move', title: 'Move pelvis or prop (W)' },
              { value: 'scale', label: 'Scale', title: 'Scale prop (R)' },
            ]}
          />
          <span className="sep" />
          {VIEW_PRESETS.map((v) => (
            <button key={v.label} onClick={() => frame(v)} title={`${v.label} view (${v.key})`}>{v.label}</button>
          ))}
          <button onClick={frameCurrent} title="Frame everything (F)">Frame</button>
          <span className="sep" />
          <button
            className={settings.showHandles ? 'on' : ''}
            onClick={() => store.setSettings({ showHandles: !settings.showHandles })}
            title="Drag handles (H)"
          >
            Handles
          </button>
        </div>
        {settings.gizmo !== 'rotate' && !gizmoForSelection && (
          <div className="hint">Select the pelvis or a prop to {settings.gizmo === 'translate' ? 'move' : 'scale'} it</div>
        )}
      </main>

      <Inspector tab={tab} setTab={setTab} ctx={ctx} />
      {drawer && <div className="scrim only-mobile" onClick={() => setDrawer(null)} />}

      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} notify={notify} />}
      {dialog === 'photo' && (
        <PhotoDialog
          onClose={() => setDialog(null)}
          notify={notify}
          onReference={(url) => setReference({ url, visible: true })}
        />
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'practice' && <PracticeMode onClose={() => setDialog(null)} />}
      <Toasts toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text = status === 'saved' ? 'Saved' : status === 'pending' ? 'Saving…' : 'Not saved';
  return (
    <span
      className={`save-status ${status} hide-sm`}
      title={status === 'error' ? 'Browser storage is full or blocked. Use File → Save library.' : 'Poses are saved in this browser automatically'}
    >
      {text}
    </span>
  );
}
