import * as THREE from 'three';
import { styleDef } from './styles';
import type { Light, Style } from './types';

export const DEFAULT_LIGHT: Light = { azimuth: 40, elevation: 45, shadows: true };

export function clampLight(l: Partial<Light> | undefined): Light {
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    azimuth: num(l?.azimuth, DEFAULT_LIGHT.azimuth, -180, 180),
    elevation: num(l?.elevation, DEFAULT_LIGHT.elevation, 5, 89),
    shadows: l?.shadows !== false,
  };
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
    return dir;
  }

  dispose() {
    this.key.shadow.map?.dispose();
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
  }
}
