'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Activity, Camera, Clapperboard, Diamond, Scissors, TriangleAlert, X, Ellipsis, Pause, Play, Plus, Lock, VolumeX, ChevronRight } from 'lucide-react';
import {
  setAnimationOptions, cutAnimation, issueFix, addMarker, setRange, setRangeAt, setTrack, copyKeys, pasteKeys, deleteKeys, hasCopiedKeys, 
} from '@/lib/actions';
import { MAX_DURATION, PAST_END, snapTime } from '@/lib/animation';
import { propStretchesOf } from '@/lib/evaluate';
import { propKeyTimes } from '@/lib/propmotion';
import { keyTimesOf, moments } from '@/lib/track';
import { ISSUE_LABELS, checkMotion, type Issue } from '@/lib/qa';
import { shotSpans } from '@/lib/shots';
import { cameraById, liveCamera } from '@/lib/cameras';
import { DIRECTOR_STYLES } from '@/lib/coverage';
import { type Animation } from '@/lib/types';
import { startPlayback, type Clock } from './clock';
import { openContextMenu } from './ContextMenu';
import { choices, command, menu, menuItems, setApp, tipOf, titleOf, type Ctx } from './commands';
import ActionPicker, { type PickerAt } from './ActionPicker';
import { CommandButton } from './CommandButton';
import { stepDone } from './nextStep';
import { rovingKey, useRoving, type Roving } from './roving';
import { useScene, useStore, useStudio } from './store-context';
import { useDrags } from './timeline/drags';
import { CameraRow, FigureRow, PropRow, Ruler, ShotsRow, type TrackView } from './timeline/rows';
import { IconButton, Menu, NumberField, type Notify } from './ui';

/** Row heights (px): the time ruler, the shots, each figure, each prop moving, the path camera. */
const ROW = { ruler: 20, shots: 30, figure: 36, prop: 28, camera: 30, layers: 30 };

/** Current playhead: the clock while playing, the document time otherwise. */
export function usePlayhead(clock: Clock) {
  useSyncExternalStore(clock.subscribe, clock.getVersion, clock.getVersion);
  const time = useStudio((s) => s.time);
  return clock.playing ? clock.time : time;
}

/** The timeline bar's buttons for the keyboard: a toolbar (#20). */
// (Not the buttons of its question about shortening, which takes the focus while it is asked.)
const BAR_KEYS: Roving = { items: 'button:not(.tl-ask *)', orientation: 'horizontal' };

/** Ruler spacings (seconds), finest first: the finest that keeps ticks (and labels) apart is used. */
const TICKS = [1 / 24, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
const LABELS = [0.25, 0.5, 1, 2, 5, 10, 30, 60, 120];

/** The timeline's height, for the canvas above it (and, on phones, the canvas tools); its width too. */
function useHeight(root: RefObject<HTMLDivElement | null>, setWidth?: (w: number) => void) {
  useEffect(() => {
    const el = root.current;
    const studio = el?.closest<HTMLElement>('.studio');
    if (!el || !studio) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      studio.style.setProperty('--tl-h', `${Math.ceil(r.height)}px`);
      setWidth?.(r.width);
    });
    ro.observe(el);
    return () => { ro.disconnect(); studio.style.removeProperty('--tl-h'); };
  }, [root, setWidth]);
}

/**
 * The timeline under the canvas, always there. A still scene's is its bar: a key, or an action
 * from the + picker, makes the scene animated. Each figure's row has a + at the playhead for what
 * it does next.
 */
export default function Timeline({ clock, notify }: { clock: Clock; notify: Notify }) {
  const scene = useScene();
  const [picker, setPicker] = useState<(PickerAt & { scene: string }) | null>(null);
  const open = (figure: string, el: Element) => {
    const r = el.getBoundingClientRect();
    setPicker({ figure, x: r.left, y: r.top, scene: scene.id });
  };
  return (
    <>
      {scene.animation ? <Tracks clock={clock} notify={notify} openPicker={open} /> : <Still openPicker={open} />}
      {picker?.scene === scene.id && <ActionPicker at={picker} onClose={() => setPicker(null)} />}
    </>
  );
}

/** A still scene's timeline: its bar, with a key (which starts the animation) and an action for the selected figure. */
function Still({ openPicker }: { openPicker(figure: string, el: Element): void }) {
  const store = useStore();
  const scene = useScene();
  const root = useRef<HTMLDivElement>(null);
  useHeight(root);
  const activeId = useStudio((st) => st.activeFigure);
  const active = scene.figures.find((f) => f.id === activeId && !f.proxy) ?? scene.figures.find((f) => !f.proxy);
  const c: Ctx = { store };
  return (
    <div className="timeline folded still" role="region" aria-label="Timeline" ref={root}>
      <div className="tl-bar">
        <span className="tl-still">Still image</span>
        <span className="tl-sep" />
        <button
          type="button"
          className="btn ghost tl-btn"
          aria-label={titleOf(command('timeline.key'), c)}
          data-tip={tipOf('timeline.key', titleOf(command('timeline.key'), c))}
          data-tip-side="top"
          onClick={() => command('timeline.key').run!(c)}
        >
          <Diamond size={16} aria-hidden /> <span className="tl-label">Key</span>
        </button>
        {active && (
          <button
            type="button"
            className="btn ghost tl-btn"
            // (Named also when a narrow timeline shows only its icon.)
            aria-label="Add an action"
            onClick={(e) => openPicker(active.id, e.currentTarget)}
            data-tip={`What ${active.name} does: walk somewhere, a motion, a pose…`}
            data-tip-side="top"
          >
            <Plus size={16} aria-hidden /> <span className="tl-label">Add an action</span>
          </button>
        )}
        <span className="tl-sep" />
        <span className="tl-note">Add a key (K) or an action to animate</span>
      </div>
    </div>
  );
}

/**
 * The timeline under the canvas: transport, the shots (the cuts between cameras), a key track
 * per figure (and per prop that moves), and one camera's track: the selected camera's, or the one
 * filming at the playhead. Editing a figure at any time records a key there
 * (auto-key). It zooms (Ctrl + wheel, the buttons) and scrolls (Shift + wheel, the bar under it),
 * folds down to its toolbar, and its top edge drags to make it taller.
 */
function Tracks({ clock, notify, openPicker }: { clock: Clock; notify: Notify; openPicker(figure: string, el: Element): void }) {
  const store = useStore();
  const scene = useScene();
  const a = scene.animation!;
  const time = usePlayhead(clock);
  const folded = useStudio((s) => s.settings.timelineFolded);
  const height = useStudio((s) => s.settings.timelineHeight);
  const track = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [laneWidth, setLaneWidth] = useState(600);
  const [width, setWidth] = useState(1000);
  // The canvas sits above the timeline, whose height grows with the number of figures.
  useHeight(root, setWidth);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLaneWidth(Math.max(1, el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [folded]);

  // The stretch of time on show: all of it and a little past its end (where what is added lengthens it), or
  // a zoomed-in window (which follows the playhead while playing).
  const total = Math.min(MAX_DURATION, a.duration + PAST_END);
  const [zoom, setZoom] = useState<{ start: number; span: number } | null>(null);
  const span = zoom ? Math.min(zoom.span, total) : total;
  let v0 = zoom ? Math.min(Math.max(0, zoom.start), total - span) : 0;
  if (zoom && clock.playing && (time < v0 || time > v0 + span)) v0 = Math.min(total - span, Math.max(0, v0 + Math.floor((time - v0) / span) * span));
  const v1 = v0 + span;
  // (The window on show, for what runs between renders: a drag, its auto-scroll.)
  const view = useRef({ v0, span, zoomed: !!zoom, total });
  useLayoutEffect(() => { view.current = { v0, span, zoomed: !!zoom, total }; });
  const setWindow = (start: number, s: number) => {
    const sp = Math.min(total, Math.max(Math.min(0.5, total), s));
    setZoom(sp >= total - 1e-6 ? null : { start: Math.min(Math.max(0, start), total - sp), span: sp });
  };
  // (The playhead moved out of the window, by a key, a step, a check's issue: the window turns a page to show it.)
  useEffect(() => {
    let was = store.getState().time;
    const off = store.subscribe(() => {
      const t = store.getState().time;
      if (t === was) return;
      was = t;
      const v = view.current;
      if (!v.zoomed || clock.playing || (t >= v.v0 - 1e-6 && t <= v.v0 + v.span + 1e-6)) return;
      setZoom({ start: Math.min(v.total - v.span, Math.max(0, t < v.v0 ? t - v.span * 0.8 : t - v.span * 0.2)), span: v.span });
    });
    return () => { off(); };
  }, [store, clock]);
  /** Zoom about the playhead: it keeps its place on screen, or the view centres on it. */
  const zoomBy = (factor: number) => {
    const sp = span * factor;
    const t = clock.playing ? clock.time : store.getState().time;
    setWindow(t >= v0 && t <= v1 ? t - ((t - v0) / span) * sp : t - sp / 2, sp);
  };

  // Keys picked to move together, and the box being drawn to pick them (for this scene).
  const [pickedKeys, setPickedKeys] = useState<{ scene: string; figure: string; times: number[] } | null>(null);
  const keyPick = pickedKeys && pickedKeys.scene === scene.id ? pickedKeys : null;
  const setPicked = (p: { figure: string; times: number[] } | null) => setPickedKeys(p && { ...p, scene: scene.id });
  const [box, setBox] = useState<{ figure: string; rows: string[]; t0: number; t1: number } | null>(null);
  // A shorter length asks first whether to scale what is there into it or cut it (for this scene).
  const [asked, setShorten] = useState<{ scene: string; d: number } | null>(null);
  const shorten = asked?.scene === scene.id ? asked.d : null;
  const ask = useRef<HTMLDivElement>(null);
  const length = (d: number) => {
    const busy = a.actions.some((x) => x.duration > 1e-6) || Object.values(a.props ?? {}).some((k) => k.length) || a.shots.length > 1;
    if (d < a.duration - 1e-6 && busy) setShorten({ scene: scene.id, d });
    else setAnimationOptions(store, { duration: d });
  };
  // The question takes the focus (Esc answers Cancel) and a click elsewhere puts it away.
  useEffect(() => {
    if (shorten === null) return;
    ask.current?.focus();
    const away = (e: PointerEvent) => { if (!ask.current?.contains(e.target as Node)) setShorten(null); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [shorten]);

  const frame = Math.round(time * a.fps);
  // Each figure has its own key track; the key buttons work on the active figure's.
  const activeId = useStudio((st) => st.activeFigure);
  const selected = useStudio((st) => (st.selection?.kind === 'action' ? st.selection.action : null));
  // (Blocks picked with it, #22.)
  const also = useStudio((st) => (st.selection?.kind === 'action' ? st.selection.also : undefined));
  const isPicked = (id: string) => selected === id || !!also?.includes(id);
  // People whose rows are unfolded into their layers (#22): the base, then the upper body and corrections in lanes of their own.
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set());
  const unfold = (id: string) => setUnfolded((was) => { const next = new Set(was); if (!next.delete(id)) next.add(id); return next; });
  // Auto-key: posing the selected figure keys it at the playhead (shown in red on its row and the playhead).
  const keying = useStudio((st) => (st.selection?.kind === 'figure' || st.selection?.kind === 'joint' ? st.selection.figure : null));
  // A Library item dragged over a row: where (and for how long) it would go.
  const [dropAt, setDropAt] = useState<{ figure: string; t: number; length?: number } | null>(null);
  const figures = scene.figures;
  const multi = figures.length > 1;
  const active = figures.find((f) => f.id === activeId) ?? figures[0];
  const activeKeys = active ? keyTimesOf(a, active.id) : [];
  const markers = a.markers ?? [];
  // (Where Shift + ← → go: the keys and moments, and the markers, #22.)
  const stops = [...new Set([...(active ? moments(a, active.id) : moments(a)), ...markers.map((m) => m.t)])].sort((p, q) => p - q);
  const near = (t: number) => Math.abs(t - time) < 0.5 / a.fps;
  const onKey = activeKeys.some(near);
  const spans = shotSpans(a);
  // The camera row: the selected camera, or the one filming at the playhead.
  const picked = useStudio((st) => (st.selection?.kind === 'camera' ? st.selection.camera : null));
  const rowCam = cameraById(scene, picked ?? undefined) ?? liveCamera(scene, time);
  const camTimes = rowCam.kind === 'path' ? rowCam.points.map((p) => p.t) : [];
  // Drags snap (#22): to the playhead, blocks' edges, keys, cuts, markers and the camera's points
  // within 6 px, a line showing where; the magnet in the bar turns it off.
  const snapping = useStudio((st) => st.settings.timelineSnap);
  const [snapAt, setSnapAt] = useState<number | null>(null);
  // (What a drag of an action does, said by what is dragged while it goes on, #22.)
  const [readout, setReadout] = useState<{ t: number; text: string } | null>(null);
  // Motion check results, valid until the animation changes.
  const [qa, setQa] = useState<{ animation: Animation; issues: Issue[] } | null>(null);
  const [qaOpen, setQaOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const issues = qa?.animation === a ? qa.issues : null;

  const pause = () => {
    if (!clock.playing) return;
    // Keep the stretch of time the playhead was followed to.
    if (zoom) setZoom({ start: v0, span });
    clock.pause();
    store.setTime(clock.time);
  };
  const toggle = () => {
    if (clock.playing) pause();
    else startPlayback(clock, store);
  };
  const seek = (t: number) => {
    pause();
    store.setTime(snapTime(a, t));
  };
  // What is dragged along the lanes, and where it snaps (./timeline/drags.ts).
  const drags = useDrags({ store, a, figures, rowCam: rowCam.id, camTimes, track, root, view, laneWidth, snapping, keyPick, setPicked, setBox, setSnapAt, setReadout, setZoom, pause, seek, notify });
  const { scrub } = drags;
  const prevKey = [...stops].reverse().find((t) => t < time - 1e-3);
  const nextKey = stops.find((t) => t > time + 1e-3);

  // Ctrl + wheel zooms about the pointer; Shift + wheel (or a sideways swipe) scrolls when zoomed.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const at = v0 + ((e.clientX - r.left) / r.width) * span;
        const sp = Math.min(total, Math.max(Math.min(0.5, total), span * Math.exp(e.deltaY * 0.004)));
        setZoom(sp >= total - 1e-6 ? null : { start: Math.min(Math.max(0, at - ((at - v0) / span) * sp), total - sp), span: sp });
        return;
      }
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      if (!zoom || Math.abs(dx) < Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
      e.preventDefault();
      setZoom({ start: Math.min(Math.max(0, v0 + (dx / el.getBoundingClientRect().width) * span), total - span), span });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [v0, span, zoom, total, folded]);


  const check = () => {
    stepDone(scene.id, 'check');
    if (issues) { setQaOpen(!qaOpen); return; }
    pause();
    setChecking(true);
    // Let the button show that it is working before the (synchronous) check runs.
    setTimeout(() => {
      const scene = store.scene;
      const found = scene.animation ? checkMotion(scene) : [];
      setQa(scene.animation ? { animation: scene.animation, issues: found } : null);
      setChecking(false);
      setQaOpen(found.length > 0);
      if (!found.length) notify('Motion check: no problems found');
    }, 30);
  };
  // (A fix taken: checked again straight after, the card staying open on what is left.)
  const fix = (run: () => void) => {
    run();
    setChecking(true);
    setTimeout(() => {
      const scene = store.scene;
      const found = scene.animation ? checkMotion(scene) : [];
      setQa(scene.animation ? { animation: scene.animation, issues: found } : null);
      setChecking(false);
      setQaOpen(found.length > 0);
      if (!found.length) notify('Motion check: no problems left');
    }, 30);
  };
  const goTo = (i: Issue) => {
    seek(i.start);
    if (i.joint) store.select({ kind: 'joint', figure: i.figure, joint: i.joint });
    else store.setActiveFigure(i.figure);
  };

  /** Drag the top edge to set the tracks' height; double-click it to fit them again. */
  const resize = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const tracks = root.current?.querySelector('.tl-tracks');
    const h0 = tracks?.getBoundingClientRect().height ?? 120;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => store.setSettings({ timelineHeight: Math.round(Math.min(window.innerHeight * 0.6, Math.max(48, h0 + y0 - ev.clientY))) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /**
   * The timeline's own keys, while it has the focus (#19): ← → a frame, Shift + ← → the active row's
   * previous / next key, Home / End, ↑ ↓ the person above / below, = − 0 zoom; Esc gives the keys back.
   */
  const onKeys = (e: ReactKeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, [role="menu"], [role="alertdialog"]')) return;
    // Keys picked (#22): Ctrl + C copies them, Ctrl + V pastes the copied at the playhead on the
    // person picked (Ctrl + Shift + V mirrored), Delete removes them.
    const mod = e.ctrlKey || e.metaKey;
    const keysHere = keyPick && keyPick.times.length ? keyPick : null;
    const who = activeId ?? figures[0]?.id;
    const keyed: Record<string, (() => void) | undefined> = {
      c: mod && keysHere ? () => { const n = copyKeys(store, keysHere.figure, keysHere.times); notify(`${n} ${n === 1 ? 'key' : 'keys'} copied`); } : undefined,
      v: mod && hasCopiedKeys() && who ? () => { const why = pasteKeys(store, who, store.getState().time, e.shiftKey); if (why) notify(why); } : undefined,
      Delete: !mod && keysHere ? () => { deleteKeys(store, keysHere.figure, keysHere.times); setPicked(null); } : undefined,
      Backspace: !mod && keysHere ? () => { deleteKeys(store, keysHere.figure, keysHere.times); setPicked(null); } : undefined,
    };
    const doKeys = keyed[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (doKeys) {
      e.preventDefault();
      e.stopPropagation();
      doKeys();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const at = store.getState().time;
    const go = (t: number | undefined) => { if (t !== undefined) seek(Math.min(Math.max(0, t), a.duration)); };
    const row = (by: number) => {
      const i = figures.findIndex((f) => f.id === active?.id);
      const next = figures[Math.min(figures.length - 1, Math.max(0, i + by))];
      if (next && next.id !== active?.id) store.setActiveFigure(next.id);
    };
    const keys: Record<string, () => void> = {
      ArrowLeft: () => (e.shiftKey ? go(prevKey) : go(at - 1 / a.fps)),
      ArrowRight: () => (e.shiftKey ? go(nextKey) : go(at + 1 / a.fps)),
      Home: () => go(0),
      End: () => go(a.duration),
      ArrowUp: () => row(-1),
      ArrowDown: () => row(1),
      '=': () => zoomBy(0.5),
      '+': () => zoomBy(0.5),
      '-': () => zoomBy(2),
      '0': () => setZoom(null),
      // (A marker at the playhead, #22.)
      m: () => addMarker(store, at),
      M: () => addMarker(store, at),
      // (In and out, #22.)
      i: () => setRangeAt(store, 'in', at),
      o: () => setRangeAt(store, 'out', at),
      x: () => setRange(store, null),
      Escape: () => (e.currentTarget as HTMLElement).blur(),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    e.stopPropagation();
    run();
  };
  const tracks = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useRoving(bar, BAR_KEYS);
  const [scrolled, setScrolled] = useState(false);
  const [keysHere, setKeysHere] = useState(false);
  // (The active person's row in sight whenever they change: from the canvas, the outline or the keys.)
  // (Only the tracks scroll, up or down, under their fixed header: nothing else moves.)
  useEffect(() => {
    const box = tracks.current;
    const row = box?.querySelector<HTMLElement>(`[data-row="${activeId}"]`);
    if (!box || !row) return;
    const [b, r] = [box.getBoundingClientRect(), row.getBoundingClientRect()];
    const head = ROW.ruler + ROW.shots;
    if (r.top < b.top + head) box.scrollTop -= b.top + head - r.top;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  }, [activeId]);

  // The commands reach the motion check and the zoom here.
  useEffect(() => {
    setApp({ checkMotion: check, zoomTimeline: (how) => (how === 'fit' ? setZoom(null) : zoomBy(how === 'in' ? 0.5 : 2)) });
  });
  const c: Ctx = { store };

  const pct = (t: number) => `${((t - v0) / span) * 100}%`;
  const pxPerSecond = laneWidth / span;
  // Keys closer together on screen than a key is wide (a motion keyed every frame) show as dots.
  const dense = (times: number[]) => times.map((t, i) => Math.min(
    i > 0 ? (t - times[i - 1]) * pxPerSecond : Infinity,
    i < times.length - 1 ? (times[i + 1] - t) * pxPerSecond : Infinity,
  ) < 8);
  // Ruler, shots, one row per figure (taller when there is just one), camera.
  // Props that move over time get a row each, under the figures.
  const moving = scene.props.filter((p) => propKeyTimes(a, p.id).length > 0 || a.actions.some((x) => x.prop === p.id));
  // What happens to the props: released (a throw), caught or taken (a handoff), with a line from each release to where it is caught or lands.
  const name = (id?: string) => figures.find((f) => f.id === id)?.name ?? '';
  const events: { t: number; figure: string; kind: 'release' | 'catch'; title: string }[] = [];
  const flights: { t0: number; from: string; t1: number; to: string | null; prop: number }[] = [];
  moving.forEach((p, j) => {
    const st = propStretchesOf(scene, p.id);
    st.forEach((x, i) => {
      const prev = st[i - 1];
      if (x.kind === 'free' && prev?.kind === 'held' && prev.figure) {
        events.push({ t: x.t0, figure: prev.figure, kind: 'release', title: `${name(prev.figure)} lets go of ${p.name}` });
        const next = st[i + 1];
        flights.push({ t0: x.t0, from: prev.figure, t1: next?.kind === 'held' ? next.t0 : x.t1, to: next?.kind === 'held' ? next.figure ?? null : null, prop: j });
      }
      if (x.kind === 'held' && x.figure && i > 0 && (prev.kind !== 'held' || prev.figure !== x.figure)) {
        events.push({ t: x.t0, figure: x.figure, kind: 'catch', title: `${name(x.figure)} ${prev.kind === 'held' ? 'takes' : 'catches'} ${p.name}${prev.kind === 'held' ? ` from ${name(prev.figure)}` : ''}` });
        if (prev.kind === 'held' && prev.figure) flights.push({ t0: x.t0, from: prev.figure, t1: x.t0, to: x.figure, prop: j });
      }
    });
  });
  // (Rows tall enough to take hold of: a block, its edges and its buttons, a key.)
  const top = ROW.ruler + ROW.shots;
  const figureY = (id: string) => top + figures.findIndex((f) => f.id === id) * ROW.figure + ROW.figure / 2;
  const propY = (j: number) => top + figures.length * ROW.figure + j * ROW.prop + ROW.prop / 2;
  // The camera row only for a camera on a path (selected, or filming at the playhead): its points to
  // retime; a camera on a rule places itself, with nothing to edit here.
  const cameraRow = rowCam.kind === 'path';
  const rows = [ROW.ruler, ROW.shots, ...figures.map((f) => ROW.figure + (unfolded.has(f.id) ? ROW.layers : 0)), ...moving.map(() => ROW.prop), ...(cameraRow ? [ROW.camera] : [])].map((h) => `${h}px`).join(' ');
  const step = TICKS.find((x) => x * pxPerSecond >= 10) ?? 60;
  const labelStep = LABELS.find((x) => x * pxPerSecond >= 56) ?? 120;
  const ticks: number[] = [];
  for (let i = Math.ceil(v0 / step - 1e-9); i * step <= v1 + 1e-9; i++) ticks.push(Math.round(i * step * 1000) / 1000);
  for (let i = Math.ceil(v0 / labelStep - 1e-9); i * labelStep <= v1 + 1e-9; i++) {
    const t = Math.round(i * labelStep * 1000) / 1000;
    if (!ticks.some((x) => Math.abs(x - t) < 1e-6)) ticks.push(t);
  }
  const label = (t: number) => (Math.abs(t / labelStep - Math.round(t / labelStep)) < 1e-6 ? `${+t.toFixed(2)}s` : null);
  /** A bar's label stays in sight when the bar starts before the stretch on show. */
  const inSight = (t0: number, t1: number) => (t0 < v0 && t1 > v0 ? { marginLeft: `${((v0 - t0) / (t1 - t0)) * 100}%` } : undefined);
  const speed = clock.speed;
  // A narrow timeline (a phone, or both panels open on a small screen) keeps the transport, the key
  // and the length in its bar; the rest moves into the ⋯ menu.
  const compact = width < 640;
  const qaLabel = checking ? 'Checking…' : issues ? (issues.length ? `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}` : 'No issues') : 'Check';
  // What the rows share (./timeline/rows.tsx).
  const tl: TrackView = {
    store, scene, a, time, v0, v1, span, laneWidth, pct, inSight, dense, near, pause, seek, openPicker, figures, multi, active, keying, unfolded, isPicked,
    keyPick, box, dropAt, setDropAt, events, spans, rowCam, camTimes, ticks, label, markers, issues, goTo, drags,
  };

  return (
    <div className={`timeline${folded ? ' folded' : ''}`} role="region" aria-label="Timeline" ref={root}>
      {!folded && <div className="tl-resize" onPointerDown={resize} onDoubleClick={() => store.setSettings({ timelineHeight: 0 })} data-tip="Drag to make the timeline taller or shorter (double-click: fit)" aria-hidden />}
      {/* (Its buttons one Tab stop, ← → between them: #20; the length field keeps its own keys.) */}
      <div className="tl-bar" role="toolbar" aria-label="Animation" ref={bar} onKeyDown={(e) => rovingKey(e, BAR_KEYS)}>
        <div className="tl-transport">
          <CommandButton id="timeline.prevKey" ctx={c} tipSide="top" className="tl-step" disabled={prevKey === undefined} />
          <button type="button" className="tl-play" onClick={toggle} aria-label={clock.playing ? 'Pause' : 'Play'} data-tip={tipOf('timeline.play', clock.playing ? 'Pause' : 'Play')} data-tip-side="top">
            {clock.playing ? <Pause size={17} aria-hidden /> : <Play size={17} aria-hidden />}
          </button>
          <CommandButton id="timeline.nextKey" ctx={c} tipSide="top" className="tl-step" disabled={nextKey === undefined} />
          <span className="tl-time" aria-live="off">
            {time.toFixed(2)}<span className="tl-narrow-hide">/ {a.duration.toFixed(1)} s</span><em className="tl-narrow-hide">F{frame}</em>
          </span>
          <Menu
            label="Playback speed"
            side="top"
            className="btn ghost tl-speed"
            tip="Playback speed"
            items={() => choices('timeline.speed', c)}
          >
            {speed}×
          </Menu>
        </div>
        <span className="tl-sep" />
        <button
          type="button"
          className={`btn ghost tl-btn${onKey ? ' on' : ''}`}
          aria-label={titleOf(command('timeline.key'), c)}
          data-tip={tipOf('timeline.key', titleOf(command('timeline.key'), c))}
          data-tip-side="top"
          onClick={() => command('timeline.key').run!(c)}
        >
          <Diamond size={16} aria-hidden /> <span className="tl-label">Key</span>
        </button>
        {!compact && (
          <>
            <CommandButton id="timeline.deleteKey" ctx={c} tipSide="top" disabled={!onKey || activeKeys.length <= 1} />
            <button type="button" className="btn ghost tl-btn" aria-label={titleOf(command('timeline.cut'), c)} data-tip={tipOf('timeline.cut')} data-tip-side="top" onClick={() => command('timeline.cut').run!(c)}>
              <Scissors size={16} aria-hidden /> <span className="tl-label">Cut</span>
            </button>
            <CommandButton id="timeline.marker" ctx={c} tipSide="top" />
            <CommandButton id="timeline.snap" ctx={c} tipSide="top" />
          </>
        )}
        <CommandButton id="timeline.cameraPoint" ctx={c} tipSide="top" />
        {/* The director: cameras and cuts made from what they do, kept up to date (or by hand). */}
        <Menu label="Director" className="btn ghost tl-btn" tip={tipOf('timeline.director', 'Director')} items={() => choices('timeline.director', c)}>
          <Clapperboard size={16} aria-hidden /> <span className="tl-label">{scene.coverage?.live ? DIRECTOR_STYLES.find((d) => d.id === scene.coverage!.id)?.label ?? 'Director' : 'By hand'}</span>
        </Menu>
        <span className="tl-sep" />
        <div className="tl-duration" data-tip="Length (seconds)" data-tip-side="top">
          <NumberField prefix="⏱" label="Duration" value={a.duration} step={0.1} min={0.2} max={MAX_DURATION} digits={1} onChange={length} />
          {shorten !== null && (
            // Shorter: everything is scaled to fit, or (Cut instead) what is past the new end goes.
            <div ref={ask} tabIndex={-1} className="tl-ask" role="alertdialog" aria-label="Shorten the animation" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setShorten(null); } }}>
              <span>Scale everything into {shorten.toFixed(1)} s?</span>
              <button type="button" className="btn primary" onClick={() => { setAnimationOptions(store, { duration: shorten }); setShorten(null); }}>Scale</button>
              <button type="button" className="btn" onClick={() => { cutAnimation(store, shorten); setShorten(null); }}>Cut instead</button>
              <button type="button" className="btn subtle" onClick={() => setShorten(null)}>Cancel</button>
            </div>
          )}
        </div>
        {!compact && (
          <>
            <span className="tl-sep" />
            <button
              type="button"
              className={`btn ghost tl-qa${issues?.length ? ' warn' : ''}`}
              onClick={() => command('timeline.check').run!(c)}
              disabled={checking}
              aria-label={qaLabel}
              aria-expanded={issues?.length ? qaOpen : undefined}
              data-tip="Check for sliding feet, collisions, joints bent too far and pops"
              data-tip-side="top"
            >
              {issues?.length ? <TriangleAlert size={16} aria-hidden /> : <Activity size={16} aria-hidden />}
              <span className="tl-label">{qaLabel}</span>
            </button>
          </>
        )}
        <span className="spacer" />
        {!folded && (
          <span className="tl-zoom">
            <CommandButton id="timeline.zoomOut" ctx={c} tipSide="top" disabled={!zoom} />
            <CommandButton id="timeline.zoomIn" ctx={c} tipSide="top" disabled={span <= Math.min(0.5, a.duration) + 1e-6} />
            <CommandButton id="timeline.fit" ctx={c} tipSide="top" disabled={!zoom} />
          </span>
        )}
        {!folded && <span className="tl-sep" />}
        <Menu
          label="Animation options"
          side="top"
          align="end"
          className="ibtn"
          items={() => menuItems([...(compact ? ['timeline.deleteKey', 'timeline.cut', '-'] : []), 'timeline.check', 'timeline.repeat', 'timeline.loop', '-', 'timeline.deleteCameraPoint', 'timeline.remove'], c)}
        >
          <Ellipsis size={17} aria-hidden />
        </Menu>
        <CommandButton id="timeline.fold" ctx={c} tipSide="top" />
      </div>

      {!folded && (
        <div
          className={`tl-tracks${scrolled ? ' scrolled' : ''}`}
          ref={tracks}
          style={height ? { height, maxHeight: 'none' } : undefined}
          tabIndex={0}
          role="group"
          aria-label="Tracks"
          onKeyDown={onKeys}
          // (Its keys said when it is reached from the keyboard, not over the rows at every click in it.)
          onFocus={(e) => setKeysHere((e.target as HTMLElement).matches(':focus-visible'))}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeysHere(false); }}
          // (Clicked in, it takes the keys; not from what has a focus of its own.)
          onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('input, textarea, select')) e.currentTarget.focus({ preventScroll: true }); }}
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
        >
          {keysHere && <span className="tl-keys" aria-hidden><kbd>←</kbd><kbd>→</kbd> frame · <kbd>Shift</kbd> key · <kbd>↑</kbd><kbd>↓</kbd> person · <kbd>Home</kbd><kbd>End</kbd> · <kbd>=</kbd><kbd>−</kbd> zoom · <kbd>M</kbd> marker · <kbd>I</kbd><kbd>O</kbd> in, out · <kbd>Esc</kbd></span>}
          <div className="tl-labels" style={{ gridTemplateRows: rows }}>
            <span className="tl-head ruler" aria-hidden />
            <span className="tl-head shots" aria-hidden>Shots</span>
            {multi ? figures.map((f) => (
              <button
                key={f.id}
                type="button"
                tabIndex={-1}
                className={`tl-figure${f.id === active?.id ? ' on' : ''}`}
                onClick={() => store.setActiveFigure(f.id)}
                onContextMenu={(e) => openContextMenu(e, menu('figure', { store, figure: f.id }), f.name)}
                data-tip={`${f.name}: keys and retiming apply to this figure\nRight-click for more`}
              >
                {f.color && <span className="tl-dot" style={{ background: f.color }} aria-hidden />}
                {f.name}
                {/* (Its layers in lanes of their own, #22.) */}
                <ChevronRight size={11} className={`tl-unfold${unfolded.has(f.id) ? ' open' : ''}`} aria-label={unfolded.has(f.id) ? 'Fold the layers' : 'Unfold the layers'} onClick={(e) => { e.stopPropagation(); unfold(f.id); }} />
                {/* (Locked, muted, #22: a click lets go of it.) */}
                {f.locked && <Lock size={11} className="tl-flag" aria-label="Locked" onClick={(e) => { e.stopPropagation(); setTrack(store, f.id, { locked: false }); }} />}
                {f.muted && <VolumeX size={11} className="tl-flag" aria-label="Muted" onClick={(e) => { e.stopPropagation(); setTrack(store, f.id, { muted: false }); }} />}
              </button>
            )) : (
              <span aria-hidden>
                {active?.color && <span className="tl-dot" style={{ background: active.color }} />}
                {active?.name ?? 'Pose'}
              </span>
            )}
            {moving.map((p) => (
              <button key={p.id} type="button" className="tl-figure tl-prop" onClick={() => store.select({ kind: 'prop', prop: p.id })} data-tip={`${p.name}: carried, thrown and dropped over time`}>
                {p.name}
              </button>
            ))}
            {cameraRow && <button
              type="button"
              className={`tl-figure tl-camera${picked ? ' on' : ''}`}
              onClick={() => store.select({ kind: 'camera', camera: rowCam.id })}
              onContextMenu={(e) => openContextMenu(e, menu('camera', { store, camera: rowCam.id }), rowCam.name)}
              data-tip={`${rowCam.name}: ${picked ? 'the camera selected' : 'the camera filming at the playhead'}`}
            >
              <Camera size={12} aria-hidden /> {rowCam.name}
            </button>}
          </div>
          <div className="tl-lanes" ref={track} onPointerDown={scrub} style={{ gridTemplateRows: rows }}>
            <Ruler tl={tl} />
            <ShotsRow tl={tl} />
            {figures.map((f) => <FigureRow key={f.id} tl={tl} f={f} />)}
            {moving.map((p) => <PropRow key={p.id} tl={tl} p={p} />)}
            {cameraRow && <CameraRow tl={tl} />}
            {flights.length > 0 && (
              <svg className="tl-flights" aria-hidden>
                {flights.map((fl, n) => (
                  <line key={n} x1={pct(fl.t0)} y1={figureY(fl.from)} x2={pct(fl.t1)} y2={fl.to ? figureY(fl.to) : propY(fl.prop)} />
                ))}
              </svg>
            )}
            {a.duration < v1 - 1e-6 && (
              // Past the end: the playhead goes there, and a key or an action put there lengthens the animation.
              <div className="tl-past" style={{ left: pct(Math.max(v0, a.duration)), right: 0 }} aria-hidden />
            )}
            {snapAt !== null && snapAt >= v0 && snapAt <= v1 && <div className="tl-snapline" style={{ left: pct(snapAt) }} aria-hidden />}
            {readout && readout.t >= v0 && readout.t <= v1 && <div className={`tl-readout${readout.t > v0 + span * 0.6 ? ' left' : ''}`} style={{ left: pct(readout.t) }} role="status">{readout.text}</div>}
            {time >= v0 - 1e-6 && time <= v1 + 1e-6 && (
              <div
                className={`tl-playhead${keying ? ' autokey' : ''}`}
                style={{ left: pct(time) }}
                data-tip={keying ? `Auto-key: posing ${name(keying)} keys it here` : undefined}
                aria-hidden
              />
            )}
          </div>
          {zoom && (
            <ScrollBar
              start={v0 / total}
              size={span / total}
              onScroll={(f) => setZoom({ start: f * total, span })}
            />
          )}
        </div>
      )}
      {issues && issues.length > 0 && qaOpen && <MotionIssues issues={issues} goTo={goTo} fixOf={(i) => issueFix(store, i)} onFix={fix} onClose={() => setQaOpen(false)} />}
    </div>
  );
}

/** Where the zoomed-in window is in the whole animation; drag it to scroll. */
function ScrollBar({ start, size, onScroll }: { start: number; size: number; onScroll(start: number): void }) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !bar.current) return;
    e.preventDefault();
    const w = bar.current.getBoundingClientRect().width;
    const x0 = e.clientX;
    const s0 = start;
    const move = (ev: PointerEvent) => onScroll(Math.min(1 - size, Math.max(0, s0 + (ev.clientX - x0) / w)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="tl-scroll" ref={bar} aria-hidden>
      <div className="tl-scroll-thumb" style={{ left: `${start * 100}%`, width: `${size * 100}%` }} onPointerDown={drag} />
    </div>
  );
}

/** What the motion check found, with a hint each; click one to go to it. */
function MotionIssues({ issues, goTo, fixOf, onFix, onClose }: { issues: Issue[]; goTo(i: Issue): void; fixOf(i: Issue): { label: string; run(): void } | null; onFix(run: () => void): void; onClose(): void }) {
  return (
    <div className="qa-card" role="dialog" aria-label="Motion check" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="shot-editor-head">
        <strong>Motion check · {issues.length} {issues.length === 1 ? 'issue' : 'issues'}</strong>
        <IconButton icon={X} label="Close" onClick={onClose} size={15} />
      </div>
      <ul>
        {issues.map((i, n) => {
          const fix = fixOf(i);
          return (
            <li key={n}>
              <button type="button" onClick={() => goTo(i)}>
                <span className={`qa-kind ${i.kind}`}>{ISSUE_LABELS[i.kind]}</span>
                <em>{i.start.toFixed(2)}{i.end > i.start ? `–${i.end.toFixed(2)}` : ''} s</em>
                <span className="qa-msg">{i.message}</span>
                {!fix && issues.findIndex((x) => x.kind === i.kind) === n && <span className="qa-hint">{i.hint}</span>}
              </button>
              {fix && <button type="button" className="btn subtle qa-fix" onClick={() => onFix(fix.run)}>{fix.label}</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
