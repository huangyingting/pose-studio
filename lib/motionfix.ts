import * as THREE from 'three';
import { jointLimits, wrapDeg } from './joints';
import { angleToQuat, fromQuat, quatToAngle, toQuat } from './pose';
import type { Clip, ClipPart, JointName } from './types';

/*
 * Motion capture made ready to play on our figures (lib/importmotion.ts, scripts/library-motions.ts):
 * each person's facing at the start is where they look (a captured stance is often turned at the
 * pelvis), and the wrists' roll is the forearms' (captured rigs roll the hand, ours turns the
 * forearm), so the hands stay within their range and the hand is where it was.
 */

const track = (part: ClipPart, bone: JointName) => part.tracks.find((t) => t.name === `${bone}.quaternion`);

/** The quaternion of a bone's track at key i. */
const quatAt = (values: number[], i: number) => new THREE.Quaternion(values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]);

/**
 * Where a part's person looks at its start (yaw, degrees): the head's way over its first quarter
 * second, square on when within 20° of a quarter turn (captures mostly are; their heads bob and
 * glance), as it is otherwise (one recorded at an angle).
 */
export function lookFacing(part: ClipPart): number {
  const chain: JointName[] = ['hips', 'spine', 'chest', 'neck', 'head'];
  const tracks = chain.map((b) => track(part, b));
  const times = tracks[0]?.times ?? [];
  let x = 0, z = 0;
  for (let i = 0; i < times.length && times[i] <= 0.25 + 1e-6; i++) {
    const q = new THREE.Quaternion();
    for (const t of tracks) if (t) q.multiply(quatAt(t.values, Math.min(i, t.times.length - 1)));
    const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    x += ahead.x;
    z += ahead.z;
  }
  const look = (Math.atan2(x, z) * 180) / Math.PI;
  const square = Math.round(look / 90) * 90;
  return wrapDeg(Math.abs(look - square) <= 20 ? square : Math.round(look)) || 0;
}

/** A part with its wrists' roll moved to the forearms (as far as they turn), each hand left where it was. */
export function wristsToForearms(part: ClipPart): ClipPart {
  const tracks = part.tracks.map((t) => ({ ...t, values: [...t.values] }));
  for (const side of ['left', 'right'] as const) {
    const arm = `${side}LowerArm` as JointName, hand = `${side}Hand` as JointName;
    const a = tracks.find((t) => t.name === `${arm}.quaternion`), h = tracks.find((t) => t.name === `${hand}.quaternion`);
    if (!a || !h || a.times.length !== h.times.length) continue;
    const [lo, hi] = jointLimits(arm)[1];
    for (let i = 0; i < a.times.length; i++) {
      const fq = quatAt(a.values, i), hq = quatAt(h.values, i);
      const fa = quatToAngle(arm, toQuat(fq));
      const roll = quatToAngle(hand, toQuat(hq))[1];
      // The forearm takes the roll, as far as it turns.
      const by = Math.min(hi, Math.max(lo, fa[1] + roll)) - fa[1];
      if (Math.abs(by) < 0.5) continue;
      const nf = fromQuat(angleToQuat(arm, [fa[0], fa[1] + by, fa[2]]));
      // The hand is turned back as far: where it was in the world.
      const nh = nf.clone().invert().multiply(fq).multiply(hq);
      nf.toArray(a.values, i * 4);
      nh.toArray(h.values, i * 4);
    }
  }
  return { ...part, tracks };
}

/** A captured clip made ready: each part's facing where they look, the wrists' roll the forearms'. */
export function refineClip(clip: Clip): Clip {
  return { ...clip, parts: clip.parts.map((p) => ({ ...wristsToForearms(p), facing: lookFacing(p) })) };
}
