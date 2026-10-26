import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY } from '@/lib/body';
import { newFigure } from '@/lib/doc';
import { Ink } from '@/lib/ink';
import { Mannequin, worldPos } from '@/lib/mannequin';
import { builtInPoses, poseScene } from '@/lib/poses';

/** The 20 reference poses as scenes. */
const refScenes = () => builtInPoses().map((p) => poseScene(p));
import { fromMediaPipe, LM, retarget } from '@/lib/retarget';
import type { JointName } from '@/lib/types';

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
    const n = (b: string) => `${b}${s}` as JointName;
    set(LM[`shoulder${s}`], at(n('shoulder')));
    set(LM[`elbow${s}`], at(n('elbow')));
    set(LM[`wrist${s}`], at(n('wrist')));
    set(LM[`index${s}`], at(n('wrist'), [0, -0.15, 0.03]));
    set(LM[`pinky${s}`], at(n('wrist'), [0, -0.13, -0.03]));
    set(LM[`hip${s}`], at(n('hip')));
    set(LM[`knee${s}`], at(n('knee')));
    set(LM[`ankle${s}`], at(n('ankle')));
    set(LM[`heel${s}`], at(n('ankle'), [0, -0.06, -0.04]));
    set(LM[`toe${s}`], at(n('ankle'), [0, -0.06, 0.16]));
  }
  // Into MediaPipe's frame: x right, y down, z away from the camera.
  return pts.map((p) => ({ x: p.x, y: -p.y, z: -p.z, visibility: 1 }));
}

const BONES: [JointName, JointName][] = [
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
];

describe('retarget', () => {
  it('recovers limb directions of every preset from its landmarks', () => {
    const source = new Mannequin(new Ink(), DEFAULT_BODY);
    const target = new Mannequin(new Ink(), DEFAULT_BODY);
    for (const s of refScenes()) {
      source.apply(s.figures[0]);
      const { joints, skipped } = retarget(target, fromMediaPipe(landmarksFrom(source)));
      expect(skipped).toEqual([]);
      target.apply(newFigure({ joints }));
      // Compare world-space bone directions (how the spine bend is split between joints may differ).
      const rel = (m: Mannequin, a: JointName, b: JointName) => worldPos(m.joints[b]).sub(worldPos(m.joints[a])).normalize();
      for (const [a, b] of BONES) {
        const angle = rel(source, a, b).angleTo(rel(target, a, b)) * (180 / Math.PI);
        expect(angle, `${s.name}: ${a}→${b}`).toBeLessThan(6);
      }
    }
  });

  it('keeps elbows and knees as pure hinges', () => {
    const source = new Mannequin(new Ink(), DEFAULT_BODY);
    const target = new Mannequin(new Ink(), DEFAULT_BODY);
    source.apply(refScenes()[12].figures[0]); // deep squat
    const { joints } = retarget(target, fromMediaPipe(landmarksFrom(source)));
    for (const j of ['elbowL', 'elbowR', 'kneeL', 'kneeR'] as const) {
      const r = joints[j] ?? [0, 0, 0];
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
