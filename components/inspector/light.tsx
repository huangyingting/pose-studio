'use client';

import { AppWindow, Lightbulb, Sun, SunMedium, type LucideIcon } from 'lucide-react';
import { useRef } from 'react';
import { editAmbient, editLight, placeSceneLight, setEnvironment, setLightForShot, setLightRole, setLook, subjectOf } from '@/lib/actions';
import { cameraAt } from '@/lib/cameras';
import { projectSettingsOf } from '@/lib/project';
import {
  KELVIN, KIND_NAMES, LIGHT_SWATCHES, ROLE_ABOUT, ROLE_NAMES, keyLight, kelvinColor, lightText, lightingName, lightingOf, lookOf, sunText,
} from '@/lib/lighting';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { LIGHT_KINDS, LIGHT_ROLES, type Light, type LightKind, type LightRole } from '@/lib/types';
import { command, menu } from '../commands';
import { Field, NameHeader, PropertyRow, Segmented, Select, Slider, Toggle, type HeaderChrome } from '../ui';
import type { Target } from './target';

/*
 * The scene's lighting as a whole (#17), the first row of the outline's lights: its look (where
 * the key comes from, how high, the contrast, the warmth), where it is (indoors or out, the time,
 * the weather), more of its look (softness, the rim, the fill and rim with the shot) and its sky.
 * A light, in three sections (sections.ts): what kind it is (a sun, a lamp, a window), its role
 * (key, fill, rim, practical, follow light) and where it is, and its brightness and colour.
 */

export const KIND_ICONS: Record<LightKind, LucideIcon> = { sun: Sun, lamp: Lightbulb, window: AppWindow };

/** What each kind of light is, in a line. */
const KIND_ABOUT: Record<LightKind, string> = {
  sun: 'Parallel light from far away: a direction. Only the key casts shadows.',
  lamp: 'A bulb in the scene, lighting all round as far as it reaches. A spot is a cone aimed at someone.',
  window: 'Soft light through a pane, aimed at the people.',
};

const LIT = STYLE_LIST.filter((s) => s.lit).map((s) => s.label);
const lit = (t: Target) => styleDef(projectSettingsOf(t.store.getState().library).style).lit;
const percent = (n: number) => `${Math.round(n * 100)}%`;

export const kindSummary = (t: Target) => `${KIND_NAMES[t.light!.kind]}${t.light!.spot ? ', spot' : ''}`;
export const placeSummary = (t: Target) => `${t.light!.role ? `${ROLE_NAMES[t.light!.role]} · ` : ''}${lightText(t.light!)}`;
export const placeInfo = () => 'Its role is what it is for. Drag it on the canvas: the sun over its dome, a lamp or a window over the floor. Alt-click a figure to light it from where you look.';
export const colourSummary = (t: Target) => `${percent(t.light!.intensity)}${t.light!.kelvin ? ` · ${t.light!.kelvin} K` : ''}`;
export const ambientSummary = (t: Target) => percent(lightingOf(t.scene).ambient.intensity);
export const ambientInfo = () => 'The light from all round: the sky above, the ground below. It fills the shadows.';

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

export function LightingHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  return (
    <NameHeader chrome={chrome} lead={<SunMedium size={16} strokeWidth={1.75} aria-hidden />} name="Lighting" label="Lighting" menu={() => menu('lighting', { store: t.store })}>
      <span className="name-header-note">{lightingName(lightingOf(t.scene))}</span>
    </NameHeader>
  );
}

/** Line art and Minimal are not lit: said so, with the style that shows it best. */
function Unlit({ t }: { t: Target }) {
  if (lit(t)) return null;
  return (
    <div className="light-unlit" role="note">
      <span>{styleDef(projectSettingsOf(t.store.getState().library).style).label} shows no light. It shows in {LIT.join(', ').replace(/, ([^,]*)$/, ' and $1')}.</span>
      <button type="button" className="btn subtle" onClick={() => command('light.clay').run!({ store: t.store, light: lightingOf(t.scene).lights[0].id })}>Switch to Clay</button>
    </div>
  );
}

/** What a lamp aims at: nothing (all round; a spot straight down), the people, or one figure. */
function aimValue(l: Light) {
  return !l.aim ? 'none' : 'figure' in l.aim ? l.aim.figure : 'people';
}

const editOf = (t: Target) => (patch: Parameters<typeof editLight>[2], key = '') => editLight(t.store, t.light!.id, patch, key && `${key}:${t.light!.id}`);

/** What kind of light it is: a sun, a lamp or a window, each said in a line; one from the set says so. */
export function KindPanel({ t }: { t: Target }) {
  const light = t.light!;
  const set = editOf(t);
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
      <p className="hint">{KIND_ABOUT[light.kind]}</p>
      {light.ofSet && <p className="hint">Part of the set: another set takes it away.</p>}
    </>
  );
}

/** A light's role: a key, a fill or a rim put where it goes round the people; a practical or a follow light where it is. */
function setRole(t: Target, role: LightRole | 'none') {
  const id = t.light!.id;
  if (role === 'key' || role === 'fill' || role === 'rim') placeSceneLight(t.store, id, role);
  else setLightRole(t.store, id, role === 'none' ? null : role);
}

/**
 * Its role (what it is for: a key, a fill or a rim put where it goes; a set's own a practical) and
 * where it is, as its kind moves: the sun's direction (a fill's or a rim's for the shot: from the
 * camera) and height, a lamp's or a window's height (a lamp's reach, a spot and its cone), what a
 * spot or a window aims at, whom a follow light follows; the key's shadows.
 */
export function PlacePanel({ t }: { t: Target }) {
  const light = t.light!;
  const set = editOf(t);
  const people = t.scene.figures.filter((f) => !f.hidden);
  const forShot = light.kind === 'sun' && light.relative === 'shot';
  const isKey = keyLight(lightingOf(t.scene))?.id === light.id;
  return (
    <>
      {light.ofSet ? <p className="hint">A practical of the set: it lights what is near it.</p> : (
        <PropertyRow label="Role" info={light.role ? ROLE_ABOUT[light.role] : 'What it is for: the look (the Lighting row) works on the key, the fill and the rim'}>
          <Select<LightRole | 'none'>
            label="Role"
            value={light.role ?? 'none'}
            options={[...LIGHT_ROLES.map((r) => ({ value: r, label: ROLE_NAMES[r] })), { value: 'none', label: 'None' }]}
            onChange={(r) => setRole(t, r)}
          />
        </PropertyRow>
      )}
      {light.role === 'follow' && (
        <PropertyRow label="Follows">
          <Select<string>
            label="Follows"
            value={light.follows ?? ''}
            options={[{ value: '', label: 'Nobody' }, ...people.map((f) => ({ value: f.id, label: f.name }))]}
            onChange={(v) => set({ follows: v || undefined })}
          />
        </PropertyRow>
      )}
      {light.kind === 'sun' && (light.role === 'fill' || light.role === 'rim') && (
        <Toggle label="Placed for the shot" hint="From each shot's camera, on the side away from the key. Off: fixed in the scene" checked={forShot} onChange={(on) => setLightForShot(t.store, light.id, on)} />
      )}
      <p className="hint">{forShot ? `${Math.round(light.azimuth)}° from the shot's camera, ${Math.round(light.elevation)}° high` : lightText(light)}</p>
      <div className="stack">
        {light.kind === 'sun' ? (
          <>
            {forShot
              ? <Slider label="From the camera" min={0} max={180} value={light.azimuth} display={`${Math.round(light.azimuth)}°`} typeable onChange={(azimuth) => set({ azimuth }, 'light')} />
              : <Slider label="Direction" min={-180} max={180} value={light.azimuth} display={`${Math.round(light.azimuth)}°`} typeable onChange={(azimuth) => set({ azimuth }, 'light')} />}
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
              { value: 'people', label: 'Where they stand' },
              ...people.map((f) => ({ value: f.id, label: f.name })),
            ]}
            onChange={(v) => set({ aim: v === 'none' ? undefined : v === 'people' ? { point: subjectOf(t.scene) } : { figure: v } })}
          />
        </PropertyRow>
      )}
      {light.kind === 'sun' && isKey && <Toggle label="Shadows" checked={light.shadows} onChange={(shadows) => set({ shadows })} />}
    </>
  );
}

/** How bright, and its colour: a temperature, or the colour of a real light. */
export function ColourPanel({ t }: { t: Target }) {
  const light = t.light!;
  const set = editOf(t);
  return (
    <>
      <div className="stack">
        <Slider label="Brightness" min={0} max={2} step={0.05} value={light.intensity} display={percent(light.intensity)} onChange={(intensity) => set({ intensity }, 'light')} />
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
    </>
  );
}

/** The scene's ambient light: how bright, the sky's colour above and the ground's below. */
export function AmbientPanel({ t }: { t: Target }) {
  const a = lightingOf(t.scene).ambient;
  return (
    <>
      <Slider label="Brightness" min={0} max={2} step={0.05} value={a.intensity} display={percent(a.intensity)} onChange={(intensity) => editAmbient(t.store, { intensity }, 'ambient')} />
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

/* ---------- the scene's lighting as a whole (#17) ---------- */

/** The open scene's look now (round its people), and where its shot's camera is (its azimuth from them). */
function lookNow(t: Target) {
  const l = lightingOf(t.scene);
  const v = cameraAt(t.scene, t.scene.animation ? t.time : 0);
  return { l, look: lookOf(l, subjectOf(t.scene)), camAz: (Math.atan2(v.position.x - v.target.x, v.position.z - v.target.z) * 180) / Math.PI };
}

const ratio = (c: number) => `${c >= 10 ? Math.round(c) : Math.round(c * 2) / 2}:1`;

export const lookSummary = (t: Target) => {
  const { look } = lookNow(t);
  return `${sunText({ azimuth: look.direction, elevation: look.height })}${look.contrast ? ` · ${ratio(look.contrast)}` : ''}`;
};
export const lookInfo = () => 'Where the key light comes from and how high, how dark its shadow side is (the key against the fill) and how warm it is. The key is fixed in the scene; the fill and the rim are placed for each shot.';

/** The look: the key's direction (a dial round the people, the shot's camera on it) and height, the contrast, the warmth. */
export function LookPanel({ t }: { t: Target }) {
  const { look, camAz } = lookNow(t);
  const set = (patch: Parameters<typeof setLook>[1], key = '') => setLook(t.store, patch, key && `look-${key}`);
  return (
    <>
      <Unlit t={t} />
      <div className="look-direction">
        <DirectionDial value={look.direction} camera={camAz} lights={dialLights(t, camAz)} onChange={(direction, key) => set({ direction }, key)} />
        <p className="hint">The key light: {sunText({ azimuth: look.direction, elevation: look.height }).replace(/^./, (c) => c.toLowerCase())}. Drag it round the people; the camera is the shot&apos;s.</p>
      </div>
      <Slider label="Height" min={5} max={89} value={look.height} display={`${Math.round(look.height)}°`} typeable onChange={(height) => set({ height }, 'height')} />
      <Slider
        label="Contrast"
        min={0}
        max={4}
        step={0.25}
        value={look.contrast ? Math.log2(look.contrast) : 4}
        display={look.contrast ? ratio(look.contrast) : 'No fill'}
        onChange={(v) => set({ contrast: Math.round(2 ** v * 2) / 2 }, 'contrast')}
      />
      <Slider label="Warmth" min={KELVIN.min} max={KELVIN.max} step={100} value={KELVIN.max + KELVIN.min - look.warmth} display={`${look.warmth} K`} onChange={(warmth) => set({ warmth: KELVIN.max + KELVIN.min - warmth }, 'warmth')} />
    </>
  );
}

/** The key, the fill and the rim on the dial: where they are now (a fill or a rim for the shot: from its camera, away from the key). */
function dialLights(t: Target, camAz: number) {
  const { l, look } = lookNow(t);
  const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;
  const away = turn(camAz, look.direction) > 0 ? -1 : 1;
  return l.lights
    .filter((x) => x.kind === 'sun' && (x.role === 'fill' || x.role === 'rim'))
    .map((x) => ({ role: x.role!, azimuth: x.relative ? camAz + away * Math.abs(x.azimuth) : x.azimuth }));
}

/**
 * The only new widget of #17: a small top-down circle round the people (front at the bottom, as if
 * facing them; left and right are theirs), the key's dot dragged round it; the fill, the rim and
 * the shot's camera drawn on it.
 */
function DirectionDial({ value, camera, lights, onChange }: { value: number; camera: number; lights: { role: LightRole; azimuth: number }[]; onChange(v: number, key: string): void }) {
  const ref = useRef<SVGSVGElement>(null);
  const R = 33;
  const at = (az: number, r = R) => ({ x: 50 + r * Math.sin((az * Math.PI) / 180), y: 50 + r * Math.cos((az * Math.PI) / 180) });
  const from = (e: React.PointerEvent) => {
    const b = ref.current!.getBoundingClientRect();
    return Math.round(((Math.atan2(e.clientX - b.left - b.width / 2, e.clientY - b.top - b.height / 2) * 180) / Math.PI) / 5) * 5;
  };
  const key = at(value);
  const cam = at(camera, R + 4);
  const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
  return (
    <svg
      ref={ref}
      className="direction-dial"
      viewBox="0 0 100 100"
      role="slider"
      tabIndex={0}
      aria-label="Key light direction"
      aria-valuemin={-180}
      aria-valuemax={180}
      aria-valuenow={Math.round(value)}
      aria-valuetext={sunText({ azimuth: value, elevation: 45 }).replace(/, .*$/, '')}
      data-tip="Drag round: where the key comes from (left and right are the people's)"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onChange(from(e), 'dir'); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(from(e), 'dir'); }}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : 0;
        if (!d) return;
        e.preventDefault();
        onChange(wrap(value + d * (e.shiftKey ? 3 : 1)), 'dir');
      }}
    >
      <circle className="dial-ring" cx={50} cy={50} r={R} />
      <text className="dial-mark" x={50} y={98}>Front</text>
      <text className="dial-mark" x={50} y={9}>Back</text>
      <text className="dial-mark" x={95} y={53}>L</text>
      <text className="dial-mark" x={5} y={53}>R</text>
      <circle className="dial-people" cx={50} cy={50} r={5} />
      <path className="dial-camera" d={`M${cam.x - 3.5},${cam.y - 2.5}h7v5h-7z`} transform={`rotate(${-camera} ${cam.x} ${cam.y})`}><title>The shot&apos;s camera</title></path>
      {lights.map((x, i) => {
        const p = at(x.azimuth, R - 8);
        return <circle key={i} className={`dial-${x.role}`} cx={p.x} cy={p.y} r={4}><title>{ROLE_NAMES[x.role]}</title></circle>;
      })}
      <line className="dial-ray" x1={50} y1={50} x2={key.x} y2={key.y} />
      <circle className="dial-key" cx={key.x} cy={key.y} r={6.5}><title>Key</title></circle>
    </svg>
  );
}

const TIMES: [number, string][] = [[5.5, 'night'], [7.5, 'dawn'], [10.5, 'morning'], [14, 'midday'], [17, 'afternoon'], [20, 'dusk'], [24.1, 'night']];
const timeText = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')} · ${TIMES.find(([to]) => h < to)![1]}`;

export const environmentSummary = (t: Target) => {
  const e = lightingOf(t.scene).environment ?? {};
  return e.indoors ? 'Indoors' : `Outdoors${e.time !== undefined ? ` · ${timeText(e.time)}` : ''}${e.weather === 'overcast' ? ' · overcast' : ''}`;
};
export const environmentInfo = () => 'Outdoors the key is the sun: the time of day sets its height and colour and the sky, the weather its shadows. Indoors the key is a studio light, and the set\'s walls and roof cast none of its shadows.';

/** Where the scene is lit: indoors or out; out of doors, the time of day and the weather (they set the sun and the sky). */
export function EnvironmentPanel({ t }: { t: Target }) {
  const e = lightingOf(t.scene).environment ?? {};
  return (
    <>
      <Segmented<'out' | 'in'>
        label="Where"
        full
        value={e.indoors ? 'in' : 'out'}
        options={[{ value: 'out', label: 'Outdoors' }, { value: 'in', label: 'Indoors' }]}
        onChange={(v) => setEnvironment(t.store, { indoors: v === 'in' })}
      />
      {e.indoors ? <p className="hint">No sun: the key is a studio light. The set&apos;s walls and roof cast none of its shadows; its lamps and windows light what is near them.</p> : (
        <>
          <Slider label="Time" min={0} max={24} step={0.25} value={e.time ?? 12} display={e.time === undefined ? 'Not set' : timeText(e.time)} onChange={(time) => setEnvironment(t.store, { time }, 'env-time')} />
          <Segmented<'clear' | 'overcast'>
            label="Weather"
            full
            value={e.weather ?? 'clear'}
            options={[{ value: 'clear', label: 'Clear' }, { value: 'overcast', label: 'Overcast' }]}
            onChange={(weather) => setEnvironment(t.store, { weather, ...(e.time === undefined ? { time: 12 } : {}) })}
          />
        </>
      )}
    </>
  );
}

export const moreSummary = (t: Target) => {
  const { look } = lookNow(t);
  return `Softness ${percent(look.softness)} · rim ${look.rim ? percent(look.rim) : 'none'}`;
};

/** More of the look: the key's softness, the rim's strength, whether the fill and the rim are placed for each shot. */
export function MorePanel({ t }: { t: Target }) {
  const { look } = lookNow(t);
  const set = (patch: Parameters<typeof setLook>[1], key = '') => setLook(t.store, patch, key && `look-${key}`);
  return (
    <>
      <Slider label="Softness" min={0} max={1} step={0.05} value={look.softness} display={percent(look.softness)} onChange={(softness) => set({ softness }, 'soft')} />
      <Slider label="Rim" min={0} max={2} step={0.05} value={look.rim} display={look.rim ? percent(look.rim) : 'None'} onChange={(rim) => set({ rim }, 'rim')} />
      <Toggle label="Fill and rim follow the shot" hint="Placed for each shot's camera, on the side away from the key (they cast no shadows, so nothing jumps at a cut). Off: fixed in the scene" checked={look.forShot} onChange={(forShot) => set({ forShot })} />
    </>
  );
}
