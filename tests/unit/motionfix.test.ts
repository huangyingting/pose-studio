import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addFigure, applyMotion, startAnimation } from '@/lib/actions';
import { putClips } from '@/lib/assets';
import { keyPose, partFromPoses } from '@/lib/clip';
import { newFigure, parseClip } from '@/lib/doc';
import { actionsOf, figurePoseAt, marksOf } from '@/lib/evaluate';
import { lookFacing, wristsToForearms } from '@/lib/motionfix';
import { angleToQuat, facingOf, quatToAngle, toQuat } from '@/lib/pose';
import { Store } from '@/lib/store';
import type { Pose } from '@/lib/types';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const motion = (slug: string) => parseClip(JSON.parse(readFileSync(`public/motions/${slug}.json`, 'utf8')))!;
const index = JSON.parse(readFileSync('public/motions/index.json', 'utf8')) as { id: string; name: string; people: number; loop?: true }[];

describe('motion capture made ready (lib/motionfix.ts)', () => {
  it("moves a wrist's roll to the forearm, the hand where it was", () => {
    const f = newFigure();
    const pose = (): Pose => ({ bones: { ...f.bones, leftLowerArm: angleToQuat('leftLowerArm', [-30, 0, 0]), leftHand: angleToQuat('leftHand', [10, 70, 0]) }, position: [0, 0.9, 0], hands: f.hands, grounded: false });
    const part = partFromPoses('Rolled', [{ t: 0, pose: pose() }, { t: 1, pose: pose() }], 'linear');
    const fixed = wristsToForearms(part);
    const q = (p: typeof part, bone: string) => { const t = p.tracks.find((x) => x.name === `${bone}.quaternion`)!; return new THREE.Quaternion().fromArray(t.values, 0); };
    // The hand's roll is now the forearm's (within its range), the hand still where it was in the world.
    expect(quatToAngle('leftHand', toQuat(q(fixed, 'leftHand')))[1]).toBeCloseTo(0, 0);
    expect(quatToAngle('leftLowerArm', toQuat(q(fixed, 'leftLowerArm')))[1]).toBeCloseTo(70, 0);
    const world = (p: typeof part) => q(p, 'leftLowerArm').multiply(q(p, 'leftHand'));
    // (Within the rounding a clip's values are kept to.)
    expect(world(fixed).angleTo(world(part))).toBeLessThan(0.01);
  });

  it('faces a clip where its person looks: a stance turned at the pelvis still walks straight ahead', () => {
    const walk = motion('walk-forward');
    // (Captured with the pelvis turned well away from the way it walks and looks.)
    expect(Math.abs(facingOf(keyPose(walk.parts[0], 0).bones))).toBeGreaterThan(20);
    expect(walk.parts[0].facing).toBe(0);
    expect(lookFacing(walk.parts[0])).toBe(0);
    putClips([walk]);
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    startAnimation(store, 4);
    expect(applyMotion(store, id, walk.id)).toBe(true);
    // Facing +Z, it walks along +Z (not off to a side), a lap's length, and is left facing as it was.
    const end = figurePoseAt(store.scene, id, walk.duration)!;
    expect(end.position[2]).toBeGreaterThan(1);
    expect(Math.abs(end.position[0])).toBeLessThan(0.15);
    const act = actionsOf(store.scene.animation!, id).find((x) => x.source.kind === 'clip')!;
    expect(Math.abs(marksOf(store.scene, act, id)!.end.facing)).toBeLessThan(5);
  });
});

describe("the Library's motion files", () => {
  it('leave out the mirrored ones and loop the cycles and idles', () => {
    const ids = index.map((m) => m.id);
    for (const gone of ['library:walk-right', 'library:strafe-right', 'library:turn-90-right', 'library:shaking-hands-1']) expect(ids).not.toContain(gone);
    const by = (name: string) => index.find((m) => m.name === name)!;
    for (const name of ['Walk', 'Walk forward', 'Run forward', 'Idle', 'Salsa dancing']) expect(by(name).loop, name).toBe(true);
    for (const name of ['Turn 90°', 'Walking turn 180', 'Standing dodge left']) expect(by(name).loop, name).toBeUndefined();
  });

});

describe('the way a capture looks at its start', () => {
  it('is square on near a quarter turn, as recorded otherwise', () => {
    const f = newFigure();
    const turned = (deg: number) => {
      const pose = (): Pose => ({ bones: { ...f.bones, hips: toQuat(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180)) }, position: [0, 0.9, 0], hands: f.hands, grounded: false });
      return partFromPoses('Look', [{ t: 0, pose: pose() }, { t: 1, pose: pose() }], 'linear');
    };
    expect(lookFacing(turned(10))).toBe(0);
    expect(lookFacing(turned(-85))).toBe(-90);
    expect(lookFacing(turned(40))).toBe(40);
  });
});
