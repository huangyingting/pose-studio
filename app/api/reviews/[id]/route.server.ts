import { prisma } from '@/lib/server/db';

/* A scene shared for review, and what has been said about it: for anyone with its link. */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await prisma.review.findUnique({ where: { id }, include: { comments: { orderBy: [{ t: 'asc' }, { createdAt: 'asc' }] } } });
  if (!row) return Response.json({ error: 'No such review' }, { status: 404 });
  return Response.json({
    name: row.name,
    scene: JSON.parse(row.scene),
    comments: row.comments.map((c) => ({ id: c.id, author: c.author, t: c.t, text: c.text, at: c.createdAt.getTime() })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
