import { describe, expect, it } from 'vitest';
import { mirrorFigure, newFigure, newProp, parseLibrary, parseScene, symmetrize } from '@/lib/doc';
import { jointLimits } from '@/lib/joints';
import { builtInPoses, poseScene } from '@/lib/poses';

/** The 20 reference poses as scenes. */
const refScenes = () => builtInPoses().map((p) => poseScene(p));
import { JOINTS } from '@/lib/types';

describe('parseLibrary', () => {
  it('round-trips the v2 format unchanged', () => {
    const lib = { version: 2 as const, scenes: refScenes() };
    expect(parseLibrary(JSON.parse(JSON.stringify(lib)))).toEqual(lib);
  });

  it('accepts only library files', () => {
    expect(() => parseLibrary(refScenes()[3])).toThrow('Not a Pose Studio library');
    expect(() => parseLibrary({ scenes: [] })).toThrow('no scenes');
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
    expect(s.name).toBe('Scene 1');
    expect(s.props).toHaveLength(1);
    expect(s.props[0].scale).toEqual([0.02, 2, 20]);
    expect(s.view).toEqual({ yaw: 180, pitch: 89, fov: 5 });
  });

  it('gives duplicate ids fresh ones', () => {
    const scene = refScenes()[0];
    const lib = parseLibrary({ scenes: [scene, scene] });
    expect(lib.scenes[0].id).not.toBe(lib.scenes[1].id);
  });
});

describe('pose operations', () => {
  it('mirroring twice is the identity', () => {
    const f = refScenes()[0].figures[0];
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
    expect(refScenes()).toHaveLength(20);
  });

  it('keeps every preset inside the anatomical joint limits', () => {
    for (const s of refScenes()) {
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
