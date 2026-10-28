'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Ellipsis, Search } from 'lucide-react';
import { PREVIEW_SIZE, requestThumb, runPreview, type PreviewJob } from '@/lib/previews';
import { spanAt } from '@/lib/shots';
import type { LibraryTab } from '@/lib/store';
import { styleDef } from '@/lib/styles';
import { useFilm, useStore, useStudio } from '../store-context';
import { IconButton, Menu } from '../ui';
import { endDrag, startDrag } from '../dragdrop';
import { LIBRARY_CATEGORIES, type LibraryCategory, type LibraryItem, type LibraryUi, type Thumb } from './libraryItems';
import type { SectionProps } from './sections';

/**
 * Ready-made things to build a scene with, by category (icon tabs) and in groups. They apply to
 * what is selected: a pose or a motion to the selected figure, a template as a new scene (or into
 * this one), a camera move to the selected (or current) shot. One search box finds items in every
 * category. Resting the pointer on one shows what it does: the pose, the motion playing, the move
 * filming this scene.
 */
export default function LibrarySection({ notify, notifyUndo, onPick }: SectionProps) {
  const store = useStore();
  const tab = useStudio((s) => s.settings.libraryTab);
  // What the items depend on: the library (its scenes too), the selection, the shot at the playhead.
  useStudio((s) => s.library);
  useStudio((s) => s.sceneIndex);
  useStudio((s) => s.activeFigure);
  useStudio((s) => s.selection);
  useStudio((s) => { const a = s.library.scenes[s.sceneIndex]?.animation; return a ? spanAt(a, s.time)?.shot.id ?? '' : ''; });
  const [query, setQuery] = useState('');
  // A category's header was clicked in the results: only its matches.
  const [scoped, setScoped] = useState(false);
  const preview = usePreview();
  const ui: LibraryUi = { notify, notifyUndo, onPick };
  const open = LIBRARY_CATEGORIES.find((c) => c.id === tab) ?? LIBRARY_CATEGORIES[0];
  const setTab = (libraryTab: LibraryTab) => { preview.hide(); store.setSettings({ libraryTab }); };

  // Each tab (and the results) keeps its scroll position.
  const scroller = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const view = query.trim() ? `search:${scoped ? tab : ''}` : tab;
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = positions.current.get(view) ?? 0;
  }, [view]);

  const q = query.trim().toLowerCase();
  let body: ReactNode;
  if (!q) {
    body = (
      <>
        {open.Bar && <open.Bar {...ui} />}
        <Items category={open} items={open.items(store, ui)} preview={preview.bind} />
      </>
    );
  } else {
    // Matches from every category, the open one's first, under one header each.
    const cats = scoped ? [open] : [open, ...LIBRARY_CATEGORIES.filter((c) => c !== open)];
    const found = cats.map((c) => ({ c, items: c.items(store, ui).filter((it) => it.name.toLowerCase().includes(q)) })).filter((x) => x.items.length);
    body = found.length ? found.map(({ c, items }) => (
      <section key={c.id} className="lib-results" aria-label={`${c.label} found`}>
        <button type="button" className="lib-result-head" onClick={() => { setTab(c.id); setScoped(true); }} data-tip={scoped ? undefined : `Only ${c.label.toLowerCase()}`}>
          <c.icon size={13} aria-hidden /> {c.label} <span className="count">{items.length}</span>
        </button>
        <List category={c} title={c.label} items={items} preview={preview.bind} />
      </section>
    )) : <p className="empty-note">Nothing matches “{query.trim()}”</p>;
  }

  return (
    <div className="side-section library">
      <Tabs tab={open.id} onPick={(id) => { setTab(id); setScoped(!!q); }} />
      <div className="library-row">
        <label className="search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            placeholder="Search the library"
            value={query}
            aria-label="Search the library"
            onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) setScoped(false); }}
          />
        </label>
      </div>
      <div className="side-scroll" ref={scroller} onScroll={(e) => positions.current.set(view, e.currentTarget.scrollTop)}>
        {body}
      </div>
      {preview.card}
    </div>
  );
}

/** The categories as icon tabs: the open one with its name, the others with it in a tooltip; past five, the last place is a ⋯. */
function Tabs({ tab, onPick }: { tab: LibraryTab; onPick(id: LibraryTab): void }) {
  const MAX = 5;
  const shown = LIBRARY_CATEGORIES.length > MAX ? LIBRARY_CATEGORIES.slice(0, MAX - 1) : LIBRARY_CATEGORIES;
  const more = LIBRARY_CATEGORIES.slice(shown.length);
  return (
    <div className="lib-tabs" role="tablist" aria-label="Library">
      {shown.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={c.id === tab}
          aria-label={c.label}
          className={`lib-tab${c.id === tab ? ' on' : ''}`}
          data-tip={c.id === tab ? undefined : c.label}
          onClick={() => onPick(c.id)}
        >
          <c.icon size={15} strokeWidth={1.75} aria-hidden />
          {c.id === tab && <span className="lib-tab-label">{c.label}</span>}
        </button>
      ))}
      {more.length > 0 && (
        <Menu label="More categories" className={`lib-tab${more.some((c) => c.id === tab) ? ' on' : ''}`} items={more.map((c) => ({ label: c.label, icon: c.icon, checked: c.id === tab, onSelect: () => onPick(c.id) }))}>
          <Ellipsis size={15} aria-hidden />
        </Menu>
      )}
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
          {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
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
            {...(it.preview ? preview(it.name, it.note, it.preview) : {})}
          >
            {category.grid ? (
              <>
                <Thumbnail thumb={it.thumb} fallback={<it.icon size={22} strokeWidth={1.5} aria-hidden />} />
                <span className="lib-tile-name">{it.name}</span>
                {it.on && <Check size={12} className="lib-tile-on" aria-hidden />}
              </>
            ) : (
              <>
                {it.thumb ? <Thumbnail thumb={it.thumb} small fallback={<it.icon size={14} aria-hidden />} /> : <it.icon size={14} aria-hidden />}
                <span className="side-list-name">{it.name}</span>
                {it.meta && <em>{it.meta}</em>}
              </>
            )}
          </button>
          {it.actions?.map((a) => <IconButton key={a.label} icon={a.icon} label={a.label} className="row-action" size={13} onClick={a.run} />)}
        </li>
      ))}
    </ul>
  );
}

function Thumbnail({ thumb, small, fallback }: { thumb?: Thumb; small?: boolean; fallback: ReactNode }) {
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

interface Shown { title: string; note?: string; frames: string[]; top: number; left: number }
type Bind = (title: string, note: string | undefined, job: () => PreviewJob) => {
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
  const style = useFilm().style;
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef(0);
  const stop = useRef<() => void>(() => {});
  const hide = () => {
    window.clearTimeout(timer.current);
    stop.current();
    setShown(null);
  };
  const show = (el: HTMLElement, title: string, note: string | undefined, job: () => PreviewJob) => {
    window.clearTimeout(timer.current);
    stop.current();
    // A short wait, so passing over the list does not start every item on the way.
    timer.current = window.setTimeout(() => {
      const row = el.getBoundingClientRect();
      const panel = el.closest('.side-panel')?.getBoundingClientRect() ?? row;
      const height = PREVIEW_SIZE.height + 64;
      setShown({ title, note, frames: [], left: panel.right + 8, top: Math.max(56, Math.min(window.innerHeight - height - 8, row.top - 40)) });
      // Frames arrive one by one: the card shows the first at once and plays as more come.
      stop.current = runPreview(job(), (frames) => setShown((s) => (s && s.title === title ? { ...s, frames } : s)));
    }, 160);
  };
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    stop.current();
  }, []);
  const bind: Bind = (title, note, job) => ({
    onPointerEnter: (e) => { if (e.pointerType === 'mouse') show(e.currentTarget, title, note, job); },
    onPointerLeave: hide,
    onFocus: (e) => { if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget, title, note, job); },
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
      {shown.note && <span>{shown.note}</span>}
    </div>
  );
}
