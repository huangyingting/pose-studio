# 0016. Each frame does only what changed

- **Status**: Accepted
- **Date**: 2026-11-02

## Context

Many scenes ran slowly, in some styles far more than in others. Measured per frame (draw calls, triangles, render targets, JavaScript), the cost was mostly work done again for nothing:

- the scene's objects were placed (their world matrices worked out) again for each of a frame's passes;
- the key light's shadows were drawn again on every frame, also while only the view turned;
- the post passes drew the scene again for its depth (Watercolour, Pixel and 3D, and 3D's ambient occlusion a second time), outlines and all;
- while playing, the stand-on surfaces were rebuilt from new prop meshes every frame, and the whole timeline was rendered by React every frame;
- a high-density screen gave the full-picture passes four times the pixels, each multisampled;
- the thumbnail queue drew every template on after its dialog had closed.

## Decision

A frame draws what changed and reuses the rest:

- **Placed once**: the scene's world matrices are worked out once a frame (`placedOnce` in `components/Viewport.tsx`), not by each pass.
- **Shadows when their casters change**: the shadow map is drawn again only when a caster or a shadow-casting light moves, appears or changes look (`shadowKey`): not as the view turns round.
- **One depth, shared**: Watercolour writes the scene's depth with its paint (`gl_FragDepth`), and 3D's ambient occlusion reads the depth of the picture it shades; a depth pass that is still needed (Pixel, 3D, for the handles drawn over them) leaves the outlines out.
- **Nothing built per frame**: what is worked out from the scene (the surfaces to stand on) is kept by its content, not by the object holding it, since a scene as played is a new object each frame.
- **React at the pace of what it shows**: while playing, the timeline's rows are drawn again four times a second; the playhead and its readout, each frame, by themselves.
- **Pixels where they show**: the canvas uses up to two screen pixels per CSS pixel, and up to one and a half in the styles whose whole picture goes through a pass (Watercolour, 3D); it multisamples only below two (a high-density screen's own pixels are fine enough).
- **Work no one waits for is dropped**: a thumbnail whose grid has closed is not drawn.
- **Playback worked out ahead, on another thread**: while a scene plays, a worker (`lib/playahead.worker.ts`) works out where everything is for the second ahead of the playhead, on a grid of twice the scene's frame rate, and the page draws those frames (`lib/playahead.ts`). A frame not there yet (playback just started, an edit, a jump, no worker) is worked out on the page as before, on the same grid, so what is drawn is the same either way. The worker evaluates with the same code from the same scene and clips; only playback uses it, so scrubbing and editing stay immediate.

## Consequences

- A new pass asks "does it need the scene drawn again, or can it read what is drawn?" and draws the scene's depth at most once.
- Something new that casts a shadow must be visible to `shadowKey` (a mesh with `castShadow`, its matrix or its material's version), or its shadow will not follow it.
- Something new worked out from the scene each frame is cached by its content.
- A component that shows the playhead subscribes to the clock by itself, and does not make its parent render every frame.
