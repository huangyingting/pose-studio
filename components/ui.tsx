'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, ChevronUp, CircleAlert, CircleCheck, CircleHelp, Ellipsis, X, type LucideIcon } from 'lucide-react';
import { PANEL_WIDTH } from '@/lib/store';
import { endDrag, startDrag, type DropTarget } from './dragdrop';

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/** Focusable elements that are actually visible and enabled. */
function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
  );
}

/* ---------------- Modal ---------------- */

export function Modal({ title, icon: Icon, onClose, children, footer, wide }: {
  title: string;
  icon?: LucideIcon;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Parents pass inline callbacks; keep the latest without re-running the focus effect.
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current!;
    const body = root.querySelector<HTMLElement>('.modal-body')!;
    // Without a focusable control in the body, focus the dialog itself rather than its Close button.
    const candidates = [...root.querySelectorAll<HTMLElement>('[data-autofocus]'), ...focusables(body), root];
    for (const el of candidates) {
      el.focus();
      if (document.activeElement === el) break;
    }
    const onKey = (e: KeyboardEvent) => {
      // Escape closes an open drop-down or menu first (a menu's items are drawn outside the dialog).
      if (e.key === 'Escape' && document.activeElement?.getAttribute('aria-expanded') !== 'true' && !document.activeElement?.closest('[role="menu"], [role="listbox"]')) {
        e.stopPropagation();
        close.current();
      }
      if (e.key === 'Tab') {
        const items = focusables(root);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <header>
          <h2 id={titleId}>{Icon && <Icon size={16} aria-hidden />}{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------------- Buttons ---------------- */

/** Square icon button with a tooltip (label + optional shortcut). */
export function IconButton({ icon: Icon, label, shortcut, onClick, active, disabled, tipSide = 'bottom', className = '', size = 16, pressed }: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick?(): void;
  active?: boolean;
  disabled?: boolean;
  tipSide?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  size?: number;
  /** Render as a toggle (aria-pressed). */
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ibtn${active ? ' on' : ''} ${className}`}
      aria-label={label}
      aria-pressed={pressed}
      data-tip={shortcut ? `${label}  ${shortcut}` : label}
      data-tip-side={tipSide}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={size} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

/* ---------------- Menu ---------------- */

export type MenuItem =
  | {
    label: string; icon?: LucideIcon; shortcut?: string; onSelect(): void; danger?: boolean; disabled?: boolean; checked?: boolean;
    /** It can also be dragged onto what it applies to (a prop onto the floor). */
    drag?: DropTarget;
  }
  | { group: string }
  | '-';

/** Whether something is in a pop-up list (a menu, a drop-down's list, a right-click menu: drawn on top of everything, outside what opened it). */
export const inPopup = (t: EventTarget | null) => !!(t as Element | null)?.closest?.('.menu-list, .select-list, .context-menu');

/**
 * Where a pop-up list goes on the screen, by the screen and not by what holds its button: next to
 * `anchor` on its `side` (the other side if that has more room and this not enough), lined up with
 * its start or end, kept inside the window; as tall as the room it has (it scrolls, ▲ ▼ showing
 * there is more).
 */
export function placePopup(el: HTMLElement, anchor: DOMRect, side: 'top' | 'bottom', align: 'start' | 'end', gap = 6) {
  const margin = 8;
  el.style.maxHeight = '';
  const natural = el.scrollHeight;
  const below = window.innerHeight - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const down = side === 'bottom' ? natural <= below || below >= above : !(natural <= above || above >= below);
  const room = Math.max(120, down ? below : above);
  el.style.maxHeight = `${Math.min(room, 560)}px`;
  const height = Math.min(natural, room, 560);
  el.style.top = `${down ? anchor.bottom + gap : anchor.top - gap - height}px`;
  const width = el.offsetWidth;
  const left = align === 'start' ? anchor.left : anchor.right - width;
  el.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - width - margin))}px`;
  el.dataset.side = down ? 'bottom' : 'top';
}

/** Button that opens a list of actions. Closes on selection, outside click, Escape, or the window resized or scrolled. */
export function Menu({ label, items, children, className = 'btn ghost', side = 'bottom', align = 'start', tip }: {
  label: string;
  /** Its items, or how to make them (when it opens: a menu built from the state is not built until wanted). */
  items: MenuItem[] | (() => MenuItem[]);
  /** Trigger content; defaults to the label. */
  children?: ReactNode;
  className?: string;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  tip?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = list.current;
    const button = root.current?.querySelector('button');
    if (open && el && button) placePopup(el, button.getBoundingClientRect(), side, align);
  }, [open, side, align]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => root.current?.contains(t as Node) || list.current?.contains(t as Node);
    const onDown = (e: PointerEvent) => { if (!inside(e.target)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); root.current?.querySelector<HTMLElement>('button')?.focus(); }
    };
    const onScroll = (e: Event) => { if (!list.current?.contains(e.target as Node)) setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    list.current?.querySelector<HTMLElement>('[role^=menuitem]:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role^=menuitem]:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-tip={open ? undefined : tip}
        data-tip-side={side === 'top' ? 'top' : 'bottom'}
        onClick={() => setOpen((o) => !o)}
      >
        {children ?? label}
      </button>
      {open && createPortal(
        <div className="menu-list" role="menu" aria-label={label} ref={list} onKeyDown={onListKey}>
          <MenuItems items={typeof items === 'function' ? items() : items} onDone={() => setOpen(false)} />
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * ▲ or ▼ at an end of a menu taller than it can show (it scrolls with the wheel), while there is
 * more that way; resting the pointer on it scrolls.
 */
function MenuScroll({ dir }: { dir: 'up' | 'down' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const raf = useRef(0);
  useLayoutEffect(() => {
    const list = ref.current?.parentElement;
    if (!list) return;
    const check = () => {
      const on = dir === 'up' ? list.scrollTop > 1 : list.scrollTop + list.clientHeight < list.scrollHeight - 1;
      if (!on) cancelAnimationFrame(raf.current);
      setMore(on);
    };
    check();
    list.addEventListener('scroll', check);
    window.addEventListener('resize', check);
    return () => {
      list.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      cancelAnimationFrame(raf.current);
    };
  }, [dir]);
  const roll = (on: boolean) => {
    cancelAnimationFrame(raf.current);
    const list = ref.current?.parentElement;
    if (!on || !list) return;
    const step = () => {
      list.scrollTop += dir === 'up' ? -6 : 6;
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  return (
    <div ref={ref} className={`menu-scroll ${dir}${more ? ' on' : ''}`} aria-hidden onPointerEnter={() => roll(true)} onPointerLeave={() => roll(false)}>
      {dir === 'up' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </div>
  );
}

/** The items of a menu (shared by drop-down and right-click menus). */
export function MenuItems({ items, onDone }: { items: MenuItem[]; onDone(): void }) {
  return (
    <>
      <MenuScroll dir="up" />
      {items.map((it, i) =>
        it === '-' ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : 'group' in it ? (
          <div key={i} className="menu-group" role="presentation">{it.group}</div>
        ) : (
          <button
            key={i}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={it.checked}
            className={`menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`}
            disabled={it.disabled}
            onClick={() => { onDone(); it.onSelect(); }}
            draggable={!!it.drag}
            onDragStart={it.drag && ((e) => startDrag(e, it.drag!))}
            onDragEnd={it.drag && (() => { endDrag(); onDone(); })}
          >
            <span className="menu-icon" aria-hidden>{it.icon && <it.icon size={15} strokeWidth={1.75} />}</span>
            <span className="menu-label">{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
            {it.checked && <Check className="menu-check" size={14} strokeWidth={2.25} aria-hidden />}
          </button>
        ),
      )}
      <MenuScroll dir="down" />
    </>
  );
}

/* ---------------- Panel structure ---------------- */

/**
 * The inspector's title: what is selected, its name editable (Enter or leaving keeps it, Escape
 * reverts), then actions for it.
 */
/** Where a header sits: what comes before its icon (a way back up) and after its actions (the panel's own buttons). */
export interface HeaderChrome {
  before?: ReactNode;
  after?: ReactNode;
}

/** An inspector's header: the thing's name (to rename it, if it has one of its own) and its menu (as its right-click menu). */
export function NameHeader({ lead, name, label, onRename, children, chrome, menu }: {
  lead: ReactNode;
  name: string;
  label: string;
  onRename?(name: string): void;
  children?: ReactNode;
  chrome?: HeaderChrome;
  menu?: MenuItem[] | (() => MenuItem[]);
}) {
  return (
    <div className="panel-title">
      {chrome?.before}
      {lead}
      {onRename ? <TitleInput key={name} name={name} label={label} onRename={onRename} /> : <h2 className="panel-name">{name}</h2>}
      {children}
      {menu && (typeof menu === 'function' || menu.length > 0) && (
        <Menu label={`${name} menu`} className="ibtn" align="end" tip="More" items={menu}>
          <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
        </Menu>
      )}
      {chrome?.after}
    </div>
  );
}

function TitleInput({ name, label, onRename }: { name: string; label: string; onRename(name: string): void }) {
  const [text, setText] = useState(name);
  const commit = () => {
    const next = text.trim().slice(0, 60);
    if (next && next !== name) onRename(next);
    else setText(name);
  };
  return (
    <input
      className="title-input"
      type="text"
      value={text}
      aria-label={label}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') { e.stopPropagation(); setText(name); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); }
      }}
    />
  );
}

/**
 * An inspector section. With an `id` it folds and remembers whether it is open; folded, its header
 * shows `summary` (what is inside: "Studio", "Relaxed / Fist").
 */
export function Section({ id, title, actions, children, defaultOpen = true, summary, info }: {
  id?: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  summary?: ReactNode;
  /** What the section is about, behind an ⓘ in its header. */
  info?: string;
}) {
  const key = id ? `pose-studio-section-${id}` : null;
  const [open, setOpen] = useState(() => {
    if (!key || typeof localStorage === 'undefined') return defaultOpen;
    const v = localStorage.getItem(key);
    return v === null ? defaultOpen : v === '1';
  });
  const toggle = () => {
    setOpen((o) => {
      if (key) try { localStorage.setItem(key, o ? '0' : '1'); } catch { /* ignore */ }
      return !o;
    });
  };
  return (
    <section className={`psec${open ? '' : ' closed'}`}>
      <div className="psec-head">
        {key ? (
          <button type="button" className="psec-title" aria-expanded={open} onClick={toggle}>
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            <h3>{title}</h3>
            {!open && summary && <span className="psec-summary">{summary}</span>}
          </button>
        ) : (
          <h3 className="psec-title">{title}</h3>
        )}
        {(actions || info) && <div className="psec-actions">{info && <Info text={info} label={`About ${title.toLowerCase()}`} />}{actions}</div>}
      </div>
      {open && <div className="psec-body">{children}</div>}
    </section>
  );
}

/** ⓘ beside a label: its explanation, as a tooltip on hover, or shown under the row with a tap (touch). */
export function Info({ text, label = 'More about this' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="info-wrap">
      <button type="button" className="info-btn" aria-label={label} aria-expanded={open} data-tip={open ? undefined : text} onClick={() => setOpen(!open)} onBlur={() => setOpen(false)}>
        <Info16 aria-hidden />
      </button>
      {open && <span className="info-pop" role="note">{text}</span>}
    </span>
  );
}

const Info16 = (props: { 'aria-hidden': boolean }) => <CircleHelp size={12} strokeWidth={2} {...props} />;

/** A property: its label (and ⓘ) on the left, its control on the right. */
export function PropertyRow({ label, info, children }: { label: string; info?: string; children: ReactNode }) {
  return (
    <div className="field">
      <span>{label}{info && <Info text={info} label={`About ${label.toLowerCase()}`} />}</span>
      {children}
    </div>
  );
}

/** Properties that belong together. */
export function PropertyGroup({ children }: { children: ReactNode }) {
  return <div className="pgroup">{children}</div>;
}

/** One line of secondary text: an empty state, a note under a row. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="hint">{children}</p>;
}

/**
 * A side panel's inner edge: drag it to make the panel wider or narrower (within PANEL_WIDTH),
 * double-click it to go back to the panel's own width. `side`: which way is wider.
 */
export function PanelEdge({ label, side, width, onWidth }: { label: string; side: 'left' | 'right'; width(): number; onWidth(w: number | null): void }) {
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width();
    const move = (ev: PointerEvent) => onWidth(Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, w0 + (side === 'right' ? ev.clientX - x0 : x0 - ev.clientX)))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.classList.add('resizing');
  };
  return <div className={`panel-edge ${side}`} role="separator" aria-orientation="vertical" aria-label={label} data-tip={`${label} (double-click: its own width)`} onPointerDown={drag} onDoubleClick={() => onWidth(null)} />;
}

/* ---------------- Inputs ---------------- */

/**
 * A number typed in: free to edit as text (cleared, retyped) while it has the focus, the number
 * taken when it is left or Enter is pressed, kept within its range (Escape: as it was); the up and
 * down arrows step it (Shift: ten steps).
 */
export function NumberInput({ value, onChange, min = -Infinity, max = Infinity, step = 1, digits = 2, label, className, autoFocus, onDone }: {
  value: number;
  onChange(v: number): void;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  label: string;
  className?: string;
  autoFocus?: boolean;
  /** Left (taken or not). */
  onDone?(): void;
}) {
  const [text, setText] = useState<string | null>(null);
  const round = (v: number) => Math.round(v * 10 ** digits) / 10 ** digits;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = () => {
    if (text !== null) {
      const v = Number(text.replace(',', '.'));
      if (text.trim() !== '' && Number.isFinite(v)) onChange(clamp(round(v)));
    }
    setText(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      aria-label={label}
      autoFocus={autoFocus}
      value={text ?? String(round(value))}
      onFocus={(e) => { setText(String(round(value))); e.target.select(); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { commit(); onDone?.(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        else if (e.key === 'Escape') { e.stopPropagation(); setText(null); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const v = clamp(round((text !== null && Number.isFinite(Number(text)) ? Number(text) : value) + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)));
          onChange(v);
          setText(String(v));
        }
      }}
    />
  );
}

/**
 * Labelled range slider. With `typeable`, clicking the value turns it into a number field for
 * precise entry (Enter or blur applies, Esc cancels); values are in the slider's own units.
 */
export function Slider({ label, value, min, max, step = 1, display, onChange, typeable, axis, before, after }: {
  label: string;
  /** Beside the track, either side (a joint's − and + steps). */
  before?: ReactNode;
  after?: ReactNode;
  /** A joint's slider: marked in its axis's colour (as its arc on the canvas). */
  axis?: number;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  onChange(v: number): void;
  typeable?: boolean;
}) {
  const id = useId();
  const [typing, setTyping] = useState(false);
  let valueEl: ReactNode;
  if (typing) {
    valueEl = (
      <NumberInput
        className="slider-value"
        autoFocus
        label={`${label} value`}
        value={Math.round(value * 10) / 10}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        onDone={() => setTyping(false)}
      />
    );
  } else if (typeable) {
    valueEl = (
      <button
        type="button"
        className="slider-value"
        data-tip="Click to type a value"
        aria-label={`${label}: ${display ?? value}. Click to type a value`}
        onClick={() => setTyping(true)}
      >
        {display ?? value}
      </button>
    );
  } else {
    valueEl = <em>{display ?? value}</em>;
  }
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={`slider${axis === undefined ? '' : ` axis-${'xyz'[axis]}`}`}>
      <span className="slider-head">
        <span id={id}>{label}</span>
        {valueEl}
      </span>
      <span className="slider-track">
        {before}
        <input
          type="range"
          aria-labelledby={id}
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ '--fill': `${Math.min(100, Math.max(0, pct))}%` } as React.CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {after}
      </span>
    </div>
  );
}

/** On/off switch with a label. */
export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <label className="switch" data-tip={hint}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** A dialog's property: its caption (and ⓘ) beside a control that is not a single labelable input. */
export function Field({ label, info, children }: { label: string; info?: string; children: ReactNode }) {
  return (
    <div className="field">
      <span>{label}{info && <Info text={info} label={`About ${label.toLowerCase()}`} />}</span>
      {children}
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  title?: string;
  /** Offered but not usable now (its tip says why). */
  disabled?: boolean;
}

/** Radio group drawn as a segmented control. `iconOnly` shows just the icons (with tooltips). */
export function Segmented<T extends string>({ value, options, onChange, label, iconOnly, full }: {
  value: T;
  options: SegmentOption<T>[];
  onChange(v: T): void;
  label?: string;
  iconOnly?: boolean;
  /** Stretch to the container width. */
  full?: boolean;
}) {
  return (
    <div className={`segmented${full ? ' full' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={iconOnly ? o.label : undefined}
          aria-disabled={o.disabled || undefined}
          className={`${o.value === value ? 'on' : ''}${o.disabled ? ' off' : ''}`}
          data-tip={o.title ?? (iconOnly ? o.label : undefined)}
          data-tip-side="top"
          onClick={() => { if (!o.disabled) onChange(o.value); }}
        >
          {o.icon && <o.icon size={15} strokeWidth={1.75} aria-hidden />}
          {!iconOnly && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

/** Styled native select. */
/**
 * A drop-down list (replaces the system select so it matches the app): a combobox button and a
 * listbox drawn on top of everything. Keys: arrows, Home / End, Enter / Space, Escape, and typing
 * jumps to a matching option.
 */
export function Select<T extends string>({ value, options, onChange, label }: {
  value: T;
  /** `hint`: a line under the option's label, saying what it is for. */
  options: { value: T; label: string; hint?: string }[];
  onChange(v: T): void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const show = () => { setActive(index); setOpen(true); };
  const pick = (i: number) => {
    setOpen(false);
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
  };
  /** The option whose label starts with what was typed in the last moment. */
  const typeahead = (key: string, from: number) => {
    const now = performance.now();
    const t = typed.current;
    t.text = now - t.at > 700 ? key : t.text + key;
    t.at = now;
    const q = t.text.toLowerCase();
    const start = t.text.length === 1 ? from + 1 : from;
    for (let k = 0; k < options.length; k++) {
      const i = (start + k) % options.length;
      if (options[i].label.toLowerCase().startsWith(q)) return i;
    }
    return -1;
  };

  // Place the list under the button (or above it when there is no room), at least as wide.
  useLayoutEffect(() => {
    const el = list.current;
    if (!open || !el || !button.current) return;
    const b = button.current.getBoundingClientRect();
    el.style.minWidth = `${b.width}px`;
    placePopup(el, b, 'bottom', 'start', 4);
    el.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => button.current?.contains(t as Node) || list.current?.contains(t as Node);
    const onDown = (e: PointerEvent) => { if (!inside(e.target)) setOpen(false); };
    const onScroll = (e: Event) => { if (!list.current?.contains(e.target as Node)) setOpen(false); };
    const onResize = () => setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const last = options.length - 1;
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity, PageDown: 8, PageUp: -8 };
    let handled = true;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) show();
      else if (e.key.length === 1 && e.key !== ' ') { const i = typeahead(e.key, index); if (i >= 0) pick(i); }
      else handled = false;
    } else if (e.key in step) setActive((a) => Math.max(0, Math.min(last, a + step[e.key])));
    else if (e.key === 'Enter' || (e.key === ' ' && performance.now() - typed.current.at > 700)) pick(active);
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Tab') { setOpen(false); handled = false; }
    else if (e.key.length === 1) { const i = typeahead(e.key, active); if (i >= 0) setActive(i); }
    else handled = false;
    if (!handled) return;
    // Keep the keys from the studio's shortcuts (and an open select's Escape from closing a dialog).
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="select">
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        className="select-button"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span>{options[index]?.label}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && createPortal(
        <ul ref={list} id={`${id}-list`} className="select-list" role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-label={o.label}
              aria-describedby={o.hint ? `${id}-${i}-hint` : undefined}
              aria-selected={i === index}
              className={i === active ? 'active' : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onPointerMove={() => setActive(i)}
              onClick={() => { pick(i); button.current?.focus(); }}
            >
              <Check size={14} aria-hidden />
              {o.hint ? <span className="select-option"><span>{o.label}</span><small id={`${id}-${i}-hint`}>{o.hint}</small></span> : <span>{o.label}</span>}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}

/**
 * Compact number input with a short prefix label (Figma style). Dragging the prefix scrubs the
 * value; arrow keys step it.
 */
export function NumberField({ prefix, label, value, onChange, step = 1, min = -Infinity, max = Infinity, digits = 2 }: {
  prefix: string;
  label: string;
  value: number;
  onChange(v: number): void;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const round = (v: number) => Math.round(v * 10 ** digits) / 10 ** digits;
  const scrub = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = value;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onChange(clamp(round(start + Math.round((ev.clientX - startX) / 2) * step)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div className="numfield">
      {/* (X, Y and Z in the axes' colours, as on the gizmo and the view widget.) */}
      <span className={`numfield-prefix${/^[XYZ]$/.test(prefix) ? ` axis-${prefix.toLowerCase()}` : ''}`} onPointerDown={scrub} aria-hidden>{prefix}</span>
      <NumberInput label={label} value={value} min={min} max={max} step={step} digits={digits} onChange={onChange} />
    </div>
  );
}

/* ---------------- Toasts ---------------- */

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  /** Optional button, e.g. "Undo". */
  action?: { label: string; run(): void };
}

export type Notify = (text: string, kind?: Toast['kind'], action?: Toast['action']) => void;

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss(id: number): void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} dismiss={dismiss} />)}
    </div>
  );
}

/** A toast, on screen for its time from when it shows (not from when it was asked for, which a long edit can delay). */
function ToastItem({ toast: t, dismiss }: { toast: Toast; dismiss(id: number): void }) {
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), t.kind === 'error' || t.action ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [t.id, t.kind, t.action, dismiss]);
  const Icon = t.kind === 'error' ? CircleAlert : CircleCheck;
  return (
    <div className={`toast ${t.kind}`}>
      <Icon size={16} aria-hidden />
      <span>{t.text}</span>
      {t.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => { t.action!.run(); dismiss(t.id); }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}
