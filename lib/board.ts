import { shotSpans, type ShotSpan } from './shots';
import { uid } from './uid';
import type { Library, Panel, Scene } from './types';

/*
 * The story: the project's scenes in story order (Library.board). An animated scene shows as its
 * shots, each through its own camera with its caption and length; a still scene as one panel
 * through its first camera, with its caption, on screen for its hold time. The board shows the
 * story shot by shot, and it is exported (lib/boardExport.ts) as a board sheet, a video and a
 * keyframe pack.
 */

export const DEFAULT_HOLD = 2;

/** Panels whose pose still exists, in order. */
export function boardPanels(lib: Library): Panel[] {
  const ids = new Set(lib.scenes.map((s) => s.id));
  return (lib.board ?? []).filter((p) => ids.has(p.sceneId));
}

export function withBoard(lib: Library, board: Panel[]): Library {
  return { ...lib, board };
}

export function newPanel(sceneId: string, hold = DEFAULT_HOLD): Panel {
  return { id: uid('b'), sceneId, hold };
}

export function insertPanel(board: Panel[], panel: Panel, at = board.length): Panel[] {
  return [...board.slice(0, at), panel, ...board.slice(at)];
}

export function movePanel(board: Panel[], from: number, to: number): Panel[] {
  if (from === to || from < 0 || to < 0 || from >= board.length || to >= board.length) return board;
  const next = [...board];
  const [p] = next.splice(from, 1);
  next.splice(to, 0, p);
  return next;
}

/** One shot of the story: a span of an animated scene, or a still scene held for its panel's time. */
export interface StoryShot {
  panel: Panel;
  scene: Scene;
  /** The shot's span of the scene's animation (null: a still scene). */
  span: ShotSpan | null;
  /** Seconds on screen. */
  length: number;
  caption: string;
}

/** A scene as the story shows it: its shots, or itself held for `panel.hold`. */
export function sceneShots(scene: Scene, panel: Panel = newPanel(scene.id)): StoryShot[] {
  const a = scene.animation;
  if (!a) return [{ panel, scene, span: null, length: panel.hold, caption: scene.caption ?? '' }];
  return shotSpans(a).map((span) => ({ panel, scene, span, length: span.end - span.start, caption: span.shot.caption ?? '' }));
}

/** The whole story, shot by shot. */
export function storyShots(lib: Library): StoryShot[] {
  const scenes = new Map(lib.scenes.map((s) => [s.id, s]));
  return boardPanels(lib).flatMap((p) => sceneShots(scenes.get(p.sceneId)!, p));
}

export const storyLength = (shots: StoryShot[]) => shots.reduce((sum, x) => sum + x.length, 0);

/** Validate panels from storage or a file, keeping only those whose pose exists. */
export function parseBoard(v: unknown, sceneIds: Set<string>): Panel[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const panels: Panel[] = [];
  for (const x of v.slice(0, 500)) {
    if (typeof x !== 'object' || x === null) continue;
    const o = x as Record<string, unknown>;
    if (typeof o.sceneId !== 'string' || !sceneIds.has(o.sceneId)) continue;
    panels.push({
      id: typeof o.id === 'string' && o.id.length <= 40 ? o.id : uid('b'),
      sceneId: o.sceneId,
      hold: typeof o.hold === 'number' && Number.isFinite(o.hold) ? Math.min(60, Math.max(0.2, o.hold)) : DEFAULT_HOLD,
    });
  }
  return panels.length ? panels : undefined;
}
