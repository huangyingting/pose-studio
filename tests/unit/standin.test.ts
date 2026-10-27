import { describe, expect, it } from 'vitest';
import { addStandIn, setPlacement, setPosture } from '@/lib/actions';
import { parseScene, withPosture, newFigure, newScene } from '@/lib/doc';
import { describeShot } from '@/lib/prompt';
import { Rig, facing } from '@/lib/relations';
import { Store } from '@/lib/store';
import { angle } from '../../lib/pose';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('stand-ins', () => {
  it('are added, change posture keeping their facing, and can become posable figures', () => {
    const store = new Store(new MemoryStorage());
    addStandIn(store);
    const id = store.getState().activeFigure!;
    expect(store.figure!.proxy).toBe('stand');
    setPlacement(store, id, { yaw: 90 });
    setPosture(store, id, 'lie');
    expect(store.figure!.proxy).toBe('lie');
    expect(angle(store.figure!.bones, 'hips')[0]).toBe(-90);
    expect(facing(store.figure!)).toBeCloseTo(90);
    setPosture(store, id, null);
    expect(store.figure!.proxy).toBeUndefined();
    expect(angle(store.figure!.bones, 'hips')[0]).toBe(-90);
  });

  it('round-trip through files and are named in shot descriptions', () => {
    const scene = newScene('Crowd', [newFigure(), withPosture(newFigure(), 'sit')]);
    const back = parseScene(JSON.parse(JSON.stringify(scene)));
    expect(back.figures[1].proxy).toBe('sit');
    expect(parseScene({ ...scene, figures: [{ ...scene.figures[0], proxy: 'fly' }] }).figures[0].proxy).toBeUndefined();
    expect(describeShot(back)).toContain('a stand-in');
  });

  it('build as capsules on the same skeleton and rest on the floor in every posture', () => {
    const rig = new Rig();
    const f = newFigure();
    const full = rig.model(f);
    let parts = 0;
    full.forEachPoint(() => parts++);
    const heights: Record<string, number> = {};
    for (const p of ['stand', 'sit', 'lie'] as const) {
      const m = rig.model(withPosture(f, p));
      let n = 0;
      let min = Infinity;
      m.forEachPoint((v) => { n++; min = Math.min(min, v.y); });
      expect(n).toBeLessThan(parts / 3);
      expect(min).toBeCloseTo(0, 3);
      heights[p] = m.joints.head.getWorldPosition(m.joints.head.position.clone()).y;
    }
    expect(heights.stand).toBeGreaterThan(heights.sit);
    expect(heights.sit).toBeGreaterThan(heights.lie);
    rig.dispose();
  });
});
