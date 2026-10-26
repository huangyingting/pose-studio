import { describe, expect, it } from 'vitest';
import { newAnimation, setKey } from '@/lib/animation';
import { newFigure, newScene } from '@/lib/doc';
import { presetScenes } from '@/lib/presets';
import { canonical, mergeLibraries, sceneHash, syncBase } from '@/lib/sync';
import type { Library, Scene } from '@/lib/types';

const lib = (scenes: Scene[], board?: Library['board']): Library => ({ version: 2, scenes, ...(board ? { board } : {}) });
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

  it('applies deletions from either side, unless the other side edited the pose', () => {
    // Deleted here (B), deleted there (C): both go. Deleted there but edited here (A): kept.
    const server = lib([b]);
    const local = lib([renamed(a, 'A edited'), c]);
    expect(named(mergeLibraries(server, local, base))).toEqual(['A edited']);
  });

  it('merges a first sync without duplicating the same poses', () => {
    // Built-in poses: same ids on every device, whatever order their keys were written in.
    const server = canonical(JSON.parse(JSON.stringify(lib(presetScenes()))));
    for (const s of server.scenes) for (const f of s.figures) f.joints = Object.fromEntries(Object.entries(f.joints).reverse());
    const mine = newScene('Made offline');
    const sameElsewhere = { ...newScene('Twin'), id: 'other-id' };
    const twin = { ...sameElsewhere, id: 'twin-here', figures: sameElsewhere.figures.map((f) => ({ ...f, id: 'f-here' })) };
    const merged = mergeLibraries(lib([...server.scenes, sameElsewhere]), lib([...presetScenes(), mine, twin]), null);
    expect(merged.scenes).toHaveLength(22);
    expect(named(merged).slice(-2)).toEqual(['Twin', 'Made offline']);
  });

  it('ignores where the playhead is in an animated pose', () => {
    const s = newScene('Anim', [newFigure()]);
    const f = s.figures[0];
    const anim: Scene = { ...s, animation: setKey(newAnimation(s, 2), 1, [{ ...f, joints: { ...f.joints, kneeL: [60, 0, 0] as [number, number, number] } }]) };
    const atHalf: Scene = { ...anim, figures: [{ ...f, joints: { ...f.joints, kneeL: [30, 0, 0] as [number, number, number] } }] };
    expect(sceneHash(canonical(lib([anim])).scenes[0])).toBe(sceneHash(canonical(lib([atHalf])).scenes[0]));
  });

  it('merges storyboards and drops panels of poses that are gone', () => {
    const p1 = { id: 'p1', sceneId: a.id, hold: 2 };
    const p2 = { id: 'p2', sceneId: b.id, hold: 2 };
    const p3 = { id: 'p3', sceneId: c.id, hold: 2 };
    const start = lib([a, b, c], [p1]);
    const merged = mergeLibraries(lib([a, b], [p1, p2]), lib([a, b, c], [p1, p3]), syncBase(start));
    expect(merged.board?.map((p) => p.id)).toEqual(['p1', 'p2']);
    // Only this device changed the board: its board wins.
    expect(mergeLibraries(lib([a, b, c], [p1]), lib([a, b, c], [p3, p1]), syncBase(start)).board?.map((p) => p.id)).toEqual(['p3', 'p1']);
  });
});
