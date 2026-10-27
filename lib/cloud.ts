import { clipById, clipIdsOf } from './assets';
import { loadModelFile, saveClips, saveModelFile } from './assetstore';
import { modelTemplate } from './model';
import { parseClip, parseLibrary } from './doc';
import { withBase } from './paths';
import type { Store } from './store';
import { canonical, matchesBase, mergeLibraries, sceneHash, syncBase, type SyncBase } from './sync';
import type { Library } from './types';

/*
 * Keeps the signed-in user's library on the server (server edition). Pulls when it starts and
 * when the tab comes back into view, pushes a moment after each saved edit, and merges when
 * another device saved in between (see lib/sync.ts). The browser copy stays the working copy,
 * so editing works offline. Imported clips' frames and characters' files go up and come down
 * apart from the library, one file each (app/api/assets).
 */

export type CloudStatus = 'syncing' | 'synced' | 'offline' | 'error';

interface Saved {
  user: string;
  version: number;
  base: SyncBase | null;
}

const KEY = 'pose-studio:sync';
const PUSH_DELAY = 1500;

const fingerprint = (lib: Library) => lib.scenes.map(sceneHash).join() + (lib.board ?? []).map((p) => `${p.id}:${p.sceneId}:${p.hold}:${p.caption ?? ''}`).join()
  + [lib.poses, lib.clips, lib.models, lib.templates].map((list) => (list ?? []).map((x) => x.id).join()).join('|');

export class CloudSync {
  status: CloudStatus = 'syncing';
  lastSynced: number | null = null;
  private saved: Saved;
  private pushed = '';
  /** The clips last seen on both sides. */
  private clips = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy: Promise<void> = Promise.resolve();
  private stopped = false;
  private listeners = new Set<() => void>();
  private cleanup: (() => void)[] = [];

  constructor(private store: Store, user: string) {
    let saved: Saved | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      saved = null;
    }
    // Another account on this device starts from scratch (its library merges in on the first sync).
    this.saved = saved?.user === user ? saved : { user, version: 0, base: null };
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  start() {
    this.stopped = false;
    this.cleanup = [];
    this.cleanup.push(this.store.subscribe(() => {
      if (this.store.getState().saveStatus === 'pending') this.schedule();
    }));
    const onVisible = () => { if (document.visibilityState === 'visible') this.queue(() => this.pull()); };
    const onOnline = () => this.queue(() => this.pull());
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVisible), () => window.removeEventListener('online', onOnline));
    this.queue(() => this.pull());
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.cleanup.forEach((f) => f());
  }

  private setStatus(s: CloudStatus) {
    this.status = s;
    if (s === 'synced') this.lastSynced = Date.now();
    this.listeners.forEach((l) => l());
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.queue(() => this.push()), PUSH_DELAY);
  }

  /** One request at a time. */
  private queue(job: () => Promise<void>) {
    this.busy = this.busy.then(async () => {
      if (this.stopped) return;
      try {
        await job();
      } catch (err) {
        if (navigator.onLine) console.warn('Library sync failed:', err);
        this.setStatus(navigator.onLine ? 'error' : 'offline');
      }
    });
    return this.busy;
  }

  private remember(version: number, agreed: Library) {
    this.saved = { ...this.saved, version, base: syncBase(agreed) };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.saved));
    } catch {
      // Storage full: the next sync merges from scratch, which loses nothing.
    }
  }

  private local() {
    return canonical(this.store.getState().library);
  }

  /** Bring in the server's copy (merging this device's changes), then push what is left. */
  private async pull() {
    this.setStatus('syncing');
    const res = await fetch(withBase('/api/library'), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const { library, version } = (await res.json()) as { library: unknown; version: number };
    if (library && version !== this.saved.version) this.adopt(canonical(parseLibrary(library)), version);
    await this.push(true);
    await this.syncClips(true);
  }

  /** Clips and models the library uses that only one side has: fetched, or sent up. */
  private async syncClips(force = false) {
    const lib = this.store.getState().library;
    const ids = clipIdsOf(lib);
    const models = (lib.models ?? []).map((m) => m.id);
    const print = [...ids, ...models].sort().join();
    if (!force && print === this.clips) return;
    const res = await fetch(withBase('/api/assets'), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const there = new Set(((await res.json()) as { ids: string[] }).ids);
    const url = (id: string) => withBase(`/api/assets/${encodeURIComponent(id)}`);
    const send = async (id: string, body: BodyInit, type: string) => {
      const put = await fetch(url(id), { method: 'PUT', headers: { 'Content-Type': type }, body });
      if (!put.ok) throw new Error(String(put.status));
    };
    for (const id of await this.store.loadClips()) {
      if (!there.has(id)) continue;
      const got = await fetch(url(id));
      const clip = got.ok ? parseClip(await got.json()) : null;
      if (clip) await saveClips([clip]);
    }
    for (const id of ids) {
      const clip = clipById(id);
      if (!there.has(id) && clip) await send(id, JSON.stringify(clip), 'application/json');
    }
    for (const id of models) {
      const file = await loadModelFile(id);
      if (file && !there.has(id)) await send(id, file, 'application/octet-stream');
      if (!file && there.has(id)) {
        const got = await fetch(url(id));
        if (got.ok) {
          await saveModelFile(id, await got.arrayBuffer());
          modelTemplate(id);
        }
      }
    }
    this.clips = print;
  }

  private adopt(server: Library, version: number) {
    const local = this.local();
    const merged = mergeLibraries(server, local, this.saved.base);
    this.remember(version, server);
    if (fingerprint(merged) !== fingerprint(local)) this.store.adoptLibrary(merged);
  }

  private async push(force = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const lib = this.local();
      const print = fingerprint(lib);
      const base = this.saved.base;
      const unchanged = matchesBase(lib, base);
      if ((print === this.pushed || unchanged) && this.saved.version > 0 && (!force || unchanged)) {
        this.pushed = print;
        this.setStatus('synced');
        return;
      }
      this.setStatus('syncing');
      const res = await fetch(withBase('/api/library'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ library: lib, baseVersion: this.saved.version }),
      });
      if (res.status === 409) {
        const { library, version } = (await res.json()) as { library: unknown; version: number };
        if (library) this.adopt(canonical(parseLibrary(library)), version);
        else this.remember(version, lib);
        continue;
      }
      if (!res.ok) throw new Error(String(res.status));
      const { version } = (await res.json()) as { version: number };
      this.remember(version, lib);
      this.pushed = print;
      await this.syncClips();
      this.setStatus('synced');
      return;
    }
    throw new Error('Could not sync');
  }
}
