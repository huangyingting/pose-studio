# 0010. Sets as budgeted, prepared assets; furniture as the floor

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

Scenes need places: a living room, a café, a street. Real models and textures make them believable, but they are heavy, come in many formats and licences, and each can be larger than the whole app. People must be able to stand on a set's dais or sit on its sofa, and cameras must not see through its walls.

## Decision

- Sets are **prepared offline** by `npm run sets` (`scripts/sets.ts`, from the list in `lib/setassets.ts`): CC0 or CC BY models, textures and skies are simplified to a triangle budget (a model 20 k, a small one 5 k, a tree 40 k), their textures resized (1K at most) and made WebP, their geometry compressed. A set is at most 250 k triangles and 15 MB (`SET_BUDGET`), and a test checks this. Credits go in `public/sets/CREDITS.txt` and in each set's tip.
- A set is **built from pieces** (`lib/sets.ts`): its architecture as boxes and shapes, its furniture as the prepared models, or a ready-made scene fitted to the stage. Its models and textures are fetched the first time it is shown.
- **Where people stand and sit** is precomputed into the set index (`public/sets/index.json`: each model's tops, up to 1.2 m). On the canvas, a click on a set's furniture or wall counts as the floor at its foot. A seat met from any side (its back or its front, not only its top) offers **Sit here**.
- Walls cut away when they stand between the view and the people (`SetObject.cutaway`); they are not picked as objects.
- A ready-made scene's **light effects** (a sunbeam's shaft through a window: a see-through, glowing material, `isEffect`) are drawn only in 3D, as they were made. In a style of lines or paint they would be slabs across the room. They cast no shadow and stop no click or camera.

## Consequences

- The app stays light, and a set costs nothing until it is used. Its downloads are bounded and cached for offline use.
- Standing and sitting need no physics at runtime: tops and seats are data.
- Adding a set means adding an entry and running `npm run sets` (and `npm run set-thumbs` for its Library thumbnail), not changing code.
