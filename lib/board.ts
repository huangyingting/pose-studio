import { shotSpans, type ShotSpan } from './shots';
import type { Library, Scene } from './types';

/*
 * The story: the project's scenes in the scene list's order, but those left out of it
 * (Scene.offStory). An animated scene shows as its shots, each through its own camera with its
 * caption and length; a still scene as one panel through its first camera, with its caption, on
 * screen for its hold time. The storyboard shows the story shot by shot, and it is exported
 * (lib/boardExport.ts) as a storyboard image, a storyboard video and a keyframe pack.
 */

export const DEFAULT_HOLD = 2;

/** The scenes in the story, in order. */
export const storyScenes = (lib: Library) => lib.scenes.filter((s) => !s.offStory);

/** One shot of the story: a span of an animated scene, or a still scene held for its time. */
export interface StoryShot {
  scene: Scene;
  /** The shot's span of the scene's animation (null: a still scene). */
  span: ShotSpan | null;
  /** Seconds on screen. */
  length: number;
  caption: string;
}

/** A scene as the story shows it: its shots, or itself held for its time. */
export function sceneShots(scene: Scene): StoryShot[] {
  const a = scene.animation;
  if (!a) return [{ scene, span: null, length: scene.hold ?? DEFAULT_HOLD, caption: scene.caption ?? '' }];
  return shotSpans(a).map((span) => ({ scene, span, length: span.end - span.start, caption: span.shot.caption ?? '' }));
}

/** The whole story, shot by shot. */
export const storyShots = (lib: Library): StoryShot[] => storyScenes(lib).flatMap(sceneShots);

export const storyLength = (shots: StoryShot[]) => shots.reduce((sum, x) => sum + x.length, 0);
