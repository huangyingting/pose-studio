import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addFigure, applyMotion, applyUpperBody } from '@/lib/actions';
import { actionsOf, sceneAt } from '@/lib/evaluate';
import { checkMotion } from '@/lib/qa';
import { Rig } from '@/lib/relations';
import { fresh, captured } from '../fixtures/scenes';

describe('captured motions of two (shaking hands, holding someone hostage)', () => {
  it('alone, someone is added to shake hands with: placed facing them, their right hands meet', () => {
    const { store, a } = fresh();
    const id = captured('shaking-hands');
    expect(applyMotion(store, a, id)).toBe(true);
    const [, b] = store.scene.figures;
    expect(b).toBeDefined();
    // Still the one it was given to that is selected; one undo takes it all back.
    expect(store.getState().selection).toEqual({ kind: 'figure', figure: a });
    const rig = new Rig();
    for (const t of [1.5, 1.9, 2.3]) {
      const [p, q] = sceneAt(store.scene, t).figures.map((f) => rig.model(f).joints.rightHand.getWorldPosition(new THREE.Vector3()));
      expect(p.distanceTo(q), `${t} s`).toBeLessThan(0.06);
    }
    rig.dispose();
    expect(checkMotion(store.scene)).toEqual([]);
    store.undo();
    expect(store.scene.figures.map((f) => f.id)).toEqual([a]);
    // Not one person's: not from the waist up.
    expect(applyUpperBody(store, a, id)).toBe(false);
  }, 60_000);

  it('the other selected takes the second part (else the nearest): nobody is added', () => {
    const { store, a } = fresh();
    addFigure(store, [3, 0, 0]);
    const far = store.getState().activeFigure!;
    addFigure(store, [-1, 0, 0]);
    const near = store.getState().activeFigure!;
    const id = captured('hostage-situation');
    expect(applyMotion(store, a, id)).toBe(true);
    expect(store.scene.figures).toHaveLength(3);
    expect(actionsOf(store.scene.animation!, near).some((x) => x.source.kind === 'clip')).toBe(true);
    expect(actionsOf(store.scene.animation!, far).some((x) => x.source.kind === 'clip')).toBe(false);
    store.undo();
    store.select({ kind: 'many', figures: [a, far], props: [] });
    expect(applyMotion(store, a, id)).toBe(true);
    const act = actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'clip')!;
    expect(act.roles.map((r) => r.figure)).toEqual([a, far]);
    expect(checkMotion(store.scene).map((i) => i.message)).toEqual([]);
  }, 60_000);
});
