import { currentUserId } from '@/lib/server/auth';
import { listAssets, listSounds } from '@/lib/server/assets';

/* The ids of the signed-in user's imported assets kept on the server (each: /api/assets/[id]), and which of them are sounds. */

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: 'Sign in to sync your library' }, { status: 401 });
  return Response.json({ ids: await listAssets(userId), sounds: await listSounds(userId) }, { headers: { 'Cache-Control': 'no-store' } });
}
