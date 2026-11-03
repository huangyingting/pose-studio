import { parseScene } from '@/lib/doc';
import { currentUserId } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

/*
 * Scenes shared for review (server edition): a signed-in user shares a copy of a scene; anyone
 * with its link sees it and says what they think at moments of it ([id]/comments).
 */

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: 'Sign in to share a scene for review' }, { status: 401 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: 'The scene is too large to share' }, { status: 413 });
  let scene;
  try {
    // Validated and normalised like any scene file.
    scene = parseScene(JSON.parse(text).scene);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
  const row = await prisma.review.create({ data: { userId, name: scene.name.slice(0, 120), scene: JSON.stringify(scene) } });
  return Response.json({ id: row.id });
}
