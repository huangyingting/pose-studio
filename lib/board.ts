import { uid } from './uid';
import type { Library, Panel } from './types';

/*
 * Storyboard: a sequence of panels, each showing one pose of the library with a caption and
 * a hold time. Exported as a board sheet (panels with numbers and captions) or an animatic
 * (each panel held on screen; animated poses play).
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

export function boardDuration(board: Panel[]) {
  return board.reduce((sum, p) => sum + p.hold, 0);
}

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
      ...(typeof o.caption === 'string' && o.caption ? { caption: o.caption.slice(0, 500) } : {}),
    });
  }
  return panels.length ? panels : undefined;
}
