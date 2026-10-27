import 'server-only';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DATABASE_URL } from './db';

/*
 * Each user's imported clips and characters on the server, as files (a clip's frames as JSON, a
 * character's glTF or FBX as it came), next to the database unless ASSETS_DIR says where: kept
 * apart from the library, which only lists them.
 */

const ROOT = process.env.ASSETS_DIR ?? join(dirname(resolve(DATABASE_URL.replace(/^file:/, ''))), 'assets');

/** Ids are the app's own (letters, digits, - and _). */
export const validId = (id: string) => /^[\w-]{1,80}$/.test(id);

const dir = (user: string) => join(ROOT, user.replace(/[^\w-]/g, '_'));
const KINDS = { json: 'application/json', bin: 'application/octet-stream' } as const;
export type AssetKind = keyof typeof KINDS;

export async function listAssets(user: string): Promise<string[]> {
  try {
    return (await readdir(dir(user))).map((f) => f.replace(/\.(json|bin)$/, ''));
  } catch {
    return [];
  }
}

/** An asset's file and its type, or null. */
export async function readAsset(user: string, id: string): Promise<{ data: Buffer; type: string } | null> {
  for (const kind of Object.keys(KINDS) as AssetKind[]) {
    try {
      return { data: await readFile(join(dir(user), `${id}.${kind}`)), type: KINDS[kind] };
    } catch {
      // Not of this kind.
    }
  }
  return null;
}

export async function writeAsset(user: string, id: string, kind: AssetKind, data: string | Uint8Array) {
  await mkdir(dir(user), { recursive: true });
  await writeFile(join(dir(user), `${id}.${kind}`), data);
}
