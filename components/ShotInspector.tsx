import { ClipboardCopy, Scissors, TriangleAlert, Video } from 'lucide-react';
import { editShot, removeShotCut, setCameraOptions, setTargetModel } from '@/lib/actions';
import { describeSpan } from '@/lib/prompt';
import { VIDEO_MODELS, overLimit, shotSpans, videoModel } from '@/lib/shots';
import { useScene, useStore } from './store-context';
import { IconButton, NameHeader, Section, Select, Toggle, type Notify } from './ui';

/** Inspector for a selected shot: what it is called and shows, how long, what it is cut for, its camera. */
export default function ShotInspector({ id, notify }: { id: string; notify: Notify }) {
  const store = useStore();
  const scene = useScene();
  const a = scene.animation;
  const span = a ? shotSpans(a).find((sp) => sp.shot.id === id) : undefined;
  if (!a || !span) return null;
  const over = overLimit(a, span);
  const model = videoModel(a.target);

  return (
    <>
      <NameHeader lead={<span className="shot-no">{span.index + 1}</span>} name={span.shot.name} label="Shot name" onRename={(name) => editShot(store, id, { name })}>
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
          <span>Cut for</span>
          <Select
            label="Cut for"
            value={a.target ?? 'none'}
            onChange={(v) => setTargetModel(store, v === 'none' ? null : v)}
            options={[{ value: 'none', label: 'No length limit' }, ...VIDEO_MODELS.map((m) => ({ value: m.id, label: `${m.name} · ${m.max} s` }))]}
          />
        </div>
      </Section>
      <Section title="Camera">
        <button type="button" className="btn subtle" onClick={() => { store.setTime(span.start); store.setSettings({ side: 'library', libraryTab: 'camera' }); }}>
          <Video size={14} aria-hidden /> Choose a camera move…
        </button>
        <p className="hint-text">Or frame the view and set camera keys from the timeline.</p>
        <Toggle label="Follow the figures" hint="All shots: the camera keeps the figures in frame as they move" checked={!!a.camera?.follow} onChange={(follow) => setCameraOptions(store, { follow })} />
        <Toggle label="Hand-held" hint="All shots: a slight shake" checked={(a.camera?.shake ?? 0) > 0} onChange={(on) => setCameraOptions(store, { shake: on ? 0.5 : 0 })} />
      </Section>
    </>
  );
}
