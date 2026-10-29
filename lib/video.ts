import { sceneAt } from './evaluate';
import { cameraAt } from './cameras';
import { styleDef } from './styles';
import { sharedRenderer, videoRenderer } from './thumbnails';
import type { Pass } from './render';
import type { Scene, Style } from './types';

/*
 * Video export: film the animation through its shot camera and encode it frame by frame with
 * WebCodecs (via Mediabunny), each frame with an exact timestamp. Unlike recording a live
 * canvas, no frames are dropped on slow machines, and fast ones finish quicker than real time.
 * H.264 in MP4 where the browser can encode it, otherwise VP9/VP8 in WebM.
 */

export function videoSupported() {
  return typeof VideoEncoder !== 'undefined';
}

/** A video being written: draw on `ctx`, then `add` the frame with its time and duration. */
export interface Encoder {
  ctx: CanvasRenderingContext2D;
  add(time: number, duration: number): Promise<void>;
  finish(): Promise<{ blob: Blob; ext: string }>;
  cancel(): Promise<void>;
}

export async function createEncoder(width: number, height: number, fps: number): Promise<Encoder> {
  // Loaded on demand: only video export needs it.
  const mb = await import('mediabunny');
  const quality = new mb.Quality('high');
  const size = { width, height, quality };
  const codec = (await mb.canEncodeVideo('avc', size)) ? 'avc' : await mb.getFirstEncodableVideoCodec(['vp9', 'vp8'], size);
  if (!codec) throw new Error('This browser cannot encode video');
  const format = codec === 'avc' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat();
  const output = new mb.Output({ format, target: new mb.BufferTarget() });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const source = new mb.CanvasSource(canvas, { codec, quality });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  return {
    ctx,
    add: (time, duration) => source.add(time, duration),
    finish: async () => {
      await output.finalize();
      return { blob: new Blob([output.target.buffer!], { type: format.mimeType }), ext: format.fileExtension.replace('.', '') };
    },
    cancel: () => output.cancel(),
  };
}

export interface VideoOptions {
  width: number;
  height: number;
  style: Style;
  lineWidth: number;
  loops: number;
  pass?: Pass;
  /** Only this part of the animation (seconds), played once: e.g. one shot. */
  range?: [number, number];
}

/** Draw one frame of a scene through its shot camera at time t. */
export function drawShot(ctx: CanvasRenderingContext2D, scene: Scene, t: number, o: Omit<VideoOptions, 'loops' | 'range'>, renderer = sharedRenderer()) {
  const src = renderer.renderShot(sceneAt(scene, t, true), o.width, o.height, o.lineWidth, {
    style: o.style, pass: o.pass, camera: cameraAt(scene, t, o.width / o.height),
  });
  ctx.fillStyle = styleDef(o.style).background;
  ctx.fillRect(0, 0, o.width, o.height);
  ctx.drawImage(src, 0, 0);
}

export async function recordVideo(scene: Scene, o: VideoOptions, onProgress?: (fraction: number) => void, signal?: AbortSignal) {
  const a = scene.animation;
  if (!a) throw new Error('This pose has no animation');
  const enc = await createEncoder(o.width, o.height, a.fps);
  const perLoop = Math.max(1, Math.round(a.duration * a.fps));
  const [r0, r1] = o.range ?? [0, a.duration];
  const total = o.range ? Math.max(1, Math.round((r1 - r0) * a.fps)) : perLoop * o.loops + (a.loop ? 0 : 1);
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      await enc.cancel();
      throw new Error('Cancelled');
    }
    const t = o.range ? r0 + i / a.fps : a.loop ? (i % perLoop) / a.fps : Math.min(a.duration, (i % (perLoop + 1)) / a.fps);
    drawShot(enc.ctx, scene, t, o, videoRenderer());
    await enc.add(i / a.fps, 1 / a.fps);
    onProgress?.((i + 1) / total);
  }
  return enc.finish();
}
