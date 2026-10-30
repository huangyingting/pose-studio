'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Ellipsis, FilePlus2, LayoutTemplate, Search } from 'lucide-react';
import { addScene, moveScene } from '@/lib/actions';
import { thumbnail } from '@/lib/thumbnails';
import { openContextMenu } from './ContextMenu';
import { App, menu } from './commands';
import { useStore, useStudio } from './store-context';
import { Menu } from './ui';

const COLUMNS = 3;

/**
 * The project's scenes, from the top bar: switch scene (search, thumbnails; drag or Alt+arrows
 * to reorder), start a new one; rename, duplicate, delete or storyboard one (its menu, or right-click).
 */
export default function ScenePicker() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const scenes = useStudio((s) => s.library.scenes);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      // Menus render inside (or are a scene's right-click menu); anything else outside closes the picker.
      if (!root.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.context-menu')) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="scene-picker" ref={root}>
      <button
        type="button"
        className={`ibtn scene-switch${open ? ' on' : ''}`}
        aria-label="Scenes"
        aria-expanded={open}
        data-tip={open ? undefined : `Scenes (${scenes.length})  [ ]`}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={15} aria-hidden />
      </button>
      {open && (
        <div className="scene-popover" role="dialog" aria-label="Scenes">
          <SceneGrid onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function SceneGrid({ onPick }: { onPick(): void }) {
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

  return (
    <>
      <div className="side-head">
        <h2>Scenes <span className="count">{scenes.length}</span></h2>
        <div className="side-actions">
          <Menu
            label="New scene"
            className="btn subtle"
            align="end"
            tip="New scene"
            items={[
              { label: 'Blank scene', icon: FilePlus2, onSelect: () => { addScene(store); onPick(); } },
              { label: 'From a template…', icon: LayoutTemplate, onSelect: () => { App().dialog('start'); onPick(); } },
            ]}
          >
            <FilePlus2 size={14} strokeWidth={1.75} aria-hidden /> New
          </Menu>
          <Menu
            label="Scene actions"
            className="ibtn"
            align="end"
            tip="More"
            items={() => menu('scene', { store, scene: index })}
          >
            <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
          </Menu>
        </div>
      </div>
      <label className="search">
        <Search size={14} aria-hidden />
        <input type="search" placeholder="Search scenes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search scenes" autoFocus />
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
              onClick={() => { store.setSceneIndex(i); onPick(); }}
              onKeyDown={(e) => onThumbKey(e, pos, i)}
              onContextMenu={(e) => openContextMenu(e, menu('scene', { store, scene: i }), s.name)}
              aria-current={i === index}
              data-tip={`${s.name} — Alt+arrow keys to reorder`}
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
        {!visible.length && <li className="empty">No scenes match “{query}”.</li>}
      </ol>
    </>
  );
}
