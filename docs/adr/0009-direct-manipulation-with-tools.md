# 0009. Direct manipulation through tools; right-click selects

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

Posing is done mostly with the mouse on the figure. The same drag can mean different things: reach with a hand, swing a forearm, move the whole figure, turn a joint. Adding a modifier key for each meaning made the app hard to learn. Dots and rings drawn on the body as handles cluttered the drawing.

## Decision

- **The body is the handle.** There are no dots on it: a drag on a part acts on that part, and hovering shows what a drag would move.
- **Tools say what a drag does**, as in Blender and Maya (`components/CanvasTools.tsx`, `store.tool`):
  - **Pose** (`Q`, the default): a hand or foot reaches, with the limb following (two-bone IK, `lib/mannequin.ts`); with **Body follows**, the shoulder and chest come along. Any other part swings from its joint; the hips sink or shift on planted feet.
  - **Move** (`W`): any part places the whole figure on the floor. In an animated scene, it moves all the figure does.
  - **Rotate** (`E`): any part turns at its joint.
  A new gesture goes into a tool, not into a new modifier key.
- A hand or foot can be **pinned**: it stays where it is while the rest is posed.
- **A click picks, a second click goes deeper**: the first click on a figure picks it, the next picks the part under the pointer. A **right-click does the same** before showing that thing's menu, so the inspector always shows what the menu is for. Picking something opens the inspector.
- Floor drags follow the pointer from any view angle (`Manipulators.tsx`).

## Consequences

- One gesture means one thing in a given tool, and the tool bar and hint say which.
- The canvas stays a drawing: no handles on the figure, and the gizmo only on what is selected.
- The rules are written in `docs/UI.md` §9, and the e2e tests drive them (the tools, pins, right-click on a part).
