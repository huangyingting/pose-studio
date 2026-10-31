import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addFigure, addKeyframe, applyMotion, copyActions, duplicateBlocks, giveAction, pasteActions, repeatAction, retime, rippleDeleteActions, setPlayRange, slip, splitAt, startAnimation, travelTo, trim } from '@/lib/actions';
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

describe('splitting at the playhead (#22)', () => {
  it('a motion: two blocks, the second going on from where the first leaves off', () => {
    const { store, a, id, act } = jabbed();
    const before = { ...act() };
    const at = Math.round((before.start + 1.2) * 24) / 24;
    const was = [at - 1 / 24, at + 1 / 24].map((t) => figurePoseAt(store.scene, a, t)!);
    store.setTime(at);
    expect(splitAt(store, id)).toBeNull();
    const [one, two] = actionsOf(store.scene.animation!, a).filter((x) => x.source.kind === 'clip');
    expect(one.id).toBe(id);
    expect(one.start + one.duration).toBeCloseTo(at, 6);
    expect(two.start).toBeCloseTo(at, 6);
    expect(two.start + two.duration).toBeCloseTo(before.start + before.duration, 6);
    expect((one.source as { to?: number }).to).toBeCloseTo((two.source as { from?: number }).from!, 6);
    expect(two.blendIn).toBeUndefined();
    // It plays as it did across the split.
    [at - 1 / 24, at + 1 / 24].forEach((t, i) => expect(apart(figurePoseAt(store.scene, a, t)!, was[i], true)).toBeLessThan(2));
    expect(Math.hypot(...[0, 2].map((k) => figurePoseAt(store.scene, a, at + 1 / 24)!.position[k] - was[1].position[k]))).toBeLessThan(0.02);
  });

  it('a repeated motion splits into its repeats, then the one under the playhead', () => {
    const { store, a, id, act } = jabbed();
    const once = act().duration;
    repeatAction(store, id, 3);
    store.setTime(Math.round((act().start + once * 1.5) * 24) / 24);
    expect(splitAt(store, id)).toBeNull();
    const blocks = actionsOf(store.scene.animation!, a).filter((x) => x.source.kind === 'clip');
    expect(blocks).toHaveLength(4);
    expect(blocks.every((x) => !(x.source as { repeat?: number }).repeat)).toBe(true);
  });

  it('keys: two Posed blocks, the pose at the playhead keyed in both; a walk is not split', () => {
    const { store, a } = fresh();
    startAnimation(store, 4);
    store.setTime(0);
    addKeyframe(store);
    store.setTime(2);
    store.updateFigure(a, (f) => ({ ...f, position: [2, f.position[1], f.position[2]] }));
    addKeyframe(store);
    const posed = actionsOf(store.scene.animation!, a)[0];
    const mid = figurePoseAt(store.scene, a, 1)!.position[0];
    store.setTime(1);
    expect(splitAt(store, posed.id)).toBeNull();
    const two = actionsOf(store.scene.animation!, a).filter((x) => x.source.kind === 'keys');
    expect(two).toHaveLength(2);
    expect(figurePoseAt(store.scene, a, 1)!.position[0]).toBeCloseTo(mid, 3);
    store.setTime(2);
    const walk = travelTo(store, a, [4, 4], 'walk')!;
    const walking = actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'travel')!;
    store.setTime((walk.from + walk.to) / 2);
    expect(splitAt(store, walking.id)).toMatch(/is not split/);
  });
});

describe('arranging blocks (#22)', () => {
  it('Shift + Delete closes the gap; Ctrl + D puts it again right after itself, what follows moving along', () => {
    const { store, a, id, act, next } = jabbed(true);
    const d = act().duration;
    const second = next().id;
    duplicateBlocks(store, [id]);
    const clips = () => actionsOf(store.scene.animation!, a).filter((x) => x.source.kind === 'clip');
    expect(clips()).toHaveLength(3);
    expect(clips()[1].start).toBeCloseTo(act().start + d, 3);
    expect(clips()[2].id).toBe(second);
    expect(clips()[2].start).toBeCloseTo(act().start + 2 * d, 2);
    rippleDeleteActions(store, [clips()[1].id]);
    expect(clips()).toHaveLength(2);
    expect(clips()[1].start).toBeCloseTo(act().start + d, 2);
  });

  it('copied, pasted on someone else at the playhead: from where they are, turned their way; given to them by dragging', () => {
    const { store, a } = fresh();
    startAnimation(store, 6);
    addFigure(store, [3, 0, 2]);
    const b = store.getState().activeFigure!;
    store.setTime(0);
    const walk = travelTo(store, a, [1, 2], 'walk')!;
    const walking = actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'travel')!;
    const from = figurePoseAt(store.scene, a, 0)!.position;
    const to = figurePoseAt(store.scene, a, walk.to)!.position;
    expect(copyActions(store, [walking.id])).toBe(1);
    expect(pasteActions(store, b, 1)).toBeNull();
    const pasted = actionsOf(store.scene.animation!, b).find((x) => x.source.kind === 'travel')!;
    expect(pasted.start).toBeCloseTo(1, 3);
    // The same walk from where b is (b faces the same way as a: the same way across the floor).
    const bAt = figurePoseAt(store.scene, b, 1)!.position;
    const bTo = pasted.roles[0].end!.at;
    expect(Math.hypot(bTo[0] - bAt[0] - (to[0] - from[0]), bTo[1] - bAt[2] - (to[2] - from[2]))).toBeLessThan(0.05);
    // A motion given to a by dragging: it leaves b.
    store.setTime(4);
    applyMotion(store, b, JAB);
    const swing = actionsOf(store.scene.animation!, b).find((x) => x.source.kind === 'clip')!;
    expect(giveAction(store, swing.id, a)).toBeNull();
    expect(actionsOf(store.scene.animation!, b).some((x) => x.source.kind === 'clip')).toBe(false);
    expect(actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'clip')!.start).toBeCloseTo(swing.start, 3);
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
