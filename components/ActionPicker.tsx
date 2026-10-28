'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Search, type LucideIcon } from 'lucide-react';
import { propNow } from '@/lib/actions';
import { App, applies, command, enabled, iconOf, titleOf, type Ctx } from './commands';
import { LIBRARY_CATEGORIES, type Thumb } from './side/libraryItems';
import { Thumbnail } from './side/LibrarySection';
import { useStore } from './store-context';

/** The everyday beats offered first (Library motions, by id). */
const COMMON_BEATS = ['talk', 'wave', 'nod', 'shake-head', 'point', 'sit-down', 'stand-up', 'pick-up'];

/** Where the picker opens: for a figure, at a point of the page (it opens upwards from there). */
export interface PickerAt { figure: string; x: number; y: number }

type Row = { label: string; icon?: LucideIcon; thumb?: Thumb; meta?: string; disabled?: boolean; run(): void };
type Part = { title: string; grid?: boolean; rows: Row[] };

/** Commands as rows (those that apply here), a command with choices as its choices. */
function commandRows(ids: string[], c: Ctx): Row[] {
  return ids.map(command).filter((cmd) => applies(cmd, c)).flatMap((cmd): Row[] => (cmd.items
    ? cmd.items(c).map((ch) => ({ label: `${titleOf(cmd, c).replace(/…$/, '')} ${ch.title}`, icon: ch.icon ?? cmd.icon, disabled: ch.disabled, run: ch.run }))
    : [{ label: titleOf(cmd, c), icon: iconOf(cmd, c), disabled: !enabled(cmd, c), run: () => cmd.run!(c) }]));
}

/**
 * What a figure can do next, from its row on the timeline at the playhead: walk, run, jump or step
 * somewhere (then a spot is picked on the floor), a pose or a motion from the Library, eyes on or
 * holding on to someone, and what it can do with a prop in its hand. One search box finds any of it.
 */
export default function ActionPicker({ at, onClose }: { at: PickerAt; onClose(): void }) {
  const store = useStore();
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [onClose]);

  const c: Ctx = { store, figure: at.figure };
  const ui = { notify: (t: string) => App().notify(t), notifyUndo: (t: string) => App().notifyUndo(t) };
  const items = (id: 'poses' | 'motions') => LIBRARY_CATEGORIES.find((x) => x.id === id)!.items(store, ui).filter((it) => it.drop?.figure);
  const row = (it: ReturnType<typeof items>[number]): Row => ({ label: it.name, icon: it.icon, thumb: it.thumb, meta: it.meta, run: () => it.drop!.figure!(at.figure) });
  // The everyday beats first: what people do in a scene between the big actions (#14); the other motions after.
  const motions = items('motions');
  const common = COMMON_BEATS.map((id) => motions.find((it) => it.key === `motion:${id}`)).filter((it) => !!it).map(row);
  const others = motions.filter((it) => !COMMON_BEATS.some((id) => it.key === `motion:${id}`)).map(row);
  // What it holds at the playhead.
  const held = store.scene.props.filter((p) => propNow(store, p.id)?.hold?.figure === at.figure);
  const parts: Part[] = [
    { title: 'Go somewhere', rows: commandRows(['figure.walk', 'figure.run', 'figure.jump', 'figure.step'], c) },
    { title: 'Everyday', rows: common },
    ...held.map((p) => ({
      title: p.name,
      rows: commandRows(['prop.throwTo', 'prop.toss', 'prop.carry', 'prop.dribble', 'prop.shoot', 'prop.give', 'prop.letGo', 'prop.drop'], { store, prop: p.id }),
    })),
    { title: 'With others', rows: commandRows(['figure.eyes', 'figure.holdOn'], c) },
    { title: 'Poses', grid: true, rows: items('poses').map(row) },
    { title: 'Motions', rows: others },
  ];
  const q = query.trim().toLowerCase();
  const shown = parts
    .map((p) => ({ ...p, rows: !q || p.title.toLowerCase().includes(q) ? p.rows : p.rows.filter((r) => r.label.toLowerCase().includes(q)) }))
    .filter((p) => p.rows.length);
  const name = store.scene.figures.find((f) => f.id === at.figure)?.name ?? '';

  const choose = (r: Row) => {
    if (r.disabled) return;
    onClose();
    store.setActiveFigure(at.figure);
    r.run();
  };
  /** Up and down go through the choices (from the search box too); Esc closes. */
  const keys = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      const first = shown.flatMap((p) => p.rows).find((r) => !r.disabled);
      if (first) choose(first);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLElement>('input, [role=menuitem]:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div
      ref={root}
      className="action-picker"
      role="dialog"
      aria-label={`What ${name} does next`}
      style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 328)), bottom: Math.max(8, window.innerHeight - at.y + 6) }}
      onKeyDown={keys}
    >
      <label className="action-picker-search">
        <Search size={14} aria-hidden />
        <input autoFocus type="text" placeholder={`What ${name} does next…`} aria-label="Find an action" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="action-picker-list" role="menu" aria-label="Actions">
        {shown.map((p) => (
          <div key={p.title} className="action-picker-part">
            <div className="menu-group" role="presentation">{p.title}</div>
            <div className={p.grid ? 'action-picker-grid' : 'action-picker-rows'}>
              {p.rows.map((r, i) => (
                <button
                  key={`${r.label}:${i}`}
                  type="button"
                  role="menuitem"
                  className={p.grid ? 'action-picker-thumb' : 'menu-item'}
                  aria-label={p.grid ? r.label : undefined}
                  data-tip={p.grid ? r.label : undefined}
                  disabled={r.disabled}
                  onClick={() => choose(r)}
                >
                  {p.grid ? (
                    <Thumbnail thumb={r.thumb} fallback={r.icon ? <r.icon size={18} aria-hidden /> : null} />
                  ) : (
                    <>
                      <span className="menu-icon">{r.icon && <r.icon size={15} strokeWidth={1.75} aria-hidden />}</span>
                      <span className="menu-label">{r.label}</span>
                      {r.meta && <kbd>{r.meta}</kbd>}
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!shown.length && <p className="hint action-picker-none">Nothing called “{query}”</p>}
      </div>
    </div>
  );
}
