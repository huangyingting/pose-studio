import { sceneAt } from './evaluate';
import { cameraAt } from './cameras';
import { styleDef } from './styles';
import { sharedRenderer, videoRenderer } from './thumbnails';
import type { Pass } from './render';
import { mixdown, segmentsOf, type Window } from './sound';
import type { Scene, SoundInfo, Style } from './types';

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
interface Encoder {
  ctx: CanvasRenderingContext2D;
  add(time: number, duration: number): Promise<void>;
  finish(): Promise<{ blob: Blob; ext: string }>;
  cancel(): Promise<void>;
}

/** An encoder for a video of this size and rate, carrying `audio` from its start (#35) where the browser can encode it. */
export async function createEncoder(width: number, height: number, fps: number, audio: AudioBuffer | null = null): Promise<Encoder> {
  // Loaded on demand: only video export needs it.
  const mb = await import('mediabunny');
  const quality = new mb.Quality('high');
  const size = { width, height, quality };
  // (With a sound: MP4 where its AAC can be made, else WebM with Opus, else MP4 without the sound.)
  const heard = audio ? { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate } : null;
  const aac = !!heard && (await mb.canEncodeAudio('aac', heard));
  const opus = !!heard && (await mb.canEncodeAudio('opus', heard));
  const avc = await mb.canEncodeVideo('avc', size);
  const codec = avc && (!heard || aac || !opus) ? 'avc' : (await mb.getFirstEncodableVideoCodec(['vp9', 'vp8'], size)) ?? (avc ? 'avc' : null);
  if (!codec) throw new Error('This browser cannot encode video');
  const format = codec === 'avc' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat();
  const output = new mb.Output({ format, target: new mb.BufferTarget() });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const source = new mb.CanvasSource(canvas, { codec, quality });
  output.addVideoTrack(source, { frameRate: fps });
  // (The sound in the codec the container takes: AAC in MP4, Opus in WebM.)
  const audioCodec = codec === 'avc' ? (aac ? 'aac' : null) : opus ? 'opus' : null;
  const sound = audio && audioCodec ? new mb.AudioBufferSource({ codec: audioCodec, quality }) : null;
  if (sound) output.addAudioTrack(sound);
  await output.start();
  if (sound && audio) {
    await sound.add(audio);
    sound.close();
  }
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

interface VideoOptions {
  width: number;
  height: number;
  style: Style;
  lineWidth: number;
  loops: number;
  pass?: Pass;
  /** Only this part of the animation (seconds), played once: e.g. one shot. */
  range?: [number, number];
  /** The lines said shown as subtitles (a video's; not a board's panels). */
  subtitles?: boolean;
  /** The scene's sound, as the library lists it (#35): carried in the video. */
  sound?: SoundInfo;
}

/** Draw one frame of a scene through its shot camera at time t (with the line said then as its subtitle, if asked). */
export function drawShot(ctx: CanvasRenderingContext2D, scene: Scene, t: number, o: Omit<VideoOptions, 'loops' | 'range'>, renderer = sharedRenderer()) {
  const src = renderer.renderShot(sceneAt(scene, t, true), o.width, o.height, o.lineWidth, {
    style: o.style, pass: o.pass, camera: cameraAt(scene, t, o.width / o.height),
  });
  ctx.fillStyle = styleDef(o.style).background;
  ctx.fillRect(0, 0, o.width, o.height);
  ctx.drawImage(src, 0, 0);
  const line = o.subtitles ? lineAt(scene, t) : null;
  if (line) drawSubtitle(ctx, line, o.width, o.height);
}

/** The line of dialogue said at t (the last begun, if two overlap), if any. */
export function lineAt(scene: Scene, t: number): string | null {
  const said = (scene.animation?.actions ?? []).filter((x) => x.say && !x.layer && x.start <= t + 1e-6 && t < x.start + x.duration - 1e-6);
  return said.sort((p, q) => q.start - p.start)[0]?.say ?? null;
}

/** A subtitle at the bottom of a frame: white on a dark band, two lines at most. */
export function drawSubtitle(ctx: CanvasRenderingContext2D, text: string, width: number, height: number) {
  const size = Math.round(height / 26);
  ctx.font = `500 ${size}px system-ui, sans-serif`;
  const lines = wrap(ctx, text, width * 0.8, 2);
  const h = lines.length * size * 1.35 + size * 0.8;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, height - h - size * 0.6, width, h);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, j) => ctx.fillText(l, width / 2, height - h - size * 0.2 + j * size * 1.35));
  ctx.textAlign = 'start';
}

/** Wrap text to lines that fit `width` (at most `max` lines, the last ellipsised). */
export function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number) {
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

export async function recordVideo(scene: Scene, o: VideoOptions, onProgress?: (fraction: number) => void, signal?: AbortSignal) {
  const a = scene.animation;
  if (!a) throw new Error('This pose has no animation');
  const perLoop = Math.max(1, Math.round(a.duration * a.fps));
  const [r0, r1] = o.range ?? [0, a.duration];
  // (One that does not go round plays through to its last pose each time: a frame more each play.)
  const total = o.range ? Math.max(1, Math.round((r1 - r0) * a.fps)) : a.loop ? perLoop * o.loops : (perLoop + 1) * o.loops;
  // Its sound under each play of it (#35).
  const pass = (a.loop ? perLoop : perLoop + 1) / a.fps;
  const windows: Window[] = o.range ? [{ t0: r0, t1: r1, at: 0 }] : Array.from({ length: o.loops }, (_, k) => ({ t0: 0, t1: a.duration, at: k * pass }));
  const audio = o.sound ? await mixdown(segmentsOf(scene, o.sound, windows), total / a.fps) : null;
  const enc = await createEncoder(o.width, o.height, a.fps, audio);
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      await enc.cancel();
      throw new Error('Cancelled');
    }
    const t = o.range ? r0 + i / a.fps : a.loop ? (i % perLoop) / a.fps : Math.min(a.duration, (i % (perLoop + 1)) / a.fps);
    drawShot(enc.ctx, scene, t, { ...o, subtitles: true }, videoRenderer());
    await enc.add(i / a.fps, 1 / a.fps);
    onProgress?.((i + 1) / total);
  }
  return enc.finish();
}
