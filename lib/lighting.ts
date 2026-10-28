import * as THREE from 'three';
import { styleDef } from './styles';
import type { Light, Style } from './types';

export const DEFAULT_LIGHT: Light = { azimuth: 40, elevation: 45, shadows: true, intensity: 1, warmth: 0 };

/** Ready-made lighting for a scene. */
export const LIGHT_PRESETS: { id: string; name: string; light: Light }[] = [
  { id: 'studio', name: 'Studio', light: DEFAULT_LIGHT },
  { id: 'soft', name: 'Soft', light: { azimuth: 25, elevation: 65, shadows: false, intensity: 0.8, warmth: 0.05 } },
  { id: 'side', name: 'Side (drama)', light: { azimuth: 90, elevation: 18, shadows: true, intensity: 1.35, warmth: 0 } },
  { id: 'back', name: 'Backlit', light: { azimuth: 160, elevation: 35, shadows: true, intensity: 1.2, warmth: 0 } },
  { id: 'noon', name: 'Noon sun', light: { azimuth: 10, elevation: 82, shadows: true, intensity: 1.45, warmth: 0.15 } },
  { id: 'dusk', name: 'Dusk', light: { azimuth: -75, elevation: 10, shadows: true, intensity: 0.95, warmth: 0.85 } },
  { id: 'night', name: 'Night', light: { azimuth: 130, elevation: 50, shadows: true, intensity: 0.6, warmth: -0.75 } },
];

export function clampLight(l: Partial<Light> | undefined): Light {
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    azimuth: num(l?.azimuth, DEFAULT_LIGHT.azimuth, -180, 180),
    elevation: num(l?.elevation, DEFAULT_LIGHT.elevation, 5, 89),
    shadows: l?.shadows !== false,
    intensity: num(l?.intensity, 1, 0.2, 2),
    warmth: num(l?.warmth, 0, -1, 1),
  };
}

/** The light coming from a direction (towards it, from what it lights), its other settings kept. */
export function lightFrom(light: Light, dir: { x: number; y: number; z: number }): Light {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const r = (a: number) => Math.round((a * 180) / Math.PI);
  return clampLight({ ...light, azimuth: r(Math.atan2(dir.x, dir.z)), elevation: r(Math.asin(dir.y / len)) });
}

/** Where a light comes from, as said: "40° from the front-left, 45° high" (left and right are the figures'). */
export function lightText(light: Light) {
  const a = Math.round(Math.abs(light.azimuth));
  const side = light.azimuth > 0 ? 'left' : 'right';
  const from = a <= 3 ? 'From the front' : a >= 177 ? 'From behind' : Math.abs(a - 90) <= 3 ? `From the ${side}` : a < 90 ? `${a}° from the front-${side}` : `${180 - a}° from behind-${side}`;
  return `${from}, ${Math.round(light.elevation)}° high`;
}

/**
 * Ambient fill + one key light with an optional shadow-catching floor. Shared by the editor and
 * the exporter; only the shaded style is lit, the line-art and silhouette materials ignore it.
 */
export class LightRig {
  readonly object = new THREE.Group();
  private ambient = new THREE.AmbientLight(0xffffff, 1.05);
  private key = new THREE.DirectionalLight(0xffffff, 1.9);
  private floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.16, depthWrite: false }));

  constructor() {
    const s = this.key.shadow;
    s.mapSize.set(2048, 2048);
    s.bias = -0.0004;
    s.normalBias = 0.015;
    s.radius = 3;
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.floor.raycast = () => {};
    this.floor.renderOrder = -1;
    this.object.add(this.ambient, this.key, this.key.target, this.floor);
  }

  /**
   * Aim the key light at `focus` (the scene bounds) from the given direction. Returns the
   * world-space direction towards the light, for the painterly shaders.
   */
  update(light: Light, style: Style, focus: THREE.Box3) {
    const center = focus.isEmpty() ? new THREE.Vector3(0, 1, 0) : focus.getCenter(new THREE.Vector3());
    const radius = focus.isEmpty() ? 2 : Math.max(1, focus.getSize(new THREE.Vector3()).length() / 2);
    const az = THREE.MathUtils.degToRad(light.azimuth);
    const el = THREE.MathUtils.degToRad(light.elevation);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.key.position.copy(center).addScaledVector(dir, radius * 4);
    this.key.target.position.copy(center);
    this.key.target.updateMatrixWorld();
    const cam = this.key.shadow.camera;
    // Shadows on the floor reach further when the light is low.
    const reach = radius * (1.2 + 1 / Math.tan(THREE.MathUtils.degToRad(Math.max(15, light.elevation))));
    cam.left = cam.bottom = -reach;
    cam.right = cam.top = reach;
    cam.near = 0.1;
    cam.far = radius * 10;
    cam.updateProjectionMatrix();
    const on = light.shadows && styleDef(style).shadows;
    this.key.castShadow = on;
    this.floor.visible = on;
    // Brightness and colour: warm towards sunset orange, cool towards moonlight blue; the fill
    // takes on a little of the same colour.
    const tint = light.warmth >= 0
      ? new THREE.Color(1, 1 - 0.18 * light.warmth, 1 - 0.42 * light.warmth)
      : new THREE.Color(1 + 0.32 * light.warmth, 1 + 0.12 * light.warmth, 1);
    this.key.color.copy(tint);
    this.key.intensity = 1.9 * light.intensity;
    this.ambient.color.setRGB(1, 1, 1).lerp(tint, 0.35);
    this.ambient.intensity = 1.05 * (0.55 + 0.45 * Math.min(1.3, light.intensity));
    return dir;
  }

  dispose() {
    this.key.shadow.map?.dispose();
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
  }
}
