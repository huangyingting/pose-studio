'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/*
 * Tooltips for anything with `data-tip` (and optionally `data-tip-side`: top, bottom, left, right).
 * One host draws them above everything, so panels that scroll or clip never cut them off; they
 * flip to the other side and stay inside the window. "Label  Ctrl E" shows the keys apart.
 */

type Side = 'top' | 'bottom' | 'left' | 'right';
type Tip = { el: HTMLElement; text: string; side: Side };

const DELAY = 450;
/** Moving from one tip to the next within this time shows it at once. */
const WARM = 400;

export function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer = 0;
    let hiddenAt = 0;
    let open = false;
    const hide = () => {
      window.clearTimeout(timer);
      if (open) hiddenAt = performance.now();
      open = false;
      current = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text || !el.isConnected || (el as HTMLButtonElement).disabled) return;
      open = true;
      setTip({ el, text, side: (el.dataset.tipSide as Side | undefined) ?? 'bottom' });
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
      if (el === current) return;
      const warm = open || performance.now() - hiddenAt < WARM;
      hide();
      if (!el) return;
      current = el;
      timer = window.setTimeout(() => show(el), warm ? 0 : DELAY);
    };
    const move = () => { if (current && !current.isConnected) hide(); };
    const focus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]');
      if (el?.matches(':focus-visible')) {
        hide();
        current = el;
        show(el);
      }
    };
    window.addEventListener('pointerover', over, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('focusin', focus);
    window.addEventListener('focusout', hide);
    document.addEventListener('pointerleave', hide);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerover', over, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('focusin', focus);
      window.removeEventListener('focusout', hide);
      document.removeEventListener('pointerleave', hide);
    };
  }, []);

  // Place it by its target: the preferred side, else the opposite one, kept inside the window.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!tip || !box) return;
    const r = tip.el.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fits: Record<Side, boolean> = {
      bottom: r.bottom + gap + h <= vh - 4,
      top: r.top - gap - h >= 4,
      right: r.right + gap + w <= vw - 4,
      left: r.left - gap - w >= 4,
    };
    const opposite: Record<Side, Side> = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };
    const side = fits[tip.side] || !fits[opposite[tip.side]] ? tip.side : opposite[tip.side];
    let x = side === 'left' ? r.left - gap - w : side === 'right' ? r.right + gap : r.left + r.width / 2 - w / 2;
    let y = side === 'top' ? r.top - gap - h : side === 'bottom' ? r.bottom + gap : r.top + r.height / 2 - h / 2;
    x = Math.max(4, Math.min(x, vw - w - 4));
    y = Math.max(4, Math.min(y, vh - h - 4));
    box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    box.dataset.side = side;
  }, [tip]);

  if (!tip) return null;
  // "Label  Ctrl E": the part after a double space is the shortcut.
  const lines = tip.text.split('\n');
  const [label, keys] = lines[0].split(/\s{2,}/);
  return (
    <div ref={ref} className="tooltip" role="tooltip">
      <span>{label}</span>
      {keys && <kbd>{keys}</kbd>}
      {lines.slice(1).map((l, i) => <span key={i} className="tooltip-more">{l}</span>)}
    </div>
  );
}
