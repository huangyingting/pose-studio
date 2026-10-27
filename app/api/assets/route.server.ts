import { currentUserId } from '@/lib/server/auth';
import { listAssets } from '@/lib/server/assets';

/* The ids of the signed-in user's imported clips kept on the server (their frames: /api/assets/[id]). */

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: 'Sign in to sync your library' }, { status: 401 });
  return Response.json({ ids: await listAssets(userId) }, { headers: { 'Cache-Control': 'no-store' } });
}
