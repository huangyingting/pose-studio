import { type Look, withLook, lightingOf, skyAt, keyLight, clampLight, lookOf, forShotOr, fromPreset, MAX_LIGHTS, type Place, placeLight, newLight } from '../lighting';
import { cameraAt } from '../cameras';
import type { Store } from '../store';
import type { Lighting, Environment, Light, Scene, Vec3, Ambient, LightKind } from '../types';

/* Lighting the scene (lib/lighting.ts): its look, its lights and their roles, a scheme from the Library. */

/** A lighting with an environment (none if it says nothing). */
function withEnvironment(l: Lighting, environment: Environment): Lighting {
  const { environment: _, ...rest } = l;
  void _;
  return Object.keys(environment).length ? { ...rest, environment } : rest;
}

/** The azimuth of the open scene's shot camera now, from the people (what a light placed for the shot is placed from). */
function shotAzimuth(store: Store) {
  const s = store.scene;
  const v = cameraAt(s, s.animation ? store.getState().time : 0);
  return (Math.atan2(v.position.x - v.target.x, v.position.z - v.target.z) * 180) / Math.PI;
}

/** Change the open scene's look (#17): its key's direction, height, warmth and softness, its contrast, its rim, its fill and rim with the shot or fixed. */
export function setLook(store: Store, patch: Partial<Look>, key = '') {
  setLighting(store, withLook(lightingOf(store.scene), patch, subjectOf(store.scene), shotAzimuth(store)), key);
}

/**
 * Change where the open scene is lit (#17): indoors or out, the time of day, the weather. Out of
 * doors, the time and the weather set the sun (the key, if a sun: its height, warmth, brightness and
 * softness; its direction kept) and the sky.
 */
export function setEnvironment(store: Store, patch: Partial<Record<keyof Environment, unknown>>, key = '') {
  const l = lightingOf(store.scene);
  const e: Environment = { ...l.environment };
  if ('indoors' in patch) {
    if (patch.indoors) e.indoors = true;
    else delete e.indoors;
  }
  if (typeof patch.time === 'number') e.time = Math.min(24, Math.max(0, patch.time));
  if ('weather' in patch) {
    if (patch.weather === 'overcast') e.weather = 'overcast';
    else delete e.weather;
  }
  let next = withEnvironment(l, e);
  if (!e.indoors && ('time' in patch || 'weather' in patch)) {
    const sky = skyAt(e.time ?? 12, e.weather);
    const k = keyLight(next);
    next = {
      ...next,
      lights: next.lights.map((x) => (x.id === k?.id && x.kind === 'sun' ? clampLight({ ...x, elevation: sky.elevation, kelvin: sky.kelvin, color: undefined, intensity: sky.intensity, soft: sky.soft }) : x)),
      ambient: sky.ambient,
    };
  }
  setLighting(store, next, key);
}

/** A fill or a rim (a sun) placed for the shot, or fixed in the scene where it is now (#17). */
export function setLightForShot(store: Store, id: string, on: boolean) {
  const l = lightingOf(store.scene);
  const keyAz = lookOf(l, subjectOf(store.scene)).direction;
  setLighting(store, { ...l, lights: l.lights.map((x) => (x.id === id && x.kind === 'sun' && (x.role === 'fill' || x.role === 'rim') ? forShotOr(x, on, keyAz, shotAzimuth(store)) : x)) });
}

/** Give one of the scene's lights a role (#17; none: null): one key (the last loses it); a sun as a fill or a rim placed for the shot. */
export function setLightRole(store: Store, id: string, role: Light['role'] | null) {
  const l = lightingOf(store.scene);
  const light = l.lights.find((x) => x.id === id);
  if (!light) return;
  const lights = l.lights.map((x) => {
    if (x.id !== id) return role === 'key' && x.role === 'key' ? clampLight({ ...x, role: undefined }) : x;
    const { role: _r, relative: _rel, follows: _f, ...rest } = x;
    void _r; void _rel; void _f;
    if (!role) return clampLight(rest);
    const forShot = x.kind === 'sun' && (role === 'fill' || role === 'rim');
    const follows = role === 'follow' ? store.scene.figures.find((f) => !f.hidden)?.id : undefined;
    return clampLight({
      ...rest, role,
      ...(forShot ? { relative: 'shot' as const, azimuth: role === 'fill' ? 35 : 150, elevation: role === 'fill' ? 15 : 35 } : {}),
      ...(follows ? { follows } : {}),
    });
  });
  setLighting(store, { ...l, lights });
}

/** Where the open scene's people are: their middle on the floor, at chest height (what lights are placed round). */
export function subjectOf(scene: Scene): Vec3 {
  const fs = scene.figures.filter((f) => !f.hidden);
  if (!fs.length) return [0, 1.3, 0];
  const r = (v: number) => Math.round(v * 100) / 100;
  return [r(fs.reduce((t, f) => t + f.position[0], 0) / fs.length), 1.3, r(fs.reduce((t, f) => t + f.position[2], 0) / fs.length)];
}

/**
 * Light the open scene: all its lights at once. Changed by hand, it is no longer its scheme. The
 * light selected, gone, gives way to the key light.
 */
export function setLighting(store: Store, lighting: Lighting, key = '') {
  const { scheme: _, ...mine } = lighting;
  void _;
  store.updateScene((s) => ({ ...s, lighting: mine }), key);
  const sel = store.getState().selection;
  if (sel?.kind === 'light' && !mine.lights.some((l) => l.id === sel.light)) {
    const k = keyLight(mine);
    store.select(k ? { kind: 'light', light: k.id } : null);
  }
}

/** Light the open scene with a lighting scheme (lib/lighting.ts LIGHTING_PRESETS), round its people; the set's own lights kept. */
export function applyLightingPreset(store: Store, id: string) {
  const p = fromPreset(id, subjectOf(store.scene));
  if (!p) return;
  const own = lightingOf(store.scene).lights.filter((l) => l.ofSet);
  store.updateScene((s) => ({ ...s, lighting: { ...p, lights: [...p.lights, ...own].slice(0, MAX_LIGHTS) } }));
  const sel = store.getState().selection;
  if (sel?.kind === 'light' && !lightingOf(store.scene).lights.some((l) => l.id === sel.light)) store.select({ kind: 'light', light: keyLight(lightingOf(store.scene))!.id });
}

/** Change one of the scene's lights. */
export function editLight(store: Store, id: string, patch: Partial<Omit<Light, 'id'>>, key = '') {
  const l = lightingOf(store.scene);
  setLighting(store, { ...l, lights: l.lights.map((x) => (x.id === id ? clampLight({ ...x, ...patch }) : x)) }, key);
}

/** Put one of the scene's lights where a key light, a fill or a rim goes (named so), round the people. */
export function placeSceneLight(store: Store, id: string, place: Place) {
  const l = lightingOf(store.scene);
  const light = l.lights.find((x) => x.id === id);
  if (!light) return;
  store.group(() => {
    setLighting(store, { ...l, lights: l.lights.map((x) => (x.id === id ? placeLight(l, x, place, subjectOf(store.scene)) : x)) });
    setLightRole(store, id, place);
  });
}

/** Change the scene's ambient light. */
export function editAmbient(store: Store, patch: Partial<Ambient>, key = '') {
  const l = lightingOf(store.scene);
  setLighting(store, { ...l, ambient: { ...l.ambient, ...patch } }, key);
}

/**
 * Add a light to the scene (up to MAX_LIGHTS), selected: a sun, a lamp or a window near the
 * people, or a lamp put where a fill or a rim goes. Its id, or null (as many as there can be).
 */
export function addLight(store: Store, what: LightKind | Place = 'lamp'): string | null {
  const l = lightingOf(store.scene);
  if (l.lights.length >= MAX_LIGHTS) return null;
  const at = subjectOf(store.scene);
  const kind: LightKind = what === 'sun' || what === 'window' ? what : 'lamp';
  let light = clampLight(newLight(kind, {
    azimuth: -50, elevation: 35, shadows: !l.lights.some((x) => x.kind === 'sun' && x.shadows),
    position: kind === 'window' ? [at[0] - 2.6, 1.6, at[2] - 0.6] : [at[0] + 1.2, 2.2, at[2] + 1.4],
    intensity: kind === 'lamp' ? 0.8 : 1,
  }));
  if (what === 'key' || what === 'fill' || what === 'rim') light = placeLight(l, light, what, at);
  store.group(() => {
    setLighting(store, { ...l, lights: [...l.lights, light] });
    if (what === 'key' || what === 'fill' || what === 'rim') setLightRole(store, light.id, what);
  });
  store.select({ kind: 'light', light: light.id });
  return light.id;
}

/** Take a light out of the scene (not its last one). Whether it was. */
export function deleteLight(store: Store, id: string) {
  const l = lightingOf(store.scene);
  // (A set's own stays with its set: dimmed, not deleted.)
  if (l.lights.length < 2 || !l.lights.some((x) => x.id === id && !x.ofSet)) return false;
  setLighting(store, { ...l, lights: l.lights.filter((x) => x.id !== id) });
  return true;
}
