import { currentUserId } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

/* Saying something about a scene shared for review, at a moment of it: anyone with the link (signed in, under their name). */

/** The most a note says, and the most a review keeps. */
const MAX_TEXT = 1000;
const MAX_COMMENTS = 500;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { t?: unknown; text?: unknown; author?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
  const t = Number(body.t);
  if (!text || !Number.isFinite(t) || t < 0) return Response.json({ error: 'A note needs its words and a time' }, { status: 400 });
  const review = await prisma.review.findUnique({ where: { id }, select: { id: true, _count: { select: { comments: true } } } });
  if (!review) return Response.json({ error: 'No such review' }, { status: 404 });
  if (review._count.comments >= MAX_COMMENTS) return Response.json({ error: 'This review has as many notes as it keeps' }, { status: 409 });
  // (Signed in: under their name; else the name they give.)
  const userId = await currentUserId();
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }) : null;
  const given = typeof body.author === 'string' ? body.author.trim().slice(0, 60) : '';
  const author = user?.name || user?.email || given || 'Someone';
  const row = await prisma.reviewComment.create({ data: { reviewId: id, author, t: Math.round(t * 1000) / 1000, text } });
  return Response.json({ id: row.id, author, t: row.t, text, at: row.createdAt.getTime() });
}
