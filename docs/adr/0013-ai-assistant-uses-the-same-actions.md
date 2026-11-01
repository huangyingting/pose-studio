# 0013. The AI assistant uses the same actions as the user

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

The server edition has an AI assistant: "two people at a café table; she gets up and walks to him; film it in three shots". A model that wrote the document directly could produce shapes the app does not accept, make edits the user cannot undo, and drift from what the UI does. A model called from the browser would need the API key in the browser.

## Decision

- The model runs **on the server** (`/api/ai`, `route.server.ts`) with the server's Azure OpenAI or OpenAI key, per signed-in user, within a daily limit.
- Its **tools run in the browser**, on the open scene (`lib/agent/tools.ts`). Each tool calls `lib/actions` (ADR 0003), the same functions the UI uses, so every change it makes is a normal, undoable edit.
- The tools work in the user's terms (figures by name, shot sizes, marks on the floor), and they say why when a request cannot be done (a motion for several people, a hand out of reach).

## Consequences

- The assistant can do only what the user can, through the same rules, and the result is indistinguishable from editing by hand.
- A new action becomes available to the assistant by adding a tool that calls it.
- The key never leaves the server, and the static edition contains none of this (ADR 0001).
