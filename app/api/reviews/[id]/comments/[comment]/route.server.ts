import { prisma } from '@/lib/server/db';
import { ownerCheck } from '@/lib/server/reviews';

/* A note on a review taken away: by who shared the review. */

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; comment: string }> }) {
  const { id, comment } = await params;
  const owner = await ownerCheck(id);
  if (owner) return owner;
  const { count } = await prisma.reviewComment.deleteMany({ where: { id: comment, reviewId: id } });
  if (!count) return Response.json({ error: 'No such note' }, { status: 404 });
  return Response.json({ ok: true });
}
