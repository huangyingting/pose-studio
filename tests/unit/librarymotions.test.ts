import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendScenes, applyMotion, startAnimation } from '@/lib/actions';
import { clipById, clipIdsOf } from '@/lib/assets';
import { parseClip } from '@/lib/doc';
import { actionsOf } from '@/lib/evaluate';
import { MOTION_GROUPS } from '@/lib/motions';
import { Store } from '@/lib/store';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const file = (path: string) => readFileSync(`public${path}`, 'utf8');
const index = JSON.parse(file('/motions/index.json')) as { id: string; name: string; duration: number; group: string }[];

describe("the Library's motion files (public/motions)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('are clips as the index lists them, each in one of the groups', () => {
    expect(index.length).toBeGreaterThan(0);
    for (const m of index) {
      const clip = parseClip(JSON.parse(file(`/motions/${m.id.slice('library:'.length)}.json`)));
      expect(clip?.id, m.name).toBe(m.id);
      expect(clip!.duration).toBeCloseTo(m.duration, 6);
      expect(MOTION_GROUPS, m.name).toContain(m.group);
    }
  });

  it('are listed, fetched when used, played, and not kept with the project', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      try {
        return new Response(file(decodeURIComponent(url)));
      } catch {
        return new Response('', { status: 404 });
      }
    });
    const { fetchLibraryClip, libraryMotions, onLibraryMotions } = await import('@/lib/librarymotions');
    await new Promise<void>((done) => { const off = onLibraryMotions(() => { off(); done(); }); libraryMotions(); });
    expect(libraryMotions().map((m) => m.name)).toContain('Wave, both arms');

    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    startAnimation(store, 5);
    expect(clipById('library:waving')).toBeNull();
    expect(await fetchLibraryClip('library:waving')).toBe(true);
    expect(applyMotion(store, id, 'library:waving')).toBe(true);
    expect(actionsOf(store.scene.animation!, id).some((x) => x.source.kind === 'clip' && x.source.clip === 'library:waving')).toBe(true);
    // Comes with the app: not one of the project's own clips (saved, synced).
    expect(clipIdsOf(store.getState().library)).not.toContain('library:waving');
    expect(await fetchLibraryClip('library:no-such-motion')).toBe(false);

    // A scene that plays one, come from a file (or a link, a template): its motion is fetched.
    const scene = JSON.parse(JSON.stringify(store.scene).replaceAll('library:waving', 'library:salute'));
    const other = new Store(new MemoryStorage());
    appendScenes(other, [{ ...scene, id: 'opened' }]);
    await vi.waitFor(() => expect(clipById('library:salute')).not.toBeNull());
  });

  it('offline: asked for once, not again as the playhead moves; again after a while, while it is played', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      throw new TypeError('offline');
    });
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    startAnimation(store, 5);
    const play = { id: 'act-offline', start: 0, duration: 2, roles: [{ figure: id }], source: { kind: 'clip' as const, clip: 'library:yawn' } };
    store.updateScene((s) => ({ ...s, animation: { ...s.animation!, actions: [...s.animation!.actions, play] } }));
    await vi.waitFor(() => expect(asked.filter((u) => u.includes('yawn'))).toHaveLength(1));
    // (A frame at a time, the last request over by the next.)
    for (let i = 1; i <= 20; i++) {
      store.setTime(i / 10);
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(asked.filter((u) => u.includes('yawn'))).toHaveLength(1);
    // Back online: asked for again (still played) after a while, as the playhead moves, and it comes.
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      return new Response(file(decodeURIComponent(url)));
    });
    await vi.advanceTimersByTimeAsync(31_000);
    store.setTime(2.5);
    await vi.waitFor(() => expect(clipById('library:yawn')).not.toBeNull());
  });
});
