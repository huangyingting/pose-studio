import { frameAspect } from './cameras';
import { storyLength, type StoryShot } from './board';
import type { Pass } from './render';
import type { Style } from './types';
import { createEncoder, drawShot } from './video';

/*
 * The story's outputs: a board sheet (a numbered panel per shot, in the project's frame, with
 * captions underneath) and a video of every scene's shots in story order (captions as subtitles).
 */

export interface StoryOptions {
  style: Style;
  faces: boolean;
  /** Captions under the panels, or as subtitles. */
  captions: boolean;
  pass?: Pass;
}

/** Wrap text to lines that fit `width` (at most `max` lines, the last ellipsised). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= width) line = test;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    lines.length = max;
    let last = lines[max - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[max - 1] = `${last}…`;
  }
  return lines;
}

/** When a shot is drawn on its panel: once it has blended in, so it is its own camera's view. */
export const panelTime = (x: StoryShot) => (x.span ? Math.min(x.span.start + (x.span.shot.blend ?? 0), Math.max(x.span.start, x.span.end - 1e-3)) : 0);

/** What a panel says under it: the scene, the shot and its length. */
export const panelLabel = (x: StoryShot) => `${x.scene.name}${x.span ? ` · ${x.span.shot.name}` : ''} · ${x.length.toFixed(1)} s`;

/** A board sheet's layout: its panels (in the project's frame), and its size. */
export function boardSize(count: number, columns: number, captions: boolean) {
  const aspect = frameAspect();
  const cellW = aspect >= 1 ? 640 : 360;
  const cellH = Math.round(cellW / aspect);
  const cols = Math.max(1, Math.min(columns, count));
  const textH = captions ? 96 : 40;
  const gap = 28;
  const pad = 40;
  const rows = Math.max(1, Math.ceil(count / cols));
  return { cellW, cellH, cols, textH, gap, pad, width: pad * 2 + cols * cellW + (cols - 1) * gap, height: pad * 2 + rows * (cellH + textH) + (rows - 1) * gap };
}

export function boardSheet(shots: StoryShot[], o: StoryOptions & { columns: number }) {
  const { cellW, cellH, cols: columns, textH, gap, pad, width, height } = boardSize(shots.length, o.columns, o.captions);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  const frame = document.createElement('canvas');
  frame.width = cellW;
  frame.height = cellH;
  const fctx = frame.getContext('2d')!;
  shots.forEach((x, i) => {
    const left = pad + (i % columns) * (cellW + gap);
    const top = pad + Math.floor(i / columns) * (cellH + textH + gap);
    drawShot(fctx, x.scene, panelTime(x), { width: cellW, height: cellH, style: o.style, lineWidth: 1.8, faces: o.faces, pass: o.pass });
    ctx.drawImage(frame, left, top);
    ctx.strokeStyle = '#1d1d1f';
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 1, top + 1, cellW - 2, cellH - 2);
    ctx.fillStyle = '#1d1d1f';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(String(i + 1), left, top + cellH + 12);
    ctx.fillStyle = '#6b6b70';
    ctx.font = '500 16px system-ui, sans-serif';
    ctx.fillText(panelLabel(x), left + 36, top + cellH + 16, cellW - 36);
    if (o.captions && x.caption) {
      ctx.fillStyle = '#1d1d1f';
      ctx.font = '18px system-ui, sans-serif';
      wrap(ctx, x.caption, cellW, 2).forEach((l, j) => ctx.fillText(l, left, top + cellH + 44 + j * 24));
    }
  });
  return out;
}

/** The story as one video: every scene's shots in story order, a still scene held for its time. */
export async function recordStory(shots: StoryShot[], o: StoryOptions & { width: number; height: number; lineWidth: number }, onProgress?: (f: number) => void, signal?: AbortSignal) {
  const fps = 24;
  const enc = await createEncoder(o.width, o.height, fps);
  const total = storyLength(shots);
  let time = 0;
  const caption = (text: string) => {
    if (!o.captions || !text) return;
    const ctx = enc.ctx;
    const size = Math.round(o.height / 26);
    ctx.font = `500 ${size}px system-ui, sans-serif`;
    const lines = wrap(ctx, text, o.width * 0.8, 2);
    const h = lines.length * size * 1.35 + size * 0.8;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, o.height - h - size * 0.6, o.width, h);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((l, j) => ctx.fillText(l, o.width / 2, o.height - h - size * 0.2 + j * size * 1.35));
    ctx.textAlign = 'start';
  };
  const draw = { width: o.width, height: o.height, style: o.style, lineWidth: o.lineWidth, faces: o.faces, pass: o.pass };
  for (const x of shots) {
    if (signal?.aborted) break;
    if (!x.span) {
      // A still scene is one frame held for its time.
      drawShot(enc.ctx, x.scene, 0, draw);
      caption(x.caption);
      await enc.add(time, x.length);
      time += x.length;
      onProgress?.(time / total);
      continue;
    }
    const n = Math.max(1, Math.round(x.length * fps));
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) break;
      drawShot(enc.ctx, x.scene, x.span.start + i / fps, draw);
      caption(x.caption);
      await enc.add(time + i / fps, 1 / fps);
      onProgress?.((time + i / fps) / total);
    }
    time += n / fps;
  }
  if (signal?.aborted) {
    await enc.cancel();
    throw new Error('Cancelled');
  }
  return enc.finish();
}
