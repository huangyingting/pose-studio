import { describe, expect, it } from 'vitest';
import { addCamera, addFigure, addProp, offsetPerformance, setJoint, startAnimation, stepCamera, stepFigure, stepJoint, stepMany, stepProp, travelTo, turnFigure, turnProp } from '@/lib/actions';
import { cameraById, viewOf } from '@/lib/cameras';
import { angle } from '@/lib/pose';
import { facing } from '@/lib/relations';
import { Store } from '@/lib/store';
import { figurePoseAt } from '@/lib/evaluate';
import { keyTimesOf, partnersOf } from '@/lib/track';
import type { Animation } from '@/lib/types';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('steps from the keyboard (#13)', () => {
  it('moves and turns a figure and a prop by a step', () => {
    const store = new Store(new MemoryStorage());
    const f = store.figure!;
    const [x, , z] = f.position;
    stepFigure(store, f.id, 0.05, -0.05);
    expect(store.figure!.position[0]).toBeCloseTo(x + 0.05, 5);
    expect(store.figure!.position[2]).toBeCloseTo(z - 0.05, 5);
    const yaw = facing(store.figure!);
    turnFigure(store, f.id, 15);
    expect(facing(store.figure!)).toBeCloseTo(yaw + 15, 3);

    addProp(store, 'chair');
    const p = store.scene.props[0];
    stepProp(store, p.id, 0, 0, 0.1);
    turnProp(store, p.id, -15);
    const q = store.scene.props[0];
    expect(q.position[1]).toBeCloseTo(p.position[1] + 0.1, 5);
    expect(q.rotation[1]).toBeCloseTo(p.rotation[1] - 15, 3);
  });

  it('turns several about their middle in one undo step', () => {
    const store = new Store(new MemoryStorage());
    addFigure(store, [1, 0, 0]);
    const [a, b] = store.scene.figures;
    const before = store.scene.figures.map((f) => [...f.position]);
    const mid = (before[0][0] + before[1][0]) / 2;
    stepMany(store, [a.id, b.id], [], { turn: 180 });
    const after = store.scene.figures.map((f) => f.position);
    // Half a turn about the middle: each is where the other was (mirrored through the middle).
    expect(after[0][0]).toBeCloseTo(2 * mid - before[0][0], 3);
    expect(after[1][0]).toBeCloseTo(2 * mid - before[1][0], 3);
    store.undo();
    expect(store.scene.figures.map((f) => f.position)).toEqual(before);
  });

  it('steps a joint slider within its limits, and keys a step in an animated scene', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    setJoint(store, id, 'leftLowerLeg', [0, 0, 0], '');
    // The knee bends one way only (limits on): stepping it back from straight stays at 0.
    expect(stepJoint(store, id, 'leftLowerLeg', 0, -5)).toBe(0);
    expect(stepJoint(store, id, 'leftLowerLeg', 0, 5)).toBe(5);
    expect(angle(store.figure!.bones, 'leftLowerLeg')[0]).toBeCloseTo(5, 1);

    startAnimation(store);
    store.setTime(1);
    stepFigure(store, id, 0.05, 0);
    expect(keyTimesOf(store.scene.animation!, id)).toContain(1);
  });

  it('goes round past 180° with the joint limits off', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    store.setSettings({ limits: false });
    setJoint(store, id, 'head', [0, 175, 0], '');
    expect(stepJoint(store, id, 'head', 1, 10)).toBeCloseTo(-175, 3);
  });

  it('moves a camera made from the view (fixed) across and pans it', () => {
    const store = new Store(new MemoryStorage());
    const cam = addCamera(store);
    const view = () => viewOf(store.scene, cameraById(store.scene, cam)!, 0);
    const before = view();
    stepCamera(store, cam, { right: 0.1 });
    expect(view().position.distanceTo(before.position)).toBeCloseTo(0.1, 3);
    // Panned: it looks another way from the same place.
    const at = view();
    stepCamera(store, cam, { pan: 5 });
    expect(view().position.distanceTo(at.position)).toBeCloseTo(0, 3);
    const d0 = at.target.clone().sub(at.position).normalize();
    const d1 = view().target.clone().sub(view().position).normalize();
    expect((Math.acos(Math.min(1, d0.dot(d1))) * 180) / Math.PI).toBeCloseTo(5, 0);
  });

  it('keeps a fixed camera\'s roll', () => {
    const store = new Store(new MemoryStorage());
    const cam = addCamera(store);
    store.updateScene((s) => ({ ...s, cameras: s.cameras.map((c) => (c.id === cam && c.kind === 'rig' ? { ...c, rig: { ...c.rig, roll: 10 } } : c)) }));
    stepCamera(store, cam, { right: 0.1 });
    expect(viewOf(store.scene, cameraById(store.scene, cam)!, 0).roll).toBeCloseTo(10, 3);
  });

  it('moves and turns a whole performance without a key, in one undo step', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    startAnimation(store);
    const [x0, , z0] = store.figure!.position;
    const span = travelTo(store, id, [x0 + 2, z0], 'walk')!;
    store.setTime(span.to);
    const keys = keyTimesOf(store.scene.animation!, id);
    const at = (t: number) => figurePoseAt(store.scene, id, t)!.position;
    const [start, end] = [at(0), at(span.to)];
    const undos = store.getState().canUndo;

    offsetPerformance(store, [id], { dx: 0.5 }, 'test');
    expect(keyTimesOf(store.scene.animation!, id)).toEqual(keys);
    expect(at(0)[0]).toBeCloseTo(start[0] + 0.5, 2);
    expect(at(span.to)[0]).toBeCloseTo(end[0] + 0.5, 2);
    // The figure on the canvas is posed from it again.
    expect(store.figure!.position[0]).toBeCloseTo(end[0] + 0.5, 2);

    // Half a turn about where it is at the playhead: the walk now comes the other way.
    offsetPerformance(store, [id], { turn: 180 });
    expect(at(span.to)[0]).toBeCloseTo(end[0] + 0.5, 2);
    expect(at(0)[0]).toBeCloseTo(end[0] + 0.5 + 2, 1);
    store.undo();
    store.undo();
    expect(at(0)[0]).toBeCloseTo(start[0], 3);
    expect(store.getState().canUndo).toBe(undos);
  });

  it('moves a figure added since the scene was animated (it has no track yet)', () => {
    const store = new Store(new MemoryStorage());
    startAnimation(store);
    addFigure(store, [1, 0, 0]);
    const id = store.scene.figures[1].id;
    const x = store.scene.figures[1].position[0];
    offsetPerformance(store, [id], { dx: 0.5 });
    expect(store.scene.figures[1].position[0]).toBeCloseTo(x + 0.5, 3);
  });

  it('brings along those who share an action', () => {
    const act = (id: string, figures: string[]) => ({ id, start: 0, duration: 1, roles: figures.map((figure) => ({ figure })), source: { kind: 'clip', clip: 'x' } });
    const a = { duration: 4, fps: 24, loop: false, actions: [act('1', ['a', 'b']), act('2', ['b', 'c']), act('3', ['d'])] } as unknown as Animation;
    expect(partnersOf(a, ['a']).sort()).toEqual(['a', 'b', 'c']);
    expect(partnersOf(a, ['d'])).toEqual(['d']);
  });
});
