import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { poseOf, samplePose } from '@/lib/animation';
import { newFigure, newScene } from '@/lib/doc';
import { buildMotion } from '@/lib/motions';
import { checkMotion, segmentDistance } from '@/lib/qa';
import { buildTemplate } from '@/lib/templates';
import type { Figure, Scene } from '@/lib/types';

/** An animation from a list of [time, figures] keys. */
function animate(keys: [number, Figure[]][], duration = 1, loop = false): Scene {
  const scene = newScene('Test', keys[0][1]);
  return { ...scene, animation: { duration, fps: 24, loop, keys: keys.map(([t, figs]) => ({ t, poses: Object.fromEntries(figs.map((f) => [f.id, poseOf(f)])) })) } };
}

const kinds = (s: Scene) => checkMotion(s).map((i) => i.kind);

describe('motion QA', () => {
  it('passes the built-in animations and multi-person holds', () => {
    for (const id of ['walk', 'run', 'jump', 'dance', 'boxing', 'kick', 'wave', 'bow']) expect(checkMotion(buildMotion(id)!), id).toEqual([]);
    for (const id of ['waltz', 'shoulder', 'group', 'sparring']) {
      const s = buildTemplate(id)!;
      expect(checkMotion(animate([[0, s.figures]])), id).toEqual([]);
    }
  }, 30_000);

  it('finds a planted foot sliding', () => {
    const f = newFigure();
    const moved = { ...f, position: [0.3, 0, 0] as [number, number, number] };
    const issues = checkMotion(animate([[0, [f]], [1, [moved]]]));
    expect(issues.some((i) => i.kind === 'slide' && i.figure === f.id)).toBe(true);
    expect(issues[0].message).toMatch(/foot slides \d+ cm/);
    expect(issues[0].hint).toBeTruthy();
  });

  it('finds a bent-back knee and a pop (nothing goes below the floor: it is solid)', () => {
    const f = { ...newFigure(), grounded: false, position: [0, 0.8, 0] as [number, number, number] };
    expect(kinds(animate([[0, [f]]]))).not.toContain('slide');

    const g = newFigure();
    const hyper = { ...g, joints: { ...g.joints, kneeL: [-40, 0, 0] as [number, number, number] } };
    const limit = checkMotion(animate([[0, [hyper]]]));
    expect(limit.map((i) => [i.kind, i.joint])).toEqual([['limit', 'kneeL']]);

    const snap = { ...g, joints: { ...g.joints, shoulderR: [-100, 0, 0] as [number, number, number] } };
    expect(kinds(animate([[0, [g]], [0.5, [g]], [0.54, [snap]], [1, [snap]]]))).toContain('pop');
  });

  it('finds figures walking through each other and through props', () => {
    const a = newFigure({ name: 'A' });
    const b = newFigure({ name: 'B', position: [0.05, 0, 0] });
    const issues = checkMotion(animate([[0, [a, b]]]));
    expect(issues.some((i) => i.kind === 'overlap' && /A’s body passes \d+ cm into B’s body/.test(i.message))).toBe(true);

    const scene = animate([[0, [a]]]);
    scene.props = [{ id: 'p', name: 'Box', kind: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.6, 1.2, 0.6] }];
    expect(kinds(scene)).toContain('overlap');
  });

  it('swings a limited joint through its range, not the short way round', () => {
    const f = newFigure();
    const down = { ...f, joints: { shoulderL: [50, 0, 0] as [number, number, number] } };
    const up = { ...f, joints: { shoulderL: [-160, 0, 0] as [number, number, number] } };
    const a = animate([[0, [down]], [1, [up]]]).animation!;
    // Halfway the arm points forward (about −55°), not straight up behind the back (about 145°).
    expect(samplePose(a, f.id, 0.5)!.joints.shoulderL![0]).toBeCloseTo(-55, 0);
  });

  it('measures the distance between segments', () => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0.5, 1, 0), v(0.5, 2, 0))).toBeCloseTo(1);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0.5, -1, 0), v(0.5, 1, 0))).toBeCloseTo(0);
    expect(segmentDistance(v(0, 0, 0), v(0, 0, 0), v(3, 4, 0), v(3, 4, 0))).toBeCloseTo(5);
  });
});
