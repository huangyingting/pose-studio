import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY } from '@/lib/body';
import { newFigure } from '@/lib/doc';
import { Ink } from '@/lib/ink';
import { Mannequin, worldPos } from '@/lib/mannequin';
import { REST, angle, anglesOf, bonesOf, nearer, type Angles } from '@/lib/pose';
import { JOINTS } from '@/lib/types';

describe('poses as bone rotations', () => {
  it('rests in the VRM T-pose: every bone at identity holds the arms out to the sides', () => {
    const m = new Mannequin(new Ink(), DEFAULT_BODY);
    m.apply(newFigure({ bones: Object.fromEntries(JOINTS.map((j) => [j, REST])) }));
    for (const [shoulder, hand, out] of [['leftUpperArm', 'leftHand', 1], ['rightUpperArm', 'rightHand', -1]] as const) {
      const d = worldPos(m.joints[hand]).sub(worldPos(m.joints[shoulder]));
      expect(Math.sign(d.x)).toBe(out);
      expect(Math.abs(d.y)).toBeLessThan(0.02);
    }
    m.dispose();
  });

  it('reads back the angles it was given', () => {
    const angles = { hips: [10, 35, -5], leftUpperArm: [-40, 20, 60], rightLowerArm: [-90, 0, 0], leftUpperLeg: [-30, 10, 15] } satisfies Angles;
    expect(anglesOf(bonesOf(angles))).toEqual(angles);
  });

  it('picks the set of angles nearest the previous one', () => {
    // Laid back past the vertical (a flop): both readings are the same rotation.
    const flop = bonesOf({ hips: [-115, 180, 0] });
    expect(angle(flop, 'hips', [-110, 175, 0])).toEqual([-115, 180, 0]);
    expect(nearer('hips', [-65, 0, 180], [-110, 175, 0])).toEqual([-115, 180, 0]);
  });
});
