import { describe, expect, it, vi } from 'vitest';
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

describe('the director taking a scene over', () => {
  it('drops the camera the scene came with when it films none of it and was never changed; one changed by hand stays', () => {
    const store = new Store(new MemoryStorage());
    startAnimation(store, 6);
    expect(store.scene.cameras.map((c) => c.name)).toEqual(['Camera 1']);
    setDirector(store, 'follow');
    expect(store.scene.cameras.some((c) => c.name === 'Camera 1')).toBe(false);
    expect(store.scene.cameras.length).toBeGreaterThan(0);
    // Changed by hand first (its lens): kept, though it films nothing then.
    const other = new Store(new MemoryStorage());
    startAnimation(other, 6);
    other.updateScene((sc) => ({ ...sc, cameras: sc.cameras.map((c) => (c.kind === 'rig' ? { ...c, rig: { ...c.rig, lens: 85 } } : c)) }));
    setDirector(other, 'follow');
    expect(other.scene.cameras.some((c) => c.name === 'Camera 1')).toBe(true);
  });
});

describe('a new film (#14)', () => {
  it('starts from a result: a shoot preset or an empty scene, as long as asked, the director filming it', async () => {
    const { startAnimatedScene } = await import('@/lib/actions');
    const store = new Store(new MemoryStorage());
    const scenes = store.getState().library.scenes.length;
    expect(startAnimatedScene(store, { shoot: 'shoot-interview' }, 30)).toBe(true);
    expect(store.getState().library.scenes.length).toBe(scenes + 1);
    expect(store.scene.animation!.duration).toBe(30);
    expect(store.scene.coverage).toMatchObject({ id: 'dialogue', live: true });
    expect(store.scene.figures.length).toBeGreaterThanOrEqual(2);
    // (Only the director's cameras: the one the scene came with, filming none of it, went.)
    expect(store.scene.cameras.every((c) => c.made)).toBe(true);

    expect(startAnimatedScene(store, {}, 15)).toBe(true);
    expect(store.scene.animation!.duration).toBe(15);
    expect(store.scene.coverage).toMatchObject({ id: 'follow', live: true });
  });
});

describe('the director, by hand', () => {
  it('a cut by hand in the first shot stays; a shot renamed keeps its name; a deleted camera of its own turns it off', async () => {
    const { cutShot, editShot, deleteCamera, startAnimatedScene } = await import('@/lib/actions');
    const store = new Store(new MemoryStorage());
    startAnimatedScene(store, {}, 15);
    const first = shots(store)[0];
    store.setTime(Math.min(0.6, (shots(store)[1]?.start ?? 15) / 2));
    cutShot(store);
    const cut = shots(store).find((s) => Math.abs(s.start - store.getState().time) < 0.05);
    expect(cut?.pinned).toBeGreaterThan(0);
    expect(shots(store)[0].id).not.toBe(cut?.id);
    void first;
    const last = shots(store).at(-1)!;
    editShot(store, last.id, { name: 'The end' });
    expect(shots(store).find((s) => s.id === last.id)?.name).toBe('The end');
    const made = store.scene.cameras.find((c) => c.made?.startsWith('follow:'))!;
    expect(deleteCamera(store, made.id)).toBe(true);
    expect(store.scene.coverage?.live).toBeUndefined();
    expect(store.scene.cameras.some((c) => c.id === made.id)).toBe(false);
  });
});

describe('a film of a chosen length', () => {
  it('plays the scene through its cuts, and gives the free view back when it stops', async () => {
    const { Clock, startPlayback } = await import('@/components/clock');
    const { startAnimatedScene } = await import('@/lib/actions');
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const store = new Store(new MemoryStorage());
    expect(startAnimatedScene(store, { shoot: 'shoot-interview' }, 15)).toBe(true);
    const clock = new Clock();
    startPlayback(clock, store);
    expect(store.getState().through).toEqual({});
    clock.pause();
    expect(store.getState().through).toBeNull();
    // Already looking through a camera: it stays so.
    const cam = store.scene.cameras[0].id;
    store.lookThrough({ camera: cam });
    startPlayback(clock, store);
    clock.pause();
    expect(store.getState().through).toEqual({ camera: cam });
    vi.unstubAllGlobals();
  });

  it('is offered by the next-step hint when a scene is still one shot; on already, the hint offers the cut alone', async () => {
    const { nextStep } = await import('@/components/nextStep');
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    startAnimation(store, 10);
    store.setTime(2);
    travelTo(store, id, [0, -3], 'walk');
    const step = nextStep(store)!;
    expect(step.id).toBe('cut');
    expect(step.actions.map((x) => x.label)).toEqual(['Director', 'Cut here']);
    step.actions[0].run();
    expect(store.scene.coverage).toMatchObject({ id: 'follow', live: true });
    // Turned on from the timeline's menu instead, still one shot: no word of the director.
    const other = new Store(new MemoryStorage());
    startAnimation(other, 3);
    travelTo(other, other.figure!.id, [0, -1], 'walk');
    setDirector(other, 'follow');
    const cut = nextStep(other)!;
    expect(cut.text).toBe('One shot so far: cut it where the view should change');
    expect(cut.actions.map((x) => x.label)).toEqual(['Cut here']);
  });

  it('never plays backwards: a first frame that began before play was pressed does not take the time back', async () => {
    const { Clock } = await import('@/components/clock');
    let frame: ((t: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => { frame = f; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const clock = new Clock();
    clock.set(0.5);
    clock.play(() => ({ start: 0, end: 2, loop: true }));
    // (Its timestamp is when the frame began: 840 ms before play() was called, on a slow machine.)
    frame!(performance.now() - 840);
    expect(clock.time).toBeGreaterThanOrEqual(0.5);
    frame!(performance.now() + 50);
    expect(clock.time).toBeGreaterThan(0.5);
    clock.pause();
    vi.unstubAllGlobals();
  });
});
