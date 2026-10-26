import type { Store } from '../store';
import { COMPANION_URL, bridge } from './bridge';
import { SYSTEM_PROMPT } from './tools';
import type { TurnEvents } from './agent';

/*
 * GitHub Copilot, through the local companion (companion/server.mjs), which runs a Copilot SDK
 * session with your Copilot login. The session can only use the studio's tools; it calls them
 * through the companion's bridge, so they run here, on the open pose.
 */

export const COMPANION_HELP = 'Start the local companion: run `npm install` and `npm start` in the companion folder of Pose Studio.';

async function companion<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${COMPANION_URL}${path}`, init);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error(`The local companion is not running. ${COMPANION_HELP}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Companion error ${res.status}`);
  return data as T;
}

/** Models the user's Copilot plan offers ("auto" first). */
export async function copilotModels(): Promise<string[]> {
  const { models } = await companion<{ models: { id: string }[] }>('/models');
  const ids = models.map((m) => m.id);
  return ids.includes('auto') ? ['auto', ...ids.filter((m) => m !== 'auto')] : ids;
}

export async function copilotTurn(
  store: Store,
  model: string,
  sessionId: string | null,
  text: string,
  events: TurnEvents,
  signal: AbortSignal,
): Promise<string | null> {
  if (!(await bridge.ready(store))) throw new Error(`The local companion is not running. ${COMPANION_HELP}`);
  const off = bridge.onTool((name, input, r) => events.onTool(name, input, r.text, r.ok));
  try {
    const reply = await companion<{ sessionId: string; messages: string[] }>('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, model, instructions: SYSTEM_PROMPT, text }),
      signal,
    });
    for (const m of reply.messages) events.onText(m);
    return reply.sessionId;
  } finally {
    off();
  }
}
