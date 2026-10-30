import * as THREE from 'three';
import { basePoseAt, figurePoseAt, movesOf } from './evaluate';
import { wrapDeg } from './joints';
import { Rig } from './relations';
import { facingOf } from './pose';
import { viewDirection } from './render';
import { defaultCamera } from './doc';
import { setBlocks } from './sets';
import { shotSpans, spanAt, type ShotSpan } from './shots';
import { projectSettings } from './project';
import type { Camera, CameraMove, CameraPoint, CameraRig, FrameShape, PathCamera, Placement, RigCamera, Scene, ShotSize, Vec3, View } from './types';

/*
 * The cameras: how a "director" films the figures. A scene has cameras, at least one, each an
 * object of its own: a path camera passes through points in time, each with where it looks and
 * its lens (mm, full frame), fixed in the world (a track, a crane) or riding along with its
 * subject, looking at the subject, at a point, or along the way; a rig camera works out where it
 * is every frame from its subject's body, holding an angle and a shot size. An animation's shots
 * (lib/shots.ts) cut between the cameras, cutting or blending in; a still scene is filmed by its
 * first camera. Shot sizes (wide … close-up) and camera moves make cameras; they can be edited.
 */

/** The usual frame shape (16:9), for shots and exports that have none of their own. */
export const SHOT_ASPECT = 16 / 9;

/** The width over height of a frame shape. */
export const ASPECTS: Record<FrameShape, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '2.39:1': 2.39 };

/** The width over the height of the project's frame (lib/film.ts). */
export const frameAspect = () => ASPECTS[projectSettings().frame];

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/* ---------- lens ---------- */

/** Common focal lengths (mm). */
export const LENSES = [14, 18, 24, 35, 50, 85, 135, 200];

/** The frame's height on a full-frame (36 × 24 mm) sensor for a frame shape (mm). */
const sensorHeight = (aspect: number) => (aspect >= 1.5 ? 36 / aspect : 24);

/** The vertical field of view (degrees) of a lens, for a frame of this shape. */
export function lensFov(mm: number, aspect = SHOT_ASPECT) {
  return 2 * Math.atan(sensorHeight(aspect) / 2 / Math.max(1, mm)) * R2D;
}

/** The lens (mm) with this vertical field of view (degrees). */
export function fovLens(fov: number, aspect = SHOT_ASPECT) {
  return sensorHeight(aspect) / 2 / Math.tan((THREE.MathUtils.clamp(fov, 1, 170) * D2R) / 2);
}

/** The figure a camera films, if it has one and the figure is there. */
export function cameraSubject(scene: Scene, cam: Camera): string | undefined {
  return cam.subject && scene.figures.some((f) => f.id === cam.subject && !f.hidden) ? cam.subject : undefined;
}

/** The figures a camera frames: its subject and those it frames with it (none: everyone). */
export function cameraFigures(scene: Scene, cam: Camera): string[] | undefined {
  const subject = cameraSubject(scene, cam);
  if (!subject) return undefined;
  const shown = (id: string) => id !== subject && scene.figures.some((f) => f.id === id && !f.hidden);
  return [subject, ...(cam.also ?? []).filter(shown)];
}

/** The camera with this id, if the scene has it. */
export const cameraById = (scene: Pick<Scene, 'cameras'>, id: string | undefined) => (id ? scene.cameras.find((c) => c.id === id) ?? null : null);

/** The camera filming at t: the camera of the shot playing then, or (a still scene) the first. */
export function liveCamera(scene: Scene, t: number): Camera {
  const a = scene.animation;
  return (a && cameraById(scene, spanAt(a, t).shot.camera)) || scene.cameras[0];
}

/** The figure the camera live at t films, if it has one (and the figure is there). */
export function subjectAt(scene: Scene, t: number): string | undefined {
  return cameraSubject(scene, liveCamera(scene, t));
}

/** Where a camera's subject is at t, on the floor under its hips (several, or everyone: the middle of them). */
export function subjectPlace(scene: Scene, cam: Camera, t: number): THREE.Vector3 {
  const ids = cameraFigures(scene, cam) ?? scene.figures.filter((f) => !f.hidden).map((f) => f.id);
  const c = new THREE.Vector3();
  let n = 0;
  for (const f of ids) {
    const p = scene.animation ? figurePoseAt(scene, f, t)?.position : scene.figures.find((x) => x.id === f)?.position;
    if (!p) continue;
    c.x += p[0];
    c.z += p[2];
    n++;
  }
  return n ? c.divideScalar(n) : c;
}

/* ---------- the camera at a time ---------- */

/** Where the camera is, where it looks, its field of view (vertical, degrees) and lens (mm), and roll. */
export interface CameraView {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  lens: number;
  roll: number;
}

/** Smooth pseudo-random wobble in [-1, 1] for hand-held shake. */
function wobble(t: number, seed: number) {
  return Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 3.3 + seed * 2.1) * 0.3 + Math.sin(t * 7.9 + seed * 0.7) * 0.2;
}

/**
 * Where a path camera is at t (#16): through its points, as a smooth curve or along straight lines
 * (`ease`), coming to a stop at a point that says so (a corner), at the pace its points' times give
 * or (`pace` even) at an even speed along its whole path.
 */
export function samplePath(points: CameraPoint[], t: number, ease: PathCamera['ease'] = 'smooth', pace?: PathCamera['pace']): CameraPoint & { velocity: THREE.Vector3 } {
  const n = points.length;
  if (n === 1) return { ...points[0], t, velocity: new THREE.Vector3() };
  const time = pace === 'even' ? evenTime(points, ease, t) : t;
  const at = (x: number) => pathAt(points, x, ease);
  const p = at(time);
  const span = [points[0].t, points[n - 1].t];
  const ahead = at(Math.min(span[1], time + 0.02)).position;
  const behind = at(Math.max(span[0], time - 0.02)).position;
  return { ...p, t, velocity: new THREE.Vector3(...ahead).sub(new THREE.Vector3(...behind)) };
}

/** A path's point at time x: each value through the points (a smooth curve, its tangent 0 where it stops; or straight). */
function pathAt(points: CameraPoint[], x: number, ease: PathCamera['ease']): CameraPoint {
  const n = points.length;
  const times = points.map((p) => p.t);
  const time = THREE.MathUtils.clamp(x, times[0], times[n - 1]);
  let k = 0;
  while (k < n - 2 && times[k + 1] <= time) k++;
  const [a, b] = [points[k], points[k + 1]];
  const h = b.t - a.t;
  const u = h > 1e-9 ? (time - a.t) / h : 0;
  const before = points[Math.max(0, k - 1)];
  const after = points[Math.min(n - 1, k + 2)];
  const t0 = k > 0 ? before.t : a.t - h;
  const t3 = k + 2 < n ? after.t : b.t + h;
  const value = (f: (p: CameraPoint) => number) => {
    const [p0, p1, p2, p3] = [f(before), f(a), f(b), f(after)];
    if (ease === 'linear') return p1 + (p2 - p1) * u;
    // (A value held between two points stays put; a stop has no speed there.)
    if (h <= 1e-9 || Math.abs(p2 - p1) < 1e-9) return p1;
    const m1 = a.stop || b.t - t0 <= 1e-9 ? 0 : ((p2 - p0) / (b.t - t0)) * h;
    const m2 = b.stop || t3 - a.t <= 1e-9 ? 0 : ((p3 - p1) / (t3 - a.t)) * h;
    const [u2, u3] = [u * u, u * u * u];
    return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
  };
  const vec3 = (g: (p: CameraPoint) => Vec3) => [0, 1, 2].map((c) => value((p) => g(p)[c])) as Vec3;
  return { t: x, position: vec3((p) => p.position), look: vec3((p) => p.look), lens: Math.max(4, value((p) => p.lens)), roll: value((p) => p.roll ?? 0) };
}

// How far along a path each time takes it (its length so far), worked out once per path.
const lengths = new WeakMap<CameraPoint[], Map<string, { times: number[]; along: number[] }>>();

/** The time on a path at which it has gone as far as an even speed over its whole time takes it by t. */
function evenTime(points: CameraPoint[], ease: PathCamera['ease'], t: number) {
  let byEase = lengths.get(points);
  if (!byEase) lengths.set(points, (byEase = new Map()));
  const [t0, t1] = [points[0].t, points[points.length - 1].t];
  let table = byEase.get(ease ?? 'smooth');
  if (!table) {
    const steps = 200;
    const times = Array.from({ length: steps + 1 }, (_, i) => t0 + ((t1 - t0) * i) / steps);
    const along = [0];
    let last = new THREE.Vector3(...pathAt(points, times[0], ease).position);
    for (let i = 1; i <= steps; i++) {
      const next = new THREE.Vector3(...pathAt(points, times[i], ease).position);
      along.push(along[i - 1] + next.distanceTo(last));
      last = next;
    }
    byEase.set(ease ?? 'smooth', (table = { times, along }));
  }
  const total = table.along[table.along.length - 1];
  if (total < 1e-6 || t1 - t0 < 1e-9) return t;
  const want = (THREE.MathUtils.clamp(t, t0, t1) - t0) / (t1 - t0) * total;
  let i = 1;
  while (i < table.along.length - 1 && table.along[i] < want) i++;
  const [l0, l1] = [table.along[i - 1], table.along[i]];
  const f = l1 - l0 > 1e-9 ? (want - l0) / (l1 - l0) : 0;
  return table.times[i - 1] + (table.times[i] - table.times[i - 1]) * f;
}

// A rig camera's view, once worked out (per how the figures move and who is hidden, the camera and the time).
const rigViews = new WeakMap<object, WeakMap<Camera, Map<string, CameraView>>>();

/** What a camera sees at time t, whatever is cut to then. */
export function viewOf(scene: Scene, cam: Camera, t: number, aspect = frameAspect()): CameraView {
  if (cam.kind === 'rig') {
    const owner = movesOf(scene);
    let byCam = rigViews.get(owner);
    if (!byCam) rigViews.set(owner, (byCam = new WeakMap()));
    let views = byCam.get(cam);
    if (!views) byCam.set(cam, (views = new Map()));
    const key = `${scene.figures.filter((f) => f.hidden).map((f) => f.id).join()}@${t}:${aspect}`;
    let view = views.get(key);
    if (!view) {
      const v = rigView(scene, cam, cam.rig, t, aspect);
      // (Never in a wall nor under the floor: in front of a wall between it and what it looks at, #16.)
      const wall = setBlocks(scene.set, v.target, v.position);
      if (wall !== null) v.position.copy(v.target).addScaledVector(v.position.clone().sub(v.target).normalize(), Math.max(0.3, wall - 0.15));
      v.position.y = Math.max(0.15, v.position.y);
      view = shaken(cam, t, { position: v.position, target: v.target, fov: lensFov(v.lens, aspect), lens: v.lens, roll: v.roll });
      if (views.size > 2000) views.clear();
      views.set(key, view);
    }
    // (A copy: what is given is the caller's to change.)
    return { ...view, position: view.position.clone(), target: view.target.clone() };
  }
  const p = samplePath(cam.points, t, cam.ease, cam.pace);
  const place = cam.anchor === 'subject' || cam.aim === 'subject' ? subjectPlace(scene, cam, t) : null;
  const position = new THREE.Vector3(...p.position);
  if (cam.anchor === 'subject') position.add(place!);
  let target: THREE.Vector3;
  if (cam.aim === 'subject') target = new THREE.Vector3(...p.look).add(place!);
  else if (cam.aim === 'point') target = new THREE.Vector3(...p.look).add(cam.anchor === 'subject' ? place! : new THREE.Vector3());
  else target = p.velocity.lengthSq() > 1e-10 ? position.clone().add(p.velocity.clone().normalize()) : new THREE.Vector3(...p.look);
  return shaken(cam, t, { position, target, fov: lensFov(p.lens, aspect), lens: p.lens, roll: p.roll ?? 0 });
}

/** A hand-held camera wanders about where it looks. */
function shaken(cam: Camera, t: number, view: CameraView): CameraView {
  const shake = cam.shake ?? 0;
  if (shake <= 0) return view;
  const d = view.target.clone().sub(view.position);
  d.applyAxisAngle(new THREE.Vector3(0, 1, 0), shake * 1.6 * D2R * wobble(t, 1));
  const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
  if (side.lengthSq() > 0) d.applyAxisAngle(side, shake * 1.1 * D2R * wobble(t, 4));
  return { ...view, target: view.position.clone().add(d) };
}

/** What the shot of this span films at t. */
function spanView(scene: Scene, span: ShotSpan, t: number, aspect: number): CameraView {
  return viewOf(scene, cameraById(scene, span.shot.camera) ?? scene.cameras[0], t, aspect);
}

/** The camera filming a scene at time t: the camera of the shot playing then (blending in from the one before); a still scene's first. */
export function cameraAt(scene: Scene, t: number, aspect = frameAspect()): CameraView {
  const a = scene.animation;
  if (!a) return viewOf(scene, scene.cameras[0], 0, aspect);
  const span = spanAt(a, t);
  const view = spanView(scene, span, t, aspect);
  const blend = span.shot.blend ?? 0;
  if (blend <= 0 || span.index === 0 || t >= span.start + blend) return view;
  // Blending in: from what the shot before would have filmed now, eased.
  const before = spanView(scene, shotSpans(a)[span.index - 1], t, aspect);
  const u = THREE.MathUtils.smoothstep((t - span.start) / blend, 0, 1);
  return {
    position: before.position.clone().lerp(view.position, u),
    target: before.target.clone().lerp(view.target, u),
    fov: before.fov + (view.fov - before.fov) * u,
    lens: before.lens + (view.lens - before.lens) * u,
    roll: before.roll + (view.roll - before.roll) * u,
  };
}

/** Put a three.js camera where a camera view says. */
export function placeCamera(camera: THREE.PerspectiveCamera, view: CameraView, aspect: number) {
  camera.aspect = aspect;
  camera.fov = view.fov;
  camera.position.copy(view.position);
  const dir = view.target.clone().sub(view.position).normalize();
  // Rolled about the line of sight.
  camera.up.set(0, 1, 0).applyAxisAngle(dir, -view.roll * D2R);
  camera.lookAt(view.target);
  const dist = view.position.distanceTo(view.target);
  camera.near = Math.max(0.01, dist * 0.02);
  camera.far = dist + 200;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/* ---------- shot sizes ---------- */

export const SHOT_SIZES = [
  { id: 'ews', name: 'Extreme wide', short: 'EWS' },
  { id: 'ws', name: 'Wide', short: 'WS' },
  { id: 'fs', name: 'Full', short: 'FS' },
  { id: 'mws', name: 'Medium wide', short: 'MWS' },
  { id: 'ms', name: 'Medium', short: 'MS' },
  { id: 'mcu', name: 'Medium close-up', short: 'MCU' },
  { id: 'cu', name: 'Close-up', short: 'CU' },
  { id: 'ecu', name: 'Extreme close-up', short: 'ECU' },
] as const;
export type { Placement, ShotSize };

/** What each kind of move is called (#16). */
export const MOVE_NAMES: Record<CameraMove['kind'], string> = {
  push: 'Push', arc: 'Arc', crane: 'Crane', truck: 'Truck', pan: 'Pan', tilt: 'Tilt', zoom: 'Zoom', dolly: 'Dolly zoom', roll: 'Roll',
};

/** A rig camera's rule in a few words, e.g. "arc on Ben, MCU, 85 mm". */
export function rigRule(scene: Scene, cam: RigCamera): string {
  const who = cameraFigures(scene, cam)?.map((id) => scene.figures.find((f) => f.id === id)!.name).join(' and ') ?? 'everyone';
  const size = SHOT_SIZES.find((x) => x.id === cam.rig.size)!.short;
  const move = cam.rig.move ? MOVE_NAMES[cam.rig.move.kind].toLowerCase() : 'holds';
  return `${move} on ${who}, ${size}, ${Math.round(cam.rig.lens)} mm`;
}

/** How much of the body each shot size holds: from and to, as shares of the body's height down from the top of the head. */
const SPAN: Record<ShotSize, [number, number]> = {
  ews: [-1.6, 2.6], ws: [-0.45, 1.45], fs: [-0.08, 1.06], mws: [-0.07, 0.74],
  ms: [-0.06, 0.55], mcu: [-0.06, 0.4], cu: [-0.05, 0.27], ecu: [0.02, 0.14],
};

/** A body as a camera frames it: the middle of it on the floor, the top of the head, the height, and which way it faces (degrees). */
interface Body {
  x: number; z: number; top: number; height: number; facing: number;
  /** Where its head joint is, and its standing height (a lying body is low, but a close-up still holds its head). */
  head: { x: number; y: number; z: number };
  stature: number;
  /** Half its extent across the floor, along x and z (a group is wide). */
  half: { x: number; z: number };
}

let rig: Rig | null = null;
// Each figure is measured once per animation (or still cast) and time.
const boxes = new WeakMap<object, Map<string, { box: THREE.Box3; facing: number; head: { x: number; y: number; z: number }; stature: number }>>();

/** A figure's extent at t (the points that bound it), and which way it faces. */
function extent(scene: Scene, id: string, t: number) {
  const owner: object = scene.animation ?? scene.figures;
  let cache = boxes.get(owner);
  if (!cache) boxes.set(owner, (cache = new Map()));
  const key = `${id}@${t}`;
  let e = cache.get(key);
  if (!e) {
    rig ??= new Rig();
    const f = figurePoseAt(scene, id, t);
    const box = new THREE.Box3();
    if (f) rig.model(f).forEachPoint((p) => box.expandByPoint(p));
    const head = f ? rig.model(f).joints.head.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
    e = { box, facing: f ? facingOf(f.bones) : 0, head: { x: head.x, y: head.y, z: head.z }, stature: f?.body.height ?? 1.7 };
    if (cache.size > 20000) cache.clear();
    cache.set(key, e);
  }
  return e;
}

/** Figures' body at t (all of them together; facing as the first does; none: everyone, facing the front). */
function measure(scene: Scene, ids: string[] | undefined, t: number): Body {
  const box = new THREE.Box3();
  const each = (ids ?? scene.figures.filter((f) => !f.hidden).map((f) => f.id)).map((f) => extent(scene, f, t));
  for (const e of each) box.union(e.box);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 1.8, 0.3));
  const middle = box.getCenter(new THREE.Vector3());
  return {
    x: middle.x, z: middle.z, top: box.max.y, height: Math.max(0.3, box.max.y - Math.max(0, box.min.y)), facing: ids && each[0] ? each[0].facing : 0,
    head: ids && each[0] ? each[0].head : { x: middle.x, y: box.max.y - 0.2, z: middle.z },
    stature: ids && each[0] ? each[0].stature : Math.max(0.3, box.max.y - Math.max(0, box.min.y)),
    half: { x: (box.max.x - box.min.x) / 2, z: (box.max.z - box.min.z) / 2 },
  };
}

/** A camera's subject's body at t (with those it frames with it; everyone: all of them). */
const bodyAt = (scene: Scene, cam: Camera, t: number) => measure(scene, cameraFigures(scene, cam), t);

/**
 * A figure's body at t smoothed over `window` seconds: the frames around t weighed by how near
 * they are, so it is the same however t is reached (playing, scrubbing or exporting).
 */
function smoothBody(scene: Scene, ids: string[] | undefined, t: number, window: number): Body {
  const a = scene.animation;
  if (!a || window <= 0) return measure(scene, ids, t);
  const half = window / 2;
  // (Sampled about ten times over the window, at times fixed whatever t is: each a whole pose of
  // everyone it frames, shared with the times near it.)
  const step = Math.max(1 / a.fps, window / 10);
  const sum = { x: 0, z: 0, top: 0, height: 0, sin: 0, cos: 0, hx: 0, hy: 0, hz: 0, stature: 0, wx: 0, wz: 0, w: 0 };
  for (let i = Math.ceil((t - half) / step); i <= Math.floor((t + half) / step); i++) {
    const at = Math.min(a.duration, Math.max(0, i * step));
    const w = 1 - Math.abs(i * step - t) / half;
    if (w <= 0) continue;
    const b = measure(scene, ids, at);
    sum.x += b.x * w;
    sum.z += b.z * w;
    sum.hx += b.head.x * w;
    sum.hy += b.head.y * w;
    sum.hz += b.head.z * w;
    sum.stature += b.stature * w;
    sum.wx += b.half.x * w;
    sum.wz += b.half.z * w;
    sum.top += b.top * w;
    sum.height += b.height * w;
    sum.sin += Math.sin(b.facing * D2R) * w;
    sum.cos += Math.cos(b.facing * D2R) * w;
    sum.w += w;
  }
  if (!sum.w) return measure(scene, ids, t);
  return {
    x: sum.x / sum.w, z: sum.z / sum.w, top: sum.top / sum.w, height: sum.height / sum.w, facing: Math.atan2(sum.sin, sum.cos) * R2D,
    head: { x: sum.hx / sum.w, y: sum.hy / sum.w, z: sum.hz / sum.w }, stature: sum.stature / sum.w,
    half: { x: sum.wx / sum.w, z: sum.wz / sum.w },
  };
}

/** Where a camera looks from and at to hold a body at a shot size from an angle (world yaw, pitch) through a lens. */
function compose(body: Body, size: ShotSize | SizeBlend, yaw: number, pitch: number, lens: number, place: Placement | undefined, aspect: number) {
  // (Between two sizes, a part of the way: a push in, a pull out.)
  const [from, to, u] = typeof size === 'string' ? [size, size, 0] : [size.from, size.to, size.u];
  const mix = (x: number, y: number) => x + (y - x) * u;
  const a = mix(SPAN[from][0], SPAN[to][0]);
  const b = mix(SPAN[from][1], SPAN[to][1]);
  // A close shot is measured from the head and the standing height, a wide one from the whole
  // body as it is (standing, the two agree; lying, the close-up still holds the head).
  const NEAR = { ews: 0, ws: 0, fs: 0, mws: 0.25, ms: 0.5, mcu: 1, cu: 1, ecu: 1 } as Record<ShotSize, number>;
  const near = mix(NEAR[from], NEAR[to]);
  const crown = body.head.y + 0.13 * body.stature;
  const head = body.top + (crown - body.top) * near;
  const height = body.height + (body.stature - body.height) * near;
  const top = head - a * height;
  const bottom = head - b * height;
  const tanV = Math.tan((lensFov(lens, aspect) * D2R) / 2);
  // A wide shot holds the body's width too (a group side by side, arms out).
  const across = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDirection({ yaw, pitch }).setY(0).normalize());
  const width = Math.abs(across.x) * body.half.x + Math.abs(across.z) * body.half.z;
  const dir = viewDirection({ yaw, pitch });
  // How far the body reaches towards the camera (a group one behind another is deep): a wide shot
  // is framed from its front, and no shot stands inside it.
  const depth = Math.abs(dir.x) * body.half.x + Math.abs(dir.z) * body.half.z;
  const fit = Math.max((top - bottom) / 2 / tanV, near ? 0 : (width * 1.1) / (tanV * aspect));
  const dist = near ? Math.max(fit, depth + 0.3) : fit + depth;
  // Across the floor too, a close shot centres on the head, a wide one on the whole body.
  const look = new THREE.Vector3(body.x + (body.head.x - body.x) * near, (top + bottom) / 2, body.z + (body.head.z - body.z) * near);
  if (place && place !== 'center') {
    // On a third: the subject a sixth of the frame's width off the middle.
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    look.addScaledVector(right, (place === 'left' ? 1 : -1) * (dist * tanV * aspect) / 3);
  }
  return { position: look.clone().addScaledVector(dir, dist), look };
}

/** A shot size a part of the way to another (a move's push or pull). */
type SizeBlend = { from: ShotSize; to: ShotSize; u: number };

/* ---------- cameras placing themselves (rigs) ---------- */

/**
 * The run of shots a camera's move plays over at t (shots one after another with it; between its
 * runs, the last; before its first, none; filming none, the whole animation). None in a still.
 */
export function moveRun(scene: Scene, cam: Camera, t: number): { start: number; end: number } | null {
  const a = scene.animation;
  if (!a) return null;
  const first = scene.cameras[0]?.id;
  const runs: { start: number; end: number }[] = [];
  for (const s of shotSpans(a)) {
    if ((s.shot.camera ?? first) !== cam.id) continue;
    const last = runs.at(-1);
    if (last && Math.abs(last.end - s.start) < 1e-6) last.end = s.end;
    else runs.push({ start: s.start, end: s.end });
  }
  return runs.find((s) => t >= s.start && t < s.end) ?? runs.filter((s) => s.start <= t).at(-1) ?? (runs.length ? null : { start: 0, end: a.duration });
}

/**
 * How far a camera's move has gone at t (0–1): over the run of shots it films then (shots one
 * after another with it are one run: a cut in it changes nothing; the cut coming back to it after
 * another camera plays the move again), the last run between its runs; before its first, not yet;
 * filming none, over the whole animation; at its pace. A still scene does not move.
 */
export function moveProgress(scene: Scene, cam: Camera, t: number, m: Pick<CameraMove, 'pace' | 'wait' | 'hold'>): number {
  const span = moveRun(scene, cam, t);
  if (!span) return 0;
  const pace = m.pace;
  // (Its wait and hold within the run, leaving the move a tenth of it at least.)
  const length = span.end - span.start;
  const wait = Math.min(m.wait ?? 0, length * 0.9);
  const hold = Math.min(m.hold ?? 0, Math.max(0, length * 0.9 - wait));
  const x = THREE.MathUtils.clamp((t - span.start - wait) / Math.max(1e-6, length - wait - hold), 0, 1);
  if (pace === 'even') return x;
  if (pace === 'snap') return THREE.MathUtils.smoothstep(x, 0.55, 0.75);
  return THREE.MathUtils.smoothstep(x, 0, 1);
}

/** When a camera's angle is measured from: the start of the first shot it films (else the start). */
function firstFilmed(scene: Scene, cam: Camera) {
  const a = scene.animation;
  return a ? shotSpans(a).find((s) => s.shot.camera === cam.id)?.start ?? 0 : 0;
}

/**
 * Which way a rig's angles are measured from at t (world degrees): the subject's facing, or the
 * direction from it towards another figure, then (turning) or at the camera's first shot.
 */
function rigHeading(scene: Scene, cam: Camera, r: CameraRig, t: number, body: Body, smooth = r.smooth ?? 0): number {
  const subject = cameraSubject(scene, cam);
  const at = r.turn ? t : firstFilmed(scene, cam);
  const from = at === t ? body : smoothBody(scene, cameraFigures(scene, cam), at, smooth);
  const other = r.toward && r.toward !== subject && scene.figures.some((f) => f.id === r.toward && !f.hidden) ? smoothBody(scene, [r.toward], at, smooth) : null;
  return other ? Math.atan2(other.x - from.x, other.z - from.z) * R2D : from.facing;
}

/** Where a rig camera is at t, worked out from its subject's body. */
// Where a clean single puts its subject, once worked out (per how the figures move, camera, subject and rig).
const placements = new WeakMap<object, Map<string, Placement | undefined>>();

function rigView(scene: Scene, cam: Camera, r: CameraRig, t: number, aspect: number) {
  const subject = cameraFigures(scene, cam);
  const other = r.clear && r.clear !== cam.subject && scene.figures.some((f) => f.id === r.clear && !f.hidden) ? r.clear : null;
  const away = r.yaw < 0 ? -1 : 1;
  /**
   * Where it films from at a time, turned `extra` degrees round its subject from its rig's own
   * angle (`rough`: from where they are then, not eased over its smoothing: to choose how far round).
   */
  const turnedBy = (time: number, place: Placement | undefined, rough = false, o: { size?: ShotSize | SizeBlend; pitch?: number; lens?: number } = {}) => {
    const smooth = rough ? 0 : r.smooth ?? 0;
    const body = smoothBody(scene, subject, time, smooth);
    const yaw = rigHeading(scene, cam, r, time, body, smooth) + r.yaw;
    return (extra: number) => compose(body, o.size ?? r.size, yaw + extra, o.pitch ?? r.pitch, o.lens ?? r.lens, place, aspect);
  };
  const solve = (time: number, place: Placement | undefined, at = turnedBy(time, place), them = other ? smoothBody(scene, [other], time, r.smooth ?? 0) : null) => {
    if (!them || !seen(at(0), them, r.lens, aspect)) return { shot: at(0), clear: true, extra: 0 };
    // Round, away from the other, by the least angle that leaves them out (found by halving; it
    // moves smoothly as they do).
    let [lo, hi] = [0, 70];
    if (seen(at(away * hi), them, r.lens, aspect)) return { shot: at(away * hi), clear: false, extra: away * hi };
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (seen(at(away * mid), them, r.lens, aspect)) lo = mid;
      else hi = mid;
    }
    return { shot: at(away * hi), clear: true, extra: away * hi };
  };
  // Where the subject sits: as asked, unless that leaves no room to keep the other out (they
  // stand too close), then centred, then on the other third; chosen once, at the camera's first
  // shot, so it does not jump about.
  let place = r.place;
  if (other) {
    const owner = movesOf(scene);
    let known = placements.get(owner);
    if (!known) placements.set(owner, (known = new Map()));
    const key = `${cam.id}:${subject?.join()}:${JSON.stringify(r)}:${aspect}`;
    if (!known.has(key)) {
      const t0 = firstFilmed(scene, cam);
      const flip: Placement | undefined = r.place === 'left' ? 'right' : r.place === 'right' ? 'left' : undefined;
      known.set(key, [r.place, undefined, flip].find((p) => solve(t0, p).clear) ?? flip);
    }
    place = known.get(key);
  }
  // How far round its subject it goes: as far as keeps the other out (a single), and further if
  // need be to keep out of anyone's way (never in their reach, nobody right in front of the lens;
  // else as far from them as it gets), one way round only. Worked out every half second from where
  // they are then (each kept while the figures move the same), held as far as any time near needs,
  // then eased over a second: it arcs round, from a little before it must; no jump in the middle of
  // a shot. Only the times around the one asked for are worked out.
  const owner = movesOf(scene);
  let swung = swings.get(owner);
  if (!swung) swings.set(owner, (swung = new Map()));
  const hidden = scene.figures.filter((f) => f.hidden).map((f) => f.id).join();
  const key = `${cam.id}:${subject?.join()}:${hidden}:${JSON.stringify(r)}:${aspect}:${place}`;
  let samples = swung.get(key);
  if (!samples) swung.set(key, (samples = new Map()));
  const raw = (i: number) => {
    let x = samples.get(i);
    if (x === undefined) samples.set(i, (x = turnAt(i * SWING_STEP)));
    return x;
  };
  const turnAt = (time: number) => {
    const at = turnedBy(time, place, true);
    const them = other ? smoothBody(scene, [other], time, 0) : null;
    const out = (x: number) => !them || !seen(at(x), them, r.lens, aspect);
    const keepOut = solve(time, place, at, them).extra;
    // (Where they stand, from what they do: their holds and idle life do not move them.)
    const others = scene.figures.filter((f) => !f.hidden && !(subject ?? []).includes(f.id)).map((f) => (basePoseAt(scene, f.id, time) ?? f).position);
    if (!others.length) return keepOut;
    const tries = [0, 20, 40, 60, 90].map((x) => keepOut + away * x);
    const unblocked = tries.filter((x) => !blocked(at(x), others));
    // (Nothing keeps out of everyone's way and the other out of a single: as the single keeps the
    // other out as best it can, unless that is in someone's way; else as far from them as it gets.)
    return unblocked.find(out)
      ?? (other && (unblocked.includes(keepOut) || !unblocked.length) ? keepOut : unblocked[0])
      ?? tries.reduce((x, y) => (clearance(at(y), others) > clearance(at(x), others) ? y : x));
  };
  const reach = Math.round(SWING_EASE / 2 / SWING_STEP);
  const held = (i: number) => {
    let x = 0;
    for (let j = Math.max(0, i - reach); j <= i + reach; j++) if (Math.abs(raw(j)) > Math.abs(x)) x = raw(j);
    return x;
  };
  const eased = (i: number) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - reach); j <= i + reach; j++, n++) sum += held(j);
    return sum / n;
  };
  const k = Math.max(0, t / SWING_STEP);
  const i = Math.floor(k);
  const swing = eased(i) + (eased(i + 1) - eased(i)) * (k - i);
  return moved(scene, cam, r, t, aspect, place, swing, turnedBy);
}

/**
 * A rig's shot at t, moved as far through its move as the shot has gone (#16): round its subject
 * (arc), up or down (crane), closer or wider (a push or pull; any move may end at another size),
 * the lens changed keeping the size (dolly) or not (zoom), sideways (truck), turned away (pan,
 * tilt: to another figure, or by degrees) or about the line of sight (roll).
 */
function moved(
  scene: Scene, cam: Camera, r: CameraRig, t: number, aspect: number, place: Placement | undefined, swing: number,
  turnedBy: (time: number, place: Placement | undefined, rough?: boolean, o?: { size?: ShotSize | SizeBlend; pitch?: number; lens?: number }) => (extra: number) => { position: THREE.Vector3; look: THREE.Vector3 },
) {
  const m = r.move;
  const u = m ? moveProgress(scene, cam, t, m) : 0;
  const roll = (r.roll ?? 0) + (m?.kind === 'roll' ? u * (m.by ?? 0) : 0);
  if (!m || u <= 0) {
    const shot = turnedBy(t, place)(swing);
    return { position: shot.position, target: shot.look, lens: r.lens, roll };
  }
  const by = m.by ?? 0;
  const size = m.size && m.size !== r.size ? { from: r.size, to: m.size, u } : r.size;
  const lensTo = m.kind === 'zoom' || m.kind === 'dolly' ? Math.min(400, Math.max(8, by || r.lens)) : r.lens;
  const lens = r.lens + (lensTo - r.lens) * u;
  const shot = turnedBy(t, place, false, {
    size,
    pitch: m.kind === 'crane' ? THREE.MathUtils.clamp(r.pitch + u * by, -80, 88) : r.pitch,
    // (A dolly keeps the size as the lens changes: the camera goes nearer or farther; a zoom stays put.)
    lens: m.kind === 'dolly' ? lens : r.lens,
  })(swing + (m.kind === 'arc' ? u * by : 0));
  const position = shot.position.clone();
  let target = shot.look.clone();
  const dir = target.clone().sub(position);
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  if (m.kind === 'truck') {
    position.addScaledVector(right, u * by);
    target.addScaledVector(right, u * by);
  } else if (m.kind === 'pan' && m.to && scene.figures.some((f) => f.id === m.to && !f.hidden)) {
    // To another figure: where a shot of them from here would look.
    const them = smoothBody(scene, [m.to], t, r.smooth ?? 0);
    const there = compose(them, typeof size === 'string' ? size : size.to, angleOf({ position, target, fov: 0, lens, roll: 0 }).yaw, r.pitch, r.lens, undefined, aspect).look;
    target = target.lerp(there, u);
  } else if (m.kind === 'pan') {
    target = position.clone().add(dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), -u * by * D2R));
  } else if (m.kind === 'tilt') {
    target = position.clone().add(dir.applyAxisAngle(right, u * by * D2R));
  }
  return { position, target, lens: m.kind === 'zoom' || m.kind === 'dolly' ? lens : r.lens, roll };
}

/** How far a camera is from the nearest of some people (where they stand). */
function clearance(shot: { position: THREE.Vector3 }, people: Vec3[]) {
  return Math.min(...people.map((p) => Math.hypot(p[0] - shot.position.x, p[2] - shot.position.z)));
}

// How far a rig camera is swung round its subject to keep out of people's way at each step of
// SWING_STEP seconds, worked out as it is needed (per how the figures move, camera and rig).
const swings = new WeakMap<object, Map<string, Map<number, number>>>();
const SWING_STEP = 0.5;
const SWING_EASE = 1;

/**
 * Whether a camera stands in someone's reach (where they stand, `people`: an arm swung would cross
 * the lens) or has them right in front of it: across its line of sight within a metre and a half
 * of it, between it and what it films.
 */
function blocked(shot: { position: THREE.Vector3; look: THREE.Vector3 }, people: Vec3[]) {
  const [cx, cz] = [shot.position.x, shot.position.z];
  const [dx, dz] = [shot.look.x - cx, shot.look.z - cz];
  const len = Math.hypot(dx, dz) || 1;
  return people.some((p) => {
    const [px, pz] = [p[0] - cx, p[2] - cz];
    if (Math.hypot(px, pz) < 0.7) return true;
    const along = (px * dx + pz * dz) / len;
    if (along <= 0 || along > Math.min(1.5, len - 0.3)) return false;
    return Math.abs(px * dz - pz * dx) / len < 0.45;
  });
}

/** Whether any of a body (its chest, give or take its shoulders) is in a camera's frame. */
function seen(shot: { position: THREE.Vector3; look: THREE.Vector3 }, body: Body, lens: number, aspect: number) {
  const forward = shot.look.clone().sub(shot.position).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const to = new THREE.Vector3(body.x, body.top - body.height * 0.3, body.z).sub(shot.position);
  const depth = to.dot(forward);
  if (depth <= 0.05) return false;
  const tanH = Math.tan((lensFov(lens, aspect) * D2R) / 2) * aspect;
  return Math.abs(to.dot(right)) - 0.25 < tanH * depth;
}

/** The rig that films as a camera view does at t (its angle from the subject, its size and lens). */
export function rigFrom(scene: Scene, cam: Camera, view: CameraView, t: number, o: Partial<CameraRig> = {}): CameraRig {
  const r: CameraRig = { yaw: 0, pitch: 0, size: 'fs', lens: Math.round(view.lens), smooth: 0.5, ...(cam.kind === 'rig' ? cam.rig : {}), ...o };
  const b = smoothBody(scene, cameraFigures(scene, cam), t, r.smooth ?? 0);
  const { yaw, pitch } = angleOf(view);
  const round = (v: number) => Math.round(v * 10) / 10;
  return { ...r, yaw: round(wrapDeg(yaw - rigHeading(scene, cam, r, t, b))), pitch: round(pitch), size: o.size ?? sizeOf(scene, cam, t, view) };
}

/**
 * A point of a camera's path framing its subject at t at a shot size: the camera looking from
 * `yaw` and `pitch` (as a View: 0 = from the front, + from its left; + from above) through
 * `lens`, as far away as that size takes. In the camera's own terms (anchor and aim).
 */
export function framePoint(scene: Scene, cam: PathCamera, t: number, size: ShotSize, o: { yaw: number; pitch: number; lens: number; place?: Placement; aspect?: number }): CameraPoint {
  const { position, look } = compose(bodyAt(scene, cam, t), size, o.yaw, o.pitch, o.lens, o.place, o.aspect ?? frameAspect());
  return pointIn(scene, cam, t, position, look, o.lens);
}

/** A camera position and look point in the world at t → a path point in a camera's own terms. */
export function pointIn(scene: Scene, cam: PathCamera, t: number, position: THREE.Vector3, look: THREE.Vector3, lens: number, roll = 0): CameraPoint {
  const place = subjectPlace(scene, cam, t);
  const p = cam.anchor === 'subject' ? position.clone().sub(place) : position;
  const l = cam.aim === 'subject' || (cam.aim === 'point' && cam.anchor === 'subject') ? look.clone().sub(place) : look;
  const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
  return {
    t: Math.round(t * 1000) / 1000,
    position: p.toArray().map(r3) as Vec3,
    look: l.toArray().map(r3) as Vec3,
    lens: Math.round(lens * 10) / 10,
    ...(roll ? { roll: Math.round(roll * 10) / 10 } : {}),
  };
}

/** The shot size a camera view holds a camera's subject at (the nearest). */
export function sizeOf(scene: Scene, cam: Camera, t: number, view: CameraView): ShotSize {
  const body = bodyAt(scene, cam, t);
  const dist = view.position.distanceTo(view.target);
  const seen = 2 * dist * Math.tan((view.fov * D2R) / 2) / body.height;
  let best: ShotSize = 'fs';
  for (const s of SHOT_SIZES) {
    const [a, b] = SPAN[s.id];
    if (Math.abs(Math.log(seen / (b - a))) < Math.abs(Math.log(seen / (SPAN[best][1] - SPAN[best][0])))) best = s.id;
  }
  return best;
}

/** The camera's angle onto its target (as a View's yaw and pitch). */
export function angleOf(view: CameraView): { yaw: number; pitch: number } {
  const d = view.position.clone().sub(view.target).normalize();
  return { yaw: Math.atan2(d.x, d.z) * R2D, pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) * R2D };
}

/* ---------- camera moves ---------- */

/** Groups of the camera moves: where the camera goes. */
export const CAMERA_GROUPS = ['Fixed', 'Pan & tilt', 'Towards & away', 'Around & up', 'Following', 'Classic shots'] as const;

/** What a move works from: the camera, the time it films over, and the angle and lens to start from. */
export interface MoveContext {
  scene: Scene;
  camera: Camera;
  start: number;
  end: number;
  base: View;
}

/** What a camera is, apart from who it is: a path (where, looking at what, its points) or a rig; and its shake. */
export type CameraForm = (Pick<PathCamera, 'kind' | 'anchor' | 'aim' | 'points' | 'ease'> | Pick<RigCamera, 'kind' | 'rig'>) & { shake?: number };

export interface MovePreset {
  id: string;
  name: string;
  group: (typeof CAMERA_GROUPS)[number];
  description: string;
  /** The camera for this move. */
  apply(c: MoveContext): CameraForm;
}

/** Who a camera is (its name, what it films, how much it shakes), whatever it is. */
const who = (cam: Camera) => {
  const { id, name, subject, also, made } = cam;
  return { id, name, ...(subject ? { subject } : {}), ...(also ? { also } : {}), ...(made ? { made } : {}) };
};

/** A camera of another form (its shake as the form has it). */
export const reform = (cam: Camera, form: CameraForm): Camera => ({ ...who(cam), ...form } as Camera);

/**
 * A framing for a move (#16): its subject from the angle it is filmed from now (`turn` degrees
 * further round; a pitch, if given, its own), as the move asks: its size, lens, its move.
 */
function framed(c: MoveContext, o: Partial<CameraRig> & { size: ShotSize }, turn = 0): CameraForm {
  const look = new THREE.Vector3(0, 1, 0);
  const view: CameraView = { position: look.clone().addScaledVector(viewDirection(c.base), 3), target: look, fov: c.base.fov, lens: fovLens(c.base.fov), roll: 0 };
  const from = rigFrom(c.scene, c.camera, view, c.start, { size: o.size });
  const rig: CameraRig = { yaw: wrapDeg(from.yaw + turn), pitch: from.pitch, lens: 50, smooth: 0.5, ...o };
  return { kind: 'rig', rig };
}

/** A framing at its own angle on the subject (degrees from its front; a following shot), as the move asks. */
const rigged = (rig: CameraRig): CameraForm => ({ kind: 'rig', rig });

/** Another figure than the camera's subject, to pan to (none: the move turns by degrees). */
const another = (c: MoveContext) => c.scene.figures.find((f) => !f.hidden && f.id !== cameraSubject(c.scene, c.camera))?.id;

/** Ready-made camera moves: a framing and a move (#16), each over a shot's time. */
export const CAMERA_MOVES: MovePreset[] = [
  { id: 'static', group: 'Fixed', name: 'Locked-off wide', description: 'A fixed camera that shows everything', apply: (c) => framed(c, { size: 'ws' }) },
  { id: 'push', group: 'Towards & away', name: 'Push in', description: 'Slowly dolly towards the figures', apply: (c) => framed(c, { size: 'fs', move: { kind: 'push', size: 'mcu' } }) },
  { id: 'pull', group: 'Towards & away', name: 'Pull out', description: 'Start close and reveal the whole scene', apply: (c) => framed(c, { size: 'mcu', move: { kind: 'push', size: 'ws' } }) },
  { id: 'orbit90', group: 'Around & up', name: 'Arc 90°', description: 'Circle a quarter of the way around', apply: (c) => framed(c, { size: 'mws', pitch: c.base.pitch + 4, move: { kind: 'arc', by: 90 } }, -45) },
  { id: 'orbit360', group: 'Around & up', name: 'Orbit 360°', description: 'A full turntable around the figures', apply: (c) => framed(c, { size: 'fs', pitch: c.base.pitch + 6, move: { kind: 'arc', by: 360, pace: 'even' } }) },
  { id: 'crane', group: 'Around & up', name: 'Crane up', description: 'Rise from eye level to a high angle', apply: (c) => framed(c, { size: 'fs', pitch: -2, move: { kind: 'crane', by: 50 } }) },
  { id: 'hero', group: 'Fixed', name: 'Low-angle hero', description: 'Look up at the figures with a wide lens', apply: (c) => framed(c, { size: 'mws', pitch: -14, lens: 35, move: { kind: 'push', size: 'ms' } }, -15) },
  { id: 'tracking', group: 'Following', name: 'Tracking from the left', description: 'Move alongside from the left, keeping a medium wide shot', apply: () => rigged({ yaw: 90, pitch: 3, size: 'mws', lens: 50, smooth: 0.6 }) },
  { id: 'follow', group: 'Following', name: 'Follow behind', description: 'Behind the subject, turning as it turns', apply: () => rigged({ yaw: 180, pitch: 10, turn: true, size: 'fs', lens: 35, smooth: 0.8 }) },
  { id: 'lead', group: 'Following', name: 'Leading shot', description: 'Ahead of the subject, looking back at it as it comes', apply: () => rigged({ yaw: 10, pitch: 2, turn: true, size: 'ms', lens: 50, smooth: 0.8 }) },
  { id: 'circle', group: 'Around & up', name: 'Circle the subject', description: 'Half way around the subject, holding a medium shot', apply: () => rigged({ yaw: -90, pitch: 6, size: 'ms', lens: 40, smooth: 0.5, move: { kind: 'arc', by: 180, pace: 'even' } }) },
  { id: 'vertigo', group: 'Classic shots', name: 'Hitchcock zoom', description: 'Vertigo’s dolly zoom: the camera pulls back as the lens zooms in, the figure keeps its size while the world behind it closes in', apply: (c) => framed(c, { size: 'fs', lens: 22, move: { kind: 'dolly', by: 90 } }) },
  { id: 'jaws', group: 'Classic shots', name: 'Jaws dolly zoom', description: 'The other way, as in Jaws: the camera pushes in as the lens widens, the world behind the figure stretches away', apply: (c) => framed(c, { size: 'ms', lens: 85, move: { kind: 'dolly', by: 20 } }) },
  { id: 'bullet-time', group: 'Classic shots', name: 'Bullet time', description: 'The Matrix: a fast half-circle round the subject, as if time stood still', apply: () => rigged({ yaw: -90, pitch: 4, size: 'fs', lens: 35, smooth: 0, move: { kind: 'arc', by: 180, pace: 'even' } }) },
  { id: 'snorricam', group: 'Classic shots', name: 'Snorricam', description: 'Requiem for a Dream: the camera strapped to the actor, the face fixed in frame while the world swings round it', apply: () => rigged({ yaw: 0, pitch: 0, turn: true, size: 'mcu', lens: 24, smooth: 0 }) },
  { id: 'one-point', group: 'Classic shots', name: 'One-point push', description: 'Kubrick’s symmetry: straight on, a wide lens, a slow push down the middle', apply: () => rigged({ yaw: 0, pitch: 2, size: 'ws', lens: 18, smooth: 0.5, move: { kind: 'push', size: 'fs', pace: 'even' } }) },
  { id: 'overhead-follow', group: 'Classic shots', name: 'Overhead tracking', description: 'Straight down from above, following the subject (Scorsese, Wes Anderson)', apply: () => rigged({ yaw: 0, pitch: 85, size: 'ws', lens: 35, smooth: 0.6 }) },
  { id: 'spielberg', group: 'Classic shots', name: 'Spielberg push-in', description: 'A slow push to a close-up on the face as the character realises something', apply: (c) => framed(c, { size: 'mws', pitch: 2, lens: 50, move: { kind: 'push', size: 'cu' } }) },
  { id: 'barrel-roll', group: 'Classic shots', name: 'Barrel roll', description: 'The camera turns over on its axis as it pushes in: disorientation, a world upside down', apply: (c) => framed(c, { size: 'fs', move: { kind: 'roll', by: 360, size: 'ms' } }) },
  { id: 'high', group: 'Fixed', name: 'High angle', description: 'Look down on the figures from above: they seem smaller, weaker', apply: (c) => framed(c, { size: 'fs', pitch: 38 }) },
  { id: 'overhead', group: 'Fixed', name: "Bird's-eye", description: 'Straight down from overhead, like a map', apply: (c) => framed(c, { size: 'ws', pitch: 86 }) },
  { id: 'worm', group: 'Fixed', name: "Worm's-eye", description: 'From the floor looking up, with a wide lens', apply: (c) => framed(c, { size: 'fs', pitch: -30, lens: 18 }) },
  { id: 'dutch', group: 'Fixed', name: 'Dutch angle', description: 'The camera tilted sideways: unease, tension', apply: (c) => framed(c, { size: 'mws', roll: 18 }) },
  { id: 'closeup', group: 'Fixed', name: 'Close-up', description: 'A fixed close-up of the subject on a long lens', apply: (c) => framed(c, { size: 'cu', pitch: 2, lens: 85 }) },
  { id: 'profile', group: 'Fixed', name: 'Profile', description: 'Side-on to the subject, a medium shot', apply: (c) => framed(c, { size: 'ms', pitch: 0, lens: 50 }, 90) },
  { id: 'pan', group: 'Pan & tilt', name: 'Pan', description: 'The camera stays and turns, from its subject to another (or across the scene)', apply: (c) => framed(c, { size: 'mws', move: another(c) ? { kind: 'pan', to: another(c) } : { kind: 'pan', by: 40 } }) },
  { id: 'tilt', group: 'Pan & tilt', name: 'Tilt up', description: 'The camera stays and tilts up from the feet to the face', apply: (c) => framed(c, { size: 'ms', pitch: 0, move: { kind: 'tilt', by: 20 } }) },
  { id: 'whip', group: 'Pan & tilt', name: 'Whip pan', description: 'Holds, then swings round fast to the other side', apply: (c) => framed(c, { size: 'mws', move: another(c) ? { kind: 'pan', to: another(c), pace: 'snap' } : { kind: 'pan', by: 90, pace: 'snap' } }) },
  { id: 'truck', group: 'Towards & away', name: 'Truck', description: 'The camera slides sideways past the figures, looking straight on', apply: (c) => framed(c, { size: 'mws', move: { kind: 'truck', by: 2, pace: 'even' } }) },
  { id: 'zoom', group: 'Towards & away', name: 'Slow zoom', description: 'The camera stays; the lens slowly zooms in', apply: (c) => framed(c, { size: 'ws', lens: 35, move: { kind: 'zoom', by: 70 } }) },
  { id: 'crashzoom', group: 'Towards & away', name: 'Crash zoom', description: 'Holds wide, then zooms in fast on the subject', apply: (c) => framed(c, { size: 'ws', lens: 28, move: { kind: 'zoom', by: 110, pace: 'snap' } }) },
  { id: 'cranedown', group: 'Around & up', name: 'Crane down', description: 'Come down from high above to eye level', apply: (c) => framed(c, { size: 'fs', pitch: 55, move: { kind: 'crane', by: -53 } }, -15) },
  { id: 'aerial', group: 'Around & up', name: 'Aerial reveal', description: 'A drone shot: from close and low, up and away to see the whole place', apply: (c) => framed(c, { size: 'ms', pitch: 8, move: { kind: 'crane', by: 42, size: 'ews' } }) },
  { id: 'steadicam', group: 'Following', name: 'Steadicam', description: 'Close behind the subject\'s shoulder, gliding smoothly as it goes', apply: () => rigged({ yaw: 155, pitch: 6, turn: true, size: 'ms', lens: 28, smooth: 0.9 }) },
  { id: 'sidetrack', group: 'Following', name: 'Tracking from the right', description: 'Move alongside from the right, keeping a medium wide shot', apply: () => rigged({ yaw: -90, pitch: 3, size: 'mws', lens: 50, smooth: 0.6 }) },
  { id: 'handheld', group: 'Following', name: 'Hand-held', description: 'A close, slightly shaky documentary feel', apply: (c) => ({ ...framed(c, { size: 'mws', lens: 40, move: { kind: 'push', size: 'ms' } }, 10), shake: 0.6 }) },
];

/**
 * A path camera in other terms (riding along with the subject or fixed in the world; looking at
 * the subject, at a point or along the way; about another subject): the camera stays where it
 * was at each point.
 */
export function restate(scene: Scene, cam: PathCamera, patch: Partial<Pick<PathCamera, 'anchor' | 'aim' | 'subject'>>): PathCamera {
  const next: PathCamera = { ...cam, ...patch };
  const points = cam.points.map((p) => {
    const v = viewOf(scene, cam, p.t);
    return pointIn(scene, next, p.t, v.position, v.target, p.lens, p.roll);
  });
  return { ...next, points };
}

/** A scene with one of its cameras changed (or added). */
export function withCamera(scene: Scene, cam: Camera): Scene {
  const cameras = scene.cameras.some((c) => c.id === cam.id) ? scene.cameras.map((c) => (c.id === cam.id ? cam : c)) : [...scene.cameras, cam];
  return { ...scene, cameras };
}

/** A new camera for a scene, named after the ones it has: framing its subject (everyone) as the default camera does. */
export function newCamera(scene: Pick<Scene, 'cameras'>, patch: Partial<Pick<Camera, 'subject' | 'also'>> = {}): Camera {
  const names = new Set(scene.cameras.map((c) => c.name));
  let n = 1;
  while (names.has(`Camera ${n}`)) n++;
  return { ...defaultCamera(`Camera ${n}`), ...patch };
}

/** The angle and field of view a scene is filmed from at t (where moves start from, and sheets of it are drawn from). */
export function angleAt(scene: Scene, t = 0, aspect = frameAspect()): View {
  const v = cameraAt(scene, t, aspect);
  return { ...angleOf(v), fov: v.fov };
}

/**
 * ProjectSettings a shot of a scene (by its index; the first by default) with a camera move, from the angle
 * it is filmed from now (or `base`): on the shot's camera if no other shot uses it, or else on a
 * new camera for it; `follow`: a path then rides along with the camera's subject (or everyone).
 */
export function filmWith(scene: Scene, moveId: string, o: { index?: number; follow?: boolean; base?: View } = {}): Scene {
  const a = scene.animation;
  const move = CAMERA_MOVES.find((m) => m.id === moveId);
  if (!a || !move) return scene;
  const spans = shotSpans(a);
  const span = spans[Math.min(o.index ?? 0, spans.length - 1)];
  const own = cameraById(scene, span.shot.camera);
  const shared = own && spans.some((s) => s !== span && s.shot.camera === own.id);
  const start: Camera = own && !shared ? own : newCamera(scene, own?.subject ? { subject: own.subject } : {});
  const base = o.base ?? angleAt(scene, span.start);
  const cam = reform(start, move.apply({ scene, camera: start, start: span.start, end: span.end, base }));
  const shots = spans.map((s) => (s === span ? { ...s.shot, camera: cam.id } : s.shot));
  const filmed = withCamera({ ...scene, animation: { ...a, shots } }, cam);
  return o.follow && cam.kind === 'path' ? withCamera(filmed, restate(filmed, cam, { anchor: 'subject', aim: 'subject' })) : filmed;
}

/**
 * Reshape one camera with a camera move, over the time of the shots it films (none: the whole
 * animation), from where it sees the scene as they start.
 */
export function reshapeCamera(scene: Scene, moveId: string, id: string): Scene {
  const a = scene.animation;
  const move = CAMERA_MOVES.find((m) => m.id === moveId);
  const cam = cameraById(scene, id);
  if (!a || !move || !cam) return scene;
  const spans = shotSpans(a).filter((s) => s.shot.camera === id);
  const [start, end] = spans.length ? [spans[0].start, spans[spans.length - 1].end] : [0, a.duration];
  const view = viewOf(scene, cam, start);
  return withCamera(scene, reform(cam, move.apply({ scene, camera: cam, start, end, base: { ...angleOf(view), fov: view.fov } })));
}

/* ---------- capture and export ---------- */

/** A view as a path point of a camera at t (for "set camera point from the view"). */
export function capturePoint(scene: Scene, cam: PathCamera, t: number, position: THREE.Vector3, look: THREE.Vector3, fov: number, aspect = frameAspect()): CameraPoint {
  return pointIn(scene, cam, t, position, look, fovLens(fov, aspect));
}

/** World camera pose for every frame of a time range (for camera.json in keyframe packs). */
export function cameraPath(scene: Scene, start: number, end: number, aspect: number) {
  const a = scene.animation;
  const fps = a?.fps ?? 24;
  const frames: { frame: number; time: number; position: number[]; target: number[]; fov: number; lens: number; roll: number }[] = [];
  const n = a ? Math.max(1, Math.round((end - start) * fps)) : 1;
  const r = (v: number) => Math.round(v * 10000) / 10000;
  for (let i = 0; i < n; i++) {
    const t = start + i / fps;
    const v = cameraAt(scene, t, aspect);
    frames.push({ frame: Math.round(t * fps), time: r(t), position: v.position.toArray().map(r), target: v.target.toArray().map(r), fov: r(v.fov), lens: r(v.lens), roll: r(v.roll) });
  }
  return { units: 'metres, +Y up, floor at y = 0; lens in mm (full frame)', aspect: r(aspect), fps, frames };
}

/**
 * The times a camera's path is drawn through (where it is then, for its trail): ten a second (a
 * rig's four) over its points' time and the time of the shots it films.
 */
export function trailTimes(scene: Scene, cam: Camera): number[] {
  const a = scene.animation;
  if (!a) return [];
  const spans = shotSpans(a).filter((s) => s.shot.camera === cam.id);
  const ends = [...(cam.kind === 'path' ? cam.points.map((p) => p.t) : []), ...spans.flatMap((s) => [s.start, s.end])];
  if (!ends.length) return [];
  const from = Math.max(0, Math.min(...ends));
  const to = Math.min(a.duration, Math.max(...ends));
  // (Ten a second; a rig's four: each poses whom it films, and its turn is eased between samples half a second apart.)
  const n = Math.max(2, Math.ceil((to - from) * (cam.kind === 'rig' ? 4 : 10)));
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
}
