'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { libraryMotions, onLibraryMotions } from '@/lib/librarymotions';
import { PREVIEW_SIZE, requestThumb, runPreview, type PreviewJob } from '@/lib/previews';
import { spanAt } from '@/lib/shots';
import type { Scene } from '@/lib/types';
import { styleDef } from '@/lib/styles';
import { useProjectSettings, useStore, useStudio } from '../store-context';
import { IconButton } from '../ui';
import { endDrag, startDrag } from '../dragdrop';
import { setHoverGhost } from '../hints';
import { LIBRARY_CATEGORIES, type LibraryCategory, type LibraryItem, type LibraryUi, type Thumb } from './libraryItems';
import type { SectionProps } from './sections';

/**
 * Ready-made things to build a scene with, one category at a time (each its own section on the
 * rail), in groups. They apply to what is selected: a pose or a motion to the selected figure, a
 * set or a lighting scheme to the scene, a camera move to the selected (or current) shot. Its
 * search finds the category's items. Resting the pointer on one shows what it does: the pose, the
 * motion playing, the move filming this scene.
 */
const NO_MOTIONS: never[] = [];
const noMotions = () => NO_MOTIONS;

export default function LibrarySection({ notify, notifyUndo, onPick, section }: SectionProps) {
  const store = useStore();
  // What the items depend on: the library (its scenes too), the selection, the shot at the playhead.
  useStudio((s) => s.library);
  useStudio((s) => s.sceneIndex);
  useStudio((s) => s.activeFigure);
  useStudio((s) => s.selection);
  useStudio((s) => { const a = s.library.scenes[s.sceneIndex]?.animation; return a ? spanAt(a, s.time)?.shot.id ?? '' : ''; });
  // (The Library's motion files, once their list has come.)
  useSyncExternalStore(onLibraryMotions, libraryMotions, noMotions);
  const [query, setQuery] = useState('');
  const preview = usePreview();
  const ui: LibraryUi = { notify, notifyUndo, onPick };
  const open = LIBRARY_CATEGORIES.find((c) => c.id === section) ?? LIBRARY_CATEGORIES[0];

  const q = query.trim().toLowerCase();
  const items = open.items(store, ui);
  const found = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items;
  return (
    <div className="side-section library" aria-label={open.label}>
      <div className="side-head"><h2>{open.label}</h2></div>
      <div className="library-row">
        <label className="search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            placeholder={`Search ${open.label.toLowerCase()}`}
            value={query}
            aria-label={`Search ${open.label.toLowerCase()}`}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="side-scroll">
        {!q && open.Bar && <open.Bar {...ui} />}
        {found.length || !q ? <Items category={open} items={found} preview={preview.bind} /> : <p className="empty-note">Nothing matches “{query.trim()}”</p>}
      </div>
      {preview.card}
    </div>
  );
}

/** A category's items, in its parts (a region each) and groups (each folds, and remembers it). */
function Items({ category, items, preview }: { category: LibraryCategory; items: LibraryItem[]; preview: Bind }) {
  const parts = [...new Set(items.map((it) => it.part))];
  return parts.map((part) => {
    const mine = items.filter((it) => it.part === part);
    return (
      <section key={part} aria-label={part}>
        {[...new Set(mine.map((it) => it.group))].map((g) => {
          const list = mine.filter((it) => it.group === g);
          return (
            <Group key={g} id={`${category.id}:${g}`} title={g} count={list.length}>
              <List category={category} title={g} items={list} preview={preview} />
            </Group>
          );
        })}
      </section>
    );
  });
}

function Group({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  const key = `pose-studio-libgroup-${id}`;
  const [open, setOpen] = useState(() => typeof localStorage === 'undefined' || localStorage.getItem(key) !== '0');
  const toggle = () => {
    try { localStorage.setItem(key, open ? '0' : '1'); } catch { /* ignore */ }
    setOpen(!open);
  };
  return (
    <div className="lib-group">
      <h3 className="lib-group-head">
        <button type="button" aria-expanded={open} onClick={toggle}>
          {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
          {title}<span className="count">{count}</span>
        </button>
      </h3>
      {open && children}
    </div>
  );
}

/** Items as thumbnails (a grid) or rows. */
function List({ category, title, items, preview }: { category: LibraryCategory; title: string; items: LibraryItem[]; preview: Bind }) {
  return (
    <ul className={category.grid ? 'lib-grid' : 'side-list library-list'} aria-label={title}>
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            className={category.grid ? `lib-tile${it.on ? ' on' : ''}` : undefined}
            aria-label={category.grid ? it.name : undefined}
            aria-disabled={it.disabled || undefined}
            aria-pressed={it.on === undefined || it.disabled ? undefined : it.on}
            data-tip={it.preview ? undefined : it.note}
            onClick={() => { if (!it.disabled) it.run(); }}
            // Or dragged onto what it applies to: a figure, the floor, a shot.
            draggable={!!it.drop}
            onDragStart={it.drop && ((e) => { startDrag(e, it.drop!); })}
            onDragEnd={it.drop && endDrag}
            {...(it.preview ? preview(it.name, it.note, it.preview, it.ghost, it.about) : {})}
          >
            {category.grid ? (
              <>
                <Thumbnail thumb={it.thumb} fallback={<it.icon size={22} strokeWidth={1.5} aria-hidden />} />
                <span className="lib-tile-name">{it.name}</span>
                {it.on && <Check size={13} className="lib-tile-on" aria-hidden />}
              </>
            ) : (
              <>
                {it.thumb ? <Thumbnail thumb={it.thumb} small fallback={<it.icon size={15} aria-hidden />} /> : <it.icon size={15} aria-hidden />}
                <span className="side-list-name">{it.name}</span>
                {it.meta && <em>{it.meta}</em>}
              </>
            )}
          </button>
          {it.actions?.map((a) => <IconButton key={a.label} icon={a.icon} label={a.label} className="row-action" size={14} onClick={a.run} />)}
        </li>
      ))}
    </ul>
  );
}

export function Thumbnail({ thumb, small, fallback }: { thumb?: Thumb; small?: boolean; fallback: ReactNode }) {
  const drawn = thumb && 'key' in thumb ? thumb : null;
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null);
  // Drawn once it scrolls into sight (a template's takes building it first).
  const el = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  const key = drawn?.key;
  useEffect(() => {
    if (!key || seen || !el.current) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setSeen(true); });
    io.observe(el.current);
    return () => io.disconnect();
  }, [key, seen]);
  useEffect(() => (drawn && seen ? requestThumb(drawn.key, drawn.make, (u) => setUrl({ key: drawn.key, url: u })) : undefined), [drawn?.key, seen]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = thumb && 'url' in thumb ? thumb.url : url && url.key === drawn?.key ? url.url : null;
  return (
    <span ref={el} className={small ? 'lib-thumb small' : 'lib-thumb'} aria-hidden>
      {/* Generated data: URLs and the app's own images, so next/image does not apply. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" draggable={false} /> : !drawn && fallback}
    </span>
  );
}

/* ---------------- preview on hover ---------------- */

interface Shown { title: string; note?: string; about?: string; frames: string[]; top: number; left: number }
type Bind = (title: string, note: string | undefined, job: () => PreviewJob, ghost?: () => Scene | null, about?: string) => {
  onPointerEnter(e: PointerEvent<HTMLElement>): void;
  onPointerLeave(): void;
  onFocus(e: FocusEvent<HTMLElement>): void;
  onBlur(): void;
  onPointerDown(): void;
  onKeyDown(e: KeyboardEvent<HTMLElement>): void;
};

/**
 * A card beside the panel showing what the item under the mouse (or keyboard focus) does. Not for
 * touch: a tap uses the item.
 */
function usePreview() {
  const style = useProjectSettings().style;
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef(0);
  const stop = useRef<() => void>(() => {});
  const hide = () => {
    window.clearTimeout(timer.current);
    stop.current();
    setShown(null);
    setHoverGhost(null);
  };
  const show = (el: HTMLElement, title: string, note: string | undefined, job: () => PreviewJob, ghost?: () => Scene | null, about?: string) => {
    window.clearTimeout(timer.current);
    stop.current();
    // A short wait, so passing over the list does not start every item on the way.
    timer.current = window.setTimeout(() => {
      const row = el.getBoundingClientRect();
      const panel = el.closest('.side-panel')?.getBoundingClientRect() ?? row;
      const height = PREVIEW_SIZE.height + (about ? 130 : 64);
      setShown({ title, note, about, frames: [], left: panel.right + 8, top: Math.max(56, Math.min(window.innerHeight - height - 8, row.top - 40)) });
      // Frames arrive one by one: the card shows the first at once and plays as more come.
      stop.current = runPreview(job(), (frames) => setShown((s) => (s && s.title === title ? { ...s, frames } : s)));
      // And on the canvas: the selected figure as it would be.
      setHoverGhost(ghost?.() ?? null);
    }, 160);
  };
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    stop.current();
    setHoverGhost(null);
  }, []);
  const bind: Bind = (title, note, job, ghost, about) => ({
    onPointerEnter: (e) => { if (e.pointerType === 'mouse') show(e.currentTarget, title, note, job, ghost, about); },
    onPointerLeave: hide,
    onFocus: (e) => { if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget, title, note, job, ghost, about); },
    onBlur: hide,
    // Used: the preview has done its job (and stops rendering).
    onPointerDown: hide,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') hide(); },
  });
  const card = shown && createPortal(<PreviewCard shown={shown} background={styleDef(style).background} />, document.body);
  return { bind, hide, card };
}

function PreviewCard({ shown, background }: { shown: Shown; background: string }) {
  const [tick, setTick] = useState(0);
  const playing = shown.frames.length > 1;
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setTick((f) => f + 1), 1000 / 8);
    return () => window.clearInterval(id);
  }, [playing]);
  const src = shown.frames.length ? shown.frames[tick % shown.frames.length] : null;
  return (
    <div className="lib-preview" role="tooltip" style={{ left: shown.left, top: shown.top }}>
      {src ? (
        // Generated data: URLs, so next/image does not apply.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={PREVIEW_SIZE.width} height={PREVIEW_SIZE.height} style={{ background }} />
      ) : (
        <div className="lib-preview-wait" style={{ width: PREVIEW_SIZE.width, height: PREVIEW_SIZE.height, background }} />
      )}
      <strong>{shown.title}</strong>
      {shown.about && <p className="lib-preview-about">{shown.about}</p>}
      {shown.note && <span>{shown.note}</span>}
    </div>
  );
}
