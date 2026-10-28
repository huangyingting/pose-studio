import { describe, expect, it } from 'vitest';
import { applyMotion } from '@/lib/actions';
import { BODY_PRESETS } from '@/lib/body';
import { MOTIONS } from '@/lib/motions';
import { checkMotion } from '@/lib/qa';
import { Store } from '@/lib/store';

/* Every one-person motion on a figure of every build: slow (the `slow` vitest project, run in CI). */

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('one-person motions on figures of every build (feet locked, travel scaled)', () => {
  it.each(BODY_PRESETS.map((p) => [p.name, p] as const))('stay clean on %s', (_, preset) => {
    for (const m of MOTIONS.filter((x) => x.people === 1)) {
      const store = new Store(new MemoryStorage());
      const id = store.figure!.id;
      store.updateScene((s) => ({ ...s, figures: s.figures.map((f) => ({ ...f, body: { ...preset.body } })) }));
      applyMotion(store, id, m.id);
      expect(checkMotion(store.scene).map((i) => i.message), `${m.id} on ${preset.name}`).toEqual([]);
    }
  }, 300_000);
});
