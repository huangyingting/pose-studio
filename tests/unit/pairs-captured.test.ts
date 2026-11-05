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

// (What the people recorded did themselves is folded away, as recorded.)
const problems = (scene: Parameters<typeof checkMotion>[0]) => checkMotion(scene).filter((i) => i.kind !== 'camera' && i.kind !== 'hidden' && !i.recorded).map((i) => i.message);
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

  it('giving CPR: the rescuer kneels by the patient, hands at the chest, and it is clean', () => {
    const rig = new Rig();
    for (const pair of PAIRS) {
      const scene = given('cpr', pair);
      // (Pushing on it: the hands within a hand's breadth or so of the chest's surface.)
      for (const t of [1, 4, 7]) {
        const [r, p] = sceneAt(scene, t).figures.map((f) => rig.model(f));
        const chest = p.joints.chest.getWorldPosition(new THREE.Vector3());
        const near = Math.min(...(['leftHand', 'rightHand'] as const).map((h) => r.joints[h].getWorldPosition(new THREE.Vector3()).distanceTo(chest)));
        expect(near, `${pair[0].name} with ${pair[1].name} at ${t} s`).toBeLessThan(0.35);
      }
      expect(problems(scene), `${pair[0].name} with ${pair[1].name}`).toEqual([]);
    }
    rig.dispose();
  }, 1_200_000);

  it('holding someone hostage: the arm round them, not into them, and it is clean', () => {
    for (const pair of adults) expect(problems(given('hostage-situation', pair)), `${pair[0].name} with ${pair[1].name}`).toEqual([]);
  }, 1_200_000);

  it('letting a hostage go: from the same hold, the captor\'s hand at their chest, then away, and it is clean', () => {
    const rig = new Rig();
    for (const pair of adults) {
      const scene = given('release-hostage', pair);
      const [c, h] = sceneAt(scene, 0.1).figures.map((f) => rig.model(f));
      expect(c.joints.leftHand.getWorldPosition(new THREE.Vector3()).distanceTo(h.joints.chest.getWorldPosition(new THREE.Vector3())), `${pair[0].name} with ${pair[1].name}`).toBeLessThan(0.35);
      expect(problems(scene), `${pair[0].name} with ${pair[1].name}`).toEqual([]);
    }
    rig.dispose();
  }, 1_200_000);

  it('a hug: both arms round the other while they hold it (their hands at the other\'s back), and it is clean', () => {
    const rig = new Rig();
    for (const pair of PAIRS) {
      const scene = given('hug', pair);
      const ms = sceneAt(scene, 1.8).figures.map((f) => rig.model(f));
      ms.forEach((m, n) => {
        const chest = ms[1 - n].joints.chest.getWorldPosition(new THREE.Vector3());
        for (const h of ['leftHand', 'rightHand'] as const) expect(m.joints[h].getWorldPosition(new THREE.Vector3()).distanceTo(chest), `${pair[0].name} with ${pair[1].name}: ${n ? 'partner' : 'lead'}'s ${h}`).toBeLessThan(0.35);
      });
      expect(problems(scene), `${pair[0].name} with ${pair[1].name}`).toEqual([]);
    }
    rig.dispose();
  }, 1_200_000);

  it('a kiss (grown-ups; the lead as tall or taller, the partner rising onto her toes): faces together, and it is clean', () => {
    const rig = new Rig();
    for (const pair of adults.filter(([, pb]) => pb.name !== 'Child')) {
      const scene = given('kiss', pair);
      expect(problems(scene), `${pair[0].name} with ${pair[1].name}`).toEqual([]);
      const [a, b] = scene.figures;
      if (rig.model(b).joints.head.getWorldPosition(new THREE.Vector3()).y > rig.model(a).joints.head.getWorldPosition(new THREE.Vector3()).y + 0.01) continue;
      const [p, q] = sceneAt(scene, 2.07).figures.map((f) => rig.model(f).joints.head.getWorldPosition(new THREE.Vector3()));
      // (Head to head, centre to centre: two faces together are some 20 cm.)
      expect(p.distanceTo(q), `${pair[0].name} with ${pair[1].name}`).toBeLessThan(0.3);
    }
    rig.dispose();
  }, 1_200_000);

  it('a high five: the right palms meet up high (a grown-up\'s coming down to a child\'s), and it is clean', () => {
    const rig = new Rig();
    for (const pair of PAIRS) {
      const scene = given('high-five', pair);
      const [p, q] = sceneAt(scene, 0.56).figures.map((f) => rig.model(f).joints.rightHand.getWorldPosition(new THREE.Vector3()));
      // (Wrist to wrist: palms flat together, as staged, are some 15 cm.)
      expect(p.distanceTo(q), `${pair[0].name} with ${pair[1].name}`).toBeLessThan(0.19);
      expect(problems(scene), `${pair[0].name} with ${pair[1].name}`).toEqual([]);
    }
    rig.dispose();
  }, 1_200_000);
});
