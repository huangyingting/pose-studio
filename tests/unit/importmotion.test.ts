import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addFigure, applyMotion, saveMotion } from '@/lib/actions';
import { sceneAt } from '@/lib/evaluate';
import { parseLibrary } from '@/lib/doc';
import { importMotion, readMotionFile, retargetMotion } from '@/lib/importmotion';
import { Rig } from '@/lib/relations';
import { Store } from '@/lib/store';
import { CMU, UNREAL, bvh } from '../fixtures/bvh';
import { facingOf } from '../../lib/pose';
import { clipById, clipScene, putClips } from '@/lib/assets';
import { clipInfo, keyTimes } from '@/lib/clip';

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
const file = (n: typeof CMU, o?: { setUp?: boolean }) => new TextEncoder().encode(bvh(n, o)).buffer as ArrayBuffer;

describe('importing motions from other tools', () => {
  for (const [rig, names] of [['CMU / Mixamo-style names', CMU], ['Unreal-style names', UNREAL]] as const) {
    it(`retargets a BVH with ${rig}: travel scaled to the mannequin, the thigh swing kept`, async () => {
      const clip = retargetMotion(await readMotionFile('Step_forward.bvh', file(names)));
      expect(clip.name).toBe('Step forward');
      expect(clip.duration).toBeCloseTo(0.2, 3);
      expect(keyTimes(clip.parts[0]).length).toBeGreaterThanOrEqual(3);
      putClips([clip]);
      const scene = clipScene(clip);
      const a = scene.animation!;

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

  it('leaves out a T-pose put first for retargeting (the CMU library\'s BVH release): the motion starts after it, its feet on the floor', async () => {
    const clip = retargetMotion(await readMotionFile('Stand_up.bvh', file(CMU, { setUp: true })));
    expect(clip.duration).toBeCloseTo(0.2, 3);
    putClips([clip]);
    const scene = clipScene(clip);
    const model = new Rig();
    const m = model.model(sceneAt(scene, 0).figures[0]);
    m.object.updateMatrixWorld(true);
    const at = (j: 'hips' | 'leftHand' | 'leftUpperArm') => m.joints[j].getWorldPosition(new THREE.Vector3());
    // Crouched with the arms down from the start (not the T-pose), the feet on the floor (not
    // lifted off it by the T-pose's straight legs, lower than the motion's ever are).
    expect(at('leftHand').y).toBeLessThan(at('leftUpperArm').y - 0.3);
    expect(m.lowest()).toBeCloseTo(0, 1);
    const crouched = at('hips').y;
    const standing = model.model(sceneAt(scene, clip.duration).figures[0]);
    expect(standing.joints.hips.getWorldPosition(new THREE.Vector3()).y - crouched).toBeGreaterThan(0.1);
    model.dispose();
  });

  it('keeps imported motions in the library and gives them to a figure where it stands', async () => {
    const store = new Store(new MemoryStorage());
    addFigure(store, [2, 0, -1]);
    const id = store.getState().activeFigure!;
    const at = (t: number) => sceneAt(store.scene, t).figures.find((f) => f.id === id)!;
    const motion = retargetMotion(await readMotionFile('Step forward.bvh', file(CMU)));
    saveMotion(store, motion);
    // Listed in the library; its frames kept apart.
    expect(parseLibrary(JSON.parse(JSON.stringify(store.getState().library))).clips).toEqual([clipInfo(motion)]);
    expect(clipById(motion.id)).toBe(motion);
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

  it('imports a Pose Studio motion file as it was saved, under a new id', async () => {
    const clip = retargetMotion(await readMotionFile('Step_forward.bvh', file(CMU)));
    const bytes = new TextEncoder().encode(JSON.stringify(clip)).buffer as ArrayBuffer;
    const back = await importMotion('Step_forward.clip.json', bytes);
    expect(back.id).not.toBe(clip.id);
    expect({ ...back, id: clip.id }).toEqual(clip);
    const other = new TextEncoder().encode('{"parts":[]}').buffer as ArrayBuffer;
    await expect(importMotion('x.json', other)).rejects.toThrow(/Pose Studio motion/);
  });
});
