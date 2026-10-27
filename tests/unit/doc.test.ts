import { describe, expect, it } from 'vitest';
import { mirrorFigure, newFigure, newProp, parseLibrary, parseScene, symmetrize } from '@/lib/doc';
import { jointLimits } from '@/lib/joints';
import { builtInPoses, poseScene } from '@/lib/poses';

/** The 20 reference poses as scenes. */
const refScenes = () => builtInPoses().map((p) => poseScene(p));
import { JOINTS } from '@/lib/types';
import { angle, anglesOf, bonesOf } from '@/lib/pose';

describe('parseLibrary', () => {
  it('round-trips the format unchanged', () => {
    const lib = { version: 3 as const, scenes: refScenes() };
    expect(parseLibrary(JSON.parse(JSON.stringify(lib)))).toEqual(lib);
  });

  it('reads animations saved as keyframes: keys, walks and props (one-time converter)', () => {
    const pose = (x: number, z: number, extra = {}) => ({ joints: { leftLowerLeg: [20, 0, 0] }, position: [x, 0, z], hands: {}, grounded: true, ...extra });
    const lib = parseLibrary({
      version: 2,
      scenes: [{
        id: 's', figures: [{ id: 'a' }, { id: 'b' }], props: [{ id: 'ball', kind: 'sphere' }],
        animation: {
          duration: 3, fps: 24, loop: false,
          keys: [
            { t: 0, poses: { a: pose(0, 0), b: pose(2, 0) }, props: { ball: { position: [0, 0, 1], rotation: [0, 0, 0] } } },
            { t: 1, poses: { a: pose(0, 0) } },
            { t: 2, poses: { a: pose(0, 2, { travel: 'walk' }) }, props: { ball: { position: [0, 0, 2], rotation: [0, 0, 0], release: true } } },
          ],
        },
      }],
      motions: [{ id: 'm', name: 'Mine', scene: { figures: [{ id: 'x' }], animation: { duration: 1, keys: [{ t: 0, poses: { x: pose(0, 0) } }, { t: 1, poses: { x: pose(0, 1) } }] } } }],
    });
    const a = lib.scenes[0].animation!;
    const of = (id: string) => a.actions.filter((x) => x.roles[0].figure === id).map((x) => [x.source.kind, x.start, x.duration]);
    expect(of('a')).toEqual([['keys', 0, 1], ['travel', 1, 1], ['keys', 2, 0]]);
    expect(of('b')).toEqual([['keys', 0, 0]]);
    expect(a.actions.find((x) => x.source.kind === 'travel')!.roles[0].end).toEqual({ at: [0, 2], facing: 0 });
    expect(a.props!.ball.map((k) => [k.t, !!k.release])).toEqual([[0, false], [2, true]]);
    expect(lib.version).toBe(3);
    expect(lib.clips!.map((c) => [c.id, c.name, c.duration, c.people.length])).toEqual([['m', 'Mine', 1, 1]]);
  });

  it('reads documents saved with the old joint names (one-time converter)', () => {
    const s = parseScene({ figures: [{ joints: { root: [10, 20, 0], shoulderL: [0, 0, 30], kneeR: [45, 0, 0] } }] });
    expect(anglesOf(s.figures[0].bones)).toEqual({ hips: [10, 20, 0], leftUpperArm: [0, 0, 30], rightLowerLeg: [45, 0, 0] });
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
        joints: { leftUpperLeg: [Number.NaN, 400, 'a'], bogus: [1, 2, 3] },
        body: { height: 99, sex: -3 },
        hands: { L: { curl: [2, -1, 0.5], spread: 7 } },
      }],
      props: [{ kind: 'spaceship' }, { kind: 'box', scale: [0, -2, 1e9] }],
      view: { yaw: 900, pitch: 200, fov: 0 },
    });
    const f = s.figures[0];
    expect(anglesOf(f.bones)).toEqual({ leftUpperLeg: [0, 40, 0] });
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
    const f = newFigure({ bones: bonesOf({ leftUpperArm: [-10, 40, 60] }) });
    const m = anglesOf(mirrorFigure(f).bones);
    expect(m.rightUpperArm).toEqual([-10, -40, -60]);
    expect(m.leftUpperArm).toBeUndefined();
  });

  it('symmetrize copies one side onto the other', () => {
    const f = newFigure({ bones: bonesOf({ leftUpperLeg: [-40, 10, 20], rightUpperLeg: [5, 0, 0], chest: [10, 20, 5] }) });
    const s = anglesOf(symmetrize(f, 'L').bones);
    expect(s.rightUpperLeg).toEqual([-40, -10, -20]);
    expect(s.chest).toEqual([10, 0, 0]);
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
        const r = angle(s.figures[0].bones, j);
        const lim = jointLimits(j);
        r.forEach((v, i) => {
          expect(v, `${s.name}: ${j}[${i}]`).toBeGreaterThanOrEqual(lim[i][0]);
          expect(v, `${s.name}: ${j}[${i}]`).toBeLessThanOrEqual(lim[i][1]);
        });
      }
    }
  });
});
