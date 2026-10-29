import { FRAME_SHAPES, STYLES, type ProjectSettings, type FrameShape, type Library, type Style } from './types';

/*
 * The project's settings (Library.settings): its frame shape and its render style, both in the top
 * bar. The canvas, the storyboard and every export follow them. The open project's are kept at
 * hand here (the store sets them), as the imported characters are (lib/model.ts).
 */

/** Each frame shape as said in the top bar's menu. */
export const FRAME_LABELS: Record<FrameShape, string> = { '16:9': '16:9 widescreen', '9:16': '9:16 vertical', '1:1': '1:1 square', '2.39:1': '2.39:1 cinemascope' };

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { frame: '16:9', style: 'line' };

let current: ProjectSettings = DEFAULT_PROJECT_SETTINGS;

/** The open project's settings. */
export const projectSettings = (): ProjectSettings => current;

export function setProjectSettings(f: ProjectSettings | undefined) {
  current = f ?? DEFAULT_PROJECT_SETTINGS;
}

export const projectSettingsOf = (lib: Library): ProjectSettings => lib.settings ?? DEFAULT_PROJECT_SETTINGS;

/** Project settings from storage or a file. */
export function parseProjectSettings(v: unknown): ProjectSettings | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  return {
    frame: FRAME_SHAPES.includes(o.frame as FrameShape) ? (o.frame as FrameShape) : '16:9',
    style: STYLES.includes(o.style as Style) ? (o.style as Style) : 'line',
  };
}
