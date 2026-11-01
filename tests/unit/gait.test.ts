import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setGait, setTravel, startAnimation, travelTo } from '@/lib/actions';
import { putClips } from '@/lib/assets';
import { parseClip, parseScene } from '@/lib/doc';
import { actionsOf, figurePoseAt } from '@/lib/evaluate';
import { facingOf } from '@/lib/pose';
import { checkMotion } from '@/lib/qa';
import type { Pose } from '@/lib/types';
import { fresh } from '../fixtures/scenes';

/* Walks and runs to a mark with a captured cycle (#26). */

const WALK = 'library:walk';
const SNEAK = 'library:crouch-walk-forward';
const clip = (id: string) => ({ ...parseClip(JSON.parse(readFileSync(`public/motions/${id}.json`, 'utf8')))!, id: `library:${id}` });
putClips([clip('walk'), clip('crouch-walk-forward'), clip('walk-backward'), clip('walk-left')]);

const turnOf = (p: Pose, q: Pose, j: keyof Pose['bones']) => {
  const [a, b] = [p.bones[j]!, q.bones[j]!];
  return (2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180) / Math.PI;
};

/** A figure walking to (x, z) from the stage's middle, generated or with the captured Walk. */
function walked(to: [number, number], gait?: string, via?: [number, number], strafe?: boolean) {
  const { store, a } = fresh();
  startAnimation(store, 2);
  store.setTime(0);
  // (Played once: going round, the end back to the start is no slide.)
  store.updateScene((s) => ({ ...s, animation: { ...s.animation!, loop: false } }));
  travelTo(store, a, to, 'walk', strafe ? { strafe } : {});
  const extra = { ...(gait ? { gait } : {}), ...(via ? { via: [{ at: via, facing: 0 }] } : {}) };
  store.updateScene((s) => ({ ...s, animation: { ...s.animation!, actions: s.animation!.actions.map((x) => (x.source.kind === 'travel' ? { ...x, source: { ...x.source, ...extra } } : x)) } }));
  const act = actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'travel')!;
  return { store, a, act };
}

describe('a walk with a captured cycle (#26)', () => {
  it('goes where it is sent, its feet never sliding, its body the captured one', () => {
    const { store, a, act } = walked([0, 6], WALK);
    const end = figurePoseAt(store.scene, a, act.start + act.duration)!;
    expect(Math.hypot(end.position[0], end.position[2] - 6)).toBeLessThan(0.1);
    expect(checkMotion(store.scene).filter((i) => i.kind === 'slide' || i.kind === 'pop')).toEqual([]);
    // Mid-way, not the generated walk: the captured arms and spine.
    const g = walked([0, 6]);
    const mid = act.start + act.duration / 2;
    expect(turnOf(figurePoseAt(store.scene, a, mid)!, figurePoseAt(g.store.scene, g.a, mid)!, 'spine')).toBeGreaterThan(1);
  });

  it('round a corner, past a mark on the way: its planted feet still hold', () => {
    const { store, a, act } = walked([4, 5], WALK, [0, 4]);
    const end = figurePoseAt(store.scene, a, act.start + act.duration)!;
    expect(Math.hypot(end.position[0] - 4, end.position[2] - 5)).toBeLessThan(0.1);
    expect(checkMotion(store.scene).filter((i) => i.kind === 'slide' || i.kind === 'pop')).toEqual([]);
  });

  it('keeping its facing, it steps sideways (to the right, mirrored) and a sneak backs up with the captured ones; a walk backs up generated', () => {
    for (const [to, gait] of [[[0, -4], SNEAK], [[3, 0], WALK], [[-3, 0], WALK]] as [[number, number], string][]) {
      const { store, a, act } = walked(to, gait, undefined, true);
      const end = figurePoseAt(store.scene, a, act.start + act.duration)!;
      expect(Math.hypot(end.position[0] - to[0], end.position[2] - to[1]), `${to}`).toBeLessThan(0.1);
      expect(checkMotion(store.scene).filter((i) => i.kind === 'slide' || i.kind === 'pop'), `${to}`).toEqual([]);
      // Facing the way it did, its hips as turned from it as the captured person's (a side step opens them); its body the captured one, not generated side steps.
      const mid = act.start + act.duration / 2;
      const pose = figurePoseAt(store.scene, a, mid)!;
      expect(Math.abs(facingOf(pose.bones)), `${to}`).toBeLessThan(75);
      const g = walked(to, undefined, undefined, true);
      expect(turnOf(pose, figurePoseAt(g.store.scene, g.a, mid)!, 'spine'), `${to}`).toBeGreaterThan(1);
    }
    const { store, a, act } = walked([0, -4], WALK, undefined, true);
    const g = walked([0, -4], undefined, undefined, true);
    const mid = act.start + act.duration / 2;
    expect(turnOf(figurePoseAt(store.scene, a, mid)!, figurePoseAt(g.store.scene, g.a, mid)!, 'spine')).toBeLessThan(1e-3);
  });

  it('chosen in its inspector (a walk\'s cycles for a walk), kept with the scene; made a run, a walk\'s cycle goes', () => {
    const { store, a, act } = walked([0, 6]);
    const now = () => store.scene.animation!.actions.find((x) => x.id === act.id)!.source as { gait?: string; mode: string };
    setGait(store, act.id, 'library:run-forward');
    expect(now().gait).toBeUndefined();
    setGait(store, act.id, WALK);
    expect(now().gait).toBe(WALK);
    // At the captured walk's own pace (1.59 m a 1 s lap): 6 m in about 3.8 s.
    expect(store.scene.animation!.actions.find((x) => x.id === act.id)!.duration).toBeCloseTo(6 / 1.594, 1);
    expect((parseScene(JSON.parse(JSON.stringify(store.scene)))!.animation!.actions.find((x) => x.id === act.id)!.source as { gait?: string }).gait).toBe(WALK);
    const walk = store.scene.animation!.actions.find((x) => x.id === act.id)!;
    setTravel(store, a, walk.start + walk.duration, 'run');
    expect(now()).toMatchObject({ mode: 'run' });
    expect(now().gait).toBeUndefined();
  });
});
