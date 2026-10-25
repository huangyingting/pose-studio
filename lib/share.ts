import { parseScene } from './doc';
import type { Scene } from './types';

/*
 * Share links carry a single scene in the URL fragment (never sent to a server):
 *   https://host/#scene=<base64url(deflate-raw(JSON))>
 */

const PARAM = 'scene';

function toBase64Url(bytes: Uint8Array) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Largest decoded scene accepted from a link (a real scene is a few KB). */
const MAX_DECODED = 1_000_000;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    // Stop early instead of inflating a "zip bomb" into memory.
    if (size > limit) {
      await reader.cancel();
      throw new Error('Share link is too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function encodeScene(scene: Scene): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(scene));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeScene(encoded: string): Promise<Scene> {
  if (encoded.length > 200_000) throw new Error('Share link is too long');
  const json = await pipe(fromBase64Url(encoded), new DecompressionStream('deflate-raw'), MAX_DECODED);
  return parseScene(JSON.parse(new TextDecoder().decode(json)));
}

export async function shareUrl(scene: Scene, base = window.location.href) {
  const url = new URL(base);
  url.hash = `${PARAM}=${await encodeScene(scene)}`;
  return url.toString();
}

/** Read a scene from the current URL fragment, if there is one. */
export function sceneParam(hash = window.location.hash): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.get(PARAM);
}
