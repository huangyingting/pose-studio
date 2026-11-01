# 0011. Render stability by design, not by tuning

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

The canvas flickered in several ways:

- shadows appeared and disappeared as the view moved, then settled;
- a door beside a cut-away wall blinked;
- far surfaces fought for depth.

Each could be patched with a bias or an epsilon, but a patch only held for the view it was tuned in, and the flicker came back elsewhere.

## Decision

Remove the causes, so that there is nothing to tune:

- **The view settles**: camera easing ends when the view has stopped, instead of trailing on forever, so a still view renders the same frame (`SettleView`).
- **One shadow per surface**: a set's floor and what lies flat on it (rugs, paths, road markings) cast no shadow. They would shade themselves and hide the people's shadows. The shadow-catching floor appears only on the bare stage.
- **Steady soft shadows**: the soft shadow's noise is tied to the shadow map's texels, not the screen's pixels, so its grain stays put on the floor.
- **The cutaway keeps people in view**: a wall goes when it stands between the view and the people, not only between the view and its target, and the door next to it stays one piece.
- **A depth pre-pass and a fitted near and far plane**, so far surfaces don't fight for the same depth.

## Consequences

- No per-view tuning constants, and a new set or view does not bring the flicker back.
- These rules apply to new rendering work: a new kind of surface is asked "does it cast?" and "is it drawn once?".
- Unit tests pin them (flat casters, the cutaway, the subject staying in frame).
