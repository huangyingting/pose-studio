'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/** Focusable elements that are actually visible and enabled. */
function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
  );
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: string;
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
    const candidates = [...root.querySelectorAll<HTMLElement>('[data-autofocus]'), ...focusables(body), ...focusables(root)];
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
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

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
  return (
    <div className="slider">
      <span>
        <span id={id}>{label}</span>
        {valueEl}
      </span>
      <input type="range" aria-labelledby={id} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <label className="check" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
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

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange(v: T): void;
  label?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={(e) => { e.stopPropagation(); t.action!.run(); dismiss(t.id); }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
