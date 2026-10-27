import 'server-only';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DATABASE_URL } from './db';

/*
 * Each user's imported clips on the server, as files (one JSON file per clip), next to the
 * database unless ASSETS_DIR says where: kept apart from the library, which only lists them.
 */

const ROOT = process.env.ASSETS_DIR ?? join(dirname(resolve(DATABASE_URL.replace(/^file:/, ''))), 'assets');

/** Ids are the app's own (letters, digits, - and _). */
export const validId = (id: string) => /^[\w-]{1,80}$/.test(id);

const dir = (user: string) => join(ROOT, user.replace(/[^\w-]/g, '_'));

export async function listAssets(user: string): Promise<string[]> {
  try {
    return (await readdir(dir(user))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

export async function readAsset(user: string, id: string): Promise<string | null> {
  try {
    return await readFile(join(dir(user), `${id}.json`), 'utf8');
  } catch {
    return null;
  }
}

export async function writeAsset(user: string, id: string, data: string) {
  await mkdir(dir(user), { recursive: true });
  await writeFile(join(dir(user), `${id}.json`), data, 'utf8');
}

