'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, X, type LucideIcon } from 'lucide-react';

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
      if (e.key === 'Escape') {
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
  tipSide?: 'top' | 'bottom' | 'left';
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
  | { label: string; icon?: LucideIcon; shortcut?: string; onSelect(): void; danger?: boolean; disabled?: boolean; checked?: boolean }
  | { group: string }
  | '-';

/** Button that opens a list of actions. Closes on selection, outside click or Escape. */
export function Menu({ label, items, children, className = 'btn ghost', side = 'bottom', align = 'start', tip }: {
  label: string;
  items: MenuItem[];
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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); root.current?.querySelector<HTMLElement>('button')?.focus(); }
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    list.current?.querySelector<HTMLElement>('[role^=menuitem]:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
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
      {open && (
        <div className={`menu-list ${side} ${align}`} role="menu" aria-label={label} ref={list} onKeyDown={onListKey}>
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
                onClick={() => { setOpen(false); it.onSelect(); }}
              >
                <span className="menu-icon" aria-hidden>{it.icon && <it.icon size={15} strokeWidth={1.75} />}</span>
                <span className="menu-label">{it.label}</span>
                {it.shortcut && <kbd>{it.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Panel structure ---------------- */

/** Panel section with a title row; optionally collapsible (state remembered per id). */
export function Section({ id, title, actions, children, collapsible, defaultOpen = true }: {
  id?: string;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const key = id ? `pose-studio-section-${id}` : null;
  const [open, setOpen] = useState(() => {
    if (!collapsible || !key || typeof localStorage === 'undefined') return defaultOpen;
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
        {collapsible ? (
          <button type="button" className="psec-title" aria-expanded={open} onClick={toggle}>
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            <h3>{title}</h3>
          </button>
        ) : (
          <h3 className="psec-title">{title}</h3>
        )}
        {actions && <div className="psec-actions">{actions}</div>}
      </div>
      {open && <div className="psec-body">{children}</div>}
    </section>
  );
}

/* ---------------- Inputs ---------------- */

/**
 * Labelled range slider. With `typeable`, clicking the value turns it into a number field for
 * precise entry (Enter or blur applies, Esc cancels); values are in the slider's own units.
 */
export function Slider({ label, value, min, max, step = 1, display, onChange, typeable }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  onChange(v: number): void;
  typeable?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
    setText(null);
  };
  let valueEl: ReactNode;
  if (text !== null) {
    valueEl = (
      <input
        type="number"
        className="slider-value"
        autoFocus
        aria-label={`${label} value`}
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') { e.stopPropagation(); setText(null); }
        }}
      />
    );
  } else if (typeable) {
    valueEl = (
      <button
        type="button"
        className="slider-value"
        title="Click to type a value"
        aria-label={`${label}: ${display ?? value}. Click to type a value`}
        onClick={() => setText(String(Math.round(value * 10) / 10))}
      >
        {display ?? value}
      </button>
    );
  } else {
    valueEl = <em>{display ?? value}</em>;
  }
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <span className="slider-head">
        <span id={id}>{label}</span>
        {valueEl}
      </span>
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
    </div>
  );
}

/** On/off switch with a label. */
export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <label className="switch" title={hint}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Caption above a control that is not a single labelable input (e.g. a Segmented group). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span aria-hidden>{label}</span>
      {children}
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  title?: string;
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
          className={o.value === value ? 'on' : ''}
          title={iconOnly ? undefined : o.title}
          data-tip={iconOnly ? (o.title ?? o.label) : undefined}
          data-tip-side="top"
          onClick={() => onChange(o.value)}
        >
          {o.icon && <o.icon size={15} strokeWidth={1.75} aria-hidden />}
          {!iconOnly && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

/** Styled native select. */
export function Select<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <div className="select">
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={14} aria-hidden />
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
  const [text, setText] = useState<string | null>(null);
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
  const commit = () => {
    if (text === null) return;
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v)) onChange(clamp(v));
    setText(null);
  };
  return (
    <div className="numfield">
      <span className="numfield-prefix" onPointerDown={scrub} aria-hidden>{prefix}</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={text ?? String(round(value))}
        onFocus={(e) => { setText(String(round(value))); e.target.select(); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { e.stopPropagation(); setText(null); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = clamp(round(value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)));
            onChange(v);
            setText(String(v));
          }
        }}
      />
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
      {toasts.map((t) => {
        const Icon = t.kind === 'error' ? CircleAlert : CircleCheck;
        return (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
            <Icon size={16} aria-hidden />
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={(e) => { e.stopPropagation(); t.action!.run(); dismiss(t.id); }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
