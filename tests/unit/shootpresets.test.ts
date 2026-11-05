import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { issueFix, newShoot } from '@/lib/actions';
import { putClips } from '@/lib/assets';
import { parseClip } from '@/lib/doc';
import { PRIMITIVES } from '@/lib/locomotion';
import { checkMotion } from '@/lib/qa';
import { Store } from '@/lib/store';
import { SHOOT_PRESETS } from '@/lib/templates';
import type { Scene } from '@/lib/types';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

/** The Library's motions a scene plays, brought to hand from their files. */
function load(scene: Scene) {
  const ids = [...new Set(scene.animation!.actions.flatMap((x) => (x.source.kind === 'clip' && x.source.clip.startsWith('library:') ? [x.source.clip] : [])))];
  putClips(ids.map((id) => parseClip(JSON.parse(readFileSync(`public/motions/${id.slice(8)}.json`, 'utf8')))!));
}

// (Apart from the staged films' other tests, tests/unit/stagedfilms.test.ts: the slow tests' shards take files whole.)
describe('ready to shoot', () => {
  it('opens every preset clean in the motion check, made as the app makes it: its motions to hand first', () => {
    // (The walks and runs the app has to hand from the start; then each preset's own motions.)
    putClips(PRIMITIVES.map((id) => parseClip(JSON.parse(readFileSync(`public/motions/${id.slice(8)}.json`, 'utf8')))!));
    for (const p of SHOOT_PRESETS) {
      const first = new Store(new MemoryStorage());
      expect(newShoot(first, p.id), p.name).toBe(true);
      load(first.scene);
      // (A staged one times what its people do, a pass caught, by the motions they play.)
      const store = new Store(new MemoryStorage());
      newShoot(store, p.id);
      // (As the app's check shows them: its own, and those of the recordings it has a fix for.)
      const shown = checkMotion(store.scene).filter((i) => !i.recorded || issueFix(store, i));
      expect(shown.map((i) => `${i.message} at ${i.start.toFixed(1)} s`), p.name).toEqual([]);
    }
  }, 1_200_000);
});
