'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Activity, Camera, Diamond, Scissors, TriangleAlert, X, Ellipsis, Pause, Play, Plus, Trash2, Users } from 'lucide-react';
import {
  deleteCorrection, moveAction, moveKeyframe, retime, retimeCameraPoint, rippleKeys, setAnimationOptions, cutAnimation, editShot, moveShotCut, setBlend,
} from '@/lib/actions';
import { MAX_DURATION, PAST_END, snapTime } from '@/lib/animation';
import { actionsOf, propStretchesOf } from '@/lib/evaluate';
import { propKeyTimes, removePropKey } from '@/lib/propmotion';
import { actionLabel, correctionTimesOf, keyAtTime, keyTimesOf, moments, travelInto } from '@/lib/track';
import { ISSUE_LABELS, checkMotion, type Issue } from '@/lib/qa';
import { overLimit, shotSpans, videoModel, type ShotSpan } from '@/lib/shots';
import { cameraById, liveCamera, rigRule } from '@/lib/cameras';
import type { Action, Animation, Scene } from '@/lib/types';
import { startPlayback, type Clock } from './clock';
import { openContextMenu } from './ContextMenu';
import { choices, command, menu, menuItems, setApp, tipOf, titleOf, type Ctx } from './commands';
import ActionPicker, { type PickerAt } from './ActionPicker';
import { CommandButton } from './CommandButton';
import { dragged, endDrag } from './dragdrop';
import { stepDone } from './nextStep';
import { useFilm, useScene, useStore, useStudio } from './store-context';
import { IconButton, Menu, NumberField, type Notify } from './ui';

/** Current playhead: the clock while playing, the document time otherwise. */
export function usePlayhead(clock: Clock) {
  useSyncExternalStore(clock.subscribe, clock.getVersion, clock.getVersion);
  const time = useStudio((s) => s.time);
  return clock.playing ? clock.time : time;
}

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
          <Diamond size={15} aria-hidden /> <span className="tl-label">Key</span>
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
            <Plus size={15} aria-hidden /> <span className="tl-label">Add an action</span>
          </button>
        )}
        <span className="tl-sep" />
        <span className="tl-note">A key or an action animates the scene</span>
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
  const setWindow = (start: number, s: number) => {
    const sp = Math.min(total, Math.max(Math.min(0.5, total), s));
    setZoom(sp >= total - 1e-6 ? null : { start: Math.min(Math.max(0, start), total - sp), span: sp });
  };
  /** Zoom about the playhead: it keeps its place on screen, or the view centres on it. */
  const zoomBy = (factor: number) => {
    const sp = span * factor;
    const t = clock.playing ? clock.time : store.getState().time;
    setWindow(t >= v0 && t <= v1 ? t - ((t - v0) / span) * sp : t - sp / 2, sp);
  };

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
  // Auto-key: posing the selected figure keys it at the playhead (shown in red on its row and the playhead).
  const keying = useStudio((st) => (st.selection?.kind === 'figure' || st.selection?.kind === 'joint' ? st.selection.figure : null));
  // A Library item dragged over a row: where (and for how long) it would go.
  const [dropAt, setDropAt] = useState<{ figure: string; t: number; length?: number } | null>(null);
  const figures = scene.figures;
  const multi = figures.length > 1;
  const active = figures.find((f) => f.id === activeId) ?? figures[0];
  const activeKeys = active ? keyTimesOf(a, active.id) : [];
  const stops = active ? moments(a, active.id) : moments(a);
  const near = (t: number) => Math.abs(t - time) < 0.5 / a.fps;
  const onKey = activeKeys.some(near);
  const spans = shotSpans(a);
  // Shots longer than the model the film is cut for are flagged.
  const model = videoModel(useFilm().target);
  // The camera row: the selected camera, or the one filming at the playhead.
  const picked = useStudio((st) => (st.selection?.kind === 'camera' ? st.selection.camera : null));
  const rowCam = cameraById(scene, picked ?? undefined) ?? liveCamera(scene, time);
  const camTimes = rowCam.kind === 'path' ? rowCam.points.map((p) => p.t) : [];
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

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return v0 + ((clientX - r.left) / r.width) * span;
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
    const move = (ev: PointerEvent) => seek(timeAt(ev.clientX));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
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
    const ripple = rippleAlways || e.shiftKey;
    // On the window: the key's button is re-created as its time changes during the drag.
    const el = window;
    let from = t;
    store.setTime(t);
    // Keys elsewhere to line up with (other figures', props', the camera's, the cuts): a punch
    // lands as the other flinches.
    const others = [
      ...figures.filter((f) => f.id !== figureId).flatMap((f) => moments(a, f.id)),
      ...Object.values(a.props ?? {}).flatMap((keys) => keys.map((k) => k.t)),
      ...camTimes,
      ...(a.shots?.map((x) => x.start) ?? []),
    ].filter((x) => Math.abs(x - t) > 1e-6);
    const move = (ev: PointerEvent) => {
      let to = snapTime(a, timeAt(ev.clientX));
      const near = others.find((x) => Math.abs(x - to) < (6 / laneWidth) * span);
      if (near !== undefined) to = near;
      if (Math.abs(to - from) < 1e-6) return;
      if (ripple) rippleKeys(store, figureId, from, to - from, `ripple:${figureId}`);
      else moveKeyframe(store, from, to, figureId);
      const now = moments(store.scene.animation!, figureId).find((k) => Math.abs(k - to) < 0.5 / a.fps);
      if (now !== undefined) {
        from = now;
        store.setTime(now);
      }
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  /**
   * Drag an action along its row (what everyone in it does after comes along), its right edge to
   * retime it, or the ramp before it to blend into it over longer; a click picks it for the inspector.
   */
  const dragAction = (act: Action, figureId: string, part: 'move' | 'end' | 'blend') => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    const [x0, t0] = [e.clientX, timeAt(e.clientX)];
    const [start, duration, blend] = [act.start, act.duration, act.blendIn ?? 0];
    const key = `act:${act.id}:${part}`;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const dt = timeAt(ev.clientX) - t0;
      if (part === 'move') moveAction(store, act.id, start + dt, key);
      else if (part === 'end') retime(store, act.id, duration + dt, key);
      else setBlend(store, act.id, blend - dt, key);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) return;
      store.select({ kind: 'action', action: act.id, figure: figureId });
      seek(act.start);
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
    const move = (ev: PointerEvent) => {
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
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drag a cut (a shot's start) to move it, or the ramp after it to set how long the shot blends in. */
  const dragCut = (sp: ShotSpan, part: 'cut' | 'blend') => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    const key = `${part}:${sp.shot.id}`;
    const move = (ev: PointerEvent) => {
      const t = timeAt(ev.clientX);
      if (part === 'cut') moveShotCut(store, sp.shot.id, t, key);
      else {
        const now = shotSpans(store.scene.animation!).find((x) => x.shot.id === sp.shot.id)!;
        editShot(store, sp.shot.id, { blend: Math.min(now.end - now.start, Math.max(0, snapTime(a, t) - now.start)) });
      }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
  const rowH = multi ? 24 : 26;
  const figureY = (id: string) => 42 + figures.findIndex((f) => f.id === id) * rowH + rowH / 2;
  const propY = (j: number) => 42 + figures.length * rowH + j * 22 + 11;
  const rows = `18px 24px ${multi ? figures.map(() => '24px').join(' ') : '26px'} ${moving.map(() => '22px').join(' ')} 26px`;
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
      {!folded && <div className="tl-resize" onPointerDown={resize} onDoubleClick={() => store.setSettings({ timelineHeight: 0 })} title="Drag to make the timeline taller or shorter (double-click: fit)" aria-hidden />}
      <div className="tl-bar">
        <div className="tl-transport">
          <CommandButton id="timeline.prevKey" ctx={c} tipSide="top" className="tl-step" disabled={prevKey === undefined} />
          <button type="button" className="tl-play" onClick={toggle} aria-label={clock.playing ? 'Pause' : 'Play'} data-tip={tipOf('timeline.play', clock.playing ? 'Pause' : 'Play')} data-tip-side="top">
            {clock.playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
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
          <Diamond size={15} aria-hidden /> <span className="tl-label">Key</span>
        </button>
        {!compact && (
          <>
            <CommandButton id="timeline.deleteKey" ctx={c} tipSide="top" disabled={!onKey || activeKeys.length <= 1} />
            <button type="button" className="btn ghost tl-btn" aria-label={titleOf(command('timeline.cut'), c)} data-tip={tipOf('timeline.cut')} data-tip-side="top" onClick={() => command('timeline.cut').run!(c)}>
              <Scissors size={15} aria-hidden /> <span className="tl-label">Cut</span>
            </button>
          </>
        )}
        <CommandButton id="timeline.cameraPoint" ctx={c} tipSide="top" />
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
              data-tip="Check for foot sliding, interpenetration, joint limits and pops"
              data-tip-side="top"
            >
              {issues?.length ? <TriangleAlert size={15} aria-hidden /> : <Activity size={15} aria-hidden />}
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
          <Ellipsis size={16} aria-hidden />
        </Menu>
        <CommandButton id="timeline.fold" ctx={c} tipSide="top" />
      </div>

      {!folded && (
        <div className="tl-tracks" style={height ? { height, maxHeight: 'none' } : undefined}>
          <div className="tl-labels" style={{ gridTemplateRows: rows }}>
            <span aria-hidden />
            <span aria-hidden>Shots</span>
            {multi ? figures.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`tl-figure${f.id === active?.id ? ' on' : ''}`}
                onClick={() => store.setActiveFigure(f.id)}
                onContextMenu={(e) => openContextMenu(e, menu('figure', { store, figure: f.id }), f.name)}
                data-tip={`${f.name}: keys and retiming apply to this figure\nRight-click for more`}
              >
                {f.color && <span className="tl-dot" style={{ background: f.color }} aria-hidden />}
                {f.name}
              </button>
            )) : (
              <span aria-hidden>
                {active?.color && <span className="tl-dot" style={{ background: active.color }} />}
                {active?.name ?? 'Pose'}
              </span>
            )}
            {moving.map((p) => (
              <button key={p.id} type="button" className="tl-figure tl-prop" onClick={() => store.select({ kind: 'prop', prop: p.id })} title={`${p.name}: carried, thrown and dropped over time`}>
                {p.name}
              </button>
            ))}
            <button
              type="button"
              className={`tl-figure tl-camera${picked ? ' on' : ''}`}
              onClick={() => store.select({ kind: 'camera', camera: rowCam.id })}
              onContextMenu={(e) => openContextMenu(e, menu('camera', { store, camera: rowCam.id }), rowCam.name)}
              title={`${rowCam.name}: ${picked ? 'the camera selected' : 'the camera filming at the playhead'}`}
            >
              <Camera size={11} aria-hidden /> {rowCam.name}
            </button>
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
              {issues?.map((i, n) => (
                <button
                  key={n}
                  type="button"
                  className="tl-issue"
                  style={{ left: pct(i.start), width: `max(4px, ${(i.end - i.start) / span * 100}%)` }}
                  title={i.message}
                  aria-label={`${ISSUE_LABELS[i.kind]} at ${i.start.toFixed(2)} s: ${i.message}`}
                  onPointerDown={(e) => { e.stopPropagation(); goTo(i); }}
                />
              ))}
            </div>
            <div className="tl-row shots" aria-label="Shots">
              {spans.map((sp) => {
                const on = time >= sp.start - 1e-6 && (time < sp.end - 1e-6 || sp.index === spans.length - 1);
                const over = overLimit(sp);
                return (
                  <button
                    key={sp.shot.id}
                    type="button"
                    className={`tl-shot${on ? ' on' : ''}${over ? ' over' : ''}`}
                    style={{ left: pct(sp.start), width: `${((sp.end - sp.start) / span) * 100}%` }}
                    data-tip={`${sp.shot.name}${sp.shot.caption ? ` — ${sp.shot.caption}` : ''} (click to edit in the inspector)${over ? `\nLonger than ${model!.name} allows (${model!.max} s)` : ''}\nRight-click for more`}
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
                          title={`Blend in from the shot before${sp.shot.blend ? ` over ${sp.shot.blend.toFixed(2)} s` : ''}: drag right for longer`}
                          onPointerDown={dragCut(sp, 'blend')}
                        />
                        <i className="tl-cut" title="Drag to move the cut" onPointerDown={dragCut(sp, 'cut')} />
                      </>
                    )}
                    {over && <TriangleAlert size={11} aria-hidden />}
                    <span style={inSight(sp.start, sp.end)}>{sp.shot.name}{cameraById(scene, sp.shot.camera) ? ` · ${cameraById(scene, sp.shot.camera)!.name}` : ''}</span>
                    <em>{(sp.end - sp.start).toFixed(1)}s</em>
                  </button>
                );
              })}
            </div>
            {figures.map((f) => {
              const times = keyTimesOf(a, f.id);
              const tight = dense(times);
              return (
                <div
                  key={f.id}
                  className={`tl-row${multi && f.id === active?.id ? ' active' : ''}${keying === f.id && !f.proxy ? ' autokey' : ''}`}
                  aria-label={multi ? `${f.name} keyframes` : 'Pose keyframes'}
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
                      <Plus size={11} aria-hidden />
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
                        <Plus size={11} aria-hidden />
                      </button>
                    );
                  })()}
                  {[...actionsOf(a, f.id), ...actionsOf(a, f.id, 'upper')].filter((x) => x.duration > 1e-6).map((x) => {
                    const label = actionLabel(x);
                    const kind = x.layer === 'upper' ? 'upper' : x.source.kind === 'travel' ? x.source.mode : x.source.kind;
                    const group = x.roles.length > 1;
                    return (
                      <span key={x.id} className="tl-block">
                        {!x.layer && x.source.kind !== 'keys' && (
                          <span
                            className={`tl-ramp ${kind}${x.blendIn ? '' : ' none'}`}
                            style={{ left: pct(x.start - (x.blendIn ?? 0)), width: `${((x.blendIn ?? 0) / span) * 100}%` }}
                            title={`Blend into ${label}${x.blendIn ? ` over ${x.blendIn.toFixed(2)} s` : ''}: drag left for longer`}
                            onPointerDown={dragAction(x, f.id, 'blend')}
                          />
                        )}
                        <span
                          className={`tl-travel grab ${kind}${group ? ' group' : ''}${selected === x.id ? ' sel' : ''}`}
                          style={{ left: pct(x.start), width: `${(x.duration / span) * 100}%` }}
                          data-tip={`${label}${x.layer === 'upper' ? ` (upper body, over what ${f.name} is doing)` : ''}${group ? ` with ${x.roles.filter((r) => r.figure !== f.id).map((r) => figures.find((g) => g.id === r.figure)?.name).join(', ')}` : ''}: click to edit, drag to move it (and what follows), its right edge to retime it\nRight-click for more`}
                          onPointerDown={dragAction(x, f.id, 'move')}
                          onContextMenu={(e) => {
                            e.stopPropagation();
                            store.setActiveFigure(f.id);
                            openContextMenu(e, menu('action', { store, action: x.id, figure: f.id }), `${f.name} · ${label}`);
                          }}
                        >
                          {group && <Users size={10} aria-hidden />}
                          <span style={inSight(x.start, x.start + x.duration)}>{label}{x.layer === 'upper' ? ' · upper body' : ''}</span>
                          {/* Its menu, on a ⋯ shown while the pointer is over it (always on touch). */}
                          <button
                            type="button"
                            className="tl-more"
                            aria-label={`More for ${label}`}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              store.setActiveFigure(f.id);
                              openContextMenu({ clientX: r.left, clientY: r.bottom }, menu('action', { store, action: x.id, figure: f.id }), `${f.name} · ${label}`);
                            }}
                          >
                            <Ellipsis size={12} aria-hidden />
                          </button>
                          <i className="tl-edge" aria-hidden onPointerDown={dragAction(x, f.id, 'end')} />
                        </span>
                      </span>
                    );
                  })}
                  {/* Nothing to do yet: where to start. */}
                  {!actionsOf(a, f.id).some((x) => x.source.kind !== 'keys') && times.length <= 1 && !f.proxy && (
                    <button type="button" className="tl-empty" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openPicker(f.id, e.currentTarget)}>
                      <Plus size={12} aria-hidden /> Add an action
                    </button>
                  )}
                  {dropAt?.figure === f.id && (
                    <span className="tl-drop" style={{ left: pct(dropAt.t), width: dropAt.length ? `${(dropAt.length / span) * 100}%` : undefined }} aria-hidden />
                  )}
                  {events.filter((ev) => ev.figure === f.id).map((ev, n) => (
                    <span key={`ev${n}`} className={`tl-event ${ev.kind}`} style={{ left: pct(ev.t) }} title={ev.title} aria-hidden />
                  ))}
                  {correctionTimesOf(a, f.id).map((t) => (
                    <button
                      key={`fix${t}`}
                      type="button"
                      className={`tl-key fix${near(t) ? ' on' : ''}`}
                      style={{ left: pct(t) }}
                      aria-label={`${multi ? `${f.name} correction` : 'Correction'} at ${t.toFixed(2)} s`}
                      title="A correction made over a motion or a walk: click to go to it"
                      onPointerDown={(e) => { if (e.button) return; e.stopPropagation(); seek(t); store.setActiveFigure(f.id); }}
                      onContextMenu={(e) => {
                        e.stopPropagation();
                        seek(t);
                        openContextMenu(e, [{ label: 'Delete correction', icon: Trash2, danger: true, onSelect: () => deleteCorrection(store, f.id, t) }], `${f.name} · ${t.toFixed(2)} s`);
                      }}
                    />
                  ))}
                  {times.map((t, n) => (
                    <button
                      key={t}
                      type="button"
                      className={`tl-key${near(t) ? ' on' : ''}${tight[n] ? ' dense' : ''}`}
                      style={{ left: pct(t) }}
                      aria-label={`${multi ? `${f.name} key` : 'Keyframe'} at ${t.toFixed(2)} s`}
                      data-tip={"Drag to retime; Shift-drag to move the keys after it too\nRight-click for more"}
                      onPointerDown={dragKey(t, f.id)}
                      onContextMenu={(e) => {
                        e.stopPropagation();
                        seek(t);
                        store.setActiveFigure(f.id);
                        openContextMenu(e, menu('key', { store, figure: f.id, at: t }), `${f.name} · ${t.toFixed(2)} s`);
                      }}
                    />
                  ))}
                </div>
              );
            })}
            {moving.map((p) => {
              const times = propKeyTimes(a, p.id);
              const tight = dense(times);
              return (
                <div key={p.id} className="tl-row" aria-label={`${p.name} keys`}>
                  {propBars(scene, p.id).map((b) => (
                    <span key={b.t0} className={`tl-travel ${b.kind}`} style={{ left: pct(b.t0), width: `${((b.t1 - b.t0) / span) * 100}%` }} title={b.label}>
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
            <div className="tl-row camera" aria-label={`${rowCam.name} track`}>
              {rowCam.kind === 'rig' && (
                <span className="tl-travel rig" style={{ left: pct(0), width: `${(a.duration / span) * 100}%` }} title={`${rowCam.name} places itself every frame: it ${rigRule(scene, rowCam)}`}>
                  <span style={inSight(0, a.duration)}>{rowCam.name} · {rigRule(scene, rowCam)}</span>
                </span>
              )}
              {spans.filter((sp) => sp.shot.camera !== rowCam.id).map((sp) => (
                <span key={sp.shot.id} className="tl-dim" style={{ left: pct(sp.start), width: `${((sp.end - sp.start) / span) * 100}%` }} title={`${sp.shot.name} is filmed by another camera`} aria-hidden />
              ))}
              {camTimes.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`tl-key cam${near(t) ? ' on' : ''}`}
                  style={{ left: pct(t) }}
                  aria-label={`${rowCam.name} point at ${t.toFixed(2)} s`}
                  title={`A point of ${rowCam.name}’s path: drag to retime it`}
                  onPointerDown={dragPoint(t)}
                  onContextMenu={(e) => {
                    seek(t);
                    openContextMenu(e, menu('camera', { store, camera: rowCam.id, at: t }), `${rowCam.name} · ${t.toFixed(2)} s`);
                  }}
                />
              ))}
            </div>
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
            {time >= v0 - 1e-6 && time <= v1 + 1e-6 && (
              <div
                className={`tl-playhead${keying ? ' autokey' : ''}`}
                style={{ left: pct(time) }}
                title={keying ? `Auto-key: posing ${name(keying)} keys it here` : undefined}
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
      {issues && issues.length > 0 && qaOpen && <MotionIssues issues={issues} goTo={goTo} onClose={() => setQaOpen(false)} />}
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
function MotionIssues({ issues, goTo, onClose }: { issues: Issue[]; goTo(i: Issue): void; onClose(): void }) {
  return (
    <div className="qa-card" role="dialog" aria-label="Motion check" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="shot-editor-head">
        <strong>Motion check · {issues.length} {issues.length === 1 ? 'issue' : 'issues'}</strong>
        <IconButton icon={X} label="Close" onClick={onClose} size={14} />
      </div>
      <ul>
        {issues.map((i, n) => (
          <li key={n}>
            <button type="button" onClick={() => goTo(i)}>
              <span className={`qa-kind ${i.kind}`}>{ISSUE_LABELS[i.kind]}</span>
              <em>{i.start.toFixed(2)}{i.end > i.start ? `–${i.end.toFixed(2)}` : ''} s</em>
              <span className="qa-msg">{i.message}</span>
              {issues.findIndex((x) => x.kind === i.kind) === n && <span className="qa-hint">{i.hint}</span>}
            </button>
          </li>
        ))}
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
