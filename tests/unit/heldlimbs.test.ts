import { describe, expect, it } from 'vitest';
import { applyMotion, saveMotion } from '@/lib/actions';
import { putClips } from '@/lib/assets';
import { partFromPoses } from '@/lib/clip';
import { figurePoseAt } from '@/lib/evaluate';
import { RELAXED_HAND, cloneHand } from '@/lib/hands';
import { angle, bonesOf } from '@/lib/pose';
import { Store } from '@/lib/store';
import type { Clip, Pose } from '@/lib/types';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

/* A clip's planted foot held where it landed: the leg turned only as far as it takes, its knee bent its own way. */

describe('a clip\'s planted foot', () => {
  it('keeps the knee\'s twist and side as the clip has them (captured knees have both): only its bend is held in range', () => {
    // A knee bent with a twist and a lean to the side, as a capture estimates it, the hips drifting a little over the foot.
    const pose = (x: number): Pose => ({
      bones: bonesOf({ leftUpperLeg: [-40, 0, 5], leftLowerLeg: [70, -25, -40], rightUpperLeg: [-10, 0, 0], rightLowerLeg: [20, 0, 0] }),
      position: [x, 0.85, 0], hands: { L: cloneHand(RELAXED_HAND), R: cloneHand(RELAXED_HAND) }, grounded: false,
    });
    const part = partFromPoses('Knee', [{ t: 0, pose: pose(0) }, { t: 2, pose: pose(0.04) }], 'linear');
    const clip: Clip = { id: 'clip-knee', name: 'Knee', duration: 2, loop: false, parts: [part], events: [], contacts: [{ part: 0, bone: 'leftFoot', start: 0, end: 2 }] };
    putClips([clip]);
    const store = new Store(new MemoryStorage());
    const id = store.scene.figures[0].id;
    saveMotion(store, clip);
    store.setTime(0);
    expect(applyMotion(store, id, clip.id)).toBe(true);
    for (const t of [0.5, 1, 1.5]) {
      const knee = angle(figurePoseAt(store.scene, id, t)!.bones, 'leftLowerLeg');
      // (Held to its range, the side went from −40° to −8°: the shin swung round as the hold began.)
      expect(Math.abs(knee[1] + 25), `twist at ${t} s`).toBeLessThan(6);
      expect(Math.abs(knee[2] + 40), `side at ${t} s`).toBeLessThan(6);
    }
  });
});
