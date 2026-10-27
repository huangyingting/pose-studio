import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { frameTimes } from './animation';
import { hermite } from './clip';
import { figurePoseAt, sceneAt } from './evaluate';
import { wrapDeg } from './joints';
import { Rig } from './relations';
import { facingOf } from './pose';
import { fitCamera, viewDirection } from './render';
import { SceneView } from './sceneview';
import { newCamera, shotSpans, spanAt, type ShotSpan } from './shots';
import type { Animation, Camera, CameraPoint, CameraRig, FrameShape, Placement, Scene, ShotSize, Vec3, View } from './types';

/*
 * The cameras: how a "director" films the figures. An animation has cameras, each an object in
 * the scene with a path: points it passes through in time, each with where it looks and its lens
 * (mm, full frame). A path is fixed in the world (a track, a crane), or rides along with the
 * camera's subject (a tracking shot); the camera looks at the subject, at a point, or along the
 * way. Its shots (lib/shots.ts) cut between the cameras: each films with one, cutting or blending
 * in. A still scene (or a shot without a camera) is filmed from its view (angle and lens),
 * everyone in frame. Shot sizes (wide … close-up) and camera moves make paths; they can be edited.
 */

/** The usual frame shape (16:9), for shots and exports that have none of their own. */
export const SHOT_ASPECT = 16 / 9;

/** The width over height of a frame shape. */
export const ASPECTS: Record<FrameShape, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '2.39:1': 2.39 };

/** The shape (width over height) a scene's shots are filmed in. */
export const frameAspect = (scene: Scene) => ASPECTS[scene.animation?.frame ?? '16:9'];

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

/* ---------- what is in frame ---------- */

export interface Framing {
  /** The figures over the stretch of time, so the frame stays steady. */
  points: THREE.Vector3[];
}

/**
 * Only the convex hull matters for framing (the extremes of any perspective view lie on it), and
 * it is a few hundred points instead of tens of thousands: placing a shot gets much cheaper.
 */
function hull(points: THREE.Vector3[]) {
  if (points.length < 50) return points;
  try {
    const h = new ConvexHull().setFromPoints(points);
    const out = new Set<THREE.Vector3>();
    for (const face of h.faces) {
      let e = face.edge;
      do {
        out.add(e.head().point);
        e = e.next;
      } while (e !== face.edge);
    }
    return out.size >= 4 ? [...out].map((v) => v.clone()) : points;
  } catch {
    return points;
  }
}

/**
 * What a shot frames: everyone, sampled over the animation (or just the pose); or one figure
 * (`only`) over a stretch of time.
 */
export function framingFor(scene: Scene, samples = 12, only?: { figure: string; from: number; to: number }): Framing {
  const view = new SceneView();
  const points: THREE.Vector3[] = [];
  const times = !scene.animation ? [0] : only
    ? Array.from({ length: samples }, (_, i) => only.from + ((only.to - only.from) * i) / Math.max(1, samples - 1))
    : frameTimes(scene.animation, samples);
  for (const t of times) {
    view.sync(sceneAt(scene, t));
    let i = 0;
    // Every 9th vertex is plenty for framing.
    const subject = only ? view.figures.get(only.figure) : undefined;
    if (subject) subject.forEachPoint((p) => { if (i++ % 9 === 0) points.push(p.clone()); });
    else view.forEachPoint((p) => { if (i++ % 9 === 0) points.push(p.clone()); }, true);
  }
  view.dispose();
  if (!points.length) points.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.8, 0));
  return { points: hull(points) };
}

/** The figure a camera films, if it has one and the figure is there. */
export function cameraSubject(scene: Scene, cam: Camera | null | undefined): string | undefined {
  return cam?.subject && scene.figures.some((f) => f.id === cam.subject && !f.hidden) ? cam.subject : undefined;
}

/** The figures a camera frames: its subject and those it frames with it (none: everyone). */
export function cameraFigures(scene: Scene, cam: Camera | null | undefined): string[] | undefined {
  const subject = cameraSubject(scene, cam);
  if (!subject) return undefined;
  const shown = (id: string) => id !== subject && scene.figures.some((f) => f.id === id && !f.hidden);
  return [subject, ...(cam!.also ?? []).filter(shown)];
}

/** The camera with this id, if the animation has it. */
export const cameraById = (a: Animation | undefined, id: string | undefined) => (id ? a?.cameras?.find((c) => c.id === id) ?? null : null);

/** The camera filming the shot playing at t (null: the still camera). */
export function liveCamera(scene: Scene, t: number): Camera | null {
  const a = scene.animation;
  return a ? cameraById(a, spanAt(a, t).shot.camera) : null;
}

/** The figure the camera live at t films, if it has one (and the figure is there). */
export function subjectAt(scene: Scene, t: number): string | undefined {
  return cameraSubject(scene, liveCamera(scene, t));
}

// Framings are worked out once per animation (or still cast), subject and stretch of time.
const framings = new WeakMap<object, Map<string, Framing>>();

/** The framing of a stretch of a scene: a figure over a stretch of time, or everyone over the animation. */
function framingOf(scene: Scene, only?: { figure: string; from: number; to: number }): Framing {
  const owner: object = scene.animation ?? scene.figures;
  let cache = framings.get(owner);
  if (!cache) framings.set(owner, (cache = new Map()));
  const key = only ? `${only.from}:${only.to}:${only.figure}` : 'all';
  let f = cache.get(key);
  if (!f) {
    // While a scene is being edited (a new animation every moment of a drag), the framing of a
    // moment ago does: it is worked out again once the edits pause.
    const id = `${scene.id}:${key}`;
    const now = Date.now();
    f = recent?.id === id && now - recent.at < 300 ? recent.framing : framingFor(scene, only ? 8 : 12, only);
    if (recent?.id !== id || recent.framing !== f) recent = { id, framing: f, at: now };
    cache.set(key, f);
  }
  return f;
}

let recent: { id: string; framing: Framing; at: number } | null = null;

/** Where a camera's subject is at t, on the floor under its hips (several, or everyone: the middle of them). */
export function subjectPlace(scene: Scene, cam: Camera | null, t: number): THREE.Vector3 {
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

/** The still camera: everyone (or the shot's subject over the shot) in frame from the scene's view. */
function stillView(scene: Scene, only: { figure: string; from: number; to: number } | undefined, aspect: number): CameraView {
  const cam = new THREE.PerspectiveCamera(scene.view.fov, aspect);
  const f = framingOf(scene, only);
  const target = fitCamera(cam, { forEachPoint: (cb) => f.points.forEach(cb) }, scene.view, 0.1);
  return { position: cam.position.clone(), target: target.clone(), fov: scene.view.fov, lens: fovLens(scene.view.fov, aspect), roll: 0 };
}

/** Smooth pseudo-random wobble in [-1, 1] for hand-held shake. */
function wobble(t: number, seed: number) {
  return Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 3.3 + seed * 2.1) * 0.3 + Math.sin(t * 7.9 + seed * 0.7) * 0.2;
}

/** A path's point at time t, and which way it is going. */
export function samplePath(points: CameraPoint[], t: number, ease: Camera['ease'] = 'smooth'): CameraPoint & { velocity: THREE.Vector3 } {
  const n = points.length;
  const vec = (v: Vec3) => new THREE.Vector3(...v);
  if (n === 1) return { ...points[0], t, velocity: new THREE.Vector3() };
  const times = points.map((p) => p.t);
  const time = THREE.MathUtils.clamp(t, times[0], times[n - 1]);
  let k = 0;
  while (k < n - 2 && times[k + 1] <= time) k++;
  const i = [Math.max(0, k - 1), k, k + 1, Math.min(n - 1, k + 2)];
  const [t1, t2] = [times[k], times[k + 1]];
  const t0 = k > 0 ? times[k - 1] : t1 - (t2 - t1);
  const t3 = k + 2 < n ? times[k + 2] : t2 + (t2 - t1);
  const at = (x: number) => {
    if (ease === 'linear') {
      const s = t2 - t1 > 1e-9 ? (x - t1) / (t2 - t1) : 0;
      return (f: (p: CameraPoint) => number) => f(points[k]) + (f(points[k + 1]) - f(points[k])) * s;
    }
    return (f: (p: CameraPoint) => number) => hermite(f(points[i[0]]), f(points[i[1]]), f(points[i[2]]), f(points[i[3]]), t0, t1, t2, t3, x);
  };
  const v = at(time);
  const vec3 = (g: (p: CameraPoint) => Vec3, x = v) => [0, 1, 2].map((c) => x((p) => g(p)[c])) as Vec3;
  const position = vec3((p) => p.position);
  const ahead = vec3((p) => p.position, at(Math.min(t2, time + 0.02)));
  const behind = vec3((p) => p.position, at(Math.max(t1, time - 0.02)));
  return {
    t,
    position,
    look: vec3((p) => p.look),
    lens: Math.max(4, v((p) => p.lens)),
    roll: v((p) => p.roll ?? 0),
    velocity: vec(ahead).sub(vec(behind)),
  };
}

/**
 * What a camera sees at time t, whatever is cut to then. A camera without points is the still
 * camera, on its subject over `still` (or the animation), or everyone.
 */
export function viewOf(scene: Scene, cam: Camera, t: number, aspect = frameAspect(scene), still?: { from: number; to: number }): CameraView {
  if (cam.rig) {
    const v = rigView(scene, cam, cam.rig, t, aspect);
    return shaken(cam, t, { position: v.position, target: v.target, fov: lensFov(v.lens, aspect), lens: v.lens, roll: 0 });
  }
  if (!cam.points.length) {
    const subject = cameraSubject(scene, cam);
    const range = still ?? { from: 0, to: scene.animation?.duration ?? 0 };
    return stillView(scene, subject ? { figure: subject, ...range } : undefined, aspect);
  }
  const p = samplePath(cam.points, t, cam.ease);
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

/** What the shot of this span films at t: its camera, or the still camera. */
function spanView(scene: Scene, span: ShotSpan, t: number, aspect: number): CameraView {
  const cam = cameraById(scene.animation, span.shot.camera);
  return cam ? viewOf(scene, cam, t, aspect, { from: span.start, to: span.end }) : stillView(scene, undefined, aspect);
}

/** The camera filming a scene at time t: the camera of the shot playing then (blending in from the one before), or the still camera. */
export function cameraAt(scene: Scene, t: number, aspect = frameAspect(scene)): CameraView {
  const a = scene.animation;
  if (!a) return stillView(scene, undefined, aspect);
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

/** How much of the body each shot size holds: from and to, as shares of the body's height down from the top of the head. */
const SPAN: Record<ShotSize, [number, number]> = {
  ews: [-1.6, 2.6], ws: [-0.45, 1.45], fs: [-0.08, 1.06], mws: [-0.07, 0.74],
  ms: [-0.06, 0.55], mcu: [-0.06, 0.4], cu: [-0.05, 0.27], ecu: [0.02, 0.14],
};

/** A body as a camera frames it: the middle of it on the floor, the top of the head, the height, and which way it faces (degrees). */
interface Body { x: number; z: number; top: number; height: number; facing: number }

let rig: Rig | null = null;
// Each figure is measured once per animation (or still cast) and time.
const boxes = new WeakMap<object, Map<string, { box: THREE.Box3; facing: number }>>();

/** A figure's extent at t (every few vertices of its solid parts are plenty), and which way it faces. */
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
    const p = new THREE.Vector3();
    for (const mesh of f ? rig.model(f).parts.bodies : []) {
      if (!mesh.visible) continue;
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 4) box.expandByPoint(p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
    e = { box, facing: f ? facingOf(f.bones) : 0 };
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
  return { x: middle.x, z: middle.z, top: box.max.y, height: Math.max(0.3, box.max.y - Math.max(0, box.min.y)), facing: ids && each[0] ? each[0].facing : 0 };
}

/** A camera's subject's body at t (with those it frames with it; everyone: all of them). */
const bodyAt = (scene: Scene, cam: Camera | null, t: number) => measure(scene, cameraFigures(scene, cam), t);

/**
 * A figure's body at t smoothed over `window` seconds: the frames around t weighed by how near
 * they are, so it is the same however t is reached (playing, scrubbing or exporting).
 */
function smoothBody(scene: Scene, ids: string[] | undefined, t: number, window: number): Body {
  const a = scene.animation;
  if (!a || window <= 0) return measure(scene, ids, t);
  const half = window / 2;
  const sum = { x: 0, z: 0, top: 0, height: 0, sin: 0, cos: 0, w: 0 };
  for (let i = Math.ceil((t - half) * a.fps); i <= Math.floor((t + half) * a.fps); i++) {
    const at = Math.min(a.duration, Math.max(0, i / a.fps));
    const w = 1 - Math.abs(i / a.fps - t) / half;
    if (w <= 0) continue;
    const b = measure(scene, ids, at);
    sum.x += b.x * w;
    sum.z += b.z * w;
    sum.top += b.top * w;
    sum.height += b.height * w;
    sum.sin += Math.sin(b.facing * D2R) * w;
    sum.cos += Math.cos(b.facing * D2R) * w;
    sum.w += w;
  }
  if (!sum.w) return measure(scene, ids, t);
  return { x: sum.x / sum.w, z: sum.z / sum.w, top: sum.top / sum.w, height: sum.height / sum.w, facing: Math.atan2(sum.sin, sum.cos) * R2D };
}

/** Where a camera looks from and at to hold a body at a shot size from an angle (world yaw, pitch) through a lens. */
function compose(body: Body, size: ShotSize, yaw: number, pitch: number, lens: number, place: Placement | undefined, aspect: number) {
  const [a, b] = SPAN[size];
  const top = body.top - a * body.height;
  const bottom = body.top - b * body.height;
  const tanV = Math.tan((lensFov(lens, aspect) * D2R) / 2);
  const dist = (top - bottom) / 2 / tanV;
  const dir = viewDirection({ yaw, pitch });
  const look = new THREE.Vector3(body.x, (top + bottom) / 2, body.z);
  if (place && place !== 'center') {
    // On a third: the subject a sixth of the frame's width off the middle.
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    look.addScaledVector(right, (place === 'left' ? 1 : -1) * (dist * tanV * aspect) / 3);
  }
  return { position: look.clone().addScaledVector(dir, dist), look };
}

/* ---------- cameras placing themselves (rigs) ---------- */

/** When a camera's angle is measured from: the start of the first shot it films (else the start). */
function firstFilmed(scene: Scene, cam: Camera) {
  const a = scene.animation;
  return a ? shotSpans(a).find((s) => s.shot.camera === cam.id)?.start ?? 0 : 0;
}

/**
 * Which way a rig's angles are measured from at t (world degrees): the subject's facing, or the
 * direction from it towards another figure, then (turning) or at the camera's first shot.
 */
function rigHeading(scene: Scene, cam: Camera, r: CameraRig, t: number, body: Body): number {
  const subject = cameraSubject(scene, cam);
  const at = r.body === 'follow' && r.turn ? t : firstFilmed(scene, cam);
  const from = at === t ? body : smoothBody(scene, cameraFigures(scene, cam), at, r.smooth ?? 0);
  const other = r.toward && r.toward !== subject && scene.figures.some((f) => f.id === r.toward && !f.hidden) ? smoothBody(scene, [r.toward], at, r.smooth ?? 0) : null;
  return other ? Math.atan2(other.x - from.x, other.z - from.z) * R2D : from.facing;
}

/** Where a rig camera is at t, worked out from its subject's body. */
function rigView(scene: Scene, cam: Camera, r: CameraRig, t: number, aspect: number) {
  const body = smoothBody(scene, cameraFigures(scene, cam), t, r.smooth ?? 0);
  const spin = r.body === 'orbit' ? (r.spin ?? 0) * (t - firstFilmed(scene, cam)) : 0;
  const yaw = rigHeading(scene, cam, r, t, body) + r.yaw + spin;
  const { position, look } = compose(body, r.size, yaw, r.pitch, r.lens, r.place, aspect);
  return { position, target: look, lens: r.lens };
}

/** The rig that films as a camera view does at t (its angle from the subject, its size and lens). */
export function rigFrom(scene: Scene, cam: Camera, view: CameraView, t: number, body: CameraRig['body'], o: Partial<CameraRig> = {}): CameraRig {
  const r: CameraRig = { body, yaw: 0, pitch: 0, size: 'fs', lens: Math.round(view.lens), smooth: 0.5, ...(body === 'orbit' ? { spin: 20 } : {}), ...cam.rig, ...o };
  const b = smoothBody(scene, cameraFigures(scene, cam), t, r.smooth ?? 0);
  const { yaw, pitch } = angleOf(view);
  const spin = r.body === 'orbit' ? (r.spin ?? 0) * (t - firstFilmed(scene, cam)) : 0;
  const round = (v: number) => Math.round(v * 10) / 10;
  return { ...r, yaw: round(wrapDeg(yaw - rigHeading(scene, { ...cam, rig: r }, r, t, b) - spin)), pitch: round(pitch), size: o.size ?? sizeOf(scene, cam, t, view) };
}

/**
 * A point of a camera's path framing its subject at t at a shot size: the camera looking from
 * `yaw` and `pitch` (as a View: 0 = from the front, + from its left; + from above) through
 * `lens`, as far away as that size takes. In the camera's own terms (anchor and aim).
 */
export function framePoint(scene: Scene, cam: Camera, t: number, size: ShotSize, o: { yaw: number; pitch: number; lens: number; place?: Placement; aspect?: number }): CameraPoint {
  const { position, look } = compose(bodyAt(scene, cam, t), size, o.yaw, o.pitch, o.lens, o.place, o.aspect ?? frameAspect(scene));
  return pointIn(scene, cam, t, position, look, o.lens);
}

/** A camera position and look point in the world at t → a path point in a camera's own terms. */
export function pointIn(scene: Scene, cam: Camera, t: number, position: THREE.Vector3, look: THREE.Vector3, lens: number, roll = 0): CameraPoint {
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
export function sizeOf(scene: Scene, cam: Camera | null, t: number, view: CameraView): ShotSize {
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
export const CAMERA_GROUPS = ['Fixed', 'Towards & away', 'Around & up', 'Following'] as const;

/** What a move works from: the camera, the time it films over, and the angle and lens to start from. */
export interface MoveContext {
  scene: Scene;
  camera: Camera;
  start: number;
  end: number;
  base: View;
}

export interface CameraMove {
  id: string;
  name: string;
  group: (typeof CAMERA_GROUPS)[number];
  description: string;
  /** The camera for this move: where its path is, what it looks at, its points; or the rig placing it. */
  apply(c: MoveContext): Pick<Camera, 'anchor' | 'aim' | 'points' | 'shake' | 'rig'>;
}

/** Everyone the camera frames over the move's time in view from an angle, `zoom` times closer: a point. */
function fitPoint(c: MoveContext, cam: Camera, t: number, yaw: number, pitch: number, fov: number, zoom = 1, rise = 0): CameraPoint {
  const aspect = frameAspect(c.scene);
  const three = new THREE.PerspectiveCamera(fov, aspect);
  const subject = cameraSubject(c.scene, c.camera);
  const f = framingOf(c.scene, subject ? { figure: subject, from: c.start, to: c.end } : undefined);
  const view = { yaw, pitch, fov };
  const target = fitCamera(three, { forEachPoint: (cb) => f.points.forEach(cb) }, view, 0.1);
  const dist = target.distance / zoom;
  // A closer view looks a little higher (at the upper body).
  target.y += rise;
  return pointIn(c.scene, cam, t, target.clone().addScaledVector(viewDirection(view), dist), target, fovLens(fov, aspect));
}

const world = (c: MoveContext): Camera => ({ ...c.camera, anchor: 'world', aim: 'point' });

/** Ready-made camera moves, each over a shot's time. */
export const CAMERA_MOVES: CameraMove[] = [
  {
    id: 'static', group: 'Fixed', name: 'Locked-off wide', description: 'A fixed camera that shows everything',
    apply: (c) => ({ anchor: 'world', aim: 'point', points: [fitPoint(c, world(c), c.start, c.base.yaw, c.base.pitch, c.base.fov)] }),
  },
  {
    id: 'push', group: 'Towards & away', name: 'Push in', description: 'Slowly dolly towards the figures',
    apply: (c) => ({ anchor: 'world', aim: 'point', points: [fitPoint(c, world(c), c.start, c.base.yaw, c.base.pitch, c.base.fov), fitPoint(c, world(c), c.end, c.base.yaw, c.base.pitch, c.base.fov, 1.8, 0.3)] }),
  },
  {
    id: 'pull', group: 'Towards & away', name: 'Pull out', description: 'Start close and reveal the whole scene',
    apply: (c) => ({ anchor: 'world', aim: 'point', points: [fitPoint(c, world(c), c.start, c.base.yaw, c.base.pitch, c.base.fov, 1.9, 0.35), fitPoint(c, world(c), c.end, c.base.yaw, c.base.pitch, c.base.fov)] }),
  },
  {
    id: 'orbit90', group: 'Around & up', name: 'Arc 90°', description: 'Circle a quarter of the way around',
    apply: (c) => ({ anchor: 'world', aim: 'point', points: [-45, 0, 45].map((d, i) => fitPoint(c, world(c), c.start + ((c.end - c.start) * i) / 2, c.base.yaw + d, c.base.pitch + 4, c.base.fov, 1.1)) }),
  },
  {
    id: 'orbit360', group: 'Around & up', name: 'Orbit 360°', description: 'A full turntable around the figures',
    apply: (c) => ({ anchor: 'world', aim: 'point', points: Array.from({ length: 9 }, (_, i) => fitPoint(c, world(c), c.start + ((c.end - c.start) * i) / 8, c.base.yaw + 45 * i, c.base.pitch + 6, c.base.fov)) }),
  },
  {
    id: 'crane', group: 'Around & up', name: 'Crane up', description: 'Rise from eye level to a high angle',
    apply: (c) => ({ anchor: 'world', aim: 'point', points: [fitPoint(c, world(c), c.start, c.base.yaw, -2, c.base.fov, 1.15), fitPoint(c, world(c), c.end, c.base.yaw + 15, 48, c.base.fov, 0.95)] }),
  },
  {
    id: 'hero', group: 'Fixed', name: 'Low-angle hero', description: 'Look up at the figures with a wide lens',
    apply: (c) => ({ anchor: 'world', aim: 'point', points: [fitPoint(c, world(c), c.start, c.base.yaw - 15, -14, 38, 1.25, 0.15), fitPoint(c, world(c), c.end, c.base.yaw + 10, -8, 34, 1.4, 0.2)] }),
  },
  {
    id: 'tracking', group: 'Following', name: 'Tracking shot', description: 'Move alongside, from the left, keeping a medium wide shot',
    apply: () => ({ anchor: 'world', aim: 'subject', points: [], rig: { body: 'follow', yaw: 90, pitch: 3, size: 'mws', lens: 50, smooth: 0.6 } }),
  },
  {
    id: 'follow', group: 'Following', name: 'Follow behind', description: 'Behind the subject, turning as it turns',
    apply: () => ({ anchor: 'world', aim: 'subject', points: [], rig: { body: 'follow', yaw: 180, pitch: 10, turn: true, size: 'fs', lens: 35, smooth: 0.8 } }),
  },
  {
    id: 'lead', group: 'Following', name: 'Leading shot', description: 'Ahead of the subject, looking back at it as it comes',
    apply: () => ({ anchor: 'world', aim: 'subject', points: [], rig: { body: 'follow', yaw: 10, pitch: 2, turn: true, size: 'ms', lens: 50, smooth: 0.8 } }),
  },
  {
    id: 'circle', group: 'Around & up', name: 'Circle the subject', description: 'Half way around the subject, holding a medium shot',
    apply: (c) => ({ anchor: 'world', aim: 'subject', points: [], rig: { body: 'orbit', yaw: -90, pitch: 6, spin: Math.round(180 / Math.max(0.5, c.end - c.start)), size: 'ms', lens: 40, smooth: 0.5 } }),
  },
  {
    id: 'vertigo', group: 'Towards & away', name: 'Dolly zoom', description: 'The “Vertigo” effect: the lens widens while the figures keep their size',
    apply: (c) => {
      const cam: Camera = { ...c.camera, anchor: 'world', aim: 'subject' };
      const at = (t: number, lens: number) => framePoint(c.scene, cam, t, 'fs', { yaw: c.base.yaw, pitch: c.base.pitch, lens });
      return { anchor: 'world', aim: 'subject', points: [at(c.start, 85), at(c.end, 20)] };
    },
  },
  {
    id: 'handheld', group: 'Following', name: 'Hand-held', description: 'A close, slightly shaky documentary feel',
    apply: (c) => {
      const cam: Camera = { ...c.camera, anchor: 'world', aim: 'subject' };
      const at = (t: number, yaw: number, size: ShotSize) => framePoint(c.scene, cam, t, size, { yaw, pitch: c.base.pitch + 2, lens: 40 });
      return { anchor: 'world', aim: 'subject', shake: 0.6, points: [at(c.start, c.base.yaw + 10, 'mws'), at(c.end, c.base.yaw - 5, 'ms')] };
    },
  },
];

/**
 * A camera's path in other terms (riding along with the subject or fixed in the world; looking
 * at the subject, at a point or along the way; about another subject): the camera stays where it
 * was at each point.
 */
export function restate(scene: Scene, cam: Camera, patch: Partial<Pick<Camera, 'anchor' | 'aim' | 'subject'>>): Camera {
  const next: Camera = { ...cam, ...patch };
  // A rig frames whatever it is about, wherever it is.
  if (cam.rig) return next;
  const points = cam.points.map((p) => {
    const v = viewOf(scene, cam, p.t);
    return pointIn(scene, next, p.t, v.position, v.target, p.lens, p.roll);
  });
  return { ...next, points };
}

/** A scene with one of its cameras changed (or added). */
export function withCamera(scene: Scene, cam: Camera): Scene {
  const a = scene.animation!;
  const cameras = a.cameras ?? [];
  return { ...scene, animation: { ...a, cameras: cameras.some((c) => c.id === cam.id) ? cameras.map((c) => (c.id === cam.id ? cam : c)) : [...cameras, cam] } };
}

/**
 * Film a shot of a scene (by its index; the first by default) with a camera move, from the
 * scene's view: on the shot's camera if no other shot uses it, or else on a new camera for it;
 * `follow`: its path then rides along with the camera's subject (or everyone).
 */
export function filmWith(scene: Scene, moveId: string, o: { index?: number; follow?: boolean } = {}): Scene {
  const a = scene.animation;
  const move = CAMERA_MOVES.find((m) => m.id === moveId);
  if (!a || !move) return scene;
  const spans = shotSpans(a);
  const span = spans[Math.min(o.index ?? 0, spans.length - 1)];
  const own = cameraById(a, span.shot.camera);
  const shared = own && spans.some((s) => s !== span && s.shot.camera === own.id);
  let cam: Camera = own && !shared ? own : newCamera(a, own ? { subject: own.subject } : {});
  const made = move.apply({ scene, camera: cam, start: span.start, end: span.end, base: scene.view });
  cam = { ...cam, ...made };
  if (!made.shake) delete cam.shake;
  if (!made.rig) delete cam.rig;
  const shots = spans.map((s) => (s === span ? { ...s.shot, camera: cam.id } : s.shot));
  const filmed = withCamera({ ...scene, animation: { ...a, shots } }, cam);
  return o.follow && !cam.rig ? withCamera(filmed, restate(filmed, cam, { anchor: 'subject', aim: 'subject' })) : filmed;
}

/* ---------- capture and export ---------- */

/** A view as a path point of a camera at t (for "set camera point from the view"). */
export function capturePoint(scene: Scene, cam: Camera, t: number, position: THREE.Vector3, look: THREE.Vector3, fov: number, aspect = frameAspect(scene)): CameraPoint {
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
 * The path a camera takes (world points every tenth of a second, and their times), for drawing
 * it: over its points' time, and the time of the shots it films.
 */
export function cameraTrail(scene: Scene, cam: Camera, aspect = frameAspect(scene)): { times: number[]; points: THREE.Vector3[] } {
  const a = scene.animation!;
  const spans = shotSpans(a).filter((s) => s.shot.camera === cam.id);
  const ends = [...cam.points.map((p) => p.t), ...spans.flatMap((s) => [s.start, s.end])];
  if (!cam.points.length && !(cam.rig && spans.length)) return { times: [], points: [] };
  const from = Math.max(0, Math.min(...ends));
  const to = Math.min(a.duration, Math.max(...ends));
  const n = Math.max(2, Math.ceil((to - from) * 10));
  const times = Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
  return { times, points: times.map((t) => viewOf(scene, cam, t, aspect).position) };
}

/* ---------- one-time converter (remove in a later release) ---------- */

/** A camera key as saved before shots had paths: an orbit around the framing, a zoom and a pan. */
export interface OldCameraKey { t: number; yaw: number; pitch: number; fov: number; zoom: number; pan: [number, number] }

/**
 * Shots saved before they had cameras (a camera key track over them, following the figures or
 * not, shaking or not) → a camera for each shot that puts it where it was at each key (and, on a
 * turning move, every quarter of a second in between).
 */
export function camerasFromKeys(scene: Scene, keys: OldCameraKey[], follow: boolean, shake: number): Pick<Animation, 'cameras' | 'shots'> {
  const a = scene.animation as Animation;
  const three = new THREE.PerspectiveCamera(30, SHOT_ASPECT);
  // How the old keys played back: interpolated within each shot.
  const sample = (list: OldCameraKey[], t: number): OldCameraKey => {
    if (list.length === 1 || t <= list[0].t) return list[0];
    if (t >= list[list.length - 1].t) return list[list.length - 1];
    let k = 0;
    while (k < list.length - 2 && list[k + 1].t <= t) k++;
    const c = [list[Math.max(0, k - 1)], list[k], list[k + 1], list[Math.min(list.length - 1, k + 2)]];
    const ts = [k > 0 ? c[0].t : c[1].t - (c[2].t - c[1].t), c[1].t, c[2].t, k + 2 < list.length ? c[3].t : c[2].t + (c[2].t - c[1].t)];
    const num = (f: (x: OldCameraKey) => number) => hermite(f(c[0]), f(c[1]), f(c[2]), f(c[3]), ts[0], ts[1], ts[2], ts[3], t);
    const y1 = c[1].yaw;
    const y2 = y1 + wrapDeg(c[2].yaw - y1);
    return {
      t, yaw: wrapDeg(hermite(y1 + wrapDeg(c[0].yaw - y1), y1, y2, y2 + wrapDeg(c[3].yaw - c[2].yaw), ts[0], ts[1], ts[2], ts[3], t)),
      pitch: num((x) => x.pitch), fov: num((x) => x.fov), zoom: Math.max(0.1, num((x) => x.zoom)), pan: [num((x) => x.pan[0]), num((x) => x.pan[1])],
    };
  };
  const cameras: Camera[] = [...(a.cameras ?? [])];
  const shots = shotSpans(a).map((span) => {
    const last = span.end >= a.duration - 1e-6;
    const mine = keys.filter((k) => k.t >= span.start - 1e-6 && (k.t < span.end - 1e-6 || (last && k.t <= span.end + 1e-6)));
    if (!mine.length) return span.shot;
    // On the shot's camera (one with a subject only), or a new one.
    const old = cameraById(a, span.shot.camera);
    const { shake: _shake, ...base } = old ?? newCamera({ ...a, cameras });
    void _shake;
    const cam: Camera = { ...base, anchor: follow ? 'subject' : 'world', aim: follow ? 'subject' : 'point', points: [], ...(shake ? { shake } : {}) };
    const subject = cameraSubject(scene, cam);
    const f = framingOf(scene, subject ? { figure: subject, from: span.start, to: span.end } : undefined);
    const middle = new THREE.Vector3();
    if (follow) {
      // The old frame followed the subject's (or everyone's) middle, from where it was on average.
      const times = frameTimes(a, 12);
      for (const t of times) middle.add(subjectPlace(scene, cam, t));
      middle.divideScalar(times.length);
    }
    const times = new Set(mine.map((k) => k.t));
    for (let i = 1; i < mine.length; i++) {
      const turn = Math.abs(wrapDeg(mine[i].yaw - mine[i - 1].yaw));
      if (turn > 10) for (let t = mine[i - 1].t + 0.25; t < mine[i].t - 0.1; t += 0.25) times.add(Math.round(t * 1000) / 1000);
    }
    cam.points = [...times].sort((p, q) => p - q).map((t) => {
      const k = sample(mine, t);
      const view = { yaw: k.yaw, pitch: k.pitch, fov: k.fov };
      const target = fitCamera(three, { forEachPoint: (cb) => f.points.forEach(cb) }, view, 0.1);
      const dist = target.distance / Math.max(0.1, k.zoom);
      const dir = viewDirection(view);
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
      const up = new THREE.Vector3().crossVectors(dir, right);
      const tanV = Math.tan((k.fov * D2R) / 2);
      const look = target.clone().addScaledVector(right, k.pan[0] * dist * tanV * SHOT_ASPECT).addScaledVector(up, k.pan[1] * dist * tanV);
      if (follow) look.add(subjectPlace(scene, cam, t).sub(middle));
      return pointIn(scene, cam, t, look.clone().addScaledVector(dir, dist), look, fovLens(k.fov));
    });
    if (old) cameras.splice(cameras.indexOf(old), 1, cam);
    else cameras.push(cam);
    return { ...span.shot, camera: cam.id };
  });
  return { cameras, shots };
}
