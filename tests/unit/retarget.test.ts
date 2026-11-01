import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY } from '@/lib/body';
import { newFigure } from '@/lib/doc';
import { Ink } from '@/lib/ink';
import { sided } from '@/lib/joints';
import { Mannequin, worldPos } from '@/lib/mannequin';
import { poseScene, referencePoses } from '@/lib/poses';

/** The 20 reference poses as scenes. */
const refScenes = () => referencePoses().map((p) => poseScene(p));
import { fromMediaPipe, LM, retarget } from '@/lib/retarget';
import type { JointName } from '@/lib/types';
import { angle } from '../../lib/pose';

/** Fake MediaPipe world landmarks taken from a posed mannequin. */
function landmarksFrom(m: Mannequin) {
  const at = (j: JointName, local?: [number, number, number]) =>
    local ? m.joints[j].localToWorld(new THREE.Vector3(...local)) : worldPos(m.joints[j]);
  const pts: THREE.Vector3[] = Array.from({ length: 33 }, () => new THREE.Vector3());
  const set = (i: number, v: THREE.Vector3) => { pts[i] = v; };
  set(LM.nose, at('head', [0, 0.1, 0.11]));
  set(LM.earL, at('head', [0.085, 0.1, 0]));
  set(LM.earR, at('head', [-0.085, 0.1, 0]));
  for (const s of ['L', 'R'] as const) {
    set(LM[`shoulder${s}`], at(sided('UpperArm', s)));
    set(LM[`elbow${s}`], at(sided('LowerArm', s)));
    set(LM[`wrist${s}`], at(sided('Hand', s)));
    set(LM[`index${s}`], at(sided('Hand', s), [0, -0.15, 0.03]));
    set(LM[`pinky${s}`], at(sided('Hand', s), [0, -0.13, -0.03]));
    set(LM[`hip${s}`], at(sided('UpperLeg', s)));
    set(LM[`knee${s}`], at(sided('LowerLeg', s)));
    set(LM[`ankle${s}`], at(sided('Foot', s)));
    set(LM[`heel${s}`], at(sided('Foot', s), [0, -0.06, -0.04]));
    set(LM[`toe${s}`], at(sided('Foot', s), [0, -0.06, 0.16]));
  }
  // Into MediaPipe's frame: x right, y down, z away from the camera.
  return pts.map((p) => ({ x: p.x, y: -p.y, z: -p.z, visibility: 1 }));
}

const BONES: [JointName, JointName][] = [
  ['leftUpperArm', 'leftLowerArm'], ['leftLowerArm', 'leftHand'], ['rightUpperArm', 'rightLowerArm'], ['rightLowerArm', 'rightHand'],
  ['leftUpperLeg', 'leftLowerLeg'], ['leftLowerLeg', 'leftFoot'], ['rightUpperLeg', 'rightLowerLeg'], ['rightLowerLeg', 'rightFoot'],
];

describe('retarget', () => {
  it('recovers limb directions of every preset from its landmarks', () => {
    const source = new Mannequin(new Ink(), DEFAULT_BODY);
    const target = new Mannequin(new Ink(), DEFAULT_BODY);
    for (const s of refScenes()) {
      source.apply(s.figures[0]);
      const { bones, skipped } = retarget(target, fromMediaPipe(landmarksFrom(source)));
      expect(skipped).toEqual([]);
      target.apply(newFigure({ bones }));
      // Compare world-space bone directions (how the spine bend is split between joints may differ).
      const rel = (m: Mannequin, a: JointName, b: JointName) => worldPos(m.joints[b]).sub(worldPos(m.joints[a])).normalize();
      for (const [a, b] of BONES) {
        const angle = rel(source, a, b).angleTo(rel(target, a, b)) * (180 / Math.PI);
        expect(angle, `${s.name}: ${a}→${b}`).toBeLessThan(6);
      }
    }
  });

  it('leaves what landmarks do not see at rest: the upper chest, the shoulders and the toes (#30)', () => {
    const source = new Mannequin(new Ink(), DEFAULT_BODY);
    const target = new Mannequin(new Ink(), DEFAULT_BODY);
    source.apply(refScenes()[3].figures[0]);
    const { bones } = retarget(target, fromMediaPipe(landmarksFrom(source)));
    for (const j of ['upperChest', 'leftShoulder', 'rightShoulder', 'leftToes', 'rightToes'] as const) expect(angle(bones, j), j).toEqual([0, 0, 0]);
  });

  it('keeps elbows and knees as pure hinges', () => {
    const source = new Mannequin(new Ink(), DEFAULT_BODY);
    const target = new Mannequin(new Ink(), DEFAULT_BODY);
    source.apply(refScenes()[12].figures[0]); // deep squat
    const { bones } = retarget(target, fromMediaPipe(landmarksFrom(source)));
    for (const j of ['leftLowerArm', 'rightLowerArm', 'leftLowerLeg', 'rightLowerLeg'] as const) {
      const r = angle(bones, j);
      expect(Math.abs(r[1]) + Math.abs(r[2]), j).toBeLessThan(0.5);
    }
  });

  it('skips limbs that are not visible', () => {
    const source = new Mannequin(new Ink(), DEFAULT_BODY);
    source.apply(newFigure());
    const lms = landmarksFrom(source);
    lms[LM.kneeR].visibility = 0.1;
    const { skipped } = retarget(new Mannequin(new Ink(), DEFAULT_BODY), fromMediaPipe(lms));
    expect(skipped).toEqual(['leg (right)']);
  });
});
