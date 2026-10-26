import 'server-only';

/*
 * The server edition's AI: Azure OpenAI (or OpenAI) through the Responses API, with the server's
 * key. The browser only sends the conversation; the instructions, tools and model are set here.
 */

export interface Upstream {
  url: string;
  headers: Record<string, string>;
  model: string;
}

export function upstream(): Upstream | null {
  const e = process.env;
  if (e.AZURE_OPENAI_ENDPOINT && e.AZURE_OPENAI_API_KEY && e.AZURE_OPENAI_DEPLOYMENT) {
    return {
      url: `${e.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '')}/openai/v1/responses`,
      headers: { 'api-key': e.AZURE_OPENAI_API_KEY },
      model: e.AZURE_OPENAI_DEPLOYMENT,
    };
  }
  if (e.OPENAI_API_KEY && e.OPENAI_MODEL) {
    return { url: `${(e.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/responses`, headers: { Authorization: `Bearer ${e.OPENAI_API_KEY}` }, model: e.OPENAI_MODEL };
  }
  return null;
}

/** Model requests a user may make per UTC day (each assistant step is one request). */
export function dailyLimit() {
  const n = Number(process.env.AI_DAILY_LIMIT ?? 200);
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

export const today = () => new Date().toISOString().slice(0, 10);
