'use client';

import { AppWindow, Lightbulb, Sun, type LucideIcon } from 'lucide-react';
import { editAmbient, editLight, placeSceneLight, subjectOf } from '@/lib/actions';
import { projectSettingsOf } from '@/lib/project';
import {
  KELVIN, KIND_NAMES, LIGHT_SWATCHES, PLACES, PLACE_NAMES, kelvinColor, lightText, lightingName, lightingOf,
} from '@/lib/lighting';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { LIGHT_KINDS, type Light, type LightKind } from '@/lib/types';
import { command, menu } from '../commands';
import { Field, NameHeader, PropertyRow, Segmented, Select, Slider, Toggle, type HeaderChrome } from '../ui';
import type { Target } from './target';

/*
 * The scene's lights: one selected (in the outline, or its lamp on the canvas), and the scene's
 * lighting as a whole (a scheme, the ambient light): see sections.ts. A light is a sun, a lamp
 * or a window; what it is for (key, fill, rim) is where it is put, and its name.
 */

export const KIND_ICONS: Record<LightKind, LucideIcon> = { sun: Sun, lamp: Lightbulb, window: AppWindow };

const LIT = STYLE_LIST.filter((s) => s.lit).map((s) => s.label);
const lit = (t: Target) => styleDef(projectSettingsOf(t.store.getState().library).style).lit;

export const lightTitle = (t: Target) => t.light!.name;
export const lightSummary = (t: Target) => `${lightText(t.light!)} · ${Math.round(t.light!.intensity * 100)}%`;
export const lightInfo = () => 'Saved with the scene and used by its exports. Drag it on the canvas (the sun over its dome, a lamp or a window over the floor), or Alt-click a figure to light it from where you look.';
export const ambientSummary = (t: Target) => `${lightingName(lightingOf(t.scene))} · ${Math.round(lightingOf(t.scene).ambient.intensity * 100)}%`;
export const ambientInfo = () => 'The light from all round: the sky above, the ground below. Pick a lighting scheme in the Library; select a light in the outline to change it.';

export function LightHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  const l = t.light!;
  const Icon = KIND_ICONS[l.kind];
  return (
    <NameHeader
      chrome={chrome}
      lead={<Icon size={16} strokeWidth={1.75} aria-hidden />}
      name={l.name}
      label="Light name"
      onRename={(name) => editLight(t.store, l.id, { name })}
      menu={() => menu('light', { store: t.store, light: l.id })}
    />
  );
}

/** Line art and Minimal are not lit: said so, with the style that shows it best. */
function Unlit({ t }: { t: Target }) {
  if (lit(t)) return null;
  return (
    <div className="light-unlit" role="note">
      <span>Light shows in {LIT.join(', ').replace(/, ([^,]*)$/, ' and $1')}</span>
      <button type="button" className="btn subtle" onClick={() => command('light.clay').run!({ store: t.store, light: lightingOf(t.scene).lights[0].id })}>Switch to Clay</button>
    </div>
  );
}

/** What a lamp aims at: nothing (all round; a spot straight down), the people, or one figure. */
function aimValue(l: Light) {
  return !l.aim ? 'none' : 'figure' in l.aim ? l.aim.figure : 'people';
}

/**
 * One light: the list of them, what it is (a sun, a lamp, a window), where to put it (as a key,
 * a fill, a rim), where it is (the sun's direction, a lamp's height and reach, a spot and what it
 * aims at), how bright, its colour, and the sun's shadows.
 */
export function LightPanel({ t }: { t: Target }) {
  const light = t.light!;
  const set = (patch: Parameters<typeof editLight>[2], key = '') => editLight(t.store, light.id, patch, key && `${key}:${light.id}`);
  const people = t.scene.figures.filter((f) => !f.hidden);
  return (
    <>
      <Unlit t={t} />
      <Segmented
        label="Kind of light"
        full
        value={light.kind}
        options={LIGHT_KINDS.map((k) => ({ value: k, label: KIND_NAMES[k], icon: KIND_ICONS[k] }))}
        onChange={(kind) => set({ kind })}
      />
      <PropertyRow label="Put it as">
        <div className="toolrow">
          {PLACES.map((p) => (
            <button key={p} type="button" className="btn subtle" data-tip={`Where a ${PLACE_NAMES[p].toLowerCase()} goes, round the people`} onClick={() => placeSceneLight(t.store, light.id, p)}>
              {PLACE_NAMES[p].replace(' light', '')}
            </button>
          ))}
        </div>
      </PropertyRow>
      <p className="hint">{lightText(light)}</p>
      <div className="stack">
        {light.kind === 'sun' ? (
          <>
            <Slider label="Direction" min={-180} max={180} value={light.azimuth} display={`${Math.round(light.azimuth)}°`} typeable onChange={(azimuth) => set({ azimuth }, 'light')} />
            <Slider label="Height" min={5} max={89} value={light.elevation} display={`${Math.round(light.elevation)}°`} typeable onChange={(elevation) => set({ elevation }, 'light')} />
          </>
        ) : (
          <>
            <Slider label="Height" min={0.2} max={8} step={0.05} value={light.position[1]} display={`${light.position[1].toFixed(2)} m`} typeable onChange={(y) => set({ position: [light.position[0], y, light.position[2]] }, 'light')} />
            {light.kind === 'lamp' && (
              <Slider label="Reach" min={1} max={30} step={0.5} value={light.range} display={`${light.range} m`} typeable onChange={(range) => set({ range }, 'light')} />
            )}
          </>
        )}
        <Slider label="Brightness" min={0} max={2} step={0.05} value={light.intensity} display={`${Math.round(light.intensity * 100)}%`} onChange={(intensity) => set({ intensity }, 'light')} />
      </div>
      {light.kind === 'lamp' && (
        <>
          <Toggle label="Spot" hint="A cone of light, aimed" checked={!!light.spot} onChange={(on) => set({ spot: on ? 45 : undefined })} />
          {light.spot && <Slider label="Cone" min={10} max={120} value={light.spot} display={`${Math.round(light.spot)}°`} onChange={(spot) => set({ spot }, 'light')} />}
        </>
      )}
      {light.kind !== 'sun' && (light.kind === 'window' || light.spot) && (
        <PropertyRow label="Aimed at">
          <Select
            label="Aimed at"
            value={aimValue(light)}
            options={[
              { value: 'none', label: light.kind === 'window' ? 'The people' : 'Straight down' },
              { value: 'people', label: 'Where the people are now' },
              ...people.map((f) => ({ value: f.id, label: f.name })),
            ]}
            onChange={(v) => set({ aim: v === 'none' ? undefined : v === 'people' ? { point: subjectOf(t.scene) } : { figure: v } })}
          />
        </PropertyRow>
      )}
      <div className="stack">
        <Slider
          label="Temperature"
          min={KELVIN.min}
          max={KELVIN.max}
          step={100}
          value={light.kelvin ?? KELVIN.white}
          display={light.kelvin ? `${light.kelvin} K` : 'Colour'}
          onChange={(kelvin) => set({ kelvin, color: kelvinColor(kelvin) }, 'light')}
        />
      </div>
      <div className="swatches" role="radiogroup" aria-label="Light colour">
        {LIGHT_SWATCHES.map((s) => (
          <button
            key={s.name}
            type="button"
            role="radio"
            aria-checked={light.color === s.color}
            aria-label={s.name}
            data-tip={s.kelvin ? `${s.name} · ${s.kelvin} K` : s.name}
            className={`swatch${light.color === s.color ? ' on' : ''}`}
            style={{ background: s.color }}
            onClick={() => set(s.kelvin ? { kelvin: s.kelvin, color: s.color } : { kelvin: undefined, color: s.color })}
          />
        ))}
      </div>
      {light.kind === 'sun'
        ? <Toggle label="Shadows" checked={light.shadows} onChange={(shadows) => set({ shadows })} />
        : <p className="hint">Only the sun casts shadows.</p>}
    </>
  );
}

/**
 * The scene's ambient light (nothing selected): how bright, the sky's colour above and the
 * ground's below. Its lights are in the outline (each selected to change it), the lighting schemes
 * in the Library.
 */
export function AmbientPanel({ t }: { t: Target }) {
  const a = lightingOf(t.scene).ambient;
  return (
    <>
      <Unlit t={t} />
      <Slider label="Brightness" min={0} max={2} step={0.05} value={a.intensity} display={`${Math.round(a.intensity * 100)}%`} onChange={(intensity) => editAmbient(t.store, { intensity }, 'ambient')} />
      <div className="ambient-colours">
        <Field label="Sky">
          <input type="color" aria-label="Sky colour" value={a.sky} onChange={(e) => editAmbient(t.store, { sky: e.target.value }, 'ambient')} />
        </Field>
        <Field label="Ground">
          <input type="color" aria-label="Ground colour" value={a.ground} onChange={(e) => editAmbient(t.store, { ground: e.target.value }, 'ambient')} />
        </Field>
      </div>
      <p className="hint">The lights themselves are in the outline; lighting schemes in the Library.</p>
    </>
  );
}
