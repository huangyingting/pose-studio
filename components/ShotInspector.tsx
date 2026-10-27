import { useState } from 'react';
import { Camera as CameraIcon, ClipboardCopy, Copy, Scissors, Trash2, TriangleAlert, Video } from 'lucide-react';
import { addCamera, deleteCamera, deleteCameraPoint, editCamera, editShot, frameShot, ownCamera, removeShotCut, setFrameShape, setLens, setShotSubject, setTargetModel } from '@/lib/actions';
import { LENSES, SHOT_SIZES, cameraAt, cameraById, liveCamera, sizeOf, type Placement } from '@/lib/shot';
import { describeSpan } from '@/lib/prompt';
import { VIDEO_MODELS, overLimit, shotSpans, videoModel, type ShotSpan } from '@/lib/shots';
import { FRAME_SHAPES, type Camera, type FrameShape } from '@/lib/types';
import { useScene, useStore, useStudio } from './store-context';
import { IconButton, NameHeader, NumberField, Section, Segmented, Select, Toggle, type HeaderChrome, type Notify } from './ui';

/** Inspector for a selected shot: what it is called and shows, how long, what it is cut for, the camera filming it. */
export default function ShotInspector({ id, notify, chrome }: { id: string; notify: Notify; chrome?: HeaderChrome }) {
  const store = useStore();
  const scene = useScene();
  const a = scene.animation;
  const span = a ? shotSpans(a).find((sp) => sp.shot.id === id) : undefined;
  if (!a || !span) return null;
  const over = overLimit(a, span);
  const model = videoModel(a.target);

  return (
    <>
      <NameHeader chrome={chrome} lead={<span className="shot-no">{span.index + 1}</span>} name={span.shot.name} label="Shot name" onRename={(name) => editShot(store, id, { name })}>
        <IconButton
          icon={ClipboardCopy}
          label="Copy description (for AI video tools)"
          onClick={() => {
            const text = describeSpan(scene, span);
            navigator.clipboard?.writeText(text).then(() => notify('Shot description copied (for AI video tools)'), () => notify(text));
          }}
        />
        {span.index > 0 && <IconButton icon={Scissors} label="Remove cut" shortcut="Del" onClick={() => { removeShotCut(store, id); store.select(null); }} />}
      </NameHeader>
      <Section title="Shot">
        <label className="field">
          <span>What happens</span>
          <textarea
            value={span.shot.caption ?? ''}
            aria-label="Shot caption"
            rows={3}
            placeholder="Used in shot descriptions, cut lists and storyboards"
            onChange={(e) => editShot(store, id, { caption: e.target.value })}
          />
        </label>
        <p className="shot-time">
          {span.start.toFixed(2)}–{span.end.toFixed(2)} s · <strong>{(span.end - span.start).toFixed(1)} s</strong>
          {over && model && <span className="warn"><TriangleAlert size={12} aria-hidden /> Longer than {model.name} allows ({model.max} s)</span>}
        </p>
        <div className="field">
          <span>Frame (all shots)</span>
          <Select<FrameShape>
            label="Frame"
            value={a.frame ?? '16:9'}
            onChange={(v) => setFrameShape(store, v)}
            options={FRAME_SHAPES.map((f) => ({ value: f, label: { '16:9': '16:9 widescreen', '9:16': '9:16 vertical', '1:1': '1:1 square', '2.39:1': '2.39:1 cinemascope' }[f] }))}
          />
        </div>
        <div className="field">
          <span>Cut for</span>
          <Select
            label="Cut for"
            value={a.target ?? 'none'}
            onChange={(v) => setTargetModel(store, v === 'none' ? null : v)}
            options={[{ value: 'none', label: 'No length limit' }, ...VIDEO_MODELS.map((m) => ({ value: m.id, label: `${m.name} · ${m.max} s` }))]}
          />
        </div>
      </Section>
      <ShotFilming span={span} />
    </>
  );
}

const NEW = '+new';

/** Which camera films a shot, how it comes in (a cut or a blend), and that camera's settings. */
function ShotFilming({ span }: { span: ShotSpan }) {
  const store = useStore();
  const scene = useScene();
  const a = scene.animation!;
  const shot = span.shot;
  const cam = cameraById(a, shot.camera);
  const also = cam ? shotSpans(a).filter((s) => s.shot.id !== shot.id && s.shot.camera === cam.id) : [];
  return (
    <>
      <Section title="Filmed by">
        <div className="field">
          <span>Camera</span>
          <Select<string>
            label="Shot camera"
            value={cam?.id ?? ''}
            onChange={(v) => {
              if (v !== NEW) return editShot(store, shot.id, { camera: v || null });
              const t = store.getState().time;
              if (t < span.start - 1e-6 || t >= span.end - 1e-6) store.setTime(span.start);
              addCamera(store);
            }}
            options={[
              { value: '', label: 'Still camera (everyone in view)' },
              ...(a.cameras ?? []).map((c) => ({ value: c.id, label: c.name })),
              { value: NEW, label: 'New camera from the view' },
            ]}
          />
        </div>
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
          <p className="hint-text">
            {cam!.name} also films {also.map((s) => s.shot.name).join(', ')}: changing it changes those too.{' '}
            <button type="button" className="btn subtle" onClick={() => ownCamera(store, shot.id)}><Copy size={13} aria-hidden /> A copy for this shot</button>
          </p>
        )}
        <button type="button" className="btn subtle" onClick={() => { store.setTime(span.start); store.setSettings({ side: 'library', libraryTab: 'camera' }); }}>
          <Video size={14} aria-hidden /> Choose a camera move…
        </button>
      </Section>
      <CameraSettings cam={cam} span={span} />
    </>
  );
}

/** Inspector for a selected camera: its name, the shots it films, its settings and path. */
export function CameraInspector({ id, chrome }: { id: string; chrome?: HeaderChrome }) {
  const store = useStore();
  const scene = useScene();
  const a = scene.animation;
  const cam = cameraById(a, id);
  if (!a || !cam) return null;
  const films = shotSpans(a).filter((s) => s.shot.camera === id);
  return (
    <>
      <NameHeader chrome={chrome} lead={<CameraIcon size={15} aria-hidden />} name={cam.name} label="Camera name" onRename={(name) => editCamera(store, id, { name })}>
        <IconButton icon={Trash2} label="Delete camera" shortcut="Del" onClick={() => deleteCamera(store, id)} />
      </NameHeader>
      <Section title="Films">
        {films.length ? (
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
 * A camera's settings (`span`: as the camera of that shot; none: the still camera, which framing
 * turns into a camera of the shot's own): what it films; at the playhead (while it is filming),
 * the shot size, where the subject sits and the lens; for the whole camera, where its path is,
 * what it looks at, how it moves, its points.
 */
function CameraSettings({ cam, span }: { cam: Camera | null; span?: ShotSpan }) {
  const store = useStore();
  const scene = useScene();
  const time = useStudio((s) => s.time);
  const [place, setPlace] = useState<Placement>('center');
  const [zoom, setZoom] = useState(false);
  const live = span ? time >= span.start - 1e-6 && (time < span.end - 1e-6 || span.end >= scene.animation!.duration - 1e-6) : liveCamera(scene, time)?.id === cam?.id;
  const view = live ? cameraAt(scene, time) : null;
  const size = view ? sizeOf(scene, cam, time, view) : null;
  const lens = view ? Math.round(view.lens) : null;
  const set = (patch: Parameters<typeof editCamera>[2]) => { if (cam) editCamera(store, cam.id, patch); };
  return (
    <Section title={cam?.name ?? 'Still camera'}>
      <div className="field">
        <span>Frames</span>
        <Select
          label="Camera subject"
          value={cam?.subject && scene.figures.some((f) => f.id === cam.subject) ? cam.subject : 'all'}
          onChange={(v) => (cam ? set({ subject: v === 'all' ? '' : v }) : span && setShotSubject(store, span.shot.id, v === 'all' ? '' : v))}
          options={[{ value: 'all', label: 'Everyone' }, ...scene.figures.filter((f) => !f.hidden).map((f) => ({ value: f.id, label: f.name }))]}
        />
      </div>
      {view ? (
        <>
          <div className="field">
            <span>Shot size at {time.toFixed(2)} s</span>
            <div className="shot-sizes" role="group" aria-label="Shot size">
              {SHOT_SIZES.map((x) => (
                <button key={x.id} type="button" className={`btn subtle${size === x.id ? ' on' : ''}`} aria-pressed={size === x.id} data-tip={x.name} onClick={() => frameShot(store, x.id, { place })}>{x.short}</button>
              ))}
            </div>
            <Segmented<Placement>
              label="Subject in the frame"
              full
              value={place}
              onChange={(p) => { setPlace(p); if (size) frameShot(store, size, { place: p }); }}
              options={[{ value: 'left', label: 'Left third' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right third' }]}
            />
          </div>
          <div className="field">
            <span>Lens</span>
            <div className="lens-row">
              <Select<string>
                label="Lens"
                value={LENSES.includes(lens!) ? String(lens) : 'other'}
                onChange={(v) => { if (v !== 'other') setLens(store, Number(v), zoom ? 'place' : 'size'); }}
                options={[...LENSES.map((mm) => ({ value: String(mm), label: `${mm} mm` })), ...(LENSES.includes(lens!) ? [] : [{ value: 'other', label: `${lens} mm` }])]}
              />
              <NumberField prefix="mm" label="Focal length" value={lens!} step={1} min={8} max={400} digits={0} onChange={(v) => setLens(store, v, zoom ? 'place' : 'size', `lens:${cam?.id ?? span?.shot.id}`)} />
            </div>
            <Toggle label="Zoom (the camera stays put)" hint="Off: the camera moves to keep the subject's size, as with a dolly zoom" checked={zoom} onChange={setZoom} />
          </div>
        </>
      ) : (
        <p className="hint-text">Move the playhead into {span ? 'this shot' : 'a shot it films'} to frame it there.</p>
      )}
      {cam ? <PathSettings cam={cam} set={set} /> : <p className="hint-text">Framing the shot gives it a camera of its own.</p>}
    </Section>
  );
}

/** Where a camera's path is, what it looks at, how it moves, its points. */
function PathSettings({ cam, set }: { cam: Camera; set(patch: Parameters<typeof editCamera>[2]): void }) {
  const store = useStore();
  const time = useStudio((s) => s.time);
  return (
    <>
      <div className="field">
        <span>Camera path</span>
        <Segmented<Camera['anchor']>
          label="Camera path"
          full
          value={cam.anchor}
          onChange={(anchor) => set({ anchor })}
          options={[{ value: 'world', label: 'Fixed in the scene' }, { value: 'subject', label: 'Rides along' }]}
        />
        <Segmented<Camera['aim']>
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
