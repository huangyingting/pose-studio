'use client';

import { useLayoutEffect, type KeyboardEvent, type RefObject } from 'react';

/*
 * One Tab stop for a list, a grid, a tab bar or a radio group, the arrows inside it (#20): the
 * WAI-ARIA "roving tabindex". The item last focused (else the one chosen, else the first) is the
 * only one Tab reaches; ↑ ↓ (← → across, all four in a grid), Home and End move the focus; moving
 * may also choose what it moves to (a tab, a radio, a row of the outline), as a click would.
 */

export type Roving = {
  /** The items, within the container. */
  items: string;
  /** Which way the arrows go: down a list, along a row, or both in a grid of rows. */
  orientation: 'vertical' | 'horizontal' | 'grid';
  /** What is chosen, to be the Tab stop when nothing in it has had the focus. */
  chosen?: string;
  /** Moving there chooses it too (a tab, a radio, a row selected as it is focused). */
  activate?: (item: HTMLElement) => void;
  /** Buttons within the items kept out of the Tab order (a row's own ⋯ and eye: its menu has them). */
  quiet?: string;
};

const itemsIn = (root: HTMLElement, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)].filter((el) => el.offsetParent !== null && !el.hasAttribute('disabled'));

/** Keep one item of the container in the Tab order (and keep what is in rows, their own buttons, out of it). */
export function useRoving(ref: RefObject<HTMLElement | null>, r: Roving) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = itemsIn(root, r.items);
    if (!items.length) return;
    const focused = items.find((el) => el === document.activeElement);
    const stop = focused ?? (r.chosen ? items.find((el) => el.matches(r.chosen!)) : undefined) ?? items.find((el) => el.tabIndex === 0) ?? items[0];
    for (const el of items) el.tabIndex = el === stop ? 0 : -1;
    if (r.quiet) for (const el of root.querySelectorAll<HTMLElement>(r.quiet)) el.tabIndex = -1;
  });
}

/** Shift + F10 or the menu key on an item: its right-click menu, opened where it is. */
export function menuKey(e: KeyboardEvent<HTMLElement>) {
  if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el || !e.currentTarget.contains(el)) return false;
  e.preventDefault();
  e.stopPropagation();
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + Math.min(40, r.width / 2), clientY: r.bottom - 4 }));
  return true;
}

/** The arrows (and Home / End) inside a roving container; true if it took the key. */
export function rovingKey(e: KeyboardEvent<HTMLElement>, r: Roving) {
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  const root = e.currentTarget;
  const items = itemsIn(root, r.items);
  const from = items.findIndex((el) => el === document.activeElement || el.contains(document.activeElement));
  if (from < 0) return false;
  let to = from;
  // (A grid: how many to a row, from where they sit.)
  const across = r.orientation === 'grid' ? Math.max(1, items.filter((el) => el.offsetTop === items[0].offsetTop).length) : 1;
  const next = r.orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const prev = r.orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
  switch (e.key) {
    case next: to = from + (r.orientation === 'grid' ? across : 1); break;
    case prev: to = from - (r.orientation === 'grid' ? across : 1); break;
    case 'ArrowRight': if (r.orientation === 'grid') to = from + 1; else return false; break;
    case 'ArrowLeft': if (r.orientation === 'grid') to = from - 1; else return false; break;
    case 'Home': to = 0; break;
    case 'End': to = items.length - 1; break;
    default: return false;
  }
  e.preventDefault();
  e.stopPropagation();
  to = Math.max(0, Math.min(items.length - 1, to));
  const el = items[to];
  for (const x of items) x.tabIndex = x === el ? 0 : -1;
  el.focus();
  if (to !== from) r.activate?.(el);
  return true;
}
