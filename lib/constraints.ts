import { DEFAULT_BODY } from './body';
import { RELAXED_HAND } from './hands';
import { samplePart } from './clip';
import { feetOf } from './locomotion';
import { Rig } from './relations';
import type { Clip, ClipContact, Figure } from './types';

/*
 * Contacts: where a body part holds still on something over a stretch of a clip. A clip's
 * planted feet are found once, when it is made; played on a figure of other proportions (or
 * warped to another mark), those feet are locked where they land (lib/evaluate.ts).
 */

/** Is the foot down (near the clip's floor) and in the same place from `a` to the later `b`, not lifting off? */
const stays = (a: { p: { x: number; y: number; z: number } }, b: { p: { x: number; y: number; z: number } }, floor: number) =>
  a.p.y - floor < 0.03 && b.p.y - floor < 0.03 && b.p.y - a.p.y < 0.005 && Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z) < 0.02;

/** The planted feet of one part of a clip: stretches where a foot stays put on the floor, sampled every frame. */
export function detectContacts(clip: Clip, index: number, fps: number): ClipContact[] {
  const part = clip.parts[index];
  const rig = new Rig();
  try {
    const frames = Math.max(1, Math.round(clip.duration * fps));
    const figure: Figure = { id: 'contacts', name: '', body: part.body ?? DEFAULT_BODY, bones: {}, hands: { L: RELAXED_HAND, R: RELAXED_HAND }, position: [0, 0, 0], grounded: true };
    const times = Array.from({ length: frames + 1 }, (_, i) => Math.min(clip.duration, i / fps));
    const feet = times.map((t) => feetOf(rig, { ...figure, ...samplePart(part, t, clip.duration, false) }));
    const floor = Math.min(...feet.flat().map((f) => f.p.y));
    const out: ClipContact[] = [];
    for (const [side, bone] of [[0, 'leftFoot'], [1, 'rightFoot']] as const) {
      let from = -1;
      for (let i = 1; i <= frames + 1; i++) {
        const on = i <= frames && stays(feet[i - 1][side], feet[i][side], floor);
        if (on && from < 0) from = i - 1;
        if (!on && from >= 0) {
          // Down for a few frames at least (not a foot passing low).
          if (i - 1 - from >= 3) out.push({ part: index, bone, start: times[from], end: times[i - 1] });
          from = -1;
        }
      }
    }
    return out;
  } finally {
    rig.dispose();
  }
}

