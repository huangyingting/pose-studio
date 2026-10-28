import { describe, expect, it } from 'vitest';
import { moveShotCut, setDirector, startAnimation, travelTo, unpinShot } from '@/lib/actions';
import { Store } from '@/lib/store';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const shots = (store: Store) => store.scene.animation!.shots;

describe('the director (#14)', () => {
  it('cuts again as what they do changes, keeps a cut moved by hand, and stops when turned off', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    startAnimation(store, 10);
    setDirector(store, 'follow');
    expect(store.scene.coverage).toMatchObject({ id: 'follow', live: true });
    const before = shots(store).length;
    // A walk from 3 s: the director cuts to its tracking camera as it sets off.
    store.setTime(3);
    travelTo(store, id, [0, -3], 'walk');
    const walkStart = store.scene.animation!.actions.find((x) => x.source.kind === 'travel')!.start;
    expect(shots(store).some((s) => Math.abs(s.start - walkStart) < 0.05)).toBe(true);
    expect(shots(store).length).toBeGreaterThanOrEqual(before);

    // A cut moved by hand: pinned, and kept there through the next edit.
    const second = shots(store)[1];
    moveShotCut(store, second.id, second.start + 0.5);
    const moved = shots(store).find((s) => s.id === second.id)!;
    expect(moved.pinned).toBeGreaterThan(0);
    store.setTime(7);
    travelTo(store, id, [1, -3], 'walk');
    expect(shots(store).find((s) => s.id === second.id)?.start).toBeCloseTo(moved.start, 3);
    // Handed back: no longer pinned.
    unpinShot(store, second.id);
    expect(shots(store).find((s) => s.id === second.id)?.pinned).toBeUndefined();

    // Off: edits leave the cuts alone.
    setDirector(store, null);
    expect(store.scene.coverage?.live).toBeUndefined();
    const cuts = JSON.stringify(shots(store));
    store.setTime(9);
    travelTo(store, id, [2, -3], 'run');
    expect(JSON.stringify(shots(store))).toBe(cuts);
  });
});
