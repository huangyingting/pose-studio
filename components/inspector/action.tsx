'use client';

import { BookmarkPlus, ChevronDown, Diamond, Ellipsis, Film, Footprints, Layers, Repeat, TriangleAlert, Users } from 'lucide-react';
import { clearMark, fitWarp, moveAction, recastRole, retime, setActionTarget, setBlend, setClipOptions, setJumpHeight, setTravel } from '@/lib/actions';
import { MAX_DURATION } from '@/lib/animation';
import { clipById } from '@/lib/assets';
import { overWarp, warpOf } from '@/lib/evaluate';
import { JUMP_PREP, jumpHeight } from '@/lib/locomotion';
import { actionLabel } from '@/lib/track';
import type { Action, Travel } from '@/lib/types';
import { applies, command, menu, menuItems, type Ctx } from '../commands';
import { Hint, Menu, NumberField, PropertyRow, Segmented, Select, Toggle, type HeaderChrome } from '../ui';
import type { Target } from './target';

/*
 * An action picked on the timeline: when it starts, how long it takes and blends in; for a motion
 * its speed, mirroring, the people in it, where its mark is and what it does with a prop; for a
 * walk, run or jump how the figure gets there. See sections.ts for which show when.
 */

export function ActionHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  const act = t.action!;
  const src = act.source;
  const Icon = src.kind === 'travel' ? Footprints : src.kind === 'keys' ? Diamond : act.layer === 'upper' ? Layers : act.roles.length > 1 ? Users : Film;
  const label = actionLabel(act, t.scene);
  return (
    <div className="panel-title">
      {chrome.before}
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      <span className="title-static" aria-label="Action">{label}</span>
      <Menu label={`${label} menu`} className="ibtn" align="end" tip="More" items={() => menu('action', { store: t.store, action: act.id, figure: t.actionFigure })}>
        <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
      </Menu>
      {chrome.after}
    </div>
  );
}

export const timingSummary = (t: Target) => `${t.action!.start.toFixed(2)}–${(t.action!.start + t.action!.duration).toFixed(2)} s`;

export function TimingPanel({ t }: { t: Target }) {
  const act = t.action!;
  const a = t.scene.animation!;
  const id = act.id;
  const who = t.scene.figures.find((f) => f.id === t.actionFigure);
  const ctx: Ctx = { store: t.store, action: id, figure: t.actionFigure ?? undefined };
  return (
    <>
      <PropertyRow label="Who">
        <span className="shot-time">{who?.name}{act.layer === 'upper' ? ' · upper body' : act.layer === 'correction' ? ' · correction' : ''}</span>
      </PropertyRow>
      <label className="field">
        <span>Starts</span>
        <NumberField prefix="s" label="Start" value={act.start} step={1 / a.fps} min={0} max={MAX_DURATION} onChange={(v) => moveAction(t.store, id, v, `act:${id}:start`)} />
      </label>
      <label className="field">
        <span>Takes</span>
        <NumberField prefix="s" label="Length" value={act.duration} step={1 / a.fps} min={1 / a.fps} max={MAX_DURATION} onChange={(v) => retime(t.store, id, v, `act:${id}:length`)} />
      </label>
      {!act.layer && act.source.kind !== 'keys' && (
        <label className="field">
          <span>Blends in</span>
          <NumberField prefix="s" label="Blend in" value={act.blendIn ?? 0} step={0.05} min={0} max={2} onChange={(v) => setBlend(t.store, id, v, `act:${id}:blend`)} />
        </label>
      )}
      {/* Played again, one after another; a keyed block kept as a motion. */}
      {applies(command('action.repeat'), ctx) && (
        <Menu label="Repeat" className="btn subtle move-to" items={() => menuItems(['action.repeat'], ctx)}>
          <Repeat size={14} aria-hidden /> Repeat <ChevronDown size={13} aria-hidden />
        </Menu>
      )}
      {applies(command('action.saveMotion'), ctx) && (
        <button type="button" className="btn subtle move-to" onClick={() => command('action.saveMotion').run!(ctx)}>
          <BookmarkPlus size={14} aria-hidden /> Save as a motion
        </button>
      )}
    </>
  );
}

const keyCount = (act: Action) => (act.source.kind === 'keys' ? act.source.clip.parts[0].tracks[0]?.times.length ?? 1 : 0);
export const posedTitle = (t: Target) => (t.action!.layer === 'correction' ? 'Correction' : 'Posed');
export const posedSummary = (t: Target) => (t.action!.layer === 'correction' ? 'Over a motion or a walk' : `${keyCount(t.action!)} keys`);
export const posedInfo = (t: Target) => (t.action!.layer === 'correction'
  ? 'Changes made over a motion or a walk: pose the figure at a time inside it to add one.'
  : 'Posed by hand: pose the figure at a key to change it; Move to… in the figure inspector (or right-click the floor) walks, runs or jumps between keys.');
export function PosedPanel({ t }: { t: Target }) {
  return <Hint>{posedSummary(t)}</Hint>;
}

const speedOf = (act: Action) => {
  if (act.source.kind !== 'clip') return 1;
  const clip = clipById(act.source.clip);
  return act.source.speed ?? (clip && !clip.loop ? (clip.duration * (act.source.repeat ?? 1)) / act.duration : 1);
};
/** How far its mark pulls a motion from where it ends by itself, if noticeably (#18). */
const pull = (t: Target) => {
  const act = t.action!;
  const w = !act.layer && act.roles.find((r) => r.figure === t.actionFigure)?.end ? warpOf(t.scene, act, t.actionFigure!) : null;
  if (!w || (w.distance < 0.05 && w.angle < 5)) return null;
  const parts = [w.distance >= 0.05 ? `${w.distance.toFixed(2)} m` : '', w.angle >= 5 ? `${Math.round(w.angle)}°` : ''].filter(Boolean).join(' and ');
  return `Its mark pulls it ${parts} from where it ends by itself`;
};
const tooFar = (t: Target) => !t.action!.layer && overWarp(t.scene, t.action!, t.actionFigure!);
export const motionSummary = (t: Target) => {
  const act = t.action!;
  const mirror = act.source.kind === 'clip' && act.source.mirror;
  return `×${Math.round(speedOf(act) * 100) / 100}${mirror ? ' · mirrored' : ''}${tooFar(t) ? ' · too far' : ''}`;
};
export const motionInfo = (t: Target) => (t.action!.layer ? undefined : 'Drag its mark on the floor to where it ends: the motion stretches up to ±25% and turns up to ±30° to get there.');

export function MotionPanel({ t }: { t: Target }) {
  const act = t.action!;
  if (act.source.kind !== 'clip') return null;
  const src = act.source;
  const speed = speedOf(act);
  return (
    <>
      <label className="field">
        <span>Speed</span>
        <NumberField prefix="×" label="Speed" value={Math.round(speed * 100) / 100} step={0.05} min={0.25} max={4} onChange={(v) => setClipOptions(t.store, act.id, { speed: v }, `act:${act.id}:speed`)} />
      </label>
      <Toggle label="Mirrored" hint="Left for right" checked={!!src.mirror} onChange={(mirror) => setClipOptions(t.store, act.id, { mirror })} />
      {!tooFar(t) && pull(t) && (
        <div className="warp-note">
          <p>{pull(t)}</p>
          <button type="button" className="btn subtle" onClick={() => clearMark(t.store, act.id, t.actionFigure!)}>Let it end there</button>
        </div>
      )}
      {tooFar(t) && (
        <div className="warp-warn">
          <p><TriangleAlert size={12} aria-hidden /> Its mark is further than the motion can stretch (±25%, ±30°).</p>
          <div className="row">
            <button type="button" className="btn subtle" onClick={() => fitWarp(t.store, act.id, t.actionFigure!, 'back')}>Move it back</button>
            <button type="button" className="btn subtle" onClick={() => fitWarp(t.store, act.id, t.actionFigure!, 'walk')}>Walk the rest</button>
          </div>
        </div>
      )}
    </>
  );
}

export const peopleSummary = (t: Target) => t.action!.roles.map((r) => t.scene.figures.find((f) => f.id === r.figure)?.name).join(', ');

export function PeoplePanel({ t }: { t: Target }) {
  const act = t.action!;
  const clip = act.source.kind === 'clip' ? clipById(act.source.clip) : null;
  const names = (n: number) => clip?.parts[n]?.name || `Part ${n + 1}`;
  return act.roles.map((r, n) => (
    <div className="field" key={n}>
      <span>{names(n)}</span>
      <Select
        label={`${names(n)}: who`}
        value={r.figure}
        onChange={(v) => recastRole(t.store, act.id, n, v)}
        options={t.scene.figures.filter((f) => !f.proxy).map((f) => ({ value: f.id, label: f.name }))}
      />
    </div>
  ));
}

export const actionPropTitle = (t: Target) => t.scene.props.find((p) => p.id === t.action!.prop)?.name ?? 'Prop';
export const actionPropSummary = (t: Target) => {
  const act = t.action!;
  const target = act.target!;
  return 'figure' in target ? (target.figure === act.roles[0].figure ? 'Tossed up' : 'Passed') : 'hoop' in target ? (target.miss ? 'Off the rim' : 'Shot') : 'at' in target ? 'Thrown' : 'Bounced';
};

/** What the motion does with its prop: passed, tossed, shot or thrown. */
export function ActionPropPanel({ t }: { t: Target }) {
  const act = t.action!;
  const target = act.target!;
  return (
    <>
      {'figure' in target && target.figure !== act.roles[0].figure && (
        <div className="field">
          <span>Passed to</span>
          <Select
            label="Passed to"
            value={`${target.figure}:${target.hand}`}
            onChange={(v) => { const [f, hand] = v.split(':'); setActionTarget(t.store, act.id, { figure: f, hand: hand as 'L' | 'R' }); }}
            options={t.scene.figures.filter((f) => f.id !== act.roles[0].figure).flatMap((f) => (['R', 'L'] as const).map((hand) => ({ value: `${f.id}:${hand}`, label: `${f.name}: ${hand === 'L' ? 'left' : 'right'} hand` })))}
          />
        </div>
      )}
      {'figure' in target && target.figure === act.roles[0].figure && <PropertyRow label="Throw"><span>Up {target.rise ?? 2} m and caught</span></PropertyRow>}
      {'hoop' in target && (
        <Toggle label="Off the rim" hint="The shot misses: it hits the front of the rim" checked={!!target.miss} onChange={(miss) => setActionTarget(t.store, act.id, { hoop: target.hoop, ...(miss ? { miss } : {}) })} />
      )}
      {'at' in target && <PropertyRow label="Throw"><span>To {target.at[0].toFixed(1)}, {target.at[1].toFixed(1)}</span></PropertyRow>}
      {'bounce' in target && <PropertyRow label="Throw"><span>Bounced back to the hand</span></PropertyRow>}
    </>
  );
}

type Getting = 'glide' | Travel;
const JUMP_HEIGHTS = [0.3, 0.5, 0.8, 1.2];

export const gettingSummary = (t: Target) => {
  const src = t.action!.source;
  return src.kind === 'travel' ? `${src.mode[0].toUpperCase()}${src.mode.slice(1)}${src.strafe ? ' · keeps facing' : ''}` : undefined;
};

/** How the figure gets to its mark: walking, running or jumping there (or gliding as keyed); for a jump its height and turns. */
export function GettingPanel({ t }: { t: Target }) {
  const act = t.action!;
  if (act.source.kind !== 'travel') return null;
  const src = act.source;
  const figure = t.actionFigure!;
  const at = act.start + act.duration;
  const keep = { strafe: src.strafe, spin: src.spin, flip: src.flip };
  const set = (k: Getting, patch: { strafe?: boolean; spin?: number; flip?: number } = {}) => setTravel(t.store, figure, at, k === 'glide' ? null : k, { ...keep, ...patch });
  const height = src.mode === 'jump' ? jumpHeight(Math.max(0, act.duration - 2 * JUMP_PREP)) : 0;
  const nearest = JUMP_HEIGHTS.reduce((b, h) => (Math.abs(h - height) < Math.abs(b - height) ? h : b));
  return (
    <>
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
              onChange={(h) => setJumpHeight(t.store, figure, at, Number(h))}
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
    </>
  );
}
