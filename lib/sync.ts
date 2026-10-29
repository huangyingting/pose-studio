import { sceneAt } from './evaluate';
import { newScene } from './doc';
import type { ProjectSettings, Library, Scene } from './types';

/*
 * Library sync (server edition): a three-way merge of the server's library, this device's and the
 * last version both agreed on ("base", kept per device as a hash per pose). A pose changed on one
 * side wins; a pose changed on both keeps the server's and adds this device's as a copy; poses
 * deleted on one side and untouched on the other go. Nothing edited is ever lost.
 */

export interface SyncBase {
  scenes: Record<string, string>;
  /** The scenes' order (the story's) both sides had. */
  order?: string;
  /** The project settings both sides had. */
  settings?: string;
  /** Saved poses both sides had. */
  poses?: string[];
  /** Imported motions both sides had. */
  clips?: string[];
  /** Imported characters both sides had. */
  models?: string[];
  /** Saved scene templates both sides had. */
  templates?: string[];
  /** Shoot presets both sides had. */
  shoots?: string[];
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
const orderOf = (lib: Library) => lib.scenes.map((s) => s.id).join();
const settingsHash = (f: ProjectSettings | undefined) => hash(stable(f ?? null));

/** A project nobody has touched yet: the one blank scene a new device starts with. */
function untouched(lib: Library) {
  if (lib.scenes.length !== 1 || lib.settings || lib.poses?.length || lib.clips?.length || lib.models?.length || lib.templates?.length || lib.shoots?.length) return false;
  const strip = (sc: Scene) => stable({ ...sc, id: 0, figures: sc.figures.map((f) => ({ ...f, id: 0 })), cameras: sc.cameras.map((c) => ({ ...c, id: 0 })) });
  return strip(lib.scenes[0]) === strip(newScene('Scene 1'));
}

/** The library as synced: animated poses at frame 0 (the open pose follows the playhead locally). */
export function canonical(lib: Library): Library {
  return { ...lib, scenes: lib.scenes.map((s) => (s.animation ? sceneAt(s, 0) : s)) };
}

export function syncBase(lib: Library): SyncBase {
  return {
    scenes: Object.fromEntries(lib.scenes.map((s) => [s.id, sceneHash(s)])), order: orderOf(lib), settings: settingsHash(lib.settings),
    poses: (lib.poses ?? []).map((p) => p.id), clips: (lib.clips ?? []).map((m) => m.id), models: (lib.models ?? []).map((m) => m.id), templates: (lib.templates ?? []).map((t) => t.id),
    shoots: (lib.shoots ?? []).map((p) => p.id),
  };
}

/** Whether a library is exactly what both sides last agreed on (nothing to push). */
export function matchesBase(lib: Library, base: SyncBase | null) {
  if (!base) return false;
  return lib.scenes.length === Object.keys(base.scenes).length
    && lib.scenes.every((s) => base.scenes[s.id] === sceneHash(s))
    && orderOf(lib) === base.order
    && settingsHash(lib.settings) === base.settings
    && (lib.poses ?? []).map((p) => p.id).join() === (base.poses ?? []).join()
    && (lib.clips ?? []).map((m) => m.id).join() === (base.clips ?? []).join()
    && (lib.models ?? []).map((m) => m.id).join() === (base.models ?? []).join()
    && (lib.templates ?? []).map((t) => t.id).join() === (base.templates ?? []).join()
    && (lib.shoots ?? []).map((p) => p.id).join() === (base.shoots ?? []).join();
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

  // The scenes' order (the story's): this device's if only it reordered them, else the account's.
  if (base && orderOf(local) !== base.order && orderOf(server) === base.order) {
    const at = new Map(local.scenes.map((s, i) => [s.id, i]));
    out.sort((p, q) => (at.get(p.id) ?? Infinity) - (at.get(q.id) ?? Infinity));
  }
  // The project settings: this device's if only it changed them, else the account's.
  const settings = base && settingsHash(local.settings) !== base.settings && settingsHash(server.settings) === base.settings ? local.settings : server.settings ?? local.settings;
  // Saved poses and imported motions: everything from both sides, except those one side deleted
  // since they last agreed.
  const poses = assets(server.poses, local.poses, base?.poses);
  const clips = assets(server.clips, local.clips, base?.clips);
  const models = assets(server.models, local.models, base?.models);
  const templates = assets(server.templates, local.templates, base?.templates);
  const shoots = assets(server.shoots, local.shoots, base?.shoots);
  return {
    ...server,
    scenes: out.length ? out : server.scenes,
    ...(settings ? { settings } : { settings: undefined }),
    ...(poses.length ? { poses } : { poses: undefined }),
    ...(clips.length ? { clips } : { clips: undefined }),
    ...(models.length ? { models } : { models: undefined }),
    ...(templates.length ? { templates } : { templates: undefined }),
    ...(shoots.length ? { shoots } : { shoots: undefined }),
  };
}

/** Both sides' assets, minus those one side deleted since they last agreed (`had`). */
function assets<T extends { id: string }>(server: T[] | undefined, local: T[] | undefined, had: string[] | undefined): T[] {
  const before = new Set(had ?? []);
  const onServer = new Set((server ?? []).map((x) => x.id));
  const onLocal = new Set((local ?? []).map((x) => x.id));
  return [
    ...(server ?? []).filter((x) => onLocal.has(x.id) || !before.has(x.id)),
    ...(local ?? []).filter((x) => !onServer.has(x.id) && !before.has(x.id)),
  ];
}
