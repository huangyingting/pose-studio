import { parseClip } from '@/lib/doc';
import { currentUserId } from '@/lib/server/auth';
import { readAsset, validId, writeAsset } from '@/lib/server/assets';

/* One of the signed-in user's imported clips, kept on the server as a file: read, or saved (validated). */

const MAX_BYTES = 32 * 1024 * 1024;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: 'Sign in to sync your library' }, { status: 401 });
  const { id } = await ctx.params;
  const data = validId(id) ? await readAsset(userId, id) : null;
  if (!data) return Response.json({ error: 'No such clip' }, { status: 404 });
  return new Response(data, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=31536000, immutable' } });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: 'Sign in to sync your library' }, { status: 401 });
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: 'Invalid id' }, { status: 400 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: 'The clip is too large' }, { status: 413 });
  let clip;
  try {
    clip = parseClip(JSON.parse(text));
  } catch {
    clip = null;
  }
  if (!clip || clip.id !== id) return Response.json({ error: 'Not a clip' }, { status: 400 });
  await writeAsset(userId, id, JSON.stringify(clip));
  return Response.json({ ok: true });
}

