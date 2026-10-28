'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';
import { ArrowUp, Plus, Sparkles, Square, TriangleAlert, Wrench } from 'lucide-react';
import { assistantTurn } from '@/lib/agent/turn';
import { withBase } from '@/lib/paths';
import type { Store } from '@/lib/store';
import { useStore } from '../store-context';
import { Hint, IconButton } from '../ui';
import { SignInButtons } from './Account';

type Item =
  | { kind: 'user' | 'assistant' | 'error'; text: string }
  | { kind: 'tool'; name: string; result: string; ok: boolean };

interface Status {
  enabled: boolean;
  used: number;
  limit: number;
}

/** The chat outlives the panel (switching tabs keeps a running turn going). */
const session = {
  items: [] as Item[],
  previous: null as string | null,
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
    this.previous = null;
    this.emit();
  },
  async send(store: Store, text: string) {
    const ctrl = new AbortController();
    this.running = ctrl;
    this.items = [...this.items, { kind: 'user', text }];
    this.emit();
    try {
      this.previous = await assistantTurn(this.previous, text, store, {
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

/** Inspector tab (server edition): an AI assistant that poses, stages and animates with the studio's tools. */
export default function Assistant() {
  const store = useStore();
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);
  const { status: auth } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [text, setText] = useState('');
  const busy = !!session.running;

  // The server says whether AI is set up and how much of today's allowance is used.
  useEffect(() => {
    if (auth !== 'authenticated' || busy) return;
    let live = true;
    fetch(withBase('/api/ai'), { cache: 'no-store' })
      .then((r) => r.json())
      .then((s: Status) => { if (live) setStatus(s); }, () => {});
    return () => { live = false; };
  }, [auth, busy, version]);

  const send = (t = text) => {
    const msg = t.trim();
    if (!msg || busy) return;
    setText('');
    void session.send(store, msg);
  };

  if (auth === 'loading') return <div className="assistant" />;
  if (auth !== 'authenticated') {
    return (
      <div className="assistant-setup">
        <h3><Sparkles size={15} aria-hidden /> Assistant</h3>
        <Hint>Sign in to pose and animate by describing it</Hint>
        <SignInButtons />
      </div>
    );
  }
  if (status && !status.enabled) {
    return (
      <div className="assistant-setup">
        <h3><Sparkles size={15} aria-hidden /> Assistant</h3>
        <Hint>Not set up on this server</Hint>
      </div>
    );
  }

  return (
    <div className="assistant">
      <div className="assistant-head">
        <Sparkles size={14} aria-hidden />
        <span>Assistant</span>
        <span className="spacer" />
        {status && <span className="assistant-usage" title="Assistant requests today">{status.used} / {status.limit}</span>}
        <IconButton icon={Plus} label="New chat" onClick={() => session.reset()} size={14} disabled={!session.items.length} />
      </div>
      <div className="assistant-log" aria-live="polite">
        {!session.items.length && (
          <div className="assistant-empty">
            <Hint>Describe a pose, a scene or a shot</Hint>
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
