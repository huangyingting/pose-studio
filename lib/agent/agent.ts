import type Anthropic from '@anthropic-ai/sdk';
import type { Store } from '../store';
import { ANTHROPIC_MODELS, anthropicError, anthropicTurn } from './anthropic';
import { azureTarget, openaiTarget, responsesTurn } from './openai';

/*
 * The assistant: the user's own provider and key (kept in this browser only), a conversation,
 * and one turn at a time.
 */

export type Provider = 'anthropic' | 'openai' | 'azure';

export interface AgentConfig {
  provider: Provider;
  apiKey: string;
  /** Model id, or the deployment name on Azure. */
  model: string;
  /** Azure resource endpoint, e.g. https://NAME.openai.azure.com */
  endpoint: string;
}

export const PROVIDERS: { id: Provider; label: string; models: string[]; keyHint: string }[] = [
  { id: 'anthropic', label: 'Anthropic', models: ANTHROPIC_MODELS, keyHint: 'sk-ant-…' },
  { id: 'openai', label: 'OpenAI', models: [], keyHint: 'sk-…' },
  { id: 'azure', label: 'Azure OpenAI', models: [], keyHint: 'Azure key' },
];

export interface TurnEvents {
  onText(text: string): void;
  onTool(name: string, input: unknown, result: string, ok: boolean): void;
}

/** Provider-side conversation state. */
export type Conversation =
  | { provider: 'anthropic'; messages: Anthropic.Beta.BetaMessageParam[] }
  | { provider: 'openai' | 'azure'; previous: string | null };

const KEY = 'pose-studio:assistant';

export function loadConfig(): AgentConfig {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const provider: Provider = PROVIDERS.some((p) => p.id === v.provider) ? v.provider : 'anthropic';
    return {
      provider,
      apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
      model: typeof v.model === 'string' && v.model ? v.model : PROVIDERS.find((p) => p.id === provider)!.models[0] ?? '',
      endpoint: typeof v.endpoint === 'string' ? v.endpoint : '',
    };
  } catch {
    return { provider: 'anthropic', apiKey: '', model: ANTHROPIC_MODELS[0], endpoint: '' };
  }
}

export function saveConfig(c: AgentConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Storage full or blocked: the settings just do not persist.
  }
}

export function configReady(c: AgentConfig) {
  return !!c.apiKey && !!c.model && (c.provider !== 'azure' || /^https:\/\//.test(c.endpoint));
}

export function newConversation(c: AgentConfig): Conversation {
  return c.provider === 'anthropic' ? { provider: 'anthropic', messages: [] } : { provider: c.provider, previous: null };
}

/** One user message, with as many tool calls as the model needs. Returns the next conversation state. */
export async function runTurn(c: AgentConfig, conv: Conversation, text: string, store: Store, events: TurnEvents, signal: AbortSignal): Promise<Conversation> {
  try {
    if (conv.provider === 'anthropic') {
      return { provider: 'anthropic', messages: await anthropicTurn({ apiKey: c.apiKey, model: c.model }, conv.messages, text, store, events, signal) };
    }
    const target = c.provider === 'azure' ? azureTarget(c.apiKey, c.endpoint, c.model) : openaiTarget(c.apiKey, c.model);
    return { provider: conv.provider, previous: await responsesTurn(target, conv.previous, text, store, events, signal) };
  } catch (err) {
    if (signal.aborted) throw new Error('Stopped');
    const nice = conv.provider === 'anthropic' ? await anthropicError(err) : null;
    if (nice) throw new Error(nice);
    if (err instanceof TypeError) throw new Error(`Could not reach ${PROVIDERS.find((p) => p.id === c.provider)!.label} (network or endpoint).`);
    throw err;
  }
}
