import { describe, expect, it } from 'vitest';
import { addFigure, applyMotion, holdKeyframe, moveKeyframes, travelTo, repeatAction, saveKeysAsMotion, setJoint, setKeyframeEase, startAnimation, stepFigure } from '@/lib/actions';
import { clipById } from '@/lib/assets';
import { actionsOf, figurePoseAt } from '@/lib/evaluate';
import { angle } from '@/lib/pose';
import { Store } from '@/lib/store';
import { keyEaseAt, keyTimesOf } from '@/lib/track';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

/** A figure with keys at 0, 1 and 2 s (its left arm raised at 1 s, down again at 2 s). */
function keyed() {
  const store = new Store(new MemoryStorage());
  const id = store.figure!.id;
  startAnimation(store, 4);
  setJoint(store, id, 'leftUpperArm', [0, 0, 0], '');
  store.setTime(1);
  setJoint(store, id, 'leftUpperArm', [0, 0, 60], '');
  store.setTime(2);
  setJoint(store, id, 'leftUpperArm', [0, 0, 0], '');
  const arm = (t: number) => angle(figurePoseAt(store.scene, id, t)!.bones, 'leftUpperArm')[2];
  return { store, id, arm };
}

describe('keyframes: pose to pose (#13)', () => {
  it('sets how a key goes on: held until the next, at an even speed, and keeps it through edits', () => {
    const { store, id, arm } = keyed();
    expect(arm(0.5)).toBeGreaterThan(5);
    setKeyframeEase(store, id, 0, 'step');
    expect(keyEaseAt(store.scene.animation!, id, 0)).toBe('step');
    expect(arm(0.9)).toBeCloseTo(0, 1);
    setKeyframeEase(store, id, 1, 'linear');
    expect(arm(1.5)).toBeCloseTo(30, 0);
    // Posing at a key keeps how it goes on.
    store.setTime(1);
    setJoint(store, id, 'leftUpperArm', [0, 0, 70], '');
    expect(keyEaseAt(store.scene.animation!, id, 1)).toBe('linear');
    expect(keyEaseAt(store.scene.animation!, id, 0)).toBe('step');
  });

  it('holds a pose for a time: a copy of the key, what follows moved on', () => {
    const { store, id, arm } = keyed();
    holdKeyframe(store, id, 1, 1);
    expect(keyTimesOf(store.scene.animation!, id)).toEqual([0, 1, 2, 3]);
    expect(arm(1.5)).toBeCloseTo(60, 0);
    expect(arm(3)).toBeCloseTo(0, 0);
  });

  it('repeats a keyed block (a cycle walks on) and a motion', () => {
    const { store, id, arm } = keyed();
    // Step forward between the keys, so the block travels.
    store.setTime(2);
    stepFigure(store, id, 0, -0.5);
    const block = actionsOf(store.scene.animation!, id).find((x) => x.source.kind === 'keys')!;
    repeatAction(store, block.id, 3);
    expect(keyTimesOf(store.scene.animation!, id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(arm(3)).toBeCloseTo(60, 0);
    expect(figurePoseAt(store.scene, id, 6)!.position[2]).toBeCloseTo(figurePoseAt(store.scene, id, 0)!.position[2] - 1.5, 2);
    expect(store.scene.animation!.duration).toBeGreaterThanOrEqual(6);

    const s2 = new Store(new MemoryStorage());
    const f2 = s2.figure!.id;
    startAnimation(s2, 4);
    applyMotion(s2, f2, 'wave');
    const wave = actionsOf(s2.scene.animation!, f2).find((x) => x.source.kind === 'clip')!;
    repeatAction(s2, wave.id, 3);
    const now = s2.scene.animation!.actions.find((x) => x.id === wave.id)!;
    expect(now.duration).toBeCloseTo(wave.duration * 3, 1);
    // The third time through is as the first.
    const head = (t: number) => angle(figurePoseAt(s2.scene, f2, t)!.bones, 'rightUpperArm')[2];
    expect(head(now.start + wave.duration * 2 + 0.3)).toBeCloseTo(head(now.start + 0.3), 0);
  });

  it('keeps a keyed block as a motion to give to another figure', () => {
    const { store, id } = keyed();
    const block = actionsOf(store.scene.animation!, id).find((x) => x.source.kind === 'keys')!;
    const name = saveKeysAsMotion(store, block.id)!;
    const info = store.getState().library.clips!.find((c) => c.name === name)!;
    expect(clipById(info.id)!.duration).toBeCloseTo(2, 3);
    addFigure(store, [1.5, 0, 0]);
    const other = store.scene.figures[1].id;
    store.setTime(0);
    expect(applyMotion(store, other, info.id)).toBe(true);
    expect(angle(figurePoseAt(store.scene, other, 1)!.bones, 'leftUpperArm')[2]).toBeCloseTo(60, 0);
  });

  it('moves several keys together, and refuses to put one onto another', () => {
    const { store, id } = keyed();
    expect(moveKeyframes(store, id, [1, 2], 0.5)).toBe(true);
    expect(keyTimesOf(store.scene.animation!, id)).toEqual([0, 1.5, 2.5]);
    expect(moveKeyframes(store, id, [1.5], -1.5)).toBe(false);
    expect(keyTimesOf(store.scene.animation!, id)).toEqual([0, 1.5, 2.5]);
  });

  it('holding the last key of a block moves on what starts there; a repeated block goes on from each first key as the first did', () => {
    const { store, id } = keyed();
    store.setTime(2);
    const walk = travelTo(store, id, [0, -2], 'walk')!;
    expect(walk.from).toBeCloseTo(2, 3);
    holdKeyframe(store, id, 2, 1);
    const travel = actionsOf(store.scene.animation!, id).find((x) => x.source.kind === 'travel')!;
    expect(travel.start).toBeCloseTo(3, 3);
    expect(keyTimesOf(store.scene.animation!, id)).toEqual([0, 1, 2, 3]);

    const k = keyed();
    setKeyframeEase(k.store, k.id, 0, 'step');
    const block = actionsOf(k.store.scene.animation!, k.id).find((x) => x.source.kind === 'keys')!;
    repeatAction(k.store, block.id, 2);
    expect(keyEaseAt(k.store.scene.animation!, k.id, 2)).toBe('step');
    expect(keyEaseAt(k.store.scene.animation!, k.id, 4)).toBe('smooth');
  });
});
