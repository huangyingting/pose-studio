import { useState } from 'react';
import { Camera as CameraIcon, Eye, Trash2 } from 'lucide-react';
import { deleteCameraPoint, editCamera, editRig, frameShot, setCameraBody, setLens, setShotSubject } from '@/lib/actions';
import { LENSES, SHOT_SIZES, cameraById, liveCamera, sizeOf, viewOf } from '@/lib/cameras';
import { shotSpans, type ShotSpan } from '@/lib/shots';
import type { Camera, CameraRig, PathCamera, Placement, RigCamera, ShotSize } from '@/lib/types';
import { useScene, useStore, useStudio } from './store-context';
import { cameraMenu, type MenuUi } from './menus';
import { IconButton, NameHeader, NumberField, Section, Segmented, Select, Toggle, type HeaderChrome } from './ui';

/** Inspector for a selected camera: its name, the shots it films, its settings and path. */
export default function CameraInspector({ id, chrome, ui }: { id: string; chrome?: HeaderChrome; ui: MenuUi }) {
  const store = useStore();
  const scene = useScene();
  const a = scene.animation;
  const through = useStudio((st) => st.through?.camera === id);
  const cam = cameraById(scene, id);
  if (!cam) return null;
  const films = a ? shotSpans(a).filter((s) => s.shot.camera === id) : [];
  const first = scene.cameras[0].id === id;
  return (
    <>
      <NameHeader chrome={chrome} lead={<CameraIcon size={15} aria-hidden />} name={cam.name} label="Camera name" onRename={(name) => editCamera(store, id, { name })} menu={cameraMenu(store, id, ui)}>
        <IconButton icon={Eye} label="Look through this camera" active={through} pressed={through} onClick={() => store.lookThrough(through ? null : { camera: id })} />
      </NameHeader>
      <Section title="Films">
        {!a ? (
          <p className="hint-text">{first ? 'The still: the scene is filmed by its first camera.' : 'Another angle on the still; the first camera films it.'}</p>
        ) : films.length ? (
          <ul className="side-list" aria-label="Shots it films">
            {films.map((s) => (
              <li key={s.shot.id}>
                <button type="button" onClick={() => { store.setTime(s.start); store.select({ kind: 'shot', shot: s.shot.id }); }}>
                  <span className="shot-no">{s.index + 1}</span>
                  <span className="side-list-name">{s.shot.name}</span>
                  <em>{s.start.toFixed(1)}–{s.end.toFixed(1)} s</em>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="hint-text">No shot films with it yet: pick it for a shot in the shot&apos;s inspector.</p>}
      </Section>
      <CameraSettings cam={cam} />
    </>
  );
}

/**
 * A camera's settings (`span`: as the camera of that shot): what it films; its shot size, where
 * the subject sits and its lens (a rig's always; a path's at the playhead, while it is filming, or
 * in a still); how it moves.
 */
export function CameraSettings({ cam, span }: { cam: Camera; span?: ShotSpan }) {
  const store = useStore();
  const scene = useScene();
  const time = useStudio((s) => s.time);
  const [placed, setPlaced] = useState<Placement>('center');
  const [zoom, setZoom] = useState(false);
  const a = scene.animation;
  const rig = cam.kind === 'rig' ? cam.rig : null;
  const t = a ? time : 0;
  const live = !a || (span ? time >= span.start - 1e-6 && (time < span.end - 1e-6 || span.end >= a.duration - 1e-6) : liveCamera(scene, time).id === cam.id);
  const view = live && !rig ? viewOf(scene, cam, t) : null;
  const size = rig ? rig.size : view ? sizeOf(scene, cam, t, view) : null;
  const lens = rig ? Math.round(rig.lens) : view ? Math.round(view.lens) : null;
  const place = rig ? rig.place ?? 'center' : placed;
  const set = (patch: Parameters<typeof editCamera>[2]) => editCamera(store, cam.id, patch);
  const shown = scene.figures.filter((f) => !f.hidden);
  const subject = shown.some((f) => f.id === cam.subject) ? cam.subject : undefined;
  const frame = (to: ShotSize, at: Placement) => (rig ? editRig(store, cam.id, { size: to, place: at }) : frameShot(store, to, { place: at, camera: cam.id }));
  const setLensTo = (mm: number, key?: string) => (rig ? editRig(store, cam.id, { lens: mm }) : setLens(store, mm, zoom ? 'place' : 'size', key, cam.id));
  return (
    <Section title={cam.name}>
      <div className="field">
        <span>Frames</span>
        <Select
          label="Camera subject"
          value={subject ?? 'all'}
          onChange={(v) => (span ? setShotSubject(store, span.shot.id, v === 'all' ? '' : v) : set({ subject: v === 'all' ? '' : v }))}
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
          <div className="field">
            <span>{rig ? 'Shot size (kept as the subject moves)' : a ? `Shot size at ${time.toFixed(2)} s` : 'Shot size'}</span>
            <div className="shot-sizes" role="group" aria-label="Shot size">
              {SHOT_SIZES.map((x) => (
                <button key={x.id} type="button" className={`btn subtle${size === x.id ? ' on' : ''}`} aria-pressed={size === x.id} data-tip={x.name} onClick={() => frame(x.id, place)}>{x.short}</button>
              ))}
            </div>
            <Segmented<Placement>
              label="Subject in the frame"
              full
              value={place}
              onChange={(p) => { setPlaced(p); frame(size, p); }}
              options={[{ value: 'left', label: 'Left third' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right third' }]}
            />
          </div>
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
            {!rig && <Toggle label="Zoom (the camera stays put)" hint="Off: the camera moves to keep the subject's size, as with a dolly zoom" checked={zoom} onChange={setZoom} />}
          </div>
        </>
      ) : (
        <p className="hint-text">Move the playhead into {span ? 'this shot' : 'a shot it films'} to frame it there.</p>
      )}
      <div className="field">
        <span>Moves</span>
        <Segmented<'path' | 'follow' | 'orbit'>
          label="Camera moves"
          full
          value={rig?.body ?? 'path'}
          onChange={(body) => setCameraBody(store, cam.id, body)}
          options={[{ value: 'path', label: 'Along a path' }, { value: 'follow', label: 'Follows' }, { value: 'orbit', label: 'Circles' }]}
        />
      </div>
      {cam.kind === 'rig' ? <RigSettings cam={cam} rig={cam.rig} set={set} /> : <PathSettings cam={cam} set={set} />}
    </Section>
  );
}

/** How a camera that places itself from its subject does it: its angle, how it turns, its smoothing. */
function RigSettings({ cam, rig, set }: { cam: RigCamera; rig: CameraRig; set(patch: Parameters<typeof editCamera>[2]): void }) {
  const store = useStore();
  const scene = useScene();
  const edit = (patch: Parameters<typeof editRig>[2], key?: string) => editRig(store, cam.id, patch, key);
  const others = scene.figures.filter((f) => !f.hidden && f.id !== cam.subject);
  return (
    <>
      <div className="field">
        <span>Angle (from the subject&apos;s front; + from its left)</span>
        <div className="lens-row">
          <NumberField prefix="°" label="Angle around" value={rig.yaw} step={5} min={-180} max={180} digits={0} onChange={(v) => edit({ yaw: v }, `rig-yaw:${cam.id}`)} />
          <NumberField prefix="↑" label="Angle above" value={rig.pitch} step={2} min={-60} max={80} digits={0} onChange={(v) => edit({ pitch: v }, `rig-pitch:${cam.id}`)} />
        </div>
        {cam.subject && others.length > 0 && (
          <Select<string>
            label="Angle measured from"
            value={rig.toward ?? ''}
            onChange={(v) => edit({ toward: v || undefined })}
            options={[{ value: '', label: 'Its facing' }, ...others.map((f) => ({ value: f.id, label: `The line towards ${f.name}` }))]}
          />
        )}
      </div>
      {rig.body === 'follow'
        ? <Toggle label="Turns with the subject" hint="Off: keeps the angle the subject faced at the camera's first shot" checked={!!rig.turn} onChange={(on) => edit({ turn: on })} />
        : (
          <div className="field">
            <span>Circling speed</span>
            <NumberField prefix="°/s" label="Circling speed" value={rig.spin ?? 0} step={5} min={-360} max={360} digits={0} onChange={(v) => edit({ spin: v }, `rig-spin:${cam.id}`)} />
          </div>
        )}
      <div className="field">
        <span>Smoothing</span>
        <NumberField prefix="s" label="Smoothing" value={rig.smooth ?? 0} step={0.1} min={0} max={5} digits={1} onChange={(v) => edit({ smooth: v }, `rig-smooth:${cam.id}`)} />
      </div>
      <Toggle label="Hand-held" hint="A slight shake" checked={(cam.shake ?? 0) > 0} onChange={(on) => set({ shake: on ? 0.5 : 0 })} />
      <p className="hint-text">The camera works out where it is every frame from its subject&apos;s body, so the shot holds when the blocking or a body changes.</p>
    </>
  );
}

/** Where a camera's path is, what it looks at, how it moves, its points. */
function PathSettings({ cam, set }: { cam: PathCamera; set(patch: Parameters<typeof editCamera>[2]): void }) {
  const store = useStore();
  const time = useStudio((s) => s.time);
  return (
    <>
      <div className="field">
        <span>Camera path</span>
        <Segmented<PathCamera['anchor']>
          label="Camera path"
          full
          value={cam.anchor}
          onChange={(anchor) => set({ anchor })}
          options={[{ value: 'world', label: 'Fixed in the scene' }, { value: 'subject', label: 'Rides along' }]}
        />
        <Segmented<PathCamera['aim']>
          label="Looks at"
          full
          value={cam.aim}
          onChange={(aim) => set({ aim })}
          options={[{ value: 'subject', label: 'The subject' }, { value: 'point', label: 'A point' }, { value: 'path', label: 'Ahead' }]}
        />
      </div>
      <Toggle label="Even pace" hint="Off: the camera eases in and out through its points" checked={cam.ease === 'linear'} onChange={(on) => set({ ease: on ? 'linear' : 'smooth' })} />
      <Toggle label="Hand-held" hint="A slight shake" checked={(cam.shake ?? 0) > 0} onChange={(on) => set({ shake: on ? 0.5 : 0 })} />
      {cam.points.length > 0 && (
        <ul className="side-list camera-points" aria-label="Camera points">
          {cam.points.map((p) => (
            <li key={p.t}>
              <button type="button" className={Math.abs(p.t - time) < 0.02 ? 'on' : ''} onClick={() => store.setTime(p.t)}>
                <CameraIcon size={13} aria-hidden />
                <span className="side-list-name">{p.t.toFixed(2)} s</span>
                <em>{Math.round(p.lens)} mm</em>
              </button>
              <IconButton icon={Trash2} label={`Delete the camera point at ${p.t.toFixed(2)} s`} className="row-delete" size={13} onClick={() => deleteCameraPoint(store, p.t, cam.id)} />
            </li>
          ))}
        </ul>
      )}
      <p className="hint-text">On the canvas, drag a camera to move it (Shift: up and down) and its look point; double-click its path to add a point. Looking through the shot camera, frame the view and set a camera point from the timeline.</p>
    </>
  );
}
