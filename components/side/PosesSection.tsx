'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Copy, Ellipsis, FilePlus2, Film, LayoutPanelTop, Plus, RotateCcw, Search, Trash2, Users, UsersRound } from 'lucide-react';
import { addScene, addToBoard, deleteScene, duplicateCurrentScene, moveScene, resetLibrary } from '@/lib/actions';
import { MOTIONS } from '@/lib/motions';
import { TEMPLATES } from '@/lib/templates';
import { thumbnail } from '@/lib/thumbnails';
import { useStore, useStudio } from '../store-context';
import { Menu } from '../ui';

import type { SectionProps } from './sections';

const COLUMNS = 2;

/** The pose library: search, thumbnails (drag or Alt+arrows to reorder), new pose and pose actions. */
export default function PosesSection({ onPick, notifyUndo }: SectionProps) {
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
      requestAnimationFrame(() => focusThumb(targetPos));
    } else {
      focusThumb(targetPos);
    }
  };

  const deleteCurrent = () => {
    const name = store.scene.name;
    if (deleteScene(store)) notifyUndo(`Deleted “${name}”`);
  };

  return (
    <div className="side-section">
      <div className="side-head">
        <h2>Poses <span className="count">{scenes.length}</span></h2>
        <div className="side-actions">
          <Menu
            label="New pose"
            className="ibtn"
            align="end"
            tip="New pose"
            items={[
              { label: 'Blank pose', icon: FilePlus2, onSelect: () => addScene(store) },
              { group: 'People together' },
              ...TEMPLATES.map((t) => ({
                label: t.name,
                icon: t.people > 2 ? Users : UsersRound,
                onSelect: () => addScene(store, t.build()),
              })),
              { group: 'Animations' },
              ...MOTIONS.map((m) => ({
                label: m.name,
                icon: m.people > 1 ? UsersRound : Film,
                onSelect: () => addScene(store, m.build()),
              })),
            ]}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden />
          </Menu>
          <Menu
            label="Pose actions"
            className="ibtn"
            align="end"
            tip="More"
            items={[
              { label: 'Duplicate', icon: Copy, shortcut: 'Ctrl D', onSelect: () => duplicateCurrentScene(store) },
              { label: 'Add to storyboard', icon: LayoutPanelTop, onSelect: () => { addToBoard(store); notifyUndo('Added to the storyboard (B)'); } },
              { label: 'Delete', icon: Trash2, onSelect: deleteCurrent, disabled: scenes.length <= 1, danger: true },
              '-',
              { label: 'Restore built-in poses', icon: RotateCcw, onSelect: () => { resetLibrary(store); notifyUndo('Restored the 20 built-in poses'); } },
            ]}
          >
            <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
          </Menu>
        </div>
      </div>
      <label className="search">
        <Search size={14} aria-hidden />
        <input type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search poses" />
      </label>
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
              <span>{s.name}</span>
              {s.figures.length > 1 && <i className="badge" aria-label={`${s.figures.length} figures`}>{s.figures.length}</i>}
            </button>
          </li>
        ))}
        {!visible.length && <li className="empty">No poses match “{query}”.</li>}
      </ol>
    </div>
  );
}
