#!/usr/bin/env node
/*
 * Pose Studio companion: runs on your machine next to an open Pose Studio tab, which connects to
 * it from the AI tab ("Local companion"). It serves two kinds of clients:
 *
 *   GitHub Copilot  The AI tab's "GitHub Copilot" provider chats through here: a Copilot session
 *                   (GitHub Copilot SDK, your Copilot login) that can only use the studio's tools.
 *                   Start it with `npm install && npm start` in this folder.
 *   MCP clients     Copilot CLI, VS Code and other MCP clients launch it as a stdio MCP server:
 *                   command `node /path/to/pose-studio/companion/server.mjs --mcp`.
 *
 * Either way tool calls are relayed to the browser through a small HTTP bridge on 127.0.0.1 that
 * the studio long-polls, so the tools act on what you see (the same tools as the assistant).
 *
 * Environment: POSE_STUDIO_PORT (default 8765), POSE_STUDIO_ORIGINS (comma-separated origins
 * allowed to connect; default: localhost and the GitHub Pages site). Node 20.19+; the Copilot
 * SDK is only needed (and loaded) for GitHub Copilot chats.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.POSE_STUDIO_PORT || 8765);
const ORIGINS = (process.env.POSE_STUDIO_ORIGINS || 'https://huangyingting.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const CACHE = join(dirname(fileURLToPath(import.meta.url)), '.tools-cache.json');
const CALL_TIMEOUT = 60_000;
const CHAT_TIMEOUT = 600_000;
const POLL_WAIT = 25_000;

const log = (...a) => process.stderr.write(`[pose-studio] ${a.join(' ')}\n`);

/* ---------- state ---------- */

let tools = [];
try { tools = JSON.parse(readFileSync(CACHE, 'utf8')); } catch { /* first run */ }
let lastSeen = 0;
const queue = []; // calls waiting for the browser
const pending = new Map(); // id -> { resolve, timer }
let waiter = null; // a parked GET /next
let nextId = 1;

const connected = () => Date.now() - lastSeen < POLL_WAIT + 10_000;

function dispatch() {
  if (waiter && queue.length) {
    const { res } = waiter;
    waiter = null;
    send(res, 200, queue.shift());
  }
}

function callBrowser(name, input) {
  return new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, text: 'Pose Studio did not answer in time.' });
    }, CALL_TIMEOUT);
    pending.set(id, { resolve, timer });
    queue.push({ id, name, input });
    dispatch();
  });
}

/* ---------- GitHub Copilot (SDK) ---------- */

let copilot = null; // { sdk, client }
const sessions = new Map(); // sessionId -> { session, model }

async function copilotClient() {
  if (copilot) return copilot;
  let sdk;
  try {
    sdk = await import('@github/copilot-sdk');
  } catch {
    throw new Error('The GitHub Copilot SDK is not installed: run `npm install` in the companion folder.');
  }
  const client = new sdk.CopilotClient({ logLevel: 'error' });
  await client.start();
  copilot = { sdk, client };
  return copilot;
}

async function copilotModels() {
  const { client } = await copilotClient();
  const models = await client.listModels();
  return models.filter((m) => !m.policy || m.policy.state === 'enabled').map((m) => ({ id: m.id, name: m.name }));
}

/** A Copilot session that can use the studio's tools and nothing else (no shell, no files). */
async function copilotSession(sessionId, model, instructions) {
  const known = sessions.get(sessionId);
  if (known && known.model === model) return known.session;
  const { sdk, client } = await copilotClient();
  const session = await client.createSession({
    model,
    availableTools: new sdk.ToolSet().addCustom('*'),
    onPermissionRequest: sdk.approveAll,
    systemMessage: {
      mode: 'customize',
      sections: {
        identity: { action: 'replace', content: instructions },
        code_change_rules: { action: 'remove' },
        environment_context: { action: 'remove' },
      },
    },
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      skipPermission: true,
      handler: async (args) => {
        const r = await callBrowser(t.name, args ?? {});
        return r.ok ? r.text : { textResultForLlm: r.text, resultType: 'failure', error: r.text };
      },
    })),
  });
  sessions.set(session.sessionId, { session, model });
  return session;
}

/** One user message: returns the assistant's messages; tool calls run in the browser meanwhile. */
async function copilotChat(body, res) {
  if (!connected() || !tools.length) throw new Error('The studio is not connected to the companion.');
  const session = await copilotSession(body.sessionId, String(body.model || 'auto'), String(body.instructions || ''));
  const messages = [];
  const off = session.on('assistant.message', (e) => {
    const text = e.data?.content?.trim();
    if (text) messages.push(text);
  });
  // Stopping in the studio closes the connection before we answer: stop the turn too.
  const onClose = () => { if (!res.writableEnded) session.abort().catch(() => {}); };
  res.on('close', onClose);
  try {
    await session.sendAndWait({ prompt: String(body.text || '') }, CHAT_TIMEOUT);
  } finally {
    off();
    res.off('close', onClose);
  }
  return { sessionId: session.sessionId, messages };
}

/* ---------- HTTP bridge (browser side) ---------- */

function allowed(origin) {
  if (!origin) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return ORIGINS.includes(origin);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2_000_000) reject(new Error('too large'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

const http = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!allowed(origin)) return send(res, 403, { error: 'origin not allowed' });
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'content-type',
      // Chrome's Private Network Access: a public site may talk to this local server.
      'Access-Control-Allow-Private-Network': 'true',
    });
    return res.end();
  }
  try {
    if (req.method === 'POST' && req.url === '/connect') {
      const body = await readBody(req);
      if (Array.isArray(body.tools)) {
        const changed = JSON.stringify(body.tools) !== JSON.stringify(tools);
        tools = body.tools;
        if (changed) {
          try { writeFileSync(CACHE, JSON.stringify(tools)); } catch { /* read-only install */ }
          notify('notifications/tools/list_changed');
        }
      }
      lastSeen = Date.now();
      log('studio connected from', origin);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && req.url === '/next') {
      lastSeen = Date.now();
      if (waiter) send(waiter.res, 204);
      waiter = { res };
      const timer = setTimeout(() => {
        if (waiter?.res === res) {
          waiter = null;
          send(res, 204);
        }
      }, POLL_WAIT);
      res.on('close', () => {
        clearTimeout(timer);
        if (waiter?.res === res) waiter = null;
      });
      return dispatch();
    }
    if (req.method === 'POST' && req.url === '/result') {
      const body = await readBody(req);
      lastSeen = Date.now();
      const p = pending.get(body.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(body.id);
        p.resolve({ ok: !!body.ok, text: String(body.text ?? '') });
      }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && req.url === '/models') {
      return send(res, 200, { models: await copilotModels() });
    }
    if (req.method === 'POST' && req.url === '/chat') {
      return send(res, 200, await copilotChat(await readBody(req), res));
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    if (!res.headersSent) send(res, 400, { error: String(err.message || err) });
  }
});

http.on('error', (err) => log(`bridge could not listen on 127.0.0.1:${PORT}: ${err.message}`));
http.listen(PORT, '127.0.0.1', () => log(`bridge on http://127.0.0.1:${PORT}`));

/* ---------- MCP over stdio ---------- */

function write(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}
function notify(method, params) {
  write({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
}
const NOT_CONNECTED = `Pose Studio is not connected. Open it in a browser, go to the AI tab's settings and turn on "Local companion" (port ${PORT}).`;

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && write({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && write({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'pose-studio', version: '1.1.0' },
        instructions: 'Tools act on the pose open in a Pose Studio browser tab. Call get_scene first.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools });
    case 'tools/call': {
      if (!connected()) return reply({ content: [{ type: 'text', text: NOT_CONNECTED }], isError: true });
      const r = await callBrowser(params?.name, params?.arguments ?? {});
      return reply({ content: [{ type: 'text', text: r.text }], isError: !r.ok });
    }
    default:
      if (method?.startsWith('notifications/')) return undefined;
      return fail(-32601, `Method not found: ${method}`);
  }
}

// MCP over stdio when an MCP client launches us with --mcp.
if (process.argv.includes('--mcp')) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
      handle(msg).catch((err) => log('error', err.message));
    }
  });
  process.stdin.on('end', () => shutdown());
} else {
  log('ready: in Pose Studio, open the AI tab and choose GitHub Copilot');
}

async function shutdown() {
  for (const { session } of sessions.values()) await session.disconnect().catch(() => {});
  await copilot?.client.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
