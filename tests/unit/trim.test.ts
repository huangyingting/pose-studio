import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addKeyframe, applyMotion, repeatAction, retime, setPlayRange, slip, startAnimation, trim } from '@/lib/actions';
import { clipById, playedClip, putClips } from '@/lib/assets';
import { clipRange, keysClip, samplePart } from '@/lib/clip';
import { parseClip, parseScene } from '@/lib/doc';
import { actionsOf, figurePoseAt } from '@/lib/evaluate';
import type { Action, Clip, Pose } from '@/lib/types';
import { fresh } from '../fixtures/scenes';

/*
 * Trimming, stretching and slipping a motion (#22): the part of it a block plays, at the speed it
 * plays it, where it is in time.
 */

const JAB = 'library:baseball-hit';
putClips([parseClip(JSON.parse(readFileSync('public/motions/baseball-hit.json', 'utf8')))!]);

/** The largest turn between two poses' bones (degrees; `limbs`: not the hips, which carry the way it faces). */
function apart(p: Pose, q: Pose, limbs = false) {
  let worst = 0;
  for (const k of Object.keys(p.bones) as (keyof Pose['bones'])[]) {
    if (limbs && k === 'hips') continue;
    const [a, b] = [p.bones[k], q.bones[k]];
    if (!a || !b) continue;
    const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    worst = Math.max(worst, (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI);
  }
  return worst;
}

/** A scene with the jab on its figure from 0, then (`after`) the jab again right after it. */
function jabbed(after = false) {
  const { store, a } = fresh();
  startAnimation(store, 2);
  store.setTime(0);
  applyMotion(store, a, JAB);
  const all = () => actionsOf(store.scene.animation!, a).filter((x) => x.source.kind === 'clip');
  const first = all()[0];
  if (after) {
    store.setTime(first.start + first.duration);
    applyMotion(store, a, JAB);
  }
  return { store, a, id: first.id, act: () => all()[0], next: () => all()[1] };
}

describe('trimming a motion (#22)', () => {
  it('the end: the block plays less of it, what it plays where it was, what follows moving along', () => {
    const { store, a, id, act, next } = jabbed(true);
    const before = { ...act() };
    const was = figurePoseAt(store.scene, a, before.start + 0.5)!;
    const followed = next().start;
    trim(store, id, 'end', before.start + before.duration - 0.6);
    const now = act();
    expect(now.duration).toBeCloseTo(before.duration - 0.6, 1);
    expect(now.source).toMatchObject({ kind: 'clip', to: expect.any(Number) });
    expect((now.source as { speed?: number }).speed ?? 1).toBeCloseTo(1, 3);
    expect(apart(figurePoseAt(store.scene, a, before.start + 0.5)!, was)).toBeLessThan(1);
    expect(next().start).toBeCloseTo(followed - 0.6, 1);
    // Not past the motion's own end.
    trim(store, id, 'end', before.start + before.duration + 3);
    expect(act().duration).toBeCloseTo(before.duration, 2);
    expect((act().source as { to?: number }).to).toBeUndefined();
  });

  it('the start: the block starts later, what it plays where it was (from where the person is: facing their way), its end where it was', () => {
    const { store, a, id, act } = jabbed();
    const before = { ...act() };
    const was = figurePoseAt(store.scene, a, before.start + 1.2)!;
    trim(store, id, 'start', before.start + 0.5);
    const now = act();
    expect(now.start).toBeCloseTo(before.start + 0.5, 1);
    expect(now.start + now.duration).toBeCloseTo(before.start + before.duration, 3);
    expect((now.source as { from?: number }).from).toBeCloseTo(0.5, 1);
    expect(apart(figurePoseAt(store.scene, a, before.start + 1.2)!, was, true)).toBeLessThan(1);
    // Back to its first frame at most.
    trim(store, id, 'start', before.start - 2);
    expect(act().start).toBeCloseTo(before.start, 3);
    expect((act().source as { from?: number }).from).toBeUndefined();
  });

  it('Alt: stretched, the part it plays kept, its speed changed', () => {
    const { store, id, act } = jabbed();
    const start = act().start;
    trim(store, id, 'end', start + act().duration - 0.5);
    const part = { ...(act().source as { to?: number }) };
    const d = act().duration;
    retime(store, id, d * 2);
    expect(act().duration).toBeCloseTo(d * 2, 1);
    expect((act().source as { to?: number }).to).toBe(part.to);
    expect((act().source as { speed?: number }).speed).toBeCloseTo(0.5, 2);
  });

  it('slipped: another part of it plays where the block is', () => {
    const { store, a, id, act } = jabbed();
    trim(store, id, 'end', act().start + 1);
    const block = { start: act().start, duration: act().duration };
    slip(store, id, 0.5);
    expect(act().start).toBeCloseTo(block.start, 6);
    expect(act().duration).toBeCloseTo(block.duration, 6);
    expect((act().source as { from?: number }).from).toBeCloseTo(0.5, 2);
    // Its first frame is the motion's at 0.5 s.
    const clip = clipById(JAB)!;
    const own = samplePart(clip.parts[0], 0.5, clip.duration, false);
    const here = figurePoseAt(store.scene, a, block.start + 1 / 24)!;
    expect(apart(here, own)).toBeLessThan(25);
    // Not past the motion's end.
    slip(store, id, 99);
    const src = act().source as { from?: number; to?: number };
    expect(src.to).toBeUndefined();
    expect(src.from).toBeCloseTo(clip.duration - block.duration, 2);
  });

  it('a repeated motion\'s edges add or take away whole repeats', () => {
    const { store, id, act } = jabbed();
    const once = act().duration;
    repeatAction(store, id, 3);
    expect(act().duration).toBeCloseTo(once * 3, 1);
    trim(store, id, 'end', act().start + once * 1.9);
    expect((act().source as { repeat?: number }).repeat).toBe(2);
    expect(act().duration).toBeCloseTo(once * 2, 1);
    const end = act().start + act().duration;
    trim(store, id, 'start', act().start + once * 0.8);
    expect((act().source as { repeat?: number }).repeat).toBeUndefined();
    expect(act().start + act().duration).toBeCloseTo(end, 3);
  });

  it('the part it plays set in the inspector: as long as that takes, what follows moving along; kept in the saved data', () => {
    const { store, id, act, next } = jabbed(true);
    const followed = next().start;
    setPlayRange(store, id, 0.4, 1.4);
    expect(act().duration).toBeCloseTo(1, 1);
    expect(act().source).toMatchObject({ from: 0.4, to: 1.4 });
    expect(next().start).toBeLessThan(followed);
    const saved = parseScene(JSON.parse(JSON.stringify(store.scene)))!;
    expect(saved.animation!.actions.find((x) => x.id === id)!.source).toMatchObject({ from: 0.4, to: 1.4 });
    expect(playedClip(act().source as Extract<Action['source'], { kind: 'clip' }>)!.duration).toBeCloseTo(1, 3);
  });

  it('keys: the end holds the last pose for longer; the start drops the keys before it, the pose there keyed', () => {
    const { store, a } = fresh();
    startAnimation(store, 4);
    store.setTime(0);
    addKeyframe(store);
    store.setTime(1);
    store.updateFigure(a, (f) => ({ ...f, position: [1, f.position[1], f.position[2]] }));
    addKeyframe(store);
    const posed = actionsOf(store.scene.animation!, a)[0];
    trim(store, posed.id, 'end', 2.5);
    const held = actionsOf(store.scene.animation!, a)[0];
    expect(held.start + held.duration).toBeCloseTo(2.5, 2);
    expect(figurePoseAt(store.scene, a, 2.2)!.position[0]).toBeCloseTo(1, 2);
    trim(store, posed.id, 'start', 0.5);
    const later = actionsOf(store.scene.animation!, a)[0];
    expect(later.start).toBeCloseTo(0.5, 2);
    expect(later.start + later.duration).toBeCloseTo(2.5, 2);
    expect(figurePoseAt(store.scene, a, 0.5)!.position[0]).toBeGreaterThan(0.2);
  });
});

describe('the part of a motion (#22)', () => {
  it('is a clip of its own: its keys from 0, its events and contacts within it', () => {
    const base = keysClip([0, 1, 2].map((t) => ({ t, pose: { ...samplePart(clipById(JAB)!.parts[0], t, clipById(JAB)!.duration, false) } })));
    const clip: Clip = { ...base, events: [{ t: 0.5, part: 0, kind: 'release', hand: 'R' }, { t: 1.5, part: 0, kind: 'grab', hand: 'R' }], contacts: [{ part: 0, bone: 'leftFoot', start: 0, end: 2 }] };
    const part = clipRange(clip, 1, 2);
    expect(part.duration).toBeCloseTo(1, 6);
    expect(part.events).toEqual([{ t: 0.5, part: 0, kind: 'grab', hand: 'R' }]);
    expect(part.contacts).toEqual([{ part: 0, bone: 'leftFoot', start: 0, end: 1 }]);
    expect(apart(samplePart(part.parts[0], 0, 1, false), samplePart(clip.parts[0], 1, 2, false))).toBeLessThan(1);
    // The same part again: the same clip.
    expect(clipRange(clip, 1, 2)).toBe(part);
    expect(clipRange(clip, 0, 2)).toBe(clip);
  });
});
