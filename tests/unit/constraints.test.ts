import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addFigure, arrange, holdOn, letGo, setDistance, startAnimation, travelTo } from '@/lib/actions';
import { duplicateScene, parseScene } from '@/lib/doc';
import { figurePoseAt, sceneAt } from '@/lib/evaluate';
import { Rig, contactPoint } from '@/lib/relations';
import { fresh } from '../fixtures/scenes';

const palm = (rig: Rig, f: Parameters<Rig['model']>[0], hand: 'leftHand' | 'rightHand') => rig.model(f).joints[hand].getWorldPosition(new THREE.Vector3());

describe('constraints: contacts held on the actual bodies', () => {
  it('a hand held on someone stays on them as they walk on, and lets go when asked', () => {
    const { store, a } = fresh();
    addFigure(store, [0.6, 0, 0]);
    const b = store.getState().activeFigure!;
    arrange(store, a, b, 'faceEachOther');
    setDistance(store, a, b, 0.45);
    startAnimation(store, 3);
    store.setTime(0);
    expect(holdOn(store, a, 'R', b, 'leftUpperArm')).toBe(true);
    const hold = store.scene.animation!.constraints![0];
    expect(hold).toMatchObject({ figure: a, bone: 'rightHand', start: 0, end: 3 });
    // B steps aside a little: A's hand follows its shoulder.
    store.setTime(0);
    travelTo(store, b, [0.5, 0.15], 'walk', { strafe: true });
    const rig = new Rig();
    for (const t of [0, 0.3, 0.8, 1.2]) {
      const s = sceneAt(store.scene, t);
      const fa = s.figures.find((f) => f.id === a)!;
      const fb = s.figures.find((f) => f.id === b)!;
      const shoulder = contactPoint(rig.model(fb), fb, 'leftUpperArm');
      // The wrist sits a palm short of the point it touches.
      expect(palm(rig, fa, 'rightHand').distanceTo(shoulder), String(t)).toBeLessThan(0.12);
    }
    // Let go at 1.5 s: the hold ends there and the arm comes down after.
    store.setTime(1.5);
    letGo(store, hold.id);
    expect(store.scene.animation!.constraints![0].end).toBeCloseTo(1.5, 5);
    const later = figurePoseAt(store.scene, a, 2.5)!;
    expect(palm(rig, later, 'rightHand').y).toBeLessThan(1.1);
    rig.dispose();
    // Kept in files and copies, mirrored with the scene.
    expect(parseScene(JSON.parse(JSON.stringify(store.scene))).animation!.constraints).toEqual(store.scene.animation!.constraints);
    const copy = duplicateScene(store.scene);
    expect(copy.animation!.constraints![0].figure).toBe(copy.figures[0].id);
  }, 60_000);
});
