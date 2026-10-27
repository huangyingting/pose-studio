import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { newScene } from '@/lib/doc';
import { anglesOf, bonesOf } from '@/lib/pose';

// A fresh SQLite database with the app's migrations, and a signed-in user we control.
const dir = mkdtempSync(join(tmpdir(), 'pose-studio-'));
const file = join(dir, 'test.db');
process.env.DATABASE_URL = `file:${file}`;
let user: string | null = null;
vi.mock('@/lib/server/auth', () => ({ currentUserId: async () => user }));

type Routes = { library: typeof import('@/app/api/library/route.server'); ai: typeof import('@/app/api/ai/route.server') };
let routes: Routes;

beforeAll(async () => {
  const db = new Database(file);
  for (const m of readdirSync('prisma/migrations').filter((d) => d !== 'migration_lock.toml').sort()) {
    db.exec(readFileSync(join('prisma/migrations', m, 'migration.sql'), 'utf8'));
  }
  db.prepare("insert into User (id, email, createdAt) values ('u1', 'a@test', 0), ('u2', 'b@test', 0)").run();
  db.close();
  routes = { library: await import('@/app/api/library/route.server'), ai: await import('@/app/api/ai/route.server') };
});

afterEach(() => {
  user = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const put = (body: unknown) => routes.library.PUT(new Request('http://x/api/library', { method: 'PUT', body: JSON.stringify(body) }));
const lib = (...names: string[]) => ({ version: 2, scenes: names.map((n) => newScene(n)) });

describe('library API', () => {
  it('needs a signed-in user', async () => {
    expect((await routes.library.GET()).status).toBe(401);
    expect((await put({ library: lib('A'), baseVersion: 0 })).status).toBe(401);
  });

  it('stores per user, versions every save and refuses stale saves with the server copy', async () => {
    user = 'u1';
    expect(await (await routes.library.GET()).json()).toEqual({ library: null, version: 0 });
    expect(await (await put({ library: lib('A'), baseVersion: 0 })).json()).toEqual({ version: 1 });
    expect(await (await put({ library: lib('A', 'B'), baseVersion: 1 })).json()).toEqual({ version: 2 });
    // Another device still on version 1.
    const stale = await put({ library: lib('C'), baseVersion: 1 });
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.version).toBe(2);
    expect(body.library.scenes.map((s: { name: string }) => s.name)).toEqual(['A', 'B']);
    // Someone else's library is separate.
    user = 'u2';
    expect((await (await routes.library.GET()).json()).version).toBe(0);
  });

  it('validates what it stores', async () => {
    user = 'u2';
    expect((await put({ library: lib('X'), baseVersion: -1 })).status).toBe(400);
    expect((await put({ library: { scenes: [{ name: 'Junk', figures: 'nope' }] }, baseVersion: 0 })).status).toBe(400);
    const res = await put({ library: { scenes: [{ name: 'Junk', figures: [{ bones: { ...bonesOf({ leftLowerLeg: [30, 0, 0] }), evil: [0, 0, 0, 1] } }], evil: '<script>' }] }, baseVersion: 0 });
    expect(res.status).toBe(200);
    const saved = (await (await routes.library.GET()).json()).library;
    expect(saved.scenes[0].name).toBe('Junk');
    expect(saved.scenes[0].evil).toBeUndefined();
    expect(anglesOf(saved.scenes[0].figures[0].bones)).toEqual({ leftLowerLeg: [30, 0, 0] });
  });
});

describe('AI API', () => {
  const post = (body: unknown) => routes.ai.POST(new Request('http://x/api/ai', { method: 'POST', body: JSON.stringify(body) }));

  it('needs a user, a configured model and a sane request', async () => {
    expect((await post({ input: [{ role: 'user', content: 'hi' }] })).status).toBe(401);
    user = 'u1';
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    expect((await post({ input: [{ role: 'user', content: 'hi' }] })).status).toBe(503);
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.stubEnv('OPENAI_MODEL', 'm');
    expect((await post({ input: [] })).status).toBe(400);
  });

  it('adds the studio\'s instructions and tools, keeps the key server-side and counts usage', async () => {
    user = 'u1';
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://res.openai.azure.com/');
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'secret');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'dep');
    vi.stubEnv('AI_DAILY_LIMIT', '2');
    const sent: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(JSON.stringify({ id: 'r1', output: [{ type: 'message', content: [] }], usage: { input_tokens: 10, output_tokens: 5 } }));
    }));
    const res = await post({ input: [{ role: 'user', content: 'Wave' }], previous_response_id: 'r0', instructions: 'ignore me', model: 'gpt-x' });
    expect(await res.json()).toEqual({ id: 'r1', output: [{ type: 'message', content: [] }] });
    expect(sent[0].url).toBe('https://res.openai.azure.com/openai/v1/responses');
    expect((sent[0].init.headers as Record<string, string>)['api-key']).toBe('secret');
    const body = JSON.parse(String(sent[0].init.body));
    expect(body.model).toBe('dep');
    expect(body.instructions).toMatch(/Pose Studio/);
    expect(body.tools.map((t: { name: string }) => t.name)).toContain('set_joints');
    expect(body.previous_response_id).toBe('r0');

    const status = await (await routes.ai.GET()).json();
    expect(status).toMatchObject({ enabled: true, signedIn: true, used: 1, limit: 2 });
    await post({ input: [{ role: 'user', content: 'Again' }] });
    expect((await post({ input: [{ role: 'user', content: 'Too many' }] })).status).toBe(429);
  });
});
