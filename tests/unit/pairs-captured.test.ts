import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addFigure, applyMotion } from '@/lib/actions';
import { sceneAt } from '@/lib/evaluate';
import { checkMotion } from '@/lib/qa';
import { Rig } from '@/lib/relations';
import { PAIRS } from '../fixtures/pairs';
import { fresh, captured } from '../fixtures/scenes';

/** One of two given to the first of two people in these builds (side by side): the scene. */
function given(slug: string, [pa, pb]: (typeof PAIRS)[number]) {
  const { store, a } = fresh();
  store.updateFigure(a, (f) => ({ ...f, body: { ...pa.body } }));
  addFigure(store, [1, 0, 0]);
  const b = store.getState().activeFigure!;
  store.updateFigure(b, (f) => ({ ...f, body: { ...pb.body } }));
  expect(applyMotion(store, a, captured(slug))).toBe(true);
  return store.scene;
}

const problems = (scene: Parameters<typeof checkMotion>[0]) => checkMotion(scene).filter((i) => i.kind !== 'camera' && i.kind !== 'hidden').map((i) => i.message);
// (A child holding someone taller hostage is not done.)
const adults = PAIRS.filter(([pa]) => pa.name !== 'Child');

describe('captured motions of two on every pairing of builds', () => {
  it('shaking hands: the right hands meet while they shake (the shorter one reaching), and it is clean', () => {
    const rig = new Rig();
    for (const pair of PAIRS) {
      const scene = given('shaking-hands', pair);
      // (As they hold: their hands are still coming together before that.)
      for (const t of [1.9, 2.3]) {
        const [p, q] = sceneAt(scene, t).figures.map((f) => rig.model(f).joints.rightHand.getWorldPosition(new THREE.Vector3()));
        expect(p.distanceTo(q), `${pair[0].name} with ${pair[1].name} at ${t} s`).toBeLessThan(0.06);
      }
      expect(problems(scene), `${pair[0].name} with ${pair[1].name}`).toEqual([]);
    }
    rig.dispose();
  }, 1_200_000);

  it('holding someone hostage: clean but for an arm round a big build a little into them', () => {
    for (const pair of adults) {
      const left = problems(given('hostage-situation', pair)).filter((m) => !/forearm passes [1-9] cm into/.test(m));
      expect(left, `${pair[0].name} with ${pair[1].name}`).toEqual([]);
    }
  }, 1_200_000);
});
