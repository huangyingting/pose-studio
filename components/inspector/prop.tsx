'use client';

import { RotateCcw } from 'lucide-react';
import { holdProp, renameProp, setPropPhysics } from '@/lib/actions';
import { physicsOf } from '@/lib/propmotion';
import { PROP_LABELS, type Side, type Vec3 } from '@/lib/types';
import { menu } from '../commands';
import { PROP_ICONS } from '../icons';
import { IconButton, NameHeader, NumberField, Select, Slider, type HeaderChrome } from '../ui';
import type { Target } from './target';

/* A prop's header and sections: see sections.ts for which show when. */

export function PropHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  const prop = t.prop!;
  const Icon = PROP_ICONS[prop.kind];
  return (
    <NameHeader
      chrome={chrome}
      lead={<Icon size={17} strokeWidth={1.75} aria-hidden />}
      name={prop.name}
      label={`${PROP_LABELS[prop.kind]} name`}
      onRename={(name) => renameProp(t.store, prop.id, name)}
      menu={() => menu('prop', { store: t.store, prop: prop.id })}
    />
  );
}

export function TransformPanel({ t }: { t: Target }) {
  const prop = t.prop!;
  const set = (key: 'position' | 'rotation' | 'scale', axis: number, v: number) => {
    const next: Vec3 = [...prop[key]];
    next[axis] = key === 'scale' ? Math.max(0.02, v) : v;
    t.store.updateProp(prop.id, (p) => ({ ...p, [key]: next }), `prop:${prop.id}:${key}:${axis}`);
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
      {row('position', 'Position', 0.05)}
      {row('rotation', 'Rotation', 5)}
      {row('scale', 'Size', 0.05)}
    </>
  );
}

export const transformInfo = (t: Target) => (t.prop!.hold
  ? 'Relative to the hand: it follows the pose and the animation. Drag it on the canvas to move the hand; W adjusts the grip.'
  : 'Drag a letter to scrub. On the canvas, drag the prop to move it and its ring to turn it; W also moves it up and down, R scales it.');

export function HeldByPanel({ t }: { t: Target }) {
  const prop = t.prop!;
  return (
    <Select
      label="Held by"
      value={prop.hold ? `${prop.hold.figure}:${prop.hold.hand}` : 'none'}
      onChange={(v) => {
        const [figure, hand] = v.split(':');
        holdProp(t.store, prop.id, v === 'none' ? null : { figure, hand: hand as Side });
      }}
      options={[
        { value: 'none', label: 'Nobody: it stands on the floor' },
        // Hands to hold it: not stand-ins' (they have none) or hidden figures'; whoever holds it now stays listed.
        ...t.scene.figures.filter((f) => (!f.hidden && !f.proxy) || f.id === prop.hold?.figure).flatMap((f) => (['R', 'L'] as const).map((hand) => ({ value: `${f.id}:${hand}`, label: `${f.name}: ${hand === 'L' ? 'left' : 'right'} hand` }))),
      ]}
    />
  );
}

export function PhysicsPanel({ t }: { t: Target }) {
  const prop = t.prop!;
  const ph = physicsOf(prop);
  return (
    <>
      <Slider label="Bounce" min={0} max={1} step={0.01} value={ph.bounce} display={`${Math.round(ph.bounce * 100)}%`} onChange={(bounce) => setPropPhysics(t.store, prop.id, { bounce }, `physics:${prop.id}:bounce`)} />
      <Slider label="Grip" min={0} max={1} step={0.01} value={ph.friction} display={`${Math.round(ph.friction * 100)}%`} onChange={(friction) => setPropPhysics(t.store, prop.id, { friction }, `physics:${prop.id}:grip`)} />
    </>
  );
}

export function PhysicsActions({ t }: { t: Target }) {
  const prop = t.prop!;
  return prop.physics ? <IconButton icon={RotateCcw} label={`Reset to the default for ${PROP_LABELS[prop.kind].toLowerCase()}s`} onClick={() => setPropPhysics(t.store, prop.id, null)} /> : null;
}
