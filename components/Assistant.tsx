'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowUp, Check, Plus, Settings2, Sparkles, Square, TriangleAlert, Wrench } from 'lucide-react';
import {
  PROVIDERS, configReady, loadConfig, newConversation, runTurn, saveConfig, type AgentConfig, type Conversation, type Provider,
} from '@/lib/agent/agent';
import { BRIDGE_PORT, bridge } from '@/lib/agent/bridge';
import { copilotModels } from '@/lib/agent/copilot';
import type { Store } from '@/lib/store';
import { useStore } from './store-context';
import { IconButton, Segmented, Select, Toggle } from './ui';

type Item =
  | { kind: 'user' | 'assistant' | 'error'; text: string }
  | { kind: 'tool'; name: string; result: string; ok: boolean };

/** The chat outlives the panel (switching tabs keeps a running turn going). */
const session = {
  items: [] as Item[],
  conversation: null as Conversation | null,
  running: null as AbortController | null,
  version: 0,
  listeners: new Set<() => void>(),
  emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  },
  reset() {
    this.running?.abort();
    this.items = [];
    this.conversation = null;
    this.emit();
  },
  async send(store: Store, config: AgentConfig, text: string) {
    const ctrl = new AbortController();
    this.running = ctrl;
    this.items = [...this.items, { kind: 'user', text }];
    this.emit();
    const conv = this.conversation?.provider === config.provider ? this.conversation : newConversation(config);
    try {
      this.conversation = await runTurn(config, conv, text, store, {
        onText: (t) => { this.items = [...this.items, { kind: 'assistant', text: t }]; this.emit(); },
        onTool: (name, _input, result, ok) => { this.items = [...this.items, { kind: 'tool', name, result, ok }]; this.emit(); },
      }, ctrl.signal);
    } catch (err) {
      this.items = [...this.items, { kind: 'error', text: (err as Error).message }];
    } finally {
      if (this.running === ctrl) this.running = null;
      this.emit();
    }
  },
  stop() {
    this.running?.abort();
  },
};

const subscribe = (l: () => void) => {
  session.listeners.add(l);
  return () => session.listeners.delete(l);
};
const getVersion = () => session.version;

const SUGGESTIONS = [
  'Make her wave hello with a smile in her posture',
  'Two people shaking hands, seen from a low angle',
  'Animate a short jump, add a camera move and check it',
  'Block a café scene: two people at a table and a few stand-ins',
];

/** Inspector tab: an AI assistant that poses, stages and animates through the studio's tools. */
export default function Assistant() {
  const store = useStore();
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const [config, setConfig] = useState<AgentConfig>(loadConfig);
  const [editing, setEditing] = useState(() => !configReady(loadConfig()));
  const [text, setText] = useState('');
  const busy = !!session.running;

  const send = (t = text) => {
    const msg = t.trim();
    if (!msg || busy) return;
    setText('');
    void session.send(store, config, msg);
  };

  if (editing) {
    return (
      <Connection
        config={config}
        onSave={(c) => {
          saveConfig(c);
          if (c.provider !== config.provider) session.reset();
          setConfig(c);
          setEditing(false);
        }}
        onCancel={configReady(config) ? () => setEditing(false) : undefined}
      />
    );
  }

  return (
    <div className="assistant">
      <div className="assistant-head">
        <Sparkles size={14} aria-hidden />
        <span>{PROVIDERS.find((p) => p.id === config.provider)!.name} · {config.model}</span>
        <span className="spacer" />
        <IconButton icon={Plus} label="New chat" onClick={() => session.reset()} size={14} disabled={!session.items.length} />
        <IconButton icon={Settings2} label="Assistant settings" onClick={() => setEditing(true)} size={14} />
      </div>
      <div className="assistant-log" aria-live="polite">
        {!session.items.length && (
          <div className="assistant-empty">
            <p className="hint-text">Describe a pose, a scene or a shot. The assistant uses the same tools as you, and every change can be undone.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="assistant-suggestion" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        {session.items.map((it, i) => {
          if (it.kind === 'tool') {
            return (
              <div key={i} className={`assistant-tool${it.ok ? '' : ' failed'}`} title={it.result}>
                {it.ok ? <Wrench size={12} aria-hidden /> : <TriangleAlert size={12} aria-hidden />}
                <code>{it.name}</code>
                <span>{it.result.startsWith('{') ? 'read the scene' : it.result.split('\n')[0]}</span>
              </div>
            );
          }
          return <p key={i} className={`assistant-msg ${it.kind}`}>{it.text}</p>;
        })}
        {busy && <p className="assistant-msg thinking">Working…</p>}
      </div>
      <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          placeholder="Ask for a pose, a scene or a shot…"
          aria-label="Message the assistant"
          rows={2}
        />
        {busy
          ? <IconButton icon={Square} label="Stop" onClick={() => session.stop()} size={14} />
          : <button type="submit" className="ibtn send" aria-label="Send" disabled={!text.trim()}><ArrowUp size={15} aria-hidden /></button>}
      </form>
    </div>
  );
}

function Connection({ config, onSave, onCancel }: { config: AgentConfig; onSave(c: AgentConfig): void; onCancel?(): void }) {
  const [c, setC] = useState(config);
  const p = PROVIDERS.find((x) => x.id === c.provider)!;
  const set = (patch: Partial<AgentConfig>) => setC((prev) => ({ ...prev, ...patch }));
  return (
    <form className="assistant-setup" onSubmit={(e) => { e.preventDefault(); if (configReady(c)) onSave(c); }}>
      <h3><Sparkles size={15} aria-hidden /> Assistant</h3>
      <Segmented<Provider>
        label="Provider"
        full
        value={c.provider}
        onChange={(provider) => set({ provider, model: provider === 'copilot' ? 'auto' : '' })}
        options={PROVIDERS.map((x) => ({ value: x.id, label: x.label }))}
      />
      {c.provider === 'copilot' ? (
        <>
          <p className="hint-text">Uses your GitHub Copilot plan through the local companion on this computer. No key is kept here.</p>
          <CopilotModel value={c.model} onChange={(model) => set({ model })} />
        </>
      ) : (
        <>
          <p className="hint-text">Your key stays in this browser and is sent only to {p.name}.</p>
          {c.provider === 'azure' && (
            <label className="field">
              <span>Endpoint</span>
              <input type="url" value={c.endpoint} onChange={(e) => set({ endpoint: e.target.value.trim() })} placeholder="https://NAME.openai.azure.com" spellCheck={false} />
            </label>
          )}
          <label className="field">
            <span>API key</span>
            <input type="password" value={c.apiKey} onChange={(e) => set({ apiKey: e.target.value.trim() })} placeholder={p.keyHint} autoComplete="off" spellCheck={false} />
          </label>
          <label className="field">
            <span>{c.provider === 'azure' ? 'Deployment' : 'Model'}</span>
            <input type="text" value={c.model} onChange={(e) => set({ model: e.target.value.trim() })} placeholder={c.provider === 'azure' ? 'Deployment name' : 'Model id'} spellCheck={false} />
          </label>
        </>
      )}
      <div className="row">
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
        <span className="spacer" />
        <button type="submit" className="btn primary" disabled={!configReady(c)}><Check size={15} aria-hidden /> Save</button>
      </div>
      <LocalCompanion />
    </form>
  );
}

/** The models of the user's Copilot plan, asked from the local companion. */
function CopilotModel({ value, onChange }: { value: string; onChange(m: string): void }) {
  const [models, setModels] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    copilotModels().then(
      (m) => { if (live) { setModels(m); setError(null); } },
      (err: Error) => { if (live) setError(err.message); },
    );
    return () => { live = false; };
  }, [attempt]);
  const options = models ?? [value];
  return (
    <div className="field">
      <span>Model</span>
      <Select label="Model" value={options.includes(value) ? value : options[0]} onChange={onChange} options={options.map((m) => ({ value: m, label: m }))} />
      {error && (
        <p className="companion-error">
          {error} <button type="button" className="link" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </p>
      )}
    </div>
  );
}

const COMPANION_TEXT = { off: '', connecting: 'Connecting…', connected: 'Connected', offline: `Waiting for the companion on port ${BRIDGE_PORT}` };

/** The local companion: GitHub Copilot chats, and MCP clients (Copilot CLI, VS Code) driving this tab. */
function LocalCompanion() {
  const store = useStore();
  const status = useSyncExternalStore(bridge.subscribe, bridge.status, bridge.status);
  return (
    <div className="assistant-mcp">
      <Toggle
        label="Local companion"
        checked={status !== 'off'}
        hint="Connect to the companion running on this computer"
        onChange={(on) => (on ? bridge.start(store) : bridge.stop())}
      />
      {status !== 'off' && <p className={`bridge-status ${status}`}><span aria-hidden />{COMPANION_TEXT[status]}</p>}
      <p className="hint-text">
        Runs next to this tab for GitHub Copilot (<code>npm install</code> and <code>npm start</code> in the repository&apos;s <code>companion</code> folder)
        and for MCP clients such as Copilot CLI or VS Code (add <code>node companion/server.mjs --mcp</code> as an MCP server). Keep this tab open.
      </p>
    </div>
  );
}
