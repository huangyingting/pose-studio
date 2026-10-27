import { describe, expect, it } from 'vitest';
import { motionScene } from '../fixtures/scenes';
import { addFigure, applyMotion, applyPose, deletePose, saveMotion, savePose } from '@/lib/actions';
import { BUILT_IN, clipById } from '@/lib/assets';
import { keysClip } from '@/lib/clip';
import { clipsIn, newFigure, newScene, parseLibrary } from '@/lib/doc';
import { actionsOf, figurePoseAt } from '@/lib/evaluate';
import { allPoses, builtInPoses, withPose } from '@/lib/poses';
import { insertClip } from '@/lib/track';
import { facing, withFacing } from '@/lib/relations';
import { Store } from '@/lib/store';
import { mergeLibraries, syncBase } from '@/lib/sync';
import type { Library } from '@/lib/types';
import { angle, fromQuat, toQuat } from '@/lib/pose';

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
    expect(angle(posed.bones, 'rightUpperArm')).toEqual(angle(builtInPoses()[0].bones, 'rightUpperArm'));
  });

  it('saves, applies and deletes my poses (one undo step each)', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    applyPose(store, id, builtInPoses()[3].id);
    const mine = savePose(store, id, 'Leaning copy')!;
    expect(allPoses(store.getState().library).at(-1)!.name).toBe('Leaning copy');
    applyPose(store, id, builtInPoses()[0].id);
    applyPose(store, id, mine.id);
    expect(store.figure!.bones.leftLowerLeg).toEqual(builtInPoses()[3].bones.leftLowerLeg);
    store.undo();
    expect(store.figure!.bones.rightUpperArm).toEqual(builtInPoses()[0].bones.rightUpperArm);
    deletePose(store, mine.id);
    expect(store.getState().library.poses).toBeUndefined();
    // Saved poses travel with the library file.
    const lib = parseLibrary({ version: 2, scenes: [newScene()], poses: [{ ...mine, bones: { leftLowerLeg: [0.5, 0, 0, 1], evil: [0, 0, 0, 1] } }] });
    expect(lib.poses![0].bones).toEqual({ leftLowerLeg: toQuat(fromQuat([0.5, 0, 0, 1]).normalize()) });
  });

  it('puts a motion on one figure\'s track, from where it stands and facing its way', () => {
    const ben = withFacing({ ...newFigure({ name: 'Ben' }), position: [2, 0, 0] }, 90);
    const anna = newFigure({ name: 'Anna' });
    const wave = clipById(BUILT_IN + 'wave')!;
    const scene = insertClip(newScene('S', [ben, anna]), [ben.id], wave.id, 0);
    const a = scene.animation!;
    expect(a.duration).toBe(wave.duration);
    // Ben waves; Anna only holds her pose.
    expect(actionsOf(a, anna.id).map((x) => x.source.kind)).toEqual(['keys']);
    expect(actionsOf(a, ben.id).map((x) => x.source.kind)).toEqual(['keys', 'clip']);
    const first = figurePoseAt(scene, ben.id, 0)!;
    expect(first.position[0]).toBeCloseTo(2);
    expect(facing(first)).toBeCloseTo(90, 0);
    // A loop: one full cycle.
    expect(actionsOf(a, ben.id)[1].duration).toBeCloseTo(a.duration);
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
    expect(store.scene.animation!.duration).toBeGreaterThan(motionScene('wave').animation!.duration);
    // Several people: on this figure and the other (the nearest), not on one alone.
    expect(applyMotion(store, id, 'waltz-turn')).toBe(true);
    const together = actionsOf(store.scene.animation!, other).find((x) => x.source.kind === 'clip' && x.source.clip === BUILT_IN + 'waltz-turn');
    expect(together?.roles.map((r) => r.figure)).toEqual([id, other]);
    const solo = new Store(new MemoryStorage());
    expect(applyMotion(solo, solo.figure!.id, 'waltz-turn')).toBe(false);
    // A set-up with its own props opens as a scene instead.
    expect(applyMotion(store, id, 'high-jump')).toBe(false);
  });

  it('syncs saved poses, keeping deletions from either side', () => {
    const scene = newScene('A');
    const p = (id: string) => ({ ...builtInPoses()[0], id, name: id });
    const base: Library = { version: 3, scenes: [scene], poses: [p('kept'), p('gone-here'), p('gone-there')] };
    const server: Library = { ...base, poses: [p('kept'), p('gone-here'), p('new-there')] };
    const local: Library = { ...base, poses: [p('kept'), p('gone-there'), p('new-here')] };
    expect(mergeLibraries(server, local, syncBase(base)).poses!.map((x) => x.id)).toEqual(['kept', 'new-there', 'new-here']);
  });

  it('keeps imported clips apart from the library: fifty long ones list in a few kilobytes and play', async () => {
    const storage = new MemoryStorage();
    const store = new Store(storage);
    const f = store.figure!;
    // Fifty clips of a minute at 30 frames a second (the hips swaying): megabytes of frames.
    const clips = Array.from({ length: 50 }, (_, n) => ({
      ...keysClip(Array.from({ length: 1800 }, (_, i) => ({ t: i / 30, pose: { ...f, position: [Math.sin(i / 10 + n) * 0.1, f.position[1], 0] as [number, number, number] } }))),
      name: `Take ${n + 1}`,
    }));
    for (const c of clips) saveMotion(store, c);
    store.save();
    const saved = storage.getItem(Store.LIBRARY_KEY)!;
    expect(saved.length).toBeLessThan(20_000);
    expect(JSON.stringify(clips).length).toBeGreaterThan(5_000_000);
    expect(store.getState().library.clips!.map((c) => c.name)).toEqual(clips.map((c) => c.name));
    // Played from the library on a figure.
    expect(applyMotion(store, f.id, clips[49].id)).toBe(true);
    store.setTime(1);
    // (from where the figure stands: the way the hips go in the clip, from its first frame)
    expect(figurePoseAt(store.scene, f.id, 1)!.position[0]).toBeCloseTo(f.position[0] + (Math.sin(30 / 10 + 49) - Math.sin(49)) * 0.1, 2);
    // Opened again (another session): listed, and brought back from where they are kept.
    const again = new Store(storage);
    expect(await again.loadClips()).toEqual([]);
    expect(clipById(clips[3].id)?.parts[0].tracks.length).toBeGreaterThan(0);
  }, 60_000);

  it('reads a saved library file with its clips\' frames: listed in the library, the frames apart', () => {
    const f = newFigure();
    const clip = { ...keysClip([{ t: 0, pose: f }, { t: 1, pose: { ...f, position: [1, f.position[1], 0] as [number, number, number] } }]), id: 'a-clip', name: 'Mine' };
    const data = { version: 3, scenes: [newScene('A')], clips: [clip] };
    expect(parseLibrary(data).clips).toEqual([{ id: 'a-clip', name: 'Mine', duration: 1, loop: false, people: ['Keys'] }]);
    expect(clipsIn(data).map((c) => c.id)).toEqual(['a-clip']);
  });
});
