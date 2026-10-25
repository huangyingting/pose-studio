import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY } from '@/lib/body';
import { newFigure } from '@/lib/doc';
import { Ink } from '@/lib/ink';
import { IK_CHAINS, Mannequin, POLE_CHAINS, worldPos } from '@/lib/mannequin';
import { presetScenes } from '@/lib/presets';

const make = () => new Mannequin(new Ink(), DEFAULT_BODY, 'f1');

function minY(m: Mannequin) {
  let min = Infinity;
  m.forEachPoint((p) => { min = Math.min(min, p.y); });
  return min;
}

describe('Mannequin', () => {
  it('round-trips every preset through apply/read', () => {
    const m = make();
    for (const s of presetScenes()) {
      const f = s.figures[0];
      m.apply(f);
      expect(m.read().joints, s.name).toEqual(f.joints);
    }
  });

  it('rests on the floor when grounded', () => {
    const m = make();
    for (const s of presetScenes()) {
      m.apply(s.figures[0]);
      expect(Math.abs(minY(m)), s.name).toBeLessThan(1e-6);
    }
  });

  it('keeps its height when not grounded', () => {
    const m = make();
    m.apply(newFigure({ grounded: false, position: [0, 1.5, 0] }));
    expect(m.joints.root.position.y).toBe(1.5);
  });

  it('scales with the height setting', () => {
    for (const height of [1.3, 1.7, 2.0]) {
      const m = new Mannequin(new Ink(), { ...DEFAULT_BODY, height });
      m.apply(newFigure({ body: { ...DEFAULT_BODY, height }, joints: {} }));
      const box = new THREE.Box3();
      m.forEachPoint((p) => box.expandByPoint(p));
      expect(box.max.y).toBeGreaterThan(height * 0.95);
      expect(box.max.y).toBeLessThan(height * 1.08);
    }
  });

  it('solves two-bone IK to a reachable target and keeps the hand orientation', () => {
    const m = make();
    m.apply(newFigure());
    const wrist = m.joints.wristL;
    const q0 = wrist.getWorldQuaternion(new THREE.Quaternion());
    const target = worldPos(m.joints.shoulderL).add(new THREE.Vector3(0.25, 0.1, 0.2));
    m.solveIK(IK_CHAINS.wristL, target, q0);
    expect(worldPos(wrist).distanceTo(target)).toBeLessThan(1e-3);
    expect(wrist.getWorldQuaternion(new THREE.Quaternion()).angleTo(q0)).toBeLessThan(1e-4);
  });

  it('stretches towards an unreachable target without breaking', () => {
    const m = make();
    m.apply(newFigure());
    const shoulder = worldPos(m.joints.shoulderL);
    const target = shoulder.clone().add(new THREE.Vector3(5, 0, 0));
    m.solveIK(IK_CHAINS.wristL, target);
    const wrist = worldPos(m.joints.wristL);
    expect(wrist.clone().sub(shoulder).normalize().dot(new THREE.Vector3(1, 0, 0))).toBeGreaterThan(0.99);
    for (const v of Object.values(m.read().joints)) v!.forEach((a) => expect(Number.isFinite(a)).toBe(true));
  });

  it('bends knees forward when the hips are lowered', () => {
    const m = make();
    m.apply(newFigure());
    const ankle = worldPos(m.joints.ankleL);
    m.joints.root.position.y -= 0.2;
    m.object.updateMatrixWorld(true);
    m.solveIK(IK_CHAINS.ankleL, ankle);
    expect(worldPos(m.joints.ankleL).distanceTo(ankle)).toBeLessThan(1e-3);
    expect(worldPos(m.joints.kneeL).z).toBeGreaterThan(worldPos(m.joints.hipL).z);
  });

  it('swivels the elbow without moving the hand', () => {
    const m = make();
    m.apply(newFigure({ joints: { shoulderL: [-40, 0, 20], elbowL: [-90, 0, 0] } }));
    const wrist = worldPos(m.joints.wristL);
    const pole = worldPos(m.joints.elbowL).add(new THREE.Vector3(1, 0, 0));
    m.swivel(POLE_CHAINS.elbowL, pole);
    expect(worldPos(m.joints.wristL).distanceTo(wrist)).toBeLessThan(1e-4);
  });

  it('clamps joints to their limits', () => {
    const m = make();
    m.apply(newFigure({ joints: { kneeL: [-60, 0, 0], elbowR: [40, 0, 0] } }));
    m.constrain(['kneeL', 'elbowR']);
    const j = m.read().joints;
    expect(j.kneeL).toBeUndefined(); // clamped to [0, 0, 0]
    expect(j.elbowR).toBeUndefined();
  });

  it('reads raised arms back without Euler flips', () => {
    const m = make();
    m.apply(newFigure({ joints: { shoulderL: [-10, 90, 150] } }));
    // Disturb the quaternion slightly, as a gizmo drag would.
    const s = m.joints.shoulderL;
    s.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.001));
    const r = m.read().joints.shoulderL!;
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
      m.parts.bodies.filter((b) => b.userData.joint === 'wristL').forEach((b) => box.expandByObject(b));
      return box;
    };
    m.apply(newFigure({ joints: {} }));
    const open = tipOf().getSize(new THREE.Vector3()).y;
    const f = newFigure({ joints: {} });
    f.hands.L = { curl: [1, 1, 1, 1, 1], spread: 0 };
    m.apply(f);
    expect(tipOf().getSize(new THREE.Vector3()).y).toBeLessThan(open * 0.8);
  });
});

describe('sex characteristics', () => {
  const width = (m: Mannequin, a: 'shoulderL' | 'hipL') => m.joints[a].getWorldPosition(new THREE.Vector3()).x * 2;
  it('gives male figures broader shoulders than hips, and female figures the reverse ratio', () => {
    const male = new Mannequin(new Ink(), { ...DEFAULT_BODY, sex: 0, bust: 0 });
    const female = new Mannequin(new Ink(), { ...DEFAULT_BODY, sex: 1 });
    const ratio = (m: Mannequin) => width(m, 'shoulderL') / width(m, 'hipL');
    expect(ratio(male)).toBeGreaterThan(ratio(female) * 1.4);
    // Pectoral contour lines on the male chest, breasts as separate forms on the female one.
    const chestParts = (m: Mannequin) => m.parts.bodies.filter((b) => b.userData.joint === 'chest').length;
    expect(chestParts(female)).toBe(chestParts(male) + 2);
    male.dispose();
    female.dispose();
  });
});
