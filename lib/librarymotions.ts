import { hasClip, LIBRARY, putClips } from './assets';
import { parseClip } from './doc';
import type { Clip } from './types';
import type { MOTION_GROUPS } from './motions';
import { withBase } from './paths';

/*
 * The Library's motion files (public/motions, made by `npm run motions`): listed from their index
 * with the built-in motions, each fetched the first time it is used, shown or played (they are
 * too big to come with the page). They come with the app: never kept with a project or synced.
 */

interface LibraryMotion {
  id: string;
  name: string;
  duration: number;
  /** How many people it is for (each a part of the clip). */
  people: number;
  group: (typeof MOTION_GROUPS)[number];
  /** It goes round (an idle, a dance, a walk cycle). */
  loop?: true;
}

let list: LibraryMotion[] = [];
let asked = false;
const listeners = new Set<() => void>();
const coming = new Map<string, Promise<Clip | null>>();
/** Those not found (asked for once). */
const missing = new Set<string>();
/** Those that could not be fetched (offline): not before when they may be asked for again. */
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

/** One of them fetched (once at a time): the clip, or null (not found, or offline). */
function fetched(id: string): Promise<Clip | null> {
  if (missing.has(id) || (retry.get(id) ?? 0) > Date.now()) return Promise.resolve(null);
  let p = coming.get(id);
  if (!p) {
    p = fetch(withBase(`/motions/${encodeURIComponent(id.slice(LIBRARY.length))}.json`))
      // (Not a clip, as a host's page for a missing file: missing.)
      .then((r) => (r.ok ? r.json().catch(() => null) : null))
      .then((json) => {
        const clip = json && parseClip(json);
        if (!clip || clip.id !== id) {
          missing.add(id);
          return null;
        }
        retry.delete(id);
        return clip;
      })
      .catch(() => {
        // (Offline: asked for again when wanted again, after a while.)
        retry.set(id, Date.now() + RETRY_MS);
        return null;
      })
      .finally(() => coming.delete(id));
    coming.set(id, p);
  }
  return p;
}

/** Bring one of them to hand (once): whether it is. */
export async function fetchLibraryClip(id: string): Promise<boolean> {
  if (hasClip(id)) return true;
  const clip = await fetched(id);
  if (clip) putClips([clip]);
  return !!clip;
}

/**
 * Bring those of `ids` that are the Library's to hand (the motions a project's scenes play), all
 * at once when they have all come (what plays them is worked out again once, not per motion).
 * Whether any could not be fetched (offline), to be asked for again later.
 */
export async function fetchLibraryClips(ids: string[]): Promise<boolean> {
  const mine = ids.filter((id) => id.startsWith(LIBRARY) && !hasClip(id));
  const got = await Promise.all(mine.map(fetched));
  putClips(got.filter((c): c is Clip => !!c && !hasClip(c.id)));
  return mine.some((id) => retry.has(id));
}
