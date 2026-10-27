'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Activity, Camera, ChevronDown, ChevronUp, Clapperboard, Diamond, Scissors, TriangleAlert, X, Ellipsis, Ghost, MoveHorizontal, Pause, Play, Repeat, Repeat1,
  StepBack, StepForward, Trash2, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  addKeyframe, cutShot, deleteAction, deleteCameraKey, deleteKeyframe, moveKeyframe, removeAnimation, rippleKeys, setAnimationOptions, setCameraKey,
} from '@/lib/actions';
import { snapTime } from '@/lib/animation';
import { clipById } from '@/lib/assets';
import { actionsOf } from '@/lib/evaluate';
import { propKeyTimes, propTrack, removePropKey } from '@/lib/propmotion';
import { JUMP_PREP, jumpHeight } from '@/lib/locomotion';
import { keyAtTime, keyTimesOf, moments, travelInto } from '@/lib/track';
import { ISSUE_LABELS, checkMotion, type Issue } from '@/lib/qa';
import { overLimit, shotSpans, videoModel } from '@/lib/shots';
import type { Animation, CameraKey, Figure } from '@/lib/types';
import { startPlayback, type Clock } from './clock';
import { openContextMenu } from './ContextMenu';
import { figureMenu, shotMenu, travelMenu } from './menus';
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
 * Keyframe timeline under the canvas: transport, the shots, a key track per figure (and per prop
 * that moves), and the shot camera's keys. Editing a figure at any time records a key there
 * (auto-key). It zooms (Ctrl + wheel, the buttons) and scrolls (Shift + wheel, the bar under it),
 * folds down to its toolbar, and its top edge drags to make it taller.
 */
export default function Timeline({ clock, shotMode, setShotMode, onion, setOnion, captureShot, notify, notifyUndo }: {
  clock: Clock;
  shotMode: boolean;
  setShotMode(on: boolean): void;
  onion: boolean;
  setOnion(on: boolean): void;
  captureShot(): Omit<CameraKey, 't'> | null;
  notify: Notify;
  notifyUndo(text: string): void;
}) {
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
  const figures = scene.figures;
  const multi = figures.length > 1;
  const active = figures.find((f) => f.id === activeId) ?? figures[0];
  const activeKeys = active ? keyTimesOf(a, active.id) : [];
  const stops = active ? moments(a, active.id) : moments(a);
  const near = (t: number) => Math.abs(t - time) < 0.5 / a.fps;
  const onKey = activeKeys.some(near);
  const cam = a.camera;
  const spans = shotSpans(a);
  const onCamKey = !!cam?.keys.some((k) => Math.abs(k.t - time) < 0.5 / a.fps);
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
      ...(a.camera?.keys.map((k) => k.t) ?? []),
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
  const moving = scene.props.filter((p) => propKeyTimes(a, p.id).length > 0);
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
        <IconButton icon={Clapperboard} label="Look through the shot camera" tipSide="top" active={shotMode} pressed={shotMode} onClick={() => setShotMode(!shotMode)} />
        <IconButton
          icon={Camera}
          label={onCamKey ? 'Update camera key' : 'Set camera key from the view'}
          tipSide="top"
          active={onCamKey}
          onClick={() => {
            const shot = captureShot();
            if (!shot) return;
            setCameraKey(store, shot);
            if (!shotMode) setShotMode(true);
            notify('Camera key set');
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
            '-',
            { label: 'Delete camera key', icon: Trash2, disabled: !onCamKey, onSelect: () => deleteCameraKey(store) },
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
            <span aria-hidden>Camera</span>
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
                    {over && <TriangleAlert size={11} aria-hidden />}
                    <span style={inSight(sp.start, sp.end)}>{sp.shot.name}</span>
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
                  {actionBars(a, f.id).map((b) => (
                    <span
                      key={b.id}
                      className={`tl-travel grab ${b.kind}`}
                      style={{ left: pct(b.t0), width: `${((b.t1 - b.t0) / span) * 100}%` }}
                      title={b.kind === 'clip'
                        ? `${b.label}: drag to move it (and what follows), right-click to remove it`
                        : `${b.label}: drag to move it (and what follows), right-click to change how ${f.name} gets there`}
                      onPointerDown={dragKey(b.t0, f.id, true)}
                      onContextMenu={b.kind === 'clip' ? (e) => {
                        e.stopPropagation();
                        store.setActiveFigure(f.id);
                        openContextMenu(e, [{ label: `Remove ${b.label}`, icon: Trash2, danger: true, onSelect: () => deleteAction(store, b.id) }], `${f.name} · ${b.label}`);
                      } : undefined}
                    >
                      <span style={inSight(b.t0, b.t1)}>{b.label}</span>
                    </span>
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
                  {propBars(a, p.id, figures).map((b) => (
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
            <div className="tl-row camera" aria-label="Camera keyframes">
              {cam?.keys.map((k) => (
                <button
                  key={k.t}
                  type="button"
                  className={`tl-key cam${Math.abs(k.t - time) < 0.5 / a.fps ? ' on' : ''}`}
                  style={{ left: pct(k.t) }}
                  aria-label={`Camera key at ${k.t.toFixed(2)} s`}
                  onPointerDown={(e) => { e.stopPropagation(); seek(k.t); }}
                  onContextMenu={(e) => {
                    seek(k.t);
                    openContextMenu(e, [{ label: 'Delete camera key', icon: Trash2, danger: true, onSelect: () => deleteCameraKey(store) }], `Camera · ${k.t.toFixed(2)} s`);
                  }}
                />
              ))}
              {!cam?.keys.length && <span className="tl-empty">No camera moves yet: frame a view and press the camera key, or pick a move</span>}
            </div>
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


/** A figure's walks, runs, jumps and motions, labelled for the timeline. */
function actionBars(a: Animation, id: string) {
  return actionsOf(a, id).flatMap((x) => {
    const src = x.source;
    const [t0, t1] = [x.start, x.start + x.duration];
    if (src.kind === 'clip') return [{ id: x.id, t0, t1, kind: 'clip', label: clipById(src.clip)?.name ?? 'Motion' }];
    if (src.kind !== 'travel') return [];
    let label = src.mode === 'walk' ? 'Walk' : src.mode === 'run' ? 'Run' : 'Jump';
    if (src.mode === 'jump') {
      label += ` ${jumpHeight(Math.max(0, x.duration - 2 * JUMP_PREP)).toFixed(1)} m`;
      if (src.spin) label += ` · ${src.spin === 0.5 ? '½' : src.spin} turn${Math.abs(src.spin) > 1 ? 's' : ''}`;
      if (src.flip) label += src.flip > 0 ? ' · front flip' : ' · back flip';
    } else if (src.strafe) label += ' · keep facing';
    return [{ id: x.id, t0, t1, kind: src.mode as string, label }];
  });
}

/** The stretches of a prop's track: in a hand, or flying (thrown). */
function propBars(a: Animation, id: string, figures: Figure[]) {
  const track = propTrack(a, id);
  const bars: { t0: number; t1: number; kind: string; label: string }[] = [];
  const name = (fid: string) => figures.find((f) => f.id === fid)?.name ?? 'a hand';
  for (let i = 1; i < track.length; i++) {
    const prev = track[i - 1];
    const k = track[i];
    if (k.throw) bars.push({ t0: track[i - 1].t, t1: track[i].t, kind: 'throw', label: k.hold ? `To ${name(k.hold.figure)}` : 'Thrown' });
    else if (prev.hold && !k.release) bars.push({ t0: track[i - 1].t, t1: track[i].t, kind: 'held', label: `${name(prev.hold.figure)}'s hand` });
  }
  return bars;
}
