#!/usr/bin/env node
/*
 * Pose Studio MCP server: lets an MCP client (Claude Code, Claude Desktop, …) pose, stage and
 * animate in an open Pose Studio tab. It speaks MCP over stdio and relays tool calls to the
 * browser through a small HTTP bridge on 127.0.0.1, which the studio polls when "MCP bridge" is
 * on in its AI tab. The tools themselves run in the browser (the same ones as the assistant).
 *
 *   claude mcp add pose-studio -- node /path/to/pose-studio/mcp/server.mjs
 *
 * Environment: POSE_STUDIO_PORT (default 8765), POSE_STUDIO_ORIGINS (comma-separated origins
 * allowed to connect; default: localhost and the GitHub Pages site).
 * No dependencies: Node 18+.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.POSE_STUDIO_PORT || 8765);
const ORIGINS = (process.env.POSE_STUDIO_ORIGINS || 'https://huangyingting.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const CACHE = join(dirname(fileURLToPath(import.meta.url)), '.tools-cache.json');
const CALL_TIMEOUT = 60_000;
const POLL_WAIT = 25_000;

const log = (...a) => process.stderr.write(`[pose-studio-mcp] ${a.join(' ')}\n`);

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
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 400, { error: String(err.message || err) });
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
const NOT_CONNECTED = `Pose Studio is not connected. Open it in a browser, go to the AI tab and turn on "MCP bridge" (port ${PORT}).`;

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && write({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && write({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'pose-studio', version: '1.0.0' },
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
process.stdin.on('end', () => process.exit(0));
