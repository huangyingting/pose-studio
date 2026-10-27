'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Activity, Camera, ChevronDown, ChevronUp, Clapperboard, Diamond, Scissors, TriangleAlert, X, Ellipsis, Ghost, MoveHorizontal, Pause, Play, Repeat, Repeat1,
  Grid3x3, StepBack, StepForward, Trash2, Users, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  addKeyframe, cutShot, deleteCameraPoint, deleteCorrection, deleteKeyframe, moveAction, moveKeyframe, removeAnimation, retime, retimeCameraPoint, rippleKeys, setAnimationOptions,
  editShot, moveShotCut, setBlend, setCameraPoint,
} from '@/lib/actions';
import { snapTime } from '@/lib/animation';
import { actionsOf, propStretchesOf } from '@/lib/evaluate';
import { propKeyTimes, removePropKey } from '@/lib/propmotion';
import { actionLabel, correctionTimesOf, keyAtTime, keyTimesOf, moments, travelInto } from '@/lib/track';
import { ISSUE_LABELS, checkMotion, type Issue } from '@/lib/qa';
import { overLimit, shotSpans, videoModel, type ShotSpan } from '@/lib/shots';
import { cameraById, liveCamera, rigRule, type CameraView } from '@/lib/cameras';
import type { Action, Animation, Scene } from '@/lib/types';
import { startPlayback, type Clock } from './clock';
import { openContextMenu } from './ContextMenu';
import { actionMenu, cameraMenu, figureMenu, shotMenu, travelMenu } from './menus';
import { useScene, useStore, useStudio } from './store-context';
import { IconButton, Menu, NumberField, type Notify } from './ui';

/** Current playhead: the clock while playing, the document time otherwise. */
export function usePlayhead(clock: Clock) {
  useSyncExternalStore(clock.subscribe, clock.getVersion, clock.getVersion);
  const time = useStudio((s) => s.time);
  return clock.playing ? clock.time : time;
}

const SPEEDS = [0.25, 0.5, 1];
/** Ruler spacings (seconds), finest first: the finest that keeps ticks (and labels) apart is used. */
const TICKS = [1 / 24, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];
const LABELS = [0.25, 0.5, 1, 2, 5, 10, 30, 60];

/**
 * Keyframe timeline under the canvas: transport, the shots (the cuts between cameras), a key track
 * per figure (and per prop that moves), and one camera's track: the selected camera's, or the one
 * filming at the playhead. Editing a figure at any time records a key there
 * (auto-key). It zooms (Ctrl + wheel, the buttons) and scrolls (Shift + wheel, the bar under it),
 * folds down to its toolbar, and its top edge drags to make it taller.
 */
export default function Timeline({ clock, onion, setOnion, captureShot, notify, notifyUndo }: {
  clock: Clock;
  onion: boolean;
  setOnion(on: boolean): void;
  captureShot(): CameraView | null;
  notify: Notify;
  notifyUndo(text: string): void;
}) {
  const store = useStore();
  const scene = useScene();
  const a = scene.animation!;
  const time = usePlayhead(clock);
  const folded = useStudio((s) => s.settings.timelineFolded);
  const height = useStudio((s) => s.settings.timelineHeight);
  const guides = useStudio((s) => s.settings.guides);
  const track = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [laneWidth, setLaneWidth] = useState(600);
  const [width, setWidth] = useState(1000);
  // The canvas (and, on phones, the canvas tools) sit above the timeline, whose height grows with the number of figures.
  useEffect(() => {
    const el = root.current;
    const studio = el?.closest<HTMLElement>('.studio');
    if (!el || !studio) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      studio.style.setProperty('--tl-h', `${Math.ceil(r.height)}px`);
      setWidth(r.width);
    });
    ro.observe(el);
    return () => { ro.disconnect(); studio.style.removeProperty('--tl-h'); };
  }, []);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLaneWidth(Math.max(1, el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [folded]);

  // The stretch of time on show: all of it, or a zoomed-in window (which follows the playhead while playing).
  const [zoom, setZoom] = useState<{ start: number; span: number } | null>(null);
  const span = zoom ? Math.min(zoom.span, a.duration) : a.duration;
  let v0 = zoom ? Math.min(Math.max(0, zoom.start), a.duration - span) : 0;
  if (zoom && clock.playing && (time < v0 || time > v0 + span)) v0 = Math.min(a.duration - span, Math.max(0, v0 + Math.floor((time - v0) / span) * span));
  const v1 = v0 + span;
  const setWindow = (start: number, s: number) => {
    const sp = Math.min(a.duration, Math.max(Math.min(0.5, a.duration), s));
    setZoom(sp >= a.duration - 1e-6 ? null : { start: Math.min(Math.max(0, start), a.duration - sp), span: sp });
  };
  /** Zoom about the playhead: it keeps its place on screen, or the view centres on it. */
  const zoomBy = (factor: number) => {
    const sp = span * factor;
    const t = clock.playing ? clock.time : store.getState().time;
    setWindow(t >= v0 && t <= v1 ? t - ((t - v0) / span) * sp : t - sp / 2, sp);
  };

  const frame = Math.round(time * a.fps);
  // Each figure has its own key track; the key buttons work on the active figure's.
  const activeId = useStudio((st) => st.activeFigure);
  const selected = useStudio((st) => (st.selection?.kind === 'action' ? st.selection.action : null));
  const figures = scene.figures;
  const multi = figures.length > 1;
  const active = figures.find((f) => f.id === activeId) ?? figures[0];
  const activeKeys = active ? keyTimesOf(a, active.id) : [];
  const stops = active ? moments(a, active.id) : moments(a);
  const near = (t: number) => Math.abs(t - time) < 0.5 / a.fps;
  const onKey = activeKeys.some(near);
  const spans = shotSpans(a);
  // The camera row: the selected camera, or the one filming at the playhead.
  const through = useStudio((st) => st.through);
  const picked = useStudio((st) => (st.selection?.kind === 'camera' ? st.selection.camera : null));
  const rowCam = cameraById(scene, picked ?? undefined) ?? liveCamera(scene, time);
  const camTimes = rowCam.kind === 'path' ? rowCam.points.map((p) => p.t) : [];
  const onCamKey = camTimes.some(near);
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
        const sp = Math.min(a.duration, Math.max(Math.min(0.5, a.duration), span * Math.exp(e.deltaY * 0.004)));
        setZoom(sp >= a.duration - 1e-6 ? null : { start: Math.min(Math.max(0, at - ((at - v0) / span) * sp), a.duration - sp), span: sp });
        return;
      }
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      if (!zoom || Math.abs(dx) < Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
      e.preventDefault();
      setZoom({ start: Math.min(Math.max(0, v0 + (dx / el.getBoundingClientRect().width) * span), a.duration - span), span });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [v0, span, zoom, a.duration, folded]);

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
  const keyLabel = `keyframe${multi && active ? ` (${active.name})` : ''}`;
  const qaLabel = checking ? 'Checking…' : issues ? (issues.length ? `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}` : 'No issues') : 'Check';

  return (
    <div className={`timeline${folded ? ' folded' : ''}`} role="region" aria-label="Timeline" ref={root}>
      {!folded && <div className="tl-resize" onPointerDown={resize} onDoubleClick={() => store.setSettings({ timelineHeight: 0 })} title="Drag to make the timeline taller or shorter (double-click: fit)" aria-hidden />}
      <div className="tl-bar">
        <div className="tl-transport">
          <IconButton icon={StepBack} label="Previous keyframe" tipSide="top" className="tl-step" disabled={prevKey === undefined} onClick={() => prevKey !== undefined && seek(prevKey)} />
          <button type="button" className="tl-play" onClick={toggle} aria-label={clock.playing ? 'Pause' : 'Play'} data-tip={clock.playing ? 'Pause  Space' : 'Play  Space'} data-tip-side="top">
            {clock.playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </button>
          <IconButton icon={StepForward} label="Next keyframe" tipSide="top" className="tl-step" disabled={nextKey === undefined} onClick={() => nextKey !== undefined && seek(nextKey)} />
          <span className="tl-time" aria-live="off">
            {time.toFixed(2)}<span className="tl-narrow-hide">/ {a.duration.toFixed(1)} s</span><em className="tl-narrow-hide">F{frame}</em>
          </span>
          <Menu
            label="Playback speed"
            side="top"
            className="btn ghost tl-speed"
            tip="Playback speed"
            items={SPEEDS.map((x) => ({ label: `${x}×${x === 1 ? ' (real time)' : ''}`, checked: speed === x, onSelect: () => clock.setSpeed(x) }))}
          >
            {speed}×
          </Menu>
          {!compact && <IconButton icon={Repeat1} label="Repeat this shot" tipSide="top" active={clock.repeatShot} pressed={clock.repeatShot} onClick={() => clock.setRepeatShot(!clock.repeatShot)} />}
        </div>
        <span className="tl-sep" />
        <button
          type="button"
          className={`btn ghost tl-btn${onKey ? ' on' : ''}`}
          aria-label={`${onKey ? 'Update' : 'Add'} ${keyLabel}`}
          data-tip={`${onKey ? 'Update' : 'Add'} ${keyLabel}  K`}
          data-tip-side="top"
          onClick={() => addKeyframe(store)}
        >
          <Diamond size={15} aria-hidden /> <span className="tl-label">Key</span>
        </button>
        {!compact && (
          <>
            <IconButton icon={Trash2} label={`Delete ${keyLabel}`} tipSide="top" disabled={!onKey || activeKeys.length <= 1} onClick={() => deleteKeyframe(store)} />
            <button type="button" className="btn ghost tl-btn" aria-label="Cut: start a new shot here" data-tip="Cut: start a new shot here  C" data-tip-side="top" onClick={() => cutShot(store)}>
              <Scissors size={15} aria-hidden /> <span className="tl-label">Cut</span>
            </button>
          </>
        )}
        <span className="tl-sep" />
        <div className="tl-duration" data-tip="Length (seconds)" data-tip-side="top">
          <NumberField prefix="⏱" label="Duration" value={a.duration} step={0.1} min={0.2} max={60} digits={1} onChange={(duration) => setAnimationOptions(store, { duration })} />
        </div>
        {!compact && (
          <>
            <span className="tl-sep" />
            <button
              type="button"
              className={`btn ghost tl-qa${issues?.length ? ' warn' : ''}`}
              onClick={check}
              disabled={checking}
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
            <IconButton icon={ZoomOut} label="Zoom out" tipSide="top" disabled={!zoom} onClick={() => zoomBy(2)} />
            <IconButton icon={ZoomIn} label="Zoom in (or Ctrl + wheel)" tipSide="top" disabled={span <= Math.min(0.5, a.duration) + 1e-6} onClick={() => zoomBy(0.5)} />
            <IconButton icon={MoveHorizontal} label="Fit the whole animation" tipSide="top" disabled={!zoom} onClick={() => setZoom(null)} />
            <span className="tl-sep" />
          </span>
        )}
        <IconButton icon={Clapperboard} label="Look through the shot camera" tipSide="top" active={!!through && !through.camera} pressed={!!through && !through.camera} onClick={() => store.lookThrough(through && !through.camera ? null : {})} />
        <IconButton
          icon={Camera}
          label={`${onCamKey ? 'Update' : 'Set'} ${rowCam.name}${rowCam.kind === 'path' ? '’s point' : ''} from the view`}
          tipSide="top"
          active={onCamKey}
          onClick={() => {
            const shot = captureShot();
            if (!shot) return;
            setCameraPoint(store, shot.position, shot.target, shot.fov, '', rowCam.id);
            if (!through) store.lookThrough(picked ? { camera: rowCam.id } : {});
            notify(`${rowCam.name} set from the view`);
          }}
        />
        <Menu
          label="Animation options"
          side="top"
          align="end"
          className="ibtn"
          items={[
            ...(compact ? [
              { label: `Delete ${keyLabel}`, icon: Trash2, disabled: !onKey || activeKeys.length <= 1, onSelect: () => deleteKeyframe(store) },
              { label: 'Cut: start a new shot here', icon: Scissors, shortcut: 'C', onSelect: () => cutShot(store) },
              { label: issues?.length ? `Motion check: ${qaLabel}` : 'Check the motion', icon: issues?.length ? TriangleAlert : Activity, disabled: checking, onSelect: check },
              { label: 'Repeat this shot', icon: Repeat1, checked: clock.repeatShot, onSelect: () => clock.setRepeatShot(!clock.repeatShot) },
              '-' as const,
            ] : []),
            { label: 'Loop the animation', icon: Repeat, checked: a.loop, onSelect: () => setAnimationOptions(store, { loop: !a.loop }) },
            { label: 'Onion skin (ghosts of the keys either side)', icon: Ghost, checked: onion, onSelect: () => setOnion(!onion) },
            { label: 'Framing guides (thirds, safe areas)', icon: Grid3x3, checked: guides, onSelect: () => store.setSettings({ guides: !guides }) },
            '-',
            { label: `Delete ${rowCam.name}’s point`, icon: Trash2, disabled: !onCamKey || camTimes.length <= 1, onSelect: () => deleteCameraPoint(store, time, rowCam.id) },
            { label: 'Remove animation', icon: Trash2, danger: true, onSelect: () => { pause(); removeAnimation(store); } },
          ]}
        >
          <Ellipsis size={16} aria-hidden />
        </Menu>
        <IconButton
          icon={folded ? ChevronUp : ChevronDown}
          label={folded ? 'Show the tracks' : 'Fold the timeline'}
          tipSide="top"
          onClick={() => store.setSettings({ timelineFolded: !folded })}
        />
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
                onContextMenu={(e) => openContextMenu(e, figureMenu(store, f.id, { notify, notifyUndo }), f.name)}
                title={`${f.name}: keys and retiming apply to this figure`}
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
              onContextMenu={(e) => openContextMenu(e, cameraMenu(store, rowCam.id, { notifyUndo }), rowCam.name)}
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
                const over = overLimit(a, sp);
                return (
                  <button
                    key={sp.shot.id}
                    type="button"
                    className={`tl-shot${on ? ' on' : ''}${over ? ' over' : ''}`}
                    style={{ left: pct(sp.start), width: `${((sp.end - sp.start) / span) * 100}%` }}
                    title={`${sp.shot.name}${sp.shot.caption ? ` — ${sp.shot.caption}` : ''} (click to edit in the inspector)${over ? `\nLonger than ${videoModel(a.target)!.name} allows (${videoModel(a.target)!.max} s)` : ''}`}
                    onPointerDown={(e) => { if (e.button) return; e.stopPropagation(); seek(sp.start); store.select({ kind: 'shot', shot: sp.shot.id }); }}
                    onContextMenu={(e) => {
                      store.select({ kind: 'shot', shot: sp.shot.id });
                      openContextMenu(e, shotMenu(store, sp.shot.id, { notify, notifyUndo }), sp.shot.name);
                    }}
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
                  className={`tl-row${multi && f.id === active?.id ? ' active' : ''}`}
                  aria-label={multi ? `${f.name} keyframes` : 'Pose keyframes'}
                  onContextMenu={(e) => {
                    // How the figure gets from one key (or mark) to the next, for the stretch under the pointer.
                    const at = timeAt(e.clientX);
                    const next = moments(a, f.id).find((k) => k > at + 1e-6 && (travelInto(a, f.id, k) || keyAtTime(a, f.id, k)));
                    if (next === undefined || next === times[0]) { e.preventDefault(); return; }
                    store.setActiveFigure(f.id);
                    openContextMenu(e, travelMenu(store, f.id, next), `${f.name} · to ${next.toFixed(2)} s`);
                  }}
                >
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
                          title={`${label}${x.layer === 'upper' ? ` (upper body, over what ${f.name} is doing)` : ''}${group ? ` with ${x.roles.filter((r) => r.figure !== f.id).map((r) => figures.find((g) => g.id === r.figure)?.name).join(', ')}` : ''}: click to edit, drag to move it (and what follows), its right edge to retime it; right-click for more`}
                          onPointerDown={dragAction(x, f.id, 'move')}
                          onContextMenu={(e) => {
                            e.stopPropagation();
                            store.setActiveFigure(f.id);
                            openContextMenu(e, actionMenu(store, x.id, f.id), `${f.name} · ${label}`);
                          }}
                        >
                          {group && <Users size={10} aria-hidden />}
                          <span style={inSight(x.start, x.start + x.duration)}>{label}{x.layer === 'upper' ? ' · upper body' : ''}</span>
                          <i className="tl-edge" aria-hidden onPointerDown={dragAction(x, f.id, 'end')} />
                        </span>
                      </span>
                    );
                  })}
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
                      title="Drag to retime; Shift-drag to move the keys after it too"
                      onPointerDown={dragKey(t, f.id)}
                      onContextMenu={(e) => {
                        e.stopPropagation();
                        seek(t);
                        store.setActiveFigure(f.id);
                        openContextMenu(e, [
                          ...(n > 0 ? [...travelMenu(store, f.id, t), '-' as const] : []),
                          {
                            label: 'Delete key', icon: Trash2, danger: true, disabled: times.length <= 1,
                            onSelect: () => deleteKeyframe(store, f.id),
                          },
                        ], `${f.name} · ${t.toFixed(2)} s`);
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
                    openContextMenu(e, cameraMenu(store, rowCam.id, { notifyUndo }, t), `${rowCam.name} · ${t.toFixed(2)} s`);
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
            {time >= v0 - 1e-6 && time <= v1 + 1e-6 && <div className="tl-playhead" style={{ left: pct(time) }} aria-hidden />}
          </div>
          {zoom && (
            <ScrollBar
              start={v0 / a.duration}
              size={span / a.duration}
              onScroll={(f) => setZoom({ start: f * a.duration, span })}
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
