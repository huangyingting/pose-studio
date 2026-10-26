import * as THREE from 'three';
import { Ink } from './ink';
import { PropObject } from './props';
import type { Prop } from './types';

/*
 * What a figure can stand on: the top of every part of every prop standing in the scene (not
 * held ones), as boxes seen from above. Walking, landing and standing put the feet on the highest
 * top under them, or on the floor.
 */

interface Top { minX: number; maxX: number; minZ: number; maxZ: number; y: number }

let ink: Ink | null = null;
const cache = new WeakMap<Prop[], Top[]>();

function topsOf(props: Prop[]): Top[] {
  let tops = cache.get(props);
  if (tops) return tops;
  ink ??= new Ink();
  const box = new THREE.Box3();
  tops = [];
  for (const p of props) {
    if (p.hold) continue;
    const o = new PropObject(ink, p.kind, p.id);
    o.apply(p);
    o.liftAboveFloor();
    for (const mesh of o.parts.bodies) {
      box.setFromObject(mesh);
      // Thin upright parts (a chair back, a wall) are not stood on unless wide enough for a foot.
      if (box.max.x - box.min.x < 0.08 || box.max.z - box.min.z < 0.08) continue;
      tops.push({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, y: box.max.y });
    }
    o.dispose();
  }
  cache.set(props, tops);
  return tops;
}

/** Height of what stands under a floor point: the highest prop top there, or the floor (0). */
export function groundOf(props: Prop[]) {
  if (!props.some((p) => !p.hold)) return () => 0;
  const tops = topsOf(props);
  return (x: number, z: number) => {
    let y = 0;
    for (const t of tops) if (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ && t.y > y) y = t.y;
    return y;
  };
}
