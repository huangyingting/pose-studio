'use client';

import { useState } from 'react';
import { Camera as CameraIcon, Eye, Trash2 } from 'lucide-react';
import { deleteCameraPoint, editCamera, editRig, frameShot, setCameraBody, setLens } from '@/lib/actions';
import { LENSES, SHOT_SIZES, liveCamera, sizeOf, viewOf } from '@/lib/cameras';
import { shotSpans } from '@/lib/shots';
import type { Store } from '@/lib/store';
import type { Camera, CameraRig, PathCamera, Placement, RigCamera, ShotSize } from '@/lib/types';
import { menu } from '../commands';
import { useStudio } from '../store-context';
import { Hint, IconButton, Info, NameHeader, NumberField, PropertyRow, Segmented, Select, Toggle, type HeaderChrome } from '../ui';
import type { Target } from './target';

/* A camera's header and sections: see sections.ts for which show when. */

export function CameraHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  const cam = t.camera!;
  const through = useStudio((st) => st.through?.camera === cam.id);
  return (
    <NameHeader chrome={chrome} lead={<CameraIcon size={15} aria-hidden />} name={cam.name} label="Camera name" onRename={(name) => editCamera(t.store, cam.id, { name })} menu={() => menu('camera', { store: t.store, camera: cam.id })}>
      <IconButton icon={Eye} label="Look through this camera" active={through} pressed={through} onClick={() => t.store.lookThrough(through ? null : { camera: cam.id })} />
    </NameHeader>
  );
}

const filmsOf = (t: Target) => (t.scene.animation ? shotSpans(t.scene.animation).filter((s) => s.shot.camera === t.camera!.id) : []);
const isFirst = (t: Target) => t.scene.cameras[0].id === t.camera!.id;
export const filmsSummary = (t: Target) => {
  const films = filmsOf(t);
  return !t.scene.animation ? (isFirst(t) ? 'The still' : 'Not filming') : films.length ? `${films.length} ${films.length === 1 ? 'shot' : 'shots'}` : 'No shots';
};
export const filmsInfo = (t: Target) => (!t.scene.animation ? 'A still scene is filmed by its first camera; the others are other angles on it.' : 'Pick a camera for a shot in the shot\'s inspector.');

/** The shots it films. */
export function FilmsPanel({ t }: { t: Target }) {
  const films = filmsOf(t);
  if (!t.scene.animation) return <Hint>{isFirst(t) ? 'The still' : 'Another angle on the still'}</Hint>;
  if (!films.length) return <Hint>No shot films with it yet</Hint>;
  return (
    <ul className="side-list" aria-label="Shots it films">
      {films.map((s) => (
        <li key={s.shot.id}>
          <button type="button" onClick={() => { t.store.setTime(s.start); t.store.select({ kind: 'shot', shot: s.shot.id }); }}>
            <span className="shot-no">{s.index + 1}</span>
            <span className="side-list-name">{s.shot.name}</span>
            <em>{s.start.toFixed(1)}–{s.end.toFixed(1)} s</em>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Its shot size and lens: a rig's always; a path's at the playhead, while it is filming (or in a still). */
function framingOf(store: Store, cam: Camera, time: number) {
  const scene = store.scene;
  const a = scene.animation;
  const rig = cam.kind === 'rig' ? cam.rig : null;
  const t = a ? time : 0;
  const live = !a || liveCamera(scene, time).id === cam.id;
  const view = live && !rig ? viewOf(scene, cam, t) : null;
  const size = rig ? rig.size : view ? sizeOf(scene, cam, t, view) : null;
  const lens = rig ? Math.round(rig.lens) : view ? Math.round(view.lens) : null;
  return { rig, size, lens };
}
const subjectOf = (t: Target) => {
  const shown = t.scene.figures.filter((f) => !f.hidden);
  return shown.find((f) => f.id === t.camera!.subject);
};
export const framingSummary = (t: Target) => [subjectOf(t)?.name ?? 'Everyone', SHOT_SIZES.find((x) => x.id === framingOf(t.store, t.camera!, t.time).size)?.short].filter(Boolean).join(' · ');
export const lensSummary = (t: Target) => { const { lens } = framingOf(t.store, t.camera!, t.time); return lens ? `${lens} mm` : 'Not filming now'; };

/** What it films: its subject (and whom with), its shot size, where the subject sits. */
export function FramingPanel({ t }: { t: Target }) {
  const time = useStudio((s) => s.time);
  const [placed, setPlaced] = useState<Placement>('center');
  const cam = t.camera!;
  const { rig, size, lens } = framingOf(t.store, cam, time);
  const place = rig ? rig.place ?? 'center' : placed;
  const set = (patch: Parameters<typeof editCamera>[2]) => editCamera(t.store, cam.id, patch);
  const shown = t.scene.figures.filter((f) => !f.hidden);
  const subject = subjectOf(t)?.id;
  const frame = (to: ShotSize, at: Placement) => (rig ? editRig(t.store, cam.id, { size: to, place: at }) : frameShot(t.store, to, { place: at, camera: cam.id }));
  return (
    <>
      <div className="field">
        <span>Subject</span>
        <Select
          label="Camera subject"
          value={subject ?? 'all'}
          onChange={(v) => set({ subject: v === 'all' ? '' : v })}
          options={[{ value: 'all', label: 'Everyone' }, ...shown.map((f) => ({ value: f.id, label: f.name }))]}
        />
        {subject && shown.length > 1 && (
          // A two-shot (or more): whom it frames with its subject.
          <div className="chips" role="group" aria-label="Frames with">
            {shown.filter((f) => f.id !== subject).map((f) => {
              const on = !!cam.also?.includes(f.id);
              return (
                <button key={f.id} type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={() => set({ also: on ? cam.also!.filter((x) => x !== f.id) : [...(cam.also ?? []), f.id] })}>
                  with {f.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {size && lens ? (
        <>
          <PropertyRow label="Size" info={rig ? 'Kept as the subject moves.' : t.scene.animation ? 'At the playhead: the camera moves to frame it.' : undefined}>
            <Select<ShotSize> label="Shot size" value={size} onChange={(x) => frame(x, place)} options={SHOT_SIZES.map((x) => ({ value: x.id, label: `${x.short} · ${x.name}` }))} />
          </PropertyRow>
          <PropertyRow label="Place">
            <Segmented<Placement>
              label="Subject in the frame"
              full
              value={place}
              onChange={(p) => { setPlaced(p); frame(size, p); }}
              options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]}
            />
          </PropertyRow>
        </>
      ) : (
        <Hint>Move the playhead into a shot it films to frame it</Hint>
      )}
    </>
  );
}

/** Its lens: changed keeping the subject's size (the camera moves) or keeping the camera put (a zoom). */
export function LensPanel({ t }: { t: Target }) {
  const time = useStudio((s) => s.time);
  const [zoom, setZoom] = useState(false);
  const cam = t.camera!;
  const { rig, lens } = framingOf(t.store, cam, time);
  if (!lens) return <Hint>Move the playhead into a shot it films to set its lens</Hint>;
  const setLensTo = (mm: number, key?: string) => (rig ? editRig(t.store, cam.id, { lens: mm }) : setLens(t.store, mm, zoom ? 'place' : 'size', key, cam.id));
  return (
    <>
      <div className="field">
        <span>Lens</span>
        <div className="lens-row">
          <Select<string>
            label="Lens"
            value={LENSES.includes(lens) ? String(lens) : 'other'}
            onChange={(v) => { if (v !== 'other') setLensTo(Number(v)); }}
            options={[...LENSES.map((mm) => ({ value: String(mm), label: `${mm} mm` })), ...(LENSES.includes(lens) ? [] : [{ value: 'other', label: `${lens} mm` }])]}
          />
          <NumberField prefix="mm" label="Focal length" value={lens} step={1} min={8} max={400} digits={0} onChange={(v) => setLensTo(v, `lens:${cam.id}`)} />
        </div>
      </div>
      {!rig && <Toggle label="Zoom" hint="On: the camera stays put. Off: it moves to keep the subject's size, as with a dolly zoom" checked={zoom} onChange={setZoom} />}
    </>
  );
}

export const movesSummary = (t: Target) => { const cam = t.camera!; return cam.kind === 'rig' ? (cam.rig.body === 'orbit' ? 'Circles' : 'Follows') : 'Along a path'; };
export const movesInfo = (t: Target) => (t.camera!.kind === 'rig'
  ? "It works out where it is every frame from its subject's body, so the shot holds when the blocking or a body changes."
  : 'On the canvas, drag a camera to move it (Shift: up and down) and its look point; double-click its path to add a point. Looking through it, frame the view and set a camera point from the timeline.');

/** How it moves: along a path, or placing itself every frame from its subject (following or circling it). */
export function MovesPanel({ t }: { t: Target }) {
  const cam = t.camera!;
  const set = (patch: Parameters<typeof editCamera>[2]) => editCamera(t.store, cam.id, patch);
  return (
    <>
      <div className="field">
        <span>How</span>
        <Segmented<'path' | 'follow' | 'orbit'>
          label="Camera moves"
          full
          value={cam.kind === 'rig' ? cam.rig.body : 'path'}
          onChange={(body) => setCameraBody(t.store, cam.id, body)}
          options={[{ value: 'path', label: 'Along a path' }, { value: 'follow', label: 'Follows' }, { value: 'orbit', label: 'Circles' }]}
        />
      </div>
      {cam.kind === 'rig' ? <RigSettings t={t} cam={cam} rig={cam.rig} set={set} /> : <PathSettings t={t} cam={cam} set={set} />}
    </>
  );
}

/** How a camera that places itself from its subject does it: its angle, how it turns, its smoothing. */
function RigSettings({ t, cam, rig, set }: { t: Target; cam: RigCamera; rig: CameraRig; set(patch: Parameters<typeof editCamera>[2]): void }) {
  const edit = (patch: Parameters<typeof editRig>[2], key?: string) => editRig(t.store, cam.id, patch, key);
  const others = t.scene.figures.filter((f) => !f.hidden && f.id !== cam.subject);
  return (
    <>
      <div className="field">
        <span>Angle<Info text="Around the subject from its front (+ from its left), and from above." label="About angle" /></span>
        <div className="lens-row">
          <NumberField prefix="°" label="Angle around" value={rig.yaw} step={5} min={-180} max={180} digits={0} onChange={(v) => edit({ yaw: v }, `rig-yaw:${cam.id}`)} />
          <NumberField prefix="↑" label="Angle above" value={rig.pitch} step={2} min={-60} max={80} digits={0} onChange={(v) => edit({ pitch: v }, `rig-pitch:${cam.id}`)} />
        </div>
      </div>
      {cam.subject && others.length > 0 && (
        <PropertyRow label="From">
          <Select<string>
            label="Angle measured from"
            value={rig.toward ?? ''}
            onChange={(v) => edit({ toward: v || undefined })}
            options={[{ value: '', label: 'Its facing' }, ...others.map((f) => ({ value: f.id, label: `The line towards ${f.name}` }))]}
          />
        </PropertyRow>
      )}
      {rig.body === 'follow'
        ? <Toggle label="Turns with it" hint="Turns as the subject turns. Off: keeps the angle the subject faced at the camera's first shot" checked={!!rig.turn} onChange={(on) => edit({ turn: on })} />
        : (
          <div className="field">
            <span>Speed</span>
            <NumberField prefix="°/s" label="Circling speed" value={rig.spin ?? 0} step={5} min={-360} max={360} digits={0} onChange={(v) => edit({ spin: v }, `rig-spin:${cam.id}`)} />
          </div>
        )}
      <div className="field">
        <span>Smoothing</span>
        <NumberField prefix="s" label="Smoothing" value={rig.smooth ?? 0} step={0.1} min={0} max={5} digits={1} onChange={(v) => edit({ smooth: v }, `rig-smooth:${cam.id}`)} />
      </div>
      <Toggle label="Hand-held" hint="A slight shake" checked={(cam.shake ?? 0) > 0} onChange={(on) => set({ shake: on ? 0.5 : 0 })} />
    </>
  );
}

/** Where a camera's path is, what it looks at, how it moves, its points. */
function PathSettings({ t, cam, set }: { t: Target; cam: PathCamera; set(patch: Parameters<typeof editCamera>[2]): void }) {
  const time = useStudio((s) => s.time);
  return (
    <>
      <div className="field">
        <span>Path</span>
        <Segmented<PathCamera['anchor']>
          label="Camera path"
          full
          value={cam.anchor}
          onChange={(anchor) => set({ anchor })}
          options={[{ value: 'world', label: 'Fixed in the scene' }, { value: 'subject', label: 'Rides along' }]}
        />
      </div>
      <PropertyRow label="Looks at">
        <Segmented<PathCamera['aim']>
          label="Looks at"
          full
          value={cam.aim}
          onChange={(aim) => set({ aim })}
          options={[{ value: 'subject', label: 'Subject' }, { value: 'point', label: 'A point' }, { value: 'path', label: 'Ahead' }]}
        />
      </PropertyRow>
      <Toggle label="Even pace" hint="Off: the camera eases in and out through its points" checked={cam.ease === 'linear'} onChange={(on) => set({ ease: on ? 'linear' : 'smooth' })} />
      <Toggle label="Hand-held" hint="A slight shake" checked={(cam.shake ?? 0) > 0} onChange={(on) => set({ shake: on ? 0.5 : 0 })} />
      {cam.points.length > 0 && (
        <ul className="side-list camera-points" aria-label="Camera points">
          {cam.points.map((p) => (
            <li key={p.t}>
              <button type="button" className={Math.abs(p.t - time) < 0.02 ? 'on' : ''} onClick={() => t.store.setTime(p.t)}>
                <CameraIcon size={13} aria-hidden />
                <span className="side-list-name">{p.t.toFixed(2)} s</span>
                <em>{Math.round(p.lens)} mm</em>
              </button>
              <IconButton icon={Trash2} label={`Delete the camera point at ${p.t.toFixed(2)} s`} className="row-delete" size={13} onClick={() => deleteCameraPoint(t.store, p.t, cam.id)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
