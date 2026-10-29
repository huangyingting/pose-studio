import * as THREE from 'three';
import { samplePart } from './clip';
import { newFigure } from './doc';
import { Rig } from './relations';
import type { Clip } from './types';

/*
 * When a motion's strike lands: its hand or foot as far out from the hips as it goes. Someone
 * struck reacts then (the Library's index keeps it for its strikes, scripts/library-motions.ts;
 * a reaction is timed to it in a scene, lib/actions.ts reactTo, and in the films, lib/films.ts).
 */

/** How long before a strike lands someone struck starts to react (s). */
export const REACT_LEAD = 0.25;

const known = new WeakMap<Clip, number>();

/** The time (s, in the clip) its first person's hand or foot reaches furthest out. */
export function strikeTime(clip: Clip): number {
  let at = known.get(clip);
  if (at !== undefined) return at;
  const part = clip.parts[0];
  const rig = new Rig();
  let best = { t: 0, reach: 0 };
  const hips = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let k = 0; k <= 60; k++) {
    const t = (clip.duration * k) / 60;
    const m = rig.model({ ...newFigure({ body: part.body }), ...samplePart(part, t, clip.duration, false) });
    m.joints.hips.getWorldPosition(hips);
    for (const j of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const) {
      m.joints[j].getWorldPosition(p);
      const reach = Math.hypot(p.x - hips.x, p.z - hips.z);
      if (reach > best.reach) best = { t, reach };
    }
  }
  rig.dispose();
  at = Math.round(best.t * 100) / 100;
  known.set(clip, at);
  return at;
}
