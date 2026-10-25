'use client';

import { useState, type ReactNode } from 'react';
import {
  addFigure, addProp, copyPose, deleteFigure, deleteProp, duplicateFigure, duplicateProp, mirrorPose, pastePose, renameFigure,
  resetPose, setFigureHidden, setGrounded, setHand, setJoint, setSceneView, symmetrizePose,
} from '@/lib/actions';
import { BODY_FIELDS, BODY_PRESETS } from '@/lib/body';
import { HAND_PRESETS } from '@/lib/hands';
import { JOINT_LABELS, SHORT_LABELS, axisLabels, jointLimits } from '@/lib/joints';
import { PROP_LABELS } from '@/lib/props';
import { VIEW_PRESETS } from '@/lib/views';
import { DEFAULT_LIGHT } from '@/lib/lighting';
import { FINGERS, JOINTS, PROP_KINDS, type Hand, type Light, type Side, type Style, type Vec3, type View } from '@/lib/types';
import { useActiveFigure, useScene, useStore, useStudio } from './store-context';
import { Segmented, Slider, Toggle, type Notify } from './ui';

export type Tab = 'pose' | 'body' | 'scene' | 'view';

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

export default function Inspector({ tab, setTab, ctx }: { tab: Tab; setTab(t: Tab): void; ctx: InspectorContext }) {
  return (
    <aside className="panel" aria-label="Inspector">
      <nav className="tabs" role="tablist">
        {(['pose', 'body', 'scene', 'view'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <div className="panel-scroll">
        {tab === 'pose' && <PoseTab ctx={ctx} />}
        {tab === 'body' && <BodyTab />}
        {tab === 'scene' && <SceneTab ctx={ctx} />}
        {tab === 'view' && <ViewTab ctx={ctx} />}
      </div>
    </aside>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section>
      <div className="row between"><h3>{title}</h3>{aside}</div>
      {children}
    </section>
  );
}

function FigurePicker() {
  const store = useStore();
  const scene = useScene();
  const active = useStudio((s) => s.activeFigure);
  if (scene.figures.length < 2) return null;
  return (
    <section>
      <h3>Figure</h3>
      <div className="chips">
        {scene.figures.map((f) => (
          <button key={f.id} className={f.id === active ? 'chip on' : 'chip'} onClick={() => store.setActiveFigure(f.id)}>{f.name}</button>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Pose ---------------- */

function PoseTab({ ctx }: { ctx: InspectorContext }) {
  const store = useStore();
  const selection = useStudio((s) => s.selection);
  const limits = useStudio((s) => s.settings.limits);
  const figure = useActiveFigure();
  const scene = useScene();

  if (selection?.kind === 'prop') {
    const prop = scene.props.find((p) => p.id === selection.prop);
    if (prop) return <PropEditor id={prop.id} ctx={ctx} />;
  }
  if (!figure) return <section><p className="muted">This pose has no figures. Add one in the Scene tab.</p></section>;

  const joint = selection?.kind === 'joint' && selection.figure === figure.id ? selection.joint : null;
  const rot = joint ? figure.joints[joint] ?? [0, 0, 0] : null;

  return (
    <>
      <FigurePicker />
      <Section title={joint ? JOINT_LABELS[joint] : 'Joint'}>
        {joint && rot ? (
          <>
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
            <div className="row">
              <button onClick={() => setJoint(store, figure.id, joint, [0, 0, 0], '')}>Reset joint</button>
              <button onClick={() => store.select(null)}>Deselect</button>
            </div>
            {joint === 'root' && <p className="muted small">Tip: press <kbd>W</kbd> to move the whole figure, <kbd>E</kbd> to rotate.</p>}
          </>
        ) : (
          <p className="muted">Click a body part to rotate it, or drag the coloured dots to move hands, feet and hips.</p>
        )}
        <div className="chips">
          {JOINTS.map((j) => (
            <button
              key={j}
              className={j === joint ? 'chip on' : 'chip'}
              onClick={() => store.select({ kind: 'joint', figure: figure.id, joint: j })}
            >
              {SHORT_LABELS[j]}
            </button>
          ))}
        </div>
      </Section>

      <HandsSection hands={figure.hands} />

      <Section title="Pose tools">
        <div className="grid2">
          <button onClick={() => mirrorPose(store)} title="Mirror left ↔ right (M)">Mirror</button>
          <button onClick={() => resetPose(store)}>Reset pose</button>
          <button onClick={() => symmetrizePose(store, 'L')} title="Copy the figure's left side onto its right">Left → Right</button>
          <button onClick={() => symmetrizePose(store, 'R')} title="Copy the figure's right side onto its left">Right → Left</button>
          <button onClick={() => { if (copyPose(store)) ctx.notify('Pose copied'); }} title="Ctrl+C">Copy pose</button>
          <button onClick={() => { if (!pastePose(store)) ctx.notify('Copy a pose first', 'error'); }} title="Ctrl+V">Paste pose</button>
        </div>
        <Toggle
          label="Stand on the floor"
          checked={figure.grounded}
          hint="When off, the figure keeps its height (e.g. to sit on a chair)"
          onChange={(on) => setGrounded(store, figure.id, on, ctx.rootPosition(figure.id) ?? undefined)}
        />
      </Section>
    </>
  );
}

function HandsSection({ hands }: { hands: Record<Side, Hand> }) {
  const store = useStore();
  const [side, setSide] = useState<Side>('L');
  const hand = hands[side];
  return (
    <Section
      title="Hands"
      aside={<Segmented<Side> label="Hand" value={side} onChange={setSide} options={[{ value: 'L', label: 'Left' }, { value: 'R', label: 'Right' }]} />}
    >
      <div className="chips">
        {HAND_PRESETS.map((p) => (
          <button key={p.name} className="chip" onClick={() => setHand(store, side, p.hand)}>{p.name}</button>
        ))}
        <button className="chip" onClick={() => setHand(store, side === 'L' ? 'R' : 'L', hand)} title="Copy to the other hand">
          Copy → {side === 'L' ? 'right' : 'left'}
        </button>
      </div>
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
            const curl = [...hand.curl] as Hand['curl'];
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
    </Section>
  );
}

function PropEditor({ id, ctx }: { id: string; ctx: InspectorContext }) {
  const store = useStore();
  const scene = useScene();
  const prop = scene.props.find((p) => p.id === id)!;
  const field = (key: 'position' | 'rotation' | 'scale', axis: number, step: number) => (
    <input
      type="number"
      step={step}
      value={prop[key][axis]}
      aria-label={`${key} ${'xyz'[axis]}`}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!Number.isFinite(v)) return;
        const next: Vec3 = [...prop[key]];
        next[axis] = key === 'scale' ? Math.max(0.02, v) : v;
        store.updateProp(id, (p) => ({ ...p, [key]: next }), `prop:${id}:${key}:${axis}`);
      }}
    />
  );
  return (
    <Section title={PROP_LABELS[prop.kind]}>
      <p className="muted small">Drag the gizmo: <kbd>W</kbd> move · <kbd>E</kbd> rotate · <kbd>R</kbd> scale.</p>
      <div className="xyz"><span>Position (m)</span>{[0, 1, 2].map((a) => <span key={a}>{field('position', a, 0.05)}</span>)}</div>
      <div className="xyz"><span>Rotation (°)</span>{[0, 1, 2].map((a) => <span key={a}>{field('rotation', a, 5)}</span>)}</div>
      <div className="xyz"><span>Size</span>{[0, 1, 2].map((a) => <span key={a}>{field('scale', a, 0.05)}</span>)}</div>
      <div className="row">
        <button onClick={() => store.updateProp(id, (p) => ({ ...p, position: [p.position[0], 0, p.position[2]] }))}>Drop to floor</button>
        <button onClick={() => duplicateProp(store, id)}>Duplicate</button>
        <button className="danger" onClick={() => { deleteProp(store, id); ctx.notifyUndo('Prop deleted'); }}>Delete</button>
      </div>
    </Section>
  );
}

/* ---------------- Body ---------------- */

function BodyTab() {
  const store = useStore();
  const figure = useActiveFigure();
  if (!figure) return <section><p className="muted">No figure selected.</p></section>;
  return (
    <>
      <FigurePicker />
      <Section title="Name">
        <input type="text" value={figure.name} onChange={(e) => renameFigure(store, figure.id, e.target.value)} aria-label="Figure name" />
      </Section>
      <Section title="Body type">
        <div className="chips">
          {BODY_PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => store.updateActiveFigure((f) => ({ ...f, body: { ...p.body } }))}>{p.name}</button>
          ))}
        </div>
      </Section>
      <Section title="Proportions">
        {BODY_FIELDS.map((f) => (
          <Slider
            key={f.key}
            label={f.label}
            min={f.min}
            max={f.max}
            step={f.step}
            value={figure.body[f.key]}
            display={f.format(figure.body[f.key])}
            onChange={(v) => store.updateActiveFigure((fig) => ({ ...fig, body: { ...fig.body, [f.key]: v } }), `body:${f.key}`)}
          />
        ))}
      </Section>
    </>
  );
}

/* ---------------- Scene ---------------- */

function SceneTab({ ctx }: { ctx: InspectorContext }) {
  const store = useStore();
  const scene = useScene();
  const active = useStudio((s) => s.activeFigure);
  const selection = useStudio((s) => s.selection);
  return (
    <>
      <Section title="Pose name">
        <input type="text" value={scene.name} onChange={(e) => store.updateScene((s) => ({ ...s, name: e.target.value }), 'rename')} aria-label="Pose name" />
      </Section>
      <Section title={`Figures (${scene.figures.length})`} aside={<button onClick={() => addFigure(store)}>+ Add</button>}>
        <ul className="list">
          {scene.figures.map((f) => (
            <li key={f.id} className={f.id === active ? 'on' : ''}>
              <button className={f.hidden ? 'grow hidden-figure' : 'grow'} onClick={() => store.setActiveFigure(f.id)}>{f.name}</button>
              <button
                className={f.hidden ? 'icon' : 'icon on'}
                title={f.hidden ? 'Hidden (not drawn or exported). Click to show' : 'Visible. Click to hide'}
                aria-label={`${f.hidden ? 'Show' : 'Hide'} ${f.name}`}
                aria-pressed={!f.hidden}
                onClick={() => setFigureHidden(store, f.id, !f.hidden)}
              >
                {f.hidden ? '◌' : '◉'}
              </button>
              <button className="icon" title="Duplicate" aria-label={`Duplicate ${f.name}`} onClick={() => duplicateFigure(store, f.id)}>⧉</button>
              <button
                className="icon"
                title="Delete"
                aria-label={`Delete ${f.name}`}
                disabled={scene.figures.length <= 1}
                onClick={() => { if (deleteFigure(store, f.id)) ctx.notifyUndo(`Deleted ${f.name}`); }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={`Props (${scene.props.length})`}>
        <div className="chips">
          {PROP_KINDS.map((k) => <button key={k} className="chip" onClick={() => addProp(store, k)}>+ {PROP_LABELS[k]}</button>)}
        </div>
        {scene.props.length > 0 && (
          <ul className="list">
            {scene.props.map((p, i) => (
              <li key={p.id} className={selection?.kind === 'prop' && selection.prop === p.id ? 'on' : ''}>
                <button className="grow" onClick={() => store.select({ kind: 'prop', prop: p.id })}>{PROP_LABELS[p.kind]} {i + 1}</button>
                <button className="icon" title="Delete" aria-label={`Delete ${PROP_LABELS[p.kind]} ${i + 1}`} onClick={() => { deleteProp(store, p.id); ctx.notifyUndo('Prop deleted'); }}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/* ---------------- View ---------------- */

const LIGHT_PRESETS: { name: string; light: Pick<Light, 'azimuth' | 'elevation'> }[] = [
  { name: 'Three-quarter', light: { azimuth: DEFAULT_LIGHT.azimuth, elevation: DEFAULT_LIGHT.elevation } },
  { name: 'Front', light: { azimuth: 0, elevation: 30 } },
  { name: 'Side', light: { azimuth: 90, elevation: 20 } },
  { name: 'Rim', light: { azimuth: 160, elevation: 35 } },
  { name: 'Top', light: { azimuth: 0, elevation: 85 } },
];

function ViewTab({ ctx }: { ctx: InspectorContext }) {
  const store = useStore();
  const scene = useScene();
  const settings = useStudio((s) => s.settings);
  const v = scene.view;
  const setView = (patch: Partial<View>) => setSceneView(store, { ...v, ...patch });
  return (
    <>
      <Section title="Export camera">
        <p className="muted small">Angle used for the thumbnail and image export of this pose.</p>
        <Slider label="Turn" min={-180} max={180} value={v.yaw} display={`${Math.round(v.yaw)}°`} onChange={(yaw) => setView({ yaw })} />
        <Slider label="Height" min={-60} max={89} value={v.pitch} display={`${Math.round(v.pitch)}°`} onChange={(pitch) => setView({ pitch })} />
        <Slider label="Lens (field of view)" min={8} max={70} value={v.fov} display={`${Math.round(v.fov)}°`} onChange={(fov) => setView({ fov })} />
        <div className="row">
          <button onClick={() => { const cur = ctx.currentView(); if (cur) setView({ yaw: cur.yaw, pitch: cur.pitch }); }}>Use current view</button>
          <button onClick={() => ctx.frame(v)}>Look through it</button>
        </div>
      </Section>
      <Section title="Editor view">
        <div className="grid3">
          {VIEW_PRESETS.map((p) => (
            <button key={p.label} onClick={() => ctx.frame({ yaw: p.yaw, pitch: p.pitch })} title={`Shortcut: ${p.key}`}>{p.label}</button>
          ))}
        </div>
      </Section>
      <Section title="Display">
        <Segmented<Style>
          label="Style"
          value={settings.style}
          onChange={(style) => store.setSettings({ style })}
          options={[
            { value: 'line', label: 'Line art' },
            { value: 'shaded', label: 'Shaded' },
            { value: 'silhouette', label: 'Silhouette', title: 'Solid shapes, for gesture and silhouette studies' },
          ]}
        />
        <Slider
          label="Line weight"
          min={0.5}
          max={4}
          step={0.1}
          value={settings.editorLine}
          display={`${settings.editorLine.toFixed(1)} px`}
          onChange={(editorLine) => store.setSettings({ editorLine })}
        />
        <Toggle label="Drag handles" checked={settings.showHandles} onChange={(showHandles) => store.setSettings({ showHandles })} />
        <Toggle label="Floor grid" checked={settings.showGrid} onChange={(showGrid) => store.setSettings({ showGrid })} />
        <Toggle
          label="Joint limits"
          hint="Keep joints within natural ranges"
          checked={settings.limits}
          onChange={(limits) => store.setSettings({ limits })}
        />
      </Section>
      <Section
        title="Light"
        aside={settings.style !== 'shaded' && <button className="chip" onClick={() => store.setSettings({ style: 'shaded' })}>Show shaded</button>}
      >
        <p className="muted small">Key light for the shaded style, in the editor and in exports.</p>
        <Slider
          label="Direction (+ from the left)"
          min={-180}
          max={180}
          value={settings.light.azimuth}
          display={`${Math.round(settings.light.azimuth)}°`}
          typeable
          onChange={(azimuth) => store.setSettings({ light: { ...settings.light, azimuth } })}
        />
        <Slider
          label="Height"
          min={5}
          max={89}
          value={settings.light.elevation}
          display={`${Math.round(settings.light.elevation)}°`}
          typeable
          onChange={(elevation) => store.setSettings({ light: { ...settings.light, elevation } })}
        />
        <div className="chips">
          {LIGHT_PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => store.setSettings({ light: { ...settings.light, ...p.light } })}>{p.name}</button>
          ))}
        </div>
        <Toggle
          label="Cast shadows"
          checked={settings.light.shadows}
          onChange={(shadows) => store.setSettings({ light: { ...settings.light, shadows } })}
        />
      </Section>
      <Section title="Reference image">
        <p className="muted small">Overlay a photo or drawing to match a pose by eye.</p>
        <label className="file-button">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) ctx.setReference({ url: URL.createObjectURL(file), visible: true });
              e.target.value = '';
            }}
          />
          Choose image…
        </label>
        {ctx.reference.url && (
          <>
            <Slider
              label="Opacity"
              min={0.05}
              max={1}
              step={0.01}
              value={ctx.reference.opacity}
              display={`${Math.round(ctx.reference.opacity * 100)}%`}
              onChange={(opacity) => ctx.setReference({ opacity })}
            />
            <div className="row">
              <Toggle label="Show" checked={ctx.reference.visible} onChange={(visible) => ctx.setReference({ visible })} />
              <button onClick={() => ctx.setReference({ url: null })}>Remove</button>
            </div>
          </>
        )}
      </Section>
    </>
  );
}
