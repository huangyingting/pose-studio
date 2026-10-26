import type { Store } from '../store';
import { copilotTurn } from './copilot';
import { azureTarget, openaiTarget, responsesTurn } from './openai';

/*
 * The assistant: GitHub Copilot through the local companion (no key in the browser), or the
 * user's own OpenAI / Azure OpenAI key (kept in this browser only); a conversation, one turn at
 * a time.
 */

export type Provider = 'copilot' | 'openai' | 'azure';

export interface AgentConfig {
  provider: Provider;
  /** OpenAI / Azure only. */
  apiKey: string;
  /** Model id, or the deployment name on Azure. */
  model: string;
  /** Azure resource endpoint, e.g. https://NAME.openai.azure.com */
  endpoint: string;
}

/** `label` is the short form for the provider switch, `name` the full one. */
export const PROVIDERS: { id: Provider; label: string; name: string; keyHint: string }[] = [
  { id: 'copilot', label: 'Copilot', name: 'GitHub Copilot', keyHint: '' },
  { id: 'openai', label: 'OpenAI', name: 'OpenAI', keyHint: 'sk-…' },
  { id: 'azure', label: 'Azure', name: 'Azure OpenAI', keyHint: 'Azure key' },
];

export interface TurnEvents {
  onText(text: string): void;
  onTool(name: string, input: unknown, result: string, ok: boolean): void;
}

/** Provider-side conversation state. */
export type Conversation =
  | { provider: 'copilot'; sessionId: string | null }
  | { provider: 'openai' | 'azure'; previous: string | null };

const KEY = 'pose-studio:assistant';

const DEFAULT: AgentConfig = { provider: 'copilot', apiKey: '', model: 'auto', endpoint: '' };

export function loadConfig(): AgentConfig {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!PROVIDERS.some((p) => p.id === v.provider)) return { ...DEFAULT };
    return {
      provider: v.provider,
      apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
      model: typeof v.model === 'string' ? v.model : '',
      endpoint: typeof v.endpoint === 'string' ? v.endpoint : '',
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveConfig(c: AgentConfig) {
  try {
    // Copilot needs no key: do not keep one around from another provider.
    localStorage.setItem(KEY, JSON.stringify(c.provider === 'copilot' ? { ...c, apiKey: '' } : c));
  } catch {
    // Storage full or blocked: the settings just do not persist.
  }
}

export function configReady(c: AgentConfig) {
  if (c.provider === 'copilot') return !!c.model;
  return !!c.apiKey && !!c.model && (c.provider !== 'azure' || /^https:\/\//.test(c.endpoint));
}

export function newConversation(c: AgentConfig): Conversation {
  return c.provider === 'copilot' ? { provider: 'copilot', sessionId: null } : { provider: c.provider, previous: null };
}

/** One user message, with as many tool calls as the model needs. Returns the next conversation state. */
export async function runTurn(c: AgentConfig, conv: Conversation, text: string, store: Store, events: TurnEvents, signal: AbortSignal): Promise<Conversation> {
  try {
    if (conv.provider === 'copilot') {
      return { provider: 'copilot', sessionId: await copilotTurn(store, c.model, conv.sessionId, text, events, signal) };
    }
    const target = c.provider === 'azure' ? azureTarget(c.apiKey, c.endpoint, c.model) : openaiTarget(c.apiKey, c.model);
    return { provider: conv.provider, previous: await responsesTurn(target, conv.previous, text, store, events, signal) };
  } catch (err) {
    if (signal.aborted) throw new Error('Stopped');
    if (err instanceof TypeError) throw new Error(`Could not reach ${PROVIDERS.find((p) => p.id === c.provider)!.name} (network or endpoint).`);
    throw err;
  }
}
