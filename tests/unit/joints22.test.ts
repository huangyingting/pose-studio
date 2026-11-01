import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { newFigure } from '@/lib/doc';
import { Rig, reach } from '@/lib/relations';
import { RIG_PARENT, angle, anglesOf, bonesOf, fromQuat, rigTurns, storedTurns, withAngles, type Bones } from '@/lib/pose';
import { worldTurns } from '@/lib/skeleton';
import { JOINTS, type JointName } from '@/lib/types';

/* The 22 joints (#30): the upper chest, the shoulders and the toes as joints of their own. */

const deg = (q: THREE.Quaternion, r: THREE.Quaternion) => {
  const d = q.clone().invert().multiply(r);
  return (2 * Math.atan2(Math.hypot(d.x, d.y, d.z), Math.abs(d.w)) * 180) / Math.PI;
};

describe('the 22 joints (#30)', () => {
  it('22 joints, each after its parent in the body', () => {
    expect(JOINTS).toHaveLength(22);
    for (const j of JOINTS) if (j !== 'hips') expect(JOINTS.indexOf(RIG_PARENT[j as Exclude<JointName, 'hips'>]), j).toBeLessThan(JOINTS.indexOf(j));
  });

  it('stored and in-the-body turns convert both ways; a pose without the five means the same either way', () => {
    // A legacy pose: the five at rest, every joint's own turn its stored one.
    const legacy = bonesOf({ chest: [10, 20, 0], neck: [-15, 5, 0], leftUpperArm: [-40, 10, 30], rightUpperArm: [20, 0, -60] });
    const own = rigTurns(legacy);
    for (const j of JOINTS) expect(deg(own[j], fromQuat(legacy[j])), j).toBeLessThan(0.01);
    // With them: back and forth unchanged.
    const full = bonesOf({ chest: [10, 20, 0], upperChest: [12, -15, 5], neck: [-15, 5, 0], leftShoulder: [3, -10, 25], rightShoulder: [0, 12, -20], leftUpperArm: [-40, 10, 30], leftToes: [-30, 0, 0] });
    const back = storedTurns(rigTurns(full));
    for (const j of JOINTS) expect(deg(fromQuat(back[j]), fromQuat(full[j])), j).toBeLessThan(0.01);
    // Angles read back as set.
    expect(anglesOf(full).leftShoulder).toEqual([3, -10, 25]);
    expect(angle(full, 'upperChest')).toEqual([12, -15, 5]);
  });

  it('raising a shoulder raises its arm with it; twisting the upper chest turns the neck and arms; the others stay', () => {
    const pose = bonesOf({ leftUpperArm: [-30, 0, 10], rightUpperArm: [0, 0, -15] });
    const raised = withAngles(pose, { leftShoulder: [0, 0, 20] });
    const before = worldTurns(pose);
    const after = worldTurns(raised);
    // The left arm turned by the shoulder's 20°; its own angles kept; the right arm and the head as they were.
    expect(deg(before.get('leftUpperArm')!, after.get('leftUpperArm')!)).toBeCloseTo(20, 0);
    expect(angle(raised, 'leftUpperArm')).toEqual([-30, 0, 10]);
    expect(deg(before.get('rightUpperArm')!, after.get('rightUpperArm')!)).toBeLessThan(0.01);
    expect(deg(before.get('head')!, after.get('head')!)).toBeLessThan(0.01);
    const twisted = worldTurns(withAngles(pose, { upperChest: [0, 25, 0] }));
    for (const j of ['neck', 'head', 'leftUpperArm', 'rightUpperArm'] as const) expect(deg(before.get(j)!, twisted.get(j)!), j).toBeCloseTo(25, 0);
    expect(deg(before.get('spine')!, twisted.get('spine')!)).toBeLessThan(0.01);
  });

  it('a hand reaches its target from a raised shoulder, the shoulder as posed (it is not solved)', () => {
    const rig = new Rig();
    const f = { ...newFigure(), bones: withAngles(bonesOf({}), { leftShoulder: [0, -10, 20], upperChest: [10, 15, 0] }), position: [0, 1, 0] as [number, number, number], grounded: false };
    const target = new THREE.Vector3(0.35, 1.25, 0.45);
    const { bones, reached } = reach(rig, f, 'L', target);
    expect(reached).toBe(true);
    expect(angle(bones, 'leftShoulder')).toEqual([0, -10, 20]);
    expect(angle(bones, 'upperChest')).toEqual([10, 15, 0]);
    const hand = rig.model({ ...f, bones }).joints.leftHand.getWorldPosition(new THREE.Vector3());
    expect(hand.distanceTo(target)).toBeLessThan(0.12);
    rig.dispose();
  });

  it('on the mannequin: a shrug lifts the arm and hand, the upper chest leans the shoulders and head, the toes bend at the ball of the foot', () => {
    const rig = new Rig();
    const at = (bones: Bones, j: JointName) => rig.model({ ...newFigure(), bones, position: [0, 1, 0], grounded: false }).joints[j].getWorldPosition(new THREE.Vector3());
    const rest = bonesOf({});
    const shrug = withAngles(rest, { leftShoulder: [0, 0, 25] });
    expect(at(shrug, 'leftUpperArm').y - at(rest, 'leftUpperArm').y).toBeGreaterThan(0.03);
    expect(at(shrug, 'leftHand').y - at(rest, 'leftHand').y).toBeGreaterThan(0.03);
    expect(at(shrug, 'rightHand').distanceTo(at(rest, 'rightHand'))).toBeLessThan(0.001);
    const lean = withAngles(rest, { upperChest: [20, 0, 0] });
    expect(at(lean, 'head').z - at(rest, 'head').z).toBeGreaterThan(0.04);
    expect(at(lean, 'spine').distanceTo(at(rest, 'spine'))).toBeLessThan(0.001);
    // The toes' joint is at the ball of the foot: bending them leaves the ankle where it was.
    const curl = withAngles(rest, { leftToes: [-40, 0, 0] });
    expect(at(curl, 'leftFoot').distanceTo(at(rest, 'leftFoot'))).toBeLessThan(0.001);
    expect(at(rest, 'leftToes').z - at(rest, 'leftFoot').z).toBeGreaterThan(0.05);
    rig.dispose();
  });
});
