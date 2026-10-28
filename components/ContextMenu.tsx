'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { MenuItems, type MenuItem } from './ui';

/*
 * Right-click menus. Anything can open one at the pointer with `openContextMenu`; one host in
 * the studio shows it. Closes on a choice, a click elsewhere, Escape, resizing, or the wheel turned
 * elsewhere (over it, the wheel scrolls it).
 */

let current: { x: number; y: number; title?: string; items: MenuItem[] } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openContextMenu(e: { clientX: number; clientY: number; preventDefault?(): void }, items: MenuItem[], title?: string) {
  e.preventDefault?.();
  current = { x: e.clientX, y: e.clientY, title, items };
  emit();
}

export function closeContextMenu() {
  if (!current) return;
  current = null;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
const get = () => current;

export function ContextMenuHost() {
  const menu = useSyncExternalStore(subscribe, get, get);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const el = ref.current;
    // Keep it on screen (its own size: the opening animation scales it).
    if (el) {
      el.style.left = `${Math.max(4, Math.min(menu.x, window.innerWidth - el.offsetWidth - 4))}px`;
      el.style.top = `${Math.max(4, Math.min(menu.y, window.innerHeight - el.offsetHeight - 4))}px`;
      el.querySelector<HTMLElement>('[role^=menuitem]:not(:disabled)')?.focus();
    }
    const onDown = (e: PointerEvent) => { if (!el?.contains(e.target as Node)) closeContextMenu(); };
    const onWheel = (e: WheelEvent) => { if (!el?.contains(e.target as Node)) closeContextMenu(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeContextMenu(); }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...(el?.querySelectorAll<HTMLElement>('[role^=menuitem]:not(:disabled)') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', closeContextMenu);
      window.removeEventListener('wheel', onWheel);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="menu-list context-menu"
      role="menu"
      aria-label={menu.title ?? 'Context menu'}
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.title && <div className="menu-group" role="presentation">{menu.title}</div>}
      <MenuItems items={menu.items} onDone={closeContextMenu} />
    </div>
  );
}
