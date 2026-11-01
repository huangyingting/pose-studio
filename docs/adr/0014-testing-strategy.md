# 0014. Testing: fast unit tests locally, slow and browser tests in CI

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

Much of Pose Studio's behaviour is geometry and timing: IK, contacts between bodies of every size, cameras framing people, motions of several people, whole films. These are best checked without a browser, but some checks are slow (every motion on every build and every pair of builds). The UI's behaviour needs a real browser, and the browser suite takes long enough that running it on every local edit would get in the way.

## Decision

- **Unit tests** (Vitest, `tests/unit`) cover the `lib/` modules directly. They run locally before every commit, as `npm run test:related` (those affected by the change) or `npm test`.
- **Slow unit tests** (`npm run test:slow`): every motion on every build and every pair of builds, every coverage on every build, whole films. They run in CI in 3 shards.
- **Browser tests** (Playwright, `tests/e2e`) drive the real app, server edition, with a fresh test database, a test sign-in and a mock AI. They run in CI in 4 shards on every push. Locally they are run only to reproduce a failure or check a fix (`BASE_URL=… npx playwright test -g …`).
- **The check job**: typecheck, lint with no warnings, and knip (no unused files or exports).
- A fix comes with a test that fails without it.

## Consequences

- Local work stays fast, and CI is the gate: a push runs everything, and a push cancels the run for the one before it.
- Every component has at least one browser test that drives it (the map is on issue #37).
- Vitest and Playwright are not run at the same time locally; both are heavy.
