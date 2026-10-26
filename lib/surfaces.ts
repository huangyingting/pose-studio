import * as THREE from 'three';
import { Ink } from './ink';
import { PropObject } from './props';
import { HANDHELD, type Prop } from './types';

/*
 * What a figure can stand on: the top of every part of every prop standing in the scene (not
 * held ones), as boxes seen from above. Walking, landing and standing put the feet on the highest
 * top under them, or on the floor.
 */

interface Top { id: string; minX: number; maxX: number; minZ: number; maxZ: number; y: number }

let ink: Ink | null = null;
const cache = new WeakMap<Prop[], Top[]>();

function topsOf(props: Prop[]): Top[] {
  let tops = cache.get(props);
  if (tops) return tops;
  ink ??= new Ink();
  const box = new THREE.Box3();
  tops = [];
  for (const p of props) {
    // Not stood on: held props, balls and things that fit in a hand.
    if (p.hold || p.kind === 'sphere' || HANDHELD.includes(p.kind)) continue;
    const o = new PropObject(ink, p.kind, p.id);
    o.apply(p);
    o.liftAboveFloor();
    for (const mesh of o.parts.bodies) {
      box.setFromObject(mesh);
      // Thin upright parts (a chair back, a wall) are not stood on unless wide enough for a foot.
      if (box.max.x - box.min.x < 0.08 || box.max.z - box.min.z < 0.08) continue;
      tops.push({ id: p.id, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, y: box.max.y });
    }
    o.dispose();
  }
  cache.set(props, tops);
  return tops;
}

/** Height of what stands under a floor point: the highest prop top there (but `except`), or the floor (0). */
export function groundOf(props: Prop[], except?: string) {
  if (!props.some((p) => !p.hold && p.kind !== 'sphere' && !HANDHELD.includes(p.kind))) return () => 0;
  const tops = topsOf(props);
  return (x: number, z: number) => {
    let y = 0;
    for (const t of tops) if (t.id !== except && x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ && t.y > y) y = t.y;
    return y;
  };
}
