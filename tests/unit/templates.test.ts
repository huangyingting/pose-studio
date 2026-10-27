import { describe, expect, it } from 'vitest';
import { addFigure, addProp, arrange, coverScene, newShoot, placeTemplate, saveTemplate, sceneFromTemplate, startAnimation, travelTo } from '@/lib/actions';
import { parseLibrary } from '@/lib/doc';
import { actionsOf, figurePoseAt } from '@/lib/evaluate';
import { facingOf } from '@/lib/pose';
import { checkMotion, checkShots } from '@/lib/qa';
import { facing, withFacing } from '@/lib/relations';
import { shotSpans } from '@/lib/shots';
import { Store } from '@/lib/store';
import { SCENE_TEMPLATES, SHOOT_PRESETS, TEMPLATE_GROUPS } from '@/lib/templates';
import { MemoryStorage, fresh } from '../fixtures/scenes';

const apart = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[2] - q[2]);

describe('scene templates: what is filmed, without how', () => {
  it('builds every template: a cast, a set and what they do, no cameras', () => {
    expect(new Set(SCENE_TEMPLATES.map((t) => t.group))).toEqual(new Set(TEMPLATE_GROUPS));
    for (const t of SCENE_TEMPLATES) {
      const s = t.build();
      expect(s.figures, t.id).toHaveLength(t.people);
      expect(s.animation?.cameras ?? s.animation?.shots, t.id).toBeUndefined();
    }
    // Several people's motions as made, key by key, on both.
    const waltz = SCENE_TEMPLATES.find((t) => t.id === 'waltz-turn')!.build();
    expect(waltz.figures.map((f) => actionsOf(waltz.animation!, f.id).some((x) => x.source.kind === 'keys'))).toEqual([true, true]);
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
    expect(t.scene.animation!.cameras ?? t.scene.animation!.shots ?? t.scene.animation!.coverage).toBeUndefined();
    expect(t.scene.figures.map((f) => f.position[0])).toEqual([-1, 1]);
    expect(t.scene.props[0].position).toEqual([0, 0, 1]);
    // Kept in the library (and read back as it was); it opens as a new scene, with new ids.
    const lib = store.getState().library;
    expect(parseLibrary(JSON.parse(JSON.stringify(lib))).templates).toEqual(lib.templates);
    expect(sceneFromTemplate(store, t.id)).toBe(true);
    expect(store.scene.name).toBe('Interview');
    expect(store.scene.figures.map((f) => f.id)).not.toContain(a);
    expect(store.scene.figures.map((f) => f.position[0])).toEqual([-1, 1]);
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
    const cast = placeTemplate(store, 'waltz-turn')!;
    expect(cast).toEqual([a, b]);
    const anim = store.scene.animation!;
    // Each figure keyed from the playhead, after what it did before (the walk).
    const keyed = [a, b].map((id) => actionsOf(anim, id).filter((x) => x.source.kind === 'keys' && x.start >= walk.to - 1e-6));
    expect(keyed.map((k) => k.length > 0)).toEqual([true, true]);
    expect(Math.min(...keyed.flat().map((x) => x.start))).toBeCloseTo(walk.to, 3);
    expect(actionsOf(anim, a).some((x) => x.source.kind === 'travel')).toBe(true);
    expect(anim.duration).toBeGreaterThan(walk.to + 2);
    // The lead starts the waltz where its walk ended, facing the way it walked.
    expect(apart(figurePoseAt(store.scene, a, walk.to + 0.05)!.position, [0, 0, 2])).toBeLessThan(0.3);
    expect(facingOf(figurePoseAt(store.scene, a, walk.to)!.bones)).toBeCloseTo(0, -1);
  });

  it('opens each shoot preset as a scene filmed with its coverage, clean', () => {
    for (const p of SHOOT_PRESETS) {
      const store = new Store(new MemoryStorage());
      expect(newShoot(store, p.id), p.id).toBe(true);
      const a = store.scene.animation!;
      expect(store.scene.name).toBe(p.name);
      expect(a.coverage?.id, p.id).toBe(p.coverage);
      expect(shotSpans(a).every((s) => a.cameras!.some((c) => c.id === s.shot.camera)), p.id).toBe(true);
      if (p.duration) expect(a.duration).toBe(p.duration);
      expect(checkShots(store.scene).map((i) => i.message), p.id).toEqual([]);
      // Neither holds the other: the template has no cameras, the coverage no people.
      expect(SCENE_TEMPLATES.find((t) => t.id === p.template)!.build().animation?.cameras).toBeUndefined();
    }
    // Opened in one step: one undo goes back to before it.
    const store = new Store(new MemoryStorage());
    const before = store.getState().library;
    newShoot(store, 'shoot-interview');
    store.undo();
    expect(store.getState().library).toBe(before);
  }, 120_000);
});
