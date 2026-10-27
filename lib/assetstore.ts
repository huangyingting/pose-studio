import { hasClip, putClips } from './assets';
import type { Clip } from './types';

/*
 * Where imported clips are kept, apart from the library (which only lists them): IndexedDB in the
 * browser, as big as the browser allows (not the few megabytes of localStorage). Signed in, the
 * server keeps them too, as files (lib/cloud.ts, app/api/assets). Without IndexedDB (tests), in
 * memory.
 */

const DB = 'pose-studio-assets';
const CLIPS = 'clips';

let db: Promise<IDBDatabase> | null = null;
const memory = new Map<string, Clip>();

function open(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(CLIPS, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> | null {
  const d = open();
  return d && d.then((x) => new Promise<T>((resolve, reject) => {
    const req = f(x.transaction(CLIPS, mode).objectStore(CLIPS));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

/** Keep clips (and have them at hand now). */
export async function saveClips(clips: Clip[]) {
  putClips(clips);
  for (const c of clips) {
    const done = run('readwrite', (s) => s.put(c));
    if (done) await done;
    else memory.set(c.id, c);
  }
}

/** Bring kept clips to hand: those of `ids` not at hand yet. Returns the ids it does not have. */
export async function loadClips(ids: string[]): Promise<string[]> {
  const found: Clip[] = [];
  const missing: string[] = [];
  for (const id of ids.filter((x) => !hasClip(x))) {
    const c = await (run<Clip | undefined>('readonly', (s) => s.get(id)) ?? Promise.resolve(memory.get(id)));
    if (c) found.push(c);
    else missing.push(id);
  }
  putClips(found);
  return missing;
}
