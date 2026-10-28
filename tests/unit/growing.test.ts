import { describe, expect, it } from 'vitest';
import { addFigure, cutAnimation, setAnimationOptions, setJoint, startAnimation, travelTo } from '@/lib/actions';
import { MAX_DURATION, PAST_END } from '@/lib/animation';
import { Store } from '@/lib/store';
import { keyTimesOf } from '@/lib/track';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('a timeline that grows (#13)', () => {
  it('lets the playhead past the end, and a key there lengthens the animation', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    startAnimation(store);
    const d = store.scene.animation!.duration;
    store.setTime(d + 10);
    expect(store.getState().time).toBeCloseTo(d + PAST_END, 5);
    setJoint(store, id, 'leftUpperArm', [40, 0, 0], '');
    expect(store.scene.animation!.duration).toBeCloseTo(d + PAST_END, 5);
    expect(keyTimesOf(store.scene.animation!, id).at(-1)).toBeCloseTo(d + PAST_END, 5);
    // And again from the new end: posing on keeps lengthening it.
    store.setTime(store.scene.animation!.duration + PAST_END);
    setJoint(store, id, 'leftUpperArm', [10, 0, 0], '');
    expect(store.scene.animation!.duration).toBeCloseTo(d + 2 * PAST_END, 5);
  });

  it('goes up to five minutes', () => {
    const store = new Store(new MemoryStorage());
    startAnimation(store);
    setAnimationOptions(store, { duration: 1000 });
    expect(store.scene.animation!.duration).toBe(MAX_DURATION);
  });

  it('cuts instead of scaling: timing kept, what is past the new end gone', () => {
    const store = new Store(new MemoryStorage());
    startAnimation(store);
    addFigure(store, [1, 0, 0]);
    const id = store.figure!.id;
    setAnimationOptions(store, { duration: 8 });
    store.setTime(1);
    const walk = travelTo(store, id, [0, -2], 'walk')!;
    store.setTime(6);
    setJoint(store, id, 'leftUpperArm', [40, 0, 0], '');
    expect(keyTimesOf(store.scene.animation!, id)).toContain(6);
    cutAnimation(store, 5);
    const a = store.scene.animation!;
    expect(a.duration).toBe(5);
    expect(keyTimesOf(a, id).every((t) => t <= 5 + 1e-6)).toBe(true);
    // The walk keeps its timing.
    const travel = a.actions.find((x) => x.source.kind === 'travel')!;
    expect(travel.start).toBeCloseTo(walk.from, 3);
    expect(travel.start + travel.duration).toBeCloseTo(walk.to, 3);
  });

  it('cuts a walk under way where it has got to, at its pace', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    startAnimation(store);
    setAnimationOptions(store, { duration: 8 });
    store.setTime(1);
    const [x0, , z0] = store.figure!.position;
    const walk = travelTo(store, id, [x0, z0 - 4], 'walk')!;
    const mid = (walk.from + walk.to) / 2;
    store.setTime(mid);
    const halfway = store.figure!.position[2];
    cutAnimation(store, mid);
    store.setTime(mid);
    expect(store.figure!.position[2]).toBeCloseTo(halfway, 1);
  });
});
