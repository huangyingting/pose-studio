'use client';

import { useEffect, useRef } from 'react';
import type { Store } from '@/lib/store';
import { COMMANDS, commandForKey, matchesKey, selectionCtx } from './commands';

/**
 * The keyboard's routing (#20): a key goes to what has the focus when that uses it (a field, a
 * slider, a menu, a list), else to the command it is bound to, on the selection. Nothing while a
 * dialog is open; Escape first ends a pick (Walk to…, Throw to…) under way.
 */
export function useShortcuts(store: Store, dialog: boolean, picking: boolean, endPick: (none: null) => void) {
  // Whether the keyboard (Tab), not the pointer, last moved the focus; whether the canvas was last clicked.
  const tabbing = useRef(false);
  const onCanvas = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') tabbing.current = true;
      if (dialog || e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      const typing = el.closest('textarea, select, [contenteditable="true"]')
        || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(el.type));
      if (typing) return;
      // The arrow and Page keys belong to what has focus if it uses them (a slider, a menu, a list, tabs), and
      // scroll a side panel last clicked in; a plain button just clicked keeps no hold on them.
      if ((e.key.startsWith('Arrow') || e.key.startsWith('Page')) && (el === document.body ? inPanel
        : el.closest('input, select, [role="slider"], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="listbox"], [role="option"], [role="combobox"], [role="radiogroup"], [role="radio"], [role="tablist"], [role="tab"], [role="grid"], [role="tree"], [role="list"] [tabindex], .tl-tracks'))) return;
      // Space presses the button that has the focus when the keyboard brought it there (Tab, as
      // browsers have it); after the pointer was last used (a click, a dialog closed), Space plays.
      // (In a menu or a list, Space chooses the item it is on, however the focus got there.)
      if (e.key === ' ' && (el.closest?.('[role="menu"], [role^="menuitem"], [role="listbox"], [role="option"], .action-picker')
        || (tabbing.current && el.closest?.('button, [role="button"]')))) return;
      // Tab goes from thing to thing only with the focus on the canvas (last clicked, nothing focused);
      // elsewhere, and before the canvas is clicked, it moves the focus.
      if (e.key === 'Tab' && (el !== document.body || !onCanvas.current)) return;
      if (picking && e.key === 'Escape') {
        e.preventDefault();
        endPick(null);
        return;
      }
      const c = selectionCtx(store);
      const cmd = commandForKey(e, c);
      if (!cmd) {
        // A Ctrl key of ours that does nothing here still does not reach the browser (Ctrl D would bookmark the page).
        // (Not Ctrl C with text selected: that copies the text.)
        if ((e.ctrlKey || e.metaKey) && !window.getSelection()?.toString() && COMMANDS.some((x) => x.keys?.some((k) => matchesKey(k, e)))) e.preventDefault();
        return;
      }
      e.preventDefault();
      cmd.run!(c);
    };
    let inPanel = false;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      tabbing.current = false;
      inPanel = !!t.closest?.('aside');
      onCanvas.current = t instanceof HTMLCanvasElement && !!t.closest('.stage');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [dialog, store, picking, endPick]);
}
