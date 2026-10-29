import { parseClip } from '@/lib/doc';
import { currentUserId } from '@/lib/server/auth';
import { readAsset, validId, writeAsset } from '@/lib/server/assets';

/*
 * One of the signed-in user's imported assets, kept on the server as a file: a clip's frames
 * (JSON, validated) or a character's file (as it came: glTF/GLB or FBX).
 */

const MAX_BYTES = 64 * 1024 * 1024;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: 'Sign in to sync your library' }, { status: 401 });
  const { id } = await ctx.params;
  const file = validId(id) ? await readAsset(userId, id) : null;
  if (!file) return Response.json({ error: 'No such asset' }, { status: 404 });
  return new Response(new Uint8Array(file.data), { headers: { 'Content-Type': file.type, 'Cache-Control': 'private, max-age=31536000, immutable' } });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: 'Sign in to sync your library' }, { status: 401 });
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: 'Invalid id' }, { status: 400 });
  const data = new Uint8Array(await req.arrayBuffer());
  if (data.length > MAX_BYTES) return Response.json({ error: 'The file is too large' }, { status: 413 });
  if (req.headers.get('content-type')?.startsWith('application/octet-stream')) {
    // A character: a glTF (JSON or binary) or FBX file.
    const head = new TextDecoder().decode(data.slice(0, 32));
    if (!/^glTF|^\s*\{|^Kaydara FBX Binary|^; FBX/.test(head)) return Response.json({ error: 'Not a glTF or FBX file' }, { status: 400 });
    await writeAsset(userId, id, 'bin', data);
    return Response.json({ ok: true });
  }
  let clip;
  try {
    clip = parseClip(JSON.parse(new TextDecoder().decode(data)));
  } catch {
    clip = null;
  }
  if (!clip || clip.id !== id) return Response.json({ error: 'Not a clip' }, { status: 400 });
  await writeAsset(userId, id, 'json', JSON.stringify(clip));
  return Response.json({ ok: true });
}
