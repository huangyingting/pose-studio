'use client';

import { useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Camera, Clapperboard, ClipboardCopy, Diamond, Ellipsis, Film, Ghost, Pause, Play, Repeat, StepBack, StepForward, Trash2, Video,
} from 'lucide-react';
import {
  addKeyframe, applyCameraMove, deleteCameraKey, deleteKeyframe, moveKeyframe, removeAnimation, setAnimationOptions, setCameraKey,
  setCameraOptions,
} from '@/lib/actions';
import { keyAt, snapTime } from '@/lib/animation';
import { describeShot } from '@/lib/prompt';
import { CAMERA_MOVES } from '@/lib/shot';
import type { CameraKey } from '@/lib/types';
import type { Clock } from './clock';
import { useScene, useStore, useStudio } from './store-context';
import { IconButton, Menu, NumberField } from './ui';

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
export default function Timeline({ clock, shotMode, setShotMode, onion, setOnion, captureShot, onExportVideo, notify }: {
  clock: Clock;
  shotMode: boolean;
  setShotMode(on: boolean): void;
  onion: boolean;
  setOnion(on: boolean): void;
  captureShot(): Omit<CameraKey, 't'> | null;
  onExportVideo(): void;
  notify(text: string): void;
}) {
  const store = useStore();
  const scene = useScene();
  const a = scene.animation!;
  const time = usePlayhead(clock);
  const track = useRef<HTMLDivElement>(null);
  const frame = Math.round(time * a.fps);
  const onKey = keyAt(a, time) >= 0;
  const cam = a.camera;
  const onCamKey = !!cam?.keys.some((k) => Math.abs(k.t - time) < 0.5 / a.fps);

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
  const keyTimes = a.keys.map((k) => k.t);
  const prevKey = [...keyTimes].reverse().find((t) => t < time - 1e-3);
  const nextKey = keyTimes.find((t) => t > time + 1e-3);

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
  /** Drag a pose key along the track to retime it. */
  const dragKey = (t: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let from = t;
    store.setTime(t);
    const move = (ev: PointerEvent) => {
      const to = snapTime(a, timeAt(ev.clientX));
      if (Math.abs(to - from) < 1e-6) return;
      moveKeyframe(store, from, to);
      if (keyAt(store.scene.animation!, to) >= 0) {
        from = to;
        store.setTime(to);
      }
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const pct = (t: number) => `${(t / a.duration) * 100}%`;
  const ticks = Array.from({ length: Math.floor(a.duration / 0.5) + 1 }, (_, i) => i * 0.5);

  return (
    <div className="timeline" role="region" aria-label="Timeline">
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
        <IconButton icon={Diamond} label={onKey ? 'Update keyframe' : 'Add keyframe'} shortcut="K" tipSide="top" active={onKey} onClick={() => addKeyframe(store)} />
        <IconButton icon={Trash2} label="Delete keyframe" tipSide="top" disabled={!onKey || a.keys.length <= 1} onClick={() => deleteKeyframe(store)} />
        <span className="tl-sep" />
        <IconButton icon={Repeat} label="Loop" tipSide="top" active={a.loop} pressed={a.loop} onClick={() => setAnimationOptions(store, { loop: !a.loop })} />
        <IconButton icon={Ghost} label="Onion skin" tipSide="top" active={onion} pressed={onion} onClick={() => setOnion(!onion)} />
        <div className="tl-duration" data-tip="Length (seconds)" data-tip-side="top">
          <NumberField prefix="⏱" label="Duration" value={a.duration} step={0.1} min={0.2} max={60} digits={1} onChange={(duration) => setAnimationOptions(store, { duration })} />
        </div>
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
          label="Camera move"
          side="top"
          align="end"
          className="btn ghost"
          tip="Ready-made camera moves"
          items={CAMERA_MOVES.map((m) => ({ label: m.name, icon: Video, onSelect: () => { applyCameraMove(store, m.id); setShotMode(true); notify(`${m.name}: ${m.description}`); } }))}
        >
          <Video size={15} aria-hidden /> <span className="hide-sm">Camera</span>
        </Menu>
        <Menu
          label="Animation options"
          side="top"
          align="end"
          className="ibtn"
          items={[
            { label: 'Follow the figures', checked: !!cam?.follow, onSelect: () => setCameraOptions(store, { follow: !cam?.follow }) },
            { label: 'Hand-held shake', checked: (cam?.shake ?? 0) > 0, onSelect: () => setCameraOptions(store, { shake: (cam?.shake ?? 0) > 0 ? 0 : 0.5 }) },
            { label: 'Delete camera key', icon: Trash2, disabled: !onCamKey, onSelect: () => deleteCameraKey(store) },
            '-',
            { label: 'Export video…', icon: Film, onSelect: onExportVideo },
            {
              label: 'Copy shot description',
              icon: ClipboardCopy,
              onSelect: () => {
                const text = describeShot(store.scene);
                navigator.clipboard?.writeText(text).then(() => notify('Shot description copied (for AI video tools)'), () => notify(text));
              },
            },
            { label: 'Remove animation', icon: Trash2, danger: true, onSelect: () => { pause(); removeAnimation(store); } },
          ]}
        >
          <Ellipsis size={16} aria-hidden />
        </Menu>
      </div>

      <div className="tl-tracks">
        <div className="tl-labels" aria-hidden>
          <span />
          <span>Pose</span>
          <span>Camera</span>
        </div>
        <div className="tl-lanes" ref={track} onPointerDown={scrub}>
        <div className="tl-ruler" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className={Number.isInteger(t) ? 'tick major' : 'tick'} style={{ left: pct(t) }}>
              {Number.isInteger(t) && <em>{t}s</em>}
            </span>
          ))}
        </div>
        <div className="tl-row" aria-label="Pose keyframes">
          {a.keys.map((k) => (
            <button
              key={k.t}
              type="button"
              className={`tl-key${Math.abs(k.t - time) < 0.5 / a.fps ? ' on' : ''}`}
              style={{ left: pct(k.t) }}
              aria-label={`Keyframe at ${k.t.toFixed(2)} s`}
              onPointerDown={dragKey(k.t)}
            />
          ))}
        </div>
        <div className="tl-row camera" aria-label="Camera keyframes">
          {cam?.keys.map((k) => (
            <button
              key={k.t}
              type="button"
              className={`tl-key cam${Math.abs(k.t - time) < 0.5 / a.fps ? ' on' : ''}`}
              style={{ left: pct(k.t) }}
              aria-label={`Camera key at ${k.t.toFixed(2)} s`}
              onPointerDown={(e) => { e.stopPropagation(); seek(k.t); }}
            />
          ))}
          {!cam?.keys.length && <span className="tl-empty">No camera moves yet: frame a view and press the camera key, or pick a move</span>}
        </div>
        <div className="tl-playhead" style={{ left: pct(time) }} aria-hidden />
        </div>
      </div>
    </div>
  );
}
