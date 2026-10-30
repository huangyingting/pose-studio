import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Springs, type SpringSpec } from '@/lib/springs';

/** A head with a lock of hair: two bones hanging down from it. */
function lock() {
  const root = new THREE.Group();
  const head = new THREE.Bone(); head.name = 'head'; head.position.set(0, 1.6, 0);
  const a = new THREE.Bone(); a.name = 'hair1';
  const b = new THREE.Bone(); b.name = 'hair2'; b.position.set(0, -0.1, 0);
  const c = new THREE.Bone(); c.name = 'hair3'; c.position.set(0, -0.1, 0);
  root.add(head); head.add(a); a.add(b); b.add(c);
  root.updateMatrixWorld(true);
  const joint = (bone: string) => ({ bone, stiffness: 0.5, gravityPower: 0.3, gravityDir: [0, -1, 0] as [number, number, number], dragForce: 0.3, hitRadius: 0.01 });
  const spec: SpringSpec = { springs: [{ joints: [joint('hair1'), joint('hair2')], colliders: [] }], colliders: [] };
  return { root, head, a, c, springs: new Springs(root, spec) };
}

const tipX = (c: THREE.Object3D) => c.getWorldPosition(new THREE.Vector3()).x;

describe('spring bones (#15): hair swinging as the head moves', () => {
  it('trails behind a move, then swings back and settles where it hangs', () => {
    const { root, head, c, springs } = lock();
    springs.update(0);
    expect(tipX(c)).toBeCloseTo(0, 3);
    // The head moves right fast: the hair's tip lags behind it (to its left).
    let lag = 0;
    for (let i = 1; i <= 6; i++) {
      head.position.x = i * 0.05;
      root.updateMatrixWorld(true);
      springs.update(i / 24);
      lag = Math.max(lag, head.position.x - tipX(c));
    }
    expect(lag).toBeGreaterThan(0.02);
    // Held still a while: back under the head.
    for (let i = 7; i <= 7 + 72; i++) { root.updateMatrixWorld(true); springs.update(i / 24); }
    expect(Math.abs(tipX(c) - head.position.x)).toBeLessThan(0.01);
  });

  it('settles at once on a jump in time (scrubbing back, a still)', () => {
    const { root, head, c, springs } = lock();
    springs.update(5);
    head.position.x = 1;
    root.updateMatrixWorld(true);
    springs.update(1);
    expect(Math.abs(tipX(c) - 1)).toBeLessThan(0.01);
  });
});
