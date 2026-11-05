import { loadSoundFile, saveSoundFile } from './assetstore';
import { uid } from './uid';
import type { Scene, SceneSound, SoundInfo } from './types';

/*
 * A scene's sound (#35): one of the library's sounds (an imported WAV, MP3, OGG or M4A, its file
 * kept as an asset), placed on the scene's timeline: where it starts, the part of it played, how
 * loud. Heard as the scene plays (components/soundplay.ts) and mixed into its videos here.
 */

/** The audio files a sound is imported from. */
export const SOUND_FILES = '.wav,.mp3,.ogg,.oga,.opus,.m4a,.aac,.flac,audio/*';

/** How many stretches a sound's waveform is kept in (the peaks its timeline row draws). */
const PEAKS = 600;

/** The part of a sound a scene plays (seconds of it): all of it unless trimmed. */
export function playedPart(sound: SceneSound, info: Pick<SoundInfo, 'duration'>): { from: number; to: number } {
  const from = Math.min(sound.from ?? 0, info.duration);
  return { from, to: Math.max(from, Math.min(sound.to ?? info.duration, info.duration)) };
}

/** Where a scene's sound is on its timeline: from where to where, and the second of it played first. */
export function soundSpan(sound: SceneSound, info: Pick<SoundInfo, 'duration'>): { t0: number; t1: number; from: number } {
  const { from, to } = playedPart(sound, info);
  return { t0: sound.start, t1: sound.start + to - from, from };
}

/**
 * Its beats on the timeline (where drags snap, #22): the louder peaks of the part played (well over
 * its usual level, at most a few a second), between its start and end.
 */
export function soundBeats(sound: SceneSound, info: SoundInfo): number[] {
  const { t0, t1, from } = soundSpan(sound, info);
  const n = info.peaks.length;
  if (!n || info.duration <= 0) return [t0, t1];
  const step = info.duration / n;
  const sorted = [...info.peaks].sort((a, b) => a - b);
  const loud = Math.max(20, sorted[Math.floor(n * 0.85)]);
  const out = [t0, t1];
  let lastBeat = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const p = info.peaks[i];
    if (p < loud || p < info.peaks[i - 1] || p < info.peaks[i + 1]) continue;
    const t = t0 + (i + 0.5) * step - from;
    if (t <= t0 || t >= t1 || t - lastBeat < 0.25) continue;
    out.push(Math.round(t * 1000) / 1000);
    lastBeat = t;
  }
  return out;
}

/** A stretch of a sound heard: at `at` seconds into what is made, `length` seconds of it from `from`, so loud. */
interface SoundSegment {
  id: string;
  at: number;
  from: number;
  length: number;
  volume: number;
}

/** What of a scene's sound is heard over its timeline's t0 to t1 (`at` counted from t0); none if it is muted or not there. */
export function soundSegment(scene: Pick<Scene, 'sound'>, info: Pick<SoundInfo, 'duration'> | undefined, t0: number, t1: number): SoundSegment | null {
  const s = scene.sound;
  if (!s || s.muted || !info) return null;
  const span = soundSpan(s, info);
  const a = Math.max(t0, span.t0);
  const b = Math.min(t1, span.t1);
  if (b - a <= 1e-6) return null;
  return { id: s.id, at: a - t0, from: span.from + (a - span.t0), length: b - a, volume: s.volume ?? 1 };
}

/** A stretch of a scene's timeline put into a video: its t0 to t1, at `at` seconds into the video. */
export interface Window {
  t0: number;
  t1: number;
  at: number;
}

/** What of a scene's sound a video made of these windows of it carries. */
export function segmentsOf(scene: Pick<Scene, 'sound'>, info: Pick<SoundInfo, 'duration'> | undefined, windows: Window[]): SoundSegment[] {
  return windows.flatMap((w) => {
    const seg = soundSegment(scene, info, w.t0, w.t1);
    return seg ? [{ ...seg, at: Math.round((seg.at + w.at) * 1e6) / 1e6 }] : [];
  });
}

/** What a sound's file is, by how it begins: its extension. */
export function soundExt(data: ArrayBuffer): string {
  const b = new Uint8Array(data.slice(0, 12));
  const text = String.fromCharCode(...b);
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE') return 'wav';
  if (text.startsWith('OggS')) return 'ogg';
  if (text.startsWith('fLaC')) return 'flac';
  if (text.slice(4, 8) === 'ftyp') return 'm4a';
  return 'mp3';
}

/*
 * In the browser: reading a sound's file, and mixing what a video carries.
 */

let ctx: AudioContext | null = null;
/** The page's audio (one for all: browsers allow few). */
export const audioContext = () => (ctx ??= new AudioContext());

const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** A sound's samples, read once (null: its file is not here, or not one this browser can read). */
export function soundBuffer(id: string): Promise<AudioBuffer | null> {
  let b = buffers.get(id);
  if (!b) {
    b = loadSoundFile(id).then((data) => (data ? audioContext().decodeAudioData(data.slice(0)) : null)).catch(() => null);
    buffers.set(id, b);
  }
  return b;
}

/** An audio file read: what the library lists of it (its length, its waveform). Throws if it is not sound this browser can read. */
async function readSound(name: string, data: ArrayBuffer): Promise<SoundInfo> {
  let buf: AudioBuffer;
  try {
    buf = await audioContext().decodeAudioData(data.slice(0));
  } catch {
    throw new Error(`${name} is not a sound this browser can read`);
  }
  const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const per = Math.max(1, Math.floor(buf.length / PEAKS));
  const peaks: number[] = [];
  for (let i = 0; i < buf.length; i += per) {
    let top = 0;
    for (const ch of channels) for (let j = i; j < Math.min(buf.length, i + per); j++) top = Math.max(top, Math.abs(ch[j]));
    peaks.push(Math.round(Math.min(1, top) * 100));
  }
  return { id: uid('snd'), name: name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Sound', duration: Math.round(buf.duration * 1000) / 1000, peaks };
}

/** An audio file imported: read (its length, its waveform), and its file kept as an asset. */
export async function importSound(file: File): Promise<SoundInfo> {
  const data = await file.arrayBuffer();
  const info = await readSound(file.name, data);
  await saveSoundFile(info.id, data);
  return info;
}

/** These stretches of sound mixed into one `seconds` long (a video's audio track); null if there is none to hear. */
export async function mixdown(segments: SoundSegment[], seconds: number): Promise<AudioBuffer | null> {
  const rate = 48000;
  const heard = (await Promise.all(segments.map(async (s) => ({ s, buf: await soundBuffer(s.id) })))).filter((x) => x.buf);
  if (!heard.length || seconds <= 0) return null;
  const off = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * rate)), rate);
  for (const { s, buf } of heard) {
    const src = off.createBufferSource();
    src.buffer = buf;
    const gain = off.createGain();
    gain.gain.value = s.volume;
    src.connect(gain).connect(off.destination);
    src.start(s.at, s.from, s.length);
  }
  return off.startRendering();
}
