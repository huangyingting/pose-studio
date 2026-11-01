# 0007. One scene view for editor and export; styles as data

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

The canvas, the Library's thumbnails, the storyboard, still exports, video and the AI video pack all draw the same scene, in nine render styles: line art, pencil, ink wash, watercolour, anime, pixel, 3D, clay and minimal. If each drew the scene its own way, exports would not match what was on screen, and every new style would have to be added in every one of them.

## Decision

- **`SceneView`** (`lib/sceneview.ts`) keeps three.js objects in step with a `Scene`: figures (the mannequin, or a character), props, the set and the lights. The editor's canvas (React Three Fiber, `components/Viewport.tsx`) and the off-screen renderer (`lib/render.ts`, used by every export) both draw through it.
- **A style is data**: one entry in `lib/styles.ts` (`STYLE_DEFS`), giving its outline, interior lines, materials, background, lighting and any post pass. What is drawn reads `styleDef(style)`, never the style's name.
- Lines are drawn as outline hulls with brush jitter (`lib/ink.ts`), plus a part-ID edge pass for where body parts meet (`lib/lineart.ts`). Painterly and toon looks are shaders (`lib/shaders.ts`, `lib/toon.ts`); 3D is a physically based render with its own pass (`lib/realpass.ts`).

## Consequences

- Exports match the canvas, since they are drawn the same way through the same cameras (ADR 0008).
- A new style is one entry in `STYLE_DEFS`, with a shader if it needs one; nothing else has to learn its name.
- The scene view must stay free of editor-only state. Selection outlines and handles are drawn by the editor over it.
