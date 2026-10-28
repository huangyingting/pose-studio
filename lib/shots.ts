import { film } from './film';
import type { Animation, CameraPoint, PathCamera, Scene, Shot } from './types';

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

/** A new shot from `start`, filmed by a camera. */
export const newShot = (start: number, name: string, camera: string, id = uid('sh')): Shot => ({ id, start, name, camera });

const shotsOf = (a: Animation) => a.shots;

/** The shots with their time ranges. An animation without cuts is one shot. */
export function shotSpans(a: Animation): ShotSpan[] {
  const shots = shotsOf(a);
  return shots.map((shot, index) => ({ shot, index, start: shot.start, end: shots[index + 1]?.start ?? a.duration }));
}

export function spanAt(a: Animation, t: number): ShotSpan {
  const spans = shotSpans(a);
  return spans.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6) ?? spans[spans.length - 1];
}

/** Shots longer than the video model the film is cut for allows (lib/film.ts). */
export function overLimit(span: ShotSpan) {
  const m = videoModel(film().target);
  return !!m && span.end - span.start > m.max + 1e-6;
}

let counter = 0;
function uid(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const renamed = (shots: Shot[]) => shots.map((s, i) => ({ ...s, name: s.name && !/^Shot \d+$/.test(s.name) ? s.name : `Shot ${i + 1}` }));

/** Pinned shots as long as they are now (a cut by hand changed where one ends). */
function repinned(a: Animation): Animation {
  if (!a.shots.some((s) => s.pinned)) return a;
  const spans = shotSpans(a);
  return { ...a, shots: a.shots.map((s) => {
    const sp = spans.find((x) => x.shot.id === s.id);
    return s.pinned && sp ? { ...s, pinned: Math.round((sp.end - sp.start) * 1000) / 1000 } : s;
  }) };
}

/** Cut the shot under time t in two: the later one films with the same camera, until it is given another. */
export function cutAt(a: Animation, t: number): Animation {
  const shots = shotsOf(a);
  const tol = 0.5 / a.fps;
  if (t <= tol || t >= a.duration - tol || shots.some((s) => Math.abs(s.start - t) < tol)) return a;
  const i = shots.findIndex((s, k) => t > s.start && (k === shots.length - 1 || t < shots[k + 1].start));
  const old = shots[i];
  const first = { ...old, id: old.id === 'main' ? uid('sh') : old.id };
  const second: Shot = { id: uid('sh'), start: t, name: '', camera: old.camera };
  return repinned({ ...a, shots: renamed([...shots.slice(0, i), first, second, ...shots.slice(i + 1)]) });
}

/** Remove a cut: the shot before it runs on over its time. */
export function removeCut(a: Animation, id: string): Animation {
  const i = a.shots.findIndex((s) => s.id === id);
  if (i <= 0) return a;
  return repinned({ ...a, shots: renamed(a.shots.filter((_, j) => j !== i)) });
}

/** Move a cut (the start of a shot after the first) to t, on a frame, keeping every shot at least a frame long. */
export function moveCut(a: Animation, id: string, t: number): Animation {
  const shots = shotsOf(a);
  const i = shots.findIndex((s) => s.id === id);
  if (i <= 0) return a;
  const frame = 1 / a.fps;
  const end = shots[i + 1]?.start ?? a.duration;
  const start = Math.min(end - frame, Math.max(shots[i - 1].start + frame, Math.round(t * a.fps) / a.fps));
  const blend = shots[i].blend && Math.min(shots[i].blend!, end - start);
  return repinned({ ...a, shots: shots.map((s, k) => (k === i ? { ...s, start, ...(blend ? { blend } : {}) } : s)) });
}

/** These shots taken over by hand: the director (a live coverage) keeps them, each as long as it is now. */
export function pinShots(a: Animation, ids: string[]): Animation {
  const spans = shotSpans(a);
  return { ...a, shots: shotsOf(a).map((s) => {
    const sp = spans.find((x) => x.shot.id === s.id);
    return ids.includes(s.id) && sp ? { ...s, pinned: Math.round((sp.end - sp.start) * 1000) / 1000 } : s;
  }) };
}

/** A shot handed back to the director. */
export function unpinShot(a: Animation, id: string): Animation {
  return { ...a, shots: shotsOf(a).map((s) => {
    if (s.id !== id) return s;
    const { pinned: _p, ...rest } = s;
    void _p;
    return rest;
  }) };
}

export function updateShot(a: Animation, id: string, patch: Partial<Omit<Shot, 'id' | 'start'>>): Animation {
  return { ...a, shots: shotsOf(a).map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/* ---------- cameras ---------- */

/** Remove a camera (not the last): the shots it filmed are filmed by the first of the others. */
export function removeCamera(scene: Scene, id: string): Scene {
  const rest = scene.cameras.filter((c) => c.id !== id);
  if (!rest.length || rest.length === scene.cameras.length) return scene;
  const shots = scene.animation?.shots.map((s) => (s.camera === id ? { ...s, camera: rest[0].id } : s));
  return { ...scene, cameras: rest, ...(scene.animation ? { animation: { ...scene.animation, shots: shots! } } : {}) };
}

/* ---------- path points ---------- */

/** A path camera with a point at time t (replacing one within half a frame). */
export function setPointAt(cam: PathCamera, fps: number, t: number, point: Omit<CameraPoint, 't'>): PathCamera {
  const u = r3(t);
  return { ...cam, points: [...cam.points.filter((p) => Math.abs(p.t - u) >= 0.5 / fps), { ...point, t: u }].sort((p, q) => p.t - q.t) };
}

/** A path camera without its point at time t (not its last one). */
export function removePointAt(cam: PathCamera, fps: number, t: number): PathCamera {
  const points = cam.points.filter((p) => Math.abs(p.t - t) >= 0.5 / fps);
  return points.length ? { ...cam, points } : cam;
}

/** A path camera with its point at `from` retimed to `to` (within the animation; not onto another point). */
export function movePoint(cam: PathCamera, a: Pick<Animation, 'fps' | 'duration'>, from: number, to: number): PathCamera {
  const v = r3(Math.min(a.duration, Math.max(0, to)));
  const tol = 0.5 / a.fps;
  if (cam.points.some((p) => Math.abs(p.t - v) < tol && Math.abs(p.t - from) >= tol)) return cam;
  return { ...cam, points: cam.points.map((p) => (Math.abs(p.t - from) < tol ? { ...p, t: v } : p)).sort((p, q) => p.t - q.t) };
}
