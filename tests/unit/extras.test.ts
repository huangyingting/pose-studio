import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addExtras, setDirector, setSceneSet, startAnimation } from '@/lib/actions';
import { cameraAt } from '@/lib/cameras';
import { castCoverage, coverageById } from '@/lib/coverage';
import { parseScene } from '@/lib/doc';
import { figurePoseAt } from '@/lib/evaluate';
import { checkMotion } from '@/lib/qa';
import { setBlocks } from '@/lib/sets';
import { fresh } from '../fixtures/scenes';

/* Extras passing by behind the cast (#57). */

describe('extras passing by (#57)', () => {
  it('walk to and fro behind the cast, as the camera sees it, all through the scene; never cast; their own steps not the cast\'s to fix', () => {
    const { store, a } = fresh();
    startAnimation(store, 12);
    // (The camera as it sees the scene they are added to: framing everyone, it takes them in after.)
    const view = cameraAt(store.scene, 0, 16 / 9);
    expect(addExtras(store, 4)).toBe(4);
    const extras = store.scene.figures.filter((f) => f.extra);
    expect(extras.map((f) => f.name)).toEqual(['Extra', 'Extra 2', 'Extra 3', 'Extra 4']);
    // Further from the camera than the cast.
    const depth = (x: number, z: number) => new THREE.Vector3(x, 0, z).sub(view.position).dot(new THREE.Vector3().subVectors(view.target, view.position).setY(0).normalize());
    const cast = store.scene.figures.find((f) => f.id === a)!;
    for (const f of extras) expect(depth(f.position[0], f.position[2])).toBeGreaterThan(depth(cast.position[0], cast.position[2]) + 2.5);
    // Within the scene as long as it was.
    expect(store.scene.animation!.duration).toBe(12);
    // Walking: here and there through the scene.
    for (const f of extras) {
      const at = [0.5, 5, 9.5].map((t) => figurePoseAt(store.scene, f.id, t)!.position);
      expect(Math.hypot(at[1][0] - at[0][0], at[1][2] - at[0][2]) + Math.hypot(at[2][0] - at[1][0], at[2][2] - at[1][2]), f.name).toBeGreaterThan(1);
    }
    // Never a coverage's subject: the cast is.
    expect(castCoverage(store.scene, coverageById('dialogue')!, extras[0].id)).toBeNull();
    setDirector(store, 'group');
    expect(store.scene.coverage!.roles.A).toBe(a);
    // Clean: nobody walks into anyone; their steps are theirs.
    expect(checkMotion(store.scene).filter((i) => i.kind !== 'camera' && i.kind !== 'hidden').map((i) => i.message)).toEqual([]);
  });

  it('in a set, their lanes stop short of its walls; kept with the scene', () => {
    const { store } = fresh();
    startAnimation(store, 10);
    setSceneSet(store, 'living-room');
    const came = addExtras(store, 6);
    expect(came).toBeGreaterThan(0);
    const extras = store.scene.figures.filter((f) => f.extra);
    const mid = new THREE.Vector3(0, 0.5, 0);
    for (const f of extras) {
      const ends = store.scene.animation!.actions.filter((x) => x.roles[0].figure === f.id && x.source.kind === 'travel').map((x) => x.roles[0].end!.at);
      for (const [x, z] of [[f.position[0], f.position[2]], ...ends]) {
        // (The room's walls: x ±4.5, z -4.5 to its open front.)
        expect(Math.abs(x), f.name).toBeLessThan(4.5);
        expect(z, f.name).toBeGreaterThan(-4.5);
      }
      expect(setBlocks('living-room', mid, new THREE.Vector3(f.position[0], 0.5, f.position[2])), f.name).toBeNull();
    }
    const kept = parseScene(JSON.parse(JSON.stringify(store.scene)))!;
    expect(kept.figures.filter((f) => f.extra)).toHaveLength(came);
  });
});
