# 0006. Animation as actions on each figure's track

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

People in a scene walk to places, play motions (a wave, a dance, a fight), hold poses, handle props and react to each other. Keyframing every joint, as general 3D tools do, is too slow for blocking a scene. Playing motion clips alone cannot get a figure to a given spot or adjust a pose by hand. And an edit to one person must not shift anyone else's timing.

## Decision

An `Animation` is a list of **actions**, each placed on the tracks of the figures in it (`roles`), with a start and a length. An action's `source` is one of:

- **keys**: poses keyed by hand, as a small clip of the action's own;
- **clip**: a motion from the Library (built in, Mocap or imported), with speed, mirroring, the part played, repeats and blending;
- **travel**: walk, run or jump to a mark, its steps generated (`lib/locomotion.ts`) or a Mocap gait, with the feet planted.

Layers go over a track:

- an upper-body (or arms, head, legs) motion over what the figure is doing;
- **corrections**: posing over a motion makes a correction around that moment, faded in and out, instead of replacing the motion.

`lib/evaluate.ts` turns a track into a pose at any time: it places and blends the actions, adds idle life in the gaps, applies the corrections and solves contacts (`lib/constraints.ts`: planted feet, hands on partners, holds). Props over time come from the same actions (`lib/propmotion.ts`, physics baked with Rapier). `lib/track.ts` holds the edits: move, trim, split, retime, repeat, recast.

## Consequences

- A figure's timeline reads as what they do (blocks), not as curves, and edits work on blocks: drag, trim, split, stretch, slip, repeat.
- Changing one person's action never moves anyone else's; a motion of several people is one action on each of their rows.
- Hand posing and generated or captured motion combine: corrections ride on the motion and go with it when it is moved or copied.
- The evaluator is the most involved part of the code. Its behaviour is pinned by unit tests, and by slow tests over every motion and every pairing of body builds.
