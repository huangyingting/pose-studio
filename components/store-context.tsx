'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { State, Store } from '@/lib/store';

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreContext.Provider>');
  return store;
}

/** Subscribe to a slice of the studio state. Selectors must return stable references. */
export function useStudio<T>(selector: (s: State) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()));
}

export function useScene() {
  return useStudio((s) => s.library.scenes[s.sceneIndex]);
}

export function useActiveFigure() {
  const scene = useScene();
  const id = useStudio((s) => s.activeFigure);
  return scene.figures.find((f) => f.id === id) ?? null;
}
