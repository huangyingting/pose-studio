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
const THUMBS = 'thumbs';

let db: Promise<IDBDatabase> | null = null;
const memory = { clips: new Map<string, Clip>(), models: new Map<string, ArrayBuffer>(), thumbs: new Map<string, string>() };

/** Whether a newer build (in another tab) has the database: this tab can no longer keep or read anything in it. */
let outdated = false;
const OUTDATED = 'Pose Studio was updated in another tab: reload this one to keep saving';
const outdatedListeners = new Set<() => void>();

/** Be told (once) when a newer build has the database: this tab should be reloaded. Returns the way to stop. */
export function onOutdated(f: () => void) {
  // (Already: told now.)
  if (outdated) f();
  outdatedListeners.add(f);
  return () => { outdatedListeners.delete(f); };
}

function becameOutdated() {
  if (outdated) return;
  outdated = true;
  for (const f of outdatedListeners) f();
}

function open(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  if (outdated) return Promise.reject(new Error(OUTDATED));
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 4);
    req.onupgradeneeded = () => {
      for (const name of [CLIPS, MODELS, THUMBS]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      // (Another tab of a newer build needing a newer version: this one lets it, and says so when next asked.)
      req.result.onversionchange = () => {
        req.result.close();
        becameOutdated();
      };
      resolve(req.result);
    };
    req.onerror = () => {
      // (Already a newer version: opened by a newer build.)
      if (req.error?.name === 'VersionError') becameOutdated();
      reject(outdated ? new Error(OUTDATED) : req.error);
    };
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

/*
 * The library's thumbnails, kept between visits for this build of the app (a build's templates
 * and poses can look different from the last one's: drawn again then, once).
 */
const BUILD = process.env.NEXT_PUBLIC_BUILD ?? '';
let pruned = false;
let thumbsOff = false;

/**
 * A kept thumbnail (an image URL), or null: none kept, or none to wait for (not kept while
 * developing; the browser's storage refused, or slow to open: drawn instead).
 */
export async function loadThumb(key: string): Promise<string | null> {
  if (!BUILD || thumbsOff) return null;
  const got = run<{ id: string; url: string } | undefined>(THUMBS, 'readonly', (s) => s.get(`${BUILD}|${key}`));
  if (!got) return memory.thumbs.get(key) ?? null;
  // (Once one could not be read, or not soon, none is looked for again this visit.)
  const late = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 500));
  const url = await Promise.race([got.then((x) => x?.url ?? null, () => undefined), late]);
  if (url === undefined) thumbsOff = true;
  return url ?? null;
}

/** Keep a thumbnail (the first time in a visit, those of other builds let go); nothing if it cannot be. */
export async function saveThumb(key: string, url: string) {
  if (!BUILD) return;
  const d = open();
  if (!d) {
    memory.thumbs.set(key, url);
    return;
  }
  try {
    const store = (await d).transaction(THUMBS, 'readwrite').objectStore(THUMBS);
    if (!pruned) {
      pruned = true;
      const all = store.getAllKeys();
      all.onsuccess = () => { for (const k of all.result) if (!String(k).startsWith(`${BUILD}|`)) store.delete(k); };
    }
    store.put({ id: `${BUILD}|${key}`, url });
  } catch {
    // (Not kept: drawn again next visit.)
  }
}
