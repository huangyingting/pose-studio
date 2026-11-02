import { describe, expect, it } from 'vitest';
import { applyUpperBody, deleteCorrection, travelTo } from '@/lib/actions';
import { clipById } from '@/lib/assets';
import { samplePart } from '@/lib/clip';
import { actionsOf, figurePoseAt } from '@/lib/evaluate';
import { angle, withAngles } from '@/lib/pose';
import { checkMotion } from '@/lib/qa';
import { correctionTimesOf } from '@/lib/track';
import { fresh, captured } from '../fixtures/scenes';

describe('layers: an upper body over what a figure does, and corrections on top', () => {
  it('waves while walking: the arms wave, the legs walk', () => {
    const { store, a } = fresh();
    const walk = travelTo(store, a, [0, 3], 'walk')!;
    store.setTime(0.5);
    const waving = captured('waving');
    expect(applyUpperBody(store, a, waving)).toBe(true);
    const over = actionsOf(store.scene.animation!, a, 'upper');
    expect(over).toHaveLength(1);
    const wave = clipById(waving)!;
    // Well inside it, the right arm is as the wave has it; the legs are walking.
    const t = 0.5 + wave.duration / 2;
    const f = figurePoseAt(store.scene, a, t)!;
    const arm = samplePart(wave.parts[0], wave.duration / 2, wave.duration, wave.loop).bones.rightUpperArm!;
    expect(angle(f.bones, 'rightUpperArm')).toEqual(angle({ rightUpperArm: arm }, 'rightUpperArm'));
    expect(f.position[2]).toBeGreaterThan(0.3);
    expect(f.position[2]).toBeLessThan(3);
    expect(t).toBeLessThan(walk.to);
    // Nothing the motion check finds but the captured wave's own quick forearm twists (the arm is
    // the wave's exactly, above).
    expect(checkMotion(store.scene).map((i) => i.message).filter((m) => !/^(Left|Right) forearm snaps/.test(m))).toEqual([]);
    // A walk is not waved over (it is not an upper-body motion).
    expect(applyUpperBody(store, a, 'walk')).toBe(false);
  }, 60_000);

  it('edits over a motion are corrections, listed and removable', () => {
    const { store, a } = fresh();
    travelTo(store, a, [0, 3], 'walk');
    store.setTime(0.5);
    store.updateFigure(a, (f) => ({ ...f, bones: withAngles(f.bones, { head: [20, 0, 0] }) }));
    expect(correctionTimesOf(store.scene.animation!, a)).toEqual([0.5]);
    expect(angle(figurePoseAt(store.scene, a, 0.5)!.bones, 'head')[0]).toBeCloseTo(20, 0);
    deleteCorrection(store, a, 0.5);
    expect(actionsOf(store.scene.animation!, a, 'correction')).toEqual([]);
  });
});
