import { describe, expect, it } from 'vitest';
import {
  addFigure, applyMotion, fitWarp, moveAction, moveMark, recastRole, retime, setBlend, setClipOptions, travelTo,
  offsetPerformance, reactTo, STRIKES, strikeFigure, clearMark,
} from '@/lib/actions';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Rig } from '@/lib/relations';
import { parseClip } from '@/lib/doc';
import { actionsOf, marksOf, overWarp, sceneAt, warpOf } from '@/lib/evaluate';
import { newAnimation } from '@/lib/animation';
import { clipById, putClips } from '@/lib/assets';
import { REACT_LEAD, strikeTime } from '@/lib/strike';
import { newScene } from '@/lib/doc';
import { actionLabel, retimeAction, rippleInStep } from '@/lib/track';
import type { Action, Animation } from '@/lib/types';
import { fresh } from '../fixtures/scenes';

const ends = (store: ReturnType<typeof fresh>['store'], id: string) => actionsOf(store.scene.animation!, id).map((x) => +(x.start + x.duration).toFixed(3));

describe('actions edited as blocks: moved, retimed, blended, recast, their marks dragged', () => {
  it('moving or retiming one action takes what that figure does after along, and nobody else', () => {
    const { store, a } = fresh();
    addFigure(store, [2, 0, 0]);
    const b = store.getState().activeFigure!;
    store.setTime(0);
    const walk = travelTo(store, a, [0, 3], 'walk')!;
    const run = travelTo(store, a, [0, 6], 'run')!;
    store.setTime(0);
    travelTo(store, b, [2, 3], 'walk');
    const theirs = ends(store, b);
    const walkId = actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'travel')!.id;

    // Half a second later: the run after it comes along.
    moveAction(store, walkId, 0.5);
    const mine = actionsOf(store.scene.animation!, a).filter((x) => x.source.kind === 'travel');
    expect(mine[0].start).toBeCloseTo(0.5, 5);
    expect(mine[1].start).toBeCloseTo(run.from + 0.5, 5);
    expect(ends(store, b)).toEqual(theirs);
    // Not before what comes before it.
    moveAction(store, walkId, -3);
    expect(actionsOf(store.scene.animation!, a).find((x) => x.id === walkId)!.start).toBe(0);

    // A slower walk: a second longer, and the run after it a second later; the marks stay.
    retime(store, walkId, walk.to - walk.from + 1);
    const slow = actionsOf(store.scene.animation!, a).filter((x) => x.source.kind === 'travel');
    expect(slow[0].duration).toBeCloseTo(walk.to - walk.from + 1, 5);
    expect(slow[1].start).toBeCloseTo(walk.to + 1, 5);
    expect(sceneAt(store.scene, slow[0].start + slow[0].duration).figures.find((f) => f.id === a)!.position[2]).toBeCloseTo(3, 1);
    expect(ends(store, b)).toEqual(theirs);

    // A run put in where the walk starts goes first; the walk follows it.
    store.setTime(slow[0].start);
    const first = travelTo(store, a, [1, 0], 'run')!;
    const now = actionsOf(store.scene.animation!, a).filter((x) => x.source.kind === 'travel');
    expect(now.map((x) => (x.source as { mode: string }).mode)).toEqual(['run', 'walk', 'run']);
    expect(now[1].start).toBeCloseTo(first.to, 5);

    setBlend(store, walkId, 0.3);
    expect(actionsOf(store.scene.animation!, a).find((x) => x.id === walkId)!.blendIn).toBe(0.3);
    expect(actionLabel(slow[1])).toBe('Run');
  }, 60_000);

  it('a motion plays faster or slower, mirrored; it goes to someone else', () => {
    const { store, a } = fresh();
    addFigure(store, [1, 0, 0]);
    const b = store.getState().activeFigure!;
    store.setTime(0);
    expect(applyMotion(store, a, 'fall')).toBe(true);
    const box = actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'clip')!;
    setClipOptions(store, box.id, { speed: 2, mirror: true });
    const fast = store.scene.animation!.actions.find((x) => x.id === box.id)!;
    expect(fast.duration).toBeCloseTo(box.duration / 2, 1);
    expect(fast.source).toMatchObject({ mirror: true });
    expect((fast.source as { speed: number }).speed).toBeCloseTo(2, 1);
    // B does it instead: A is out of it.
    recastRole(store, box.id, 0, b);
    expect(store.scene.animation!.actions.find((x) => x.id === box.id)!.roles.map((r) => r.figure)).toEqual([b]);
    expect(actionsOf(store.scene.animation!, a).some((x) => x.id === box.id)).toBe(false);
  }, 60_000);

  it('a reaction is timed to another figure\'s blow, and says how far the blow misses', () => {
    const { store, a } = fresh();
    addFigure(store, [0, 0, 0.75]);
    const b = store.getState().activeFigure!;
    store.setTime(0);
    expect(applyMotion(store, a, 'jab-cross')).toBe(true);
    store.setTime(0);
    expect(applyMotion(store, b, 'hit')).toBe(true);
    const clip = (who: string) => actionsOf(store.scene.animation!, who).find((x) => x.source.kind === 'clip')!;
    const strike = clip(a);
    const lands = strike.start + strikeTime(clipById((strike.source as { clip: string }).clip)!);
    const gap = reactTo(store, clip(b).id, strike.id)!;
    expect(clip(b).start).toBeCloseTo(Math.max(0, lands - REACT_LEAD), 1);
    expect(gap).toBeLessThan(0.3);
    // Too far apart: timed all the same, the blow short of them.
    offsetPerformance(store, [b], { dx: 0, dz: 1.75 });
    expect(reactTo(store, clip(b).id, strike.id)!).toBeGreaterThan(1);
  }, 60_000);

  it('a strike steps in to where the blow reaches, turned so it lands, the one struck reacting as it does', () => {
    for (const x of STRIKES) {
      putClips([x.id, x.reaction].map((id) => parseClip(JSON.parse(readFileSync(`public/motions/${id.slice(8)}.json`, 'utf8')))!));
      const { store, a } = fresh();
      addFigure(store, [2.5, 0, 2]);
      const b = store.getState().activeFigure!;
      store.setTime(0);
      const lands = strikeFigure(store, a, b, x.id)!;
      expect(lands, x.id).toBeGreaterThan(0.5);
      // At the moment it lands: the hand or foot furthest out is at their head or chest.
      const rig = new Rig();
      const now = sceneAt(store.scene, lands).figures;
      const me = rig.model(now.find((f) => f.id === a)!);
      const blow = (['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const).map((j) => me.joints[j].getWorldPosition(new THREE.Vector3()));
      const hips = me.joints.hips.getWorldPosition(new THREE.Vector3());
      const out = (q: THREE.Vector3) => Math.hypot(q.x - hips.x, q.z - hips.z);
      const tip = blow.reduce((p, q) => (out(q) > out(p) ? q : p));
      const them = rig.model(now.find((f) => f.id === b)!);
      const near = Math.min(...(['head', 'chest'] as const).map((j) => them.joints[j].getWorldPosition(new THREE.Vector3()).distanceTo(tip)));
      expect(near, x.id).toBeLessThan(0.35);
      // They react, starting just before it lands.
      const react = actionsOf(store.scene.animation!, b).find((y) => y.source.kind === 'clip' && y.source.clip === x.reaction)!;
      expect(react.start, x.id).toBeCloseTo(lands - REACT_LEAD, 1);
      rig.dispose();
    }
  }, 60_000);

  it('a motion played longer keeps its mark as far from where it ends by itself; a mark can go', () => {
    const clip = parseClip(JSON.parse(readFileSync('public/motions/look-around.json', 'utf8')))!;
    putClips([clip]);
    const { store, a } = fresh();
    store.setTime(0);
    expect(applyMotion(store, a, clip.id)).toBe(true);
    const act = () => actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'clip')!;
    const end = act().start + act().duration;
    const m = marksOf(store.scene, act(), a)!.end;
    moveMark(store, a, end, [m.at[0] + 0.3, m.at[1]]);
    const before = warpOf(store.scene, act(), a)!;
    expect(before.distance).toBeCloseTo(0.3, 2);
    retime(store, act().id, act().duration * 0.6);
    expect(warpOf(store.scene, act(), a)!.distance).toBeCloseTo(0.3, 2);
    clearMark(store, act().id, a);
    expect(act().roles[0].end).toBeUndefined();
  });

  it('a mark further than a motion can stretch shows, and is moved back or walked to', () => {
    const { store, a } = fresh();
    store.setTime(0);
    expect(applyMotion(store, a, 'cartwheel')).toBe(true);
    const act = actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'clip')!;
    const t = act.start + act.duration;
    const m = marksOf(store.scene, act, a)!;
    // A little further is fine (warped); twice as far is not.
    const go = (k: number): [number, number] => [m.start.at[0] + (m.end.at[0] - m.start.at[0]) * k, m.start.at[1] + (m.end.at[1] - m.start.at[1]) * k];
    moveMark(store, a, t, go(1.15));
    expect(overWarp(store.scene, store.scene.animation!.actions.find((x) => x.id === act.id)!, a)).toBe(false);
    moveMark(store, a, t, go(2));
    expect(overWarp(store.scene, store.scene.animation!.actions.find((x) => x.id === act.id)!, a)).toBe(true);
    fitWarp(store, act.id, a, 'walk');
    const after = actionsOf(store.scene.animation!, a);
    expect(overWarp(store.scene, after.find((x) => x.id === act.id)!, a)).toBe(false);
    const walk = after.find((x) => x.source.kind === 'travel')!;
    expect(walk.start).toBeCloseTo(t, 5);
    expect(walk.roles[0].end!.at[0]).toBeCloseTo(go(2)[0], 2);
    expect(walk.roles[0].end!.at[1]).toBeCloseTo(go(2)[1], 2);
  }, 60_000);

  it('what happens in step moves along once, and only what moves pulls anyone along', () => {
    // Plain tracks: a travel (no length of its own to work out) per figure and time.
    const travel = (id: string, figure: string, start: number, duration: number, layer?: Action['layer']): Action => ({
      id, start, duration, roles: [{ figure }], source: { kind: 'travel', mode: 'walk' }, ...(layer ? { layer } : {}),
    });
    const base: Animation = { ...newAnimation(newScene('Blocks', []), 20), actions: [] };
    const starts = (a: Animation) => Object.fromEntries(a.actions.map((x) => [x.id, x.start]));

    // A relay of three, then a duet of the first and the last: retiming the first leg moves the
    // chain once each, the duet once (not once for each of them).
    let a: Animation = { ...base, actions: [
      travel('a', 'A', 0, 2), travel('b', 'B', 2, 2), travel('c', 'C', 4, 2),
      { id: 'duet', start: 10, duration: 2, roles: [{ figure: 'A' }, { figure: 'C' }], source: { kind: 'clip', clip: 'motion:dance' } },
    ] };
    expect(starts(retimeAction(a, 'a', 3))).toEqual({ a: 0, b: 3, c: 5, duet: 11 });

    // A wave over a run: moving it does not move the run, nor the one who sets off as the run ends.
    a = { ...base, actions: [travel('run', 'A', 0, 5), travel('wave', 'A', 2, 1, 'upper'), travel('next', 'B', 5, 2)], props: { baton: [{ t: 5, position: [0, 0, 0], rotation: [0, 0, 0] }] } };
    const waved = rippleInStep(a, ['A'], 2, 1);
    expect(starts(waved)).toEqual({ run: 0, wave: 3, next: 5 });
    expect(waved.props!.baton[0].t).toBe(5);

    // Moving what comes after an arrival does not hold up the one who set off at the arrival.
    a = { ...base, actions: [travel('p', 'A', 0, 2), travel('m', 'A', 2, 2), travel('off', 'B', 2, 2)] };
    expect(starts(rippleInStep(a, ['A'], 2, 1))).toEqual({ p: 0, m: 3, off: 2 });
  });
});
