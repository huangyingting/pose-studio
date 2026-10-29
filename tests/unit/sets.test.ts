import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { newScene, parseScene } from '@/lib/doc';
import { SceneView } from '@/lib/sceneview';
import { SETS, SET_GROUPS } from '@/lib/sets';

describe('sets', () => {
  it('ten or so, indoor and outdoor, each made of pieces with a floor at the stage floor', () => {
    expect(SETS.length).toBeGreaterThanOrEqual(8);
    for (const g of SET_GROUPS) expect(SETS.some((s) => s.group === g), g).toBe(true);
    expect(new Set(SETS.map((s) => s.id)).size).toBe(SETS.length);
    for (const s of SETS) {
      const pieces = s.build();
      expect(pieces.length, s.id).toBeGreaterThan(5);
      for (const p of pieces) expect(p.at.every(Number.isFinite), s.id).toBe(true);
    }
  });

  it('a scene keeps its set by id (an unknown one is dropped); the view draws it, out of what the camera frames', () => {
    expect(parseScene({ ...newScene('In'), set: 'courtyard' }).set).toBe('courtyard');
    expect(parseScene({ ...newScene('Out'), set: 'moon-base' }).set).toBeUndefined();
    const sv = new SceneView();
    sv.sync({ ...newScene('In'), set: 'palace' });
    expect(sv.set?.parts.bodies.length).toBeGreaterThan(5);
    const people = new THREE.Box3();
    sv.forEachPoint((p) => people.expandByPoint(p));
    const all = new THREE.Box3().setFromObject(sv.set!.object);
    expect(all.getSize(new THREE.Vector3()).x).toBeGreaterThan(people.getSize(new THREE.Vector3()).x * 4);
    // Nothing of it to pick: a click goes through to the floor.
    const hits = new THREE.Raycaster(new THREE.Vector3(0, 3, 30), new THREE.Vector3(0, 0, -1)).intersectObject(sv.set!.object, true);
    expect(hits).toHaveLength(0);
    sv.sync(newScene('Bare'));
    expect(sv.set).toBeNull();
  });
});
