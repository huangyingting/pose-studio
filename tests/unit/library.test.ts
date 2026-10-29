import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MOTIONS, MOTION_GROUPS } from '@/lib/motions';
import { POSE_GROUPS } from '@/lib/presets';
import { builtInPoses } from '@/lib/poses';
import { CAMERA_GROUPS, CAMERA_MOVES } from '@/lib/cameras';

describe('the library in groups', () => {
  it('puts every pose, motion and camera move in a group, and every group has some', () => {
    expect(builtInPoses().every((p) => POSE_GROUPS.includes(p.group))).toBe(true);
    for (const g of POSE_GROUPS) expect(builtInPoses().some((p) => p.group === g), g).toBe(true);
    // (Motions: the built-in ones and the Library's files.)
    const files = JSON.parse(readFileSync('public/motions/index.json', 'utf8')) as { group: string }[];
    for (const g of MOTION_GROUPS) expect([...MOTIONS, ...files].some((m) => m.group === g), g).toBe(true);
    for (const g of CAMERA_GROUPS) expect(CAMERA_MOVES.some((m) => m.group === g), g).toBe(true);
  });
});
