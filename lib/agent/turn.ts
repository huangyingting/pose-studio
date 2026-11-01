import { withBase } from '../paths';
import type { Store } from '../store';
import { runTool } from './tools';
import { STRIKES } from '../actions';
import { fetchLibraryClips } from '../librarymotions';

/*
 * One assistant turn (server edition): the conversation goes to /api/ai, which calls the model
 * with the server's key; tool calls come back and run here, on the open pose, and their results
 * go back until the model answers. The conversation lives on the provider (previous response id).
 */

interface TurnEvents {
  onText(text: string): void;
  onTool(name: string, input: unknown, result: string, ok: boolean): void;
}

interface OutputItem {
  type: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: { type: string; text?: string }[];
}

const MAX_STEPS = 40;

export async function assistantTurn(previous: string | null, text: string, store: Store, events: TurnEvents, signal: AbortSignal): Promise<string | null> {
  let input: unknown[] = [{ role: 'user', content: text }];
  let last = previous;
  for (let step = 0; step < MAX_STEPS; step++) {
    let res: Response;
    try {
      res = await fetch(withBase('/api/ai'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, ...(last ? { previous_response_id: last } : {}) }),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw new Error('Stopped');
      throw new Error(`Could not reach the server (${(err as Error).message})`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
    last = data.id;
    const output = (data.output ?? []) as OutputItem[];
    for (const item of output) {
      if (item.type !== 'message') continue;
      const t = (item.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('').trim();
      if (t) events.onText(t);
    }
    const calls = output.filter((item) => item.type === 'function_call');
    if (!calls.length) return last;
    // (A strike plays the Library's motions: brought to hand first.)
    if (calls.some((c) => c.name === 'strike')) await fetchLibraryClips(STRIKES.flatMap((x) => [x.id, x.reaction]));
    input = calls.map((call) => {
      let args: unknown = {};
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch {
        return { type: 'function_call_output', call_id: call.call_id, output: 'Error: the arguments were not valid JSON' };
      }
      const r = runTool(store, call.name ?? '', args);
      events.onTool(call.name ?? '', args, r.text, r.ok);
      return { type: 'function_call_output', call_id: call.call_id, output: r.text };
    });
  }
  events.onText('Stopped after many steps; ask me to continue.');
  return last;
}
