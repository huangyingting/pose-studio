import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MemoryStorage, motionScene } from '../fixtures/scenes';
import { putClips } from '@/lib/assets';
import { newFigure, newProp, newScene, parseClip } from '@/lib/doc';
import { figurePoseAt } from '@/lib/evaluate';
import { checkMotion, segmentDistance } from '@/lib/qa';
import { applyMotion, issueFix } from '@/lib/actions';
import { Store } from '@/lib/store';
import { buildStaging } from '@/lib/stagings';
import type { Figure, Scene } from '@/lib/types';
import { keysAction } from '@/lib/track';
import { angle, bonesOf, withAngles } from '../../lib/pose';

/** An animation from a list of [time, figures] keys (each figure's keys one action). */
function animate(keys: [number, Figure[]][], duration = 1, loop = false): Scene {
  const scene = newScene('Test', keys[0][1]);
  const actions = keys[0][1].map((f) => keysAction(f.id, keys.flatMap(([t, figs]) => figs.filter((x) => x.id === f.id).map((x) => ({ t, pose: x })))));
  return { ...scene, animation: { duration, fps: 24, loop, actions, shots: [{ id: 'main', start: 0, name: 'Shot 1', camera: scene.cameras[0].id }] } };
}

const kinds = (s: Scene) => checkMotion(s).map((i) => i.kind);

describe('motion QA', () => {
  it('passes the built-in animations and multi-person holds', () => {
    for (const id of ['walk', 'run', 'jump', 'dance', 'kick', 'wave', 'bow']) expect(checkMotion(motionScene(id)), id).toEqual([]);
    for (const id of ['waltz', 'shoulder', 'group', 'sparring']) {
      const s = buildStaging(id)!;
      expect(checkMotion(animate([[0, s.figures]])), id).toEqual([]);
    }
  }, 30_000);

  it('leaves a recorded Library motion as it was recorded alone: its own snaps and reach are not the scene\'s to fix', () => {
    const clip = parseClip(JSON.parse(readFileSync('public/motions/capoeira.json', 'utf8')))!;
    putClips([clip]);
    const f = newFigure({ name: 'Mei' });
    const scene = newScene('Test', [f]);
    const play = { id: 'a1', start: 0, duration: clip.duration, blendIn: 0.25, roles: [{ figure: f.id }], source: { kind: 'clip' as const, clip: clip.id } };
    const s: Scene = { ...scene, animation: { duration: clip.duration, fps: 24, loop: false, actions: [play], shots: [{ id: 'main', start: 0, name: 'Shot 1', camera: scene.cameras[0].id }] } };
    expect(kinds(s).filter((k) => k === 'pop' || k === 'limit')).toEqual([]);
  });

  it('offers to step round instead of a motion turned as it plays, its feet sliding; and fixes it', () => {
    const idle = parseClip(JSON.parse(readFileSync('public/motions/idle.json', 'utf8')))!;
    putClips([idle]);
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    expect(applyMotion(store, id, idle.id)).toBe(true);
    // Turned a half turn round over it (as an end mark facing the other way does).
    store.updateScene((s) => ({ ...s, animation: { ...s.animation!, actions: s.animation!.actions.map((x) => (x.source.kind === 'clip' ? { ...x, roles: [{ figure: id, end: { at: [0, 0] as [number, number], facing: 120 } }] } : x)) } }));
    const slide = checkMotion(store.scene).find((i) => i.kind === 'slide')!;
    expect(slide).toBeTruthy();
    const fix = issueFix(store, slide)!;
    expect(fix.label).toBe('Step round instead');
    fix.run();
    expect(checkMotion(store.scene).filter((i) => i.kind === 'slide')).toEqual([]);
    // (Stepped round to face that way first; the motion then as it goes by itself.)
    const [turn, play] = store.scene.animation!.actions.filter((x) => x.source.kind !== 'keys');
    expect(turn.source.kind).toBe('travel');
    expect(turn.roles[0].end!.facing).toBe(120);
    expect(Math.abs(play.roles[0].end!.facing - 120)).toBeLessThan(5);
  });

  it('finds a ball flying through someone, but not one let go of or caught at a hand', () => {
    const f = newFigure({ name: 'Ben' });
    const ball = { ...newProp('sphere', [0, 1, -1.5], 'Ball'), scale: [0.24, 0.24, 0.24] as [number, number, number] };
    const scene = animate([[0, [f]], [1, [f]]]);
    // Straight through the chest, from in front to behind (gliding, not lobbed over).
    const through = { ...scene, props: [ball], animation: { ...scene.animation!, props: { [ball.id]: [
      { t: 0, position: [0, 1.3, 1.5] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] },
      { t: 1, position: [0, 1.3, -1.5] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] },
    ] } } };
    expect(checkMotion(through).map((i) => i.message)).toContain('Ball flies through Ben’s body');
    // Past the side, clear of him.
    const past = { ...through, animation: { ...through.animation, props: { [ball.id]: through.animation.props[ball.id].map((k) => ({ ...k, position: [1, 1.1, k.position[2]] as [number, number, number] })) } } };
    expect(kinds(past)).toEqual([]);
  });

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
    const hyper = { ...g, bones: withAngles(g.bones, { leftLowerLeg: [-40, 0, 0] }) };
    const limit = checkMotion(animate([[0, [hyper]]]));
    expect(limit.map((i) => [i.kind, i.joint])).toEqual([['limit', 'leftLowerLeg']]);

    const snap = { ...g, bones: withAngles(g.bones, { rightUpperArm: [-100, 0, 0] }) };
    expect(kinds(animate([[0, [g]], [0.5, [g]], [0.54, [snap]], [1, [snap]]]))).toContain('pop');
  });

  it('finds figures walking through each other and through props', () => {
    const a = newFigure({ name: 'A' });
    const b = newFigure({ name: 'B', position: [0.05, 0, 0] });
    const issues = checkMotion(animate([[0, [a, b]]]));
    expect(issues.some((i) => i.kind === 'overlap' && /A’s body passes \d+ cm into B’s body/.test(i.message))).toBe(true);

    // Keyed into a box (a grounded figure there would stand on top of it).
    const scene = animate([[0, [{ ...a, grounded: false, position: [0, 0.93, 0] }]]]);
    scene.props = [{ id: 'p', name: 'Box', kind: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.6, 1.2, 0.6] }];
    expect(kinds(scene)).toContain('overlap');
  });

  it('swings a limited joint through its range, not the short way round', () => {
    const f = newFigure();
    const down = { ...f, bones: bonesOf({ leftUpperArm: [50, 0, 0] }) };
    const up = { ...f, bones: bonesOf({ leftUpperArm: [-160, 0, 0] }) };
    const s = animate([[0, [down]], [1, [up]]]);
    // Halfway the arm points forward (about −55°), not straight up behind the back (about 145°).
    expect(angle(figurePoseAt(s, f.id, 0.5)!.bones, 'leftUpperArm', [-55, 0, 0])[0]).toBeCloseTo(-55, 0);
  });

  it('measures the distance between segments', () => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0.5, 1, 0), v(0.5, 2, 0))).toBeCloseTo(1);
    expect(segmentDistance(v(0, 0, 0), v(1, 0, 0), v(0.5, -1, 0), v(0.5, 1, 0))).toBeCloseTo(0);
    expect(segmentDistance(v(0, 0, 0), v(0, 0, 0), v(3, 4, 0), v(3, 4, 0))).toBeCloseTo(5);
  });
  it('finds a figure hidden from the shot camera behind a prop', () => {
    const f = newFigure();
    const blocked = { ...animate([[0, [f]], [1, [f]]]), props: [{ ...newProp('wall', [0, 0, 1.2]) }] };
    const hidden = checkMotion(blocked).filter((i) => i.kind === 'hidden');
    expect(hidden).toHaveLength(1);
    expect(hidden[0].message).toMatch(/hidden behind Wall in Shot 1/);
    // Out from behind it: nothing to report.
    const clear = { ...blocked, props: [{ ...newProp('wall', [3, 0, 1.2]) }] };
    expect(checkMotion(clear).filter((i) => i.kind === 'hidden')).toEqual([]);
  });
});
