import { CUTAWAY_LAYER } from './ink';
import * as THREE from 'three';
import { styleDef } from './styles';
import { LIGHT_KINDS, LIGHT_ROLES, type Ambient, type Environment, type Light, type LightKind, type LightRole, type Lighting, type Scene, type Style, type Vec3 } from './types';
import { uid } from './uid';

/*
 * A scene's lights: the sun (parallel rays from a direction: the only light that casts shadows),
 * lamps (points in the scene, all round or spots aimed at someone, reaching so far) and windows
 * (a soft light from a pane in the scene), up to MAX_LIGHTS; and the ambient light from the sky
 * and the ground. What a light is for (key, fill, rim) is where it is put and its name: placing a
 * light as a fill or a rim puts it there (placeLight). A set may bring lights of its own (its
 * lamps, its windows: lib/sets.ts). Only the lit styles show them (lib/styles.ts). Most scenes
 * take a lighting scheme (LIGHTING_PRESETS) and change it a little.
 */

/** As many lights as a scene can have (its set's own among them). */
export const MAX_LIGHTS = 6;

export const KIND_NAMES: Record<LightKind, string> = { sun: 'Sun', lamp: 'Lamp', window: 'Window' };

/** Where a light can be put for what it does (placeLight). */
export const PLACES = ['key', 'fill', 'rim'] as const;
export type Place = (typeof PLACES)[number];
export const PLACE_NAMES: Record<Place, string> = { key: 'Key light', fill: 'Fill light', rim: 'Rim light' };

/**
 * A colour temperature (K) as a colour, daylight (6500 K) white, as a camera balanced for daylight
 * sees it: a candle's light a warm peach, not a pure orange; a blue sky's shade a pale blue.
 */
export function kelvinColor(kelvin: number): string {
  const rgb = (k: number) => {
    const t = k / 100;
    const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    return [r, g, b];
  };
  const white = rgb(6500);
  // (A third of the way back to white: what the eye and the camera's balance make of it.)
  const c = rgb(kelvin).map((v, i) => Math.round(255 * (0.35 + 0.65 * Math.min(1, Math.max(0, v / white[i])))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Colour temperatures a light can take (K). */
export const KELVIN = { min: 1800, max: 10000, white: 6500 };

/** Lights from life to pick a light's colour from: by their colour temperatures, and a sodium street lamp's. */
export const LIGHT_SWATCHES: { name: string; color: string; kelvin?: number }[] = [
  { name: 'Candle', kelvin: 1900 },
  { name: 'Light bulb', kelvin: 2700 },
  { name: 'Sunset', kelvin: 3500 },
  { name: 'Sun', kelvin: 5500 },
  { name: 'Daylight', kelvin: 6500 },
  { name: 'Overcast', kelvin: 7500 },
  { name: 'Blue sky shade', kelvin: 9500 },
  { name: 'Street lamp', color: '#ffd09e' },
].map((s) => ({ ...s, color: s.color ?? kelvinColor(s.kelvin!) }));

/** A light (a new one: its own id). */
export function newLight(kind: LightKind, l: Partial<Omit<Light, 'id' | 'kind'>> = {}, id = uid('light')): Light {
  const kelvin = l.kelvin ?? (l.color ? undefined : KELVIN.white);
  return {
    id, kind,
    name: l.name ?? KIND_NAMES[kind],
    azimuth: l.azimuth ?? 40, elevation: l.elevation ?? 45,
    position: l.position ?? [1.5, 2.2, 1.5],
    ...(kind === 'lamp' && l.spot ? { spot: l.spot } : {}),
    ...(kind !== 'sun' && l.aim ? { aim: l.aim } : {}),
    range: l.range ?? 8,
    intensity: l.intensity ?? 1,
    color: l.color ?? kelvinColor(kelvin!),
    ...(kelvin !== undefined ? { kelvin } : {}),
    shadows: kind === 'sun' && l.shadows !== false,
    ...roleOf(l),
  };
}

/** A light's role and what goes with it (as it may be): who it follows, whether it came with the set, its softness. */
function roleOf(l: Partial<Light>): Pick<Light, 'role' | 'relative' | 'follows' | 'ofSet' | 'soft'> {
  const role = LIGHT_ROLES.includes(l.role as LightRole) ? l.role : undefined;
  return {
    ...(role ? { role } : {}),
    ...(l.relative === 'shot' && (role === 'fill' || role === 'rim') ? { relative: 'shot' as const } : {}),
    ...(role === 'follow' && typeof l.follows === 'string' && l.follows ? { follows: l.follows.slice(0, 40) } : {}),
    ...(l.ofSet === true ? { ofSet: true as const } : {}),
    ...(typeof l.soft === 'number' && l.soft > 0 ? { soft: num(l.soft, 0, 0, 1) } : {}),
  };
}

const ambient = (intensity = 1, sky = '#ffffff', ground = '#ffffff'): Ambient => ({ intensity, sky, ground });

/** The key light most scenes start with: the sun from the front-left, above. */
const keySun = (l: Partial<Light> = {}) => newLight('sun', { name: 'Key light', role: 'key', ...l }, 'key');
/** A fill or a rim: a direction placed for the shot's camera (degrees from it, on the side away from the key), no shadows (#17). */
const forShot = (role: 'fill' | 'rim', l: Partial<Light>) => newLight('sun', { name: role === 'fill' ? 'Fill light' : 'Rim light', role, relative: 'shot', shadows: false, ...l }, role);

/**
 * A scene's lighting without its own: one key light from the front-left, above; the sky white, the
 * ground's bounce a warm grey (what is in shade keeps its form: lighter above, darker below).
 */
export const DEFAULT_LIGHTING: Lighting = { lights: [keySun()], ambient: ambient(1, '#ffffff', '#c9c2b6') };

/** Where the people are, in a scheme: its lamps placed round it (fromPreset moves them to the people). */
const SUBJECT: Vec3 = [0, 1.3, 0];

/** Lighting schemes: a scene's lights at once, to start from (lamps round the people at the stage origin). */
export const LIGHTING_PRESETS: { id: string; name: string; description: string; lighting: Lighting }[] = [
  { id: 'studio', name: 'Studio', description: 'One sun from the front-left, above: clear and even, with shadows.', lighting: DEFAULT_LIGHTING },
  { id: 'soft', name: 'Soft', description: 'A high, gentle sun without shadows and a bright sky: soft and flat.', lighting: { lights: [keySun({ azimuth: 25, elevation: 65, intensity: 0.8, kelvin: 6000, shadows: false })], ambient: ambient(1.15) } },
  {
    id: 'three-point', name: 'Three-point', description: 'The classic portrait lighting: a key from the front-left, a dim fill from the other side, a rim light behind.', lighting: {
      lights: [
        keySun({ azimuth: 40, elevation: 35, intensity: 1.1 }),
        forShot('fill', { azimuth: 35, elevation: 15, intensity: 0.45 }),
        forShot('rim', { azimuth: 150, elevation: 35, intensity: 1.1, kelvin: 7500 }),
      ],
      ambient: ambient(0.6),
    },
  },
  {
    id: 'rembrandt', name: 'Rembrandt', description: 'A warm key high to one side and almost no fill: half the face in shadow.', lighting: {
      lights: [keySun({ azimuth: 50, elevation: 45, intensity: 1.35, kelvin: 3200 }), forShot('fill', { azimuth: 30, elevation: 10, intensity: 0.18, kelvin: 3200 })],
      ambient: ambient(0.45, '#efe8de', '#4d4740'),
    },
  },
  { id: 'back', name: 'Backlit', description: 'The sun behind the people and a dim sky: their shapes against the light.', lighting: { lights: [keySun({ azimuth: 180, elevation: 25, intensity: 1.6 })], ambient: ambient(0.35, '#a9b4c4', '#3a3a3c') } },
  { id: 'noon', name: 'Noon sun', description: 'The sun almost overhead and a blue sky: short, hard shadows.', lighting: { lights: [keySun({ azimuth: 10, elevation: 82, intensity: 1.45, kelvin: 5500 })], ambient: ambient(1, '#e6eefc', '#d6cdbd') } },
  {
    id: 'dusk', name: 'Dusk', description: 'A low warm sun from the side and cool light from the sky.', lighting: {
      lights: [keySun({ azimuth: -75, elevation: 10, intensity: 0.95, kelvin: 3000 }), forShot('fill', { azimuth: 40, elevation: 20, intensity: 0.3, kelvin: 9500 })],
      ambient: ambient(0.75, '#b9c2d8', '#7d6a5c'),
    },
  },
  { id: 'night', name: 'Moonlight', description: 'Cool, dim moonlight from behind and a dark sky.', lighting: { lights: [keySun({ azimuth: 130, elevation: 50, intensity: 0.6, kelvin: 8500 })], ambient: ambient(0.5, '#6f7b94', '#2c2f36') } },
  {
    id: 'streetlight', name: 'Night street', description: 'A warm street lamp above and cool moonlight behind: a city at night.', lighting: {
      lights: [
        keySun({ name: 'Moonlight', azimuth: -140, elevation: 30, intensity: 0.4, kelvin: 8500 }),
        newLight('lamp', { name: 'Street lamp', role: 'practical', position: [1.2, 4.6, 0.8], spot: 80, aim: { point: [0, 0, 0] }, intensity: 1.4, range: 12, color: '#ffd09e' }, 'street-lamp'),
      ],
      ambient: ambient(0.35, '#4b5263', '#2e2a26'),
    },
  },
];

/* ---------- the look: what the lights are for, edited as one (#17) ---------- */

/**
 * The sun and the sky at a time of day (hours) in a weather: the sun's height, warmth and
 * brightness, how soft its shadows are, and the light from the sky and the ground. Daylight from 6
 * to 20 h (low and warm at its ends, high and white at noon); at night, the moon (cool, dim). An
 * overcast sky: a dimmer, softer sun and a brighter, greyer sky.
 */
export function skyAt(time: number, weather?: Environment['weather']) {
  const day = (time - 6) / 14;
  const up = day > 0 && day < 1;
  const high = up ? Math.sin(Math.PI * day) : 0;
  const mix = (a: string, b: string, u: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), u).getHexString()}`;
  const out = {
    elevation: up ? Math.max(5, Math.round(70 * high)) : 35,
    kelvin: up ? Math.round((2600 + 3000 * Math.min(1, high * 1.6)) / 100) * 100 : 8500,
    intensity: round(up ? 0.7 + 0.6 * high : 0.4),
    soft: 0.1,
    ambient: { intensity: round(up ? 0.55 + 0.5 * high : 0.4), sky: up ? mix('#ffd9b0', '#dfe9fb', Math.min(1, high * 1.4)) : '#5d6a86', ground: up ? mix('#6e5b4a', '#d6cdbd', high) : '#2c2f36' },
  };
  if (weather === 'overcast') {
    out.intensity = round(out.intensity * 0.45);
    out.soft = 0.9;
    out.ambient = { intensity: round(out.ambient.intensity + 0.35), sky: mix(out.ambient.sky, '#d0d4da', 0.7), ground: mix(out.ambient.ground, '#9a9690', 0.5) };
  }
  return out;
}

/** The look of a lighting: where its key comes from and how high, its contrast (key to fill; none: no fill), warmth, softness, rim, and whether its fill and rim go with the shot. */
export interface Look { direction: number; height: number; contrast: number | null; warmth: number; softness: number; rim: number; forShot: boolean }

/** A lighting's look, read from its lights (#17): its key's, its fill's and its rim's. */
export function lookOf(l: Lighting, around: Vec3 = SUBJECT): Look {
  const key = keyLight(l);
  const fill = l.lights.find((x) => x.role === 'fill');
  const rim = l.lights.find((x) => x.role === 'rim');
  const dir = key ? (key.kind === 'sun' ? { azimuth: key.azimuth, elevation: key.elevation } : angles(new THREE.Vector3(...key.position).sub(new THREE.Vector3(...around)))) : { azimuth: 40, elevation: 45 };
  return {
    direction: dir.azimuth,
    height: dir.elevation,
    contrast: key && fill && fill.intensity > 0.01 ? round(key.intensity / fill.intensity) : null,
    warmth: key?.kelvin ?? KELVIN.white,
    softness: key?.soft ?? 0,
    rim: rim?.intensity ?? 0,
    forShot: !!(fill?.relative || rim?.relative) || (!fill && !rim),
  };
}

/**
 * A lighting given another look (#17): its key turned and raised (a lamp moved round the people
 * to that side), its fill as bright as the contrast says (made, as a light for the shot, if there
 * is none; none for no contrast), the key's warmth and softness, its rim as bright as asked (made,
 * or taken away at 0), its fill and rim with the shot or (`camAz`: the shot's camera's azimuth
 * now) fixed in the scene where they are.
 */
export function withLook(l: Lighting, patch: Partial<Look>, around: Vec3 = SUBJECT, camAz = 0): Lighting {
  let lights = [...l.lights];
  let key = keyLight({ ...l, lights });
  if (!key) {
    key = keySun();
    lights = [key, ...lights];
  }
  const put = (x: Light) => { lights = lights.map((y) => (y.id === x.id ? clampLight(x) : y)); };
  // The key: its direction, height, warmth and softness.
  let k: Light = { ...key, role: 'key' };
  if (patch.direction !== undefined || patch.height !== undefined) {
    const now = lookOf({ ...l, lights }, around);
    const dir = towards(patch.direction ?? now.direction, patch.height ?? now.height);
    k = lightFrom(k, dir, around);
  }
  if (patch.warmth !== undefined) k = { ...k, kelvin: patch.warmth, color: kelvinColor(patch.warmth) };
  if (patch.softness !== undefined) k = { ...k, soft: patch.softness };
  put(k);
  // The fill: as bright as the contrast says.
  if (patch.contrast !== undefined) {
    const fill = lights.find((x) => x.role === 'fill');
    if (patch.contrast === null) lights = lights.filter((x) => x.role !== 'fill');
    else if (fill) put({ ...fill, intensity: round(k.intensity / patch.contrast) });
    else if (lights.length < MAX_LIGHTS) lights.push({ ...forShot('fill', { azimuth: 35, elevation: 15, intensity: round(k.intensity / patch.contrast) }), id: uid('light') });
  }
  // The rim.
  if (patch.rim !== undefined) {
    const rim = lights.find((x) => x.role === 'rim');
    if (patch.rim <= 0) lights = lights.filter((x) => x.role !== 'rim');
    else if (rim) put({ ...rim, intensity: patch.rim });
    else if (lights.length < MAX_LIGHTS) lights.push({ ...forShot('rim', { azimuth: 150, elevation: 35, intensity: patch.rim, kelvin: 7500 }), id: uid('light') });
  }
  // With the shot, or fixed where they are now (seen from the shot's camera).
  if (patch.forShot !== undefined) {
    const keyAz = lookOf({ ...l, lights }, around).direction;
    lights = lights.map((x) => ((x.role === 'fill' || x.role === 'rim') && x.kind === 'sun' ? forShotOr(x, patch.forShot!, keyAz, camAz) : x));
  }
  const { scheme: _, ...rest } = l;
  void _;
  return { ...rest, lights };
}

/** Degrees from a to b, -180 to 180. */
const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/**
 * A sun as a fill or a rim placed for the shot (`on`: its direction the angle from the shot's
 * camera, on the side away from the key) or fixed in the scene where it is now (`camAz`: the
 * shot's camera's azimuth; `keyAz`: the key's), as the light rig places it (#17).
 */
export function forShotOr(x: Light, on: boolean, keyAz: number, camAz: number): Light {
  if (!!x.relative === on) return x;
  if (on) return clampLight({ ...x, relative: 'shot', azimuth: Math.abs(turn(camAz, x.azimuth)) });
  const away = turn(camAz, keyAz) > 0 ? -1 : 1;
  return clampLight({ ...x, relative: undefined, azimuth: turn(0, camAz + away * Math.abs(x.azimuth)) });
}

/** What each role is called, and what it does. */
export const ROLE_NAMES: Record<LightRole, string> = { key: 'Key', fill: 'Fill', rim: 'Rim', practical: 'Practical', follow: 'Follow light' };
export const ROLE_ABOUT: Record<LightRole, string> = {
  key: 'The main light, fixed in the scene: the only one that casts shadows',
  fill: 'Softens the key\'s shadows, from the camera\'s side',
  rim: 'An edge light from behind the people, as the shot sees them',
  practical: 'A lamp, a lantern, a window in the scene: it lights what is near it',
  follow: 'Goes with a figure (not turning with it): it stays lit wherever it goes',
};

/** A scene's lighting (DEFAULT_LIGHTING without its own). */
export const lightingOf = (scene: Pick<Scene, 'lighting'>) => scene.lighting ?? DEFAULT_LIGHTING;

/** The main light, the painterly styles' key and the one with shadows: the key (#17); else the brightest sun not placed for the shot, or else the brightest light. */
export function keyLight(l: Lighting): Light | undefined {
  const by = (ls: Light[]) => ls.reduce<Light | undefined>((a, b) => (!a || b.intensity > a.intensity ? b : a), undefined);
  return l.lights.find((x) => x.role === 'key') ?? by(l.lights.filter((x) => x.kind === 'sun' && !x.relative)) ?? by(l.lights);
}

/**
 * Which sky a lighting is under (#25: the sky round an outdoor set in 3D): its time of day if it
 * has one, else told from its key light (low and warm: dusk; cold and dim: night); overcast if so.
 */
export function skyOf(l: Lighting): 'day' | 'dusk' | 'night' | 'overcast' {
  const e = l.environment;
  if (e?.weather === 'overcast') return 'overcast';
  if (e?.time !== undefined) {
    const day = (e.time - 6) / 14;
    return day <= 0 || day >= 1 ? 'night' : day < 0.1 || day > 0.9 ? 'dusk' : 'day';
  }
  const key = keyLight(l);
  if (!key || l.ambient.intensity < 0.6 || (key.kelvin ?? 6500) >= 8000) return 'night';
  if (key.kind === 'sun' && key.elevation < 20 && (key.kelvin ?? 6500) < 4500) return 'dusk';
  return 'day';
}

/** A scheme's lighting for a scene, its lamps round the people where they are (`at`: their middle on the floor). */
export function fromPreset(id: string, at: Vec3 = [0, 0, 0]): Lighting | null {
  const p = LIGHTING_PRESETS.find((x) => x.id === id);
  if (!p) return null;
  const move = (v: Vec3): Vec3 => [v[0] + at[0], v[1], v[2] + at[2]];
  return {
    lights: p.lighting.lights.map((x) => ({ ...x, position: move(x.position), ...(x.aim && 'point' in x.aim ? { aim: { point: move(x.aim.point) } } : {}) })),
    ambient: { ...p.lighting.ambient },
    scheme: id,
  };
}

/** A lighting in a word: its scheme's name, or "Custom" (changed since). */
export const lightingName = (l: Lighting) => (l === DEFAULT_LIGHTING ? 'Studio' : LIGHTING_PRESETS.find((p) => p.id === l.scheme)?.name ?? 'Custom');

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
const vec = (v: unknown, fallback: Vec3): Vec3 => (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
  ? [num(v[0], 0, -500, 500), num(v[1], 0, 0, 100), num(v[2], 0, -500, 500)] : fallback);

/** A light as it may be: its numbers in their ranges, its colour a colour (only the sun casts shadows). */
export function clampLight(l: Partial<Light> & { id: string }): Light {
  const kind = LIGHT_KINDS.includes(l.kind as LightKind) ? l.kind! : 'sun';
  const kelvin = l.kelvin === undefined ? undefined : num(l.kelvin, KELVIN.white, KELVIN.min, KELVIN.max);
  const aim = l.aim && typeof l.aim === 'object'
    ? 'figure' in l.aim && typeof l.aim.figure === 'string' ? { figure: l.aim.figure } : 'point' in l.aim ? { point: vec(l.aim.point, SUBJECT) } : undefined
    : undefined;
  return {
    id: l.id, kind,
    name: typeof l.name === 'string' && l.name.trim() ? l.name.trim().slice(0, 40) : KIND_NAMES[kind],
    azimuth: num(l.azimuth, 40, -180, 180),
    elevation: num(l.elevation, 45, 5, 89),
    position: vec(l.position, [1.5, 2.2, 1.5]),
    ...(kind === 'lamp' && typeof l.spot === 'number' ? { spot: num(l.spot, 45, 10, 120) } : {}),
    ...(kind !== 'sun' && aim ? { aim } : {}),
    range: num(l.range, 8, 1, 50),
    intensity: num(l.intensity, 1, 0, 3),
    color: hex(l.color, kelvinColor(kelvin ?? KELVIN.white)),
    ...(kelvin !== undefined ? { kelvin } : {}),
    shadows: kind === 'sun' && l.shadows !== false,
    ...roleOf(l),
  };
}

/** A scene's lighting as saved, made sound (null: not lighting). */
export function parseLighting(v: unknown): Lighting | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { lights?: unknown; ambient?: Partial<Ambient>; scheme?: unknown; environment?: Partial<Environment> };
  const ids = new Set<string>();
  const lights = (Array.isArray(o.lights) ? o.lights : [])
    .filter((l): l is Partial<Light> & { id: string } => typeof l === 'object' && l !== null && typeof l.id === 'string' && l.id.length <= 80 && !ids.has(l.id) && !!ids.add(l.id))
    .slice(0, MAX_LIGHTS)
    .map((l) => clampLight(l.role ? l : { ...l, ...roleSaved(l as Partial<Light> & { practical?: unknown }) }));
  const e = o.environment ?? {};
  if (!lights.length) return null;
  const a = o.ambient ?? {};
  return {
    lights,
    ambient: { intensity: num(a.intensity, 1, 0, 2), sky: hex(a.sky, '#ffffff'), ground: hex(a.ground, '#ffffff') },
    ...(typeof o.scheme === 'string' && LIGHTING_PRESETS.some((p) => p.id === o.scheme) ? { scheme: o.scheme } : {}),
    ...(e.indoors === true || typeof e.time === 'number' || e.weather === 'overcast' ? {
      environment: {
        ...(e.indoors === true ? { indoors: true as const } : {}),
        ...(typeof e.time === 'number' && Number.isFinite(e.time) ? { time: num(e.time, 12, 0, 24) } : {}),
        ...(e.weather === 'overcast' ? { weather: 'overcast' as const } : {}),
      },
    } : {}),
  };
}

/**
 * A role for a light saved without one (#17): a set's own, a practical; a light named or made as a
 * key, a fill or a rim, that (the key: a sun; a lamp as a fill or rim keeps its place); else none.
 */
function roleSaved(l: Partial<Light> & { practical?: unknown }): Partial<Light> {
  if (l.practical === true) return { role: 'practical', ofSet: true };
  const said = `${l.id ?? ''} ${l.name ?? ''}`.toLowerCase();
  const role = (['key', 'fill', 'rim'] as const).find((r) => new RegExp(`\\b${r}\\b`).test(said));
  return role ? { role } : {};
}

/** Degrees round (0 = from the front, + from the figures' left) and up, of a direction. */
function angles(dir: { x: number; y: number; z: number }) {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const r = (a: number) => Math.round((a * 180) / Math.PI);
  return { azimuth: r(Math.atan2(dir.x, dir.z)), elevation: r(Math.asin(dir.y / len)) };
}
/** The unit direction of azimuth and elevation. */
export function towards(azimuth: number, elevation: number) {
  const [az, el] = [(azimuth * Math.PI) / 180, (elevation * Math.PI) / 180];
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}
const round = (v: number) => Math.round(v * 100) / 100;

/**
 * The light coming from a direction (towards it, from what it lights): the sun's direction; a
 * lamp or a window moved round `around` (the people) to that side, as far from them as it was.
 */
export function lightFrom(light: Light, dir: { x: number; y: number; z: number }, around: Vec3 = SUBJECT): Light {
  const a = angles(dir);
  if (light.kind === 'sun') return clampLight({ ...light, ...a });
  const c = new THREE.Vector3(...around);
  const far = Math.max(1.2, new THREE.Vector3(...light.position).distanceTo(c));
  const p = c.addScaledVector(towards(a.azimuth, Math.max(5, a.elevation)), far);
  return clampLight({ ...light, position: [round(p.x), round(Math.max(0.2, p.y)), round(p.z)] });
}

/**
 * A light put where its job takes it, round the people (`around`: their middle) and the key light:
 * the key light high at the front-left; a fill on the other side, lower and dimmer; a rim behind
 * them, aimed at them. Named so; a sun keeps its kind (a direction only).
 */
export function placeLight(lighting: Lighting, light: Light, place: Place, around: Vec3): Light {
  const key = keyLight({ ...lighting, lights: lighting.lights.filter((l) => l.id !== light.id) });
  const keyAz = key ? (key.kind === 'sun' ? key.azimuth : angles(new THREE.Vector3(...key.position).sub(new THREE.Vector3(...around))).azimuth) : 40;
  const at = {
    key: { azimuth: 40, elevation: 40, far: 2.6, intensity: 1.2 },
    fill: { azimuth: -keyAz * 0.9 || -40, elevation: 18, far: 2.6, intensity: 0.4 },
    rim: { azimuth: 180 - keyAz * 0.35, elevation: 35, far: 2.3, intensity: 1.1 },
  }[place];
  const name = PLACE_NAMES[place];
  if (light.kind === 'sun') return clampLight({ ...light, name, azimuth: at.azimuth, elevation: at.elevation, intensity: at.intensity, shadows: place === 'key' && light.shadows });
  const p = new THREE.Vector3(...around).addScaledVector(towards(at.azimuth, at.elevation), at.far);
  return clampLight({
    ...light, name, intensity: at.intensity,
    position: [round(p.x), round(p.y), round(p.z)],
    // (A rim, and a key, aimed at the people: a spot; a fill lights all round.)
    ...(light.kind === 'lamp' ? { spot: place === 'fill' ? undefined : light.spot ?? 45 } : {}),
    aim: { point: around },
  });
}

/** The dome the editor draws the sun's lamp on: on the floor under the middle of the scene, a little wider than it, and in a set, above its walls and roofs. */
export function lightDome(focus: THREE.Box3, set?: THREE.Box3) {
  const c = focus.isEmpty() ? new THREE.Vector3() : focus.getCenter(new THREE.Vector3());
  const size = focus.isEmpty() ? 2 : focus.getSize(new THREE.Vector3()).length();
  const above = set && !set.isEmpty() ? set.max.y * 1.15 + 0.5 : 0;
  return { base: new THREE.Vector3(c.x, 0, c.z), radius: Math.max(2.6, size * 0.8, above) };
}

/** Where the sun's lamp is on its dome (azimuth 0: the front, +Z; up to the zenith). */
export function lampAt(dome: { base: THREE.Vector3; radius: number }, light: Pick<Light, 'azimuth' | 'elevation'>) {
  return dome.base.clone().add(towards(light.azimuth, light.elevation).multiplyScalar(dome.radius));
}

/** Where a light is drawn on the canvas: the sun on its dome, a lamp or window where it is. */
export const handleAt = (dome: { base: THREE.Vector3; radius: number }, light: Light) =>
  light.kind === 'sun' ? lampAt(dome, light) : new THREE.Vector3(...light.position);

/** Where the sun comes from, as said: "40° from the front-left, 45° high" (left and right are the figures'). */
export function sunText(light: Pick<Light, 'azimuth' | 'elevation'>) {
  const a = Math.round(Math.abs(light.azimuth));
  const side = light.azimuth > 0 ? 'left' : 'right';
  const from = a <= 3 ? 'From the front' : a >= 177 ? 'From behind' : Math.abs(a - 90) <= 3 ? `From the ${side}` : a < 90 ? `${a}° from the front-${side}` : `${180 - a}° from behind-${side}`;
  return `${from}, ${Math.round(light.elevation)}° high`;
}

/** A light in a few words: where the sun comes from; where a lamp or a window is. */
export function lightText(light: Light) {
  if (light.kind === 'sun') return sunText(light);
  const [x, y, z] = light.position;
  const what = light.kind === 'window' ? 'A window' : light.spot ? 'A spot' : 'A lamp';
  return `${what} ${y.toFixed(1)} m high at ${x.toFixed(1)}, ${z.toFixed(1)}${light.kind === 'lamp' ? `, reaching ${Math.round(light.range)} m` : ''}`;
}

/** The point a light aims at now (its figure's chest, its point), or null. */
export type AimAt = (aim: NonNullable<Light['aim']>) => THREE.Vector3 | null;

/**
 * One of the other lights for the painterly styles: the direction towards it from the people, and
 * its colour times its strength; a lamp or a window where it is and how far it reaches (lit from
 * there at each point, #17), a spot its axis and the cosine of its half cone.
 */
export interface ExtraLight { dir: THREE.Vector3; color: THREE.Color; at?: THREE.Vector3; range?: number; spot?: { axis: THREE.Vector3; cos: number } }
export const MAX_EXTRA = 4;

/**
 * The ambient light (from the sky and the ground), the lights and a shadow-catching floor under
 * the sun's shadows. Shared by the editor and the exporter; only the lit styles are lit by it,
 * the line-art and minimal materials ignore it. A window is a soft panel of light in Clay (lamps
 * across its pane) and a light from its direction in the painterly styles.
 */
/**
 * A shadow receiver whose soft shadow does not shimmer as the view moves (#31): three's soft
 * shadows turn their few samples by a noise of the screen's pixel, so a still shadow's grain
 * moves with the camera; here by the shadow map's own texel instead, which stays where it is on
 * the floor. (Directional and spot lights' shadows: the ones cast on the floor.)
 */
// (Drawn a hair nearer than what lies at the floor's height (a ready-made scene's floor is at 0): over
// it, not fighting it for the same depth as the view moves; anything standing on it still hides it.)
function steadyShadows<M extends THREE.Material>(m: M): M {
  const from = 'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;';
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const i = chunk.indexOf(from);
  if (i < 0) throw new Error('three.js shadow sampling changed: steadyShadows needs updating');
  const steady = chunk.slice(0, i) + 'float phi = interleavedGradientNoise( floor( shadowCoord.xy * shadowMapSize * 2.0 ) ) * PI2;' + chunk.slice(i + from.length);
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', steady);
  };
  m.customProgramCacheKey = () => 'steady-shadows';
  return m;
}

export class LightRig {
  readonly object = new THREE.Group();
  private ambient = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.05);
  private suns: THREE.DirectionalLight[] = [];
  private points: THREE.PointLight[] = [];
  private spots: THREE.SpotLight[] = [];
  private floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), steadyShadows(new THREE.ShadowMaterial({ opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 })));
  /** The key light's colour and brightness, for the painterly styles (white at 1: as they are). */
  readonly tint = new THREE.Color(1, 1, 1);
  /** The other lights, for the painterly styles. */
  readonly extras: ExtraLight[] = [];

  constructor() {
    // (Lit with what is drawn: in Pixel, the part of the canvas made of pixels.)
    this.object.userData.drawn = true;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const sun = new THREE.DirectionalLight(0xffffff, 0);
      const s = sun.shadow;
      s.mapSize.set(2048, 2048);
      s.bias = -0.0004;
      s.normalBias = 0.025;
      s.radius = 3;
      // (A set's part cut away from the view still casts its shadow.)
      s.camera.layers.enable(CUTAWAY_LAYER);
      const spot = new THREE.SpotLight(0xffffff, 0, 8, Math.PI / 4, 0.45, 2);
      this.suns.push(sun);
      this.spots.push(spot);
      this.object.add(sun, sun.target, spot, spot.target);
    }
    // (A window in Clay: four lamps across its pane, each a quarter of it.)
    for (let i = 0; i < MAX_LIGHTS * 4; i++) {
      const p = new THREE.PointLight(0xffffff, 0, 8, 2);
      this.points.push(p);
      this.object.add(p);
    }
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.floor.raycast = () => {};
    this.floor.renderOrder = -1;
    this.object.add(this.ambient, this.floor);
  }

  /**
   * Light the scene: the sun aimed at `focus` (the people and props) from its direction, from
   * outside a set; lamps and windows where they are. Returns the world-space direction towards
   * the key light, for the painterly shaders (and sets `tint` and `extras`).
   */
  update(lighting: Lighting, style: Style, focus: THREE.Box3, set?: THREE.Box3, aimAt: AimAt = () => null, shot?: { position: THREE.Vector3; target: THREE.Vector3 }) {
    // (Its middle on a 25 cm grid and its size in half-metre steps: a figure moving a little, as
    // it breathes or is posed, does not move the shadows' pixels, which would shimmer.)
    const middle = focus.isEmpty() ? new THREE.Vector3(0, 1, 0) : focus.getCenter(new THREE.Vector3());
    const center = new THREE.Vector3(Math.round(middle.x * 4) / 4, Math.round(middle.y * 4) / 4, Math.round(middle.z * 4) / 4);
    const radius = focus.isEmpty() ? 2 : Math.ceil(Math.max(1, focus.getSize(new THREE.Vector3()).length() / 2 + 0.25) * 2) / 2;
    // (From outside a set, so that its walls, roofs and trees shade the people as they would.)
    const far = Math.max(radius * 4, set && !set.isEmpty() ? set.getSize(new THREE.Vector3()).length() : 0);
    const clay = style === 'shaded';
    const key = keyLight(lighting);
    let [suns, points, spots] = [0, 0, 0];
    let shadowed = false;
    for (const x of [...this.suns, ...this.points, ...this.spots]) { x.visible = false; x.castShadow = false; }
    this.extras.length = 0;
    /** Where a lamp or a window is: its place, or (a follow light) its place from where its figure stands (#17). */
    const placeOf = (l: Light) => {
      const p = new THREE.Vector3(...l.position);
      const who = l.role === 'follow' && l.follows ? aimAt({ figure: l.follows }) : null;
      return who ? p.add(new THREE.Vector3(who.x, 0, who.z)) : p;
    };
    /** What a lamp or a window shines at. */
    const target = (l: Light) => (l.aim && aimAt(l.aim)) ?? (l.kind === 'window' || l.role === 'follow' ? center.clone() : new THREE.Vector3(l.position[0], 0, l.position[2]));
    // (A fill or a rim placed for the shot: degrees from its camera, on the side away from the key.)
    const camAz = shot ? Math.atan2(shot.position.x - shot.target.x, shot.position.z - shot.target.z) * 180 / Math.PI : null;
    const keyAz = key ? (key.kind === 'sun' ? key.azimuth : Math.atan2(key.position[0] - center.x, key.position[2] - center.z) * 180 / Math.PI) : 40;
    const away = camAz === null ? 1 : ((((keyAz - camAz) % 360) + 540) % 360) - 180 > 0 ? -1 : 1;
    /** Towards the light, from what it lights. */
    const lightDir = (l: Light) => {
      if (l.kind === 'sun') return l.relative === 'shot' && camAz !== null ? towards(camAz + away * Math.abs(l.azimuth), l.elevation) : towards(l.azimuth, l.elevation);
      return placeOf(l).sub(l.kind === 'lamp' && !l.spot ? center : target(l)).normalize();
    };
    // The painterly styles' other lights: the suns (a fill, a rim), then the lamps and windows
    // nearest the people for how far they reach (a lantern far off lights none of them).
    const reach = (l: Light) => (l.kind === 'sun' ? -1 : Math.max(0, placeOf(l).distanceTo(center) - radius) / l.range);
    for (const l of lighting.lights.filter((x) => x !== key && reach(x) < 1).sort((a, b) => reach(a) - reach(b)).slice(0, MAX_EXTRA)) {
      const color = new THREE.Color(l.color).multiplyScalar(Math.min(1.5, l.intensity));
      if (l.kind === 'sun') { this.extras.push({ dir: lightDir(l), color }); continue; }
      const at = placeOf(l);
      const aimed = l.kind === 'window' || !!l.spot;
      this.extras.push({
        dir: lightDir(l), color, at, range: l.range,
        ...(aimed ? { spot: { axis: target(l).sub(at).normalize(), cos: Math.cos(THREE.MathUtils.degToRad(l.kind === 'window' ? 75 : l.spot! / 2)) } } : {}),
      });
    }
    for (const l of lighting.lights) {
      const color = new THREE.Color(l.color);
      if (l.kind === 'sun' || (l.kind === 'window' && !clay)) {
        const sun = this.suns[suns++];
        sun.visible = true;
        sun.position.copy(center).addScaledVector(lightDir(l), far);
        sun.target.position.copy(center);
        sun.target.updateMatrixWorld();
        sun.color.copy(color);
        sun.intensity = 1.9 * l.intensity * (l.kind === 'window' ? 0.8 : 1);
        // (Only the key casts shadows (#17), as soft as it is.)
        if (l.kind !== 'sun' || l !== key || !l.shadows || !styleDef(style).shadows || shadowed) continue;
        sun.shadow.radius = 2 + 10 * (l.soft ?? 0.1);
        const cam = sun.shadow.camera;
        // Shadows on the floor reach further when the light is low.
        const reach = radius * (1.2 + 1 / Math.tan(THREE.MathUtils.degToRad(Math.max(15, l.elevation))));
        cam.left = cam.bottom = -reach;
        cam.right = cam.top = reach;
        cam.near = 0.1;
        cam.far = far + radius * 6;
        cam.updateProjectionMatrix();
        sun.castShadow = shadowed = true;
      } else if (l.kind === 'window') {
        // Four lamps across a pane 1.2 m wide and 1.4 m high, facing what it lights.
        const at = placeOf(l);
        const facing = target(l).sub(at).setY(0).normalize();
        const across = new THREE.Vector3(-facing.z, 0, facing.x);
        for (const [a, b] of [[-0.4, -0.45], [0.4, -0.45], [-0.4, 0.45], [0.4, 0.45]]) {
          const p = this.points[points++];
          p.visible = true;
          p.position.copy(at).addScaledVector(across, a).add(new THREE.Vector3(0, b, 0)).addScaledVector(facing, 0.3);
          p.color.copy(color);
          p.intensity = 5 * l.intensity;
          p.distance = l.range;
        }
      } else if (l.spot) {
        const s = this.spots[spots++];
        s.visible = true;
        s.position.copy(placeOf(l));
        s.target.position.copy(target(l));
        s.target.updateMatrixWorld();
        s.angle = THREE.MathUtils.degToRad(l.spot / 2);
        s.color.copy(color);
        s.intensity = 12 * l.intensity;
        s.distance = l.range;
      } else {
        const p = this.points[points++];
        p.visible = true;
        p.position.copy(placeOf(l));
        p.color.copy(color);
        p.intensity = 12 * l.intensity;
        p.distance = l.range;
      }
    }
    this.floor.visible = shadowed;
    const a = lighting.ambient;
    this.ambient.color.set(a.sky);
    this.ambient.groundColor.set(a.ground);
    this.ambient.intensity = 1.05 * a.intensity;
    // The painterly styles: in the key light's colour (half way to white), a little darker or brighter with it.
    this.tint.set(1, 1, 1);
    if (key) this.tint.lerp(new THREE.Color(key.color), 0.5).multiplyScalar(0.7 + 0.3 * Math.min(1.5, key.intensity));
    return key ? lightDir(key) : new THREE.Vector3(0, 1, 0);
  }

  dispose() {
    for (const sun of this.suns) sun.shadow.map?.dispose();
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
  }
}
