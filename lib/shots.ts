import type { Animation, CameraKey, Shot } from './types';

/*
 * Shots: cuts along an animation's timeline. Each shot runs from its start to the next shot's
 * start (or the end), is framed by the camera keys inside it, and can carry a caption. A shot
 * list can be cut for a target video model, whose clip length is the limit for each shot.
 */

export interface VideoModel {
  id: string;
  name: string;
  /** Longest clip the model generates in one go (seconds), as typically offered. */
  max: number;
}

/** Typical single-generation clip lengths; check your provider, these change often. */
export const VIDEO_MODELS: VideoModel[] = [
  { id: 'veo', name: 'Google Veo', max: 8 },
  { id: 'sora', name: 'OpenAI Sora', max: 12 },
  { id: 'kling', name: 'Kling', max: 10 },
  { id: 'runway', name: 'Runway', max: 10 },
  { id: 'seedance', name: 'Seedance', max: 10 },
  { id: 'hailuo', name: 'Hailuo', max: 10 },
  { id: 'luma', name: 'Luma Ray', max: 9 },
  { id: 'wan', name: 'Wan', max: 5 },
];

export function videoModel(id: string | undefined) {
  return VIDEO_MODELS.find((m) => m.id === id) ?? null;
}

export interface ShotSpan {
  shot: Shot;
  index: number;
  start: number;
  end: number;
}

/** The shots with their time ranges. An animation without cuts is one shot. */
export function shotSpans(a: Animation): ShotSpan[] {
  const shots = a.shots?.length ? a.shots : [{ id: 'main', start: 0, name: 'Shot 1' }];
  return shots.map((shot, index) => ({ shot, index, start: shot.start, end: shots[index + 1]?.start ?? a.duration }));
}

export function spanAt(a: Animation, t: number): ShotSpan {
  const spans = shotSpans(a);
  return spans.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6) ?? spans[spans.length - 1];
}

/** Camera keys that frame one shot. */
export function keysInShot(a: Animation, span: Pick<ShotSpan, 'start' | 'end'>): CameraKey[] {
  const last = span.end >= a.duration - 1e-6;
  return (a.camera?.keys ?? []).filter((k) => k.t >= span.start - 1e-6 && (k.t < span.end - 1e-6 || (last && k.t <= span.end + 1e-6)));
}

/** Shots longer than the target model allows. */
export function overLimit(a: Animation, span: ShotSpan) {
  const m = videoModel(a.target);
  return !!m && span.end - span.start > m.max + 1e-6;
}

let counter = 0;
const shotId = () => `sh${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Cut the shot under time t in two. `hold` is the camera at t, keyed at the new shot's start. */
export function cutAt(a: Animation, t: number, hold: CameraKey | null): Animation {
  const shots = a.shots?.length ? a.shots : [{ id: shotId(), start: 0, name: 'Shot 1' }];
  const tol = 0.5 / a.fps;
  if (t <= tol || t >= a.duration - tol || shots.some((s) => Math.abs(s.start - t) < tol)) return a;
  const next = [...shots, { id: shotId(), start: t, name: '' }].sort((p, q) => p.start - q.start).map((s, i) => ({ ...s, name: s.name && !/^Shot \d+$/.test(s.name) ? s.name : `Shot ${i + 1}` }));
  const camera = a.camera ?? { keys: [], follow: false, shake: 0 };
  // Both sides of the cut keep the framing they had: the earlier shot ends on it (a key just
  // before the cut) and the new one starts from it, until either gets its own camera keys.
  const end = Math.round((t - 0.001) * 1000) / 1000;
  const keys = hold
    ? [...camera.keys.filter((k) => Math.abs(k.t - t) >= tol), { ...hold, t: end }, { ...hold, t }].sort((p, q) => p.t - q.t)
    : camera.keys;
  return { ...a, shots: next, camera: { ...camera, keys } };
}

/** Remove a cut: the shot joins the one before it. */
export function removeCut(a: Animation, id: string): Animation {
  if (!a.shots) return a;
  const i = a.shots.findIndex((s) => s.id === id);
  if (i <= 0) return a;
  const shots = a.shots.filter((_, j) => j !== i).map((s, j) => ({ ...s, name: /^Shot \d+$/.test(s.name) ? `Shot ${j + 1}` : s.name }));
  return { ...a, shots };
}

export function updateShot(a: Animation, id: string, patch: Partial<Pick<Shot, 'name' | 'caption'>>): Animation {
  const shots = a.shots?.length ? a.shots : [{ id: 'main', start: 0, name: 'Shot 1' }];
  return { ...a, shots: shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}
