'use client';

import { useState } from 'react';
import {
  ArrowDownToLine, ArrowLeftRight, ChevronRight, Clapperboard, ClipboardCopy, ClipboardPaste, Copy, Eye, EyeOff, FlipHorizontal2, Hand, ImagePlus, Mars, Navigation,
  PanelLeft, PanelRight, PanelRightClose, PersonStanding, Repeat, RotateCcw, Trash2, UserRound, Venus, X, type LucideIcon,
} from 'lucide-react';
import {
  arrange, copyPose, holdProp, renameScene, setFigureColor, setGaze, setJumpHeight, setPosture, setSceneLight, setTravel, lookAtFigure, mirrorPose, pastePose,
  reachFor, renameFigure, renameProp, resetPose, setDistance, setGrounded, setHand, setJoint, setPlacement, symmetrizePose,
} from '@/lib/actions';
import { figureKeyTimes } from '@/lib/animation';
import { BODY_FIELDS, BODY_PRESETS } from '@/lib/body';
import { HAND_PRESETS } from '@/lib/hands';
import { HOLDABLE } from '@/lib/hold';
import { JUMP_PREP, chainAt, jumpHeight } from '@/lib/locomotion';
import { JOINT_LABELS, axisLabels, jointLimits } from '@/lib/joints';
import { DEFAULT_LIGHT, LIGHT_PRESETS } from '@/lib/lighting';
import { CONTACTS, CONTACT_LABELS, distance, facing, type Contact } from '@/lib/relations';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { FIGURE_COLORS, FINGERS, POSTURES, type Figure, type JointName, type Posture, type Hand as HandPose, type Light, type Side, type Travel, type Vec3, type View, PROP_LABELS } from '@/lib/types';
import BodyMap from './BodyMap';
import ShotInspector from './ShotInspector';
import { PROP_ICONS } from './icons';
import { useActiveFigure, useScene, useStore, useStudio } from './store-context';
import { IconButton, NameHeader, NumberField, Section, Segmented, Select, Slider, Toggle, type HeaderChrome, type Notify } from './ui';

export interface InspectorContext {
  currentView(): View | null;
  rootPosition(figure: string): Vec3 | null;
  notify: Notify;
  /** Toast with an Undo button. */
  notifyUndo(text: string): void;
  reference: { url: string | null; opacity: number; visible: boolean };
  setReference(r: Partial<{ url: string | null; opacity: number; visible: boolean }>): void;
}

/**
 * Right-hand properties panel. It shows what is selected, as a design tool's inspector does: a
 * figure (its pose, place, others, movement, hands and body), a prop, a shot, or the scene itself
 * (its light and look; the "Scene" crumb in the header). It folds away for more canvas.
 */
export default function Inspector({ ctx, onHide }: { ctx: InspectorContext; onHide(): void }) {
  const store = useStore();
  const selection = useStudio((s) => s.selection);
  const figure = useActiveFigure();
  const scene = useScene();
  const hide = <IconButton icon={PanelRightClose} label="Hide the inspector" shortcut="I" className="panel-hide hide-mobile" size={15} onClick={onHide} />;
  const chrome: HeaderChrome = {
    before: (
      <button type="button" className="crumb" data-tip="The scene: its light and look" onClick={() => store.select({ kind: 'scene' })}>
        Scene <ChevronRight size={12} aria-hidden />
      </button>
    ),
    after: hide,
  };

  let content;
  if (selection?.kind === 'prop' && scene.props.some((p) => p.id === selection.prop)) content = <PropEditor id={selection.prop} chrome={chrome} />;
  else if (selection?.kind === 'shot') content = <ShotInspector id={selection.shot} notify={ctx.notify} chrome={chrome} />;
  else if (selection?.kind === 'scene' || !figure) content = <SceneInspector ctx={ctx} chrome={{ after: hide }} />;
  else content = <FigureInspector figure={figure} ctx={ctx} chrome={chrome} />;

  return (
    <aside className="panel" aria-label="Inspector">
      <div className="panel-scroll">{content}</div>
    </aside>
  );
}

/* ---------------- Figure ---------------- */

const POSTURE_LABELS: Record<Posture, string> = { stand: 'Stand', sit: 'Sit', lie: 'Lie' };

function FigureHeader({ figure, chrome }: { figure: Figure; chrome: HeaderChrome }) {
  const store = useStore();
  const Icon = figure.proxy ? UserRound : PersonStanding;
  return (
    <NameHeader
      chrome={chrome}
      lead={<Icon size={16} strokeWidth={1.75} aria-hidden />}
      name={figure.name}
      label="Figure name"
      onRename={(name) => renameFigure(store, figure.id, name)}
    >
      {figure.hidden && <span className="title-note">Hidden</span>}
    </NameHeader>
  );
}

function FigureInspector({ figure, ctx, chrome }: { figure: Figure; ctx: InspectorContext; chrome: HeaderChrome }) {
  const store = useStore();
  const selection = useStudio((s) => s.selection);
  const joint = selection?.kind === 'joint' && selection.figure === figure.id ? selection.joint : null;

  if (figure.proxy) {
    return (
      <>
        <FigureHeader figure={figure} chrome={chrome} />
        <Section title="Stand-in">
          <Segmented<Posture>
            label="Posture"
            full
            value={figure.proxy}
            onChange={(p) => setPosture(store, figure.id, p)}
            options={POSTURES.map((p) => ({ value: p, label: POSTURE_LABELS[p] }))}
          />
          <p className="hint-text">A simple shape for blocking a scene: place it, turn it and key it like a figure.</p>
          <button type="button" className="btn subtle" onClick={() => setPosture(store, figure.id, null)}>Make it a posable figure</button>
        </Section>
        <PlacementSection figure={figure} ctx={ctx} />
        <OthersSection figure={figure} ctx={ctx} />
        <MovementSection figure={figure} />
      </>
    );
  }

  return (
    <>
      <FigureHeader figure={figure} chrome={chrome} />
      {joint && <JointSection figure={figure} joint={joint} />}
      <PoseSection ctx={ctx} />
      {!joint && <JointPicker figure={figure} />}
      <PlacementSection figure={figure} ctx={ctx} />
      <OthersSection figure={figure} ctx={ctx} />
      <MovementSection figure={figure} />
      <HandsSection hands={figure.hands} />
      <BodySection figure={figure} />
    </>
  );
}

/** The selected part: its sliders, next to a small map to pick another. */
function JointSection({ figure, joint }: { figure: Figure; joint: JointName }) {
  const store = useStore();
  const limits = useStudio((s) => s.settings.limits);
  const rot = figure.joints[joint] ?? [0, 0, 0];
  return (
    <Section
      title={JOINT_LABELS[joint]}
      actions={(
        <>
          <IconButton icon={RotateCcw} label="Reset joint" onClick={() => setJoint(store, figure.id, joint, [0, 0, 0], '')} />
          <IconButton icon={X} label="Deselect" shortcut="Esc" onClick={() => store.select(null)} />
        </>
      )}
    >
      <div className="joint-edit">
        <BodyMap selected={joint} onSelect={(j) => store.select({ kind: 'joint', figure: figure.id, joint: j })} />
        <div className="stack">
          {axisLabels(joint).map((label, axis) => {
            const [min, max] = limits ? jointLimits(joint)[axis] : [-180, 180];
            return (
              <Slider
                key={axis}
                label={label}
                min={min}
                max={max}
                value={Math.min(max, Math.max(min, rot[axis]))}
                display={`${Math.round(rot[axis])}°`}
                typeable
                onChange={(v) => {
                  const next: Vec3 = [...rot];
                  next[axis] = v;
                  setJoint(store, figure.id, joint, next, `slider:${figure.id}:${joint}:${axis}`);
                }}
              />
            );
          })}
          {joint === 'root' && <p className="hint-text">To move the whole figure drag its torso; to turn it, the ring on the floor.</p>}
        </div>
      </div>
    </Section>
  );
}

/** Pick a part to fine-tune (folded away until wanted: on the canvas a click does the same). */
function JointPicker({ figure }: { figure: Figure }) {
  const store = useStore();
  return (
    <Section id="joints" title="Joints" collapsible defaultOpen={false}>
      <BodyMap selected={null} onSelect={(j) => store.select({ kind: 'joint', figure: figure.id, joint: j })} />
      <p className="hint-text">Pick a part here or click it on the canvas to fine-tune it with sliders.</p>
    </Section>
  );
}

function PoseSection({ ctx }: { ctx: InspectorContext }) {
  const store = useStore();
  const limits = useStudio((s) => s.settings.limits);
  return (
    <Section title="Pose">
      <div className="toolrow">
        <IconButton icon={FlipHorizontal2} label="Mirror pose" shortcut="M" onClick={() => mirrorPose(store)} />
        <button type="button" className="ibtn text" data-tip="Copy left side onto right" aria-label="Left → Right" onClick={() => symmetrizePose(store, 'L')}>L→R</button>
        <button type="button" className="ibtn text" data-tip="Copy right side onto left" aria-label="Right → Left" onClick={() => symmetrizePose(store, 'R')}>R→L</button>
        <span className="toolrow-sep" />
        <IconButton icon={ClipboardCopy} label="Copy pose" shortcut="Ctrl C" onClick={() => { if (copyPose(store)) ctx.notify('Pose copied'); }} />
        <IconButton icon={ClipboardPaste} label="Paste pose" shortcut="Ctrl V" onClick={() => { if (!pastePose(store)) ctx.notify('Copy a pose first', 'error'); }} />
        <span className="toolrow-sep" />
        <IconButton icon={RotateCcw} label="Reset pose" onClick={() => resetPose(store)} />
      </div>
      <Toggle label="Natural joint limits" checked={limits} onChange={(l) => store.setSettings({ limits: l })} />
    </Section>
  );
}

/** Where the figure stands and which way it faces. */
function PlacementSection({ figure, ctx }: { figure: Figure; ctx: InspectorContext }) {
  const store = useStore();
  const animation = useScene().animation;
  const time = useStudio((s) => s.time);
  // Between two marks of a walk, run or jump the generated steps place the figure.
  const chain = animation ? chainAt(animation, figure.id, time) : null;
  const moving = chain && time > chain.t0 + 1e-6 && time < chain.t1 - 1e-6;
  return (
    <Section title="Placement">
      <div className="prop-row">
        <span className="prop-row-label">Floor</span>
        <NumberField prefix="X" label="Position X" value={figure.position[0]} step={0.05} onChange={(x) => setPlacement(store, figure.id, { x }, `place:${figure.id}:x`)} />
        <NumberField prefix="Z" label="Position Z" value={figure.position[2]} step={0.05} onChange={(z) => setPlacement(store, figure.id, { z }, `place:${figure.id}:z`)} />
        <NumberField prefix="↻" label="Facing" value={facing(figure)} step={5} digits={0} onChange={(yaw) => setPlacement(store, figure.id, { yaw }, `place:${figure.id}:yaw`)} />
      </div>
      {!moving && (
        <Toggle
          label="Stand on the floor"
          checked={figure.grounded}
          hint="Turn off to keep the figure's height, e.g. to sit on a chair"
          onChange={(on) => setGrounded(store, figure.id, on, ctx.rootPosition(figure.id) ?? undefined)}
        />
      )}
    </Section>
  );
}

function Action({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick(): void }) {
  return (
    <button type="button" className="action" onClick={onClick}>
      <Icon size={15} strokeWidth={1.75} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

/** The figure with the others: where it keeps its eyes, and placing and touching another figure. */
function OthersSection({ figure, ctx }: { figure: Figure; ctx: InspectorContext }) {
  const store = useStore();
  const scene = useScene();
  const others = scene.figures.filter((f) => f.id !== figure.id);
  const [otherId, setOtherId] = useState(others[0]?.id ?? '');
  const [side, setSide] = useState<Side>('R');
  const [contact, setContact] = useState<Contact>('shoulderL');
  const watchable = others.filter((f) => !f.hidden);
  if (!others.length && !scene.props.length) return null;
  const other = others.find((f) => f.id === otherId) ?? others[0];
  const gaze = !figure.gaze ? 'free' : 'figure' in figure.gaze ? `f:${figure.gaze.figure}` : `p:${figure.gaze.prop}`;
  const d = other ? distance(figure, other) : 0;
  return (
    <Section id="others" title="With others" collapsible>
      {!figure.proxy && (
        <div className="relation-target">
          <span>Eyes on</span>
          <Select
            label="Eyes on"
            value={gaze}
            onChange={(v) => setGaze(store, figure.id, v === 'free' ? null : v.startsWith('f:') ? { figure: v.slice(2) } : { prop: v.slice(2) })}
            options={[
              { value: 'free', label: 'Free (as posed)' },
              ...watchable.map((f) => ({ value: `f:${f.id}`, label: f.name })),
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
          <div className="action-grid">
            <Action icon={Navigation} label="Turn to" onClick={() => arrange(store, figure.id, other.id, 'face')} />
            <Action icon={ArrowLeftRight} label="Face each other" onClick={() => arrange(store, figure.id, other.id, 'faceEachOther')} />
            <Action icon={Eye} label="Look at" onClick={() => lookAtFigure(store, figure.id, other.id)} />
            <Action icon={PanelLeft} label="Beside (left)" onClick={() => arrange(store, figure.id, other.id, 'besideL')} />
            <Action icon={PanelRight} label="Beside (right)" onClick={() => arrange(store, figure.id, other.id, 'besideR')} />
            <Action icon={Repeat} label="Back to back" onClick={() => arrange(store, figure.id, other.id, 'backToBack')} />
          </div>
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
          {!figure.proxy && (
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
                    if (!reachFor(store, figure.id, side, other.id, contact)) ctx.notify('Out of reach: move the figures closer', 'error');
                  }}
                >
                  <Hand size={14} aria-hidden /> Reach
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

type Getting = 'glide' | Travel;
const JUMP_HEIGHTS = [0.3, 0.5, 0.8, 1.2];

/**
 * How the figure gets to its next key from the playhead: as keyed (gliding), or walking, running
 * or jumping there with generated steps; for a jump its height and turns. The same choices as
 * right-clicking its track on the timeline.
 */
function MovementSection({ figure }: { figure: Figure }) {
  const store = useStore();
  const a = useScene().animation;
  const time = useStudio((s) => s.time);
  if (!a) return null;
  const times = figureKeyTimes(a, figure.id);
  const next = times.find((k) => k > time + 1e-6);
  const started = times.some((k) => k <= time + 1e-6);
  const key = next !== undefined ? a.keys.find((k) => Math.abs(k.t - next) < 1e-6)?.poses[figure.id] : undefined;
  if (next === undefined || !started || !key) {
    return (
      <Section id="movement" title="Movement" collapsible>
        <p className="hint-text">Right-click the floor to walk, run or jump there from here: it makes a new mark.</p>
      </Section>
    );
  }
  const kind: Getting = key.travel ?? 'glide';
  const keep = { strafe: key.strafe, spin: key.spin, flip: key.flip };
  const set = (k: Getting, patch: { strafe?: boolean; spin?: number; flip?: number } = {}) => setTravel(store, figure.id, next, k === 'glide' ? null : k, { ...keep, ...patch });
  const chain = kind === 'jump' ? chainAt(a, figure.id, next - 1e-3) : null;
  const height = chain ? jumpHeight(Math.max(0, chain.t1 - chain.t0 - 2 * JUMP_PREP)) : 0;
  const nearest = JUMP_HEIGHTS.reduce((b, h) => (Math.abs(h - height) < Math.abs(b - height) ? h : b));
  return (
    <Section id="movement" title={`Movement · to ${next.toFixed(2)} s`} collapsible>
      <Segmented<Getting>
        label="Getting there"
        full
        value={kind}
        onChange={(k) => set(k)}
        options={[{ value: 'glide', label: 'Glide' }, { value: 'walk', label: 'Walk' }, { value: 'run', label: 'Run' }, { value: 'jump', label: 'Jump' }]}
      />
      {(kind === 'walk' || kind === 'run') && (
        <Toggle label="Keep facing" hint="Side steps and backing up instead of turning to the way it goes" checked={!!key.strafe} onChange={(strafe) => set(kind, { strafe })} />
      )}
      {kind === 'jump' && (
        <>
          <div className="field">
            <span>Height · {height.toFixed(2)} m</span>
            <Segmented<string>
              label="Jump height"
              full
              value={String(nearest)}
              onChange={(h) => setJumpHeight(store, figure.id, next, Number(h))}
              options={JUMP_HEIGHTS.map((h) => ({ value: String(h), label: `${h} m` }))}
            />
          </div>
          <div className="field">
            <span>In the air</span>
            <Segmented<string>
              label="Turns in the air"
              full
              value={String(key.spin ?? 0)}
              onChange={(v) => set('jump', { spin: Number(v) })}
              options={[{ value: '0', label: 'No turn' }, { value: '0.5', label: '½' }, { value: '1', label: '1' }, { value: '2', label: '2' }]}
            />
            <Segmented<string>
              label="Flip"
              full
              value={String(key.flip ?? 0)}
              onChange={(v) => set('jump', { flip: Number(v) })}
              options={[{ value: '0', label: 'No flip' }, { value: '1', label: 'Front flip' }, { value: '-1', label: 'Back flip' }]}
            />
          </div>
        </>
      )}
      <p className="hint-text">
        {kind === 'glide'
          ? 'It moves between its keys as posed. Walk, run or jump to step there instead.'
          : 'Its steps are generated between the marks. Drag the marks on the floor to change the way.'}
      </p>
    </Section>
  );
}

function HandsSection({ hands }: { hands: Record<Side, HandPose> }) {
  const store = useStore();
  const [side, setSide] = useState<Side>('L');
  const hand = hands[side];
  const preset = HAND_PRESETS.find((p) => p.hand.spread === hand.spread && p.hand.curl.every((c, i) => c === hand.curl[i]))?.name ?? '';
  return (
    <Section
      id="hands"
      title="Hands"
      collapsible
      defaultOpen={false}
      actions={<Segmented<Side> label="Hand" value={side} onChange={setSide} options={[{ value: 'L', label: 'Left' }, { value: 'R', label: 'Right' }]} />}
    >
      <div className="chips">
        {HAND_PRESETS.map((p) => (
          <button key={p.name} type="button" className={p.name === preset ? 'chip on' : 'chip'} onClick={() => setHand(store, side, p.hand)}>{p.name}</button>
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
              setHand(store, side, { ...hand, curl }, `hand:${side}:${i}`);
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
          onChange={(spread) => setHand(store, side, { ...hand, spread }, `hand:${side}:spread`)}
        />
      </div>
      <button type="button" className="btn subtle" onClick={() => setHand(store, side === 'L' ? 'R' : 'L', hand)}>
        <Copy size={14} aria-hidden /> Copy to {side === 'L' ? 'right' : 'left'} hand
      </button>
    </Section>
  );
}

/** Who the figure is: its colour in the scene, sex, body type and proportions (folded until wanted). */
function BodySection({ figure }: { figure: Figure }) {
  const store = useStore();
  const body = figure.body;
  const setBody = (patch: Partial<typeof body>, key = '') => store.updateFigure(figure.id, (f) => ({ ...f, body: { ...f.body, ...patch } }), key);
  const sexField = BODY_FIELDS.find((f) => f.key === 'sex')!;
  return (
    <Section id="body" title="Body & colour" collapsible defaultOpen={false}>
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
      <div className="sex-switch" role="radiogroup" aria-label="Sex">
        <button type="button" role="radio" aria-checked={body.sex < 0.5} className={body.sex < 0.5 ? 'on' : ''} onClick={() => setBody({ sex: 0, bust: 0 })}>
          <Mars size={18} strokeWidth={1.75} aria-hidden /> Male
        </button>
        <button type="button" role="radio" aria-checked={body.sex >= 0.5} className={body.sex >= 0.5 ? 'on' : ''} onClick={() => setBody({ sex: 1, bust: body.bust || 0.5 })}>
          <Venus size={18} strokeWidth={1.75} aria-hidden /> Female
        </button>
      </div>
      <Slider
        label="Masculine ↔ Feminine"
        min={sexField.min}
        max={sexField.max}
        step={sexField.step}
        value={body.sex}
        display={sexField.format(body.sex)}
        onChange={(sex) => setBody({ sex }, 'body:sex')}
      />
      <div className="preset-grid" role="group" aria-label="Body type">
        {BODY_PRESETS.map((p) => {
          const on = (Object.keys(p.body) as (keyof typeof body)[]).every((k) => p.body[k] === body[k]);
          return (
            <button
              key={p.name}
              type="button"
              className={on ? 'preset on' : 'preset'}
              aria-label={p.name}
              onClick={() => store.updateFigure(figure.id, (f) => ({ ...f, body: { ...p.body } }))}
            >
              {p.body.sex < 0.5 ? <Mars size={14} aria-hidden /> : <Venus size={14} aria-hidden />}
              {p.name}
            </button>
          );
        })}
      </div>
      <div className="stack">
        {BODY_FIELDS.filter((f) => f.key !== 'sex').map((f) => (
          <Slider
            key={f.key}
            label={f.label}
            min={f.min}
            max={f.max}
            step={f.step}
            value={body[f.key]}
            display={f.format(body[f.key])}
            onChange={(v) => setBody({ [f.key]: v }, `body:${f.key}`)}
          />
        ))}
      </div>
    </Section>
  );
}

/* ---------------- Prop ---------------- */

function PropEditor({ id, chrome }: { id: string; chrome: HeaderChrome }) {
  const store = useStore();
  const scene = useScene();
  const prop = scene.props.find((p) => p.id === id)!;
  const Icon = PROP_ICONS[prop.kind];
  const set = (key: 'position' | 'rotation' | 'scale', axis: number, v: number) => {
    const next: Vec3 = [...prop[key]];
    next[axis] = key === 'scale' ? Math.max(0.02, v) : v;
    store.updateProp(id, (p) => ({ ...p, [key]: next }), `prop:${id}:${key}:${axis}`);
  };
  const row = (key: 'position' | 'rotation' | 'scale', label: string, step: number) => (
    <div className="prop-row">
      <span className="prop-row-label">{label}</span>
      {(['X', 'Y', 'Z'] as const).map((axis, a) => (
        <NumberField
          key={axis}
          prefix={axis}
          label={`${label} ${axis}`}
          value={prop[key][a]}
          step={step}
          digits={key === 'rotation' ? 1 : 2}
          min={key === 'scale' ? 0.02 : key === 'position' && a === 1 && !prop.hold ? 0 : -Infinity}
          onChange={(v) => set(key, a, v)}
        />
      ))}
    </div>
  );
  return (
    <>
      <NameHeader
        chrome={chrome}
        lead={<Icon size={16} strokeWidth={1.75} aria-hidden />}
        name={prop.name}
        label={`${PROP_LABELS[prop.kind]} name`}
        onRename={(name) => renameProp(store, id, name)}
      >
        <IconButton
          icon={ArrowDownToLine}
          label={prop.hold ? 'Let go' : 'Drop to floor'}
          onClick={() => (prop.hold ? holdProp(store, id, null) : store.updateProp(id, (p) => ({ ...p, position: [p.position[0], 0, p.position[2]] })))}
        />
      </NameHeader>
      {(HOLDABLE.includes(prop.kind) || prop.hold) && (
        <Section title="Held by">
          <Select
            label="Held by"
            value={prop.hold ? `${prop.hold.figure}:${prop.hold.hand}` : 'none'}
            onChange={(v) => {
              const [figure, hand] = v.split(':');
              holdProp(store, id, v === 'none' ? null : { figure, hand: hand as Side });
            }}
            options={[
              { value: 'none', label: 'Nobody: it stands on the floor' },
              ...scene.figures.flatMap((f) => (['R', 'L'] as const).map((hand) => ({ value: `${f.id}:${hand}`, label: `${f.name}: ${hand === 'L' ? 'left' : 'right'} hand` }))),
            ]}
          />
        </Section>
      )}
      <Section title="Transform">
        {row('position', 'Position', 0.05)}
        {row('rotation', 'Rotation', 5)}
        {row('scale', 'Size', 0.05)}
        <p className="hint-text">
          {prop.hold
            ? <>Relative to the hand: it follows the pose and the animation. Drag it on the canvas to move the hand; <kbd>W</kbd> adjusts the grip.</>
            : <>Drag a letter to scrub. On the canvas: drag the prop to move it, its ring to turn it; <kbd>W</kbd> also moves it up and down, <kbd>R</kbd> scales it.</>}
        </p>
      </Section>
    </>
  );
}

/* ---------------- Scene ---------------- */

const LIT = STYLE_LIST.filter((s) => s.lit).map((s) => s.label).join(', ');

/** The scene itself: its light (saved with it, used by its exports), how it is drawn, a reference image. */
function SceneInspector({ ctx, chrome }: { ctx: InspectorContext; chrome: HeaderChrome }) {
  const store = useStore();
  const scene = useScene();
  const settings = useStudio((s) => s.settings);
  const def = styleDef(settings.style);
  const light = scene.light ?? DEFAULT_LIGHT;
  const setLight = (patch: Partial<Light>, key = 'light') => setSceneLight(store, { ...light, ...patch }, key);
  const same = (a: Light, b: Light) => (['azimuth', 'elevation', 'intensity', 'warmth', 'shadows'] as const).every((k) => a[k] === b[k]);
  return (
    <>
      <NameHeader chrome={chrome} lead={<Clapperboard size={16} strokeWidth={1.75} aria-hidden />} name={scene.name} label="Scene name" onRename={(name) => renameScene(store, name)} />
      <Section title="Light">
        <div className="chips" role="group" aria-label="Lighting presets">
          {LIGHT_PRESETS.map((p) => (
            <button key={p.id} type="button" className={same(p.light, light) ? 'chip on' : 'chip'} onClick={() => setLight(p.light, '')}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="stack">
          <Slider label="Direction" min={-180} max={180} value={light.azimuth} display={`${Math.round(light.azimuth)}°`} typeable onChange={(azimuth) => setLight({ azimuth })} />
          <Slider label="Height" min={5} max={89} value={light.elevation} display={`${Math.round(light.elevation)}°`} typeable onChange={(elevation) => setLight({ elevation })} />
          <Slider label="Brightness" min={0.2} max={2} step={0.05} value={light.intensity} display={`${Math.round(light.intensity * 100)}%`} onChange={(intensity) => setLight({ intensity })} />
          <Slider
            label="Warmth"
            min={-1}
            max={1}
            step={0.05}
            value={light.warmth}
            display={light.warmth > 0.05 ? 'Warm' : light.warmth < -0.05 ? 'Cool' : 'White'}
            onChange={(warmth) => setLight({ warmth })}
          />
        </div>
        <Toggle label="Cast shadows" checked={light.shadows} onChange={(shadows) => setLight({ shadows }, '')} />
        <p className="hint-text">
          Saved with the scene and used by its exports.{def.lit ? '' : ` It shows in the lit styles (${LIT}): pick one in the top bar.`}
        </p>
      </Section>
      <Section title="Look">
        <Toggle
          label="Simple face features"
          hint="Nose, ears, eyes, brows and mouth, so you can tell where each figure looks"
          checked={settings.faces}
          onChange={(faces) => store.setSettings({ faces })}
        />
        {def.outline && (
          <Slider
            label="Line weight"
            min={0.5}
            max={4}
            step={0.1}
            value={settings.editorLine}
            display={`${settings.editorLine.toFixed(1)} px`}
            onChange={(editorLine) => store.setSettings({ editorLine })}
          />
        )}
        <p className="hint-text">{def.label}: {def.description.toLowerCase()}. Switch styles in the top bar (<kbd>L</kbd>).</p>
      </Section>
      <Section
        id="reference"
        title="Reference image"
        collapsible
        defaultOpen={!!ctx.reference.url}
        actions={ctx.reference.url && (
          <>
            <IconButton
              icon={ctx.reference.visible ? Eye : EyeOff}
              label={ctx.reference.visible ? 'Hide reference' : 'Show reference'}
              onClick={() => ctx.setReference({ visible: !ctx.reference.visible })}
            />
            <IconButton icon={Trash2} label="Remove reference" onClick={() => ctx.setReference({ url: null })} />
          </>
        )}
      >
        <label className="btn subtle file-button">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) ctx.setReference({ url: URL.createObjectURL(file), visible: true });
              e.target.value = '';
            }}
          />
          <ImagePlus size={14} aria-hidden /> {ctx.reference.url ? 'Replace image…' : 'Overlay a photo or drawing…'}
        </label>
        {ctx.reference.url && (
          <Slider
            label="Opacity"
            min={0.05}
            max={1}
            step={0.01}
            value={ctx.reference.opacity}
            display={`${Math.round(ctx.reference.opacity * 100)}%`}
            onChange={(opacity) => ctx.setReference({ opacity })}
          />
        )}
      </Section>
    </>
  );
}
