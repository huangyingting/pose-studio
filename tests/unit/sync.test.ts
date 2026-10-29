import { describe, expect, it } from 'vitest';
import { newAnimation } from '@/lib/animation';
import { newFigure, newScene } from '@/lib/doc';
import { builtInPoses, poseScene } from '@/lib/poses';

/** The 20 reference poses as scenes. */
const refScenes = () => builtInPoses().map((p) => poseScene(p));
import { canonical, mergeLibraries, sceneHash, syncBase } from '@/lib/sync';
import type { Library, Scene } from '@/lib/types';
import { withAngles } from '../../lib/pose';
import { setPoseAt } from '@/lib/track';

const lib = (scenes: Scene[]): Library => ({ version: 3, scenes });
const named = (l: Library) => l.scenes.map((s) => s.name);
const renamed = (s: Scene, name: string): Scene => ({ ...s, name });

describe('library sync merge', () => {
  const [a, b, c] = [newScene('A'), newScene('B'), newScene('C')];
  const base = syncBase(lib([a, b, c]));

  it('takes whichever side changed a pose, and keeps both when both did', () => {
    const server = lib([renamed(a, 'A server'), b, renamed(c, 'C server')]);
    const local = lib([a, renamed(b, 'B local'), renamed(c, 'C local')]);
    expect(named(mergeLibraries(server, local, base))).toEqual(['A server', 'B local', 'C server', 'C local (this device)']);
  });

  it('merges the project settings: this device\'s if only it changed them, else the account\'s', () => {
    const tall = { frame: '9:16' as const, style: 'ink' as const };
    const wide = { frame: '2.39:1' as const, style: 'line' as const };
    expect(mergeLibraries(lib([a, b, c]), { ...lib([a, b, c]), settings: tall }, base).settings).toEqual(tall);
    expect(mergeLibraries({ ...lib([a, b, c]), settings: wide }, { ...lib([a, b, c]), settings: tall }, base).settings).toEqual(wide);
    const agreed = syncBase({ ...lib([a, b, c]), settings: tall });
    expect(mergeLibraries({ ...lib([a, b, c]), settings: wide }, { ...lib([a, b, c]), settings: tall }, agreed).settings).toEqual(wide);
  });

  it('keeps shoot presets from both sides, except one deleted since they agreed', () => {
    const talk = { id: 'p1', name: 'Talk', template: 'conversation', coverage: 'dialogue' };
    const dance = { id: 'p2', name: 'Dance', template: 'waltz', coverage: 'follow' };
    const merged = mergeLibraries({ ...lib([a, b, c]), shoots: [talk] }, { ...lib([a, b, c]), shoots: [dance] }, base);
    expect(merged.shoots?.map((p) => p.name)).toEqual(['Talk', 'Dance']);
    const agreed = syncBase({ ...lib([a, b, c]), shoots: [talk, dance] });
    expect(mergeLibraries({ ...lib([a, b, c]), shoots: [talk, dance] }, { ...lib([a, b, c]), shoots: [talk] }, agreed).shoots?.map((p) => p.name)).toEqual(['Talk']);
  });

  it('applies deletions from either side, unless the other side edited the pose', () => {
    // Deleted here (B), deleted there (C): both go. Deleted there but edited here (A): kept.
    const server = lib([b]);
    const local = lib([renamed(a, 'A edited'), c]);
    expect(named(mergeLibraries(server, local, base))).toEqual(['A edited']);
  });

  it('a new device\'s untouched project adds nothing to the account', () => {
    const account = lib(refScenes().slice(0, 3));
    expect(mergeLibraries(account, lib([newScene('Scene 1')]), null)).toBe(account);
    // Anything done on the device before the first sync is kept.
    const mine = newScene('Made offline');
    expect(named(mergeLibraries(account, lib([newScene('Scene 1'), mine]), null)).slice(-2)).toEqual(['Scene 1', 'Made offline']);
  });

  it('ignores where the playhead is in an animated pose', () => {
    const s = newScene('Anim', [newFigure()]);
    const f = s.figures[0];
    const anim: Scene = { ...s, animation: setPoseAt({ ...s, animation: newAnimation(s, 2) }, f.id, 1, { ...f, bones: withAngles(f.bones, { leftLowerLeg: [60, 0, 0] }) }) };
    const atHalf: Scene = { ...anim, figures: [{ ...f, bones: withAngles(f.bones, { leftLowerLeg: [30, 0, 0] }) }] };
    expect(sceneHash(canonical(lib([anim])).scenes[0])).toBe(sceneHash(canonical(lib([atHalf])).scenes[0]));
  });

  it('keeps the scenes\' order (the story\'s): this device\'s if only it reordered them', () => {
    const start = lib([a, b, c]);
    expect(named(mergeLibraries(lib([a, b, c]), lib([c, a, b]), syncBase(start)))).toEqual(named(lib([c, a, b])));
    // Both reordered: the account's.
    expect(named(mergeLibraries(lib([b, a, c]), lib([c, a, b]), syncBase(start)))).toEqual(named(lib([b, a, c])));
  });
});
