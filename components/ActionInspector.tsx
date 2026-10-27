'use client';

import { Diamond, Film, Footprints, Layers, Trash2, TriangleAlert, Users } from 'lucide-react';
import {
  deleteAction, fitWarp, moveAction, recastRole, retime, setActionTarget, setBlend, setClipOptions, setJumpHeight, setTravel,
} from '@/lib/actions';
import { clipById } from '@/lib/assets';
import { overWarp } from '@/lib/evaluate';
import { JUMP_PREP, jumpHeight } from '@/lib/locomotion';
import { actionLabel } from '@/lib/track';
import type { Action, Scene, Travel } from '@/lib/types';
import { useScene, useStore } from './store-context';
import { IconButton, NumberField, Section, Segmented, Select, Toggle, type HeaderChrome } from './ui';

const JUMP_HEIGHTS = [0.3, 0.5, 0.8, 1.2];

/**
 * Inspector for an action picked on the timeline: when it starts, how long it takes and blends
 * in; for a motion its speed, mirroring, the people in it, where its mark is and what it does with
 * a prop; for a walk, run or jump how the figure gets there.
 */
export default function ActionInspector({ id, figure, chrome }: { id: string; figure: string; chrome: HeaderChrome }) {
  const store = useStore();
  const scene = useScene();
  const a = scene.animation;
  const act = a?.actions.find((x) => x.id === id);
  if (!a || !act) return null;
  const who = scene.figures.find((f) => f.id === figure);
  const src = act.source;
  const Icon = src.kind === 'travel' ? Footprints : src.kind === 'keys' ? Diamond : act.layer === 'upper' ? Layers : act.roles.length > 1 ? Users : Film;
  const label = actionLabel(act);
  const end = act.start + act.duration;

  return (
    <>
      <div className="panel-title">
        {chrome.before}
        <Icon size={16} strokeWidth={1.75} aria-hidden />
        <span className="title-static" aria-label="Action">{label}</span>
        <IconButton icon={Trash2} label={`Remove ${label}`} shortcut="Del" onClick={() => { deleteAction(store, id); store.select(null); }} />
        {chrome.after}
      </div>
      <Section title="Timing">
        <p className="shot-time">
          {who?.name}{act.layer === 'upper' ? ' · upper body' : act.layer === 'correction' ? ' · correction' : ''} · {act.start.toFixed(2)}–{end.toFixed(2)} s
        </p>
        <div className="action-times">
          <label className="field">
            <span>Starts</span>
            <NumberField prefix="s" label="Start" value={act.start} step={1 / a.fps} min={0} max={60} onChange={(v) => moveAction(store, id, v, `act:${id}:start`)} />
          </label>
          <label className="field">
            <span>Takes</span>
            <NumberField prefix="s" label="Length" value={act.duration} step={1 / a.fps} min={1 / a.fps} max={60} onChange={(v) => retime(store, id, v, `act:${id}:length`)} />
          </label>
          {!act.layer && src.kind !== 'keys' && (
            <label className="field">
              <span>Blends in</span>
              <NumberField prefix="s" label="Blend in" value={act.blendIn ?? 0} step={0.05} min={0} max={2} onChange={(v) => setBlend(store, id, v, `act:${id}:blend`)} />
            </label>
          )}
        </div>
        <p className="hint-text">Drag it on the timeline to move it, its right edge to retime it, the ramp before it to blend into it. What follows moves along.</p>
      </Section>
      {src.kind === 'clip' && <ClipSection act={act} figure={figure} scene={scene} />}
      {src.kind === 'travel' && <TravelSection act={act} figure={figure} />}
      {src.kind === 'keys' && (
        <Section title={act.layer === 'correction' ? 'Correction' : 'Posed'}>
          <p className="hint-text">
            {act.layer === 'correction'
              ? 'Changes made over a motion or a walk: pose the figure at a time inside it to add one.'
              : `${src.clip.parts[0].tracks[0]?.times.length ?? 1} keys, posed by hand: pose the figure at a key to change it; right-click its track to walk, run or jump between keys.`}
          </p>
        </Section>
      )}
    </>
  );
}

function ClipSection({ act, figure, scene }: { act: Action; figure: string; scene: Scene }) {
  const store = useStore();
  if (act.source.kind !== 'clip') return null;
  const src = act.source;
  const clip = clipById(src.clip);
  const speed = src.speed ?? (clip && !clip.loop ? clip.duration / act.duration : 1);
  const over = !act.layer && overWarp(scene, act, figure);
  const names = (n: number) => clip?.parts[n]?.name || `Part ${n + 1}`;
  const target = act.target;
  return (
    <>
      <Section title="Motion">
        <label className="field">
          <span>Speed</span>
          <NumberField prefix="×" label="Speed" value={Math.round(speed * 100) / 100} step={0.05} min={0.25} max={4} onChange={(v) => setClipOptions(store, act.id, { speed: v }, `act:${act.id}:speed`)} />
        </label>
        <Toggle label="Mirrored" hint="Left for right" checked={!!src.mirror} onChange={(mirror) => setClipOptions(store, act.id, { mirror })} />
        {!act.layer && (over ? (
          <div className="warp-warn">
            <p><TriangleAlert size={12} aria-hidden /> Its mark is further than the motion can stretch (±25%, ±30°).</p>
            <div className="row">
              <button type="button" className="btn subtle" onClick={() => fitWarp(store, act.id, figure, 'back')}>Move it back</button>
              <button type="button" className="btn subtle" onClick={() => fitWarp(store, act.id, figure, 'walk')}>Walk the rest</button>
            </div>
          </div>
        ) : (
          <p className="hint-text">Drag its mark on the floor to where it ends: the motion stretches up to ±25% and turns up to ±30° to get there.</p>
        ))}
      </Section>
      {act.roles.length > 1 && (
        <Section title="People">
          {act.roles.map((r, n) => (
            <div className="field" key={n}>
              <span>{names(n)}</span>
              <Select
                label={`${names(n)}: who`}
                value={r.figure}
                onChange={(v) => recastRole(store, act.id, n, v)}
                options={scene.figures.filter((f) => !f.proxy).map((f) => ({ value: f.id, label: f.name }))}
              />
            </div>
          ))}
          <p className="hint-text">Dragging one of their marks moves them all, as a formation.</p>
        </Section>
      )}
      {act.prop && target && (
        <Section title={scene.props.find((p) => p.id === act.prop)?.name ?? 'Prop'}>
          {'figure' in target && target.figure !== act.roles[0].figure && (
            <div className="field">
              <span>Passed to</span>
              <Select
                label="Passed to"
                value={`${target.figure}:${target.hand}`}
                onChange={(v) => { const [f, hand] = v.split(':'); setActionTarget(store, act.id, { figure: f, hand: hand as 'L' | 'R' }); }}
                options={scene.figures.filter((f) => f.id !== act.roles[0].figure).flatMap((f) => (['R', 'L'] as const).map((hand) => ({ value: `${f.id}:${hand}`, label: `${f.name}: ${hand === 'L' ? 'left' : 'right'} hand` })))}
              />
            </div>
          )}
          {'figure' in target && target.figure === act.roles[0].figure && <p className="hint-text">Tossed up {target.rise ?? 2} m and caught again.</p>}
          {'hoop' in target && (
            <Toggle label="Off the rim" hint="The shot misses: it hits the front of the rim" checked={!!target.miss} onChange={(miss) => setActionTarget(store, act.id, { hoop: target.hoop, ...(miss ? { miss } : {}) })} />
          )}
          {'at' in target && <p className="hint-text">Thrown to the floor at {target.at[0].toFixed(1)}, {target.at[1].toFixed(1)}.</p>}
          {'bounce' in target && <p className="hint-text">Bounced off the floor back into the hand.</p>}
        </Section>
      )}
    </>
  );
}

type Getting = 'glide' | Travel;

/** How the figure gets to its mark: walking, running or jumping there (or gliding as keyed); for a jump its height and turns. */
function TravelSection({ act, figure }: { act: Action; figure: string }) {
  const store = useStore();
  if (act.source.kind !== 'travel') return null;
  const src = act.source;
  const at = act.start + act.duration;
  const keep = { strafe: src.strafe, spin: src.spin, flip: src.flip };
  const set = (k: Getting, patch: { strafe?: boolean; spin?: number; flip?: number } = {}) => setTravel(store, figure, at, k === 'glide' ? null : k, { ...keep, ...patch });
  const height = src.mode === 'jump' ? jumpHeight(Math.max(0, act.duration - 2 * JUMP_PREP)) : 0;
  const nearest = JUMP_HEIGHTS.reduce((b, h) => (Math.abs(h - height) < Math.abs(b - height) ? h : b));
  return (
    <Section title="Getting there">
      <Segmented<Getting>
        label="Getting there"
        full
        value={src.mode}
        onChange={(k) => set(k)}
        options={[{ value: 'glide', label: 'Glide' }, { value: 'walk', label: 'Walk' }, { value: 'run', label: 'Run' }, { value: 'jump', label: 'Jump' }]}
      />
      {(src.mode === 'walk' || src.mode === 'run') && (
        <Toggle label="Keep facing" hint="Side steps and backing up instead of turning to the way it goes" checked={!!src.strafe} onChange={(strafe) => set(src.mode, { strafe })} />
      )}
      {src.mode === 'jump' && (
        <>
          <div className="field">
            <span>Height · {height.toFixed(2)} m</span>
            <Segmented<string>
              label="Jump height"
              full
              value={String(nearest)}
              onChange={(h) => setJumpHeight(store, figure, at, Number(h))}
              options={JUMP_HEIGHTS.map((h) => ({ value: String(h), label: `${h} m` }))}
            />
          </div>
          <div className="field">
            <span>In the air</span>
            <Segmented<string>
              label="Turns in the air"
              full
              value={String(src.spin ?? 0)}
              onChange={(v) => set('jump', { spin: Number(v) })}
              options={[{ value: '0', label: 'No turn' }, { value: '0.5', label: '½' }, { value: '1', label: '1' }, { value: '2', label: '2' }]}
            />
            <Segmented<string>
              label="Flip"
              full
              value={String(src.flip ?? 0)}
              onChange={(v) => set('jump', { flip: Number(v) })}
              options={[{ value: '0', label: 'No flip' }, { value: '1', label: 'Front flip' }, { value: '-1', label: 'Back flip' }]}
            />
          </div>
        </>
      )}
      <p className="hint-text">Its steps are generated between the marks. Drag its mark on the floor to change where it goes; Glide moves it there as posed instead.</p>
    </Section>
  );
}
