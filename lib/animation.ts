import { keysClip, placeClip } from './clip';
import { wrapDeg } from './joints';
import { uid } from './uid';
import { MOVE_KINDS, type Action, type Animation, type Camera, type CameraMove, type CameraPoint, type CameraRig, type Figure, type Mark, type MoveKind, type Prop, type PropKey, type PropTarget, type Scene, type Shot, type ShotSize, type Vec3 } from './types';

export type { Animation };

/*
 * An animated scene's timing: every figure's actions (lib/types.ts Action; evaluated in
 * lib/evaluate.ts, edited in lib/track.ts), props' keys, and the shots cutting between the scene's
 * cameras.
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

/** A new animation: every figure holds its pose, one shot filmed by the scene's first camera. */
export function newAnimation(scene: Scene, duration = 2): Animation {
  return { duration, fps: DEFAULT_FPS, loop: true, actions: scene.figures.map((f) => holdAction(f, 0)), shots: [{ id: 'main', start: 0, name: 'Shot 1', camera: scene.cameras[0].id }] };
}

/** The longest a scene's animation can be (s): five minutes. */
export const MAX_DURATION = 300;
/** How far past its end the playhead goes (s): a key or an action added there lengthens the animation. */
export const PAST_END = 2;

/** The latest time the playhead goes to: a little past the end. */
export const lastTime = (a: Pick<Animation, 'duration'>) => Math.min(MAX_DURATION, a.duration + PAST_END);

/** Snap a time to the frame grid and the animation's range (with the stretch past its end). */
export function snapTime(a: Pick<Animation, 'fps' | 'duration'>, t: number) {
  const frame = Math.round(t * a.fps);
  return Math.min(lastTime(a), Math.max(0, frame / a.fps));
}

/**
 * The animation as long as what is in it: actions, props' keys and camera points put past its end
 * lengthen it (up to MAX_DURATION).
 */
export function grown(scene: Scene): Scene {
  const a = scene.animation;
  if (!a) return scene;
  let last = a.duration;
  for (const x of a.actions) last = Math.max(last, x.start + x.duration);
  for (const keys of Object.values(a.props ?? {})) for (const k of keys) last = Math.max(last, k.t);
  for (const c of scene.cameras) if (c.kind === 'path') for (const p of c.points) last = Math.max(last, p.t);
  last = Math.min(MAX_DURATION, Math.round(last * a.fps) / a.fps);
  return last > a.duration + 1e-6 ? { ...scene, animation: { ...a, duration: last } } : scene;
}

/** Change a scene's animation's length, scaling the actions', props' keys', shots' and camera paths' times to fit. */
export function setDuration(scene: Scene, duration: number): Scene {
  const a = scene.animation;
  if (!a) return scene;
  const d = Math.min(MAX_DURATION, Math.max(0.2, duration));
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
  const shots = a.shots.map((x) => ({ ...x, start: snap(x.start) }));
  const cameras = scene.cameras.map((c) => (c.kind === 'path' ? { ...c, points: c.points.map((p) => ({ ...p, t: Math.round(p.t * s * 1000) / 1000 })) } : c));
  const markers = a.markers?.map((m) => ({ ...m, t: snap(m.t) }));
  const range = a.range && { from: snap(a.range.from), to: snap(a.range.to) };
  return { ...scene, cameras, animation: { ...a, duration: d, actions, ...(props ? { props } : {}), shots, ...(markers ? { markers } : {}), ...(range ? { range } : {}) } };
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
  return { ...a, actions, ...(props ? { props } : {}), ...(constraints?.length ? { constraints } : {}) };
}

/** A scene's cameras and coverage with figure ids replaced (after copying a scene with fresh ids). */
export function remapCameras(scene: Pick<Scene, 'cameras' | 'coverage'>, ids: Map<string, string>): Pick<Scene, 'cameras' | 'coverage'> {
  const figure = (id: string | undefined) => (id && ids.has(id) ? ids.get(id)! : undefined);
  const cameras = scene.cameras.map((c): Camera => {
    const { subject, also, ...rest } = structuredClone(c);
    const others = also?.filter((f) => ids.has(f)).map((f) => ids.get(f)!);
    const cam = { ...rest, ...(figure(subject) ? { subject: figure(subject) } : {}), ...(others?.length ? { also: others } : {}) } as Camera;
    if (cam.kind !== 'rig') return cam;
    const { toward, clear, ...r } = cam.rig;
    return { ...cam, rig: { ...r, ...(figure(toward) ? { toward: figure(toward) } : {}), ...(figure(clear) ? { clear: figure(clear) } : {}) } };
  });
  const coverage = scene.coverage;
  const roles = coverage && Object.entries(coverage.roles).filter(([, f]) => ids.has(f)).map(([r, f]) => [r, ids.get(f)!]);
  return { cameras, ...(coverage && roles!.length === Object.keys(coverage.roles).length ? { coverage: { id: coverage.id, roles: Object.fromEntries(roles!), ...(coverage.live ? { live: true } : {}) } } : {}) };
}

/**
 * An animation turned by `deg` about the vertical, its floor points moved by `place` (where the
 * turned point goes) and its times by `dt`: its actions' marks and keys, props' keys, holds.
 * (Cameras and shots are the scene's own: they are not moved.)
 */
export function placeAnimation(a: Animation, deg: number, place: (x: number, z: number) => [number, number], dt = 0): Animation {
  const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
  const at = (x: number, z: number): [number, number] => place(x, z).map(r3) as [number, number];
  const mark = (m: Mark): Mark => ({ at: at(m.at[0], m.at[1]), facing: Math.round(wrapDeg(m.facing + deg) * 10) / 10 || 0 });
  const vec = (v: Vec3): Vec3 => { const [x, z] = at(v[0], v[2]); return [x, v[1], z]; };
  const actions = a.actions.map((y): Action => {
    const target = y.target && 'at' in y.target ? { at: at(y.target.at[0], y.target.at[1]) } : y.target;
    const roles = y.roles.map((r) => (r.end ? { ...r, end: mark(r.end) } : r));
    const src = y.source;
    const source = src.kind === 'keys' ? { ...src, clip: placeClip(src.clip, deg, at, y.layer === 'correction') } : src.kind === 'travel' && src.via ? { ...src, via: src.via.map(mark) } : src;
    return { ...y, start: y.start + dt, roles, source, ...(target ? { target } : {}) };
  });
  const props = a.props && Object.fromEntries(Object.entries(a.props).map(([id, keys]) => [id, keys.map((k) => (k.hold
    ? { ...k, t: k.t + dt }
    : { ...k, t: k.t + dt, position: vec(k.position), rotation: [k.rotation[0], wrapDeg(k.rotation[1] + deg) || 0, k.rotation[2]] as PropKey['rotation'] }))]));
  const constraints = a.constraints?.map((c) => ({ ...c, start: c.start + dt, end: c.end + dt, ...('point' in c.target ? { target: { point: vec(c.target.point) } } : {}) }));
  return { ...a, actions, ...(props ? { props } : {}), ...(constraints ? { constraints } : {}) };
}

/* ---------- validation of untrusted data ---------- */

const SIZES: ShotSize[] = ['ews', 'ws', 'fs', 'mws', 'ms', 'mcu', 'cu', 'ecu'];

const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
const num = (x: unknown, fallback: number, min: number, max: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback);
const objects = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []).filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null);

/** A camera's move as it may be (#16): a kind it knows, its numbers in their ranges; else none. */
function moveOf(v: unknown): CameraMove | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const m = v as Record<string, unknown>;
  if (!MOVE_KINDS.includes(m.kind as MoveKind)) return undefined;
  return {
    kind: m.kind as MoveKind,
    ...(SIZES.includes(m.size as ShotSize) ? { size: m.size as ShotSize } : {}),
    ...(typeof m.by === 'number' && Number.isFinite(m.by) ? { by: num(m.by, 0, -1080, 1080) } : {}),
    ...(typeof m.to === 'string' && m.to ? { to: m.to.slice(0, 40) } : {}),
    ...(m.pace === 'even' || m.pace === 'snap' ? { pace: m.pace } : {}),
    ...(typeof m.wait === 'number' && m.wait > 0 ? { wait: num(m.wait, 0, 0, 60) } : {}),
    ...(typeof m.hold === 'number' && m.hold > 0 ? { hold: num(m.hold, 0, 0, 60) } : {}),
  };
}

/** A path point's own aim as it may be: a figure, or a spot. */
function pointAimOf(v: unknown): CameraPoint['aim'] | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.figure === 'string' && o.figure) return { figure: o.figure.slice(0, 40) };
  if (Array.isArray(o.point) && o.point.length === 3 && o.point.every((n) => typeof n === 'number' && Number.isFinite(n))) return { point: o.point.map((n) => num(n, 0, -1000, 1000)) as Vec3 };
  return undefined;
}

/** A scene's cameras, from storage or a file (a path camera needs a point; one that is not well made is left out). */
export function parseCameras(raw: unknown): Camera[] {
  const vec = (x: unknown): Vec3 => (Array.isArray(x) ? [0, 1, 2].map((i) => num(x[i], 0, -1000, 1000)) : [0, 0, 0]) as Vec3;
  const rigOf = (r: Record<string, unknown>): CameraRig => ({
    yaw: wrapDeg(num(r.yaw, 0, -1e4, 1e4)),
    pitch: num(r.pitch, 0, -89, 89),
    ...(r.turn === true ? { turn: true } : {}),
    ...(typeof r.roll === 'number' && r.roll ? { roll: num(r.roll, 0, -180, 180) } : {}),
    ...(moveOf(r.move) ? { move: moveOf(r.move)! } : {}),
    ...(typeof r.toward === 'string' && r.toward ? { toward: r.toward.slice(0, 40) } : {}),
    ...(typeof r.clear === 'string' && r.clear ? { clear: r.clear.slice(0, 40) } : {}),
    size: SIZES.includes(r.size as ShotSize) ? r.size as ShotSize : 'fs',
    ...(r.place === 'left' || r.place === 'right' || r.place === 'auto' ? { place: r.place } : {}),
    lens: num(r.lens, 35, 4, 1200),
    ...(typeof r.smooth === 'number' && r.smooth > 0 ? { smooth: num(r.smooth, 0, 0, 10) } : {}),
    ...(fixedOf(r.fixed) ? { fixed: fixedOf(r.fixed)! } : {}),
  });
  const fixedOf = (f: unknown): CameraRig['fixed'] | null => {
    if (typeof f !== 'object' || f === null) return null;
    const x = f as Record<string, unknown>;
    return { position: vec(x.position), look: vec(x.look), ...(x.aim === 'subject' ? { aim: 'subject' as const } : {}) };
  };
  const ids = new Set<string>();
  return objects(raw, 100).flatMap((x, i): Camera[] => {
    let id = str(x.id, 40) || uid('cam');
    if (ids.has(id)) id = uid('cam');
    ids.add(id);
    const base = {
      id, name: str(x.name, 80) || `Camera ${i + 1}`,
      ...(typeof x.subject === 'string' && x.subject ? { subject: x.subject.slice(0, 40) } : {}),
      ...(Array.isArray(x.point) && x.point.length === 3 && x.point.every((n) => typeof n === 'number' && Number.isFinite(n)) ? { point: vec(x.point) } : {}),
      ...(Array.isArray(x.also) && x.also.length ? { also: x.also.filter((f): f is string => typeof f === 'string').slice(0, 8).map((f) => f.slice(0, 40)) } : {}),
      ...(typeof x.made === 'string' && x.made ? { made: x.made.slice(0, 40) } : {}),
      ...(typeof x.shake === 'number' && x.shake > 0 ? { shake: num(x.shake, 0, 0, 1) } : {}),
    };
    if (x.kind === 'rig' && typeof x.rig === 'object' && x.rig !== null) return [{ ...base, kind: 'rig', rig: rigOf(x.rig as Record<string, unknown>) }];
    const points = objects(x.points, 500)
      .map((p) => ({
        t: Math.round(num(p.t, 0, 0, MAX_DURATION) * 1000) / 1000, position: vec(p.position), look: vec(p.look), lens: num(p.lens, 35, 4, 1200),
        ...(typeof p.roll === 'number' && Number.isFinite(p.roll) && p.roll ? { roll: num(p.roll, 0, -180, 180) } : {}),
        ...(p.stop === true ? { stop: true as const } : {}),
        ...(pointAimOf(p.aim) ? { aim: pointAimOf(p.aim)! } : {}),
      }))
      .sort((p, q) => p.t - q.t);
    if (x.kind !== 'path' || !points.length) return [];
    return [{
      ...base, kind: 'path', anchor: x.anchor === 'subject' ? 'subject' : 'world', aim: x.aim === 'point' || x.aim === 'path' ? x.aim : 'subject',
      points, ...(x.ease === 'linear' ? { ease: 'linear' as const } : {}), ...(x.pace === 'even' ? { pace: 'even' as const } : {}),
    }];
  });
}

/** An animation's shots, each filmed by one of `cameras` (the first, when its own is not there); at least one. */
export function parseShots(raw: unknown, duration: number, cameras: string[]): Shot[] {
  const shots: Shot[] = objects(raw, 200)
    .map((x, i) => ({
      id: str(x.id, 40) || `shot${i}`,
      start: num(x.start, 0, 0, duration),
      name: str(x.name, 80) || `Shot ${i + 1}`,
      camera: typeof x.camera === 'string' && cameras.includes(x.camera) ? x.camera : cameras[0],
      ...(typeof x.caption === 'string' && x.caption ? { caption: x.caption.slice(0, 500) } : {}),
      ...(typeof x.blend === 'number' && x.blend > 0 ? { blend: num(x.blend, 0, 0, 10) } : {}),
      ...(typeof x.pinned === 'number' && x.pinned > 0 ? { pinned: num(x.pinned, 0, 0, MAX_DURATION) } : {}),
    }))
    .sort((p, q) => p.start - q.start);
  if (!shots.length) return [{ id: 'main', start: 0, name: 'Shot 1', camera: cameras[0] }];
  shots[0].start = 0;
  return shots;
}

/** A prop's place as a key at time t (held props: relative to the hand). */
export function propKeyOf(p: Prop, t: number): PropKey {
  return { t, position: [...p.position], rotation: [...p.rotation], ...(p.hold ? { hold: { ...p.hold } } : {}) };
}
