'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeftRight, ClipboardCopy, ClipboardPaste, Copy, Eye, EyeOff, FlipHorizontal2, Focus, Hand, ImagePlus, Mars, Navigation,
  PanelLeft, PanelRight, PersonStanding, Repeat, RotateCcw, Trash2, UserRound, Venus, X, type LucideIcon,
} from 'lucide-react';
import {
  arrange, copyPose, holdProp, setPosture, lookAtFigure, mirrorPose, pastePose, reachFor, renameFigure, renameProp, resetPose, setDistance,
  setGrounded, setHand, setJoint, setPlacement, setSceneView, symmetrizePose,
} from '@/lib/actions';
import { BODY_FIELDS, BODY_PRESETS } from '@/lib/body';
import { HAND_PRESETS } from '@/lib/hands';
import { HOLDABLE } from '@/lib/hold';
import { chainAt } from '@/lib/locomotion';
import { JOINT_LABELS, axisLabels, jointLimits } from '@/lib/joints';
import { DEFAULT_LIGHT } from '@/lib/lighting';
import { CONTACTS, CONTACT_LABELS, distance, facing, type Contact } from '@/lib/relations';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { sharedRenderer } from '@/lib/thumbnails';
import { FINGERS, POSTURES, type Figure, type Posture, type Hand as HandPose, type Light, type Scene, type Side, type Style, type Vec3, type View, PROP_LABELS } from '@/lib/types';
import { Assistant } from '@edition/server';
import BodyMap from './BodyMap';
import ShotInspector from './ShotInspector';
import { PROP_ICONS } from './icons';
import { useActiveFigure, useScene, useStore, useStudio } from './store-context';
import { IconButton, NameHeader, NumberField, Section, Segmented, Select, Slider, Toggle, type Notify } from './ui';

export type Tab = 'pose' | 'body' | 'render' | 'ai';

export interface InspectorContext {
  frame(view: Partial<View> & Pick<View, 'yaw' | 'pitch'>): void;
  currentView(): View | null;
  rootPosition(figure: string): Vec3 | null;
  notify: Notify;
  /** Toast with an Undo button. */
  notifyUndo(text: string): void;
  reference: { url: string | null; opacity: number; visible: boolean };
  setReference(r: Partial<{ url: string | null; opacity: number; visible: boolean }>): void;
}

const TABS: { id: Tab; label: string }[] = [
  // Edits whatever is selected: a figure's pose, a prop, a shot.
  { id: 'pose', label: 'Edit' },
  { id: 'body', label: 'Body' },
  { id: 'render', label: 'Render' },
  // The AI tab: server edition only (Assistant is null in the static build).
  ...(Assistant ? [{ id: 'ai' as const, label: 'AI' }] : []),
];

/** Right-hand properties panel. Its content follows the selection, like a design tool's inspector. */
export default function Inspector({ tab, setTab, ctx }: { tab: Tab; setTab(t: Tab): void; ctx: InspectorContext }) {
  return (
    <aside className="panel" aria-label="Inspector">
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'ai' && Assistant ? <Assistant /> : (
        <div className="panel-scroll">
          {tab === 'pose' && <PoseTab ctx={ctx} />}
          {tab === 'body' && <BodyTab />}
          {tab === 'render' && <RenderTab ctx={ctx} />}
        </div>
      )}
    </aside>
  );
}

/** Which figure the panel edits (pick another in the Scene outline or on the canvas), and its name. */
function FigureHeader({ figure }: { figure: Figure }) {
  const store = useStore();
  const Icon = figure.proxy ? UserRound : PersonStanding;
  return (
    <NameHeader
      lead={<Icon size={16} strokeWidth={1.75} aria-hidden />}
      name={figure.name}
      label="Figure name"
      onRename={(name) => renameFigure(store, figure.id, name)}
    >
      {figure.hidden && <span className="title-note">Hidden</span>}
    </NameHeader>
  );
}

/* ---------------- Pose ---------------- */

const POSTURE_LABELS: Record<Posture, string> = { stand: 'Stand', sit: 'Sit', lie: 'Lie' };

function PoseTab({ ctx }: { ctx: InspectorContext }) {
  const store = useStore();
  const selection = useStudio((s) => s.selection);
  const limits = useStudio((s) => s.settings.limits);
  const figure = useActiveFigure();
  const scene = useScene();

  if (selection?.kind === 'prop') {
    const prop = scene.props.find((p) => p.id === selection.prop);
    if (prop) return <PropEditor id={prop.id} />;
  }
  if (selection?.kind === 'shot') return <ShotInspector id={selection.shot} notify={ctx.notify} />;
  if (!figure) return <p className="empty-note">This scene has no figures. Add one to the cast in the Scene outline.</p>;

  const joint = selection?.kind === 'joint' && selection.figure === figure.id ? selection.joint : null;
  const rot = joint ? figure.joints[joint] ?? [0, 0, 0] : null;

  if (figure.proxy) {
    return (
      <>
        <FigureHeader figure={figure} />
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
        {scene.figures.length > 1 && <RelationSection figure={figure} ctx={ctx} />}
      </>
    );
  }

  return (
    <>
      <FigureHeader figure={figure} />
      <Section
        title={joint ? JOINT_LABELS[joint] : 'Joints'}
        actions={joint && (
          <>
            <IconButton icon={RotateCcw} label="Reset joint" onClick={() => setJoint(store, figure.id, joint, [0, 0, 0], '')} />
            <IconButton icon={X} label="Deselect" shortcut="Esc" onClick={() => store.select(null)} />
          </>
        )}
      >
        <BodyMap selected={joint} onSelect={(j) => store.select({ kind: 'joint', figure: figure.id, joint: j })} />
        {joint && rot ? (
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
        ) : (
          <p className="hint-text">On the canvas, drag a limb or the head to pose it (hands and feet pull the limb), the torso to move the figure, the ring on the floor to turn it. Click a part to fine-tune it here.</p>
        )}
      </Section>

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

      <PlacementSection figure={figure} ctx={ctx} />
      {scene.figures.length > 1 && <RelationSection figure={figure} ctx={ctx} />}
      <HandsSection hands={figure.hands} />
    </>
  );
}

/** Where the figure stands and which way it faces. */
function PlacementSection({ figure, ctx }: { figure: Figure; ctx: InspectorContext }) {
  const store = useStore();
  const animation = useScene().animation;
  const time = useStudio((s) => s.time);
  // Between two marks of a walk, run or jump the generated steps place the figure.
  const chain = animation ? chainAt(animation, figure.id, time) : null;
  const moving = chain && time > chain.t0 + 1e-6 && time < chain.t1 - 1e-6 ? chain.kind : null;
  return (
    <Section title="Placement">
      <div className="prop-row">
        <span className="prop-row-label">Floor</span>
        <NumberField prefix="X" label="Position X" value={figure.position[0]} step={0.05} onChange={(x) => setPlacement(store, figure.id, { x }, `place:${figure.id}:x`)} />
        <NumberField prefix="Z" label="Position Z" value={figure.position[2]} step={0.05} onChange={(z) => setPlacement(store, figure.id, { z }, `place:${figure.id}:z`)} />
        <NumberField prefix="↻" label="Facing" value={facing(figure)} step={5} digits={0} onChange={(yaw) => setPlacement(store, figure.id, { yaw }, `place:${figure.id}:yaw`)} />
      </div>
      {moving ? (
        <p className="hint-text">
          {moving === 'jump' ? 'Jumping' : moving === 'run' ? 'Running' : 'Walking'} from mark to mark: its steps are generated. Drag its marks on the floor, or right-click its track on the timeline to change how it gets there.
        </p>
      ) : (
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

/** Arrange the active figure relative to another one: facing, spacing, gaze and touch. */
function RelationSection({ figure, ctx }: { figure: Figure; ctx: InspectorContext }) {
  const store = useStore();
  const scene = useScene();
  const others = scene.figures.filter((f) => f.id !== figure.id);
  const [otherId, setOtherId] = useState(others[0]?.id ?? '');
  const [side, setSide] = useState<Side>('R');
  const [contact, setContact] = useState<Contact>('shoulderL');
  const other = others.find((f) => f.id === otherId) ?? others[0];
  if (!other) return null;
  const d = distance(figure, other);
  return (
    <Section id="relation" title="Relation" collapsible>
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

function PropEditor({ id }: { id: string }) {
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

/* ---------------- Body ---------------- */

function BodyTab() {
  const store = useStore();
  const figure = useActiveFigure();
  if (!figure) return <p className="empty-note">No figure selected.</p>;
  const body = figure.body;
  const setBody = (patch: Partial<typeof body>, key = '') => store.updateActiveFigure((f) => ({ ...f, body: { ...f.body, ...patch } }), key);
  const sexField = BODY_FIELDS.find((f) => f.key === 'sex')!;
  return (
    <>
      <FigureHeader figure={figure} />
      <Section title="Figure">
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
      </Section>
      <Section title="Body type">
        <div className="preset-grid">
          {BODY_PRESETS.map((p) => {
            const on = (Object.keys(p.body) as (keyof typeof body)[]).every((k) => p.body[k] === body[k]);
            return (
              <button
                key={p.name}
                type="button"
                className={on ? 'preset on' : 'preset'}
                aria-label={p.name}
                onClick={() => store.updateActiveFigure((f) => ({ ...f, body: { ...p.body } }))}
              >
                {p.body.sex < 0.5 ? <Mars size={14} aria-hidden /> : <Venus size={14} aria-hidden />}
                {p.name}
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Proportions">
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
    </>
  );
}

/* ---------------- Render ---------------- */

const LIGHT_PRESETS: { name: string; light: Pick<Light, 'azimuth' | 'elevation'> }[] = [
  { name: 'Three-quarter', light: { azimuth: DEFAULT_LIGHT.azimuth, elevation: DEFAULT_LIGHT.elevation } },
  { name: 'Front', light: { azimuth: 0, elevation: 30 } },
  { name: 'Side', light: { azimuth: 90, elevation: 20 } },
  { name: 'Rim', light: { azimuth: 160, elevation: 35 } },
  { name: 'Top', light: { azimuth: 0, elevation: 85 } },
];

/** Small previews of the current pose in every style (rendered off-screen, debounced). */
function useStylePreviews(scene: Scene, light: Light, faces: boolean) {
  const [previews, setPreviews] = useState<Partial<Record<Style, string>>>({});
  useEffect(() => {
    const t = setTimeout(() => {
      const r = sharedRenderer();
      const out: Partial<Record<Style, string>> = {};
      for (const s of STYLE_LIST) out[s.id] = r.render(scene, 96, 120, 1, { style: s.id, light, faces, margin: 0.08 }).toDataURL('image/png');
      setPreviews(out);
    }, 250);
    return () => clearTimeout(t);
  }, [scene, light, faces]);
  return previews;
}

function RenderTab({ ctx }: { ctx: InspectorContext }) {
  const store = useStore();
  const scene = useScene();
  const settings = useStudio((s) => s.settings);
  const def = styleDef(settings.style);
  const previews = useStylePreviews(scene, settings.light, settings.faces);
  const v = scene.view;
  const setView = (patch: Partial<View>) => setSceneView(store, { ...v, ...patch });
  const setLight = (patch: Partial<Light>) => store.setSettings({ light: { ...settings.light, ...patch } });

  return (
    <>
      <Section title="Style">
        <div className="style-grid" role="radiogroup" aria-label="Render style">
          {STYLE_LIST.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={settings.style === s.id}
              aria-label={s.label}
              title={s.description}
              className={settings.style === s.id ? 'style-card on' : 'style-card'}
              onClick={() => store.setSettings({ style: s.id })}
            >
              <span className="style-thumb" style={{ background: s.background }}>
                {/* Generated data: URLs, so next/image does not apply. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {previews[s.id] && <img src={previews[s.id]} alt="" />}
              </span>
              <span className="style-name">{s.label}</span>
            </button>
          ))}
        </div>
        <p className="hint-text">{def.description}. Exports and practice sessions can use any style.</p>
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
      </Section>

      {def.lit && (
        <Section title="Light">
          <div className="stack">
            <Slider label="Direction" min={-180} max={180} value={settings.light.azimuth} display={`${Math.round(settings.light.azimuth)}°`} typeable onChange={(azimuth) => setLight({ azimuth })} />
            <Slider label="Height" min={5} max={89} value={settings.light.elevation} display={`${Math.round(settings.light.elevation)}°`} typeable onChange={(elevation) => setLight({ elevation })} />
          </div>
          <div className="chips">
            {LIGHT_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className={p.light.azimuth === settings.light.azimuth && p.light.elevation === settings.light.elevation ? 'chip on' : 'chip'}
                onClick={() => setLight(p.light)}
              >
                {p.name}
              </button>
            ))}
          </div>
          {def.shadows && <Toggle label="Cast shadows" checked={settings.light.shadows} onChange={(shadows) => setLight({ shadows })} />}
        </Section>
      )}

      <Section
        title="Export camera"
        actions={<IconButton icon={Focus} label="Look through it" onClick={() => ctx.frame(v)} />}
      >
        <div className="stack">
          <Slider label="Turn" min={-180} max={180} value={v.yaw} display={`${Math.round(v.yaw)}°`} typeable onChange={(yaw) => setView({ yaw })} />
          <Slider label="Height" min={-60} max={89} value={v.pitch} display={`${Math.round(v.pitch)}°`} typeable onChange={(pitch) => setView({ pitch })} />
          <Slider label="Lens (field of view)" min={8} max={70} value={v.fov} display={`${Math.round(v.fov)}°`} typeable onChange={(fov) => setView({ fov })} />
        </div>
        <button type="button" className="btn subtle" onClick={() => { const cur = ctx.currentView(); if (cur) setView({ yaw: cur.yaw, pitch: cur.pitch }); }}>
          Use current view
        </button>
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
