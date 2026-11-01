# 0001. Two editions from one codebase: static and server

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

Most of Pose Studio (posing, animation, the storyboard, export, photo posing) can run entirely in the browser. That lets it be hosted for free on GitHub Pages and used with no account. Some features need a server: accounts, a library synced across devices, and an AI model called with a key that must not reach the browser. Keeping two apps would split the effort; shipping server code to a static host would send code that cannot work there.

## Decision

One Next.js codebase builds two editions:

- **Static** (`npm run build:static` → `out/`): everything in the browser; the library in `localStorage`, imported motions and characters in IndexedDB.
- **Server** (`npm run build`, Docker): the same app plus NextAuth sign-in, Prisma + SQLite sync and the AI proxy.

Server-only UI is imported through one alias, `@edition/server`. `next.config.ts` resolves it to `components/server/index.ts` for the server edition and to `components/server/none.ts` (all `null`) for the static one, so the static bundle contains none of it. Server API routes are named `route.server.ts`, which only the server build includes.

## Consequences

- One feature is written once and works in both; the static edition is the default case, not a cut-down copy.
- Code that needs the server is fenced in two places (`components/server/`, `route.server.ts`) and checks for `null`, so a static build cannot reach it.
- Static hosts cannot send response headers: the static build carries its Content-Security-Policy in a `<meta>` tag.
- The browser copy of the library is always the working copy; the server edition syncs it (a three-way merge per pose, `lib/sync.ts`), so editing works offline in both.
