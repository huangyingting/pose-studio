import { Copy, TriangleAlert, Video } from 'lucide-react';
import { addCamera, editShot, ownCamera } from '@/lib/actions';
import { cameraById } from '@/lib/cameras';
import { overLimit, shotSpans, videoModel, type ShotSpan } from '@/lib/shots';
import { CameraSettings } from './CameraInspector';
import { useScene, useStore } from './store-context';
import { shotMenu, type MenuUi } from './menus';
import { NameHeader, NumberField, Section, Segmented, Select, type HeaderChrome } from './ui';

/** Inspector for a selected shot: what it is called and shows, how long, what it is cut for, the camera filming it. */
export default function ShotInspector({ id, ui, chrome }: { id: string; ui: MenuUi; chrome?: HeaderChrome }) {
  const store = useStore();
  const scene = useScene();
  const a = scene.animation;
  const span = a ? shotSpans(a).find((sp) => sp.shot.id === id) : undefined;
  if (!a || !span) return null;
  const over = overLimit(a, span);
  const model = videoModel(a.target);

  return (
    <>
      <NameHeader chrome={chrome} lead={<span className="shot-no">{span.index + 1}</span>} name={span.shot.name} label="Shot name" onRename={(name) => editShot(store, id, { name })} menu={shotMenu(store, id, ui)} />
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
  const cam = cameraById(scene, shot.camera) ?? scene.cameras[0];
  const also = shotSpans(a).filter((s) => s.shot.id !== shot.id && s.shot.camera === cam.id);
  return (
    <>
      <Section title="Filmed by">
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
            {cam.name} also films {also.map((s) => s.shot.name).join(', ')}: changing it changes those too.{' '}
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
