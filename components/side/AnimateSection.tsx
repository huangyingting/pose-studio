'use client';

import { Film, Play, TriangleAlert, UsersRound, Video } from 'lucide-react';
import { addScene, applyCameraMove, setTargetModel, startAnimation } from '@/lib/actions';
import { MOTIONS } from '@/lib/motions';
import { CAMERA_MOVES } from '@/lib/shot';
import { VIDEO_MODELS, overLimit, shotSpans, spanAt } from '@/lib/shots';
import { useScene, useStore, useStudio } from '../store-context';
import { Select } from '../ui';
import type { SectionProps } from './sections';

/**
 * Animation at a glance: the open pose's shots (click one to go there), what they are cut for,
 * a camera move for the current shot, and animation templates to start from.
 */
export default function AnimateSection({ notify }: SectionProps) {
  const store = useStore();
  const scene = useScene();
  const time = useStudio((s) => s.time);
  const a = scene.animation;
  const spans = a ? shotSpans(a) : [];
  const current = a ? spanAt(a, time) : null;

  return (
    <div className="side-section">
      <div className="side-head">
        <h2>Animate</h2>
      </div>
      <div className="side-scroll">
        {!a ? (
          <div className="side-group">
            <p className="hint-text">This pose is still. Animate it to pose the figures at different times, add camera moves and cut it into shots.</p>
            <button type="button" className="btn subtle" onClick={() => { startAnimation(store); notify('Animation started: pose the figures at other times on the timeline'); }}>
              <Play size={14} aria-hidden /> Animate this pose
            </button>
          </div>
        ) : (
          <>
            <div className="side-group">
              <h3>Shots <span className="count">{spans.length}</span></h3>
              <ul className="side-list" aria-label="Shots">
                {spans.map((sp) => {
                  const over = overLimit(a, sp);
                  return (
                    <li key={sp.shot.id}>
                      <button
                        type="button"
                        className={current?.shot.id === sp.shot.id ? 'on' : ''}
                        onClick={() => store.setTime(sp.start)}
                        title={sp.shot.caption || undefined}
                      >
                        <span className="side-list-name">{sp.shot.name}</span>
                        {over && <TriangleAlert size={12} className="warn" aria-label="Longer than the model allows" />}
                        <em>{(sp.end - sp.start).toFixed(1)} s</em>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="side-field">
                <span>Cut for</span>
                <Select
                  label="Cut for"
                  value={a.target ?? 'none'}
                  onChange={(v) => setTargetModel(store, v === 'none' ? null : v)}
                  options={[{ value: 'none', label: 'No length limit' }, ...VIDEO_MODELS.map((m) => ({ value: m.id, label: `${m.name} · ${m.max} s` }))]}
                />
              </div>
            </div>
            <div className="side-group">
              <h3>Camera move{spans.length > 1 && current ? ` · ${current.shot.name}` : ''}</h3>
              <div className="side-chips">
                {CAMERA_MOVES.map((m) => (
                  <button key={m.id} type="button" className="chip" title={m.description} onClick={() => { applyCameraMove(store, m.id); notify(`${m.name}: ${m.description}`); }}>
                    <Video size={12} aria-hidden /> {m.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="side-group">
          <h3>Templates</h3>
          <ul className="side-list" aria-label="Animation templates">
            {MOTIONS.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => addScene(store, m.build())} title="Opens as a new pose">
                  {m.people > 1 ? <UsersRound size={14} aria-hidden /> : <Film size={14} aria-hidden />}
                  <span className="side-list-name">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
