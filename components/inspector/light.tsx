'use client';

import { SunMedium } from 'lucide-react';
import { applyLightingPreset, editAmbient, editLight } from '@/lib/actions';
import { projectSettingsOf } from '@/lib/project';
import { KELVIN, LIGHTING_PRESETS, LIGHT_SWATCHES, ROLE_NAMES, kelvinColor, lightName, lightText, lightingName, lightingOf, sameLighting } from '@/lib/lighting';
import { poseScene, builtInPoses } from '@/lib/poses';
import { sharedRenderer } from '@/lib/thumbnails';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { LIGHT_ROLES, type Lighting } from '@/lib/types';
import { command, menu } from '../commands';
import { Thumbnail } from '../side/LibrarySection';
import { Field, NameHeader, Segmented, Slider, Toggle, type HeaderChrome } from '../ui';
import type { Target } from './target';

/*
 * The scene's lights: one selected (in the outline, or its lamp on the canvas), and the scene's
 * lighting as a whole (a scheme, the ambient light): see sections.ts.
 */

const LIT = STYLE_LIST.filter((s) => s.lit).map((s) => s.label);
const lit = (t: Target) => styleDef(projectSettingsOf(t.store.getState().library).style).lit;

export const lightSummary = (t: Target) => `${lightText(t.light!)} · ${Math.round(t.light!.intensity * 100)}%`;
export const lightInfo = () => 'Saved with the scene and used by its exports. Drag its lamp on the canvas, or Alt-click a figure to light it from where you look.';
export const lightingSummary = (t: Target) => lightingName(lightingOf(t.scene));
export const lightingInfo = () => 'Pick a scheme, then change it: select a light in the outline (or its lamp on the canvas), or add one there.';

export function LightHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  const name = lightName(lightingOf(t.scene), t.light!);
  return <NameHeader chrome={chrome} lead={<SunMedium size={16} strokeWidth={1.75} aria-hidden />} name={name} label={name} menu={() => menu('light', { store: t.store, light: t.light!.id })} />;
}

/** Line art, Minimal and Silhouette are not lit: said so, with the style that shows it best. */
function Unlit({ t }: { t: Target }) {
  if (lit(t)) return null;
  return (
    <div className="light-unlit" role="note">
      <span>Light shows in {LIT.join(', ').replace(/, ([^,]*)$/, ' and $1')}</span>
      <button type="button" className="btn subtle" onClick={() => command('light.clay').run!({ store: t.store, light: lightingOf(t.scene).lights[0].id })}>Switch to Clay</button>
    </div>
  );
}

/** One light: what it is for, where it comes from, how bright, its colour, its shadows (the key light's). */
export function LightPanel({ t }: { t: Target }) {
  const light = t.light!;
  const set = (patch: Parameters<typeof editLight>[2], key = '') => editLight(t.store, light.id, patch, key && `${key}:${light.id}`);
  return (
    <>
      <Unlit t={t} />
      <Segmented
        label="Role"
        full
        value={light.role}
        options={LIGHT_ROLES.map((r) => ({ value: r, label: r === 'custom' ? 'Other' : ROLE_NAMES[r].replace(' light', '') }))}
        onChange={(role) => set({ role })}
      />
      <p className="hint">{lightText(light)}</p>
      <div className="stack">
        <Slider label="Direction" min={-180} max={180} value={light.azimuth} display={`${Math.round(light.azimuth)}°`} typeable onChange={(azimuth) => set({ azimuth }, 'light')} />
        <Slider label="Height" min={5} max={89} value={light.elevation} display={`${Math.round(light.elevation)}°`} typeable onChange={(elevation) => set({ elevation }, 'light')} />
        <Slider label="Brightness" min={0} max={2} step={0.05} value={light.intensity} display={`${Math.round(light.intensity * 100)}%`} onChange={(intensity) => set({ intensity }, 'light')} />
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
      {light.role === 'key'
        ? <Toggle label="Shadows" checked={light.shadows} onChange={(shadows) => set({ shadows })} />
        : <p className="hint">Only the key light casts shadows.</p>}
    </>
  );
}

/** A scheme's thumbnail: a figure in Clay, lit by it. */
const schemeThumb = (lighting: Lighting) => ({
  key: `lighting:${JSON.stringify(lighting)}`,
  make: () => {
    const p = builtInPoses()[0];
    return sharedRenderer().render({ ...poseScene(p), lighting }, 144, 144, 1.2, { style: 'shaded', margin: 0.08, angle: { yaw: 20, pitch: 10, fov: 30 } }).toDataURL('image/png');
  },
});

/** The scene's lighting: the schemes (a thumbnail each), and the ambient light. */
export function LightingPanel({ t }: { t: Target }) {
  const lighting = lightingOf(t.scene);
  const a = lighting.ambient;
  return (
    <>
      {!t.light && <Unlit t={t} />}
      <div className="light-presets" role="group" aria-label="Lighting schemes">
        {LIGHTING_PRESETS.map((p) => {
          const on = sameLighting(p.lighting, lighting);
          return (
            <button key={p.id} type="button" className={on ? 'on' : undefined} aria-pressed={on} onClick={() => applyLightingPreset(t.store, p.id)}>
              <Thumbnail thumb={schemeThumb(p.lighting)} fallback={<SunMedium size={18} aria-hidden />} />
              <span>{p.name}</span>
            </button>
          );
        })}
      </div>
      <Slider label="Ambient" min={0} max={2} step={0.05} value={a.intensity} display={`${Math.round(a.intensity * 100)}%`} onChange={(intensity) => editAmbient(t.store, { intensity }, 'ambient')} />
      <div className="ambient-colours">
        <Field label="Sky">
          <input type="color" aria-label="Sky colour" value={a.sky} onChange={(e) => editAmbient(t.store, { sky: e.target.value }, 'ambient')} />
        </Field>
        <Field label="Ground">
          <input type="color" aria-label="Ground colour" value={a.ground} onChange={(e) => editAmbient(t.store, { ground: e.target.value }, 'ambient')} />
        </Field>
      </div>
    </>
  );
}
