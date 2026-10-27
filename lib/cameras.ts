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
import { defaultCamera } from './doc';
import { shotSpans, spanAt, type ShotSpan } from './shots';
import type { Camera, CameraPoint, CameraRig, FrameShape, PathCamera, Placement, RigCamera, Scene, ShotSize, Vec3, View } from './types';

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

/** A path's point at time t, and which way it is going. */
export function samplePath(points: CameraPoint[], t: number, ease: PathCamera['ease'] = 'smooth'): CameraPoint & { velocity: THREE.Vector3 } {
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

/** What a camera sees at time t, whatever is cut to then. */
export function viewOf(scene: Scene, cam: Camera, t: number, aspect = frameAspect(scene)): CameraView {
  if (cam.kind === 'rig') {
    const v = rigView(scene, cam, cam.rig, t, aspect);
    return shaken(cam, t, { position: v.position, target: v.target, fov: lensFov(v.lens, aspect), lens: v.lens, roll: 0 });
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

/** What the shot of this span films at t. */
function spanView(scene: Scene, span: ShotSpan, t: number, aspect: number): CameraView {
  return viewOf(scene, cameraById(scene, span.shot.camera) ?? scene.cameras[0], t, aspect);
}

/** The camera filming a scene at time t: the camera of the shot playing then (blending in from the one before); a still scene's first. */
export function cameraAt(scene: Scene, t: number, aspect = frameAspect(scene)): CameraView {
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
  const sum = { x: 0, z: 0, top: 0, height: 0, sin: 0, cos: 0, hx: 0, hy: 0, hz: 0, stature: 0, wx: 0, wz: 0, w: 0 };
  for (let i = Math.ceil((t - half) * a.fps); i <= Math.floor((t + half) * a.fps); i++) {
    const at = Math.min(a.duration, Math.max(0, i / a.fps));
    const w = 1 - Math.abs(i / a.fps - t) / half;
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
function compose(body: Body, size: ShotSize, yaw: number, pitch: number, lens: number, place: Placement | undefined, aspect: number) {
  const [a, b] = SPAN[size];
  // A close shot is measured from the head and the standing height, a wide one from the whole
  // body as it is (standing, the two agree; lying, the close-up still holds the head).
  const near = ({ ews: 0, ws: 0, fs: 0, mws: 0.25, ms: 0.5, mcu: 1, cu: 1, ecu: 1 } as Record<ShotSize, number>)[size];
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
// Where a clean single puts its subject, once worked out (per animation, camera and rig).
const placements = new WeakMap<object, Map<string, Placement | undefined>>();

function rigView(scene: Scene, cam: Camera, r: CameraRig, t: number, aspect: number) {
  const subject = cameraFigures(scene, cam);
  const other = r.clear && r.clear !== cam.subject && scene.figures.some((f) => f.id === r.clear && !f.hidden) ? r.clear : null;
  const solve = (time: number, place: Placement | undefined) => {
    const body = smoothBody(scene, subject, time, r.smooth ?? 0);
    const spin = r.body === 'orbit' ? (r.spin ?? 0) * (time - firstFilmed(scene, cam)) : 0;
    const yaw = rigHeading(scene, cam, r, time, body) + r.yaw + spin;
    const at = (extra: number) => compose(body, r.size, yaw + extra, r.pitch, r.lens, place, aspect);
    const them = other ? smoothBody(scene, [other], time, r.smooth ?? 0) : null;
    if (!them || !seen(at(0), them, r.lens, aspect)) return { shot: at(0), clear: true };
    // Round, away from the other, by the least angle that leaves them out (found by halving; it
    // moves smoothly as they do).
    const away = r.yaw < 0 ? -1 : 1;
    let [lo, hi] = [0, 70];
    if (seen(at(away * hi), them, r.lens, aspect)) return { shot: at(away * hi), clear: false };
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (seen(at(away * mid), them, r.lens, aspect)) lo = mid;
      else hi = mid;
    }
    return { shot: at(away * hi), clear: true };
  };
  // Where the subject sits: as asked, unless that leaves no room to keep the other out (they
  // stand too close), then centred, then on the other third; chosen once, at the camera's first
  // shot, so it does not jump about.
  let place = r.place;
  if (other) {
    const owner: object = scene.animation ?? scene.figures;
    let known = placements.get(owner);
    if (!known) placements.set(owner, (known = new Map()));
    const key = `${cam.id}:${JSON.stringify(r)}:${aspect}`;
    if (!known.has(key)) {
      const t0 = firstFilmed(scene, cam);
      const flip: Placement | undefined = r.place === 'left' ? 'right' : r.place === 'right' ? 'left' : undefined;
      known.set(key, [r.place, undefined, flip].find((p) => solve(t0, p).clear) ?? flip);
    }
    place = known.get(key);
  }
  const { shot } = solve(t, place);
  return { position: shot.position, target: shot.look, lens: r.lens };
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
export function rigFrom(scene: Scene, cam: Camera, view: CameraView, t: number, body: CameraRig['body'], o: Partial<CameraRig> = {}): CameraRig {
  const r: CameraRig = { body, yaw: 0, pitch: 0, size: 'fs', lens: Math.round(view.lens), smooth: 0.5, ...(body === 'orbit' ? { spin: 20 } : {}), ...(cam.kind === 'rig' ? cam.rig : {}), ...o };
  const b = smoothBody(scene, cameraFigures(scene, cam), t, r.smooth ?? 0);
  const { yaw, pitch } = angleOf(view);
  const spin = r.body === 'orbit' ? (r.spin ?? 0) * (t - firstFilmed(scene, cam)) : 0;
  const round = (v: number) => Math.round(v * 10) / 10;
  return { ...r, yaw: round(wrapDeg(yaw - rigHeading(scene, cam, r, t, b) - spin)), pitch: round(pitch), size: o.size ?? sizeOf(scene, cam, t, view) };
}

/**
 * A point of a camera's path framing its subject at t at a shot size: the camera looking from
 * `yaw` and `pitch` (as a View: 0 = from the front, + from its left; + from above) through
 * `lens`, as far away as that size takes. In the camera's own terms (anchor and aim).
 */
export function framePoint(scene: Scene, cam: PathCamera, t: number, size: ShotSize, o: { yaw: number; pitch: number; lens: number; place?: Placement; aspect?: number }): CameraPoint {
  const { position, look } = compose(bodyAt(scene, cam, t), size, o.yaw, o.pitch, o.lens, o.place, o.aspect ?? frameAspect(scene));
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
export const CAMERA_GROUPS = ['Fixed', 'Towards & away', 'Around & up', 'Following'] as const;

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

export interface CameraMove {
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

/** Everyone the camera frames over the move's time in view from an angle, `zoom` times closer: a point. */
function fitPoint(c: MoveContext, cam: PathCamera, t: number, yaw: number, pitch: number, fov: number, zoom = 1, rise = 0): CameraPoint {
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

/** The move's camera as a path (fixed in the world, looking at points or at its subject). */
const path = (c: MoveContext, aim: PathCamera['aim'] = 'point'): PathCamera => ({ ...who(c.camera), kind: 'path', anchor: 'world', aim, points: [] });
const fixed = (points: CameraPoint[], aim: PathCamera['aim'] = 'point'): CameraForm => ({ kind: 'path', anchor: 'world', aim, points });

/** Ready-made camera moves, each over a shot's time. */
export const CAMERA_MOVES: CameraMove[] = [
  {
    id: 'static', group: 'Fixed', name: 'Locked-off wide', description: 'A fixed camera that shows everything',
    apply: (c) => fixed([fitPoint(c, path(c), c.start, c.base.yaw, c.base.pitch, c.base.fov)]),
  },
  {
    id: 'push', group: 'Towards & away', name: 'Push in', description: 'Slowly dolly towards the figures',
    apply: (c) => fixed([fitPoint(c, path(c), c.start, c.base.yaw, c.base.pitch, c.base.fov), fitPoint(c, path(c), c.end, c.base.yaw, c.base.pitch, c.base.fov, 1.8, 0.3)]),
  },
  {
    id: 'pull', group: 'Towards & away', name: 'Pull out', description: 'Start close and reveal the whole scene',
    apply: (c) => fixed([fitPoint(c, path(c), c.start, c.base.yaw, c.base.pitch, c.base.fov, 1.9, 0.35), fitPoint(c, path(c), c.end, c.base.yaw, c.base.pitch, c.base.fov)]),
  },
  {
    id: 'orbit90', group: 'Around & up', name: 'Arc 90°', description: 'Circle a quarter of the way around',
    apply: (c) => fixed([-45, 0, 45].map((d, i) => fitPoint(c, path(c), c.start + ((c.end - c.start) * i) / 2, c.base.yaw + d, c.base.pitch + 4, c.base.fov, 1.1))),
  },
  {
    id: 'orbit360', group: 'Around & up', name: 'Orbit 360°', description: 'A full turntable around the figures',
    apply: (c) => fixed(Array.from({ length: 9 }, (_, i) => fitPoint(c, path(c), c.start + ((c.end - c.start) * i) / 8, c.base.yaw + 45 * i, c.base.pitch + 6, c.base.fov))),
  },
  {
    id: 'crane', group: 'Around & up', name: 'Crane up', description: 'Rise from eye level to a high angle',
    apply: (c) => fixed([fitPoint(c, path(c), c.start, c.base.yaw, -2, c.base.fov, 1.15), fitPoint(c, path(c), c.end, c.base.yaw + 15, 48, c.base.fov, 0.95)]),
  },
  {
    id: 'hero', group: 'Fixed', name: 'Low-angle hero', description: 'Look up at the figures with a wide lens',
    apply: (c) => fixed([fitPoint(c, path(c), c.start, c.base.yaw - 15, -14, 38, 1.25, 0.15), fitPoint(c, path(c), c.end, c.base.yaw + 10, -8, 34, 1.4, 0.2)]),
  },
  {
    id: 'tracking', group: 'Following', name: 'Tracking shot', description: 'Move alongside, from the left, keeping a medium wide shot',
    apply: () => ({ kind: 'rig', rig: { body: 'follow', yaw: 90, pitch: 3, size: 'mws', lens: 50, smooth: 0.6 } }),
  },
  {
    id: 'follow', group: 'Following', name: 'Follow behind', description: 'Behind the subject, turning as it turns',
    apply: () => ({ kind: 'rig', rig: { body: 'follow', yaw: 180, pitch: 10, turn: true, size: 'fs', lens: 35, smooth: 0.8 } }),
  },
  {
    id: 'lead', group: 'Following', name: 'Leading shot', description: 'Ahead of the subject, looking back at it as it comes',
    apply: () => ({ kind: 'rig', rig: { body: 'follow', yaw: 10, pitch: 2, turn: true, size: 'ms', lens: 50, smooth: 0.8 } }),
  },
  {
    id: 'circle', group: 'Around & up', name: 'Circle the subject', description: 'Half way around the subject, holding a medium shot',
    apply: (c) => ({ kind: 'rig', rig: { body: 'orbit', yaw: -90, pitch: 6, spin: Math.round(180 / Math.max(0.5, c.end - c.start)), size: 'ms', lens: 40, smooth: 0.5 } }),
  },
  {
    id: 'vertigo', group: 'Towards & away', name: 'Dolly zoom', description: 'The “Vertigo” effect: the lens widens while the figures keep their size',
    apply: (c) => {
      const at = (t: number, lens: number) => framePoint(c.scene, path(c, 'subject'), t, 'fs', { yaw: c.base.yaw, pitch: c.base.pitch, lens });
      return fixed([at(c.start, 85), at(c.end, 20)], 'subject');
    },
  },
  {
    id: 'handheld', group: 'Following', name: 'Hand-held', description: 'A close, slightly shaky documentary feel',
    apply: (c) => {
      const at = (t: number, yaw: number, size: ShotSize) => framePoint(c.scene, path(c, 'subject'), t, size, { yaw, pitch: c.base.pitch + 2, lens: 40 });
      return { ...fixed([at(c.start, c.base.yaw + 10, 'mws'), at(c.end, c.base.yaw - 5, 'ms')], 'subject'), shake: 0.6 };
    },
  },
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
export function angleAt(scene: Scene, t = 0, aspect = frameAspect(scene)): View {
  const v = cameraAt(scene, t, aspect);
  return { ...angleOf(v), fov: v.fov };
}

/**
 * Film a shot of a scene (by its index; the first by default) with a camera move, from the angle
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

/* ---------- capture and export ---------- */

/** A view as a path point of a camera at t (for "set camera point from the view"). */
export function capturePoint(scene: Scene, cam: PathCamera, t: number, position: THREE.Vector3, look: THREE.Vector3, fov: number, aspect = frameAspect(scene)): CameraPoint {
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
  const a = scene.animation;
  if (!a) return { times: [], points: [] };
  const spans = shotSpans(a).filter((s) => s.shot.camera === cam.id);
  const ends = [...(cam.kind === 'path' ? cam.points.map((p) => p.t) : []), ...spans.flatMap((s) => [s.start, s.end])];
  if (!ends.length) return { times: [], points: [] };
  const from = Math.max(0, Math.min(...ends));
  const to = Math.min(a.duration, Math.max(...ends));
  const n = Math.max(2, Math.ceil((to - from) * 10));
  const times = Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
  return { times, points: times.map((t) => viewOf(scene, cam, t, aspect).position) };
}
