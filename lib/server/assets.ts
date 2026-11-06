import 'server-only';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DATABASE_URL } from './db';

/*
 * Each user's imported clips, characters and sounds on the server, as files (a clip's frames as JSON, a
 * character's glTF or FBX and a sound's file as they came), next to the database unless ASSETS_DIR says where: kept
 * apart from the library, which only lists them.
 */

// (Paths made at run time: the build is told not to trace them.)
const ROOT = process.env.ASSETS_DIR ?? join(/*turbopackIgnore: true*/ dirname(resolve(/*turbopackIgnore: true*/ DATABASE_URL.replace(/^file:/, ''))), 'assets');

/** Ids are the app's own (letters, digits, - and _). */
export const validId = (id: string) => /^[\w-]{1,80}$/.test(id);

const dir = (user: string) => join(/*turbopackIgnore: true*/ ROOT, user.replace(/[^\w-]/g, '_'));
const file = (user: string, name: string) => join(/*turbopackIgnore: true*/ dir(user), name);
const KINDS = { json: 'application/json', bin: 'application/octet-stream', snd: 'audio/octet-stream' } as const;
type AssetKind = keyof typeof KINDS;

export async function listAssets(user: string): Promise<string[]> {
  return (await files(user)).map((f) => f.replace(/\.\w+$/, ''));
}

/** The ids of a user's assets that are sounds (#35). */
export async function listSounds(user: string): Promise<string[]> {
  return (await files(user)).filter((f) => f.endsWith('.snd')).map((f) => f.replace(/\.snd$/, ''));
}

async function files(user: string): Promise<string[]> {
  try {
    return await readdir(/*turbopackIgnore: true*/ dir(user));
  } catch {
    return [];
  }
}

/** An asset's file and its type, or null. */
export async function readAsset(user: string, id: string): Promise<{ data: Buffer; type: string } | null> {
  for (const kind of Object.keys(KINDS) as AssetKind[]) {
    try {
      return { data: await readFile(/*turbopackIgnore: true*/ file(user, `${id}.${kind}`)), type: KINDS[kind] };
    } catch {
      // Not of this kind.
    }
  }
  return null;
}

export async function writeAsset(user: string, id: string, kind: AssetKind, data: string | Uint8Array) {
  await mkdir(/*turbopackIgnore: true*/ dir(user), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ file(user, `${id}.${kind}`), data);
}

/** An asset's file deleted (whatever its kind); nothing if there is none. */
export async function deleteAsset(user: string, id: string) {
  for (const kind of Object.keys(KINDS) as AssetKind[]) await rm(/*turbopackIgnore: true*/ file(user, `${id}.${kind}`), { force: true });
}
