import { sceneAt } from './animation';
import { newScene } from './doc';
import type { Library, Panel, Scene } from './types';

/*
 * Library sync (server edition): a three-way merge of the server's library, this device's and the
 * last version both agreed on ("base", kept per device as a hash per pose). A pose changed on one
 * side wins; a pose changed on both keeps the server's and adds this device's as a copy; poses
 * deleted on one side and untouched on the other go. Nothing edited is ever lost.
 */

export interface SyncBase {
  scenes: Record<string, string>;
  board: string;
  /** Saved poses both sides had. */
  poses?: string[];
}

function hash(text: string) {
  // FNV-1a, 52-bit: plenty to tell versions of a pose apart.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return (h1 * 0x100000 + (h2 & 0xfffff)).toString(36);
}

/** JSON with sorted keys: the same data hashes the same whatever order its keys were written in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export const sceneHash = (s: Scene) => hash(stable(s));
const boardHash = (b: Panel[] | undefined) => hash(stable(b ?? []));

/** A project nobody has touched yet: the one blank scene a new device starts with. */
function untouched(lib: Library) {
  if (lib.scenes.length !== 1 || lib.board?.length || lib.poses?.length) return false;
  const strip = (sc: Scene) => stable({ ...sc, id: 0, figures: sc.figures.map((f) => ({ ...f, id: 0 })) });
  return strip(lib.scenes[0]) === strip(newScene('Scene 1'));
}

/** The library as synced: animated poses at frame 0 (the open pose follows the playhead locally). */
export function canonical(lib: Library): Library {
  return { ...lib, scenes: lib.scenes.map((s) => (s.animation ? sceneAt(s, 0) : s)) };
}

export function syncBase(lib: Library): SyncBase {
  return { scenes: Object.fromEntries(lib.scenes.map((s) => [s.id, sceneHash(s)])), board: boardHash(lib.board), poses: (lib.poses ?? []).map((p) => p.id) };
}

/** Whether a library is exactly what both sides last agreed on (nothing to push). */
export function matchesBase(lib: Library, base: SyncBase | null) {
  if (!base) return false;
  return lib.scenes.length === Object.keys(base.scenes).length
    && lib.scenes.every((s) => base.scenes[s.id] === sceneHash(s))
    && boardHash(lib.board) === base.board
    && (lib.poses ?? []).map((p) => p.id).join() === (base.poses ?? []).join();
}

export function mergeLibraries(server: Library, local: Library, base: SyncBase | null): Library {
  // A new device brings nothing to merge: take the account's library as it is.
  if (!base && untouched(local)) return server;
  const localById = new Map(local.scenes.map((s) => [s.id, s]));
  const serverIds = new Set(server.scenes.map((s) => s.id));
  const baseHash = (id: string) => base?.scenes[id];
  const out: Scene[] = [];

  for (const s of server.scenes) {
    const mine = localById.get(s.id);
    const was = baseHash(s.id);
    if (!mine) {
      // Deleted here: drop it if the server's copy is the one we deleted.
      if (was && was === sceneHash(s)) continue;
      out.push(s);
      continue;
    }
    const mineHash = sceneHash(mine);
    const theirs = sceneHash(s);
    // Identical: keep this device's object, so nothing re-renders (thumbnails are cached by content).
    if (mineHash === theirs) out.push(mine);
    else if (mineHash === was) out.push(s);
    else if (theirs === was) out.push(mine);
    else out.push(s, { ...mine, id: `${mine.id}-${Date.now().toString(36)}`, name: `${mine.name} (this device)` });
  }
  for (const s of local.scenes) {
    if (serverIds.has(s.id)) continue;
    const was = baseHash(s.id);
    // Deleted on the server and untouched here: let it go.
    if (was && was === sceneHash(s)) continue;
    out.push(s);
  }

  const ids = new Set(out.map((s) => s.id));
  let board = server.board;
  if (base && boardHash(local.board) !== base.board && boardHash(server.board) === base.board) board = local.board;
  else if (!base || boardHash(local.board) !== base.board) {
    const known = new Set((server.board ?? []).map((p) => p.id));
    board = [...(server.board ?? []), ...(local.board ?? []).filter((p) => !known.has(p.id))];
  }
  board = board?.filter((p) => ids.has(p.sceneId));
  // Saved poses: everything from both sides, except those one side deleted since they last agreed.
  const had = new Set(base?.poses ?? []);
  const serverPoses = new Set((server.poses ?? []).map((p) => p.id));
  const localPoses = new Set((local.poses ?? []).map((p) => p.id));
  const poses = [
    ...(server.poses ?? []).filter((p) => localPoses.has(p.id) || !had.has(p.id)),
    ...(local.poses ?? []).filter((p) => !serverPoses.has(p.id) && !had.has(p.id)),
  ];
  return {
    ...server,
    scenes: out.length ? out : server.scenes,
    ...(board?.length ? { board } : { board: undefined }),
    ...(poses.length ? { poses } : { poses: undefined }),
  };
}
