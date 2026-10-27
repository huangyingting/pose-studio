import { useState } from 'react';
import { Camera, ClipboardCopy, Scissors, Trash2, TriangleAlert, Video } from 'lucide-react';
import { deleteCameraPoint, editShot, frameShot, removeShotCut, setFrameShape, setLens, setShotCamera, setTargetModel } from '@/lib/actions';
import { LENSES, SHOT_SIZES, cameraAt, sizeOf, type Placement } from '@/lib/shot';
import { describeSpan } from '@/lib/prompt';
import { VIDEO_MODELS, overLimit, shotSpans, videoModel, type ShotSpan } from '@/lib/shots';
import { FRAME_SHAPES, type FrameShape, type Shot } from '@/lib/types';
import { useScene, useStore, useStudio } from './store-context';
import { IconButton, NameHeader, NumberField, Section, Segmented, Select, Toggle, type HeaderChrome, type Notify } from './ui';

/** Inspector for a selected shot: what it is called and shows, how long, what it is cut for, its camera. */
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
      <ShotCamera span={span} />
    </>
  );
}

/**
 * A shot's camera: what it frames; at the playhead, the shot size, where the subject sits and the
 * lens; for the whole shot, where its path is, what it looks at, how it moves, its points.
 */
function ShotCamera({ span }: { span: ShotSpan }) {
  const store = useStore();
  const scene = useScene();
  const time = useStudio((s) => s.time);
  const [place, setPlace] = useState<Placement>('center');
  const [zoom, setZoom] = useState(false);
  const shot = span.shot;
  const inside = time >= span.start - 1e-6 && (time < span.end - 1e-6 || span.end >= scene.animation!.duration - 1e-6);
  const view = inside ? cameraAt(scene, time) : null;
  const size = view ? sizeOf(scene, shot, time, view) : null;
  const lens = view ? Math.round(view.lens) : null;
  const set = (patch: Parameters<typeof setShotCamera>[2]) => setShotCamera(store, shot.id, patch);
  return (
    <Section title="Camera">
      <div className="field">
        <span>Frames</span>
        <Select
          label="Shot subject"
          value={shot.subject && scene.figures.some((f) => f.id === shot.subject) ? shot.subject : 'all'}
          onChange={(v) => set({ subject: v === 'all' ? '' : v })}
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
              <NumberField prefix="mm" label="Focal length" value={lens!} step={1} min={8} max={400} digits={0} onChange={(v) => setLens(store, v, zoom ? 'place' : 'size', `lens:${shot.id}`)} />
            </div>
            <Toggle label="Zoom (the camera stays put)" hint="Off: the camera moves to keep the subject's size, as with a dolly zoom" checked={zoom} onChange={setZoom} />
          </div>
        </>
      ) : (
        <p className="hint-text">Move the playhead into this shot to frame it there.</p>
      )}
      <div className="field">
        <span>Camera path</span>
        <Segmented<Shot['anchor']>
          label="Camera path"
          full
          value={shot.anchor}
          onChange={(anchor) => set({ anchor })}
          options={[{ value: 'world', label: 'Fixed in the scene' }, { value: 'subject', label: 'Rides along' }]}
        />
        <Segmented<Shot['aim']>
          label="Looks at"
          full
          value={shot.aim}
          onChange={(aim) => set({ aim })}
          options={[{ value: 'subject', label: 'The subject' }, { value: 'point', label: 'A point' }, { value: 'path', label: 'Ahead' }]}
        />
      </div>
      <Toggle label="Even pace" hint="Off: the camera eases in and out through its points" checked={shot.ease === 'linear'} onChange={(on) => set({ ease: on ? 'linear' : 'smooth' })} />
      <Toggle label="Hand-held" hint="A slight shake" checked={(shot.shake ?? 0) > 0} onChange={(on) => set({ shake: on ? 0.5 : 0 })} />
      {shot.points.length > 0 && (
        <ul className="side-list camera-points" aria-label="Camera points">
          {shot.points.map((p) => {
            const t = span.start + p.t;
            return (
              <li key={p.t}>
                <button type="button" className={Math.abs(t - time) < 0.02 ? 'on' : ''} onClick={() => store.setTime(t)}>
                  <Camera size={13} aria-hidden />
                  <span className="side-list-name">{t.toFixed(2)} s</span>
                  <em>{Math.round(p.lens)} mm</em>
                </button>
                <IconButton icon={Trash2} label={`Delete the camera point at ${t.toFixed(2)} s`} className="row-delete" size={13} onClick={() => deleteCameraPoint(store, t)} />
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="btn subtle" onClick={() => { store.setTime(span.start); store.setSettings({ side: 'library', libraryTab: 'camera' }); }}>
        <Video size={14} aria-hidden /> Choose a camera move…
      </button>
      <p className="hint-text">On the canvas, drag the shot&apos;s cameras to move them (Shift: up and down) and their look points; double-click its path to add a point. Looking through the shot camera, frame the view and set a camera point from the timeline.</p>
    </Section>
  );
}

