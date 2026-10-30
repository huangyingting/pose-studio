import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addFigure, addProp, moveProp, sitOn, sittingAt, standUp } from '@/lib/actions';
import { putClips } from '@/lib/assets';
import { parseClip } from '@/lib/doc';
import { figurePoseAt } from '@/lib/evaluate';
import * as THREE from 'three';
import { Rig, facing } from '@/lib/relations';
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

putClips(['idle', 'stand-to-sit', 'sitting-idle', 'sit-to-stand'].map((n) => parseClip(JSON.parse(readFileSync(`public/motions/${n}.json`, 'utf8')))!));

const hipsAt = (store: Store, id: string, t: number) => {
  const f = figurePoseAt(store.scene, id, t)!;
  return { x: f.position[0], z: f.position[2], facing: facing(f) };
};

describe('sitting on a chair or a stool (#14)', () => {
  it('walks to the chair, turns its back to it, sits down on it and gets up again', () => {
    const store = new Store(new MemoryStorage());
    addFigure(store, [0, 0, 0]);
    const a = store.getState().activeFigure!;
    addProp(store, 'chair', [2, 0, 3]);
    const chair = store.scene.props[0].id;
    moveProp(store, chair, { rotation: [0, 90, 0] });
    store.setTime(0);
    expect(sitOn(store, a, chair)).toBe(true);
    // Sat down, on the seat (a little forward of its middle), facing the way the chair does.
    const t = store.getState().time;
    expect(sittingAt(store.scene, a, t + 0.5)).toBe(true);
    const sat = hipsAt(store, a, t + 0.5);
    expect(Math.hypot(sat.x - 2.1, sat.z - 3)).toBeLessThan(0.15);
    expect(Math.abs(sat.facing - 90)).toBeLessThan(10);
    const hips = new Rig().model(figurePoseAt(store.scene, a, t + 0.5)!).joints.hips.getWorldPosition(new THREE.Vector3());
    // (On the seat's top, 0.49 m up: not floating above it, not through it.)
    expect(hips.y).toBeGreaterThan(0.55);
    expect(hips.y).toBeLessThan(0.7);
    // Up again, a step in front of it.
    store.setTime(t + 2);
    expect(standUp(store, a)).toBe(true);
    const up = store.getState().time;
    expect(sittingAt(store.scene, a, up + 0.1)).toBe(false);
    const stood = hipsAt(store, a, up + 0.1);
    expect(stood.x).toBeGreaterThan(2.3);
    // (Up for good: no sitting on after it.)
    expect(sittingAt(store.scene, a, store.scene.animation!.duration - 0.05)).toBe(false);
    // Got up straight after sitting down: the same.
    store.undo();
    store.setTime(t);
    expect(standUp(store, a)).toBe(true);
    expect(sittingAt(store.scene, a, store.scene.animation!.duration - 0.05)).toBe(false);
  });

  it('sits on a stool with its back to it from where it comes', () => {
    const store = new Store(new MemoryStorage());
    addFigure(store, [0, 0, 0]);
    const a = store.getState().activeFigure!;
    addProp(store, 'stool', [0, 0, 3]);
    store.setTime(0);
    expect(sitOn(store, a, store.scene.props[0].id)).toBe(true);
    const sat = hipsAt(store, a, store.getState().time + 0.5);
    expect(Math.hypot(sat.x, sat.z - 2.9)).toBeLessThan(0.15);
    expect(Math.abs(Math.abs(sat.facing) - 180)).toBeLessThan(10);
  });
});
