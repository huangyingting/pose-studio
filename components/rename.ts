import { useSyncExternalStore } from 'react';

/*
 * Which outline item (figure, prop or shot id) is being renamed in place. F2, double-click and
 * the right-click "Rename" all start it; the outline row shows the text field.
 */

let renaming: string | null = null;
const listeners = new Set<() => void>();

export function startRename(id: string | null) {
  renaming = id;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export function useRenaming() {
  return useSyncExternalStore(subscribe, () => renaming, () => null);
}
