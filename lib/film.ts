import { FRAME_SHAPES, STYLES, type Film, type FrameShape, type Library, type Style } from './types';

/*
 * The film the project is (Library.film): its frame shape, the video model it is cut for and its
 * look (its render style). Set once for the project; the canvas, exports, the
 * storyboard and the shot length checks all follow it. The open project's film is kept at hand
 * here (the store sets it), as the imported characters are (lib/model.ts).
 */

export const DEFAULT_FILM: Film = { frame: '16:9', style: 'line' };

let current: Film = DEFAULT_FILM;

/** The open project's film. */
export const film = (): Film => current;

export function setFilm(f: Film | undefined) {
  current = f ?? DEFAULT_FILM;
}

export const filmOf = (lib: Library): Film => lib.film ?? DEFAULT_FILM;

/** A film from storage or a file. */
export function parseFilm(v: unknown): Film | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  return {
    frame: FRAME_SHAPES.includes(o.frame as FrameShape) ? (o.frame as FrameShape) : '16:9',
    ...(typeof o.target === 'string' && o.target ? { target: o.target.slice(0, 40) } : {}),
    style: STYLES.includes(o.style as Style) ? (o.style as Style) : 'line',
  };
}
