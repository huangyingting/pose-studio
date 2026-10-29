import * as THREE from 'three';
import { styleDef } from './styles';
import type { Ambient, Light, LightRole, Lighting, Scene, Style } from './types';
import { LIGHT_ROLES } from './types';
import { uid } from './uid';

/*
 * A scene's lights: a key light (and, if wanted, a fill, a rim or others: up to MAX_LIGHTS), and
 * the ambient light from the sky and the ground. Only the lit styles show them (lib/styles.ts).
 * Most scenes take a lighting scheme (LIGHTING_PRESETS) and change it a little.
 */

/** As many lights as a scene can have (more is no clearer). */
export const MAX_LIGHTS = 4;

export const ROLE_NAMES: Record<LightRole, string> = { key: 'Key light', fill: 'Fill light', rim: 'Rim light', custom: 'Light' };

/** A colour temperature (K) as a colour, daylight (6500 K) white. */
export function kelvinColor(kelvin: number): string {
  const rgb = (k: number) => {
    const t = k / 100;
    const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    return [r, g, b];
  };
  const white = rgb(6500);
  const c = rgb(kelvin).map((v, i) => Math.round(255 * Math.min(1, Math.max(0, v / white[i]))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Colour temperatures a light can take (K). */
export const KELVIN = { min: 1800, max: 10000, white: 6500 };

/** Colours to pick a light's from: temperatures, and two neon colours. */
export const LIGHT_SWATCHES: { name: string; color: string; kelvin?: number }[] = [
  { name: 'Candle', kelvin: 1900 },
  { name: 'Lamp', kelvin: 3000 },
  { name: 'Daylight', kelvin: 5600 },
  { name: 'White', kelvin: 6500 },
  { name: 'Overcast', kelvin: 8000 },
  { name: 'Neon blue', color: '#3d7bff' },
  { name: 'Neon purple', color: '#b34dff' },
].map((s) => ({ ...s, color: s.color ?? kelvinColor(s.kelvin!) }));

/** A light (a new one: its own id). */
export function newLight(role: LightRole, l: Partial<Omit<Light, 'id' | 'role'>> = {}, id = uid('light')): Light {
  const kelvin = l.kelvin ?? (l.color ? undefined : KELVIN.white);
  return {
    id, role,
    azimuth: l.azimuth ?? 40, elevation: l.elevation ?? 45, intensity: l.intensity ?? 1,
    color: l.color ?? kelvinColor(kelvin!),
    ...(kelvin !== undefined ? { kelvin } : {}),
    shadows: role === 'key' && l.shadows !== false,
  };
}

const ambient = (intensity = 1, sky = '#ffffff', ground = '#ffffff'): Ambient => ({ intensity, sky, ground });

/** A scene's lighting without its own: one key light from the front-left, above. */
export const DEFAULT_LIGHTING: Lighting = { lights: [newLight('key', {}, 'key')], ambient: ambient() };

/** Lighting schemes: a scene's lights at once, to start from. */
export const LIGHTING_PRESETS: { id: string; name: string; lighting: Lighting }[] = [
  { id: 'studio', name: 'Studio', lighting: DEFAULT_LIGHTING },
  { id: 'soft', name: 'Soft', lighting: { lights: [newLight('key', { azimuth: 25, elevation: 65, intensity: 0.8, kelvin: 6000, shadows: false }, 'key')], ambient: ambient(1.15) } },
  {
    id: 'three-point', name: 'Three-point', lighting: {
      lights: [
        newLight('key', { azimuth: 40, elevation: 35, intensity: 1.1 }, 'key'),
        newLight('fill', { azimuth: -55, elevation: 20, intensity: 0.4 }, 'fill'),
        newLight('rim', { azimuth: 160, elevation: 40, intensity: 1, kelvin: 8000 }, 'rim'),
      ],
      ambient: ambient(0.6),
    },
  },
  {
    id: 'rembrandt', name: 'Rembrandt', lighting: {
      lights: [newLight('key', { azimuth: 50, elevation: 45, intensity: 1.35, kelvin: 4500 }, 'key'), newLight('fill', { azimuth: -60, elevation: 10, intensity: 0.15 }, 'fill')],
      ambient: ambient(0.45, '#f2ece4', '#4a4038'),
    },
  },
  {
    id: 'back', name: 'Backlit', lighting: {
      lights: [newLight('key', { azimuth: 180, elevation: 25, intensity: 1.6 }, 'key')],
      ambient: ambient(0.3, '#6b7a99', '#1c2030'),
    },
  },
  { id: 'noon', name: 'Noon sun', lighting: { lights: [newLight('key', { azimuth: 10, elevation: 82, intensity: 1.45, kelvin: 5600 }, 'key')], ambient: ambient(1, '#dfeaff', '#d8cbb4') } },
  {
    id: 'dusk', name: 'Dusk', lighting: {
      lights: [newLight('key', { azimuth: -75, elevation: 10, intensity: 0.95, kelvin: 2600 }, 'key'), newLight('fill', { azimuth: 100, elevation: 30, intensity: 0.3, kelvin: 9500 }, 'fill')],
      ambient: ambient(0.75, '#9fb0d9', '#6b4a3a'),
    },
  },
  {
    id: 'night', name: 'Moonlight', lighting: {
      lights: [newLight('key', { azimuth: 130, elevation: 50, intensity: 0.6, kelvin: 10000 }, 'key')],
      ambient: ambient(0.55, '#5a6a99', '#20242e'),
    },
  },
  {
    id: 'neon', name: 'Night neon', lighting: {
      lights: [
        newLight('key', { azimuth: 65, elevation: 25, intensity: 1.1, color: '#b34dff' }, 'key'),
        newLight('rim', { azimuth: -135, elevation: 30, intensity: 1.1, color: '#3d7bff' }, 'rim'),
      ],
      ambient: ambient(0.35, '#2a3060', '#120e1c'),
    },
  },
];

/** A scene's lighting (DEFAULT_LIGHTING without its own). */
export const lightingOf = (scene: Pick<Scene, 'lighting'>) => scene.lighting ?? DEFAULT_LIGHTING;

/** The main light: the key light, or the first (the painterly styles are lit by it alone). */
export const keyLight = (l: Lighting): Light | undefined => l.lights.find((x) => x.role === 'key') ?? l.lights[0];

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);

/** A light as it may be: its numbers in their ranges, its colour a colour (only a key light casts shadows). */
export function clampLight(l: Partial<Light> & { id: string }): Light {
  const role = LIGHT_ROLES.includes(l.role as LightRole) ? l.role! : 'custom';
  const kelvin = l.kelvin === undefined ? undefined : num(l.kelvin, KELVIN.white, KELVIN.min, KELVIN.max);
  return {
    id: l.id, role,
    azimuth: num(l.azimuth, 40, -180, 180),
    elevation: num(l.elevation, 45, 5, 89),
    intensity: num(l.intensity, 1, 0, 2),
    color: hex(l.color, kelvinColor(kelvin ?? KELVIN.white)),
    ...(kelvin !== undefined ? { kelvin } : {}),
    shadows: role === 'key' && l.shadows !== false,
  };
}

/** A scene's lighting as saved, made sound (null: not lighting). */
export function parseLighting(v: unknown): Lighting | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { lights?: unknown; ambient?: Partial<Ambient> };
  const ids = new Set<string>();
  const lights = (Array.isArray(o.lights) ? o.lights : [])
    .filter((l): l is Partial<Light> & { id: string } => typeof l === 'object' && l !== null && typeof l.id === 'string' && l.id.length <= 80 && !ids.has(l.id) && !!ids.add(l.id))
    .slice(0, MAX_LIGHTS)
    .map(clampLight);
  if (!lights.length) return null;
  const a = o.ambient ?? {};
  return { lights, ambient: { intensity: num(a.intensity, 1, 0, 2), sky: hex(a.sky, '#ffffff'), ground: hex(a.ground, '#ffffff') } };
}

/** The light coming from a direction (towards it, from what it lights), its other settings kept. */
export function lightFrom(light: Light, dir: { x: number; y: number; z: number }): Light {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const r = (a: number) => Math.round((a * 180) / Math.PI);
  return clampLight({ ...light, azimuth: r(Math.atan2(dir.x, dir.z)), elevation: r(Math.asin(dir.y / len)) });
}

/**
 * The dome the editor draws the lights' lamps on: on the floor under the middle of the scene, a
 * little wider than it, and in a set, above its walls and roofs (as a studio's lights hang).
 */
export function lightDome(focus: THREE.Box3, set?: THREE.Box3) {
  const c = focus.isEmpty() ? new THREE.Vector3() : focus.getCenter(new THREE.Vector3());
  const size = focus.isEmpty() ? 2 : focus.getSize(new THREE.Vector3()).length();
  const above = set && !set.isEmpty() ? set.max.y * 1.15 + 0.5 : 0;
  return { base: new THREE.Vector3(c.x, 0, c.z), radius: Math.max(2.6, size * 0.8, above) };
}

/** Where a light's lamp is on its dome (azimuth 0: the front, +Z; up to the zenith). */
export function lampAt(dome: { base: THREE.Vector3; radius: number }, light: Pick<Light, 'azimuth' | 'elevation'>) {
  const [az, el] = [(light.azimuth * Math.PI) / 180, (light.elevation * Math.PI) / 180];
  return dome.base.clone().add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dome.radius));
}

/** Where a light comes from, as said: "40° from the front-left, 45° high" (left and right are the figures'). */
export function lightText(light: Pick<Light, 'azimuth' | 'elevation'>) {
  const a = Math.round(Math.abs(light.azimuth));
  const side = light.azimuth > 0 ? 'left' : 'right';
  const from = a <= 3 ? 'From the front' : a >= 177 ? 'From behind' : Math.abs(a - 90) <= 3 ? `From the ${side}` : a < 90 ? `${a}° from the front-${side}` : `${180 - a}° from behind-${side}`;
  return `${from}, ${Math.round(light.elevation)}° high`;
}

/** A light's name: its role's ("Key light"), numbered where several share it. */
export function lightName(lighting: Lighting, light: Light) {
  const same = lighting.lights.filter((l) => l.role === light.role);
  return same.length > 1 ? `${ROLE_NAMES[light.role]} ${same.indexOf(light) + 1}` : ROLE_NAMES[light.role];
}

/** Whether two lightings are the same, whatever their lights' ids. */
export function sameLighting(a: Lighting, b: Lighting) {
  const strip = (l: Lighting) => JSON.stringify({ ...l, lights: l.lights.map((x) => ({ ...x, id: '' })) });
  return strip(a) === strip(b);
}

/** A lighting in a word: its scheme's name, or "Custom". */
export const lightingName = (l: Lighting) => LIGHTING_PRESETS.find((p) => sameLighting(p.lighting, l))?.name ?? 'Custom';

/** A scheme's lighting for a scene: its lights' ids its own. */
export const fromPreset = (l: Lighting): Lighting => ({ lights: l.lights.map((x) => ({ ...x })), ambient: { ...l.ambient } });

/**
 * The ambient light (from the sky and the ground), the lights and a shadow-catching floor under
 * the key light's shadows. Shared by the editor and the exporter; only the lit styles are lit by
 * it, the line-art and minimal materials ignore it.
 */
export class LightRig {
  readonly object = new THREE.Group();
  private ambient = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.05);
  private lamps: THREE.DirectionalLight[] = [];
  private floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.16, depthWrite: false }));
  /** The key light's colour and brightness, for the painterly styles (white at 1: as they are). */
  readonly tint = new THREE.Color(1, 1, 1);

  constructor() {
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const lamp = new THREE.DirectionalLight(0xffffff, 0);
      const s = lamp.shadow;
      s.mapSize.set(2048, 2048);
      s.bias = -0.0004;
      s.normalBias = 0.015;
      s.radius = 3;
      this.lamps.push(lamp);
      this.object.add(lamp, lamp.target);
    }
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.floor.raycast = () => {};
    this.floor.renderOrder = -1;
    this.object.add(this.ambient, this.floor);
  }

  /**
   * Aim the lights at `focus` (the scene bounds), each from its direction. Returns the
   * world-space direction towards the key light, for the painterly shaders (and sets `tint`).
   */
  update(lighting: Lighting, style: Style, focus: THREE.Box3, set?: THREE.Box3) {
    const center = focus.isEmpty() ? new THREE.Vector3(0, 1, 0) : focus.getCenter(new THREE.Vector3());
    const radius = focus.isEmpty() ? 2 : Math.max(1, focus.getSize(new THREE.Vector3()).length() / 2);
    // (From outside a set, so that its walls, roofs and trees shade the people as they would.)
    const far = Math.max(radius * 4, set && !set.isEmpty() ? set.getSize(new THREE.Vector3()).length() : 0);
    const towards = (l: Light) => {
      const az = THREE.MathUtils.degToRad(l.azimuth);
      const el = THREE.MathUtils.degToRad(l.elevation);
      return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    };
    const key = keyLight(lighting);
    let shadowed = false;
    this.lamps.forEach((lamp, i) => {
      const l = lighting.lights[i];
      lamp.visible = !!l;
      lamp.castShadow = false;
      if (!l) return;
      lamp.position.copy(center).addScaledVector(towards(l), far);
      lamp.target.position.copy(center);
      lamp.target.updateMatrixWorld();
      lamp.color.set(l.color);
      lamp.intensity = 1.9 * l.intensity;
      if (l !== key || !l.shadows || !styleDef(style).shadows) return;
      const cam = lamp.shadow.camera;
      // Shadows on the floor reach further when the light is low.
      const reach = radius * (1.2 + 1 / Math.tan(THREE.MathUtils.degToRad(Math.max(15, l.elevation))));
      cam.left = cam.bottom = -reach;
      cam.right = cam.top = reach;
      cam.near = 0.1;
      cam.far = far + radius * 6;
      cam.updateProjectionMatrix();
      lamp.castShadow = shadowed = true;
    });
    this.floor.visible = shadowed;
    const a = lighting.ambient;
    this.ambient.color.set(a.sky);
    this.ambient.groundColor.set(a.ground);
    this.ambient.intensity = 1.05 * a.intensity;
    // The painterly styles: in the key light's colour (half way to white), a little darker or brighter with it.
    this.tint.set(1, 1, 1);
    if (key) this.tint.lerp(new THREE.Color(key.color), 0.5).multiplyScalar(0.7 + 0.3 * Math.min(1.5, key.intensity));
    return key ? towards(key) : new THREE.Vector3(0, 1, 0);
  }

  dispose() {
    for (const lamp of this.lamps) lamp.shadow.map?.dispose();
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
  }
}
