import { ChevronRight, Copy, TriangleAlert, Video } from 'lucide-react';
import { addCamera, editShot, ownCamera } from '@/lib/actions';
import { SHOT_SIZES, cameraById, sizeOf, viewOf } from '@/lib/cameras';
import { overLimit, shotSpans, videoModel, type ShotSpan } from '@/lib/shots';
import type { Camera, Scene } from '@/lib/types';
import { useFilm, useScene, useStore } from './store-context';
import { shotMenu, type MenuUi } from './menus';
import { NameHeader, NumberField, PropertyRow, Section, Segmented, Select, type HeaderChrome } from './ui';

/** Inspector for a selected shot: what it is called and shows, how long, what it is cut for, the camera filming it. */
export default function ShotInspector({ id, ui, chrome }: { id: string; ui: MenuUi; chrome?: HeaderChrome }) {
  const store = useStore();
  const scene = useScene();
  const film = useFilm();
  const a = scene.animation;
  const span = a ? shotSpans(a).find((sp) => sp.shot.id === id) : undefined;
  if (!a || !span) return null;
  const over = overLimit(span);
  const model = videoModel(film.target);

  return (
    <>
      <NameHeader chrome={chrome} lead={<span className="shot-no">{span.index + 1}</span>} name={span.shot.name} label="Shot name" onRename={(name) => editShot(store, id, { name })} menu={shotMenu(store, id, ui)} />
      <Section id="shot" title="Shot" summary={`${(span.end - span.start).toFixed(1)} s${span.shot.caption ? ` · ${span.shot.caption}` : ''}`}>
        <label className="field">
          <span>Caption</span>
          <textarea
            value={span.shot.caption ?? ''}
            aria-label="Shot caption"
            rows={3}
            placeholder="What happens…"
            onChange={(e) => editShot(store, id, { caption: e.target.value })}
          />
        </label>
        <PropertyRow label="Length">
          <span className="shot-time">
            <strong>{(span.end - span.start).toFixed(1)} s</strong> · {span.start.toFixed(2)}–{span.end.toFixed(2)} s
            {over && model && <span className="warn"><TriangleAlert size={12} aria-hidden /> Longer than {model.name} allows ({model.max} s)</span>}
          </span>
        </PropertyRow>
      </Section>
      <ShotFilming span={span} />
    </>
  );
}

const NEW = '+new';

/** A camera in a few words as it films a shot from t: "Anna single · MCU · 85 mm · Follows". */
function cameraSummary(scene: Scene, cam: Camera, t: number) {
  const view = cam.kind === 'rig' ? null : viewOf(scene, cam, t);
  const size = cam.kind === 'rig' ? cam.rig.size : sizeOf(scene, cam, t, view!);
  const lens = Math.round(cam.kind === 'rig' ? cam.rig.lens : view!.lens);
  const moves = cam.kind === 'rig' ? (cam.rig.body === 'orbit' ? 'Circles' : 'Follows') : cam.points.length > 1 ? 'Moves' : 'Still';
  return [cam.name, SHOT_SIZES.find((x) => x.id === size)?.short, `${lens} mm`, moves].filter(Boolean).join(' · ');
}

/** Which camera films a shot and how it comes in (a cut or a blend); the camera's settings are its own inspector's. */
function ShotFilming({ span }: { span: ShotSpan }) {
  const store = useStore();
  const scene = useScene();
  const a = scene.animation!;
  const shot = span.shot;
  const cam = cameraById(scene, shot.camera) ?? scene.cameras[0];
  const also = shotSpans(a).filter((s) => s.shot.id !== shot.id && s.shot.camera === cam.id);
  return (
    <Section id="filmedby" title="Filmed by" summary={cam.name}>
      <div className="field">
        <span>Camera</span>
        <Select<string>
          label="Shot camera"
          value={cam.id}
          onChange={(v) => {
            if (v !== NEW) return editShot(store, shot.id, { camera: v });
            const t = store.getState().time;
            if (t < span.start - 1e-6 || t >= span.end - 1e-6) store.setTime(span.start);
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
      <button type="button" className="btn subtle" onClick={() => { store.setTime(span.start); store.setSettings({ side: 'library', libraryTab: 'camera' }); }}>
        <Video size={14} aria-hidden /> Choose a camera move…
      </button>
    </Section>
  );
}
