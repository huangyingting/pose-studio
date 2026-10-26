import { boardDuration } from './board';
import { framingFor } from './shot';
import type { Light, Panel, Scene, Style } from './types';
import { createEncoder, drawShot } from './video';

/*
 * Storyboard outputs: a board sheet (numbered 16:9 panels with captions underneath) and an
 * animatic (each panel on screen for its hold; animated poses play, captions as subtitles).
 */

export interface BoardOptions {
  style: Style;
  light: Light;
  faces: boolean;
  captions: boolean;
}

type Resolve = (p: Panel) => Scene | undefined;

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

export function boardSheet(panels: Panel[], resolve: Resolve, o: BoardOptions, columns = 3, cellW = 640) {
  const cellH = Math.round((cellW * 9) / 16);
  const textH = o.captions ? 96 : 40;
  const gap = 28;
  const pad = 40;
  const rows = Math.max(1, Math.ceil(panels.length / columns));
  const out = document.createElement('canvas');
  out.width = pad * 2 + columns * cellW + (columns - 1) * gap;
  out.height = pad * 2 + rows * (cellH + textH) + (rows - 1) * gap;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  const frame = document.createElement('canvas');
  frame.width = cellW;
  frame.height = cellH;
  const fctx = frame.getContext('2d')!;
  panels.forEach((p, i) => {
    const scene = resolve(p);
    const x = pad + (i % columns) * (cellW + gap);
    const y = pad + Math.floor(i / columns) * (cellH + textH + gap);
    if (scene) {
      drawShot(fctx, scene, 0, { width: cellW, height: cellH, style: o.style, lineWidth: 1.8, light: o.light, faces: o.faces }, framingFor(scene, 6));
      ctx.drawImage(frame, x, y);
    }
    ctx.strokeStyle = '#1d1d1f';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2);
    ctx.fillStyle = '#1d1d1f';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(String(i + 1), x, y + cellH + 12);
    ctx.fillStyle = '#6b6b70';
    ctx.font = '500 16px system-ui, sans-serif';
    const meta = `${scene?.name ?? ''} · ${p.hold.toFixed(1)} s`;
    ctx.fillText(meta, x + 36, y + cellH + 16, cellW - 36);
    if (o.captions && p.caption) {
      ctx.fillStyle = '#1d1d1f';
      ctx.font = '18px system-ui, sans-serif';
      wrap(ctx, p.caption, cellW, 2).forEach((l, j) => ctx.fillText(l, x, y + cellH + 44 + j * 24));
    }
  });
  return out;
}

/** The storyboard as a video: each panel for its hold, animated poses playing. */
export async function recordAnimatic(panels: Panel[], resolve: Resolve, o: BoardOptions & { width: number; height: number }, onProgress?: (f: number) => void, signal?: AbortSignal) {
  const fps = 24;
  const enc = await createEncoder(o.width, o.height, fps);
  const total = boardDuration(panels);
  let time = 0;
  const caption = (p: Panel) => {
    if (!o.captions || !p.caption) return;
    const ctx = enc.ctx;
    const size = Math.round(o.height / 26);
    ctx.font = `500 ${size}px system-ui, sans-serif`;
    const lines = wrap(ctx, p.caption, o.width * 0.8, 2);
    const h = lines.length * size * 1.35 + size * 0.8;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, o.height - h - size * 0.6, o.width, h);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((l, j) => ctx.fillText(l, o.width / 2, o.height - h - size * 0.2 + j * size * 1.35));
    ctx.textAlign = 'start';
  };
  for (const p of panels) {
    const scene = resolve(p);
    if (!scene) continue;
    const a = scene.animation;
    const framing = framingFor(scene, a ? 12 : 1);
    const opts = { width: o.width, height: o.height, style: o.style, lineWidth: 2.2 * (o.height / 640), light: o.light, faces: o.faces };
    if (!a) {
      // A still panel is one frame held for the whole duration.
      if (signal?.aborted) break;
      drawShot(enc.ctx, scene, 0, opts, framing);
      caption(p);
      await enc.add(time, p.hold);
      time += p.hold;
      onProgress?.(time / total);
      continue;
    }
    const n = Math.max(1, Math.round(p.hold * fps));
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) break;
      const local = a.loop ? (i / fps) % a.duration : Math.min(a.duration, i / fps);
      drawShot(enc.ctx, scene, local, opts, framing, i / fps);
      caption(p);
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
