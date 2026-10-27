import { hasClip, putClips } from './assets';
import type { Clip } from './types';

/*
 * Where imported clips and models are kept, apart from the library (which only lists them):
 * IndexedDB in the browser, as big as the browser allows (not the few megabytes of localStorage).
 * Signed in, the server keeps them too, as files (lib/cloud.ts, app/api/assets). Without
 * IndexedDB (tests), in memory.
 */

const DB = 'pose-studio-assets';
const CLIPS = 'clips';
const MODELS = 'models';

let db: Promise<IDBDatabase> | null = null;
const memory = { clips: new Map<string, Clip>(), models: new Map<string, ArrayBuffer>() };

function open(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      for (const name of [CLIPS, MODELS]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

function run<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> | null {
  const d = open();
  return d && d.then((x) => new Promise<T>((resolve, reject) => {
    const req = f(x.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

/** Keep clips (and have them at hand now). */
export async function saveClips(clips: Clip[]) {
  putClips(clips);
  for (const c of clips) {
    const done = run(CLIPS, 'readwrite', (s) => s.put(c));
    if (done) await done;
    else memory.clips.set(c.id, c);
  }
}

/** Bring kept clips to hand: those of `ids` not at hand yet. Returns the ids it does not have. */
export async function loadClips(ids: string[]): Promise<string[]> {
  const found: Clip[] = [];
  const missing: string[] = [];
  for (const id of ids.filter((x) => !hasClip(x))) {
    const c = await (run<Clip | undefined>(CLIPS, 'readonly', (s) => s.get(id)) ?? Promise.resolve(memory.clips.get(id)));
    if (c) found.push(c);
    else missing.push(id);
  }
  putClips(found);
  return missing;
}

/** Keep a model's file. */
export async function saveModelFile(id: string, data: ArrayBuffer) {
  const done = run(MODELS, 'readwrite', (s) => s.put({ id, data }));
  if (done) await done;
  else memory.models.set(id, data);
}

/** A kept model's file, or null if it is not kept here. */
export async function loadModelFile(id: string): Promise<ArrayBuffer | null> {
  const got = run<{ id: string; data: ArrayBuffer } | undefined>(MODELS, 'readonly', (s) => s.get(id));
  return got ? (await got)?.data ?? null : memory.models.get(id) ?? null;
}
