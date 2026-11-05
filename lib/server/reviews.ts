import 'server-only';
import { currentUserId } from './auth';
import { prisma } from './db';

/** Refused, unless the one asking shared review `id`: why, or null. */
export async function ownerCheck(id: string): Promise<Response | null> {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: 'Sign in to manage your reviews' }, { status: 401 });
  const row = await prisma.review.findUnique({ where: { id }, select: { userId: true } });
  if (!row) return Response.json({ error: 'No such review' }, { status: 404 });
  if (row.userId !== userId) return Response.json({ error: 'Only who shared it can do that' }, { status: 403 });
  return null;
}
