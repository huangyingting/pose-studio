import { sceneAt } from './animation';
import { framingFor, shotAt } from './shot';
import { styleDef } from './styles';
import { sharedRenderer } from './thumbnails';
import type { Light, Scene, Style } from './types';

/*
 * Video export: film the animation through its shot camera and encode it frame by frame with
 * WebCodecs (via Mediabunny), each frame with an exact timestamp. Unlike recording a live
 * canvas, no frames are dropped on slow machines, and fast ones finish quicker than real time.
 * H.264 in MP4 where the browser can encode it, otherwise VP9/VP8 in WebM.
 */

export function videoSupported() {
  return typeof VideoEncoder !== 'undefined';
}

export interface VideoOptions {
  width: number;
  height: number;
  style: Style;
  lineWidth: number;
  loops: number;
  light: Light;
  faces: boolean;
}

export async function recordVideo(scene: Scene, o: VideoOptions, onProgress?: (fraction: number) => void, signal?: AbortSignal) {
  const a = scene.animation;
  if (!a) throw new Error('This pose has no animation');
  // Loaded on demand: only video export needs it.
  const mb = await import('mediabunny');
  const quality = new mb.Quality('high');
  const size = { width: o.width, height: o.height, quality };
  const codec = (await mb.canEncodeVideo('avc', size)) ? 'avc' : await mb.getFirstEncodableVideoCodec(['vp9', 'vp8'], size);
  if (!codec) throw new Error('This browser cannot encode video');
  const format = codec === 'avc' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat();
  const output = new mb.Output({ format, target: new mb.BufferTarget() });

  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d')!;
  const source = new mb.CanvasSource(canvas, { codec, quality });
  output.addVideoTrack(source, { frameRate: a.fps });
  await output.start();

  const renderer = sharedRenderer();
  const frame = framingFor(scene);
  const cam = a.camera;
  const perLoop = Math.max(1, Math.round(a.duration * a.fps));
  const total = perLoop * o.loops + (a.loop ? 0 : 1);
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      await output.cancel();
      throw new Error('Cancelled');
    }
    const t = a.loop ? (i % perLoop) / a.fps : Math.min(a.duration, (i % (perLoop + 1)) / a.fps);
    const src = renderer.renderShot(sceneAt(scene, t), o.width, o.height, o.lineWidth, {
      style: o.style, light: o.light, faces: o.faces, shot: { ...shotAt(scene, t), t: i / a.fps }, framing: frame, follow: !!cam?.follow, shake: cam?.shake ?? 0,
    });
    ctx.fillStyle = styleDef(o.style).background;
    ctx.fillRect(0, 0, o.width, o.height);
    ctx.drawImage(src, 0, 0);
    await source.add(i / a.fps, 1 / a.fps);
    onProgress?.((i + 1) / total);
  }
  await output.finalize();
  return { blob: new Blob([output.target.buffer!], { type: format.mimeType }), ext: format.fileExtension.replace('.', '') };
}
