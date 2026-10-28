import { describe, expect, it } from 'vitest';
import { applyMotion, setIdleLife, startAnimation } from '@/lib/actions';
import { actionsOf, sceneAt } from '@/lib/evaluate';
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

describe('idle life (#14)', () => {
  it('breathes in the gaps as the film plays, not while posing, not during an action; the same every time', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    startAnimation(store, 8);
    store.setTime(4);
    applyMotion(store, id, 'wave');
    const wave = actionsOf(store.scene.animation!, id).find((x) => x.source.kind === 'clip')!;
    const chest = (t: number, live: boolean) => sceneAt(store.scene, t, live).figures[0].bones.chest;
    // In the gap before the wave: alive when playing, as keyed when posing.
    expect(chest(1.5, true)).not.toEqual(chest(1.5, false));
    expect(chest(1.5, true)).toEqual(chest(1.5, true));
    // During the wave: as the wave has it.
    expect(chest(wave.start + wave.duration / 2, true)).toEqual(chest(wave.start + wave.duration / 2, false));
    // The legs and feet stay where they are.
    const live = sceneAt(store.scene, 1.5, true).figures[0];
    const posed = sceneAt(store.scene, 1.5, false).figures[0];
    expect(live.position).toEqual(posed.position);
    expect(live.bones.leftUpperLeg).toEqual(posed.bones.leftUpperLeg);
    // Holding still: no idle life.
    setIdleLife(store, id, false);
    expect(chest(1.5, true)).toEqual(chest(1.5, false));
  });
});

describe('idle life over a loop and a hold', () => {
  it('goes round with a looping film (no jump where it starts over) and keeps still while holding on to someone', async () => {
    const { addFigure, holdOn } = await import('@/lib/actions');
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    startAnimation(store, 6);
    store.updateScene((s) => ({ ...s, animation: { ...s.animation!, loop: true } }));
    const chest = (t: number) => sceneAt(store.scene, t, true).figures[0].bones.chest!;
    const end = chest(6);
    const start = chest(0);
    end.forEach((v, i) => expect(v).toBeCloseTo(start[i], 4));
    // Holding a partner's hand: no idle life then.
    addFigure(store, [0.6, 0, 0]);
    const other = store.scene.figures[1].id;
    store.setTime(0);
    holdOn(store, id, 'R', other, 'leftHand');
    const held = store.scene.animation!.constraints?.[0];
    expect(held).toBeTruthy();
    const t = (held!.start + Math.min(held!.end, 6)) / 2;
    expect(sceneAt(store.scene, t, true).figures[0].bones.chest).toEqual(sceneAt(store.scene, t, false).figures[0].bones.chest);
  });
});

describe('the scene posed for a time', () => {
  it('keeps what was changed on a figure since the animation (a new name, a colour)', async () => {
    const { renameFigure, setFigureColor } = await import('@/lib/actions');
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    startAnimation(store, 4);
    store.setTime(1);
    renameFigure(store, id, 'Kai');
    setFigureColor(store, id, '#ff0000');
    store.setTime(2);
    expect(store.scene.figures[0].name).toBe('Kai');
    expect(store.scene.figures[0].color).toBe('#ff0000');
  });
});
