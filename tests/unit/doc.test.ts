import { describe, expect, it } from 'vitest';
import { mirrorFigure, newFigure, newProp, parseLibrary, parseScene, symmetrize } from '@/lib/doc';
import { jointLimits } from '@/lib/joints';
import { presetScenes } from '@/lib/presets';
import { JOINTS } from '@/lib/types';

describe('parseLibrary', () => {
  it('migrates the v1 format (array of single-figure poses)', () => {
    const lib = parseLibrary([
      { name: 'Old', joints: { hipL: [-10, 0, 5] }, offset: [0.5, -0.2], view: { yaw: 30, pitch: 10 } },
    ]);
    expect(lib.version).toBe(2);
    const s = lib.scenes[0];
    expect(s.name).toBe('Old');
    expect(s.figures).toHaveLength(1);
    expect(s.figures[0].joints.hipL).toEqual([-10, 0, 5]);
    expect(s.figures[0].position).toEqual([0.5, 0, -0.2]);
    expect(s.view).toEqual({ yaw: 30, pitch: 10, fov: 20 });
  });

  it('round-trips the v2 format unchanged', () => {
    const lib = { version: 2 as const, scenes: presetScenes() };
    expect(parseLibrary(JSON.parse(JSON.stringify(lib)))).toEqual(lib);
  });

  it('accepts a single scene', () => {
    const scene = presetScenes()[3];
    expect(parseLibrary(scene).scenes[0]).toEqual(scene);
  });

  it('rejects unusable input', () => {
    expect(() => parseLibrary(42)).toThrow();
    expect(() => parseLibrary({ hello: 'world' })).toThrow();
    expect(() => parseLibrary([])).toThrow();
  });

  it('sanitises bad values instead of trusting them', () => {
    const s = parseScene({
      name: 'x'.repeat(500),
      figures: [{
        joints: { hipL: [Number.NaN, 400, 'a'], bogus: [1, 2, 3] },
        body: { height: 99, sex: -3 },
        hands: { L: { curl: [2, -1, 0.5], spread: 7 } },
      }],
      props: [{ kind: 'spaceship' }, { kind: 'box', scale: [0, -2, 1e9] }],
      view: { yaw: 900, pitch: 200, fov: 0 },
    });
    const f = s.figures[0];
    expect(f.joints).toEqual({ hipL: [0, 40, 0] });
    expect(f.body.height).toBe(2.2);
    expect(f.body.sex).toBe(0);
    expect(f.hands.L.curl.slice(0, 3)).toEqual([1, 0, 0.5]);
    expect(f.hands.L.spread).toBe(1);
    expect(s.name).toBe('Pose 1');
    expect(s.props).toHaveLength(1);
    expect(s.props[0].scale).toEqual([0.02, 2, 20]);
    expect(s.view).toEqual({ yaw: 180, pitch: 89, fov: 5 });
  });

  it('gives duplicate ids fresh ones', () => {
    const scene = presetScenes()[0];
    const lib = parseLibrary([scene, scene]);
    expect(lib.scenes[0].id).not.toBe(lib.scenes[1].id);
  });
});

describe('pose operations', () => {
  it('mirroring twice is the identity', () => {
    const f = presetScenes()[0].figures[0];
    expect(mirrorFigure(mirrorFigure(f))).toEqual(f);
  });

  it('mirroring swaps sides and negates twist/spread', () => {
    const f = newFigure({ joints: { shoulderL: [-10, 90, 150] } });
    const m = mirrorFigure(f);
    expect(m.joints.shoulderR).toEqual([-10, -90, -150]);
    expect(m.joints.shoulderL).toBeUndefined();
  });

  it('symmetrize copies one side onto the other', () => {
    const f = newFigure({ joints: { hipL: [-40, 10, 20], hipR: [5, 0, 0], chest: [10, 20, 5] } });
    const s = symmetrize(f, 'L');
    expect(s.joints.hipR).toEqual([-40, -10, -20]);
    expect(s.joints.chest).toEqual([10, 0, 0]);
  });

  it('creates props resting on the floor', () => {
    expect(newProp('chair').position[1]).toBe(0);
  });
});

describe('presets', () => {
  it('has the 20 poses from the reference sheet', () => {
    expect(presetScenes()).toHaveLength(20);
  });

  it('keeps every preset inside the anatomical joint limits', () => {
    for (const s of presetScenes()) {
      for (const j of JOINTS) {
        const r = s.figures[0].joints[j];
        if (!r) continue;
        const lim = jointLimits(j);
        r.forEach((v, i) => {
          expect(v, `${s.name}: ${j}[${i}]`).toBeGreaterThanOrEqual(lim[i][0]);
          expect(v, `${s.name}: ${j}[${i}]`).toBeLessThanOrEqual(lim[i][1]);
        });
      }
    }
  });
});
