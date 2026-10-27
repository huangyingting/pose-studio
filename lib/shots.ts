import type { Animation, CameraPoint, Shot } from './types';

/*
 * Shots: the camera's track, cut along an animation's timeline. Each shot runs from its start to
 * the next shot's start (or the end), films with its own camera path (lib/shot.ts) and can carry
 * a caption. A shot list can be cut for a target video model, whose clip length is the limit for
 * each shot. Path points are kept in time from their shot's start.
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

/** A new shot from `start`: no path yet (the still camera's view of everyone). */
export const newShot = (start: number, name: string, id = shotId()): Shot => ({ id, start, name, anchor: 'world', aim: 'subject', points: [] });

const shotsOf = (a: Animation) => (a.shots?.length ? a.shots : [newShot(0, 'Shot 1', 'main')]);

/** The shots with their time ranges. An animation without cuts is one shot. */
export function shotSpans(a: Animation): ShotSpan[] {
  const shots = shotsOf(a);
  return shots.map((shot, index) => ({ shot, index, start: shot.start, end: shots[index + 1]?.start ?? a.duration }));
}

export function spanAt(a: Animation, t: number): ShotSpan {
  const spans = shotSpans(a);
  return spans.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6) ?? spans[spans.length - 1];
}

/** Shots longer than the target model allows. */
export function overLimit(a: Animation, span: ShotSpan) {
  const m = videoModel(a.target);
  return !!m && span.end - span.start > m.max + 1e-6;
}

let counter = 0;
function shotId() {
  return `sh${Date.now().toString(36)}${(counter++).toString(36)}`;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const renamed = (shots: Shot[]) => shots.map((s, i) => ({ ...s, name: s.name && !/^Shot \d+$/.test(s.name) ? s.name : `Shot ${i + 1}` }));

/**
 * Cut the shot under time t in two. Both keep filming as they did: the earlier one ends where its
 * path was at the cut (`hold`: that point, from the earlier shot's start), the later one starts
 * from there with the rest of the path.
 */
export function cutAt(a: Animation, t: number, hold: CameraPoint | null): Animation {
  const shots = shotsOf(a);
  const tol = 0.5 / a.fps;
  if (t <= tol || t >= a.duration - tol || shots.some((s) => Math.abs(s.start - t) < tol)) return a;
  const i = shots.findIndex((s, k) => t > s.start && (k === shots.length - 1 || t < shots[k + 1].start));
  const old = shots[i];
  const u = t - old.start;
  const before = old.points.filter((p) => p.t < u - tol);
  const after = old.points.filter((p) => p.t > u + tol).map((p) => ({ ...p, t: r3(p.t - u) }));
  const first = { ...old, id: old.id === 'main' ? shotId() : old.id, points: hold && old.points.length ? [...before, { ...hold, t: r3(u) }] : before };
  const { caption: _caption, ...rest } = old;
  void _caption;
  const second: Shot = { ...rest, id: shotId(), start: t, name: '', points: hold && old.points.length ? [{ ...hold, t: 0 }, ...after] : after };
  return { ...a, shots: renamed([...shots.slice(0, i), first, second, ...shots.slice(i + 1)]) };
}

/** Remove a cut: the shot joins the one before it (with its path after that one's). */
export function removeCut(a: Animation, id: string): Animation {
  if (!a.shots) return a;
  const i = a.shots.findIndex((s) => s.id === id);
  if (i <= 0) return a;
  const prev = a.shots[i - 1];
  const gone = a.shots[i];
  const off = gone.start - prev.start;
  const points = [...prev.points.filter((p) => p.t < off - 1e-6), ...gone.points.map((p) => ({ ...p, t: r3(p.t + off) }))];
  const shots = a.shots.flatMap((s, j) => (j === i ? [] : j === i - 1 ? [{ ...s, points }] : [s]));
  return { ...a, shots: renamed(shots) };
}

export function updateShot(a: Animation, id: string, patch: Partial<Omit<Shot, 'id' | 'start'>>): Animation {
  return { ...a, shots: shotsOf(a).map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/* ---------- path points ---------- */

/** The shot playing at t, with t from its start. */
function at(a: Animation, t: number) {
  const span = spanAt(a, t);
  return { shot: span.shot, u: r3(t - span.start) };
}

/** Put a path point at time t (in the shot playing then), replacing one within half a frame. */
export function setPointAt(a: Animation, t: number, point: Omit<CameraPoint, 't'>): Animation {
  const { shot, u } = at(a, t);
  const points = [...shot.points.filter((p) => Math.abs(p.t - u) >= 0.5 / a.fps), { ...point, t: u }].sort((p, q) => p.t - q.t);
  return updateShot(a, shot.id, { points });
}

/** Remove the path point at time t. */
export function removePointAt(a: Animation, t: number): Animation {
  const { shot, u } = at(a, t);
  return updateShot(a, shot.id, { points: shot.points.filter((p) => Math.abs(p.t - u) >= 0.5 / a.fps) });
}

/** Retime the path point at `from` to `to` (within its shot; not onto another point). */
export function movePoint(a: Animation, from: number, to: number): Animation {
  const span = spanAt(a, from);
  const u = from - span.start;
  const v = r3(Math.min(span.end, Math.max(span.start, to)) - span.start);
  const tol = 0.5 / a.fps;
  if (span.shot.points.some((p) => Math.abs(p.t - v) < tol && Math.abs(p.t - u) >= tol)) return a;
  const points = span.shot.points.map((p) => (Math.abs(p.t - u) < tol ? { ...p, t: v } : p)).sort((p, q) => p.t - q.t);
  return updateShot(a, span.shot.id, { points });
}

/** Path point times in the animation's time (all shots). */
export function pointTimes(a: Animation): number[] {
  return shotSpans(a).flatMap((sp) => sp.shot.points.map((p) => r3(sp.start + p.t)));
}
