import { describe, expect, it } from 'vitest';
import { addFigure, applyMotion, applyPose, deletePose, savePose } from '@/lib/actions';
import { samplePose } from '@/lib/animation';
import { insertMotion, withPose } from '@/lib/apply';
import { newFigure, newScene, parseLibrary } from '@/lib/doc';
import { buildMotion } from '@/lib/motions';
import { allPoses, builtInPoses } from '@/lib/poses';
import { facing, withFacing } from '@/lib/relations';
import { Store } from '@/lib/store';
import { mergeLibraries, syncBase } from '@/lib/sync';
import type { Library } from '@/lib/types';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('library assets applied to the scene', () => {
  it('a new project is one blank scene; the 20 reference poses are library assets', () => {
    const store = new Store(new MemoryStorage());
    expect(store.getState().library.scenes.map((s) => s.name)).toEqual(['Scene 1']);
    expect(builtInPoses()).toHaveLength(20);
    expect(builtInPoses()[0].name).toBe('Hand on head');
  });

  it('applies a pose to a figure where it stands and faces', () => {
    const f = withFacing({ ...newFigure(), position: [2, 0, 1] }, 90);
    const posed = withPose(f, builtInPoses()[0]);
    expect(posed.position).toEqual([2, 0, 1]);
    expect(facing(posed)).toBe(90);
    expect(posed.joints.rightUpperArm).toEqual(builtInPoses()[0].joints.rightUpperArm);
  });

  it('saves, applies and deletes my poses (one undo step each)', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    applyPose(store, id, builtInPoses()[3].id);
    const mine = savePose(store, id, 'Leaning copy')!;
    expect(allPoses(store.getState().library).at(-1)!.name).toBe('Leaning copy');
    applyPose(store, id, builtInPoses()[0].id);
    applyPose(store, id, mine.id);
    expect(store.figure!.joints.leftLowerLeg).toEqual(builtInPoses()[3].joints.leftLowerLeg);
    store.undo();
    expect(store.figure!.joints.rightUpperArm).toEqual(builtInPoses()[0].joints.rightUpperArm);
    deletePose(store, mine.id);
    expect(store.getState().library.poses).toBeUndefined();
    // Saved poses travel with the library file.
    const lib = parseLibrary({ version: 2, scenes: [newScene()], poses: [{ ...mine, joints: { leftLowerLeg: [30, 0, 0], evil: [1, 2, 3] } }] });
    expect(lib.poses![0].joints).toEqual({ leftLowerLeg: [30, 0, 0] });
  });

  it('puts a motion on one figure\'s track, from where it stands and facing its way', () => {
    const ben = withFacing({ ...newFigure({ name: 'Ben' }), position: [2, 0, 0] }, 90);
    const anna = newFigure({ name: 'Anna' });
    const walk = buildMotion('walk')!;
    const scene = insertMotion(newScene('S', [ben, anna]), ben.id, walk, 0);
    const a = scene.animation!;
    expect(a.duration).toBe(walk.animation!.duration);
    // Ben moves; Anna only has her starting key.
    expect(a.keys.filter((k) => k.poses[anna.id]).map((k) => k.t)).toEqual([0]);
    const first = samplePose(a, ben.id, 0)!;
    expect(first.position[0]).toBeCloseTo(2);
    expect(first.joints.hips![1]).toBeCloseTo(90 + (walk.figures[0].joints.hips?.[1] ?? 0) - facing(walk.figures[0]), 0);
    // A loop ends where it began: one full cycle.
    expect(a.keys.at(-1)!.t).toBeCloseTo(a.duration);
  });

  it('adds a motion at the playhead to an animated scene, lengthening it', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    expect(applyMotion(store, id, 'wave')).toBe(true);
    expect(store.scene.animation).toBeDefined();
    addFigure(store);
    const other = store.getState().activeFigure!;
    store.setTime(store.scene.animation!.duration);
    expect(applyMotion(store, other, 'jump')).toBe(true);
    expect(store.scene.animation!.duration).toBeGreaterThan(buildMotion('wave')!.animation!.duration);
    // Several people: on this figure and the other (the nearest), not on one alone.
    expect(applyMotion(store, id, 'waltz-turn')).toBe(true);
    const keyed = (f: string) => store.scene.animation!.keys.filter((k) => k.poses[f]).length;
    expect(keyed(other)).toBeGreaterThan(3);
    const solo = new Store(new MemoryStorage());
    expect(applyMotion(solo, solo.figure!.id, 'waltz-turn')).toBe(false);
    // A set-up with its own props opens as a scene instead.
    expect(applyMotion(store, id, 'high-jump')).toBe(false);
  });

  it('syncs saved poses, keeping deletions from either side', () => {
    const scene = newScene('A');
    const p = (id: string) => ({ ...builtInPoses()[0], id, name: id });
    const base: Library = { version: 2, scenes: [scene], poses: [p('kept'), p('gone-here'), p('gone-there')] };
    const server: Library = { ...base, poses: [p('kept'), p('gone-here'), p('new-there')] };
    const local: Library = { ...base, poses: [p('kept'), p('gone-there'), p('new-here')] };
    expect(mergeLibraries(server, local, syncBase(base)).poses!.map((x) => x.id)).toEqual(['kept', 'new-there', 'new-here']);
  });
});
