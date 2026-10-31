import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMotion, issueFix, repeatAction, setBlend, setBlendCurve, setClipOptions, splitIntoRepeats, startAnimation } from '@/lib/actions';
import { putClips } from '@/lib/assets';
import { mirrorPose } from '@/lib/clip';
import { parseClip, parseScene } from '@/lib/doc';
import { actionsOf, curved, figurePoseAt } from '@/lib/evaluate';
import type { JointName, Pose } from '@/lib/types';
import { fresh } from '../fixtures/scenes';

/* Repeats as segments, and what comes between them (#23). */

const SWING = 'library:baseball-hit';
putClips([parseClip(JSON.parse(readFileSync('public/motions/baseball-hit.json', 'utf8')))!]);

/** How far one bone of two poses is turned apart (degrees). */
function turnOf(p: Pose, q: Pose, j: JointName) {
  const [a, b] = [p.bones[j]!, q.bones[j]!];
  return (2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180) / Math.PI;
}
/** The largest turn of any limb between two poses (not the hips). */
function apart(p: Pose, q: Pose) {
  return Math.max(...(Object.keys(p.bones) as JointName[]).filter((j) => j !== 'hips' && q.bones[j]).map((j) => turnOf(p, q, j)));
}

function swung(times = 3) {
  const { store, a } = fresh();
  startAnimation(store, 2);
  store.setTime(0);
  applyMotion(store, a, SWING);
  const id = actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'clip')!.id;
  repeatAction(store, id, times);
  const act = () => store.scene.animation!.actions.find((x) => x.id === id)!;
  return { store, a, id, act };
}

describe('repeats (#23)', () => {
  it('each repeat blends in from the one before where it ends far from how the next starts; a cut if asked', () => {
    const { store, a, id, act } = swung();
    const lap = act().duration / 3;
    const seam = act().start + lap;
    const jump = () => apart(figurePoseAt(store.scene, a, seam - 1 / 48)!, figurePoseAt(store.scene, a, seam + 1 / 48)!);
    const blended = jump();
    setClipOptions(store, id, { seam: 0 });
    const cut = jump();
    expect(cut).toBeGreaterThan(blended + 5);
    // Kept in the saved data.
    expect(parseScene(JSON.parse(JSON.stringify(store.scene)))!.animation!.actions.find((x) => x.id === id)!.source).toMatchObject({ seam: 0 });
  });

  it('alternate mirrored: every other repeat left for right', () => {
    const { store, a, id, act } = swung(2);
    const lap = act().duration / 2;
    const at = act().start + 0.6;
    const first = figurePoseAt(store.scene, a, at)!;
    setClipOptions(store, id, { alternate: true, seam: 0 });
    // The first as it was; the second its mirror.
    expect(apart(figurePoseAt(store.scene, a, at)!, first)).toBeLessThan(1);
    const second = figurePoseAt(store.scene, a, at + lap)!;
    expect(turnOf(second, mirrorPose(first), 'leftUpperArm')).toBeLessThan(3);
    expect(turnOf(second, mirrorPose(first), 'rightLowerLeg')).toBeLessThan(3);
  });

  it('split into repeats: each its own block, every other one mirrored as they were, blending in as the repeats did', () => {
    const { store, a, id } = swung(3);
    setClipOptions(store, id, { alternate: true, seam: 0.3 });
    splitIntoRepeats(store, id);
    const blocks = actionsOf(store.scene.animation!, a).filter((x) => x.source.kind === 'clip');
    expect(blocks).toHaveLength(3);
    expect(blocks.map((x) => !!(x.source as { mirror?: boolean }).mirror)).toEqual([false, true, false]);
    expect(blocks.slice(1).map((x) => x.blendIn)).toEqual([0.3, 0.3]);
  });
});

describe('blends (#23)', () => {
  it('go smoothly, evenly, easing in or out', () => {
    expect([0, 0.5, 1].map((x) => curved(x))).toEqual([0, 0.5, 1]);
    expect(curved(0.25, 'linear')).toBeCloseTo(0.25, 6);
    expect(curved(0.5, 'in')).toBeCloseTo(0.25, 6);
    expect(curved(0.5, 'out')).toBeCloseTo(0.75, 6);
    expect(curved(0.25)).toBeLessThan(0.25);
  });

  it('a block\'s blend in goes on its curve: easing in, it is still nearer what it came from halfway', () => {
    const { store, a } = fresh();
    startAnimation(store, 2);
    store.setTime(1);
    applyMotion(store, a, SWING);
    const act = actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'clip')!;
    setBlend(store, act.id, 0.8);
    const from = figurePoseAt(store.scene, a, act.start - 0.8)!;
    const mid = act.start - 0.4;
    setBlendCurve(store, act.id, 'in');
    const easing = apart(figurePoseAt(store.scene, a, mid)!, from);
    setBlendCurve(store, act.id, 'out');
    const quick = apart(figurePoseAt(store.scene, a, mid)!, from);
    expect(quick).toBeGreaterThan(easing);
    expect(parseScene(JSON.parse(JSON.stringify(store.scene)))!.animation!.actions.find((x) => x.id === act.id)!.blendCurve).toBe('out');
  });

  it('the motion check\'s pop at a repeat\'s start is fixed with a blend between the repeats', () => {
    const { store, a, id, act } = swung(2);
    setClipOptions(store, id, { seam: 0 });
    const at = act().start + act().duration / 2;
    const fix = issueFix(store, { kind: 'pop', figure: a, start: at, end: at + 0.05, message: '' } as never)!;
    expect(fix.label).toBe('Blend between the repeats');
    fix.run();
    expect(act().source).toMatchObject({ seam: 0.3 });
  });
});
