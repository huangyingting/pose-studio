'use client';

import { ChevronRight, Clapperboard, Eye, EyeOff, ImagePlus, Trash2 } from 'lucide-react';
import { editReference, renameScene, setCaption, setReferenceImage, setSceneLight } from '@/lib/actions';
import { filmOf } from '@/lib/film';
import { DEFAULT_LIGHT, LIGHT_PRESETS } from '@/lib/lighting';
import { videoModel } from '@/lib/shots';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import type { Light } from '@/lib/types';
import { menu } from '../commands';
import { useFilm } from '../store-context';
import { IconButton, NameHeader, Select, Slider, Toggle, type HeaderChrome } from '../ui';
import type { Target } from './target';

/* The scene's header and sections (nothing selected): see sections.ts for which show when. */

export function SceneHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  const film = useFilm();
  const index = t.store.getState().sceneIndex;
  return (
    <>
      <NameHeader chrome={chrome} lead={<Clapperboard size={16} strokeWidth={1.75} aria-hidden />} name={t.scene.name} label="Scene name" onRename={(name) => renameScene(t.store, name)} menu={() => menu('scene', { store: t.store, scene: index })} />
      <div className="psec">
        {/* The film's settings are the project's: a link to their one home, not a copy of them. */}
        <button type="button" className="summary-row" onClick={t.ctx.projectSettings} data-tip="The frame, what it is cut for and face features, for every scene">
          <span>Project settings…</span>
          <em>{film.frame}{film.target ? ` · ${videoModel(film.target)?.name}` : ''}</em>
          <ChevronRight size={14} aria-hidden />
        </button>
      </div>
    </>
  );
}

export function CaptionPanel({ t }: { t: Target }) {
  return (
    <label className="field">
      <span>Caption</span>
      <textarea
        value={t.scene.caption ?? ''}
        aria-label="Scene caption"
        rows={2}
        placeholder="What happens…"
        onChange={(e) => setCaption(t.store, t.scene.id, null, e.target.value)}
      />
    </label>
  );
}

const LIT = STYLE_LIST.filter((s) => s.lit).map((s) => s.label).join(', ');
const lightOf = (t: Target) => t.scene.light ?? DEFAULT_LIGHT;
const same = (a: Light, b: Light) => (['azimuth', 'elevation', 'intensity', 'warmth', 'shadows'] as const).every((k) => a[k] === b[k]);
const lightPreset = (t: Target) => LIGHT_PRESETS.find((p) => same(p.light, lightOf(t)));
export const lightSummary = (t: Target) => lightPreset(t)?.name ?? 'Custom';
export const lightInfo = (t: Target) => `Saved with the scene and used by its exports.${styleDef(filmOf(t.store.getState().library).style).lit ? '' : ` It shows in the lit styles (${LIT}): pick one in the top bar.`}`;

/** The scene's light: saved with it, used by its exports. */
export function LightPanel({ t }: { t: Target }) {
  const light = lightOf(t);
  const preset = lightPreset(t);
  const setLight = (patch: Partial<Light>, key = 'light') => setSceneLight(t.store, { ...light, ...patch }, key);
  return (
    <>
      <div className="field">
        <span>Preset</span>
        <Select
          label="Lighting preset"
          value={preset?.id ?? 'custom'}
          onChange={(id) => { const p = LIGHT_PRESETS.find((x) => x.id === id); if (p) setLight(p.light, ''); }}
          options={[...LIGHT_PRESETS.map((p) => ({ value: p.id, label: p.name })), ...(preset ? [] : [{ value: 'custom', label: 'Custom' }])]}
        />
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
      <Toggle label="Shadows" checked={light.shadows} onChange={(shadows) => setLight({ shadows }, '')} />
    </>
  );
}

export const referenceSummary = (t: Target) => {
  const r = t.scene.reference;
  return r ? `${Math.round(r.opacity * 100)}%${r.visible ? '' : ' · hidden'}` : 'None';
};

/** A photo or drawing over the canvas, to pose against: saved with the scene, not filmed or exported. */
export function ReferencePanel({ t }: { t: Target }) {
  const reference = t.scene.reference;
  return (
    <>
      <label className="btn subtle file-button">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void setReferenceImage(t.store, file);
            e.target.value = '';
          }}
        />
        <ImagePlus size={14} aria-hidden /> {reference ? 'Replace image…' : 'Add an image…'}
      </label>
      {reference && (
        <Slider
          label="Opacity"
          min={0.05}
          max={1}
          step={0.01}
          value={reference.opacity}
          display={`${Math.round(reference.opacity * 100)}%`}
          onChange={(opacity) => editReference(t.store, { opacity }, 'reference')}
        />
      )}
    </>
  );
}

export function ReferenceActions({ t }: { t: Target }) {
  const reference = t.scene.reference;
  if (!reference) return null;
  return (
    <>
      <IconButton
        icon={reference.visible ? Eye : EyeOff}
        label={reference.visible ? 'Hide reference' : 'Show reference'}
        onClick={() => editReference(t.store, { visible: !reference.visible })}
      />
      <IconButton icon={Trash2} label="Remove reference" onClick={() => editReference(t.store, null)} />
    </>
  );
}
