import { describe, expect, it } from 'vitest';
import { addFigure, addProp, arrange, coverScene, deleteTemplate, newShoot, placeTemplate, saveAsShoot, saveShoot, saveTemplate, sceneFromTemplate, startAnimation, travelTo } from '@/lib/actions';
import { parseLibrary } from '@/lib/doc';
import { actionsOf, figurePoseAt } from '@/lib/evaluate';
import { facingOf } from '@/lib/pose';
import { checkMotion, checkShots } from '@/lib/qa';
import { facing, withFacing } from '@/lib/relations';
import { setById } from '@/lib/sets';
import { shotSpans } from '@/lib/shots';
import { Store } from '@/lib/store';
import { SCENE_TEMPLATES, SHOOT_PRESETS, TEMPLATE_GROUPS, shootsOf } from '@/lib/templates';
import { MemoryStorage, fresh } from '../fixtures/scenes';

const apart = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[2] - q[2]);

describe('scene templates: what is filmed, without how', () => {
  it('builds every template: a cast, a set and what they do, seen by one plain camera', () => {
    expect(new Set(SCENE_TEMPLATES.map((t) => t.group))).toEqual(new Set(TEMPLATE_GROUPS));
    for (const t of SCENE_TEMPLATES) {
      const s = t.build();
      expect(s.figures, t.id).toHaveLength(t.people);
      expect(s.cameras.map((c) => c.made ?? c.kind), t.id).toEqual(['rig']);
      expect(s.coverage, t.id).toBeUndefined();
      if (s.animation) expect(s.animation.shots.map((x) => x.camera), t.id).toEqual([s.cameras[0].id]);
      // (Lit for its set: indoors in an indoor one, its own lamps and windows with it, #17.)
      if (s.set) expect(!!s.lighting?.environment?.indoors, t.id).toBe(setById(s.set)!.indoors);
      if (s.set) expect(s.lighting!.lights.filter((l) => l.ofSet).map((l) => l.name), t.id).toEqual(setById(s.set)!.lights?.map((l) => l.name) ?? []);
    }
    expect(checkMotion(SCENE_TEMPLATES.find((t) => t.id === 'high-jump')!.build()).filter((i) => i.kind !== 'camera')).toEqual([]);
  }, 60_000);

  it('saves any scene as a template, without its cameras, around the stage origin', () => {
    const { store, a } = fresh();
    addFigure(store, [4, 0, 2]);
    const b = store.getState().activeFigure!;
    store.updateFigure(a, (f) => ({ ...f, position: [2, 0, 2] }));
    arrange(store, a, b, 'faceEachOther');
    addProp(store, 'chair', [3, 0, 3]);
    startAnimation(store, 6);
    store.select({ kind: 'figure', figure: a });
    coverScene(store, 'dialogue');
    const t = saveTemplate(store, 'Interview');
    expect([t.scene.cameras, t.scene.animation!.shots, t.scene.coverage]).toEqual([[], [], undefined]);
    expect(t.scene.figures.map((f) => f.position[0])).toEqual([-1, 1]);
    expect(t.scene.props[0].position).toEqual([0, 0, 1]);
    // Kept in the library (and read back as it was); it opens as a new scene, with new ids.
    const lib = store.getState().library;
    expect(parseLibrary(JSON.parse(JSON.stringify(lib))).templates).toEqual(lib.templates);
    expect(sceneFromTemplate(store, t.id)).toBe(true);
    expect(store.scene.name).toBe('Interview');
    expect(store.scene.figures.map((f) => f.id)).not.toContain(a);
    expect(store.scene.figures.map((f) => f.position[0])).toEqual([-1, 1]);
    // Given the default camera, filming its one shot.
    expect(store.scene.cameras).toHaveLength(1);
    expect(store.scene.animation!.shots.map((x) => x.camera)).toEqual([store.scene.cameras[0].id]);
  });

  it('goes into the open scene: its first role on the selected figure, where it stands, facing its way', () => {
    const { store, a } = fresh();
    store.updateFigure(a, (f) => withFacing({ ...f, position: [3, 0, 2] }, 90));
    const template = SCENE_TEMPLATES.find((t) => t.id === 'handshake')!.build();
    const gap = apart(template.figures[0].position, template.figures[1].position);
    store.select({ kind: 'figure', figure: a });
    const cast = placeTemplate(store, 'handshake')!;
    expect(cast[0]).toBe(a);
    const [fa, fb] = cast.map((id) => store.scene.figures.find((f) => f.id === id)!);
    expect(store.scene.figures).toHaveLength(2);
    expect(fa.position[0]).toBeCloseTo(3, 3);
    expect(apart(fa.position, fb.position)).toBeCloseTo(gap, 2);
    // Turned to the lead's way (facing +X): the other in front of it, the two facing each other.
    expect(facing(fa)).toBeCloseTo(90, 0);
    expect(fb.position[0] - fa.position[0]).toBeGreaterThan(gap * 0.8);
    expect(Math.abs(((facing(fa) - facing(fb) + 540) % 360) - 180)).toBeGreaterThan(150);
  });

  it('plays a template of several people from the playhead on the figures cast, after what they did before', () => {
    const { store, a } = fresh();
    addFigure(store, [1, 0, 0]);
    const b = store.getState().activeFigure!;
    store.select({ kind: 'figure', figure: a });
    store.setTime(0);
    const walk = travelTo(store, a, [0, 2], 'walk')!;
    store.setTime(walk.to);
    const cast = placeTemplate(store, 'film-wuxia')!;
    expect(cast).toEqual([a, b]);
    const anim = store.scene.animation!;
    // Each figure keyed from the playhead, after what it did before (the walk).
    const keyed = [a, b].map((id) => actionsOf(anim, id).filter((x) => x.source.kind === 'keys' && x.start >= walk.to - 1e-6));
    expect(keyed.map((k) => k.length > 0)).toEqual([true, true]);
    expect(Math.min(...keyed.flat().map((x) => x.start))).toBeCloseTo(walk.to, 3);
    expect(actionsOf(anim, a).some((x) => x.source.kind === 'travel')).toBe(true);
    expect(anim.duration).toBeGreaterThan(walk.to + 2);
    // The lead starts the duel where its walk ended, facing the way it walked.
    expect(apart(figurePoseAt(store.scene, a, walk.to + 0.05)!.position, [0, 0, 2])).toBeLessThan(0.3);
    expect(facingOf(figurePoseAt(store.scene, a, walk.to)!.bones)).toBeCloseTo(0, -1);
  });

  it('opens each shoot preset as a scene filmed with its coverage, clean', () => {
    for (const p of SHOOT_PRESETS) {
      const store = new Store(new MemoryStorage());
      expect(newShoot(store, p.id), p.id).toBe(true);
      const a = store.scene.animation!;
      expect(store.scene.name).toBe(p.name);
      expect(store.scene.coverage?.id, p.id).toBe(p.coverage);
      expect(shotSpans(a).every((s) => store.scene.cameras.some((c) => c.id === s.shot.camera)), p.id).toBe(true);
      // (Only the coverage's cameras: the one the scene came with, filming none of it, went.)
      expect(store.scene.cameras.every((c) => c.made), p.id).toBe(true);
      if (p.duration) expect(a.duration).toBe(p.duration);
      expect(checkShots(store.scene).map((i) => i.message), p.id).toEqual([]);
      // Neither holds the other: the template has only a plain camera, the coverage no people.
      const t = SCENE_TEMPLATES.find((x) => x.id === p.template)!.build();
      expect(t.cameras.map((c) => c.made ?? c.kind)).toEqual(['rig']);
      expect(t.coverage).toBeUndefined();
    }
    // Opened in one step: one undo goes back to before it.
    const store = new Store(new MemoryStorage());
    const before = store.getState().library;
    newShoot(store, 'shoot-interview');
    store.undo();
    expect(store.getState().library).toBe(before);
  }, 300_000);

  it('keeps shoot presets of my own: made, saved from a filmed scene, opened in one step, kept, gone with their template', () => {
    const store = new Store(new MemoryStorage());
    // From a template and a coverage (a still template filmed for a length of its own).
    const mine = saveShoot(store, { name: 'Talk', template: 'conversation', coverage: 'dialogue', duration: 5 });
    expect(shootsOf(store.getState().library).map((p) => p.name)).toContain('Talk');
    const before = store.getState().library.scenes.length;
    expect(newShoot(store, mine.id)).toBe(true);
    expect(store.scene.name).toBe('Talk');
    expect(store.scene.animation!.duration).toBe(5);
    expect(store.scene.coverage?.id).toBe('dialogue');
    store.undo();
    expect(store.getState().library.scenes).toHaveLength(before);

    // From a scene filmed with a coverage: a template of it, and a preset filming it so.
    const { store: other, a } = fresh();
    addFigure(other, [1.2, 0, 0]);
    arrange(other, a, other.getState().activeFigure!, 'faceEachOther');
    startAnimation(other, 4);
    other.select({ kind: 'figure', figure: a });
    coverScene(other, 'dialogue');
    const saved = saveAsShoot(other, 'Across the table')!;
    const lib = other.getState().library;
    expect(lib.templates!.map((t) => t.id)).toEqual([saved.template]);
    expect(saved).toMatchObject({ coverage: 'dialogue' });
    expect(saved.duration).toBeUndefined();
    // Kept in the library file, and read back as it was.
    expect(parseLibrary(JSON.parse(JSON.stringify(lib))).shoots).toEqual(lib.shoots);
    expect(newShoot(other, saved.id)).toBe(true);
    expect(checkShots(other.scene).map((i) => i.message)).toEqual([]);
    // Deleting the template takes the preset with it.
    expect(deleteTemplate(other, saved.template)).toEqual(['Across the table']);
    expect(other.getState().library.shoots).toBeUndefined();
    expect(shootsOf(other.getState().library)).toEqual(SHOOT_PRESETS);
  }, 60_000);
});
