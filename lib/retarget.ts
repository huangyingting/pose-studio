import * as THREE from 'three';
import { Mannequin, rotateToward, rotateWorld, setWorldQuaternion, worldPos } from './mannequin';
import { JOINTS, type Figure, type JointName } from './types';

/** MediaPipe pose landmark indices. */
export const LM = {
  nose: 0, earL: 7, earR: 8,
  shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16,
  pinkyL: 17, pinkyR: 18, indexL: 19, indexR: 20,
  hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28,
  heelL: 29, heelR: 30, toeL: 31, toeR: 32,
} as const;

export interface Landmark3D {
  /** Metres, in the editor's frame: +X = subject's left when facing the camera, +Y up, +Z towards the camera. */
  p: THREE.Vector3;
  visibility: number;
}

/** Convert MediaPipe world landmarks (x right, y down, z away from camera) to the editor frame. */
export function fromMediaPipe(world: { x: number; y: number; z: number; visibility?: number }[]): Landmark3D[] {
  return world.map((l) => ({ p: new THREE.Vector3(l.x, -l.y, -l.z), visibility: l.visibility ?? 1 }));
}

function basis(x: THREE.Vector3, up: THREE.Vector3) {
  const X = x.clone().normalize();
  const Y = up.clone().addScaledVector(X, -up.dot(X)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}

/** Split a local rotation evenly between a joint and its parent (smoother spine/neck curves). */
function splitBetween(parent: THREE.Object3D, child: THREE.Object3D, childWorld: THREE.Quaternion) {
  setWorldQuaternion(child, childWorld);
  const local = child.quaternion.clone();
  const half = new THREE.Quaternion().slerp(local, 0.5);
  parent.quaternion.multiply(half);
  parent.updateMatrixWorld(true);
  setWorldQuaternion(child, childWorld);
}

const VISIBLE = 0.35;

/**
 * Pose a mannequin to match 3D landmarks. Elbows and knees are solved as true hinges
 * (bend only around their own axis), so the result stays editable with the sliders.
 * Returns the joint rotations and the list of limbs that could not be seen.
 */
export function retarget(m: Mannequin, lm: Landmark3D[]): { joints: Figure['joints']; skipped: string[] } {
  for (const j of JOINTS) m.joints[j].rotation.set(0, 0, 0);
  m.joints.root.position.set(0, 1, 0);
  m.object.updateMatrixWorld(true);
  const skipped: string[] = [];
  const P = (i: number) => lm[i].p.clone();
  const seen = (...ids: number[]) => ids.every((i) => lm[i] && lm[i].visibility >= VISIBLE);
  const mid = (a: number, b: number) => P(a).add(P(b)).multiplyScalar(0.5);

  // Torso: pelvis from the hip line, chest from the shoulder line, both sharing the spine "up".
  const up = mid(LM.shoulderL, LM.shoulderR).sub(mid(LM.hipL, LM.hipR));
  setWorldQuaternion(m.joints.root, basis(P(LM.hipL).sub(P(LM.hipR)), up));
  splitBetween(m.joints.spine, m.joints.chest, basis(P(LM.shoulderL).sub(P(LM.shoulderR)), up));

  // Head: up from the shoulders to the ears, forward towards the nose.
  if (seen(LM.nose, LM.earL, LM.earR)) {
    const ears = mid(LM.earL, LM.earR);
    const headUp = ears.clone().sub(mid(LM.shoulderL, LM.shoulderR));
    const forward = P(LM.nose).sub(ears);
    const Y = headUp.normalize();
    const Z = forward.addScaledVector(Y, -forward.dot(Y)).normalize();
    const X = new THREE.Vector3().crossVectors(Y, Z);
    splitBetween(m.joints.neck, m.joints.head, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)));
  } else {
    skipped.push('head');
  }

  const limb = (upper: JointName, middle: JointName, a: number, b: number, c: number, isLeg: boolean) => {
    if (!seen(a, b, c)) {
      skipped.push(upper.replace(/^(shoulder|hip)/, isLeg ? 'leg ' : 'arm ').replace(/L$/, '(left)').replace(/R$/, '(right)'));
      return false;
    }
    const u = m.joints[upper];
    const d1 = P(b).sub(P(a)).normalize();
    const d2 = P(c).sub(P(b)).normalize();
    rotateToward(u, worldPos(m.joints[middle]).sub(worldPos(u)), d1);

    const bend = d1.angleTo(d2);
    if (Math.sin(bend) > 0.05) {
      // Twist the upper bone so the hinge axis (its local X) is perpendicular to the bend plane.
      const hingeTarget = (isLeg ? new THREE.Vector3().crossVectors(d1, d2) : new THREE.Vector3().crossVectors(d2, d1)).normalize();
      const hinge = new THREE.Vector3(1, 0, 0).applyQuaternion(u.getWorldQuaternion(new THREE.Quaternion()));
      const twist = Math.atan2(d1.dot(hinge.clone().cross(hingeTarget)), hinge.dot(hingeTarget));
      rotateWorld(u, new THREE.Quaternion().setFromAxisAngle(d1, twist));
      m.joints[middle].rotation.set(isLeg ? bend : -bend, 0, 0);
      m.object.updateMatrixWorld(true);
    }
    return true;
  };

  if (limb('shoulderL', 'elbowL', LM.shoulderL, LM.elbowL, LM.wristL, false) && seen(LM.indexL, LM.pinkyL)) {
    const w = m.joints.wristL;
    rotateToward(w, new THREE.Vector3(0, -1, 0).applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion())), mid(LM.indexL, LM.pinkyL).sub(P(LM.wristL)));
  }
  if (limb('shoulderR', 'elbowR', LM.shoulderR, LM.elbowR, LM.wristR, false) && seen(LM.indexR, LM.pinkyR)) {
    const w = m.joints.wristR;
    rotateToward(w, new THREE.Vector3(0, -1, 0).applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion())), mid(LM.indexR, LM.pinkyR).sub(P(LM.wristR)));
  }
  if (limb('hipL', 'kneeL', LM.hipL, LM.kneeL, LM.ankleL, true) && seen(LM.heelL, LM.toeL)) {
    const a = m.joints.ankleL;
    rotateToward(a, new THREE.Vector3(0, 0, 1).applyQuaternion(a.getWorldQuaternion(new THREE.Quaternion())), P(LM.toeL).sub(P(LM.heelL)));
  }
  if (limb('hipR', 'kneeR', LM.hipR, LM.kneeR, LM.ankleR, true) && seen(LM.heelR, LM.toeR)) {
    const a = m.joints.ankleR;
    rotateToward(a, new THREE.Vector3(0, 0, 1).applyQuaternion(a.getWorldQuaternion(new THREE.Quaternion())), P(LM.toeR).sub(P(LM.heelR)));
  }

  return { joints: m.read().joints, skipped };
}
