import type Anthropic from '@anthropic-ai/sdk';
import type { Store } from '../store';
import { SYSTEM_PROMPT, TOOLS, runTool } from './tools';
import type { TurnEvents } from './agent';

/*
 * Claude through the official SDK, called from the browser with the user's own key (it never
 * leaves their machine except to api.anthropic.com). A manual tool loop, so each tool call shows
 * in the panel as it happens. The SDK is loaded only when this provider is used.
 */

export const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

const MAX_STEPS = 40;

export async function anthropicTurn(
  o: { apiKey: string; model: string },
  history: Anthropic.Beta.BetaMessageParam[],
  text: string,
  store: Store,
  events: TurnEvents,
  signal: AbortSignal,
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const { default: Client } = await import('@anthropic-ai/sdk');
  const client = new Client({ apiKey: o.apiKey, dangerouslyAllowBrowser: true });
  const tools: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema,
    strict: true,
  }));
  // Haiku has no server-side fallback; Opus and Sonnet fall back to another model on a refusal.
  const fallback = o.model.includes('haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: 'user', content: text }];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.beta.messages.create({
      model: o.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
      output_config: { effort: 'medium' },
      ...fallback,
    }, { signal });
    // Keep the whole assistant turn (thinking blocks included) for the next request.
    messages.push({ role: 'assistant', content: response.content });
    for (const block of response.content) if (block.type === 'text' && block.text.trim()) events.onText(block.text);

    if (response.stop_reason === 'refusal') {
      events.onText('The model declined this request.');
      return messages;
    }
    if (response.stop_reason === 'pause_turn') continue;
    if (response.stop_reason !== 'tool_use') return messages;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const r = runTool(store, block.name, block.input);
      events.onTool(block.name, block.input, r.text, r.ok);
      results.push({ type: 'tool_result', tool_use_id: block.id, content: r.text, ...(r.ok ? {} : { is_error: true }) });
    }
    messages.push({ role: 'user', content: results });
  }
  events.onText('Stopped after many steps; ask me to continue.');
  return messages;
}

/** A readable message for an API error (bad key, rate limit, network). */
export async function anthropicError(err: unknown) {
  const { default: Client } = await import('@anthropic-ai/sdk');
  if (err instanceof Client.AuthenticationError) return 'The Anthropic API key was rejected.';
  if (err instanceof Client.RateLimitError) return 'Rate limited by Anthropic: try again in a moment.';
  if (err instanceof Client.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`;
  return null;
}
