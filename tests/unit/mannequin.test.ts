import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY } from '@/lib/body';
import { newFigure } from '@/lib/doc';
import { Ink } from '@/lib/ink';
import { IK_CHAINS, Mannequin, POLE_CHAINS, worldPos } from '@/lib/mannequin';
import { builtInPoses, poseScene } from '@/lib/poses';
import { angle, anglesOf, bonesOf, fromQuat } from '@/lib/pose';
import { JOINTS, type JointName } from '@/lib/types';

/** The 20 reference poses as scenes. */
const refScenes = () => builtInPoses().map((p) => poseScene(p));

const make = () => new Mannequin(new Ink(), DEFAULT_BODY, 'f1');

function minY(m: Mannequin) {
  let min = Infinity;
  m.forEachPoint((p) => { min = Math.min(min, p.y); });
  return min;
}

describe('Mannequin', () => {
  it('round-trips every preset through apply/read', () => {
    const m = make();
    for (const s of refScenes()) {
      const f = s.figures[0];
      m.apply(f);
      const read = m.read().bones;
      for (const j of JOINTS) expect(fromQuat(read[j]).angleTo(fromQuat(f.bones[j])), `${s.name} ${j}`).toBeLessThan(1e-3);
    }
  });

  it('rests on the floor when grounded', () => {
    const m = make();
    for (const s of refScenes()) {
      m.apply(s.figures[0]);
      expect(Math.abs(minY(m)), s.name).toBeLessThan(1e-6);
    }
  });

  it('keeps its height when not grounded', () => {
    const m = make();
    m.apply(newFigure({ grounded: false, position: [0, 1.5, 0] }));
    expect(m.joints.hips.position.y).toBe(1.5);
  });

  it('scales with the height setting', () => {
    for (const height of [1.3, 1.7, 2.0]) {
      const m = new Mannequin(new Ink(), { ...DEFAULT_BODY, height });
      m.apply(newFigure({ body: { ...DEFAULT_BODY, height } }));
      const box = new THREE.Box3();
      m.forEachPoint((p) => box.expandByPoint(p));
      expect(box.max.y).toBeGreaterThan(height * 0.95);
      expect(box.max.y).toBeLessThan(height * 1.08);
    }
  });

  it('solves two-bone IK to a reachable target and keeps the hand orientation', () => {
    const m = make();
    m.apply(newFigure());
    const wrist = m.joints.leftHand;
    const q0 = wrist.getWorldQuaternion(new THREE.Quaternion());
    const target = worldPos(m.joints.leftUpperArm).add(new THREE.Vector3(0.25, 0.1, 0.2));
    m.solveIK(IK_CHAINS.leftHand, target, q0);
    expect(worldPos(wrist).distanceTo(target)).toBeLessThan(1e-3);
    expect(wrist.getWorldQuaternion(new THREE.Quaternion()).angleTo(q0)).toBeLessThan(1e-4);
  });

  it('stretches towards an unreachable target without breaking', () => {
    const m = make();
    m.apply(newFigure());
    const shoulder = worldPos(m.joints.leftUpperArm);
    const target = shoulder.clone().add(new THREE.Vector3(5, 0, 0));
    m.solveIK(IK_CHAINS.leftHand, target);
    const wrist = worldPos(m.joints.leftHand);
    expect(wrist.clone().sub(shoulder).normalize().dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(0.99);
    for (const q of Object.values(m.read().bones)) q!.forEach((a) => expect(Number.isFinite(a)).toBe(true));
  });

  it('bends knees forward when the hips are lowered', () => {
    const m = make();
    m.apply(newFigure());
    const ankle = worldPos(m.joints.leftFoot);
    m.joints.hips.position.y -= 0.2;
    m.object.updateMatrixWorld(true);
    m.solveIK(IK_CHAINS.leftFoot, ankle);
    expect(worldPos(m.joints.leftFoot).distanceTo(ankle)).toBeLessThan(1e-3);
    expect(worldPos(m.joints.leftLowerLeg).z).toBeGreaterThan(worldPos(m.joints.leftUpperLeg).z);
  });

  it('swivels the elbow without moving the hand', () => {
    const m = make();
    m.apply(newFigure({ bones: bonesOf({ leftUpperArm: [-40, 0, 20], leftLowerArm: [-90, 0, 0] }) }));
    const wrist = worldPos(m.joints.leftHand);
    const pole = worldPos(m.joints.leftLowerArm).add(new THREE.Vector3(1, 0, 0));
    m.swivel(POLE_CHAINS.leftLowerArm, pole);
    expect(worldPos(m.joints.leftHand).distanceTo(wrist)).toBeLessThan(1e-4);
  });

  it('clamps joints to their limits', () => {
    const m = make();
    m.apply(newFigure({ bones: bonesOf({ leftLowerLeg: [-60, 0, 0], rightLowerArm: [40, 0, 0] }) }));
    m.constrain(['leftLowerLeg', 'rightLowerArm']);
    const j = anglesOf(m.read().bones);
    expect(j.leftLowerLeg).toBeUndefined(); // clamped to [0, 0, 0]
    expect(j.rightLowerArm).toBeUndefined();
  });

  it('reads raised arms back without Euler flips', () => {
    const m = make();
    m.apply(newFigure({ bones: bonesOf({ leftUpperArm: [-10, 90, 150] }) }));
    // Disturb the quaternion slightly, as a gizmo drag would.
    const s = m.joints.leftUpperArm;
    s.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.001));
    const r = angle(m.read().bones, 'leftUpperArm', [-10, 90, 150]);
    expect(Math.abs(r[2] - 150)).toBeLessThan(1);
    expect(Math.abs(r[1] - 90)).toBeLessThan(1);
  });

  it('rebuilds only when the body changes', () => {
    const m = make();
    expect(m.setBody(DEFAULT_BODY)).toBe(false);
    expect(m.setBody({ ...DEFAULT_BODY, build: 0.9 })).toBe(true);
  });

  it('curls fingers into a fist', () => {
    const m = make();
    const tipOf = () => {
      const box = new THREE.Box3();
      m.parts.bodies.filter((b) => b.userData.joint === 'leftHand').forEach((b) => box.expandByObject(b, true)); // (precise: a skinned hand as its bones have it)
      return box;
    };
    m.apply(newFigure());
    const open = tipOf().getSize(new THREE.Vector3()).y;
    const f = newFigure();
    f.hands.L = { curl: [1, 1, 1, 1, 1], spread: 0 };
    m.apply(f);
    expect(tipOf().getSize(new THREE.Vector3()).y).toBeLessThan(open * 0.8);
  });
});

describe('sex characteristics', () => {
  const width = (m: Mannequin, a: 'leftUpperArm' | 'leftUpperLeg') => m.joints[a].getWorldPosition(new THREE.Vector3()).x * 2;
  it('gives male figures broader shoulders than hips, and female figures the reverse ratio', () => {
    const male = new Mannequin(new Ink(), { ...DEFAULT_BODY, sex: 0, bust: 0 });
    const female = new Mannequin(new Ink(), { ...DEFAULT_BODY, sex: 1 });
    const ratio = (m: Mannequin) => width(m, 'leftUpperArm') / width(m, 'leftUpperLeg');
    expect(ratio(male)).toBeGreaterThan(ratio(female) * 1.4);
    // An hourglass: her waist narrower than her hips and chest, by more than his.
    const across = (m: Mannequin, joint: JointName, y: number) => {
      const body = m.parts.bodies.find((b) => b.userData.joint === joint)!;
      const pos = (body.geometry as THREE.BufferGeometry).attributes.position;
      let w = 0;
      // (Its pieces are made in the hips' frame: heights from the hips joint.)
      const k = DEFAULT_BODY.height / 1.8;
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - y * k) < 0.01) w = Math.max(w, Math.abs(pos.getX(i)));
      return w;
    };
    const shape = (m: Mannequin) => ({ hips: across(m, 'hips', -0.05), waist: across(m, 'spine', 0.17), chest: across(m, 'chest', 0.42) });
    const [him, her] = [shape(male), shape(female)];
    expect(her.waist / her.hips).toBeLessThan(him.waist / him.hips - 0.1);
    expect(her.hips).toBeGreaterThan(her.chest);
    expect(him.chest).toBeGreaterThan(him.hips);
    // Breasts shaped into her chest: it reaches further forward with a bust than without.
    const flat = new Mannequin(new Ink(), { ...DEFAULT_BODY, sex: 1, bust: 0 });
    const front = (m: Mannequin) => {
      const body = m.parts.bodies.find((b) => b.userData.joint === 'chest')!;
      (body.geometry as THREE.BufferGeometry).computeBoundingBox();
      return (body.geometry as THREE.BufferGeometry).boundingBox!.max.z;
    };
    expect(front(female)).toBeGreaterThan(front(flat) + 0.01);
    for (const m of [male, female, flat]) m.dispose();
  });
});
