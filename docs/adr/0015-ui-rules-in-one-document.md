# 0015. The UI's rules live in one document

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

The interface grew panel by panel: an outline, an inspector, a timeline, a Library, menus, the canvas's hints. Without shared rules each part chose its own words, controls and keys. "Film", "Scene" and "Project" meant overlapping things; some lists took arrow keys and some did not; some menus selected what they were for and some did not.

## Decision

`docs/UI.md` is the standard for the interface. It covers:

- the layout: where a thing goes;
- the words (Project, Scene, Storyboard, key; one name per thing everywhere);
- the design tokens;
- which control to use for what;
- menus and tooltips (a right-click selects what it is on);
- keyboard and focus (one Tab stop per list, roving tabindex);
- feedback (hints, readouts, toasts);
- the canvas (tools, pins, the hint).

New UI follows it, and a rule that has to change is changed there first, then in the code.

## Consequences

- Reviews have something to check against, and the app reads as one piece.
- The words in the UI, the docs and the code agree (no "film", "keyframe" or "pose sheet" where the UI says scene, key or storyboard).
- `docs/UI.md` has to be kept current: a change that breaks one of its rules without updating it is a bug.
