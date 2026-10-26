import { SYSTEM_PROMPT, TOOLS } from '@/lib/agent/tools';
import { dailyLimit, today, upstream } from '@/lib/server/ai';
import { currentUserId } from '@/lib/server/auth';
import { prisma } from '@/lib/server/db';

/*
 * The assistant's model calls, made with the server's key. The browser sends the conversation
 * (new user text or tool results, and the previous response id); this adds the studio's
 * instructions and tools, enforces the daily limit and records usage.
 */

const MAX_INPUT = 300_000;
const TOOL_SPECS = TOOLS.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema, strict: true }));

async function usage(userId: string) {
  const row = await prisma.aiUsage.findUnique({ where: { userId_day: { userId, day: today() } } });
  return row?.requests ?? 0;
}

export async function GET() {
  const userId = await currentUserId();
  return Response.json(
    { enabled: !!upstream(), signedIn: !!userId, used: userId ? await usage(userId) : 0, limit: dailyLimit() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: 'Sign in to use the assistant' }, { status: 401 });
  const up = upstream();
  if (!up) return Response.json({ error: 'The assistant is not configured on this server' }, { status: 503 });
  if ((await usage(userId)) >= dailyLimit()) return Response.json({ error: 'Daily assistant limit reached; it resets at midnight UTC' }, { status: 429 });

  const text = await req.text();
  if (text.length > MAX_INPUT) return Response.json({ error: 'Request too large' }, { status: 413 });
  let body: { input?: unknown; previous_response_id?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body.input) || !body.input.length || body.input.length > 64) return Response.json({ error: 'input must be a non-empty list' }, { status: 400 });
  const previous = typeof body.previous_response_id === 'string' && /^[\w-]{1,200}$/.test(body.previous_response_id) ? body.previous_response_id : undefined;

  const res = await fetch(up.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...up.headers },
    body: JSON.stringify({ model: up.model, instructions: SYSTEM_PROMPT, tools: TOOL_SPECS, input: body.input, max_output_tokens: 16000, ...(previous ? { previous_response_id: previous } : {}) }),
    signal: req.signal,
  });
  const data = await res.json().catch(() => ({}));
  const day = today();
  await prisma.aiUsage.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, requests: 1, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
    update: { requests: { increment: 1 }, inputTokens: { increment: data.usage?.input_tokens ?? 0 }, outputTokens: { increment: data.usage?.output_tokens ?? 0 } },
  });
  if (!res.ok || data.error) {
    console.error('AI upstream error', res.status, data.error?.message);
    return Response.json({ error: 'The AI service could not answer; try again' }, { status: 502 });
  }
  return Response.json({ id: data.id, output: data.output ?? [] });
}
