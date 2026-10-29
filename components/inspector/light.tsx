'use client';

import { SunMedium } from 'lucide-react';
import { setSceneLight } from '@/lib/actions';
import { projectSettingsOf } from '@/lib/project';
import { DEFAULT_LIGHT, LIGHT_PRESETS, lightName, lightText } from '@/lib/lighting';
import { poseScene, builtInPoses } from '@/lib/poses';
import { sharedRenderer } from '@/lib/thumbnails';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import type { Light } from '@/lib/types';
import { command, menu } from '../commands';
import { Thumbnail } from '../side/LibrarySection';
import { NameHeader, Slider, Toggle, type HeaderChrome } from '../ui';
import type { Target } from './target';

/* The scene's key light, selected (in the outline, or its lamp on the canvas): see sections.ts. */

const LIT = STYLE_LIST.filter((s) => s.lit).map((s) => s.label);
const lightOf = (t: Target) => t.scene.light ?? DEFAULT_LIGHT;
const same = (a: Light, b: Light) => (['azimuth', 'elevation', 'intensity', 'warmth', 'shadows'] as const).every((k) => a[k] === b[k]);
const lit = (t: Target) => styleDef(projectSettingsOf(t.store.getState().library).style).lit;

export const lightSummary = (t: Target) => lightName(lightOf(t));
export const lightInfo = () => 'Saved with the scene and used by its exports. Drag its lamp on the canvas, or Alt-click a figure to light it from where you look.';

export function LightHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  return <NameHeader chrome={chrome} lead={<SunMedium size={16} strokeWidth={1.75} aria-hidden />} name="Light" label="Light" menu={() => menu('light', { store: t.store, light: true })} />;
}

/** A preset's thumbnail: a figure in Clay, lit by it. */
const presetThumb = (light: Light) => ({
  key: `light:${JSON.stringify(light)}`,
  make: () => {
    const p = builtInPoses()[0];
    return sharedRenderer().render({ ...poseScene(p), light }, 144, 144, 1.2, { style: 'shaded', margin: 0.08, angle: { yaw: 20, pitch: 10, fov: 30 } }).toDataURL('image/png');
  },
});

/** The light: where it comes from, how bright and warm, its shadows; presets with a thumbnail each. */
export function LightPanel({ t }: { t: Target }) {
  const light = lightOf(t);
  const setLight = (patch: Partial<Light>, key = 'light') => setSceneLight(t.store, { ...light, ...patch }, key);
  return (
    <>
      {!lit(t) && (
        // Line art, Minimal and Silhouette are not lit: say so, and offer the style that shows it best.
        <div className="light-unlit" role="note">
          <span>Light shows in {LIT.join(', ').replace(/, ([^,]*)$/, ' and $1')}</span>
          <button type="button" className="btn subtle" onClick={() => command('light.clay').run!({ store: t.store, light: true })}>Switch to Clay</button>
        </div>
      )}
      <div className="light-presets" role="group" aria-label="Lighting presets">
        {LIGHT_PRESETS.map((p) => (
          <button key={p.id} type="button" className={same(p.light, light) ? 'on' : undefined} aria-pressed={same(p.light, light)} onClick={() => setLight(p.light, '')}>
            <PresetThumb light={p.light} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      <p className="hint">{lightText(light)}</p>
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
      <Toggle label="Shadows" checked={light.shadows} onChange={(shadows) => setLight({ shadows }, '')} />
    </>
  );
}

function PresetThumb({ light }: { light: Light }) {
  return <Thumbnail thumb={presetThumb(light)} fallback={<SunMedium size={18} aria-hidden />} />;
}
