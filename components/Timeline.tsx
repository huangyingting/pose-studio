'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Activity, Camera, Clapperboard, Diamond, Scissors, TriangleAlert, X, Ellipsis, Ghost, Pause, Play, Repeat, StepBack, StepForward, Trash2,
} from 'lucide-react';
import {
  addKeyframe, cutShot, deleteCameraKey, deleteKeyframe, moveKeyframe, removeAnimation, setAnimationOptions, setCameraKey,
} from '@/lib/actions';
import { figureKeyTimes, snapTime } from '@/lib/animation';
import { ISSUE_LABELS, checkMotion, type Issue } from '@/lib/qa';
import { overLimit, shotSpans, videoModel } from '@/lib/shots';
import type { Animation, CameraKey } from '@/lib/types';
import type { Clock } from './clock';
import { openContextMenu } from './ContextMenu';
import { figureMenu, shotMenu } from './menus';
import { useScene, useStore, useStudio } from './store-context';
import { IconButton, Menu, NumberField, type Notify } from './ui';

/** Current playhead: the clock while playing, the document time otherwise. */
export function usePlayhead(clock: Clock) {
  useSyncExternalStore(clock.subscribe, clock.getVersion, clock.getVersion);
  const time = useStudio((s) => s.time);
  return clock.playing ? clock.time : time;
}

/**
 * Keyframe timeline under the canvas: transport, pose keys and the shot camera's keys.
 * Editing a figure at any time records a key there (auto-key).
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
  const track = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // The canvas (and, on phones, the canvas tools) sit above the timeline, whose height grows with the number of figures.
  useEffect(() => {
    const el = root.current;
    const studio = el?.closest<HTMLElement>('.studio');
    if (!el || !studio) return;
    const ro = new ResizeObserver(() => studio.style.setProperty('--tl-h', `${Math.ceil(el.getBoundingClientRect().height)}px`));
    ro.observe(el);
    return () => { ro.disconnect(); studio.style.removeProperty('--tl-h'); };
  }, []);
  const frame = Math.round(time * a.fps);
  // Each figure has its own key track; the key buttons work on the active figure's.
  const activeId = useStudio((st) => st.activeFigure);
  const figures = scene.figures;
  const multi = figures.length > 1;
  const active = figures.find((f) => f.id === activeId) ?? figures[0];
  const activeKeys = active ? figureKeyTimes(a, active.id) : a.keys.map((k) => k.t);
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
    clock.pause();
    store.setTime(clock.time);
  };
  const toggle = () => {
    if (clock.playing) pause();
    else {
      clock.set(store.getState().time);
      clock.play(() => {
        const an = store.scene.animation;
        return an ? { duration: an.duration, loop: an.loop } : null;
      }, (t) => store.setTime(t));
    }
  };
  const seek = (t: number) => {
    pause();
    store.setTime(snapTime(a, t));
  };
  const prevKey = [...activeKeys].reverse().find((t) => t < time - 1e-3);
  const nextKey = activeKeys.find((t) => t > time + 1e-3);

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * a.duration;
  };
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
  /** Drag one figure's key along its track to retime it (the other figures keep their timing). */
  const dragKey = (t: number, figureId: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    if (figureId !== store.getState().activeFigure) store.setActiveFigure(figureId);
    // On the window: the key's button is re-created as its time changes during the drag.
    const el = window;
    let from = t;
    store.setTime(t);
    const move = (ev: PointerEvent) => {
      const to = snapTime(a, timeAt(ev.clientX));
      if (Math.abs(to - from) < 1e-6) return;
      moveKeyframe(store, from, to, figureId);
      if (figureKeyTimes(store.scene.animation!, figureId).some((k) => Math.abs(k - to) < 0.5 / a.fps)) {
        from = to;
        store.setTime(to);
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

  const pct = (t: number) => `${(t / a.duration) * 100}%`;
  // Ruler, shots, one row per figure (taller when there is just one), camera.
  const rows = `18px 24px ${multi ? figures.map(() => '24px').join(' ') : '26px'} 26px`;
  const ticks = Array.from({ length: Math.floor(a.duration / 0.5) + 1 }, (_, i) => i * 0.5);

  return (
    <div className="timeline" role="region" aria-label="Timeline" ref={root}>
      <div className="tl-bar">
        <div className="tl-transport">
          <IconButton icon={StepBack} label="Previous keyframe" tipSide="top" disabled={prevKey === undefined} onClick={() => prevKey !== undefined && seek(prevKey)} />
          <button type="button" className="tl-play" onClick={toggle} aria-label={clock.playing ? 'Pause' : 'Play'} data-tip={clock.playing ? 'Pause  Space' : 'Play  Space'} data-tip-side="top">
            {clock.playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </button>
          <IconButton icon={StepForward} label="Next keyframe" tipSide="top" disabled={nextKey === undefined} onClick={() => nextKey !== undefined && seek(nextKey)} />
          <span className="tl-time" aria-live="off">
            {time.toFixed(2)}<span>/ {a.duration.toFixed(1)} s</span><em>F{frame}</em>
          </span>
        </div>
        <span className="tl-sep" />
        <IconButton
          icon={Diamond}
          label={`${onKey ? 'Update' : 'Add'} keyframe${multi && active ? ` (${active.name})` : ''}`}
          shortcut="K"
          tipSide="top"
          active={onKey}
          onClick={() => addKeyframe(store)}
        />
        <IconButton
          icon={Trash2}
          label={`Delete keyframe${multi && active ? ` (${active.name})` : ''}`}
          tipSide="top"
          disabled={!onKey || activeKeys.length <= 1}
          onClick={() => deleteKeyframe(store)}
        />
        <IconButton icon={Scissors} label="Cut: start a new shot here" shortcut="C" tipSide="top" onClick={() => cutShot(store)} />
        <span className="tl-sep" />
        <IconButton icon={Repeat} label="Loop" tipSide="top" active={a.loop} pressed={a.loop} onClick={() => setAnimationOptions(store, { loop: !a.loop })} />
        <IconButton icon={Ghost} label="Onion skin" tipSide="top" active={onion} pressed={onion} onClick={() => setOnion(!onion)} />
        <div className="tl-duration" data-tip="Length (seconds)" data-tip-side="top">
          <NumberField prefix="⏱" label="Duration" value={a.duration} step={0.1} min={0.2} max={60} digits={1} onChange={(duration) => setAnimationOptions(store, { duration })} />
        </div>
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
          <span className="hide-sm">{checking ? 'Checking…' : issues ? (issues.length ? `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}` : 'No issues') : 'Check'}</span>
        </button>
        <span className="spacer" />
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
            { label: 'Delete camera key', icon: Trash2, disabled: !onCamKey, onSelect: () => deleteCameraKey(store) },
            '-',
            { label: 'Remove animation', icon: Trash2, danger: true, onSelect: () => { pause(); removeAnimation(store); } },
          ]}
        >
          <Ellipsis size={16} aria-hidden />
        </Menu>
      </div>

      <div className="tl-tracks">
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
              {f.name}
            </button>
          )) : <span aria-hidden>Pose</span>}
          <span aria-hidden>Camera</span>
        </div>
        <div className="tl-lanes" ref={track} onPointerDown={scrub} style={{ gridTemplateRows: rows }}>
        <div className="tl-ruler">
          {ticks.map((t) => (
            <span key={t} className={Number.isInteger(t) ? 'tick major' : 'tick'} style={{ left: pct(t) }} aria-hidden>
              {Number.isInteger(t) && <em>{t}s</em>}
            </span>
          ))}
          {issues?.map((i, n) => (
            <button
              key={n}
              type="button"
              className="tl-issue"
              style={{ left: pct(i.start), width: `max(4px, ${pct(i.end - i.start)})` }}
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
                style={{ left: pct(sp.start), width: pct(sp.end - sp.start) }}
                title={`${sp.shot.name}${sp.shot.caption ? ` — ${sp.shot.caption}` : ''} (click to edit in the inspector)${over ? `\nLonger than ${videoModel(a.target)!.name} allows (${videoModel(a.target)!.max} s)` : ''}`}
                onPointerDown={(e) => { if (e.button) return; e.stopPropagation(); seek(sp.start); store.select({ kind: 'shot', shot: sp.shot.id }); }}
                onContextMenu={(e) => {
                  store.select({ kind: 'shot', shot: sp.shot.id });
                  openContextMenu(e, shotMenu(store, sp.shot.id, { notify, notifyUndo }), sp.shot.name);
                }}
              >
                {over && <TriangleAlert size={11} aria-hidden />}
                <span>{sp.shot.name}</span>
                <em>{(sp.end - sp.start).toFixed(1)}s</em>
              </button>
            );
          })}
        </div>
        {figures.map((f) => (
          <div key={f.id} className={`tl-row${multi && f.id === active?.id ? ' active' : ''}`} aria-label={multi ? `${f.name} keyframes` : 'Pose keyframes'}>
            {figureKeyTimes(a, f.id).map((t) => (
              <button
                key={t}
                type="button"
                className={`tl-key${near(t) ? ' on' : ''}`}
                style={{ left: pct(t) }}
                aria-label={`${multi ? `${f.name} key` : 'Keyframe'} at ${t.toFixed(2)} s`}
                onPointerDown={dragKey(t, f.id)}
                onContextMenu={(e) => {
                  seek(t);
                  store.setActiveFigure(f.id);
                  openContextMenu(e, [{
                    label: 'Delete key', icon: Trash2, danger: true, disabled: figureKeyTimes(a, f.id).length <= 1,
                    onSelect: () => deleteKeyframe(store, f.id),
                  }], `${f.name} · ${t.toFixed(2)} s`);
                }}
              />
            ))}
          </div>
        ))}
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
        <div className="tl-playhead" style={{ left: pct(time) }} aria-hidden />
        </div>
      </div>
      {issues && issues.length > 0 && qaOpen && <MotionIssues issues={issues} goTo={goTo} onClose={() => setQaOpen(false)} />}
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

