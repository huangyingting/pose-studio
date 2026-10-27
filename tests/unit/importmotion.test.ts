import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addFigure, applyMotion, saveMotion } from '@/lib/actions';
import { sceneAt } from '@/lib/animation';
import { parseLibrary } from '@/lib/doc';
import { readMotionFile, retargetMotion } from '@/lib/importmotion';
import { Rig } from '@/lib/relations';
import { Store } from '@/lib/store';
import { CMU, UNREAL, bvh } from '../fixtures/bvh';
import { facingOf } from '../../lib/pose';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

/** The fixture as a file's bytes. */
const file = (n: typeof CMU) => new TextEncoder().encode(bvh(n)).buffer as ArrayBuffer;

describe('importing motions from other tools', () => {
  for (const [rig, names] of [['CMU / Mixamo-style names', CMU], ['Unreal-style names', UNREAL]] as const) {
    it(`retargets a BVH with ${rig}: travel scaled to the mannequin, the thigh swing kept`, async () => {
      const asset = retargetMotion(await readMotionFile('Step_forward.bvh', file(names)));
      expect(asset.name).toBe('Step forward');
      const scene = asset.scene;
      const a = scene.animation!;
      expect(a.duration).toBeCloseTo(0.2, 3);
      expect(a.keys.length).toBeGreaterThanOrEqual(3);

      const figure = scene.figures[0];
      const model = new Rig();
      const pose = (t: number) => model.model(sceneAt(scene, t).figures[0]);
      // Standing at the start: feet on the floor, facing +Z like the source.
      const start = pose(0);
      start.object.updateMatrixWorld(true);
      expect(start.lowest()).toBeCloseTo(0, 1);
      expect(Math.abs(facingOf(figure.bones))).toBeLessThan(5);
      // 40 cm of travel on a ~92 cm hip height lands near 0.4 m on the mannequin.
      const end = sceneAt(scene, a.duration).figures[0];
      expect(end.position[2]).toBeGreaterThan(0.3);
      expect(end.position[2]).toBeLessThan(0.5);
      expect(Math.abs(end.position[0])).toBeLessThan(0.02);
      // The left foot swung forward of the right.
      const m = pose(a.duration);
      const z = (j: 'leftFoot' | 'rightFoot') => m.joints[j].getWorldPosition(new THREE.Vector3()).z;
      expect(z('leftFoot') - z('rightFoot')).toBeGreaterThan(0.2);
      model.dispose();
    });
  }

  it('keeps imported motions in the library and gives them to a figure where it stands', async () => {
    const store = new Store(new MemoryStorage());
    addFigure(store, [2, 0, -1]);
    const id = store.getState().activeFigure!;
    const at = (t: number) => sceneAt(store.scene, t).figures.find((f) => f.id === id)!;
    const motion = retargetMotion(await readMotionFile('Step forward.bvh', file(CMU)));
    saveMotion(store, motion);
    expect(parseLibrary(JSON.parse(JSON.stringify(store.getState().library))).motions?.[0].scene.animation?.keys.length).toBe(motion.scene.animation!.keys.length);
    expect(applyMotion(store, id, motion.id)).toBe(true);
    const scene = store.scene;
    const rig = new Rig();
    for (const t of [0, scene.animation!.duration]) {
      const f = at(t);
      // Starts at its place, on the floor (not sunk by the source's own hip height).
      expect(rig.model(f).lowest(), String(t)).toBeGreaterThan(-0.03);
      expect(rig.model(f).lowest(), String(t)).toBeLessThan(0.06);
    }
    expect(at(0).position[0]).toBeCloseTo(2, 2);
    expect(at(scene.animation!.duration).position[2]).toBeGreaterThan(-0.75);
    rig.dispose();
  });

  it('says which bones it could not find, and refuses files without a skeleton', async () => {
    const text = new TextEncoder().encode('HIERARCHY\nROOT Thing\n{\nOFFSET 0 0 0\nCHANNELS 3 Xposition Yposition Zposition\nEnd Site\n{\nOFFSET 0 1 0\n}\n}\nMOTION\nFrames: 1\nFrame Time: 0.1\n0 0 0\n').buffer as ArrayBuffer;
    await expect(async () => retargetMotion(await readMotionFile('x.bvh', text))).rejects.toThrow(/Could not find/);
    await expect(readMotionFile('x.txt', text)).rejects.toThrow(/BVH, FBX/);
  });
});
