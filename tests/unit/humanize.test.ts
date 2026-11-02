import { describe, expect, it } from 'vitest';
import { humanize } from '@/lib/humanize';
import { angleToQuat, quatToAngle } from '@/lib/pose';
import type { Pose } from '@/lib/types';

/** Frames of a pose whose chest and right forearm turn 40° at once at 0.5 s and stay (keyed, as a made motion is). */
const frames = (fps: number) => Array.from({ length: Math.round(2 * fps) + 1 }, (_, i) => {
  const t = i / fps;
  const deg = t < 0.5 ? 0 : 40;
  const pose: Pose = {
    bones: { chest: angleToQuat('chest', [deg, 0, 0]), rightLowerArm: angleToQuat('rightLowerArm', [-deg, 0, 0]), leftLowerLeg: angleToQuat('leftLowerLeg', [deg, 0, 0]) },
    position: [0, 0.9, 0], hands: { L: { curl: [0, 0, 0, 0, 0], spread: 0 }, R: { curl: [0, 0, 0, 0, 0], spread: 0 } }, grounded: true,
  } as unknown as Pose;
  return { t, pose };
});

describe('life in a made motion (lib/humanize.ts)', () => {
  it('the trunk and the arms follow a moment later, carry on a little past where they stop and settle; the legs and the place are as keyed', () => {
    const fps = 24;
    const out = humanize(frames(fps), fps, false, true);
    const chest = out.map((f) => quatToAngle('chest', f.pose.bones.chest!)[0]);
    const arm = out.map((f) => quatToAngle('rightLowerArm', f.pose.bones.rightLowerArm!)[0]);
    const at = (t: number) => Math.round(t * fps);
    // A moment after the key, not there yet.
    expect(chest[at(0.55)]).toBeLessThan(30);
    // Past it, then settling back (breathing a degree or so either way).
    expect(Math.max(...chest)).toBeGreaterThan(41.5);
    expect(Math.abs(chest[at(1.9)] - 40)).toBeLessThan(2);
    // The forearm, further out, lags more.
    expect(-arm[at(0.55)]).toBeLessThan(chest[at(0.55)]);
    // The legs as keyed; where the body is too.
    expect(out.map((f) => Math.round(quatToAngle('leftLowerLeg', f.pose.bones.leftLowerLeg!)[0]))).toEqual(frames(fps).map((f) => Math.round(quatToAngle('leftLowerLeg', f.pose.bones.leftLowerLeg!)[0])));
    expect(out.every((f) => f.pose.position[1] === 0.9)).toBe(true);
  });

  it('keeps the arms as keyed where they hold something (arms off)', () => {
    const out = humanize(frames(24), 24, false, false);
    expect(out.map((f) => Math.round(quatToAngle('rightLowerArm', f.pose.bones.rightLowerArm!)[0]))).toEqual(frames(24).map((f) => Math.round(quatToAngle('rightLowerArm', f.pose.bones.rightLowerArm!)[0])));
  });
});
