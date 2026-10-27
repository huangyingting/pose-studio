import type { Animation, Camera, CameraPoint, Shot } from './types';

/*
 * Shots: the cuts along an animation's timeline. Each shot runs from its start to the next shot's
 * start (or the end), films with one of the animation's cameras (lib/cameras.ts), cutting or blending
 * in from the one before, and can carry a caption. A shot list can be cut for a target video
 * model, whose clip length is the limit for each shot. Cameras' path points are in the
 * animation's time: cutting between cameras leaves their paths as they are.
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

/** A new shot from `start`: no camera yet (the still camera's view of everyone). */
export const newShot = (start: number, name: string, id = uid('sh')): Shot => ({ id, start, name });

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
function uid(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const renamed = (shots: Shot[]) => shots.map((s, i) => ({ ...s, name: s.name && !/^Shot \d+$/.test(s.name) ? s.name : `Shot ${i + 1}` }));

/** Cut the shot under time t in two: the later one films with the same camera, until it is given another. */
export function cutAt(a: Animation, t: number): Animation {
  const shots = shotsOf(a);
  const tol = 0.5 / a.fps;
  if (t <= tol || t >= a.duration - tol || shots.some((s) => Math.abs(s.start - t) < tol)) return a;
  const i = shots.findIndex((s, k) => t > s.start && (k === shots.length - 1 || t < shots[k + 1].start));
  const old = shots[i];
  const first = { ...old, id: old.id === 'main' ? uid('sh') : old.id };
  const second: Shot = { id: uid('sh'), start: t, name: '', ...(old.camera ? { camera: old.camera } : {}) };
  return { ...a, shots: renamed([...shots.slice(0, i), first, second, ...shots.slice(i + 1)]) };
}

/** Remove a cut: the shot before it runs on over its time. */
export function removeCut(a: Animation, id: string): Animation {
  if (!a.shots) return a;
  const i = a.shots.findIndex((s) => s.id === id);
  if (i <= 0) return a;
  return { ...a, shots: renamed(a.shots.filter((_, j) => j !== i)) };
}

export function updateShot(a: Animation, id: string, patch: Partial<Omit<Shot, 'id' | 'start'>>): Animation {
  return { ...a, shots: shotsOf(a).map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/* ---------- cameras ---------- */

/** A new camera for an animation, named after the ones it has: fixed in the world, looking at its subject, no path yet. */
export function newCamera(a: Animation, patch: Partial<Camera> = {}): Camera {
  const names = new Set((a.cameras ?? []).map((c) => c.name));
  let n = 1;
  while (names.has(`Camera ${n}`)) n++;
  return { id: uid('cam'), name: `Camera ${n}`, anchor: 'world', aim: 'subject', points: [], ...patch };
}

export function updateCamera(a: Animation, id: string, patch: Partial<Omit<Camera, 'id'>>): Animation {
  return { ...a, cameras: (a.cameras ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** Remove a camera: the shots it filmed are filmed by the still camera. */
export function removeCamera(a: Animation, id: string): Animation {
  const shots = a.shots?.map((s) => {
    if (s.camera !== id) return s;
    const { camera: _camera, ...rest } = s;
    void _camera;
    return rest;
  });
  return { ...a, cameras: (a.cameras ?? []).filter((c) => c.id !== id), ...(shots ? { shots } : {}) };
}

/* ---------- path points ---------- */

/** Put a path point of a camera at time t, replacing one within half a frame. */
export function setPointAt(a: Animation, cam: Camera, t: number, point: Omit<CameraPoint, 't'>): Animation {
  const u = r3(t);
  const points = [...cam.points.filter((p) => Math.abs(p.t - u) >= 0.5 / a.fps), { ...point, t: u }].sort((p, q) => p.t - q.t);
  return updateCamera(a, cam.id, { points });
}

/** Remove a camera's path point at time t. */
export function removePointAt(a: Animation, cam: Camera, t: number): Animation {
  return updateCamera(a, cam.id, { points: cam.points.filter((p) => Math.abs(p.t - t) >= 0.5 / a.fps) });
}

/** Retime a camera's path point at `from` to `to` (within the animation; not onto another point). */
export function movePoint(a: Animation, cam: Camera, from: number, to: number): Animation {
  const v = r3(Math.min(a.duration, Math.max(0, to)));
  const tol = 0.5 / a.fps;
  if (cam.points.some((p) => Math.abs(p.t - v) < tol && Math.abs(p.t - from) >= tol)) return a;
  const points = cam.points.map((p) => (Math.abs(p.t - from) < tol ? { ...p, t: v } : p)).sort((p, q) => p.t - q.t);
  return updateCamera(a, cam.id, { points });
}

/** The path points that show on the timeline: each shot's camera's, over the shot's time. */
export function pointTimes(a: Animation): number[] {
  return shotSpans(a).flatMap((sp) => {
    const cam = a.cameras?.find((c) => c.id === sp.shot.camera);
    const last = sp.index === shotSpans(a).length - 1;
    return (cam?.points ?? []).filter((p) => p.t >= sp.start - 1e-6 && (p.t < sp.end - 1e-6 || (last && p.t <= sp.end + 1e-6))).map((p) => p.t);
  });
}
