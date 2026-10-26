import type { Store } from '../store';
import { TOOLS, runTool } from './tools';

/*
 * Browser side of the local MCP bridge (mcp/server.mjs): announce the tools, then long-poll the
 * server for calls, run them on the open pose and post the results back.
 */

export type BridgeStatus = 'off' | 'connecting' | 'connected' | 'offline';

export const BRIDGE_PORT = 8765;
const KEY = 'pose-studio:mcp-bridge';

let ctrl: AbortController | null = null;
let status: BridgeStatus = 'off';
const listeners = new Set<() => void>();

function setStatus(s: BridgeStatus) {
  status = s;
  listeners.forEach((l) => l());
}

export const bridge = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  status: () => status,
  /** Whether the user turned the bridge on (it reconnects on the next visit). */
  enabled: () => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  },
  /** Disconnect; `forget` also turns it off for the next visit. */
  stop(forget = true) {
    ctrl?.abort();
    ctrl = null;
    if (forget) {
      try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
    }
    setStatus('off');
  },
  start(store: Store, port = BRIDGE_PORT) {
    bridge.stop(false);
    try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked */ }
    const c = new AbortController();
    ctrl = c;
    const base = `http://127.0.0.1:${port}`;
    const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema }));
    setStatus('connecting');
    void (async () => {
      while (!c.signal.aborted) {
        try {
          const hello = await fetch(`${base}/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tools }), signal: c.signal });
          if (!hello.ok) throw new Error(String(hello.status));
          setStatus('connected');
          while (!c.signal.aborted) {
            const res = await fetch(`${base}/next`, { signal: c.signal });
            if (res.status === 204) continue;
            if (!res.ok) throw new Error(String(res.status));
            const call = (await res.json()) as { id: number; name: string; input: unknown };
            const r = runTool(store, call.name, call.input);
            await fetch(`${base}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: call.id, ...r }), signal: c.signal });
          }
        } catch {
          if (c.signal.aborted) return;
          // The server is not running (yet): try again shortly.
          setStatus('offline');
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();
  },
};
