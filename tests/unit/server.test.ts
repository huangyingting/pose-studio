import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { newScene } from '@/lib/doc';
import { anglesOf, bonesOf } from '@/lib/pose';

// A fresh SQLite database with the app's migrations, and a signed-in user we control.
const dir = mkdtempSync(join(tmpdir(), 'filmstudio-'));
const file = join(dir, 'test.db');
process.env.DATABASE_URL = `file:${file}`;
process.env.ASSETS_DIR = join(dir, 'assets');
let user: string | null = null;
vi.mock('@/lib/server/auth', () => ({ currentUserId: async () => user }));

type Routes = {
  library: typeof import('@/app/api/library/route.server'); ai: typeof import('@/app/api/ai/route.server'); asset: typeof import('@/app/api/assets/[id]/route.server');
  reviews: typeof import('@/app/api/reviews/route.server'); review: typeof import('@/app/api/reviews/[id]/route.server'); notes: typeof import('@/app/api/reviews/[id]/comments/route.server');
  aNote: typeof import('@/app/api/reviews/[id]/comments/[comment]/route.server');
};
let routes: Routes;

beforeAll(async () => {
  const db = new Database(file);
  for (const m of readdirSync('prisma/migrations').filter((d) => d !== 'migration_lock.toml').sort()) {
    db.exec(readFileSync(join('prisma/migrations', m, 'migration.sql'), 'utf8'));
  }
  db.prepare("insert into User (id, email, createdAt) values ('u1', 'a@test', 0), ('u2', 'b@test', 0), ('u3', 'c@test', 0)").run();
  db.close();
  routes = {
    library: await import('@/app/api/library/route.server'), ai: await import('@/app/api/ai/route.server'), asset: await import('@/app/api/assets/[id]/route.server'),
    reviews: await import('@/app/api/reviews/route.server'), review: await import('@/app/api/reviews/[id]/route.server'), notes: await import('@/app/api/reviews/[id]/comments/route.server'),
    aNote: await import('@/app/api/reviews/[id]/comments/[comment]/route.server'),
  };
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

  it('two devices\' first saves at once: one is stored, the other told to merge with it', async () => {
    user = 'u3';
    const both = await Promise.all([put({ library: lib('P'), baseVersion: 0 }), put({ library: lib('Q'), baseVersion: 0 })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const lost = await both.find((r) => r.status === 409)!.json();
    expect(lost.version).toBe(1);
    expect(lost.library.scenes).toHaveLength(1);
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

describe('reviews API', () => {
  const at = (id: string) => ({ params: Promise.resolve({ id }) });
  const share = (body: unknown) => routes.reviews.POST(new Request('http://x/api/reviews', { method: 'POST', body: JSON.stringify(body) }));
  const note = (id: string, body: unknown) => routes.notes.POST(new Request(`http://x/api/reviews/${id}/comments`, { method: 'POST', body: JSON.stringify(body) }), at(id));
  const get = (id: string) => routes.review.GET(new Request(`http://x/api/reviews/${id}`), at(id));

  it('shares a scene for review when signed in; anyone with the link sees it and leaves notes at its moments', async () => {
    expect((await share({ scene: newScene('Pitch') })).status).toBe(401);
    user = 'u1';
    expect((await share({ scene: { figures: 'nope' } })).status).toBe(400);
    const { id } = await (await share({ scene: newScene('Pitch') })).json();
    // Anyone with the link: not signed in, under the name they give; signed in, under theirs.
    user = null;
    let r = await (await get(id)).json();
    expect(r.name).toBe('Pitch');
    expect(r.scene.name).toBe('Pitch');
    expect(r.comments).toEqual([]);
    expect((await note(id, { t: 1.5, text: 'Hold this longer', author: 'Kim' })).status).toBe(200);
    user = 'u2';
    expect((await note(id, { t: 0.5, text: 'Nice turn', author: 'Not me' })).status).toBe(200);
    r = await (await get(id)).json();
    expect(r.comments.map((c: { t: number; author: string; text: string }) => [c.t, c.author, c.text])).toEqual([[0.5, 'b@test', 'Nice turn'], [1.5, 'Kim', 'Hold this longer']]);
    // A note needs words and a time; a review that is not there has none.
    expect((await note(id, { t: -1, text: 'x' })).status).toBe(400);
    expect((await note(id, { t: 1, text: '  ' })).status).toBe(400);
    expect((await get('nope')).status).toBe(404);
    expect((await note('nope', { t: 1, text: 'x' })).status).toBe(404);
  });

  // (Each from an address of its own: the notes a minute are counted by who, or where from.)
  const from = (ip: string, id: string, body: unknown, headers: Record<string, string> = {}) =>
    routes.notes.POST(new Request(`http://x/api/reviews/${id}/comments`, { method: 'POST', headers: { 'x-forwarded-for': ip, ...headers }, body: JSON.stringify(body) }), at(id));

  it('takes a small note only, and so many a minute from one person or one address', async () => {
    user = 'u1';
    const { id } = await (await share({ scene: newScene('Limits') })).json();
    user = null;
    // Too big: by what it says it is, before it is read; and by what it is.
    expect((await from('10.0.0.1', id, { t: 1, text: 'x' }, { 'content-length': '100000' })).status).toBe(413);
    expect((await from('10.0.0.1', id, { t: 1, text: 'x'.repeat(9000) })).status).toBe(413);
    // A thousand characters of any script fit.
    expect((await from('10.0.0.2', id, { t: 1, text: '字'.repeat(1000), author: '读者' })).status).toBe(200);
    // Ten a minute from one address; the eleventh waits; another address is not held up.
    for (let i = 0; i < 9; i++) expect((await from('10.0.0.2', id, { t: 1, text: `n${i}` })).status).toBe(200);
    expect((await from('10.0.0.2', id, { t: 1, text: 'one more' })).status).toBe(429);
    expect((await from('10.0.0.3', id, { t: 1, text: 'elsewhere' })).status).toBe(200);
    // Signed in, counted by who, wherever from.
    user = 'u3';
    for (let i = 0; i < 10; i++) expect((await from(`10.1.0.${i}`, id, { t: 2, text: `u${i}` })).status).toBe(200);
    expect((await from('10.1.0.99', id, { t: 2, text: 'again' })).status).toBe(429);
  });

  it('lets who shared it delete a note, or the review with its notes; nobody else', async () => {
    user = 'u1';
    const { id } = await (await share({ scene: newScene('Mine') })).json();
    user = null;
    await from('10.2.0.1', id, { t: 1, text: 'Spam' });
    await from('10.2.0.1', id, { t: 2, text: 'Useful' });
    const notes = (await (await get(id)).json()).comments as { id: string; text: string }[];
    const spam = notes.find((n) => n.text === 'Spam')!.id;
    const del = (comment?: string) => (comment
      ? routes.aNote.DELETE(new Request(`http://x/api/reviews/${id}/comments/${comment}`, { method: 'DELETE' }), { params: Promise.resolve({ id, comment }) })
      : routes.review.DELETE(new Request(`http://x/api/reviews/${id}`, { method: 'DELETE' }), at(id)));
    // Not signed in, or not who shared it: refused, and told it is not theirs.
    expect((await del(spam)).status).toBe(401);
    user = 'u2';
    expect((await (await get(id)).json()).mine).toBe(false);
    expect((await del(spam)).status).toBe(403);
    expect((await del()).status).toBe(403);
    // Who shared it.
    user = 'u1';
    expect((await (await get(id)).json()).mine).toBe(true);
    expect((await del(spam)).status).toBe(200);
    expect((await del(spam)).status).toBe(404);
    expect(((await (await get(id)).json()).comments as { text: string }[]).map((n) => n.text)).toEqual(['Useful']);
    expect((await del()).status).toBe(200);
    expect((await get(id)).status).toBe(404);
  });
});

describe('assets API', () => {
  const at = (id: string) => ({ params: Promise.resolve({ id }) });
  const putAsset = (id: string, body: Uint8Array, type: string) => routes.asset.PUT(new Request(`http://x/api/assets/${id}`, { method: 'PUT', headers: { 'Content-Type': type }, body: new Blob([body as BlobPart]) }), at(id));

  it('keeps a character\'s file (known by its bytes) and gives it back; not an image, and not to someone else', async () => {
    user = 'u1';
    const glb = new Uint8Array([...new TextEncoder().encode('glTF'), 2, 0, 0, 0]);
    expect((await putAsset('model-1', glb, 'application/octet-stream')).status).toBe(200);
    const got = await routes.asset.GET(new Request('http://x/api/assets/model-1'), at('model-1'));
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(glb);
    expect((await putAsset('img-1', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png')).status).toBe(400);
    user = 'u2';
    expect((await routes.asset.GET(new Request('http://x/api/assets/model-1'), at('model-1'))).status).toBe(404);
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
    expect(body.instructions).toMatch(/Film Studio/);
    expect(body.tools.map((t: { name: string }) => t.name)).toContain('set_joints');
    expect(body.previous_response_id).toBe('r0');

    const status = await (await routes.ai.GET()).json();
    expect(status).toMatchObject({ enabled: true, signedIn: true, used: 1, limit: 2 });
    await post({ input: [{ role: 'user', content: 'Again' }] });
    expect((await post({ input: [{ role: 'user', content: 'Too many' }] })).status).toBe(429);
  });
});
