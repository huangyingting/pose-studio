import { describe, expect, it } from 'vitest';
import { clampLight, DEFAULT_LIGHTING, LIGHTING_PRESETS, kelvinColor, lightingOf, sameLighting } from '@/lib/lighting';
import { cameraFrom, newScene, parseScene } from '@/lib/doc';
import { newAnimation } from '@/lib/animation';
import { parseProjectSettings } from '@/lib/project';
import { angleAt } from '@/lib/cameras';
import { buildSession, DEFAULT_PRACTICE, formatTime, parsePracticeOptions, sessionLength } from '@/lib/practice';
import { poseScene, referencePoses } from '@/lib/poses';

/** The 20 reference poses as scenes. */
const refScenes = () => referencePoses().map((p) => poseScene(p));
import { DEFAULT_EXPORT, exportCells, parseExportOptions, sheetSize } from '@/lib/render';
import { Store } from '@/lib/store';
import { addLight, applyLightingPreset, deleteLight, editLight } from '@/lib/actions';

/** Deterministic PRNG for shuffles. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

describe('export options', () => {
  it('keeps the Pose.jpg layout as the default', () => {
    expect(sheetSize(20, DEFAULT_EXPORT)).toEqual({ cols: 4, rows: 5, width: 2400, height: 3200 });
  });

  it('sanitises stored options', () => {
    const o = parseExportOptions({ scope: 'bogus', columns: 99, cellWidth: -5, lineWidth: 'x', style: 'silhouette', angles: 8, labels: true });
    expect(o.scope).toBe('current');
    expect(o.columns).toBe(12);
    expect(o.cellWidth).toBe(100);
    expect(o.lineWidth).toBe(DEFAULT_EXPORT.lineWidth);
    // A style picked for one export is not remembered: the film's is used.
    expect(o.style).toBeUndefined();
    expect(o.angles).toBe(8);
    expect(o.labels).toBe(true);
    expect(parseExportOptions(null)).toEqual(DEFAULT_EXPORT);
  });

  it('builds a turnaround from evenly spaced angles around the figure', () => {
    const scenes = refScenes();
    const current = { ...scenes[3], cameras: [cameraFrom({ yaw: 25, pitch: 10, fov: 24 })] };
    const cells = exportCells(scenes, current, { ...DEFAULT_EXPORT, scope: 'turnaround', angles: 8 });
    expect(cells.map((c) => c.angle.yaw)).toEqual([0, 45, 90, 135, 180, -135, -90, -45]);
    // From the height and lens of the scene's camera.
    expect(new Set(cells.map((c) => `${c.angle.pitch} ${c.angle.fov}`)).size).toBe(1);
    expect(cells[0].angle.pitch).toBeCloseTo(angleAt(current).pitch, 6);
    expect(cells.map((c) => c.caption)).toContain('Back');
    expect(cells.every((c) => c.scene === current)).toBe(true);
  });

  it('numbers captions for the whole library', () => {
    const scenes = refScenes();
    const cells = exportCells(scenes, scenes[0], { ...DEFAULT_EXPORT, scope: 'all' });
    expect(cells).toHaveLength(20);
    expect(cells[1].caption).toBe(`2. ${scenes[1].name}`);
    expect(exportCells(scenes, scenes[4], { ...DEFAULT_EXPORT, scope: 'current' })).toMatchObject([{ scene: scenes[4], caption: scenes[4].name }]);
  });
});

describe('gesture practice', () => {
  const scenes = refScenes();

  it('shuffles without repeating poses', () => {
    const slides = buildSession(scenes, scenes[0], { ...DEFAULT_PRACTICE, count: 0 }, seeded(7));
    expect(slides).toHaveLength(20);
    expect(new Set(slides.map((s) => s.scene.id)).size).toBe(20);
    expect(slides.map((s) => s.scene.id)).not.toEqual(scenes.map((s) => s.id));
  });

  it('keeps library order and angles when asked', () => {
    const slides = buildSession(scenes, scenes[0], { ...DEFAULT_PRACTICE, count: 5, shuffle: false }, seeded(1));
    expect(slides.map((s) => s.scene)).toEqual(scenes.slice(0, 5));
    expect(slides.every((s) => !s.mirrored)).toBe(true);
  });

  it('repeats the library when more poses are requested than exist', () => {
    const small = scenes.slice(0, 3);
    expect(buildSession(small, small[0], { ...DEFAULT_PRACTICE, count: 10 }, seeded(3))).toHaveLength(10);
  });

  it('shows a single pose from random angles', () => {
    const slides = buildSession(scenes, scenes[2], { ...DEFAULT_PRACTICE, source: 'current', count: 5 }, seeded(11));
    expect(slides).toHaveLength(5);
    expect(slides.every((s) => s.scene.figures === scenes[2].figures)).toBe(true);
    expect(new Set(slides.map((s) => s.angle.yaw)).size).toBeGreaterThan(1);
    for (const s of slides) {
      expect(s.angle.pitch).toBeGreaterThanOrEqual(-10);
      expect(s.angle.pitch).toBeLessThanOrEqual(35);
    }
  });

  it('practises an animated scene\'s moments, spread over it, each from a random angle', () => {
    const s = newScene('Wave', scenes[2].figures);
    const animated = { ...s, animation: { ...newAnimation(s, 2) } };
    const slides = buildSession(scenes, animated, { ...DEFAULT_PRACTICE, source: 'current', count: 5 }, seeded(4));
    expect(slides).toHaveLength(5);
    expect(slides.every((x) => !x.scene.animation || x.scene !== animated)).toBe(true);
    expect(new Set(slides.map((x) => x.angle.yaw)).size).toBeGreaterThan(1);
  });

  it('mirrors some poses when enabled', () => {
    const slides = buildSession(scenes, scenes[0], { ...DEFAULT_PRACTICE, count: 20, mirror: true }, seeded(5));
    const mirrored = slides.filter((s) => s.mirrored).length;
    expect(mirrored).toBeGreaterThan(0);
    expect(mirrored).toBeLessThan(20);
  });

  it('formats time and validates options', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(59.2)).toBe('1:00');
    expect(formatTime(605)).toBe('10:05');
    expect(formatTime(-3)).toBe('0:00');
    expect(parsePracticeOptions({ seconds: 7, count: 3, style: 'bad' })).toEqual(DEFAULT_PRACTICE);
    expect(sessionLength({ source: 'all', count: 0 }, 20)).toBe(20);
    expect(sessionLength({ source: 'current', count: 0 }, 20)).toBe(10);
  });
});

describe('lighting settings', () => {
  it('clamps stored light values: only a key light casts shadows', () => {
    expect(clampLight({ id: 'a', role: 'key', azimuth: 500, elevation: -20, intensity: 9, color: 'red', kelvin: 99999 }))
      .toEqual({ id: 'a', role: 'key', azimuth: 180, elevation: 5, intensity: 2, color: kelvinColor(10000), kelvin: 10000, shadows: true });
    expect(clampLight({ id: 'b', role: 'fill', color: '#3D7BFF', shadows: true })).toMatchObject({ role: 'fill', color: '#3d7bff', shadows: false });
    expect(clampLight({ id: 'c', role: 'spot' as never }).role).toBe('custom');
  });

  it('colour temperatures: daylight white, candle warm, sky blue', () => {
    expect(kelvinColor(6500)).toBe('#ffffff');
    const [r, , b] = [1, 3, 5].map((i) => parseInt(kelvinColor(1900).slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(b + 100);
    const [r2, , b2] = [1, 3, 5].map((i) => parseInt(kelvinColor(10000).slice(i, i + 2), 16));
    expect(b2).toBeGreaterThan(r2);
  });

  it('loads settings, ignoring what is not a setting of the device', () => {
    const storage = new Map<string, string>();
    const fake = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
      clear: () => storage.clear(),
      key: () => null,
      length: 0,
    } as Storage;
    storage.set('pose-studio-settings', JSON.stringify({ style: 'neon', showGrid: false, gizmo: 'fly' }));
    const s = new Store(fake).getState().settings;
    expect('style' in s).toBe(false);
    expect(s.showGrid).toBe(false);
    expect(s.gizmo).toBe('translate');
  });
});

describe('scene lighting', () => {
  it('belongs to the scene: saved with it, made sound when loaded (lights with ids, up to four), studio light by default', () => {
    const lights = [
      { id: 'k', role: 'key', azimuth: 999, elevation: 1, intensity: 9, color: '#ffaa00' },
      { id: 'k', role: 'fill' },
      'not a light',
      ...['a', 'b', 'c', 'd'].map((id) => ({ id, role: 'custom' })),
    ];
    const scene = parseScene({ ...newScene('Dusk'), lighting: { lights, ambient: { intensity: -1, sky: '#102030', ground: 'mud' } } });
    expect(scene.lighting!.lights.map((l) => l.id)).toEqual(['k', 'a', 'b', 'c']);
    expect(scene.lighting!.lights[0]).toMatchObject({ azimuth: 180, elevation: 5, intensity: 2, color: '#ffaa00', shadows: true });
    expect(scene.lighting!.ambient).toEqual({ intensity: 0, sky: '#102030', ground: '#ffffff' });
    expect(parseScene({ ...newScene('None'), lighting: { lights: [] } }).lighting).toBeUndefined();
    expect(parseScene(newScene('Plain')).lighting).toBeUndefined();
    expect(LIGHTING_PRESETS[0].lighting).toEqual(DEFAULT_LIGHTING);
  });

  it('lights are added (fill, then rim: up to four), changed and deleted (not the last), a scheme sets them all', () => {
    const storage = new Map<string, string>();
    const store = new Store({ getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k), clear: () => storage.clear(), key: () => null, length: 0 } as Storage);
    const fill = addLight(store)!;
    expect(lightingOf(store.scene).lights.map((l) => l.role)).toEqual(['key', 'fill']);
    expect(store.getState().selection).toEqual({ kind: 'light', light: fill });
    addLight(store);
    addLight(store);
    expect(lightingOf(store.scene).lights.map((l) => l.role)).toEqual(['key', 'fill', 'rim', 'custom']);
    expect(addLight(store)).toBeNull();
    editLight(store, fill, { intensity: 0.3, shadows: true });
    expect(lightingOf(store.scene).lights[1]).toMatchObject({ intensity: 0.3, shadows: false });
    expect(deleteLight(store, fill)).toBe(true);
    applyLightingPreset(store, 'three-point');
    expect(sameLighting(lightingOf(store.scene), LIGHTING_PRESETS.find((p) => p.id === 'three-point')!.lighting)).toBe(true);
    const only = lightingOf(store.scene).lights;
    for (const l of only.slice(1)) deleteLight(store, l.id);
    expect(deleteLight(store, only[0].id)).toBe(false);
  });
});

describe('render styles', () => {
  it('defines every style, with a unique label', async () => {
    const { STYLE_DEFS, STYLE_LIST } = await import('@/lib/styles');
    const { STYLES } = await import('@/lib/types');
    expect(STYLE_LIST.map((s) => s.id)).toEqual([...STYLES]);
    for (const s of STYLES) expect(STYLE_DEFS[s].id).toBe(s);
    expect(new Set(STYLE_LIST.map((s) => s.label)).size).toBe(STYLES.length);
  });

  it('accepts the new styles in stored practice options and film settings', () => {
    expect(parseProjectSettings({ style: 'ink' })!.style).toBe('ink');
    expect(parseProjectSettings({ style: 'watercolour', frame: '4:3' })).toEqual({ frame: '16:9', style: 'line' });
    expect(parsePracticeOptions({ style: 'anime' }).style).toBe('anime');
  });

  it('builds materials for every style', async () => {
    const { Ink } = await import('@/lib/ink');
    const { STYLES } = await import('@/lib/types');
    const ink = new Ink();
    for (const s of STYLES) {
      const m = ink.materialsFor(s);
      expect(m.body).toBeTruthy();
      expect(m.propSel).toBeTruthy();
      ink.setStyle(s);
    }
    ink.dispose();
  });
});
