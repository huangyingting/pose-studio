import { currentUserId } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';
import { allow, clientKey } from '@/lib/server/ratelimit';

/*
 * Saying something about a scene shared for review, at a moment of it: anyone with the link (signed
 * in, under their name). The one route that takes words without an account: a small body, and so
 * many notes a minute from one person (or one address).
 */

/** The most a note says, and the most a review keeps. */
const MAX_TEXT = 1000;
const MAX_COMMENTS = 500;
/** The most a request to leave one may be (bytes: room for a thousand characters of any script), and how many one person leaves a minute. */
const MAX_BODY = 8192;
const PER_MINUTE = 10;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // (Refused by what it says it is before it is read, and by what it is after.)
  const tooBig = () => Response.json({ error: 'A note is at most a thousand characters' }, { status: 413 });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return tooBig();
  const raw = await req.text();
  if (raw.length > MAX_BODY) return tooBig();
  let body: { t?: unknown; text?: unknown; author?: unknown };
  try {
    body = JSON.parse(raw);
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
  if (!allow(userId ? `user:${userId}` : clientKey(req), PER_MINUTE, 60_000)) {
    return Response.json({ error: 'That is a lot of notes at once: wait a minute' }, { status: 429 });
  }
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }) : null;
  const given = typeof body.author === 'string' ? body.author.trim().slice(0, 60) : '';
  const author = user?.name || user?.email || given || 'Someone';
  const row = await prisma.reviewComment.create({ data: { reviewId: id, author, t: Math.round(t * 1000) / 1000, text } });
  return Response.json({ id: row.id, author, t: row.t, text, at: row.createdAt.getTime() });
}
