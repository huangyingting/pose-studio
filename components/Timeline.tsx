'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Activity, Camera, Clapperboard, Diamond, Pin, Scissors, TriangleAlert, X, Ellipsis, Pause, Play, Plus, Trash2, Users, Pencil, Lock, VolumeX, ChevronRight, Link as LinkIcon, Repeat } from 'lucide-react';
import {
  deleteCorrection, moveAction, moveKeyframe, moveKeyframes, retime, retimeCameraPoint, rippleKeys, setAnimationOptions, cutAnimation, editShot, moveShotCut, setBlend, issueFix, slip, trim, giveAction, editMarker, addMarker, setRange, setRangeAt, setTrack, copyKeys, pasteKeys, deleteKeys, hasCopiedKeys, retimeKeys, setBlendCurve, setCorrectionThroughout, correctEveryRepeat, deleteAction,
} from '@/lib/actions';
import { MAX_DURATION, PAST_END, snapTime } from '@/lib/animation';
import { clipById, loopsOf } from '@/lib/assets';
import { actionsOf, busySpans, propStretchesOf } from '@/lib/evaluate';
import { propKeyTimes, removePropKey } from '@/lib/propmotion';
import { actionLabel, correctionHeld, correctionTimesOf, repeatedUnder, keyAtTime, keyEasesOf, keyTimesOf, moments, travelInto } from '@/lib/track';
import { ISSUE_LABELS, checkMotion, type Issue } from '@/lib/qa';
import { shotSpans, type ShotSpan } from '@/lib/shots';
import { cameraById, liveCamera } from '@/lib/cameras';
import { DIRECTOR_STYLES } from '@/lib/coverage';
import { MARKER_COLORS, type Action, type Animation, type Scene } from '@/lib/types';
import { startPlayback, type Clock } from './clock';
import { openContextMenu } from './ContextMenu';
import { choices, command, menu, menuItems, setApp, tipOf, titleOf, type Ctx } from './commands';
import ActionPicker, { type PickerAt } from './ActionPicker';
import { CommandButton } from './CommandButton';
import { dragged, endDrag } from './dragdrop';
import { stepDone } from './nextStep';
import { rovingKey, useRoving, type Roving } from './roving';
import { useScene, useStore, useStudio } from './store-context';
import { IconButton, Menu, NumberField, type Notify } from './ui';

/** Row heights (px): the time ruler, the shots, each figure, each prop moving, the path camera. */
const ROW = { ruler: 20, shots: 30, figure: 36, prop: 28, camera: 30, layers: 30 };

/** Current playhead: the clock while playing, the document time otherwise. */
export function usePlayhead(clock: Clock) {
  useSyncExternalStore(clock.subscribe, clock.getVersion, clock.getVersion);
  const time = useStudio((s) => s.time);
  return clock.playing ? clock.time : time;
}

/** The stretches a figure does nothing (idle life fills them as the film plays), of a third of a second or more. */
function idleGaps(a: Animation, id: string): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const [s, e] of busySpans(a, id)) {
    if (s - at >= 0.3) out.push([at, s]);
    at = Math.max(at, e);
  }
  if (a.duration - at >= 0.3) out.push([at, a.duration]);
  return out;
}

/** Ruler spacings (seconds), finest first: the finest that keeps ticks (and labels) apart is used. */
/** The timeline bar's buttons for the keyboard: a toolbar (#20). */
// (Not the buttons of its question about shortening, which takes the focus while it is asked.)
const BAR_KEYS: Roving = { items: 'button:not(.tl-ask *)', orientation: 'horizontal' };

/** How near an edge of a zoomed view a drag slides it on (px), and at most how fast (windows a second). */
const EDGE = 32;
const EDGE_SPEED = 1.5;
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
 * Keyframe timeline under the canvas: transport, the shots (the cuts between cameras), a key track
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
  const snapper = (skip: (t: number) => boolean = () => false) => {
    const now = store.scene.animation!;
    const targets = snapping ? [
      store.getState().time,
      ...now.actions.flatMap((x) => [x.start, x.start + x.duration]),
      ...figures.flatMap((f) => moments(now, f.id)),
      ...now.shots.map((x) => x.start),
      ...(now.markers ?? []).map((m) => m.t),
      ...camTimes,
    ].filter((t) => !skip(t)) : [];
    /** Where t lands: on a target within reach (null if none: the frame it is on). */
    const near = (t: number) => {
      const reach = (6 / laneWidth) * view.current.span;
      let best: number | null = null;
      for (const x of targets) if (Math.abs(x - t) <= reach && (best === null || Math.abs(x - t) < Math.abs(best - t))) best = x;
      return best;
    };
    return {
      near,
      /** t, snapped (the line shown where). */
      at: (t: number) => { const x = near(t); setSnapAt(x); return x ?? t; },
      done: () => setSnapAt(null),
    };
  };
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
  const prevKey = [...stops].reverse().find((t) => t < time - 1e-3);
  const nextKey = stops.find((t) => t > time + 1e-3);

  // (While dragging, the scale the drag began with: what is dragged past the end lengthens the film,
  // and the window shown rescales, but the drag keeps to its own; only its auto-scroll moves it on.)
  const dragView = useRef<{ v0: number; span: number } | null>(null);
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const v = dragView.current ?? view.current;
    return v.v0 + ((clientX - r.left) / r.width) * v.span;
  };
  /**
   * While something is dragged along the lanes of a zoomed view: near an edge the window slides on,
   * faster the nearer, and the drag goes on with the time now under the pointer. Returns the stop.
   */
  const follow = (x0: number, move: (ev: { clientX: number }) => void) => {
    let x = x0;
    let last = 0;
    dragView.current = { v0: view.current.v0, span: view.current.span };
    const at = (ev: PointerEvent) => { x = ev.clientX; };
    let raf = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const v = view.current;
      const el = track.current;
      if (v.zoomed && el) {
        const r = el.getBoundingClientRect();
        const d = x < r.left + EDGE ? -(r.left + EDGE - x) : x > r.right - EDGE ? x - (r.right - EDGE) : 0;
        if (d) {
          const by = Math.sign(d) * Math.min(1, Math.abs(d) / EDGE) ** 2 * EDGE_SPEED * v.span * dt;
          const start = Math.min(Math.max(0, v.v0 + by), v.total - v.span);
          if (Math.abs(start - v.v0) > 1e-9) {
            view.current = { ...v, v0: start };
            dragView.current = { v0: start, span: v.span };
            setZoom({ start, span: v.span });
            move({ clientX: x });
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('pointermove', at, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', at, true); dragView.current = null; };
  };
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

  const scrub = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    seek(timeAt(e.clientX));
    const move = (ev: { clientX: number }) => seek(timeAt(ev.clientX));
    const stop = follow(e.clientX, move);
    const up = () => { stop(); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  /**
   * Drag one figure's key along its track to retime it (the other figures keep their timing).
   * With Shift (or from a walk, run or jump bar) the keys after it come along: a pause put in or
   * taken out. A click without moving just goes there.
   */
  const dragKey = (t: number, figureId: string, rippleAlways = false) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    if (figureId !== store.getState().activeFigure) store.setActiveFigure(figureId);
    // Keys picked together (Shift-click, or a Shift-drag box on the row) move together.
    const group = !e.shiftKey && keyPick?.figure === figureId && keyPick.times.length > 1 && keyPick.times.some((x) => Math.abs(x - t) < 0.5 / a.fps) ? keyPick.times : null;
    if (!group && !e.shiftKey && keyPick) setPicked(null);
    const shift = e.shiftKey && !rippleAlways;
    let dragged = false;
    const ripple = rippleAlways || e.shiftKey;
    // On the window: the key's button is re-created as its time changes during the drag.
    const el = window;
    let from = t;
    store.setTime(t);
    // Keys elsewhere to line up with (other figures', props', the camera's, the cuts): a punch
    // lands as the other flinches.
    const others = [
      ...Object.values(a.props ?? {}).flatMap((keys) => keys.map((k) => k.t)),
    ].filter((x) => Math.abs(x - t) > 1e-6);
    const snap = snapper((x) => Math.abs(x - t) < 1e-6);
    const move = (ev: { clientX: number }) => {
      let to = snapTime(a, timeAt(ev.clientX));
      const near = snap.near(to) ?? (snapping ? others.find((x) => Math.abs(x - to) < (6 / laneWidth) * view.current.span) : undefined);
      setSnapAt(near ?? null);
      if (near !== undefined && near !== null) to = near;
      if (Math.abs(to - from) < 1e-6) return;
      dragged = true;
      if (group) {
        const by = to - from;
        if (moveKeyframes(store, figureId, group.map((x) => x + (from - t)), by, `keys:${figureId}`)) {
          from = to;
          store.setTime(to);
          setPicked({ figure: figureId, times: group.map((x) => x + (to - t)) });
        }
        return;
      }
      if (ripple) rippleKeys(store, figureId, from, to - from, `ripple:${figureId}`);
      else moveKeyframe(store, from, to, figureId);
      const now = moments(store.scene.animation!, figureId).find((k) => Math.abs(k - to) < 0.5 / a.fps);
      if (now !== undefined) {
        from = now;
        store.setTime(now);
      }
    };
    const stop = follow(e.clientX, move);
    const up = () => {
      stop();
      snap.done();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      // A Shift-click (no drag) adds the key to those picked, or takes it out.
      if (shift && !dragged) {
        const had = keyPick?.figure === figureId ? keyPick.times : [];
        const on = had.some((x) => Math.abs(x - t) < 0.5 / a.fps);
        const times = on ? had.filter((x) => Math.abs(x - t) >= 0.5 / a.fps) : [...had, t];
        setPicked(times.length ? { figure: figureId, times } : null);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  /** Drag the end of the picked keys' span (#22): their timing scaled from the first, as far as no key is passed. */
  const scaleKeys = (figureId: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !keyPick || keyPick.times.length < 2) return;
    e.stopPropagation();
    pause();
    const start = [...keyPick.times].sort((p, q) => p - q);
    const [first, last] = [start[0], start[start.length - 1]];
    let now = start;
    const snap = snapper((x) => start.some((t) => Math.abs(t - x) < 1e-6));
    const move = (ev: { clientX: number }) => {
      const end = Math.max(first + 1 / a.fps, snap.at(timeAt(ev.clientX)));
      const k = (end - first) / Math.max(1e-6, last - first);
      const to = start.map((t) => first + (t - first) * k);
      now = retimeKeys(store, figureId, now, to, `scale:${figureId}`);
      setPicked({ figure: figureId, times: now });
    };
    const stop = follow(e.clientX, move);
    const up = () => { stop(); snap.done(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /**
   * Shift-drag along a row's empty stretch: a box picking the keys in it, and the blocks in it on
   * every row it is drawn across (#22).
   */
  const boxKeys = (figureId: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !e.shiftKey) return;
    e.stopPropagation();
    const t0 = timeAt(e.clientX);
    const y0 = e.clientY;
    let y = y0;
    // (The people's rows between where it started and the pointer, top to bottom.)
    const across = () => [...(root.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
      .filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > Math.min(y0, y) && b.top <= Math.max(y0, y); })
      .map((r) => r.dataset.row!);
    const move = (ev: { clientX: number; clientY?: number }) => {
      if (ev.clientY !== undefined) y = ev.clientY;
      setBox({ figure: figureId, rows: across(), t0, t1: timeAt(ev.clientX) });
    };
    const stop = follow(e.clientX, move);
    const up = (ev: PointerEvent) => {
      stop();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBox(null);
      y = ev.clientY;
      const [lo, hi] = [Math.min(t0, timeAt(ev.clientX)), Math.max(t0, timeAt(ev.clientX))];
      const anim = store.scene.animation!;
      const times = keyTimesOf(anim, figureId).filter((x) => x >= lo - 1e-6 && x <= hi + 1e-6);
      setPicked(times.length ? { figure: figureId, times } : null);
      // The blocks it covers (not corrections: they go with what they correct), picked together.
      const rows = across();
      const blocks = anim.actions.filter((x) => x.layer !== 'correction' && x.source.kind !== 'keys' && x.duration > 1e-6 && x.start < hi - 1e-6 && x.start + x.duration > lo + 1e-6 && x.roles.some((r) => rows.includes(r.figure)));
      if (blocks.length) {
        const [first, ...also] = blocks;
        store.select({ kind: 'action', action: first.id, figure: first.roles.find((r) => rows.includes(r.figure))!.figure, ...(also.length ? { also: also.map((x) => x.id) } : {}) });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** What a drag does to an action, as it goes on (#22): "Trim end · plays 1.20–3.80 s of Jab, cross". */
  const readoutOf = (now: Action, part: 'move' | 'start' | 'end' | 'blend', stretch: boolean, slipping: boolean) => {
    const src = now.source;
    const s2 = (x: number) => `${x.toFixed(2)} s`;
    const t = part === 'start' || part === 'move' ? now.start : part === 'end' ? now.start + now.duration : now.start - (now.blendIn ?? 0);
    if (part === 'blend') return { t, text: `Blend in · ${s2(now.blendIn ?? 0)}` };
    const whole = src.kind === 'clip' ? clipById(src.clip) : null;
    if (src.kind === 'clip' && whole && !loopsOf(src) && (slipping || (part !== 'move' && !stretch && !now.layer))) {
      const verb = slipping ? 'Slip' : part === 'start' ? 'Trim start' : 'Trim end';
      return { t, text: `${verb} · plays ${(src.from ?? 0).toFixed(2)}–${s2(src.to ?? whole.duration)} of ${whole.name}` };
    }
    if (part === 'move') return { t, text: `Starts at ${s2(now.start)}` };
    if (src.kind === 'clip' && stretch) return { t, text: `Stretch · ${(src.speed ?? 1).toFixed(2)}× · ${s2(now.duration)}` };
    return { t, text: `${part === 'start' ? 'Starts at' : 'Length'} ${s2(part === 'start' ? now.start : now.duration)}` };
  };

  /**
   * Drag an action along its row (what everyone in it does after comes along; Ctrl: slip, another
   * part of its motion played there), an edge to trim it (#22; Alt: stretch it, its speed), or the
   * ramp before it to blend into it over longer; a click picks it for the inspector.
   */
  const dragAction = (act: Action, figureId: string, part: 'move' | 'start' | 'end' | 'blend') => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    const [x0, t0] = [e.clientX, timeAt(e.clientX)];
    const [start, duration, blend] = [act.start, act.duration, act.blendIn ?? 0];
    const key = `act:${act.id}:${part}`;
    const [stretch, slipping, adding] = [e.altKey, (e.ctrlKey || e.metaKey) && part === 'move', e.shiftKey];
    // (Picked with others: they move together, each person's first carrying what follows, #22.)
    const sel = store.getState().selection;
    const group = part === 'move' && sel?.kind === 'action' && sel.also?.length && [sel.action, ...sel.also].includes(act.id)
      ? [sel.action, ...sel.also].map((id) => a.actions.find((x) => x.id === id)!).filter(Boolean).sort((p, q) => p.start - q.start)
      : null;
    const leads = group?.filter((x, i) => !group.slice(0, i).some((y) => y.roles.some((r) => x.roles.some((q) => q.figure === r.figure))));
    let moved = false;
    let slipped = 0;
    const back = store.getState().time;
    let y = e.clientY;
    const mine = new Set((group ?? [act]).flatMap((x) => [x.start, x.start + x.duration]));
    const snap = snapper((x) => [...mine].some((m) => Math.abs(m - x) < 1e-6));
    const move = (ev: { clientX: number; clientY?: number }) => {
      if (ev.clientY !== undefined) y = ev.clientY;
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      const said = () => { const now = store.scene.animation?.actions.find((x) => x.id === act.id); if (now) setReadout(readoutOf(now, part, stretch, slipping)); };
      queueMicrotask(said);
      moved = true;
      let dt = timeAt(ev.clientX) - t0;
      // (Its start, or else its end, onto what is near; an edge onto what is near it.)
      if (part === 'move' && !slipping) {
        const s0 = snap.near(start + dt);
        const s1 = s0 === null ? snap.near(start + duration + dt) : null;
        dt = s0 !== null ? s0 - start : s1 !== null ? s1 - start - duration : dt;
        setSnapAt(s0 ?? s1);
      } else if (part === 'end') dt = snap.at(start + duration + dt) - start - duration;
      else if (part === 'start') dt = snap.at(start + dt) - start;
      // (A slip goes on from where the last move left it.)
      if (slipping) { slip(store, act.id, -(dt - slipped), key); slipped = dt; }
      else if (leads) store.group(() => leads.forEach((x) => moveAction(store, x.id, x.start + dt, `${key}:${x.id}`)));
      else if (part === 'move') moveAction(store, act.id, start + dt, key);
      else if (part === 'end' && (stretch || act.layer === 'correction')) retime(store, act.id, duration + dt, key);
      else if (part === 'end') trim(store, act.id, 'end', start + duration + dt, key);
      else if (part === 'start') trim(store, act.id, 'start', start + dt, key);
      else setBlend(store, act.id, blend - dt, key);
      // (What is dragged shows on the canvas meanwhile, #23: the pose at the edge, or at the start of a slipped motion.)
      if (part === 'start' || part === 'end' || slipping) {
        const now = store.scene.animation?.actions.find((x) => x.id === act.id);
        if (now) store.setTime(part === 'end' ? now.start + now.duration - 1e-3 : now.start);
      }
    };
    const stop = follow(e.clientX, move);
    const up = (ev: PointerEvent) => {
      stop();
      snap.done();
      setReadout(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) {
        // (The playhead back where it was, after showing what was dragged.)
        if (part === 'start' || part === 'end' || slipping) store.setTime(back);
        // Let go over another person's row: it is theirs now (Ctrl: a copy for them), #22.
        const row = part === 'move' && !leads ? (document.elementFromPoint(ev.clientX, y) as HTMLElement | null)?.closest<HTMLElement>('[data-row]')?.dataset.row : undefined;
        if (row && row !== figureId && act.roles.length === 1 && !act.layer) {
          const why = giveAction(store, act.id, row, ev.ctrlKey || ev.metaKey);
          if (why) notify(why);
        }
        return;
      }
      const now = store.getState().selection;
      // Shift-click: picked with the others (or let go of), #22.
      if (adding && now?.kind === 'action' && now.action !== act.id) {
        const others = now.also ?? [];
        const next = others.includes(act.id) ? others.filter((id) => id !== act.id) : [...others, act.id];
        store.select({ kind: 'action', action: now.action, figure: now.figure, ...(next.length ? { also: next } : {}) });
        return;
      }
      store.select({ kind: 'action', action: act.id, figure: figureId });
      // (A click on one of its repeats goes to that repeat, #23.)
      const n = act.source.kind === 'clip' ? act.source.repeat ?? 1 : 1;
      seek(act.start + (act.duration / n) * Math.min(n - 1, Math.max(0, Math.floor(((t0 - act.start) / act.duration) * n))));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drag a point of the row's camera to retime it; a click goes to it. */
  const dragPoint = (t: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    seek(t);
    const cam = rowCam.id;
    let from = t;
    const key = `campoint:${t}`;
    const move = (ev: { clientX: number }) => {
      const to = snapTime(a, timeAt(ev.clientX));
      if (Math.abs(to - from) < 1e-6) return;
      retimeCameraPoint(store, from, to, key, cam);
      const moved = cameraById(store.scene, cam);
      const now = moved?.kind === 'path' ? moved.points.map((p) => p.t).find((x) => Math.abs(x - to) < 0.5 / a.fps) : undefined;
      if (now !== undefined) {
        from = now;
        store.setTime(now);
      }
    };
    const stop = follow(e.clientX, move);
    const up = () => { stop(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drag a cut (a shot's start) to move it, or the ramp after it to set how long the shot blends in. */
  const dragCut = (sp: ShotSpan, part: 'cut' | 'blend') => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    const key = `${part}:${sp.shot.id}`;
    const snap = snapper((x) => Math.abs(x - sp.start) < 1e-6);
    const move = (ev: { clientX: number }) => {
      const t = part === 'cut' ? snap.at(timeAt(ev.clientX)) : timeAt(ev.clientX);
      if (part === 'cut') moveShotCut(store, sp.shot.id, t, key);
      else {
        const now = shotSpans(store.scene.animation!).find((x) => x.shot.id === sp.shot.id)!;
        editShot(store, sp.shot.id, { blend: Math.min(now.end - now.start, Math.max(0, snapTime(a, t) - now.start)) });
      }
    };
    const stop = follow(e.clientX, move);
    const up = () => { stop(); snap.done(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drag a marker along the ruler (snapping as any drag); a click goes to it (#22). */
  const dragMarker = (id: string, t: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    const x0 = e.clientX;
    let moved = false;
    const snap = snapper((x) => Math.abs(x - t) < 1e-6);
    const move = (ev: { clientX: number }) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      editMarker(store, id, { t: snap.at(timeAt(ev.clientX)) }, `marker:${id}`);
    };
    const stop = follow(e.clientX, move);
    const up = () => {
      stop();
      snap.done();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) seek(t);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** Drag an end of the in / out range along the ruler (#22). */
  const dragRange = (end: 'from' | 'to') => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !a.range) return;
    e.stopPropagation();
    pause();
    const snap = snapper();
    const move = (ev: { clientX: number }) => {
      const now = store.scene.animation?.range;
      if (!now) return;
      const t = snap.at(timeAt(ev.clientX));
      setRange(store, end === 'from' ? { from: Math.min(t, now.to - 0.1), to: now.to } : { from: now.from, to: Math.max(t, now.from + 0.1) }, 'range-drag');
    };
    const stop = follow(e.clientX, move);
    const up = () => { stop(); snap.done(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const renameMarker = (id: string, name: string) => {
    const next = window.prompt('Marker name', name)?.trim();
    if (next) editMarker(store, id, { name: next });
  };

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
          onFocus={() => setKeysHere(true)}
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
            <div className="tl-ruler">
              {ticks.map((t) => {
                const text = label(t);
                return (
                  <span key={t} className={text ? 'tick major' : 'tick'} style={{ left: pct(t) }} aria-hidden>
                    {text && <em>{text}</em>}
                  </span>
                );
              })}
              {a.range && (
                <span className="tl-range" style={{ left: pct(a.range.from), width: `${((a.range.to - a.range.from) / span) * 100}%` }} data-tip="Playback goes round this stretch: drag its ends; X (timeline focused) or the timeline's menu plays all of it">
                  <i className="tl-range-end" onPointerDown={(e) => dragRange('from')(e)} />
                  <i className="tl-range-end out" onPointerDown={(e) => dragRange('to')(e)} />
                </span>
              )}
              {markers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`tl-marker${m.color ? ` ${m.color}` : ''}`}
                  style={{ left: pct(m.t) }}
                  aria-label={`Marker ${m.name} at ${m.t.toFixed(2)} s`}
                  data-tip={`${m.name}: drag to move, double-click (or F2) to rename\nRight-click for more`}
                  onPointerDown={dragMarker(m.id, m.t)}
                  onDoubleClick={() => renameMarker(m.id, m.name)}
                  onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); renameMarker(m.id, m.name); } }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openContextMenu(e, [
                      { label: 'Rename…', icon: Pencil, onSelect: () => renameMarker(m.id, m.name) },
                      // (Its colour, to tell kinds of beat apart.)
                      { group: 'Colour' },
                      ...[undefined, ...MARKER_COLORS].map((c) => ({ label: c ? c[0].toUpperCase() + c.slice(1) : 'Blue', radio: true, checked: m.color === c, onSelect: () => editMarker(store, m.id, { color: c ?? null }) })),
                      '-',
                      { label: 'Delete', icon: Trash2, danger: true, onSelect: () => editMarker(store, m.id, null) },
                    ], m.name);
                  }}
                >
                  <span>{m.name}</span>
                </button>
              ))}
              {issues?.map((i, n) => (
                <button
                  key={n}
                  type="button"
                  className="tl-issue"
                  style={{ left: pct(i.start), width: `max(4px, ${(i.end - i.start) / span * 100}%)` }}
                  data-tip={i.message}
                  aria-label={`${ISSUE_LABELS[i.kind]} at ${i.start.toFixed(2)} s: ${i.message}`}
                  onPointerDown={(e) => { e.stopPropagation(); goTo(i); }}
                />
              ))}
            </div>
            <div className="tl-row shots" aria-label="Shots">
              {spans.map((sp) => {
                const on = time >= sp.start - 1e-6 && (time < sp.end - 1e-6 || sp.index === spans.length - 1);
                return (
                  <button
                    key={sp.shot.id}
                    type="button"
                    className={`tl-shot${on ? ' on' : ''}`}
                    style={{ left: pct(sp.start), width: `${((sp.end - sp.start) / span) * 100}%` }}
                    data-tip={`${sp.shot.name}${sp.shot.caption ? ` — ${sp.shot.caption}` : ''} (click to edit in the inspector)\nRight-click for more`}
                    onPointerDown={(e) => { if (e.button) return; e.stopPropagation(); seek(sp.start); store.select({ kind: 'shot', shot: sp.shot.id }); }}
                    onContextMenu={(e) => {
                      store.select({ kind: 'shot', shot: sp.shot.id });
                      openContextMenu(e, menu('shot', { store, shot: sp.shot.id }), sp.shot.name);
                    }}
                    // A camera move dragged from the Library: onto this shot.
                    onDragOver={(e) => { if (dragged()?.shot) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
                    onDrop={(e) => { const d = dragged(); if (!d?.shot) return; e.preventDefault(); endDrag(); d.shot(sp.shot.id); }}
                  >
                    {sp.index > 0 && (
                      <>
                        <i
                          className={`tl-blend${sp.shot.blend ? '' : ' none'}`}
                          style={sp.shot.blend ? { width: `${Math.min(100, (sp.shot.blend / (sp.end - sp.start)) * 100)}%` } : undefined}
                          data-tip={`Blend in from the shot before${sp.shot.blend ? ` over ${sp.shot.blend.toFixed(2)} s` : ''}: drag right for longer`}
                          onPointerDown={dragCut(sp, 'blend')}
                        />
                        <i className="tl-cut" data-tip="Drag to move the cut" onPointerDown={dragCut(sp, 'cut')} />
                      </>
                    )}
                    {/* Taken over by hand: the director keeps it as it is. */}
                    {sp.shot.pinned && scene.coverage?.live && <Pin size={11} aria-label="Taken over by hand" />}
                    <span style={inSight(sp.start, sp.end)}>{sp.shot.name}{cameraById(scene, sp.shot.camera) ? ` · ${cameraById(scene, sp.shot.camera)!.name}` : ''}</span>
                    <em>{(sp.end - sp.start).toFixed(1)}s</em>
                  </button>
                );
              })}
            </div>
            {figures.map((f) => {
              const times = keyTimesOf(a, f.id);
              const eases = keyEasesOf(a, f.id);
              const tight = dense(times);
              return (
                <div
                  key={f.id}
                  data-row={f.id}
                  className={`tl-row${multi && f.id === active?.id ? ' active' : ''}${keying === f.id && !f.proxy ? ' autokey' : ''}${f.muted ? ' muted' : ''}${f.locked ? ' locked' : ''}${unfolded.has(f.id) ? ' unfolded' : ''}`}
                  aria-label={multi ? `${f.name} keys` : 'Pose keys'}
                  onPointerDown={boxKeys(f.id)}
                  // A pose or a motion from the Library: onto this figure, at the time it is dropped at.
                  onDragOver={(e) => {
                    const d = dragged();
                    if (!d?.figure || f.proxy) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    const t = snapTime(a, timeAt(e.clientX));
                    if (dropAt?.figure !== f.id || dropAt.t !== t) setDropAt({ figure: f.id, t, length: d.length });
                  }}
                  // (Not when it only passes over a block or a key of the row.)
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null); }}
                  onDrop={(e) => {
                    const d = dragged();
                    setDropAt(null);
                    if (!d?.figure || f.proxy) return;
                    e.preventDefault();
                    endDrag();
                    pause();
                    store.setTime(snapTime(a, timeAt(e.clientX)));
                    d.figure(f.id);
                  }}
                  onContextMenu={(e) => {
                    // How the figure gets from one key (or mark) to the next, for the stretch under the pointer.
                    const at = timeAt(e.clientX);
                    const next = moments(a, f.id).find((k) => k > at + 1e-6 && (travelInto(a, f.id, k) || keyAtTime(a, f.id, k)));
                    if (next === undefined || next === times[0]) { e.preventDefault(); return; }
                    store.setActiveFigure(f.id);
                    openContextMenu(e, menuItems(['travel.how', 'travel.facing', 'travel.height', 'travel.turns'], { store, figure: f.id, at: next }), `${f.name} · to ${next.toFixed(2)} s`);
                  }}
                >
                  {/* What it does next, from the playhead (under the blocks: one there takes the click). */}
                  {!f.proxy && time >= v0 - 1e-6 && time <= v1 + 1e-6 && (
                    <button
                      type="button"
                      className="tl-add"
                      style={{ left: pct(time) }}
                      aria-label={`What ${f.name} does next, from ${time.toFixed(2)} s`}
                      data-tip={`What ${f.name} does next, from here`}
                      data-tip-side="top"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => openPicker(f.id, e.currentTarget)}
                    >
                      <Plus size={12} aria-hidden />
                    </button>
                  )}
                  {/* What it does next after all it does: the playhead goes there first. */}
                  {!f.proxy && (() => {
                    const last = Math.max(0, ...[...actionsOf(a, f.id), ...actionsOf(a, f.id, 'upper')].map((x) => x.start + x.duration));
                    if (last < v0 - 1e-6 || last > v1 + 1e-6 || Math.abs(last - time) < 0.5 / a.fps) return null;
                    return (
                      <button
                        type="button"
                        className="tl-add"
                        style={{ left: pct(last) }}
                        aria-label={`What ${f.name} does after all it does, from ${last.toFixed(2)} s`}
                        data-tip={`What ${f.name} does after all it does`}
                        data-tip-side="top"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { pause(); store.setTime(last); openPicker(f.id, e.currentTarget); }}
                      >
                        <Plus size={12} aria-hidden />
                      </button>
                    );
                  })()}
                  {[...actionsOf(a, f.id), ...actionsOf(a, f.id, 'upper')].filter((x) => x.duration > 1e-6).map((x) => {
                    const label = actionLabel(x, scene);
                    const kind = x.layer === 'upper' ? 'upper' : x.source.kind === 'travel' ? x.source.mode : x.source.kind;
                    const group = x.roles.length > 1;
                    return (
                      <span key={x.id} className="tl-block">
                        {!x.layer && x.source.kind !== 'keys' && (
                          <span
                            className={`tl-ramp ${kind}${x.blendIn ? '' : ' none'}`}
                            style={{ left: pct(x.start - (x.blendIn ?? 0)), width: `${((x.blendIn ?? 0) / span) * 100}%` }}
                            data-tip={`Blend into ${label}${x.blendIn ? ` over ${x.blendIn.toFixed(2)} s` : ''}: drag left for longer`}
                            onPointerDown={dragAction(x, f.id, 'blend')}
                            // How the blend goes (#23).
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const now = x.blendCurve ?? 'smooth';
                              openContextMenu(e, ([['smooth', 'Smoothly'], ['linear', 'Evenly'], ['in', 'Easing in'], ['out', 'Easing out']] as const).map(([v, label]) => ({
                                label, checked: now === v, radio: true, onSelect: () => setBlendCurve(store, x.id, v === 'smooth' ? null : v),
                              })), `Blend into ${label}`);
                            }}
                          />
                        )}
                        <span
                          className={`tl-travel grab ${kind}${group ? ' group' : ''}${isPicked(x.id) ? ' sel' : ''}${(() => { const px = (x.duration / span) * laneWidth; return px < 12 ? ' tiny' : px < 28 ? ' tight' : ''; })()}`}
                          style={{ left: pct(x.start), width: `${(x.duration / span) * 100}%` }}
                          data-tip={`${label}${x.layer === 'upper' ? ` (upper body, over what ${f.name} is doing)` : ''}${group ? ` with ${x.roles.filter((r) => r.figure !== f.id).map((r) => figures.find((g) => g.id === r.figure)?.name).join(', ')}` : ''}: click or double-click to edit, drag to move it (and what follows)${x.source.kind === 'clip' ? ', Ctrl-drag to play another part of it there' : ''}; ${x.source.kind === 'travel' ? 'its right edge: how long it takes' : 'its edges trim it, Alt-drag one to stretch it'}; Delete removes it\nRight-click for more`}
                          onPointerDown={dragAction(x, f.id, 'move')}
                          onDoubleClick={() => { pause(); store.select({ kind: 'action', action: x.id, figure: f.id }); }}
                          onContextMenu={(e) => {
                            e.stopPropagation();
                            store.setActiveFigure(f.id);
                            openContextMenu(e, menu('action', { store, action: x.id, figure: f.id }), `${f.name} · ${label}`);
                          }}
                        >
                          {group && <Users size={11} aria-hidden />}
                          {/* Kept on the blow it reacts to (#23). */}
                          {x.reactsTo && <LinkIcon size={11} aria-label="Kept on its blow" />}
                          <span style={inSight(x.start, x.start + x.duration)}>{label}{x.layer === 'upper' ? ' · upper body' : ''}</span>
                          {/* Its repeats, each a segment (#23). */}
                          {(() => {
                            const n = x.source.kind === 'clip' ? x.source.repeat ?? 1 : 1;
                            return Array.from({ length: n - 1 }, (_, k) => <i key={`lap${k}`} className="tl-lap" style={{ left: `${((k + 1) / n) * 100}%` }} aria-hidden />);
                          })()}
                          {x.source.kind !== 'travel' && <i className="tl-edge start" aria-hidden onPointerDown={dragAction(x, f.id, 'start')} />}
                          <i className="tl-edge" aria-hidden onPointerDown={dragAction(x, f.id, 'end')} />
                        </span>
                      </span>
                    );
                  })}
                  {unfolded.has(f.id) && <span className="tl-layer-names" aria-hidden><em>Upper body</em><em>Corrections</em></span>}
                  {/* Nothing to do yet: where to start. */}
                  {!actionsOf(a, f.id).some((x) => x.source.kind !== 'keys') && times.length <= 1 && !f.proxy && (
                    <button type="button" className="tl-empty" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openPicker(f.id, e.currentTarget)}>
                      <Plus size={13} aria-hidden /> Add an action
                    </button>
                  )}
                  {keyPick?.figure === f.id && keyPick.times.length > 1 && (() => {
                    const [lo, hi] = [Math.min(...keyPick.times), Math.max(...keyPick.times)];
                    return (
                      <span className="tl-keyspan" style={{ left: pct(lo), width: `${((hi - lo) / span) * 100}%` }} aria-hidden>
                        <i className="tl-keyspan-end" data-tip="Drag to stretch or squeeze the picked keys' timing" onPointerDown={(e) => scaleKeys(f.id)(e)} />
                      </span>
                    );
                  })()}
                  {box && (box.rows.includes(f.id) || box.figure === f.id) && <span className="tl-box" style={{ left: pct(Math.min(box.t0, box.t1)), width: `${(Math.abs(box.t1 - box.t0) / span) * 100}%` }} aria-hidden />}
                  {dropAt?.figure === f.id && (
                    <span className="tl-drop" style={{ left: pct(dropAt.t), width: dropAt.length ? `${(dropAt.length / span) * 100}%` : undefined }} aria-hidden />
                  )}
                  {events.filter((ev) => ev.figure === f.id).map((ev, n) => (
                    <span key={`ev${n}`} className={`tl-event ${ev.kind}`} style={{ left: pct(ev.t) }} data-tip={ev.title} aria-hidden />
                  ))}
                  {/* The gaps where it has idle life as the film plays (breathing, a look round). */}
                  {!f.proxy && !f.still && idleGaps(a, f.id).map(([t0, t1]) => (
                    <span key={`idle${t0}`} className="tl-idle" style={{ left: pct(t0), width: `${((t1 - t0) / span) * 100}%` }} aria-hidden>
                      <span style={inSight(t0, t1)}>idle</span>
                    </span>
                  ))}
                  {actionsOf(a, f.id, 'correction').filter((x) => x.duration > 1e-6).map((x) => (
                    // A correction: its own thin band over what it corrects; its right edge retimes it.
                    <span
                      key={x.id}
                      className={`tl-fixband${isPicked(x.id) ? ' sel' : ''}`}
                      style={{ left: pct(x.start), width: `${(x.duration / span) * 100}%` }}
                      data-tip="A correction over a motion or a walk: click to edit it, drag its right edge to retime it"
                      onPointerDown={(e) => { if (e.button) return; e.stopPropagation(); pause(); store.select({ kind: 'action', action: x.id, figure: f.id }); }}
                      // Its menu (#23): held over the whole motion, or only around its edits; deleted.
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const whole = correctionHeld(x);
                        openContextMenu(e, [
                          { label: 'Over the whole motion', checked: whole, onSelect: () => setCorrectionThroughout(store, x.id, !whole) },
                          ...(repeatedUnder(a, x) ? [{ label: 'On every repeat', icon: Repeat, onSelect: () => correctEveryRepeat(store, x.id) }] : []),
                          { label: 'Delete the correction', icon: Trash2, danger: true, onSelect: () => deleteAction(store, x.id) },
                        ], `${f.name} · correction`);
                      }}
                    >
                      <i className="tl-edge" aria-hidden onPointerDown={dragAction(x, f.id, 'end')} />
                    </span>
                  ))}
                  {correctionTimesOf(a, f.id).map((t) => (
                    <button
                      key={`fix${t}`}
                      type="button"
                      className={`tl-key fix${near(t) ? ' on' : ''}`}
                      style={{ left: pct(t) }}
                      aria-label={`${multi ? `${f.name} correction` : 'Correction'} at ${t.toFixed(2)} s`}
                      data-tip="A correction made over a motion or a walk: click to go to it"
                      onPointerDown={(e) => { if (e.button) return; e.stopPropagation(); seek(t); store.setActiveFigure(f.id); }}
                      onContextMenu={(e) => {
                        e.stopPropagation();
                        seek(t);
                        openContextMenu(e, [{ label: 'Delete correction', icon: Trash2, danger: true, onSelect: () => deleteCorrection(store, f.id, t) }], `${f.name} · ${t.toFixed(2)} s`);
                      }}
                    />
                  ))}
                  {times.map((t, n) => {
                    // How it goes on to the next: a hollow diamond at an even speed, a square held.
                    const ease = eases.get(t);
                    return (
                    <button
                      key={t}
                      type="button"
                      className={`tl-key${near(t) ? ' on' : ''}${tight[n] ? ' dense' : ''}${ease && ease !== 'smooth' ? ` ${ease}` : ''}${keyPick?.figure === f.id && keyPick.times.some((x) => Math.abs(x - t) < 0.5 / a.fps) ? ' picked' : ''}`}
                      style={{ left: pct(t) }}
                      aria-label={`${multi ? `${f.name} key` : 'Key'} at ${t.toFixed(2)} s`}
                      data-tip={`${ease === 'step' ? 'Held until the next key. ' : ease === 'linear' ? 'Goes on at an even speed. ' : ''}Drag to retime; Shift-drag to move the keys after it too; Shift-click to pick several (then drag them together)\nRight-click for more`}
                      onPointerDown={dragKey(t, f.id)}
                      onContextMenu={(e) => {
                        e.stopPropagation();
                        seek(t);
                        store.setActiveFigure(f.id);
                        openContextMenu(e, menu('key', { store, figure: f.id, at: t }), `${f.name} · ${t.toFixed(2)} s`);
                      }}
                    />
                    );
                  })}
                </div>
              );
            })}
            {moving.map((p) => {
              const times = propKeyTimes(a, p.id);
              const tight = dense(times);
              return (
                <div key={p.id} className="tl-row" aria-label={`${p.name} keys`}>
                  {propBars(scene, p.id).map((b, i) => (
                    <span key={`${i}:${b.t0}`} className={`tl-travel ${b.kind}`} style={{ left: pct(b.t0), width: `${((b.t1 - b.t0) / span) * 100}%` }} data-tip={b.label}>
                      <span style={inSight(b.t0, b.t1)}>{b.label}</span>
                    </span>
                  ))}
                  {times.map((t, n) => (
                    <button
                      key={t}
                      type="button"
                      className={`tl-key prop${near(t) ? ' on' : ''}${tight[n] ? ' dense' : ''}`}
                      style={{ left: pct(t) }}
                      aria-label={`${p.name} key at ${t.toFixed(2)} s`}
                      onPointerDown={(e) => { if (e.button) return; e.stopPropagation(); seek(t); store.select({ kind: 'prop', prop: p.id }); }}
                      onContextMenu={(e) => {
                        e.stopPropagation();
                        seek(t);
                        openContextMenu(e, [{
                          label: 'Delete key', icon: Trash2, danger: true,
                          onSelect: () => store.updateScene((s) => (s.animation ? { ...s, animation: removePropKey(s.animation, t, p.id) } : s)),
                        }], `${p.name} · ${t.toFixed(2)} s`);
                      }}
                    />
                  ))}
                </div>
              );
            })}
            {cameraRow && <div className="tl-row camera" aria-label={`${rowCam.name} track`}>
              {spans.filter((sp) => sp.shot.camera !== rowCam.id).map((sp) => (
                <span key={sp.shot.id} className="tl-dim" style={{ left: pct(sp.start), width: `${((sp.end - sp.start) / span) * 100}%` }} data-tip={`${sp.shot.name} is filmed by another camera`} aria-hidden />
              ))}
              {camTimes.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`tl-key cam${near(t) ? ' on' : ''}`}
                  style={{ left: pct(t) }}
                  aria-label={`${rowCam.name} point at ${t.toFixed(2)} s`}
                  data-tip={`A point of ${rowCam.name}’s path: drag to retime it`}
                  onPointerDown={dragPoint(t)}
                  onContextMenu={(e) => {
                    seek(t);
                    openContextMenu(e, menu('camera', { store, camera: rowCam.id, at: t }), `${rowCam.name} · ${t.toFixed(2)} s`);
                  }}
                />
              ))}
            </div>}
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


/** The stretches of a prop's time, read-only: in someone's hand, or flying. */
function propBars(scene: Scene, id: string) {
  const name = (fid?: string) => scene.figures.find((f) => f.id === fid)?.name ?? 'a hand';
  return propStretchesOf(scene, id).flatMap((x) => (x.kind === 'held'
    ? [{ t0: x.t0, t1: x.t1, kind: 'held', label: `${name(x.figure)}'s hand` }]
    : x.kind === 'free' ? [{ t0: x.t0, t1: x.t1, kind: 'throw', label: 'Free' }] : []));
}
