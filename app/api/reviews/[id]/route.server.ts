import { currentUserId } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';
import { ownerCheck } from '@/lib/server/reviews';

/*
 * A scene shared for review, and what has been said about it: for anyone with its link. Its owner
 * (who shared it) may delete it, and its notes with it.
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await prisma.review.findUnique({ where: { id }, include: { comments: { orderBy: [{ t: 'asc' }, { createdAt: 'asc' }] } } });
  if (!row) return Response.json({ error: 'No such review' }, { status: 404 });
  const userId = await currentUserId();
  return Response.json({
    name: row.name,
    scene: JSON.parse(row.scene),
    comments: row.comments.map((c) => ({ id: c.id, author: c.author, t: c.t, text: c.text, at: c.createdAt.getTime() })),
    // (Whether the one asking shared it: they may delete its notes and it.)
    mine: !!userId && userId === row.userId,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await ownerCheck(id);
  if (owner) return owner;
  await prisma.review.delete({ where: { id } });
  return Response.json({ ok: true });
}
