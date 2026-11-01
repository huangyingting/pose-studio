'use client';

import { useState, useSyncExternalStore } from 'react';
import {
  ArrowLeftRight, ChevronDown, Copy, Eye, Footprints, Hand, Mars, Minus, Navigation, PanelLeft, PanelRight, PersonStanding, Pin, Plus, Repeat, RotateCcw, Unlink, UserRound, Venus, X,
} from 'lucide-react';
import {
  arrange, offsetPerformance, setIdleLife, holdOn, letGo, lookAtFigure, reachFor, renameFigure, setDistance, setFigureColor, setFigureModel, setGaze, setGrounded, setHand, setJoint, setPlacement, setPosture, stepJoint,
} from '@/lib/actions';
import { BUILD, HEIGHT, buildOf } from '@/lib/body';
import { BUILT_IN_CHARACTERS } from '@/lib/characters';
import { figurePoseAt, travelAt } from '@/lib/evaluate';
import { HAND_PRESETS } from '@/lib/hands';
import { JOINT_LABELS, axisEnds, axisLabels, jointLimits, wrapDeg } from '@/lib/joints';
import { modelTrouble, onModels } from '@/lib/model';
import { angle } from '@/lib/pose';
import { CONTACTS, CONTACT_LABELS, distance, facing, type Contact } from '@/lib/relations';
import { FIGURE_COLORS, FINGERS, POSTURES, type Constraint, type Hand as HandPose, type Posture, type Scene, type Side, type Vec3 } from '@/lib/types';
import BodyMap from '../BodyMap';
import { sliderName } from '../hints';
import { STEPS } from '../modifiers';
import { CommandButton } from '../CommandButton';
import { command, figureMenu, menuItems, selectionCtx, shortcutOf } from '../commands';
import { useScene, useStore, useStudio } from '../store-context';
import { IconButton, Menu, NameHeader, NumberField, Segmented, Select, Slider, Toggle, Toolbar, type HeaderChrome } from '../ui';
import type { Target } from './target';

/* A figure's (or a stand-in's) header and sections: see sections.ts for which show when. */

export const POSTURE_LABELS: Record<Posture, string> = { stand: 'Stand', sit: 'Sit', lie: 'Lie' };

export function FigureHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  const figure = t.figure!;
  const Icon = figure.proxy ? UserRound : PersonStanding;
  return (
    <NameHeader
      chrome={chrome}
      lead={<Icon size={17} strokeWidth={1.75} aria-hidden />}
      name={figure.name}
      label="Figure name"
      onRename={(name) => renameFigure(t.store, figure.id, name)}
      menu={() => figureMenu(t.store, figure.id, t.joint)}
    >
      {figure.hidden && <span className="title-note">Hidden</span>}
    </NameHeader>
  );
}

/** A part of a figure: its name (under the figure's, in the crumbs), the part's and the figure's menu. */
export function JointHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  return <NameHeader chrome={chrome} lead={null} name={JOINT_LABELS[t.joint!]} label="Part" menu={() => figureMenu(t.store, t.figure!.id, t.joint)} />;
}

export function StandInPanel({ t }: { t: Target }) {
  const figure = t.figure!;
  return (
    <>
      <Segmented<Posture>
        label="Posture"
        full
        value={figure.proxy!}
        onChange={(p) => setPosture(t.store, figure.id, p)}
        options={POSTURES.map((p) => ({ value: p, label: POSTURE_LABELS[p] }))}
      />
      <button type="button" className="btn subtle" onClick={() => setPosture(t.store, figure.id, null)}>Make it a posable figure</button>
    </>
  );
}

/** The selected part: its sliders, next to a small map to pick another. */
/** A − or + that steps a joint's slider 5° (Shift 15°), again and again while it is held. */
function StepButton({ label, by, end, onStep }: { label: string; by: 1 | -1; end: string; onStep(deg: number): void }) {
  const press = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const deg = by * STEPS.joint * (e.shiftKey ? 3 : 1);
    onStep(deg);
    let timer = window.setTimeout(function again() { onStep(deg); timer = window.setTimeout(again, 90); }, 400);
    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
  return (
    <button
      type="button"
      className="joint-step"
      aria-label={label}
      data-tip={`${by < 0 ? '−' : '+'}5°${end ? `, ${end}` : ''} (Shift: 15°; hold for more)`}
      onPointerDown={press}
      // (From the keyboard: Enter or Space.)
      onClick={(e) => { if (e.detail === 0) onStep(by * STEPS.joint * (e.shiftKey ? 3 : 1)); }}
    >
      {by < 0 ? <Minus size={15} aria-hidden /> : <Plus size={15} aria-hidden />}
    </button>
  );
}

/**
 * The selected part: the body map (big, its sides marked L and R: the figure's own, seen from
 * the front), and a slider per turn with − and + either side of its track (what each does in its tip).
 */
export function JointPanel({ t }: { t: Target }) {
  const limits = useStudio((s) => s.settings.limits);
  const figure = t.figure!;
  const joint = t.joint!;
  const rot = angle(figure.bones, joint);
  const ends = axisEnds(joint);
  return (
    <div className="joint-edit">
      <BodyMap selected={joint} onSelect={(j) => t.store.select({ kind: 'joint', figure: figure.id, joint: j })} />
      <div className="stack">
        {axisLabels(joint).map((_, axis) => {
          const [min, max] = limits ? jointLimits(joint)[axis] : [-180, 180];
          // (A slider the joint does not have, with the limits on.)
          if (limits && min === max) return null;
          const name = sliderName(joint, axis);
          const [minus, plus] = ends[axis];
          return (
            <div key={axis} className={`joint-row axis-${'xyz'[axis]}`}>
              <Slider
                label={name}
                before={<StepButton label={`${name} −5°`} by={-1} end={minus} onStep={(d) => stepJoint(t.store, figure.id, joint, axis, d)} />}
                after={<StepButton label={`${name} +5°`} by={1} end={plus} onStep={(d) => stepJoint(t.store, figure.id, joint, axis, d)} />}
                axis={axis}
                min={min}
                max={max}
                value={Math.min(max, Math.max(min, rot[axis]))}
                display={`${Math.round(rot[axis])}°`}
                typeable
                onChange={(v) => {
                  const next: Vec3 = [...rot];
                  next[axis] = v;
                  setJoint(t.store, figure.id, joint, next, `slider:${figure.id}:${joint}:${axis}`);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function JointActions({ t }: { t: Target }) {
  return (
    <>
      <IconButton icon={RotateCcw} label="Reset joint" onClick={() => setJoint(t.store, t.figure!.id, t.joint!, [0, 0, 0], '')} />
      <IconButton icon={X} label="Deselect" shortcut={shortcutOf('app.deselect')} onClick={() => t.store.select(null)} />
    </>
  );
}

export const jointSummary = (t: Target) => `${angle(t.figure!.bones, t.joint!).map((r) => Math.round(r)).join(' / ')}°`;

/** Pick a part to fine-tune (folded away until wanted: on the canvas a click does the same). */
export function JointsPanel({ t }: { t: Target }) {
  return <BodyMap selected={null} onSelect={(j) => t.store.select({ kind: 'joint', figure: t.figure!.id, joint: j })} />;
}

export function PosePanel({ t }: { t: Target }) {
  const c = selectionCtx(t.store);
  return (
    <Toolbar label="Pose">
      <CommandButton id="pose.mirror" ctx={c} />
      <button type="button" className="ibtn text" data-tip="Copy left side onto right" aria-label="Left → Right" onClick={() => command('pose.leftToRight').run!(c)}>L→R</button>
      <button type="button" className="ibtn text" data-tip="Copy right side onto left" aria-label="Right → Left" onClick={() => command('pose.rightToLeft').run!(c)}>R→L</button>
      <span className="toolrow-sep" />
      <CommandButton id="pose.copy" ctx={c} />
      <CommandButton id="pose.paste" ctx={c} />
      <span className="toolrow-sep" />
      <CommandButton id="pose.reset" ctx={c} />
    </Toolbar>
  );
}

/** Where the figure stands and which way it faces; where it goes next. */
export function PlacementPanel({ t }: { t: Target }) {
  const figure = t.figure!;
  const store = t.store;
  const animation = t.scene.animation;
  const time = useStudio((s) => s.time);
  // Between two marks of a walk, run or jump the generated steps place the figure.
  const travel = animation ? travelAt(animation, figure.id, time) : null;
  const moving = travel && time > travel.start + 1e-6 && time < travel.start + travel.duration - 1e-6;
  const start = animation ? figurePoseAt(t.scene, figure.id, 0) : null;
  return (
    <>
      <div className="prop-row">
        <span className="prop-row-label">Floor</span>
        <NumberField prefix="X" label="Position X" value={figure.position[0]} step={0.05} onChange={(x) => setPlacement(store, figure.id, { x }, `place:${figure.id}:x`)} />
        <NumberField prefix="Z" label="Position Z" value={figure.position[2]} step={0.05} onChange={(z) => setPlacement(store, figure.id, { z }, `place:${figure.id}:z`)} />
        <NumberField prefix="↻" label="Facing" value={facing(figure)} step={5} digits={0} onChange={(yaw) => setPlacement(store, figure.id, { yaw }, `place:${figure.id}:yaw`)} />
      </div>
      {start && (
        // Where its performance starts: changing it moves (or turns, about there) all it does, without a key.
        <div className="prop-row" data-tip="Where it starts: changing it moves all it does, without a key (Ctrl + arrows)">
          <span className="prop-row-label">Starts at</span>
          <NumberField prefix="X" label="Whole performance X" value={start.position[0]} step={0.05} onChange={(x) => offsetPerformance(store, [figure.id], { dx: x - start.position[0] }, `whole:${figure.id}:x`)} />
          <NumberField prefix="Z" label="Whole performance Z" value={start.position[2]} step={0.05} onChange={(z) => offsetPerformance(store, [figure.id], { dz: z - start.position[2] }, `whole:${figure.id}:z`)} />
          <NumberField prefix="↻" label="Whole performance facing" value={facing(start)} step={5} digits={0} onChange={(yaw) => offsetPerformance(store, [figure.id], { turn: wrapDeg(yaw - facing(start)), about: [start.position[0], start.position[2]] }, `whole:${figure.id}:yaw`)} />
        </div>
      )}
      {!figure.proxy && (
        // Walking, running, jumping or stepping somewhere, or throwing what it holds: picked on the floor.
        <Menu label="Move to…" className="btn subtle move-to" items={() => menuItems(['figure.walk', 'figure.run', 'figure.jump', 'figure.step', 'figure.throw', 'figure.wholeTo'], { store, figure: figure.id })}>
          <Footprints size={15} aria-hidden /> Move to… <ChevronDown size={14} aria-hidden />
        </Menu>
      )}
      {animation && !figure.proxy && (
        // In the gaps of what it does: breathing, small shifts, a look at someone now and then.
        <Toggle label="Idle life" checked={!figure.still} hint="Between what it does, it breathes and looks around (as the scene plays)" onChange={(on) => setIdleLife(store, figure.id, on)} />
      )}
      {!moving && (
        <Toggle
          label="On the floor"
          checked={figure.grounded}
          hint="Off: the figure keeps its height (to sit on a chair, say)"
          onChange={(on) => setGrounded(store, figure.id, on, t.ctx.rootPosition(figure.id) ?? undefined)}
        />
      )}
    </>
  );
}

export const placementSummary = (t: Target) => {
  const f = t.figure!;
  return `${f.position[0].toFixed(1)}, ${f.position[2].toFixed(1)} · ${Math.round(facing(f))}°${f.grounded ? '' : ' · raised'}`;
};

/** What a hold is, in words: "Left hand on Kai's chest". */
function holdLabel(c: Constraint, scene: Scene) {
  const part = c.bone.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (x) => x.toUpperCase());
  const target = c.target;
  const on = 'figure' in target ? `${scene.figures.find((f) => f.id === target.figure)?.name ?? 'someone'}'s ${JOINT_LABELS[target.bone].toLowerCase()}` : 'prop' in target ? scene.props.find((p) => p.id === target.prop)?.name ?? 'a prop' : 'a spot';
  return `${part} on ${on}`;
}

/** People to act with: not hidden ones. */
const othersOf = (t: Target) => t.scene.figures.filter((f) => f.id !== t.figure!.id && !f.hidden);
const holdsOf = (t: Target) => (t.scene.animation?.constraints ?? []).filter((c) => c.figure === t.figure!.id);
export const hasOthers = (t: Target) => othersOf(t).length > 0 || t.scene.props.length > 0;
export const othersSummary = (t: Target) => {
  const holds = holdsOf(t);
  return t.figure!.gaze ? 'Eyes on someone' : holds.length ? `${holds.length} ${holds.length === 1 ? 'hold' : 'holds'}` : 'No holds';
};

/** The figure with the others: where it keeps its eyes, and placing and touching another figure. */
export function OthersPanel({ t }: { t: Target }) {
  const store = useStore();
  const scene = useScene();
  const figure = t.figure!;
  const others = othersOf(t);
  const [otherId, setOtherId] = useState(others[0]?.id ?? '');
  const [side, setSide] = useState<Side>('R');
  const [contact, setContact] = useState<Contact>('leftUpperArm');
  const other = others.find((f) => f.id === otherId) ?? others[0];
  const gaze = !figure.gaze ? 'free' : 'figure' in figure.gaze ? `f:${figure.gaze.figure}` : `p:${figure.gaze.prop}`;
  const d = other ? distance(figure, other) : 0;
  const holds = holdsOf(t);
  return (
    <>
      {!figure.proxy && (
        <div className="relation-target">
          <span>Eyes on</span>
          <Select
            label="Eyes on"
            value={gaze}
            onChange={(v) => setGaze(store, figure.id, v === 'free' ? null : v.startsWith('f:') ? { figure: v.slice(2) } : { prop: v.slice(2) })}
            options={[
              { value: 'free', label: 'Free (as posed)' },
              ...others.map((f) => ({ value: `f:${f.id}`, label: f.name })),
              ...scene.props.map((p) => ({ value: `p:${p.id}`, label: p.name })),
            ]}
          />
        </div>
      )}
      {other && (
        <>
          <div className="relation-target">
            <span>To</span>
            <Select label="Other figure" value={other.id} onChange={setOtherId} options={others.map((f) => ({ value: f.id, label: f.name }))} />
          </div>
          <Toolbar label="Place with the other figure">
            <IconButton icon={Navigation} label="Turn to" onClick={() => arrange(store, figure.id, other.id, 'face')} />
            <IconButton icon={ArrowLeftRight} label="Face each other" onClick={() => arrange(store, figure.id, other.id, 'faceEachOther')} />
            <IconButton icon={Eye} label="Look at" onClick={() => lookAtFigure(store, figure.id, other.id)} />
            <IconButton icon={PanelLeft} label="Beside (left)" onClick={() => arrange(store, figure.id, other.id, 'besideL')} />
            <IconButton icon={PanelRight} label="Beside (right)" onClick={() => arrange(store, figure.id, other.id, 'besideR')} />
            <IconButton icon={Repeat} label="Back to back" onClick={() => arrange(store, figure.id, other.id, 'backToBack')} />
          </Toolbar>
          <Slider
            label="Distance"
            min={0.2}
            max={4}
            step={0.01}
            value={Math.min(4, Math.max(0.2, d))}
            display={`${d.toFixed(2)} m`}
            typeable
            onChange={(v) => setDistance(store, figure.id, other.id, v, `dist:${figure.id}`)}
          />
          {!figure.proxy && !other.proxy && (
            <div className="reach">
              <span className="reach-label">Reach</span>
              <Segmented<Side> label="Hand" value={side} onChange={setSide} options={[{ value: 'L', label: 'Left hand' }, { value: 'R', label: 'Right hand' }]} full />
              <div className="reach-row">
                <Select<Contact>
                  label="Touch"
                  value={contact}
                  onChange={setContact}
                  options={CONTACTS.map((c) => ({ value: c, label: `${other.name}: ${CONTACT_LABELS[c]}` }))}
                />
                <button
                  type="button"
                  className="btn subtle"
                  onClick={() => {
                    if (!reachFor(store, figure.id, side, other.id, contact)) t.ctx.notify('Out of reach: move the figures closer', 'error');
                  }}
                >
                  <Hand size={15} aria-hidden /> Reach
                </button>
                {scene.animation && (
                  <button
                    type="button"
                    className="btn subtle"
                    data-tip="Keep the hand there from now to the end of what it is doing, however they move"
                    onClick={() => {
                      if (!holdOn(store, figure.id, side, other.id, contact)) t.ctx.notify('Out of reach now: the hand stretches towards it', 'error');
                    }}
                  >
                    <Pin size={15} aria-hidden /> Hold on
                  </button>
                )}
              </div>
            </div>
          )}
          {holds.length > 0 && (
            <ul className="holds" aria-label="Holds">
              {holds.map((c) => (
                <li key={c.id}>
                  <span>{holdLabel(c, scene)}</span>
                  <em>{c.start.toFixed(1)}–{c.end.toFixed(1)} s</em>
                  <IconButton icon={Unlink} label="Let go here" size={14} onClick={() => letGo(store, c.id)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

/** The hand preset a hand is in, if any. */
const presetOf = (hand: HandPose) => HAND_PRESETS.find((p) => p.hand.spread === hand.spread && p.hand.curl.every((c, i) => c === hand.curl[i]))?.name ?? '';
export const handsSummary = (t: Target) => (['L', 'R'] as const).map((s) => presetOf(t.figure!.hands[s]) || 'Custom').join(' / ');

export function HandsPanel({ t }: { t: Target }) {
  const hands = t.figure!.hands;
  const [side, setSide] = useState<Side>('L');
  const hand = hands[side];
  const preset = presetOf(hand);
  return (
    <>
      <Segmented<Side> label="Hand" full value={side} onChange={setSide} options={[{ value: 'L', label: 'Left hand' }, { value: 'R', label: 'Right hand' }]} />
      <div className="chips">
        {HAND_PRESETS.map((p) => (
          <button key={p.name} type="button" className={p.name === preset ? 'chip on' : 'chip'} onClick={() => setHand(t.store, side, p.hand)}>{p.name}</button>
        ))}
      </div>
      <div className="stack">
        {FINGERS.map((f, i) => (
          <Slider
            key={f}
            label={f[0].toUpperCase() + f.slice(1)}
            min={0}
            max={1}
            step={0.01}
            value={hand.curl[i]}
            display={`${Math.round(hand.curl[i] * 100)}%`}
            onChange={(v) => {
              const curl = [...hand.curl] as HandPose['curl'];
              curl[i] = v;
              setHand(t.store, side, { ...hand, curl }, `hand:${side}:${i}`);
            }}
          />
        ))}
        <Slider
          label="Spread"
          min={0}
          max={1}
          step={0.01}
          value={hand.spread}
          display={`${Math.round(hand.spread * 100)}%`}
          onChange={(spread) => setHand(t.store, side, { ...hand, spread }, `hand:${side}:spread`)}
        />
      </div>
      <button type="button" className="btn subtle" onClick={() => setHand(t.store, side === 'L' ? 'R' : 'L', hand)}>
        <Copy size={15} aria-hidden /> Copy to {side === 'L' ? 'right' : 'left'} hand
      </button>
    </>
  );
}

const modelsOf = (t: Target) => [...BUILT_IN_CHARACTERS, ...(t.store.getState().library.models ?? [])];
export const bodySummary = (t: Target) => modelsOf(t).find((m) => m.id === t.figure!.model)?.name
  ?? `${t.figure!.body.sex >= 0.5 ? 'Woman' : 'Man'} · ${HEIGHT.format(t.figure!.body.height)}${buildOf(t.figure!.body) === 1 ? '' : ` · ${buildOf(t.figure!.body) < 1 ? 'slimmer' : 'heavier'}`}`;

/** Who the figure is: drawn as the mannequin or a character, its colour in the scene, its body. */
export function BodyPanel({ t }: { t: Target }) {
  useStudio((s) => s.library.models);
  const store = t.store;
  const figure = t.figure!;
  const body = figure.body;
  const setBody = (patch: Partial<typeof body>, key = '') => store.updateFigure(figure.id, (f) => ({ ...f, body: { ...f.body, ...patch } }), key);
  const models = modelsOf(t);
  const drawnAs = figure.model && models.some((m) => m.id === figure.model);
  const trouble = useSyncExternalStore(onModels, () => (figure.model ? modelTrouble(figure.model) : null), () => null);
  return (
    <>
      <div className="field">
        <span>Drawn as</span>
        <Select<string>
          label="Character"
          value={drawnAs ? figure.model! : ''}
          onChange={(v) => setFigureModel(store, figure.id, v || null)}
          options={[{ value: '', label: 'Mannequin' }, ...models.map((m) => ({ value: m.id, label: m.name }))]}
        />
      </div>
      {drawnAs && trouble && (
        <p className="hint">
          {trouble === 'unfetched' ? 'Its file could not be fetched (offline?): the mannequin stands in until it comes.' : 'Its file could not be read: the mannequin stands in.'}
        </p>
      )}
      <div className="swatches" role="radiogroup" aria-label="Colour">
        <button type="button" role="radio" aria-checked={!figure.color} aria-label="No colour" className={`swatch none${!figure.color ? ' on' : ''}`} onClick={() => setFigureColor(store, figure.id, null)} />
        {FIGURE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={figure.color === c}
            aria-label={`Colour ${c}`}
            className={`swatch${figure.color === c ? ' on' : ''}`}
            style={{ background: c }}
            onClick={() => setFigureColor(store, figure.id, c)}
          />
        ))}
      </div>
      {/* A body is a man or a woman (Y Bot or X Bot) and a height; a character is drawn at its height. */}
      {!drawnAs && (
        <Segmented<'man' | 'woman'>
          label="Man or woman"
          value={body.sex >= 0.5 ? 'woman' : 'man'}
          onChange={(v) => setBody({ sex: v === 'woman' ? 1 : 0 })}
          options={[{ value: 'man', label: 'Man', icon: Mars }, { value: 'woman', label: 'Woman', icon: Venus }]}
          full
        />
      )}
      <Slider label="Height" min={HEIGHT.min} max={HEIGHT.max} step={HEIGHT.step} value={body.height} display={HEIGHT.format(body.height)} onChange={(height) => setBody({ height }, 'body:height')} />
      {!drawnAs && (
        <Slider label="Build" min={BUILD.min} max={BUILD.max} step={BUILD.step} value={buildOf(body)} display={BUILD.format(buildOf(body))} onChange={(b) => setBody({ breadth: Math.abs(b - 1) < 0.005 ? undefined : b }, 'body:build')} />
      )}
    </>
  );
}
