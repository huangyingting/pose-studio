import { ClipboardCopy, Scissors, TriangleAlert, Video } from 'lucide-react';
import { applyCameraMove, editShot, removeShotCut, setTargetModel } from '@/lib/actions';
import { describeSpan } from '@/lib/prompt';
import { CAMERA_MOVES } from '@/lib/shot';
import { VIDEO_MODELS, overLimit, shotSpans, videoModel } from '@/lib/shots';
import { useScene, useStore } from './store-context';
import { Section, Select, type Notify } from './ui';

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
      <Section title={`Shot ${span.index + 1}`}>
        <label className="field">
          <span>Name</span>
          <input type="text" value={span.shot.name} aria-label="Shot name" onChange={(e) => editShot(store, id, { name: e.target.value })} />
        </label>
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
      <Section title="Camera move">
        <div className="side-chips">
          {CAMERA_MOVES.map((m) => (
            <button
              key={m.id}
              type="button"
              className="chip"
              title={m.description}
              onClick={() => { store.setTime(span.start); applyCameraMove(store, m.id); notify(`${span.shot.name}: ${m.name}`); }}
            >
              <Video size={12} aria-hidden /> {m.name}
            </button>
          ))}
        </div>
        <p className="hint-text">Or frame the view and set camera keys from the timeline.</p>
      </Section>
      <Section title="Shot">
        <div className="toolrow">
          <button
            type="button"
            className="btn subtle"
            onClick={() => {
              const text = describeSpan(scene, span);
              navigator.clipboard?.writeText(text).then(() => notify('Shot description copied (for AI video tools)'), () => notify(text));
            }}
          >
            <ClipboardCopy size={14} aria-hidden /> Copy description
          </button>
          {span.index > 0 && (
            <button type="button" className="btn ghost danger" onClick={() => { removeShotCut(store, id); store.select(null); }}>
              <Scissors size={14} aria-hidden /> Remove cut
            </button>
          )}
        </div>
      </Section>
    </>
  );
}
