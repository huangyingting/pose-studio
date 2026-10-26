import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addFigure, applyMotion, saveMotion } from '@/lib/actions';
import { sceneAt } from '@/lib/animation';
import { parseLibrary } from '@/lib/doc';
import { readMotionFile, retargetMotion } from '@/lib/importmotion';
import { Rig } from '@/lib/relations';
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

/** Names for one skeleton in two rigs' conventions. */
const CMU = {
  hips: 'Hips', spine: 'Spine', neck: 'Neck', head: 'Head',
  upLeg: (s: string) => `${s}UpLeg`, leg: (s: string) => `${s}Leg`, foot: (s: string) => `${s}Foot`, toe: (s: string) => `${s}ToeBase`,
  clav: (s: string) => `${s}Shoulder`, arm: (s: string) => `${s}Arm`, fore: (s: string) => `${s}ForeArm`, hand: (s: string) => `${s}Hand`,
  side: { L: 'Left', R: 'Right' },
};
const UNREAL = {
  hips: 'pelvis', spine: 'spine_01', neck: 'neck_01', head: 'head',
  upLeg: (s: string) => `thigh_${s}`, leg: (s: string) => `calf_${s}`, foot: (s: string) => `foot_${s}`, toe: (s: string) => `ball_${s}`,
  clav: (s: string) => `clavicle_${s}`, arm: (s: string) => `upperarm_${s}`, fore: (s: string) => `lowerarm_${s}`, hand: (s: string) => `hand_${s}`,
  side: { L: 'l', R: 'r' },
};

/**
 * A T-posed skeleton in centimetres facing +Z, three frames 0.1 s apart: standing, then stepping
 * forward with the left thigh swung forward, the hips 40 cm ahead.
 */
function bvh(n: typeof CMU) {
  const joint = (name: string, offset: string, inner: string) => `JOINT ${name}\n{\nOFFSET ${offset}\nCHANNELS 3 Zrotation Xrotation Yrotation\n${inner}}\n`;
  const end = (offset: string) => `End Site\n{\nOFFSET ${offset}\n}\n`;
  const leg = (s: 'L' | 'R', x: number) =>
    joint(n.upLeg(n.side[s]), `${x} -5 0`, joint(n.leg(n.side[s]), '0 -42 0', joint(n.foot(n.side[s]), '0 -42 0', joint(n.toe(n.side[s]), '0 -8 12', end('0 0 5')))));
  const arm = (s: 'L' | 'R', x: number) =>
    joint(n.clav(n.side[s]), `${x * 3} 0 0`, joint(n.arm(n.side[s]), `${x * 14} 0 0`, joint(n.fore(n.side[s]), `${x * 28} 0 0`, joint(n.hand(n.side[s]), `${x * 25} 0 0`, end(`${x * 15} 0 0`)))));
  const hierarchy = `HIERARCHY\nROOT ${n.hips}\n{\nOFFSET 0 0 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation\n${leg('L', 9)}${leg('R', -9)}${joint(n.spine, '0 10 0', joint(n.neck, '0 45 0', joint(n.head, '0 10 0', end('0 18 0')) + arm('L', 1) + arm('R', -1)))}}\n`;
  // Channels: hips (6), then per joint 3, in hierarchy order.
  const order = hierarchy.match(/(ROOT|JOINT) \S+/g)!.map((s) => s.split(' ')[1]);
  const frame = (hips: number[], turns: Record<string, number[]>) =>
    [...hips, 0, 0, 0, ...order.slice(1).flatMap((j) => turns[j] ?? [0, 0, 0])].join(' ');
  const swing = { [n.upLeg(n.side.L)]: [0, -40, 0], [n.leg(n.side.L)]: [0, 20, 0], [n.arm(n.side.R)]: [0, 0, 0] };
  const motion = ['MOTION', 'Frames: 3', 'Frame Time: 0.1',
    frame([0, 92, 0], {}), frame([0, 90, 20], swing), frame([0, 92, 40], swing)].join('\n');
  return new TextEncoder().encode(`${hierarchy}${motion}\n`).buffer as ArrayBuffer;
}

describe('importing motions from other tools', () => {
  for (const [rig, names] of [['CMU / Mixamo-style names', CMU], ['Unreal-style names', UNREAL]] as const) {
    it(`retargets a BVH with ${rig}: travel scaled to the mannequin, the thigh swing kept`, async () => {
      const asset = retargetMotion(await readMotionFile('Step_forward.bvh', bvh(names)));
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
      expect(Math.abs(figure.joints.root?.[1] ?? 0)).toBeLessThan(5);
      // 40 cm of travel on a ~92 cm hip height lands near 0.4 m on the mannequin.
      const end = sceneAt(scene, a.duration).figures[0];
      expect(end.position[2]).toBeGreaterThan(0.3);
      expect(end.position[2]).toBeLessThan(0.5);
      expect(Math.abs(end.position[0])).toBeLessThan(0.02);
      // The left foot swung forward of the right.
      const m = pose(a.duration);
      const z = (j: 'ankleL' | 'ankleR') => m.joints[j].getWorldPosition(new THREE.Vector3()).z;
      expect(z('ankleL') - z('ankleR')).toBeGreaterThan(0.2);
      model.dispose();
    });
  }

  it('keeps imported motions in the library and gives them to a figure where it stands', async () => {
    const store = new Store(new MemoryStorage());
    addFigure(store, [2, 0, -1]);
    const id = store.getState().activeFigure!;
    const at = (t: number) => sceneAt(store.scene, t).figures.find((f) => f.id === id)!;
    const motion = retargetMotion(await readMotionFile('Step forward.bvh', bvh(CMU)));
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
