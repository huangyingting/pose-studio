import { jointLimits, wrapDeg } from './joints';
import { chainAt, locomote } from './locomotion';
import { propsAt } from './propmotion';
import { groundOf } from './surfaces';
import { keysInShot, spanAt } from './shots';
import { JOINTS, type Animation, type CameraKey, type CameraTrack, type Figure, type Shot, type Hand, type Keyframe, type PoseKey, type Prop, type PropKey, type Scene, type Vec3 } from './types';

export type { Animation, Keyframe, PoseKey };

/*
 * Keyframe animation for a pose. Each keyframe stores every figure's pose (joints, position,
 * hands, grounding) at a time; in between, values follow a cubic Hermite (Catmull-Rom) curve
 * through the neighbouring keys, so cycles like a walk move smoothly instead of stopping at
 * each key. Looping animations wrap around: the last key flows back into the first.
 */

export const DEFAULT_FPS = 24;

export function poseOf(f: Figure): PoseKey {
  return {
    joints: structuredClone(f.joints),
    position: [...f.position],
    hands: { L: { curl: [...f.hands.L.curl], spread: f.hands.L.spread }, R: { curl: [...f.hands.R.curl], spread: f.hands.R.spread } },
    grounded: f.grounded,
  };
}

export function newAnimation(scene: Scene, duration = 2): Animation {
  return { duration, fps: DEFAULT_FPS, loop: true, keys: [{ t: 0, poses: Object.fromEntries(scene.figures.map((f) => [f.id, poseOf(f)])) }] };
}

/** Snap a time to the frame grid and the animation's range. */
export function snapTime(a: Pick<Animation, 'fps' | 'duration'>, t: number) {
  const frame = Math.round(t * a.fps);
  return Math.min(a.duration, Math.max(0, frame / a.fps));
}

/** Index of the key at time t (within half a frame), or -1. */
export function keyAt(a: Animation, t: number) {
  const tol = 0.5 / a.fps;
  return a.keys.findIndex((k) => Math.abs(k.t - t) < tol);
}

/*
 * Each figure has its own track: a keyframe holds the poses of the figures keyed at that time,
 * not necessarily all of them, and a figure moves between its own keys only. Keys at the same
 * time are one keyframe in the data, so a pose keyed for several figures at once stays in step.
 */

/**
 * Key the given figures at time t with their current poses (other figures' keys are untouched).
 * A key keeps how the figure travels to it; a new key in the middle of a walk (or run, or jump)
 * becomes part of it: a waypoint, or a pose in the air.
 */
export function setKey(a: Animation, t: number, figures: Figure[]): Animation {
  const time = snapTime(a, t);
  const i = keyAt(a, time);
  const poses = Object.fromEntries(figures.map((f) => {
    const pose = poseOf(f);
    const old = i >= 0 ? a.keys[i].poses[f.id] : undefined;
    const travel = old ? pick(old) : (() => { const c = chainAt(a, f.id, time); return c ? { travel: c.kind, ...(c.end.strafe ? { strafe: true } : {}) } : {}; })();
    return [f.id, { ...pose, ...travel }];
  }));
  const keys = i >= 0
    ? a.keys.map((k, j) => (j === i ? { ...k, t: time, poses: { ...k.poses, ...poses } } : k))
    : [...a.keys, { t: time, poses }].sort((p, q) => p.t - q.t);
  return { ...a, keys };
}

/** How a key is reached (travel, facing, turns), to carry over when it is re-keyed. */
function pick(p: PoseKey): Partial<PoseKey> {
  const out: Partial<PoseKey> = {};
  if (p.travel) out.travel = p.travel;
  if (p.strafe) out.strafe = true;
  if (p.spin) out.spin = p.spin;
  if (p.flip) out.flip = p.flip;
  return out;
}

/** A prop's place as a key (held props: relative to the hand). */
export function propKeyOf(p: Prop): PropKey {
  return { position: [...p.position], rotation: [...p.rotation], ...(p.hold ? { hold: { ...p.hold } } : {}) };
}

/**
 * Key a prop at time t with its current place; an existing key keeps whether it was let go or
 * thrown there. The first key of a prop also keys where it was before (`was`) at the start, so it
 * moves from there.
 */
export function setPropKey(a: Animation, t: number, prop: Prop, extra: Partial<PropKey> = {}, was?: Prop): Animation {
  const time = snapTime(a, t);
  let keys = a.keys;
  if (was && !keys.some((k) => k.props?.[prop.id]) && time > 0) {
    const first = keys.findIndex((k) => Math.abs(k.t) < 0.5 / a.fps);
    const start = propKeyOf(was);
    keys = first >= 0
      ? keys.map((k, j) => (j === first ? { ...k, props: { ...k.props, [prop.id]: start } } : k))
      : [{ t: 0, poses: {}, props: { [prop.id]: start } }, ...keys];
  }
  const i = keys.findIndex((k) => Math.abs(k.t - time) < 0.5 / a.fps);
  const old = i >= 0 ? keys[i].props?.[prop.id] : undefined;
  const key: PropKey = { ...propKeyOf(prop), ...(old?.release ? { release: true } : {}), ...(old?.throw ? { throw: true } : {}), ...extra };
  keys = i >= 0
    ? keys.map((k, j) => (j === i ? { ...k, props: { ...k.props, [prop.id]: key } } : k))
    : [...keys, { t: time, poses: {}, props: { [prop.id]: key } }].sort((p, q) => p.t - q.t);
  return { ...a, keys };
}

/** Remove one prop's key at time t. */
export function removePropKey(a: Animation, t: number, id: string): Animation {
  const i = keyAt(a, t);
  if (i < 0 || !a.keys[i].props?.[id]) return a;
  return withoutEmpty({
    ...a,
    keys: a.keys.map((k, j) => {
      if (j !== i) return k;
      const { [id]: _, ...rest } = k.props!;
      void _;
      return Object.keys(rest).length ? { ...k, props: rest } : { t: k.t, poses: k.poses };
    }),
  });
}

/** Only the keys of these props (after props are deleted). */
export function keepProps(a: Animation, ids: Set<string>): Animation {
  if (a.keys.every((k) => Object.keys(k.props ?? {}).every((id) => ids.has(id)))) return a;
  return withoutEmpty({
    ...a,
    keys: a.keys.map((k) => {
      const props = Object.fromEntries(Object.entries(k.props ?? {}).filter(([id]) => ids.has(id)));
      return Object.keys(props).length ? { ...k, props } : { t: k.t, poses: k.poses };
    }),
  });
}

/** Times of one figure's keys. */
export function figureKeyTimes(a: Animation, id: string) {
  return a.keys.filter((k) => k.poses[id]).map((k) => k.t);
}

const hasAny = (k: Keyframe) => Object.keys(k.poses).length > 0 || Object.keys(k.props ?? {}).length > 0;
const withoutEmpty = (a: Animation): Animation => ({ ...a, keys: a.keys.filter(hasAny) });

/**
 * Remove the key at time t: one figure's (`id`), or the whole keyframe. A figure keeps at least
 * one key, and the animation at least one keyframe.
 */
export function removeKey(a: Animation, t: number, id?: string): Animation {
  const i = keyAt(a, t);
  if (i < 0) return a;
  if (id === undefined) return a.keys.length <= 1 ? a : { ...a, keys: a.keys.filter((_, j) => j !== i) };
  if (!a.keys[i].poses[id] || figureKeyTimes(a, id).length <= 1) return a;
  return withoutEmpty({ ...a, keys: a.keys.map((k, j) => (j === i ? { ...k, poses: omit(k.poses, id) } : k)) });
}

/**
 * Move a key to a new time: one figure's (`id`), or the whole keyframe. Refused when the target
 * time already has a key for it.
 */
export function moveKey(a: Animation, from: number, to: number, id?: string): Animation {
  const i = keyAt(a, from);
  if (i < 0) return a;
  const time = snapTime(a, to);
  const j = keyAt(a, time);
  if (id === undefined) {
    if (j >= 0 && j !== i) return a;
    return { ...a, keys: a.keys.map((k, n) => (n === i ? { ...k, t: time } : k)).sort((p, q) => p.t - q.t) };
  }
  const pose = a.keys[i].poses[id];
  if (!pose || j === i) return a;
  if (j >= 0 && a.keys[j].poses[id]) return a;
  const keys = a.keys.map((k, n) => (n === i ? { ...k, poses: omit(k.poses, id) } : n === j ? { ...k, poses: { ...k.poses, [id]: pose } } : k));
  if (j < 0) keys.push({ t: time, poses: { [id]: pose } });
  return withoutEmpty({ ...a, keys: keys.sort((p, q) => p.t - q.t) });
}

/** Only the tracks of these figures (after figures are deleted). */
export function keepFigures(a: Animation, ids: Set<string>): Animation {
  if (a.keys.every((k) => Object.keys(k.poses).every((id) => ids.has(id)))) return a;
  const keys = a.keys.map((k) => ({ ...k, poses: Object.fromEntries(Object.entries(k.poses).filter(([id]) => ids.has(id))) })).filter(hasAny);
  return { ...a, keys: keys.length ? keys : a.keys.slice(0, 1) };
}

function omit<T>(o: Record<string, T>, id: string) {
  const { [id]: _drop, ...rest } = o;
  void _drop;
  return rest;
}

/** Change the length, scaling key times to fit. */
export function setDuration(a: Animation, duration: number): Animation {
  const d = Math.min(60, Math.max(0.2, duration));
  const s = d / a.duration;
  return { ...a, duration: d, keys: a.keys.map((k) => ({ ...k, t: snapTime({ fps: a.fps, duration: d }, k.t * s) })) };
}

/* ---------- sampling ---------- */

/** Cubic Hermite through p1→p2 with Catmull-Rom tangents from the neighbours (non-uniform times). */
function hermite(p0: number, p1: number, p2: number, p3: number, t0: number, t1: number, t2: number, t3: number, t: number) {
  const h = t2 - t1;
  if (h <= 1e-9) return p1;
  const u = (t - t1) / h;
  const m1 = t2 - t0 > 1e-9 ? ((p2 - p0) / (t2 - t0)) * h : 0;
  const m2 = t3 - t1 > 1e-9 ? ((p3 - p1) / (t3 - t1)) * h : 0;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
}

interface Track {
  t: number;
  pose: PoseKey;
}

/**
 * The keys around time t: k1 → k2 is the segment containing t, k0 and k3 its neighbours
 * (times shifted by the duration when wrapping a loop; mirrored at the ends otherwise).
 */
function segment<T extends { t: number }>(track: T[], t: number, duration: number, loop: boolean) {
  const n = track.length;
  if (n === 1) return { k0: track[0], k1: track[0], k2: track[0], k3: track[0], time: t };
  if (loop) {
    const at = (i: number): T => {
      const k = track[((i % n) + n) % n];
      return { ...k, t: k.t + Math.floor(i / n) * duration };
    };
    let time = ((t % duration) + duration) % duration;
    if (time < track[0].t) time += duration;
    let i = 0;
    while (i < n - 1 && at(i + 1).t <= time) i++;
    return { k0: at(i - 1), k1: at(i), k2: at(i + 1), k3: at(i + 2), time };
  }
  const time = Math.min(track[n - 1].t, Math.max(track[0].t, t));
  let i = 0;
  while (i < n - 2 && track[i + 1].t <= time) i++;
  const k1 = track[i];
  const k2 = track[i + 1];
  const k0 = i > 0 ? track[i - 1] : { ...k1, t: k1.t - (k2.t - k1.t) };
  const k3 = i + 2 < n ? track[i + 2] : { ...k2, t: k2.t + (k2.t - k1.t) };
  return { k0, k1, k2, k3, time };
}

/** Cubic interpolation helpers for one segment. */
function interpolator(k0: { t: number }, k1: { t: number }, k2: { t: number }, k3: { t: number }, time: number) {
  const num = (p0: number, p1: number, p2: number, p3: number) => hermite(p0, p1, p2, p3, k0.t, k1.t, k2.t, k3.t, time);
  // Angles: unwrap neighbours relative to p1 so a turn from 170° to -170° goes the short way.
  const ang = (p0: number, p1: number, p2: number, p3: number) => {
    const q2 = p1 + wrapDeg(p2 - p1);
    return wrapDeg(num(p1 + wrapDeg(p0 - p1), p1, q2, q2 + wrapDeg(p3 - p2)));
  };
  return { num, ang };
}

/** Interpolated pose of one figure at time t, or null if no key mentions it. */
export function samplePose(a: Animation, id: string, t: number): PoseKey | null {
  const track: Track[] = a.keys.filter((k) => k.poses[id]).map((k) => ({ t: k.t, pose: k.poses[id] }));
  if (!track.length) return null;
  const { k0, k1, k2, k3, time } = segment(track, t, a.duration, a.loop);
  if (k2.t - k1.t <= 1e-9) return structuredClone(k1.pose);
  const { num, ang } = interpolator(k0, k1, k2, k3, time);
  const ks = [k0, k1, k2, k3];
  const joints: Figure['joints'] = {};
  for (const j of JOINTS) {
    const r = ks.map((k) => k.pose.joints[j] ?? [0, 0, 0]);
    const lim = jointLimits(j);
    const v = [0, 1, 2].map((c) => {
      const [p0, p1, p2, p3] = r.map((x) => x[c]);
      const inside = (x: number) => x >= lim[c][0] && x <= lim[c][1];
      // Within a joint's range the direct path is the anatomical one (an arm swings forward over
      // the top rather than back through the shoulder); the body turns, and the rest, take the short way.
      const x = j !== 'root' && inside(p1) && inside(p2) ? num(p0, p1, p2, p3) : ang(p0, p1, p2, p3);
      return Math.round(x * 10) / 10 || 0;
    }) as Vec3;
    if (v.some((x) => x !== 0)) joints[j] = v;
  }
  const p = ks.map((k) => k.pose.position);
  const position = [0, 1, 2].map((c) => Math.round(num(p[0][c], p[1][c], p[2][c], p[3][c]) * 1000) / 1000 || 0) as Vec3;
  const hand = (side: 'L' | 'R'): Hand => {
    const h = ks.map((k) => k.pose.hands[side]);
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return {
      curl: h[1].curl.map((_, i) => clamp(num(h[0].curl[i], h[1].curl[i], h[2].curl[i], h[3].curl[i]))) as Hand['curl'],
      spread: clamp(num(h[0].spread, h[1].spread, h[2].spread, h[3].spread)),
    };
  };
  return { joints, position, hands: { L: hand('L'), R: hand('R') }, grounded: k1.pose.grounded };
}

/** Shot camera at time t (the track's keys interpolated), or null without a camera track. */
export function sampleCamera(a: Animation, t: number): CameraKey | null {
  let keys = a.camera?.keys;
  if (!keys?.length) return null;
  let loop = a.loop;
  // With cuts, only the shot's own keys frame it, and it does not wrap around.
  if (a.shots && a.shots.length > 1) {
    const span = spanAt(a, t);
    keys = keysInShot(a, span);
    if (!keys.length) return null;
    loop = false;
    t = Math.min(span.end, Math.max(span.start, t));
  }
  const { k0, k1, k2, k3, time } = segment(keys, t, a.duration, loop);
  const c = [k0, k1, k2, k3];
  if (k2.t - k1.t <= 1e-9) return { ...k1, t };
  const { num, ang } = interpolator(k0, k1, k2, k3, time);
  const n = (f: (k: CameraKey) => number) => num(f(c[0]), f(c[1]), f(c[2]), f(c[3]));
  return {
    t,
    yaw: ang(c[0].yaw, c[1].yaw, c[2].yaw, c[3].yaw),
    pitch: Math.min(89, Math.max(-89, n((k) => k.pitch))),
    fov: Math.min(90, Math.max(5, n((k) => k.fov))),
    zoom: Math.max(0.1, n((k) => k.zoom)),
    pan: [n((k) => k.pan[0]), n((k) => k.pan[1])],
  };
}

/** One figure as it is at time t (keys interpolated, its walks, runs and jumps generated). */
export function figurePoseAt(scene: Scene, id: string, t: number): Figure | null {
  const f = scene.figures.find((x) => x.id === id);
  const a = scene.animation;
  if (!f || !a) return f ?? null;
  const p = samplePose(a, f.id, t);
  if (!p) return f;
  const { joints, position, hands, grounded } = locomote(a, f, t, p, groundOf(scene.props));
  return { ...f, joints, position, hands, grounded };
}

/**
 * The scene as it looks at time t: keys interpolated, with walks, runs and jumps generated on
 * top (lib/locomotion.ts). Figures without keys keep their pose.
 */
export function sceneAt(scene: Scene, t: number): Scene {
  const a = scene.animation;
  if (!a) return scene;
  const ground = groundOf(scene.props);
  const figureAt = (f: Figure, at: number): Figure => {
    const p = samplePose(a, f.id, at);
    if (!p) return f;
    const { joints, position, hands, grounded } = locomote(a, f, at, p, ground);
    return { ...f, joints, position, hands, grounded };
  };
  const figures = scene.figures.map((f) => figureAt(f, t));
  // Props ride in hands, fly and fall: they need the figures' hands at their key times too.
  const props = propsAt(scene, t, (id, at) => {
    const f = Math.abs(at - t) < 1e-9 ? figures.find((x) => x.id === id) : scene.figures.find((x) => x.id === id);
    return !f ? null : Math.abs(at - t) < 1e-9 ? f : figureAt(f, at);
  });
  return { ...scene, figures, props };
}

/** Times of evenly spaced frames, for frame sheets and video. */
export function frameTimes(a: Animation, count?: number) {
  const total = Math.max(1, Math.round(a.duration * a.fps));
  const n = count ? Math.max(1, Math.min(count, total)) : total;
  // A loop's last frame equals its first, so leave it out.
  const steps = a.loop ? n : Math.max(1, n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(((i * a.duration) / steps) * 1000) / 1000);
}

/* ---------- validation of untrusted data ---------- */

export function parseAnimation(
  v: unknown,
  figureIds: Set<string>,
  parsePose: (p: unknown) => PoseKey | null,
  propIds: Set<string> = new Set(),
  parseProp: (p: unknown) => PropKey | null = () => null,
): Animation | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
  const duration = Math.min(60, Math.max(0.2, num(o.duration, 2)));
  const fps = Math.round(Math.min(60, Math.max(4, num(o.fps, DEFAULT_FPS))));
  const keys: Keyframe[] = [];
  for (const k of Array.isArray(o.keys) ? o.keys.slice(0, 600) : []) {
    if (typeof k !== 'object' || k === null) continue;
    const kk = k as Record<string, unknown>;
    const poses: Record<string, PoseKey> = {};
    if (typeof kk.poses === 'object' && kk.poses !== null) {
      for (const [id, p] of Object.entries(kk.poses as Record<string, unknown>)) {
        if (!figureIds.has(id)) continue;
        const pose = parsePose(p);
        if (pose) poses[id] = pose;
      }
    }
    const props: Record<string, PropKey> = {};
    if (typeof kk.props === 'object' && kk.props !== null) {
      for (const [id, p] of Object.entries(kk.props as Record<string, unknown>)) {
        if (!propIds.has(id)) continue;
        const key = parseProp(p);
        if (key) props[id] = key;
      }
    }
    const t = Math.min(duration, Math.max(0, num(kk.t, 0)));
    if (Object.keys(poses).length || Object.keys(props).length) keys.push({ t, poses, ...(Object.keys(props).length ? { props } : {}) });
  }
  if (!keys.length) return undefined;
  keys.sort((p, q) => p.t - q.t);
  const anim: Animation = { duration, fps, loop: o.loop !== false, keys };
  const cam = parseCamera(o.camera, duration);
  if (cam) anim.camera = cam;
  const shots = parseShots(o.shots, duration);
  if (shots) anim.shots = shots;
  if (typeof o.target === 'string' && o.target.length <= 40) anim.target = o.target;
  return anim;
}

function parseShots(v: unknown, duration: number): Shot[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
  const shots: Shot[] = v
    .slice(0, 200)
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x, i) => ({
      id: str(x.id, 40) || `shot${i}`,
      start: typeof x.start === 'number' && Number.isFinite(x.start) ? Math.min(duration, Math.max(0, x.start)) : 0,
      name: str(x.name, 80) || `Shot ${i + 1}`,
      ...(typeof x.caption === 'string' && x.caption ? { caption: x.caption.slice(0, 500) } : {}),
      ...(typeof x.subject === 'string' && x.subject ? { subject: x.subject.slice(0, 40) } : {}),
    }))
    .sort((p, q) => p.start - q.start);
  if (!shots.length) return undefined;
  shots[0].start = 0;
  return shots;
}

function parseCamera(v: unknown, duration: number): CameraTrack | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, fallback: number, min: number, max: number) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback;
  const keys: CameraKey[] = (Array.isArray(o.keys) ? o.keys.slice(0, 600) : [])
    .filter((k): k is Record<string, unknown> => typeof k === 'object' && k !== null)
    .map((k) => ({
      t: num(k.t, 0, 0, duration),
      yaw: wrapDeg(num(k.yaw, 0, -1e6, 1e6)),
      pitch: num(k.pitch, 4, -89, 89),
      fov: num(k.fov, 24, 5, 90),
      zoom: num(k.zoom, 1, 0.1, 20),
      pan: [num(Array.isArray(k.pan) ? k.pan[0] : 0, 0, -5, 5), num(Array.isArray(k.pan) ? k.pan[1] : 0, 0, -5, 5)] as [number, number],
    }))
    .sort((p, q) => p.t - q.t);
  return { keys, follow: o.follow === true, shake: num(o.shake, 0, 0, 1) };
}

/** Replace figure ids in the keys (after copying a scene with fresh ids). */
export function remapAnimation(a: Animation, ids: Map<string, string>, propIds: Map<string, string> = new Map()): Animation {
  return {
    ...a,
    keys: a.keys.map((k) => {
      const props = Object.fromEntries(Object.entries(k.props ?? {}).flatMap(([id, p]) => {
        if (!propIds.has(id)) return [];
        const key = structuredClone(p);
        if (key.hold) key.hold = { ...key.hold, figure: ids.get(key.hold.figure) ?? key.hold.figure };
        return [[propIds.get(id)!, key]];
      }));
      return {
        ...k,
        poses: Object.fromEntries(Object.entries(k.poses).flatMap(([id, p]) => (ids.has(id) ? [[ids.get(id)!, structuredClone(p)]] : []))),
        ...(Object.keys(props).length ? { props } : { props: undefined }),
      };
    }),
  };
}

/** Apply a function to every figure pose in every key. */
export function mapPoses(a: Animation, fn: (p: PoseKey, id: string) => PoseKey): Animation {
  return { ...a, keys: a.keys.map((k) => ({ ...k, poses: Object.fromEntries(Object.entries(k.poses).map(([id, p]) => [id, fn(p, id)])) })) };
}
