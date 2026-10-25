'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { addScene, deleteScene, duplicateCurrentScene, moveScene, resetLibrary } from '@/lib/actions';
import { thumbnail } from '@/lib/thumbnails';
import { useStore, useStudio } from './store-context';

const COLUMNS = 2;

export default function LibraryPanel({ onPick, notifyUndo }: { onPick?(): void; notifyUndo(text: string): void }) {
  const store = useStore();
  const scenes = useStudio((s) => s.library.scenes);
  const index = useStudio((s) => s.sceneIndex);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);

  // Thumbnails are cached by content, so this only renders scenes that changed.
  useEffect(() => {
    const t = setTimeout(() => {
      const next: Record<string, string> = {};
      for (const s of scenes) next[s.id] = thumbnail(s);
      setThumbs(next);
    }, 200);
    return () => clearTimeout(t);
  }, [scenes]);

  // Keep the open pose visible in the list (e.g. after [ / ] or undo).
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const q = query.trim().toLowerCase();
  const visible = scenes.map((s, i) => ({ s, i })).filter(({ s }) => !q || s.name.toLowerCase().includes(q));

  const focusThumb = (pos: number) => {
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button.thumb');
    buttons?.[Math.max(0, Math.min(buttons.length - 1, pos))]?.focus();
  };

  /** Arrow keys move between thumbnails; Alt+arrows move the pose itself. */
  const onThumbKey = (e: KeyboardEvent, pos: number, i: number) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS, Home: -Infinity, End: Infinity }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const targetPos = Math.max(0, Math.min(visible.length - 1, pos + step));
    if (e.altKey && Number.isFinite(step)) {
      if (targetPos === pos) return;
      moveScene(store, i, visible[targetPos].i);
      // The moved pose re-renders at its new position.
      requestAnimationFrame(() => focusThumb(targetPos));
    } else {
      focusThumb(targetPos);
    }
  };

  return (
    <aside className="library" aria-label="Pose library">
      <header>
        <div className="row between">
          <h2>Poses <span className="count">{scenes.length}</span></h2>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search poses…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search poses"
        />
        <div className="row">
          <button onClick={() => addScene(store)} title="New pose (empty figure)">+ New</button>
          <button onClick={() => duplicateCurrentScene(store)} title="Duplicate (Ctrl+D)">Duplicate</button>
          <button
            onClick={() => {
              const name = store.scene.name;
              if (deleteScene(store)) notifyUndo(`Deleted “${name}”`);
            }}
            disabled={scenes.length <= 1}
            title="Delete pose"
          >
            Delete
          </button>
        </div>
      </header>
      <ol className="thumbs" ref={list}>
        {visible.map(({ s, i }, pos) => (
          <li
            key={s.id}
            className={[i === index ? 'active' : '', dragFrom === i ? 'dragging' : ''].join(' ')}
            draggable
            onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (dragFrom !== null) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) moveScene(store, dragFrom, i); setDragFrom(null); }}
            onDragEnd={() => setDragFrom(null)}
          >
            <button
              className="thumb"
              onClick={() => { store.setSceneIndex(i); onPick?.(); }}
              onKeyDown={(e) => onThumbKey(e, pos, i)}
              aria-current={i === index}
              title={`${s.name} — Alt+arrow keys to reorder`}
            >
              {thumbs[s.id] ? (
                // Thumbnails are generated data: URLs, so next/image optimisation does not apply.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs[s.id]} alt="" draggable={false} />
              ) : <div className="ph" />}
              <span>{i + 1}. {s.name}</span>
              {s.figures.length > 1 && <i className="badge" aria-label={`${s.figures.length} figures`}>{s.figures.length}</i>}
            </button>
          </li>
        ))}
        {!visible.length && <li className="empty">No poses match “{query}”.</li>}
      </ol>
      <footer>
        <button
          onClick={() => {
            resetLibrary(store);
            notifyUndo('Restored the 20 built-in poses');
          }}
          title="Replace the library with the built-in poses (undoable)"
        >
          Restore built-in poses
        </button>
      </footer>
    </aside>
  );
}
