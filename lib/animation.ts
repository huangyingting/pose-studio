import { keysClip, mirrorClip } from './clip';
import { mirrorJointName, wrapDeg } from './joints';
import { uid } from './uid';
import type { OldCameraKey } from './shot';
import type { Action, Animation, Camera, Constraint, Figure, Mark, Prop, PropKey, PropTarget, Scene, Shot, Vec3 } from './types';

export type { Animation };

/*
 * An animated scene's timing: every figure's actions (lib/types.ts Action; evaluated in
 * lib/evaluate.ts, edited in lib/track.ts), props' keys, its cameras and the shots cutting between them.
 */

export const DEFAULT_FPS = 24;

/** A figure holding its pose from time t: an action with one key. */
export function holdAction(f: Pick<Figure, 'id' | 'bones' | 'position' | 'hands' | 'grounded'>, t: number): Action {
  const pose = { bones: { ...f.bones }, position: [...f.position] as Figure['position'], hands: structuredClone(f.hands), grounded: f.grounded };
  return { id: uid('act'), start: t, duration: 0, roles: [{ figure: f.id }], source: { kind: 'keys', clip: keysClip([{ t: 0, pose }]) } };
}

/**
 * Keep an animation consistent with its cast: actions of figures no longer there go, and every
 * figure starts with keys (a held pose where it is, if nothing else).
 */
export function normalize(a: Animation, figures: Figure[]): Animation {
  const ids = new Set(figures.map((f) => f.id));
  let actions = a.actions.filter((x) => x.roles.length && x.roles.every((r) => ids.has(r.figure)));
  for (const f of figures) {
    const mine = actions.filter((x) => !x.layer && x.roles.some((r) => r.figure === f.id)).sort((p, q) => p.start - q.start || p.duration - q.duration);
    if (!mine.length || mine[0].source.kind !== 'keys') actions = [...actions, holdAction(f, mine.length ? mine[0].start : 0)];
  }
  const props = a.props && Object.fromEntries(Object.entries(a.props).map(([id, keys]) => [id, keys.filter((k) => !k.hold || ids.has(k.hold.figure))]));
  const holds = a.constraints?.filter((c) => ids.has(c.figure) && (!('figure' in c.target) || ids.has(c.target.figure)));
  if (actions.length === a.actions.length && actions.every((x, i) => x === a.actions[i]) && JSON.stringify(props) === JSON.stringify(a.props) && holds?.length === a.constraints?.length) return a;
  const { constraints: _all, ...rest } = a;
  void _all;
  return { ...rest, actions: [...actions].sort((p, q) => p.start - q.start || p.duration - q.duration), ...(props ? { props } : {}), ...(holds?.length ? { constraints: holds } : {}) };
}

/** A new animation: every figure holds its pose. */
export function newAnimation(scene: Scene, duration = 2): Animation {
  return { duration, fps: DEFAULT_FPS, loop: true, actions: scene.figures.map((f) => holdAction(f, 0)) };
}

/** Snap a time to the frame grid and the animation's range. */
export function snapTime(a: Pick<Animation, 'fps' | 'duration'>, t: number) {
  const frame = Math.round(t * a.fps);
  return Math.min(a.duration, Math.max(0, frame / a.fps));
}

/** Change the length, scaling the actions', props' keys', shots' and camera paths' times to fit. */
export function setDuration(a: Animation, duration: number): Animation {
  const d = Math.min(60, Math.max(0.2, duration));
  const s = d / a.duration;
  const snap = (t: number) => snapTime({ fps: a.fps, duration: d }, t * s);
  const actions = a.actions.map((x): Action => {
    const start = snap(x.start);
    const length = Math.max(0, snap(x.start + x.duration) - start);
    const src = x.source;
    if (src.kind === 'keys') {
      const clip = { ...src.clip, duration: src.clip.duration * s, parts: src.clip.parts.map((p) => ({ ...p, tracks: p.tracks.map((tr) => ({ ...tr, times: tr.times.map((t) => Math.round(t * s * 1e4) / 1e4) })) })) };
      return { ...x, start, duration: length, source: { ...src, clip } };
    }
    if (src.kind === 'clip') return { ...x, start, duration: length, source: { ...src, speed: (src.speed ?? 1) / s } };
    return { ...x, start, duration: length };
  });
  const props = a.props && Object.fromEntries(Object.entries(a.props).map(([id, keys]) => [id, keys.map((k) => ({ ...k, t: snap(k.t) }))]));
  const shots = a.shots?.map((x) => ({ ...x, start: snap(x.start) }));
  const cameras = a.cameras?.map((c) => ({ ...c, points: c.points.map((p) => ({ ...p, t: Math.round(p.t * s * 1000) / 1000 })) }));
  return { ...a, duration: d, actions, ...(props ? { props } : {}), ...(shots ? { shots } : {}), ...(cameras ? { cameras } : {}) };
}

/** Times of evenly spaced frames, for frame sheets and video. */
export function frameTimes(a: Animation, count?: number) {
  const total = Math.max(1, Math.round(a.duration * a.fps));
  const n = count ? Math.max(1, Math.min(count, total)) : total;
  // A loop's last frame equals its first, so leave it out.
  const steps = a.loop ? n : Math.max(1, n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(((i * a.duration) / steps) * 1000) / 1000);
}

/** Replace figure and prop ids (after copying a scene with fresh ids). */
export function remapAnimation(a: Animation, ids: Map<string, string>, propIds: Map<string, string> = new Map()): Animation {
  const target = (t: PropTarget | undefined): PropTarget | undefined => {
    if (!t) return undefined;
    if ('figure' in t) return ids.has(t.figure) ? { ...t, figure: ids.get(t.figure)! } : undefined;
    if ('hoop' in t) return propIds.has(t.hoop) ? { ...t, hoop: propIds.get(t.hoop)! } : undefined;
    return t;
  };
  const actions = a.actions
    .filter((x) => x.roles.every((r) => ids.has(r.figure)))
    .map((x) => {
      const { prop, target: aim, ...rest } = structuredClone(x);
      const to = target(aim);
      return {
        ...rest, id: uid('act'), roles: x.roles.map((r) => ({ ...structuredClone(r), figure: ids.get(r.figure)! })),
        ...(prop && propIds.has(prop) ? { prop: propIds.get(prop)! } : {}), ...(to ? { target: to } : {}),
      };
    });
  const props = a.props && Object.fromEntries(Object.entries(a.props).flatMap(([id, keys]) => (propIds.has(id)
    ? [[propIds.get(id)!, keys.map((k) => ({ ...structuredClone(k), ...(k.hold ? { hold: { ...k.hold, figure: ids.get(k.hold.figure) ?? k.hold.figure } } : {}) }))]]
    : [])));
  const constraints = a.constraints?.flatMap((c) => {
    if (!ids.has(c.figure) || ('figure' in c.target && !ids.has(c.target.figure)) || ('prop' in c.target && !propIds.has(c.target.prop))) return [];
    const target = 'figure' in c.target ? { ...c.target, figure: ids.get(c.target.figure)! } : 'prop' in c.target ? { ...c.target, prop: propIds.get(c.target.prop)! } : c.target;
    return [{ ...structuredClone(c), id: uid('hold'), figure: ids.get(c.figure)!, target }];
  });
  const cameras = a.cameras?.map((c) => {
    const { subject, ...rest } = structuredClone(c);
    return subject && ids.has(subject) ? { ...rest, subject: ids.get(subject)! } : rest;
  });
  return { ...a, actions, ...(props ? { props } : {}), ...(constraints?.length ? { constraints } : {}), ...(cameras ? { cameras } : {}) };
}

/** An animation mirrored left ↔ right (across the plane x = 0). */
export function mirrorAnimation(a: Animation): Animation {
  const mark = (m: Mark): Mark => ({ at: [-m.at[0] || 0, m.at[1]], facing: wrapDeg(-m.facing) || 0 });
  const actions = a.actions.map((y): Action => {
    const t = y.target;
    const x = !t ? y : { ...y, target: 'at' in t ? { at: [-t.at[0] || 0, t.at[1]] as [number, number] } : 'figure' in t ? { ...t, hand: t.hand === 'L' ? 'R' as const : 'L' as const } : t };
    const roles = x.roles.map((r) => (r.end ? { ...r, end: mark(r.end) } : r));
    const src = x.source;
    if (src.kind === 'keys') return { ...x, roles, source: { ...src, clip: mirrorClip(src.clip) } };
    if (src.kind === 'clip') return { ...x, roles, source: { ...src, mirror: !src.mirror } };
    return { ...x, roles, source: { ...src, ...(src.via ? { via: src.via.map(mark) } : {}), ...(src.spin ? { spin: -src.spin } : {}) } };
  });
  const props = a.props && Object.fromEntries(Object.entries(a.props).map(([id, keys]) => [id, keys.map((k) => ({
    ...k,
    position: [-k.position[0] || 0, k.position[1], k.position[2]] as PropKey['position'],
    rotation: [k.rotation[0], -k.rotation[1] || 0, -k.rotation[2] || 0] as PropKey['rotation'],
    ...(k.hold ? { hold: { ...k.hold, hand: k.hold.hand === 'L' ? 'R' as const : 'L' as const } } : {}),
  }))]));
  const flipped = (v: Vec3): Vec3 => [-v[0] || 0, v[1], v[2]];
  const cameras = a.cameras?.map((c) => ({ ...c, points: c.points.map((p) => ({ ...p, position: flipped(p.position), look: flipped(p.look), ...(p.roll ? { roll: -p.roll } : {}) })) }));
  const constraints = a.constraints?.map((c) => ({
    ...c,
    bone: mirrorJointName(c.bone) as Constraint['bone'],
    target: 'figure' in c.target ? { ...c.target, bone: mirrorJointName(c.target.bone), at: flipped(c.target.at) } : 'prop' in c.target ? { ...c.target, at: flipped(c.target.at) } : { point: flipped(c.target.point) },
  }));
  return { ...a, actions, ...(props ? { props } : {}), ...(cameras ? { cameras } : {}), ...(constraints ? { constraints } : {}) };
}

/* ---------- validation of untrusted data ---------- */

/**
 * An animation's shots and cameras. (One-time converter, remove in a later release: shots saved
 * when they had camera paths of their own each become a camera, and a shot filming with it.)
 */
export function parseShots(rawShots: unknown, rawCameras: unknown, duration: number): Pick<Animation, 'shots' | 'cameras'> {
  const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
  const num = (x: unknown, fallback: number, min: number, max: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback);
  const vec = (x: unknown): Vec3 => (Array.isArray(x) ? [0, 1, 2].map((i) => num(x[i], 0, -1000, 1000)) : [0, 0, 0]) as Vec3;
  const objects = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []).filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null);
  const camera = (x: Record<string, unknown>, id: string, name: string, from = 0): Camera => ({
    id, name,
    ...(typeof x.subject === 'string' && x.subject ? { subject: x.subject.slice(0, 40) } : {}),
    anchor: x.anchor === 'subject' ? 'subject' : 'world',
    aim: x.aim === 'point' || x.aim === 'path' ? x.aim : 'subject',
    points: objects(x.points, 500)
      .map((p) => ({
        t: Math.round(num(num(p.t, 0, 0, 60) + from, 0, 0, duration) * 1000) / 1000, position: vec(p.position), look: vec(p.look), lens: num(p.lens, 35, 4, 1200),
        ...(typeof p.roll === 'number' && Number.isFinite(p.roll) && p.roll ? { roll: num(p.roll, 0, -180, 180) } : {}),
      }))
      .sort((p, q) => p.t - q.t),
    ...(x.ease === 'linear' ? { ease: 'linear' as const } : {}),
    ...(typeof x.shake === 'number' && x.shake > 0 ? { shake: num(x.shake, 0, 0, 1) } : {}),
  });
  const cameras = objects(rawCameras, 100).map((x, i) => camera(x, str(x.id, 40) || `cam${i}`, str(x.name, 80) || `Camera ${i + 1}`));
  const ids = new Set(cameras.map((c) => c.id));
  const shots: Shot[] = objects(rawShots, 200)
    .map((x, i) => {
      const start = num(x.start, 0, 0, duration);
      let cam = typeof x.camera === 'string' && ids.has(x.camera) ? x.camera : undefined;
      if (!('camera' in x) && ((Array.isArray(x.points) && x.points.length) || x.subject)) {
        // Saved with a path of its own.
        let n = cameras.length + 1;
        while (ids.has(`cam${n}`)) n++;
        const made = camera(x, `cam${n}`, `Camera ${n}`, start);
        cameras.push(made);
        ids.add(made.id);
        cam = made.id;
      }
      return {
        id: str(x.id, 40) || `shot${i}`,
        start,
        name: str(x.name, 80) || `Shot ${i + 1}`,
        ...(typeof x.caption === 'string' && x.caption ? { caption: x.caption.slice(0, 500) } : {}),
        ...(cam ? { camera: cam } : {}),
        ...(typeof x.blend === 'number' && x.blend > 0 ? { blend: num(x.blend, 0, 0, 10) } : {}),
      };
    })
    .sort((p, q) => p.start - q.start);
  if (shots.length) shots[0].start = 0;
  return { ...(shots.length ? { shots } : {}), ...(cameras.length ? { cameras } : {}) };
}

/** One-time converter: the camera key track saved before shots had paths (lib/shot.ts camerasFromKeys). */
export function parseOldCamera(v: unknown, duration: number): { keys: OldCameraKey[]; follow: boolean; shake: number } | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, fallback: number, min: number, max: number) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback;
  const keys: OldCameraKey[] = (Array.isArray(o.keys) ? o.keys.slice(0, 600) : [])
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
  return keys.length ? { keys, follow: o.follow === true, shake: num(o.shake, 0, 0, 1) } : undefined;
}

/** A prop's place as a key at time t (held props: relative to the hand). */
export function propKeyOf(p: Prop, t: number): PropKey {
  return { t, position: [...p.position], rotation: [...p.rotation], ...(p.hold ? { hold: { ...p.hold } } : {}) };
}
