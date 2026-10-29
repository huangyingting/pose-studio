import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY } from '@/lib/body';
import { newFigure } from '@/lib/doc';
import { Ink } from '@/lib/ink';
import { IK_CHAINS, Mannequin, POLE_CHAINS, worldPos } from '@/lib/mannequin';
import { poseScene, referencePoses } from '@/lib/poses';
import { angle, anglesOf, bonesOf, fromQuat } from '@/lib/pose';
import { JOINTS } from '@/lib/types';

/** The 20 reference poses as scenes. */
const refScenes = () => referencePoses().map((p) => poseScene(p));

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

  it('is slimmer or heavier by its build, as tall either way', () => {
    const size = (build: number) => {
      const m = new Mannequin(new Ink(), { ...DEFAULT_BODY, breadth: build });
      m.apply(newFigure({ body: { ...DEFAULT_BODY, breadth: build } }));
      const box = new THREE.Box3();
      m.forEachPoint((p) => box.expandByPoint(p));
      return box.getSize(new THREE.Vector3());
    };
    const [slim, as, heavy] = [size(0.85), size(1), size(1.3)];
    expect(heavy.z).toBeGreaterThan(as.z * 1.15);
    expect(slim.z).toBeLessThan(as.z * 0.95);
    expect(heavy.x).toBeGreaterThan(as.x);
    expect(Math.abs(heavy.y - as.y)).toBeLessThan(0.01);
  });

  it('rebuilds only when the body changes', () => {
    const m = make();
    expect(m.setBody(DEFAULT_BODY)).toBe(false);
    expect(m.setBody({ ...DEFAULT_BODY, height: 1.8 })).toBe(true);
    expect(m.setBody({ ...DEFAULT_BODY, height: 1.8, breadth: 1.2 })).toBe(true);
  });

  it('is picked where it is posed: a raised arm where it now is, not where it hung', () => {
    const m = make();
    const pick = (at: THREE.Vector3) => {
      m.object.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(at.clone().add(new THREE.Vector3(0, 0, 2)), new THREE.Vector3(0, 0, -1));
      return ray.intersectObjects(m.parts.bodies, false)[0]?.object.userData.joint;
    };
    m.apply(newFigure());
    expect(pick(worldPos(m.joints.leftLowerArm))).toBe('leftLowerArm');
    // Raised over the head: picked up there.
    m.apply(newFigure({ bones: bonesOf({ leftUpperArm: [0, 0, 170], leftLowerArm: [-5, 0, 0] }) }));
    const elbow = worldPos(m.joints.leftLowerArm);
    expect(elbow.y).toBeGreaterThan(worldPos(m.joints.head).y);
    expect(pick(elbow)).toBe('leftLowerArm');
  });

  it('has a nose on its blank face: which way it faces and looks shows', () => {
    const m = make();
    m.apply(newFigure());
    const nose = m.parts.bodies.find((b) => !(b as THREE.SkinnedMesh).isSkinnedMesh && b.userData.joint === 'head')!;
    expect(nose.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(worldPos(m.joints.head).z + 0.05);
    // The head turned to its left: the nose with it.
    m.apply(newFigure({ bones: bonesOf({ head: [0, 60, 0] }) }));
    expect(nose.getWorldPosition(new THREE.Vector3()).x).toBeGreaterThan(worldPos(m.joints.head).x + 0.03);
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
  it('draws a man as Y Bot and a woman as X Bot: his shoulders broader for his hips, her hips wider for her height', () => {
    const male = new Mannequin(new Ink(), { sex: 0, height: 1.7 });
    const female = new Mannequin(new Ink(), { sex: 1, height: 1.7 });
    const ratio = (m: Mannequin) => width(m, 'leftUpperArm') / width(m, 'leftUpperLeg');
    expect(ratio(male)).toBeGreaterThan(ratio(female) * 1.05);
    const hips = (m: Mannequin) => {
      const box = new THREE.Box3();
      m.parts.bodies.filter((b) => b.userData.joint === 'hips').forEach((b) => box.expandByObject(b, true));
      return box.max.x - box.min.x;
    };
    expect(hips(female)).toBeGreaterThan(hips(male));
    for (const m of [male, female]) m.dispose();
  });
});
