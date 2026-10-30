'use client';

import { ChevronRight, Copy, Video } from 'lucide-react';
import { addCamera, editShot, ownCamera } from '@/lib/actions';
import { MOVE_NAMES, SHOT_SIZES, cameraById, sizeOf, viewOf } from '@/lib/cameras';
import { shotSpans } from '@/lib/shots';
import type { Camera, Scene } from '@/lib/types';
import { menu } from '../commands';
import { NameHeader, NumberField, PropertyRow, Segmented, Select, type HeaderChrome } from '../ui';
import type { Target } from './target';

/* A shot's header and sections: see sections.ts for which show when. */

export function ShotHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  const span = t.span!;
  return (
    <NameHeader
      chrome={chrome}
      lead={<span className="shot-no">{span.index + 1}</span>}
      name={span.shot.name}
      label="Shot name"
      onRename={(name) => editShot(t.store, span.shot.id, { name })}
      menu={() => menu('shot', { store: t.store, shot: span.shot.id })}
    />
  );
}

export const shotSummary = (t: Target) => { const span = t.span!; return `${(span.end - span.start).toFixed(1)} s${span.shot.caption ? ` · ${span.shot.caption}` : ''}`; };

/** What happens in it, and how long it is. */
export function ShotPanel({ t }: { t: Target }) {
  const span = t.span!;
  return (
    <>
      <label className="field">
        <span>Caption</span>
        <textarea
          value={span.shot.caption ?? ''}
          aria-label="Shot caption"
          rows={3}
          placeholder="What happens…"
          onChange={(e) => editShot(t.store, span.shot.id, { caption: e.target.value })}
        />
      </label>
      <PropertyRow label="Length">
        <span className="shot-time">
          <strong>{(span.end - span.start).toFixed(1)} s</strong> · {span.start.toFixed(2)}–{span.end.toFixed(2)} s
        </span>
      </PropertyRow>
    </>
  );
}

const NEW = '+new';
const cameraOf = (t: Target) => cameraById(t.scene, t.span!.shot.camera) ?? t.scene.cameras[0];
export const filmedBySummary = (t: Target) => cameraOf(t).name;

/** A camera in a few words as it films a shot from t: "Anna single · MCU · 85 mm · Arc". */
function cameraSummary(scene: Scene, cam: Camera, t: number) {
  const view = cam.kind === 'rig' ? null : viewOf(scene, cam, t);
  const size = cam.kind === 'rig' ? cam.rig.size : sizeOf(scene, cam, t, view!);
  const lens = Math.round(cam.kind === 'rig' ? cam.rig.lens : view!.lens);
  const moves = cam.kind === 'rig' ? (cam.rig.move ? MOVE_NAMES[cam.rig.move.kind] : 'Holds') : cam.points.length > 1 ? 'Path' : 'Still';
  return [cam.name, SHOT_SIZES.find((x) => x.id === size)?.short, `${lens} mm`, moves].filter(Boolean).join(' · ');
}

/** Which camera films a shot and how it comes in (a cut or a blend); the camera's settings are its own inspector's. */
export function FilmedByPanel({ t }: { t: Target }) {
  const { store, scene } = t;
  const span = t.span!;
  const shot = span.shot;
  const cam = cameraOf(t);
  const also = shotSpans(scene.animation!).filter((s) => s.shot.id !== shot.id && s.shot.camera === cam.id);
  return (
    <>
      <div className="field">
        <span>Camera</span>
        <Select<string>
          label="Shot camera"
          value={cam.id}
          onChange={(v) => {
            if (v !== NEW) return editShot(store, shot.id, { camera: v });
            const now = store.getState().time;
            if (now < span.start - 1e-6 || now >= span.end - 1e-6) store.setTime(span.start);
            addCamera(store);
          }}
          options={[
            ...scene.cameras.map((c) => ({ value: c.id, label: c.name })),
            { value: NEW, label: 'New camera from the view' },
          ]}
        />
      </div>
      <button type="button" className="summary-row" onClick={() => store.select({ kind: 'camera', camera: cam.id })} data-tip="Open the camera">
        <span>{cameraSummary(scene, cam, span.start + (shot.blend ?? 0))}</span>
        <ChevronRight size={14} aria-hidden />
      </button>
      {span.index > 0 && (
        <div className="field">
          <span>Comes in</span>
          <div className="lens-row">
            <Segmented<'cut' | 'blend'>
              label="Comes in"
              full
              value={shot.blend ? 'blend' : 'cut'}
              onChange={(v) => editShot(store, shot.id, { blend: v === 'blend' ? Math.min(1, (span.end - span.start) / 2) : 0 })}
              options={[{ value: 'cut', label: 'Cut' }, { value: 'blend', label: 'Blend' }]}
            />
            {!!shot.blend && <NumberField prefix="s" label="Blend time" value={shot.blend} step={0.1} min={0.1} max={10} digits={1} onChange={(v) => editShot(store, shot.id, { blend: v })} />}
          </div>
        </div>
      )}
      {also.length > 0 && (
        <PropertyRow label="Shared" info={`${cam.name} also films ${also.map((s) => s.shot.name).join(', ')}: changing it changes those too.`}>
          <button type="button" className="btn subtle" onClick={() => ownCamera(store, shot.id)}><Copy size={13} aria-hidden /> Own camera</button>
        </PropertyRow>
      )}
      <button type="button" className="btn subtle" onClick={() => { store.setTime(span.start); store.select({ kind: 'camera', camera: cam.id }); }}>
        <Video size={14} aria-hidden /> Choose a camera move…
      </button>
    </>
  );
}
