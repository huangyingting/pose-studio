# Architecture decision records

Each record is one decision Pose Studio is built on: what it had to solve, what was chosen, and what follows from it. They are short and they stay true: when a decision is changed, its record is marked **Superseded** and the new one says what replaced it.

Most were made while the app was being built and are written down here as they stand (November 2026).

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-two-editions-one-codebase.md) | Two editions from one codebase: static and server | Accepted |
| [0002](0002-document-model-and-store.md) | One document, one store, every change undoable | Accepted |
| [0003](0003-actions-are-the-only-writers.md) | All changes go through `lib/actions` | Accepted |
| [0004](0004-every-operation-is-a-command.md) | Every operation is a command | Accepted |
| [0005](0005-skeleton-and-pose-representation.md) | The VRM humanoid skeleton; poses as turns on the T-pose | Accepted |
| [0006](0006-animation-as-actions-on-tracks.md) | Animation as actions on each figure's track | Accepted |
| [0007](0007-one-scene-view-styles-as-data.md) | One scene view for editor and export; styles as data | Accepted |
| [0008](0008-cameras-shots-and-the-director.md) | Cameras are objects; shots film with them; the director re-cuts | Accepted |
| [0009](0009-direct-manipulation-with-tools.md) | Direct manipulation through tools; right-click selects | Accepted |
| [0010](0010-sets-as-budgeted-assets.md) | Sets as budgeted, prepared assets; furniture as the floor | Accepted |
| [0011](0011-render-stability-by-design.md) | Render stability by design, not by tuning | Accepted |
| [0012](0012-no-compatibility-code.md) | No compatibility code | Accepted |
| [0013](0013-ai-assistant-uses-the-same-actions.md) | The AI assistant uses the same actions as the user | Accepted |
| [0014](0014-testing-strategy.md) | Testing: fast unit tests locally, slow and browser tests in CI | Accepted |
| [0015](0015-ui-rules-in-one-document.md) | The UI's rules live in one document | Accepted |

New records copy [template.md](template.md) and take the next number.
