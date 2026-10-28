import { hasClip, LIBRARY, putClips } from './assets';
import { parseClip } from './doc';
import type { MOTION_GROUPS } from './motions';
import { withBase } from './paths';

/*
 * The Library's motion files (public/motions, made by `npm run motions`): listed from their index
 * with the built-in motions, each fetched the first time it is used, shown or played (they are
 * too big to come with the page). They come with the app: never kept with a project or synced.
 */

export interface LibraryMotion {
  id: string;
  name: string;
  duration: number;
  group: (typeof MOTION_GROUPS)[number];
}

let list: LibraryMotion[] = [];
let asked = false;
const listeners = new Set<() => void>();
const coming = new Map<string, Promise<boolean>>();
/** Those not found (asked for once). */
const missing = new Set<string>();
/** Those that could not be fetched (offline): when to try again. */
const retry = new Map<string, number>();
/** How long to wait before trying again (ms). */
const RETRY_MS = 30_000;

/** The Library's motion files (none until the index has come: asked for the first time this is). */
export function libraryMotions(): LibraryMotion[] {
  if (!asked) {
    asked = true;
    fetch(withBase('/motions/index.json'))
      .then((r) => (r.ok ? r.json() : []))
      .then((got: LibraryMotion[]) => {
        list = got;
        listeners.forEach((f) => f());
      })
      .catch(() => {});
  }
  return list;
}

/** Call `f` when the list comes. Returns a function that stops it. */
export function onLibraryMotions(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** Bring one of them to hand (once): whether it is. */
export function fetchLibraryClip(id: string): Promise<boolean> {
  if (hasClip(id)) return Promise.resolve(true);
  if (missing.has(id) || (retry.get(id) ?? 0) > Date.now()) return Promise.resolve(false);
  let p = coming.get(id);
  if (!p) {
    p = fetch(withBase(`/motions/${encodeURIComponent(id.slice(LIBRARY.length))}.json`))
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const clip = json && parseClip(json);
        if (!clip || clip.id !== id) {
          missing.add(id);
          return false;
        }
        putClips([clip]);
        return true;
      })
      .catch(() => {
        retry.set(id, Date.now() + RETRY_MS);
        return false;
      })
      .finally(() => coming.delete(id));
    coming.set(id, p);
  }
  return p;
}

/** Bring those of `ids` that are the Library's to hand (the motions a project's scenes play). */
export function fetchLibraryClips(ids: string[]) {
  return Promise.all(ids.filter((id) => id.startsWith(LIBRARY)).map(fetchLibraryClip));
}
