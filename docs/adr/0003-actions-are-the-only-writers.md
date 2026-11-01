# 0003. All changes go through `lib/actions`

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

The same change can be made from several places. A figure can walk to a spot from the floor's right-click menu, from its inspector's *Move to…*, from the timeline's **+**, through *Find a command*, or by the AI assistant. If each place built its own edit, the results would drift apart and the rules (snapping, keeping props in hand, re-cutting the director's shots) would be copied around.

## Decision

Every change to the document is a function in `lib/actions/`, which takes the store and makes one edit through `store.commit`. The functions are split by what they change: `scenes`, `figures`, `lights`, `props`, `motion`, `timeline`, `cameras`, `library`, `selection`. `lib/actions/index.ts` re-exports them all, and callers import from `@/lib/actions`.

The modules depend on each other one way only: `timeline` ← `motion` ← `cameras` ← `library`.

The rules live below them, in `lib/` modules that take a document and return a new one (`track.ts` edits tracks, `cameras.ts` places cameras, `evaluate.ts` plays the animation). The actions call these rules and commit the result.

## Consequences

- The UI, the commands and the assistant make the same edit for the same request, and a rule changes in one place.
- The pure modules under `lib/` are tested directly (`tests/unit`) without a browser.
- A new capability is an action first; the button, menu item, command and assistant tool that use it are thin.
- Components do not call `store.commit` themselves.
