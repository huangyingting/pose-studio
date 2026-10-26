import type { Store } from '../store';
import { SYSTEM_PROMPT, TOOLS, runTool } from './tools';
import type { TurnEvents } from './agent';

/*
 * OpenAI and Azure OpenAI through the Responses API (function tools work with reasoning models
 * there). The conversation lives on the provider: each request continues `previous_response_id`.
 */

export interface ResponsesTarget {
  /** Full URL of the responses endpoint. */
  url: string;
  headers: Record<string, string>;
  model: string;
}

interface OutputItem {
  type: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: { type: string; text?: string }[];
}

const MAX_STEPS = 40;

export function openaiTarget(apiKey: string, model: string): ResponsesTarget {
  return { url: 'https://api.openai.com/v1/responses', headers: { Authorization: `Bearer ${apiKey}` }, model };
}

/** Azure OpenAI: the resource endpoint (https://NAME.openai.azure.com) and a deployment name. */
export function azureTarget(apiKey: string, endpoint: string, deployment: string): ResponsesTarget {
  return { url: `${endpoint.replace(/\/+$/, '')}/openai/v1/responses`, headers: { 'api-key': apiKey }, model: deployment };
}

export async function responsesTurn(
  target: ResponsesTarget,
  previous: string | null,
  text: string,
  store: Store,
  events: TurnEvents,
  signal: AbortSignal,
): Promise<string | null> {
  const tools = TOOLS.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema, strict: true }));
  let input: unknown[] = [{ role: 'user', content: text }];
  let last = previous;
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...target.headers },
      body: JSON.stringify({ model: target.model, instructions: SYSTEM_PROMPT, input, tools, max_output_tokens: 16000, ...(last ? { previous_response_id: last } : {}) }),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      throw new Error(res.status === 401 ? 'The API key was rejected.' : msg);
    }
    last = data.id;
    const output = (data.output ?? []) as OutputItem[];
    for (const item of output) {
      if (item.type !== 'message') continue;
      const t = (item.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('').trim();
      if (t) events.onText(t);
    }
    const calls = output.filter((item) => item.type === 'function_call');
    if (!calls.length) return last;
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
