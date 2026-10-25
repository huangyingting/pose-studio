'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Copy, Ellipsis, Eye, EyeOff, Plus, RotateCcw, Search, Trash2, PersonStanding } from 'lucide-react';
import {
  addFigure, addProp, addScene, deleteFigure, deleteProp, deleteScene, duplicateCurrentScene, duplicateFigure, duplicateProp, moveScene,
  resetLibrary, setFigureHidden,
} from '@/lib/actions';
import { PROP_LABELS } from '@/lib/props';
import { thumbnail } from '@/lib/thumbnails';
import { PROP_KINDS } from '@/lib/types';
import { PROP_ICONS } from './icons';
import { useScene, useStore, useStudio } from './store-context';
import { IconButton, Menu } from './ui';

const COLUMNS = 2;

/** Left sidebar: the pose library on top, the layers (figures and props) of the open pose below. */
export default function LibraryPanel({ onPick, notifyUndo }: { onPick?(): void; notifyUndo(text: string): void }) {
  return (
    <aside className="library" aria-label="Pose library">
      <Poses onPick={onPick} notifyUndo={notifyUndo} />
      <Layers notifyUndo={notifyUndo} />
    </aside>
  );
}

function Poses({ onPick, notifyUndo }: { onPick?(): void; notifyUndo(text: string): void }) {
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
    <section className="lib-poses">
      <div className="side-head">
        <h2>Poses <span className="count">{scenes.length}</span></h2>
        <div className="side-actions">
          <IconButton icon={Plus} label="New pose" onClick={() => addScene(store)} />
          <Menu
            label="Pose actions"
            className="ibtn"
            align="end"
            tip="More"
            items={[
              { label: 'Duplicate', icon: Copy, shortcut: 'Ctrl D', onSelect: () => duplicateCurrentScene(store) },
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
    </section>
  );
}

function Layers({ notifyUndo }: { notifyUndo(text: string): void }) {
  const store = useStore();
  const scene = useScene();
  const active = useStudio((s) => s.activeFigure);
  const selection = useStudio((s) => s.selection);
  const counts: Record<string, number> = {};
  return (
    <section className="lib-layers">
      <div className="side-head">
        <h2>Layers</h2>
        <Menu
          label="Add layer"
          className="ibtn"
          align="end"
          side="top"
          tip="Add figure or prop"
          items={[
            { label: 'Figure', icon: PersonStanding, onSelect: () => addFigure(store) },
            '-',
            ...PROP_KINDS.map((k) => ({ label: PROP_LABELS[k], icon: PROP_ICONS[k], onSelect: () => addProp(store, k) })),
          ]}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden />
        </Menu>
      </div>
      <ul className="layers" aria-label="Layers">
        {scene.figures.map((f) => {
          const on = f.id === active && selection?.kind !== 'prop';
          return (
            <li key={f.id} className={`${on ? 'on' : ''}${f.hidden ? ' hidden-layer' : ''}`}>
              <button type="button" className="layer-main" onClick={() => store.setActiveFigure(f.id)}>
                <PersonStanding size={15} strokeWidth={1.75} aria-hidden />
                <span>{f.name}</span>
              </button>
              <span className="layer-actions">
                <IconButton icon={Copy} label={`Duplicate ${f.name}`} onClick={() => duplicateFigure(store, f.id)} size={14} />
                <IconButton
                  icon={Trash2}
                  label={`Delete ${f.name}`}
                  disabled={scene.figures.length <= 1}
                  onClick={() => { if (deleteFigure(store, f.id)) notifyUndo(`Deleted ${f.name}`); }}
                  size={14}
                />
                <IconButton
                  icon={f.hidden ? EyeOff : Eye}
                  label={`${f.hidden ? 'Show' : 'Hide'} ${f.name}`}
                  pressed={!f.hidden}
                  className={f.hidden ? 'keep' : ''}
                  onClick={() => setFigureHidden(store, f.id, !f.hidden)}
                  size={14}
                />
              </span>
            </li>
          );
        })}
        {scene.props.map((p) => {
          counts[p.kind] = (counts[p.kind] ?? 0) + 1;
          const name = `${PROP_LABELS[p.kind]} ${counts[p.kind]}`;
          const Icon = PROP_ICONS[p.kind];
          const on = selection?.kind === 'prop' && selection.prop === p.id;
          return (
            <li key={p.id} className={on ? 'on' : ''}>
              <button type="button" className="layer-main" onClick={() => store.select({ kind: 'prop', prop: p.id })}>
                <Icon size={15} strokeWidth={1.75} aria-hidden />
                <span>{name}</span>
              </button>
              <span className="layer-actions">
                <IconButton icon={Copy} label={`Duplicate ${name}`} onClick={() => duplicateProp(store, p.id)} size={14} />
                <IconButton icon={Trash2} label={`Delete ${name}`} onClick={() => { deleteProp(store, p.id); notifyUndo('Prop deleted'); }} size={14} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
