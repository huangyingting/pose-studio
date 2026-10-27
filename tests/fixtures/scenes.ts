import * as THREE from 'three';
import { expect } from 'vitest';
import { frameTimes } from '@/lib/animation';
import { sceneAt } from '@/lib/evaluate';
import { BODY_PRESETS } from '@/lib/body';
import { handPosition, worldOfProp } from '@/lib/propmotion';
import { checkMotion } from '@/lib/qa';
import { SceneView } from '@/lib/sceneview';
import { Store } from '@/lib/store';
import type { Scene } from '@/lib/types';

/*
 * Scenes made the way a user makes them, for the use case of filming several people moving
 * together, and what a viewer would notice in them.
 */

export const body = (name: string) => ({ ...BODY_PRESETS.find((p) => p.name === name)!.body });

export class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

export const fresh = () => {
  const store = new Store(new MemoryStorage());
  return { store, a: store.figure!.id };
};

export const figureAt = (scene: Scene) => (id: string, t: number) => sceneAt(scene, t).figures.find((f) => f.id === id) ?? null;

/** What a viewer would notice, frame by frame. */
export function audit(scene: Scene) {
  const sv = new SceneView();
  const at = figureAt(scene);
  let lowest = 0;
  let handGap = 0;
  let rootStep = 0;
  const last = new Map<string, THREE.Vector3>();
  for (const t of frameTimes(scene.animation!)) {
    const s = sceneAt(scene, t);
    sv.sync(s);
    for (const f of s.figures) {
      const m = sv.figures.get(f.id)!;
      lowest = Math.min(lowest, m.lowest());
      const root = m.joints.hips.getWorldPosition(new THREE.Vector3());
      const prev = last.get(f.id);
      if (prev) rootStep = Math.max(rootStep, prev.distanceTo(root));
      last.set(f.id, root);
    }
    for (const p of s.props) {
      if (!p.hold) continue;
      const w = worldOfProp(scene, p.id, at, t)!.position;
      const h = handPosition(at(p.hold.figure, t)!, p.hold.hand, s.props);
      handGap = Math.max(handGap, Math.hypot(w[0] - h[0], w[1] - h[1], w[2] - h[2]));
    }
  }
  sv.dispose();
  return { issues: checkMotion(scene).map((i) => i.message), lowest, handGap, rootStep };
}

/** Clean: no issues, on or above the floor, props in the hand (a ball's centre sits a palm away), no frame-to-frame jumps beyond a sprint. */
export function expectClean(scene: Scene) {
  const r = audit(scene);
  expect(r.issues).toEqual([]);
  expect(r.lowest).toBeGreaterThan(-0.01);
  expect(r.handGap).toBeLessThan(0.25);
  expect(r.rootStep).toBeLessThan(0.25);
  return r;
}
