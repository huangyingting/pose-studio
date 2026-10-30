import * as THREE from 'three';
import { samplePart, startFacing } from './clip';
import { newFigure } from './doc';
import { legsOf } from './locomotion';
import { facingOf } from './pose';
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

/** The time (s, in the clip) its first person's hand or foot reaches furthest out ahead (the way it starts facing: not a foot stepping back). */
export function strikeTime(clip: Clip): number {
  let at = known.get(clip);
  if (at !== undefined) return at;
  const part = clip.parts[0];
  const rig = new Rig();
  let best = { t: 0, reach: 0 };
  const hips = new THREE.Vector3();
  const p = new THREE.Vector3();
  const a = (startFacing(part, samplePart(part, 0, clip.duration, false)) * Math.PI) / 180;
  const ahead = [Math.sin(a), Math.cos(a)];
  for (let k = 0; k <= 120; k++) {
    const t = (clip.duration * k) / 120;
    const m = rig.model({ ...newFigure({ body: part.body }), ...samplePart(part, t, clip.duration, false) });
    m.joints.hips.getWorldPosition(hips);
    for (const j of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const) {
      m.joints[j].getWorldPosition(p);
      const reach = (p.x - hips.x) * ahead[0] + (p.z - hips.z) * ahead[1];
      if (reach > best.reach) best = { t, reach };
    }
  }
  rig.dispose();
  at = Math.round(best.t * 100) / 100;
  known.set(clip, at);
  return at;
}

/**
 * Where a motion takes its first person, from where it starts facing (+z forward, +x to the
 * left), in lengths of its legs (its hips' height standing, as the scenes scale motions to a body):
 * where it ends up and how far it has turned (degrees); for a strike, where what strikes is when it
 * lands (across, up, ahead). Kept in the Library's index (scripts/library-motions.ts) for the
 * scenes staged with them (lib/films.ts): a fighter steps in as far as the blow reaches.
 */
export function clipCourse(clip: Clip, strike?: number): { move: [number, number]; turn: number; reach?: [number, number, number] } {
  const part = clip.parts[0];
  const first = samplePart(part, 0, clip.duration, false);
  const last = samplePart(part, clip.duration, clip.duration, false);
  const by = -startFacing(part, first);
  const legs = part.body ? legsOf(part.body).rootY : 1;
  const r = (v: number) => Math.round((v / legs) * 1000) / 1000 || 0;
  const local = (x: number, z: number) => {
    const a = (by * Math.PI) / 180;
    return [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
  };
  const [mx, mz] = local(last.position[0] - first.position[0], last.position[2] - first.position[2]);
  const out: { move: [number, number]; turn: number; reach?: [number, number, number] } = {
    move: [r(mx), r(mz)],
    turn: Math.round(((((facingOf(last.bones) - facingOf(first.bones)) % 360) + 540) % 360) - 180),
  };
  if (strike === undefined) return out;
  // What strikes: the hand or foot furthest out from the hips then.
  const rig = new Rig();
  try {
    const m = rig.model({ ...newFigure({ body: part.body }), ...samplePart(part, strike, clip.duration, false) });
    const ends = (['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const).map((j) => m.joints[j].getWorldPosition(new THREE.Vector3()));
    // (Furthest ahead, as strikeTime has it.)
    const ahead = (q: THREE.Vector3) => local(q.x - first.position[0], q.z - first.position[2])[1];
    const blow = ends.reduce((p, q) => (ahead(q) > ahead(p) ? q : p));
    const [bx, bz] = local(blow.x - first.position[0], blow.z - first.position[2]);
    out.reach = [r(bx), r(blow.y), r(bz)];
  } finally {
    rig.dispose();
  }
  return out;
}
