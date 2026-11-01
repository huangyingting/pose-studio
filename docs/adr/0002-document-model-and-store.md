# 0002. One document, one store, every change undoable

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

Many parts of the app edit the same things: the canvas, the outline, the inspector, the timeline, menus, the keyboard and the AI assistant. Each has to show the same state, undo has to cover all of them, and the project has to be saved and synced as one piece.

## Decision

- **The document is plain data** (`lib/types.ts`): a `Library` of `Scene`s; a scene holds figures, props, cameras, lights, a set and an optional `Animation` (actions on tracks, shots, markers). It is JSON, validated where it enters (`lib/doc.ts`: files, share links, storage).
- **One store** (`lib/store.ts`) holds the library and the UI state (selection, time, tool, pins, settings). Document edits go through `store.commit`, which keeps a history of 200 steps; edits made during one gesture share a key and become one undo step. UI state (what is selected, the playhead) is set without history.
- Components read the store through `useStudio(selector)` and `useScene()` (`useSyncExternalStore`), and re-render only for what they select.
- The store saves itself to `localStorage` (debounced, flushed when the tab is hidden) and adopts changes another tab saved instead of overwriting them.

## Consequences

- Every surface shows the same state with no syncing between them, and undo covers every way of editing.
- The document is immutable: an edit makes a new object, so components and caches compare by identity, and undo is keeping old objects.
- Large assets (imported motions, characters) are kept outside the document, by id, in IndexedDB (`lib/assetstore.ts`), so the document stays small enough for `localStorage` and sync.
- Derived data (a figure's pose at a time, a camera's view) is computed from the document, never stored in it.
