import { parseLibrary } from '@/lib/doc';
import { currentUserId } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

/*
 * The signed-in user's library. PUT carries the version it was based on; if the server has moved
 * on (another device saved), it answers 409 with the server copy so the browser can merge.
 */

const MAX_BYTES = 8 * 1024 * 1024;

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: 'Sign in to sync your library' }, { status: 401 });
  const row = await prisma.library.findUnique({ where: { userId } });
  return Response.json(row ? { library: JSON.parse(row.data), version: row.version } : { library: null, version: 0 }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: 'Sign in to sync your library' }, { status: 401 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: 'The library is too large to sync' }, { status: 413 });
  let body: { library?: unknown; baseVersion?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const base = Number(body.baseVersion);
  if (!Number.isInteger(base) || base < 0) return Response.json({ error: 'baseVersion is required' }, { status: 400 });
  // Validated and normalised like any library file.
  let data: string;
  try {
    data = JSON.stringify(parseLibrary(body.library));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  // (The server's copy, to merge with: another device saved since this one last synced.)
  const conflict = async () => {
    const latest = await prisma.library.findUnique({ where: { userId } });
    return Response.json({ error: 'Changed on another device', library: latest ? JSON.parse(latest.data) : null, version: latest?.version ?? 0 }, { status: 409 });
  };
  const current = await prisma.library.findUnique({ where: { userId } });
  if ((current?.version ?? 0) !== base) return conflict();
  if (!current) {
    // (Two devices' first syncs at once: the second finds the first's there.)
    try {
      await prisma.library.create({ data: { userId, data, version: 1 } });
    } catch (err) {
      if (!(await prisma.library.findUnique({ where: { userId }, select: { version: true } }))) throw err;
      return conflict();
    }
    return Response.json({ version: 1 });
  }
  // Only if nobody saved in between (compare-and-set on the version).
  const { count } = await prisma.library.updateMany({ where: { userId, version: base }, data: { data, version: base + 1 } });
  if (!count) return conflict();
  return Response.json({ version: base + 1 });
}
