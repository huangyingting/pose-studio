import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { frameTimes, sampleCamera, sceneAt } from './animation';
import { wrapDeg } from './joints';
import { fitCamera, viewDirection } from './render';
import { SceneView } from './sceneview';
import { spanAt } from './shots';
import type { Animation, CameraKey, Scene } from './types';

/*
 * The shot camera: how a "director" films the figures. A shot is an orbit around the subject
 * (yaw, pitch, lens), a zoom relative to a frame that fits everything, and a pan. Camera keys
 * on the animation's camera track are interpolated like poses, so moves such as a push-in,
 * an orbit or a crane shot play back smoothly.
 */

/** Video frame shape used for shot framing and the letterbox. */
export const SHOT_ASPECT = 16 / 9;

/** The shot at time t: the camera track, or the pose's export camera when there is none. */
export function shotAt(scene: Scene, t: number): CameraKey {
  const a = scene.animation;
  const key = a ? sampleCamera(a, t) : null;
  return key ?? { t, yaw: scene.view.yaw, pitch: scene.view.pitch, fov: scene.view.fov, zoom: 1, pan: [0, 0] };
}

export interface Framing {
  /** The figures over the whole animation, so the frame stays steady. */
  points: THREE.Vector3[];
  /** Average pelvis position over the animation (reference for follow shots). */
  center: THREE.Vector3;
}

/** Average pelvis position of the figures shown in a view (or just `only`'s, if shown). */
export function figuresCenter(view: SceneView, only?: string) {
  const c = new THREE.Vector3();
  const one = only ? view.figures.get(only) : undefined;
  if (one) return one.joints.root.getWorldPosition(c);
  let n = 0;
  for (const m of view.figures.values()) {
    c.add(m.joints.root.getWorldPosition(new THREE.Vector3()));
    n++;
  }
  return n ? c.divideScalar(n) : c.set(0, 1, 0);
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
 * (`only`) over the shot's own stretch of time.
 */
export function framingFor(scene: Scene, samples = 12, only?: { figure: string; from: number; to: number }): Framing {
  const view = new SceneView();
  const points: THREE.Vector3[] = [];
  const center = new THREE.Vector3();
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
    center.add(figuresCenter(view, only?.figure));
  }
  view.dispose();
  if (!points.length) points.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.8, 0));
  return { points: hull(points), center: center.divideScalar(times.length) };
}

/** The figure the shot playing at t is about, if it has one (and the figure is there). */
export function subjectAt(scene: Scene, t: number): string | undefined {
  const a = scene.animation;
  if (!a?.shots?.length) return undefined;
  const id = spanAt(a, t).shot.subject;
  return id && scene.figures.some((f) => f.id === id && !f.hidden) ? id : undefined;
}

/**
 * The framing for whatever shot plays at a time: its subject over the shot, or everyone over
 * the animation. Computed when first asked for, once per shot.
 */
export function shotFramer(scene: Scene) {
  let all: Framing | null = null;
  const bySubject = new Map<string, Framing>();
  return (t: number): Framing => {
    const a = scene.animation;
    const subject = subjectAt(scene, t);
    if (!a || !subject) return (all ??= framingFor(scene));
    const span = spanAt(a, t);
    const key = `${span.shot.id}:${subject}`;
    let f = bySubject.get(key);
    if (!f) {
      f = framingFor(scene, 8, { figure: subject, from: span.start, to: span.end });
      bySubject.set(key, f);
    }
    return f;
  };
}

/** Smooth pseudo-random wobble in [-1, 1] for hand-held shake. */
function wobble(t: number, seed: number) {
  return (Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 3.3 + seed * 2.1) * 0.3 + Math.sin(t * 7.9 + seed * 0.7) * 0.2);
}

/**
 * Put `camera` where the shot says. `follow` is the centre of the figures in this frame
 * (tracking shot); without it the frame stays fixed on the whole animation.
 * Returns the point the camera looks at.
 */
export function placeShot(
  camera: THREE.PerspectiveCamera,
  f: Framing,
  key: CameraKey,
  aspect: number,
  opts: { follow?: THREE.Vector3 | null; shake?: number; t?: number } = {},
) {
  const shake = opts.shake ?? 0;
  const t = opts.t ?? key.t;
  const yaw = key.yaw + shake * 1.6 * wobble(t, 1);
  const pitch = key.pitch + shake * 1.1 * wobble(t, 4);
  const view = { yaw, pitch, fov: key.fov };
  camera.aspect = aspect;
  const fit = fitCamera(camera, { forEachPoint: (cb) => f.points.forEach(cb) }, view, 0.1);
  const target = fit.clone();
  if (opts.follow) target.add(opts.follow.clone().sub(f.center));
  const dist = fit.distance / Math.max(0.1, key.zoom);
  const dir = viewDirection(view);
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right);
  const tanV = Math.tan(THREE.MathUtils.degToRad(key.fov) / 2);
  target.addScaledVector(right, key.pan[0] * dist * tanV * aspect).addScaledVector(up, key.pan[1] * dist * tanV);
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.near = Math.max(0.01, dist * 0.02);
  camera.far = dist + 200;
  camera.updateProjectionMatrix();
  return target;
}

/** The shot that reproduces an editor camera (position + orbit target): for "set camera key". */
export function captureShot(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  f: Framing,
  aspect: number,
  follow?: THREE.Vector3 | null,
): Omit<CameraKey, 't'> {
  const d = camera.position.clone().sub(target);
  const dist = d.length();
  d.normalize();
  const yaw = THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z));
  const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)));
  const fov = camera.fov;
  const scratch = new THREE.PerspectiveCamera(fov, aspect);
  const base = placeShot(scratch, f, { t: 0, yaw, pitch, fov, zoom: 1, pan: [0, 0] }, aspect, { follow });
  const baseDist = scratch.position.distanceTo(base);
  const dir = viewDirection({ yaw, pitch });
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right);
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const delta = target.clone().sub(base);
  const r = (v: number, step = 0.01) => Math.round(v / step) * step || 0;
  return {
    yaw: r(yaw, 0.1),
    pitch: r(pitch, 0.1),
    fov: r(fov, 0.1),
    zoom: r(baseDist / Math.max(1e-6, dist), 0.001),
    pan: [r(delta.dot(right) / (dist * tanV * aspect), 0.001), r(delta.dot(up) / (dist * tanV), 0.001)],
  };
}

/* ---------- camera moves ---------- */

/** Groups of the camera moves: where the camera goes. */
export const CAMERA_GROUPS = ['Fixed', 'Towards & away', 'Around & up', 'Following'] as const;

export interface CameraMove {
  id: string;
  name: string;
  group: (typeof CAMERA_GROUPS)[number];
  description: string;
  follow?: boolean;
  shake?: number;
  keys(a: Animation, base: { yaw: number; pitch: number; fov: number }): CameraKey[];
}

const key = (t: number, yaw: number, pitch: number, fov: number, zoom = 1, pan: [number, number] = [0, 0]): CameraKey => ({ t, yaw: wrapDeg(yaw), pitch, fov, zoom, pan });

/** Ready-made shots, applied over the whole animation. */
export const CAMERA_MOVES: CameraMove[] = [
  {
    id: 'static', group: 'Fixed', name: 'Locked-off wide', description: 'A fixed camera that shows everything',
    keys: (_, b) => [key(0, b.yaw, b.pitch, b.fov)],
  },
  {
    id: 'push', group: 'Towards & away', name: 'Push in', description: 'Slowly dolly towards the figures',
    keys: (a, b) => [key(0, b.yaw, b.pitch, b.fov, 1), key(a.duration, b.yaw, b.pitch, b.fov, 1.8, [0, 0.25])],
  },
  {
    id: 'pull', group: 'Towards & away', name: 'Pull out', description: 'Start close and reveal the whole scene',
    keys: (a, b) => [key(0, b.yaw, b.pitch, b.fov, 1.9, [0, 0.3]), key(a.duration, b.yaw, b.pitch, b.fov, 1)],
  },
  {
    id: 'orbit90', group: 'Around & up', name: 'Arc 90°', description: 'Circle a quarter of the way around',
    keys: (a, b) => [key(0, b.yaw - 45, b.pitch + 4, b.fov, 1.1), key(a.duration, b.yaw + 45, b.pitch + 4, b.fov, 1.1)],
  },
  {
    id: 'orbit360', group: 'Around & up', name: 'Orbit 360°', description: 'A full turntable around the figures',
    keys: (a, b) => {
      const n = 4;
      const keys = Array.from({ length: n }, (_, i) => key((a.duration * i) / n, b.yaw + (360 * i) / n, b.pitch + 6, b.fov));
      return a.loop ? keys : [...keys, key(a.duration, b.yaw + 360, b.pitch + 6, b.fov)];
    },
  },
  {
    id: 'crane', group: 'Around & up', name: 'Crane up', description: 'Rise from eye level to a high angle',
    keys: (a, b) => [key(0, b.yaw, -2, b.fov, 1.15), key(a.duration, b.yaw + 15, 48, b.fov, 0.95)],
  },
  {
    id: 'hero', group: 'Fixed', name: 'Low-angle hero', description: 'Look up at the figures with a wide lens',
    keys: (a, b) => [key(0, b.yaw - 15, -14, 38, 1.25, [0, 0.12]), key(a.duration, b.yaw + 10, -8, 34, 1.4, [0, 0.18])],
  },
  {
    id: 'tracking', group: 'Following', name: 'Tracking shot', description: 'Follow alongside, keeping the figures in frame', follow: true,
    keys: (_, b) => [key(0, b.yaw + 90, 3, 30, 1.35, [0, 0.15])],
  },
  {
    id: 'vertigo', group: 'Towards & away', name: 'Dolly zoom', description: 'The “Vertigo” effect: the lens widens while the figures keep their size',
    keys: (a, b) => [key(0, b.yaw, b.pitch, 14, 1.05), key(a.duration, b.yaw, b.pitch, 62, 1.05)],
  },
  {
    id: 'handheld', group: 'Following', name: 'Hand-held', description: 'A close, slightly shaky documentary feel', shake: 0.6,
    keys: (a, b) => [key(0, b.yaw + 10, b.pitch + 2, 32, 1.35, [0, 0.22]), key(a.duration, b.yaw - 5, b.pitch, 32, 1.45, [0, 0.26])],
  },
];

/** World camera pose for every frame of a time range (for camera.json in keyframe packs). */
export function cameraPath(scene: Scene, start: number, end: number, aspect: number) {
  const a = scene.animation;
  const fps = a?.fps ?? 24;
  const frameAt = shotFramer(scene);
  const view = new SceneView();
  const cam = new THREE.PerspectiveCamera(30, aspect);
  const frames: { frame: number; time: number; position: number[]; target: number[]; fov: number }[] = [];
  const n = a ? Math.max(1, Math.round((end - start) * fps)) : 1;
  const r = (v: number) => Math.round(v * 10000) / 10000;
  for (let i = 0; i < n; i++) {
    const t = start + i / fps;
    let follow: THREE.Vector3 | null = null;
    if (a?.camera?.follow) {
      view.sync(sceneAt(scene, t));
      follow = figuresCenter(view, subjectAt(scene, t));
    }
    const target = placeShot(cam, frameAt(t), shotAt(scene, t), aspect, { follow, shake: a?.camera?.shake ?? 0, t });
    frames.push({ frame: Math.round(t * fps), time: r(t), position: cam.position.toArray().map(r), target: target.toArray().map(r), fov: r(cam.fov) });
  }
  view.dispose();
  return { units: 'metres, +Y up, floor at y = 0', aspect: r(aspect), fps, frames };
}
