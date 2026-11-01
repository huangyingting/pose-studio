import * as THREE from 'three';
import { wrapDeg } from '../joints';
import { defaultCamera, uid, nextName } from '../doc';
import { snapTime, newAnimation } from '../animation';
import { coverageById, castCoverage, applyCoverage } from '../coverage';
import { liveCamera, firstFilmed, viewOf, rigFrom, standing, cameraById, withCamera, fovLens, frameAspect, capturePoint, lensFov, type ShotSize, type Placement, framePoint, angleOf, restate, subjectPlace, pointIn, reform, TRIPOD_MOVES, type CameraView, cameraAt, newCamera, LENSES, SHOT_SIZES, reshapeCamera, filmWith } from '../cameras';
import { setPointAt, removePointAt, movePoint, shotSpans, updateShot, spanAt, removeCamera, cutAt, pinShots, removeCut, moveCut, unpinShot as unpin } from '../shots';
import type { Store } from '../store';
import type { Scene, Camera, RigCamera, CameraRig, CameraPoint, PathCamera, Vec3, CameraMove } from '../types';
import { startAnimation } from './motion';
import { here } from './timeline';

/* Cameras (objects of the scene, lib/cameras.ts) and the shots that film with them. */

/** When a camera's framing is taken: at the playhead if it films then, else as it first films. */
const framingTime = (s: Scene, cam: Camera, now: number) => (liveCamera(s, now).id === cam.id ? now : firstFilmed(s, cam));

/**
 * A fixed camera's angle on its subject, its size and lens, as seen from where it stands (#21): the
 * framing it has there (kept, so its framing controls start from where it is).
 */
function fixedFraming(s: Scene, cam: RigCamera, fixed: NonNullable<CameraRig['fixed']>, t: number, lens: number): CameraRig {
  const { fixed: _, move, ...rest } = cam.rig;
  void _;
  const seen = viewOf(s, { ...cam, shake: undefined, rig: { ...rest, lens, fixed: { ...fixed, aim: 'subject' } } }, t);
  return { ...rigFrom(s, { ...cam, rig: rest }, seen, t, { lens }), ...(move ? { move } : {}), fixed };
}

/** A fixed camera put exactly where a view has it (#21): its framing from there. */
export function placeFixed(s: Scene, cam: RigCamera, t: number, position: THREE.Vector3, look: THREE.Vector3, lens: number): RigCamera {
  const fixed = { ...standing(position, look), ...(cam.rig.fixed?.aim ? { aim: cam.rig.fixed.aim } : {}) };
  return { ...cam, rig: fixedFraming(s, cam, fixed, t, Math.round(lens * 10) / 10) };
}

/**
 * A fixed camera put where a framing of its subject is (#21): from its angle on it where it stands,
 * with what `patch` changes (its size, where the subject sits, its angle).
 */
function restand(s: Scene, cam: RigCamera, patch: Partial<CameraRig>, t: number): CameraRig {
  const { fixed, move, ...rest } = cam.rig;
  const from = fixed ? fixedFraming(s, cam, fixed, t, rest.lens) : cam.rig;
  const { fixed: _f, move: _m, ...framing } = { ...from, ...patch };
  void _f; void _m;
  const v = viewOf(s, { ...cam, shake: undefined, rig: framing }, t);
  return { ...framing, ...(move ? { move } : {}), fixed: { ...standing(v.position, v.target), ...(fixed?.aim ? { aim: fixed.aim } : {}) } };
}

/** A path camera of a scene, by id. */
export const pathCamera = (s: Scene, id: string) => {
  const cam = cameraById(s, id);
  return cam?.kind === 'path' ? cam : null;
};

/**
 * Set the camera filming at the playhead (or `camera`) to look as a view does (from `position` at
 * `look`, through a lens with this field of view): a path camera gets a point there; a rig takes
 * the view's angle from its subject and its lens, keeping its shot size.
 */
export function setCameraPoint(store: Store, position: THREE.Vector3, look: THREE.Vector3, fov: number, key = '', camera?: string) {
  const { t, fps } = here(store);
  store.updateScene((s) => {
    const cam = (camera && cameraById(s, camera)) || liveCamera(s, t);
    // (Fixed, #21: put exactly there, never a point added.)
    if (cam.kind === 'rig' && cam.rig.fixed) return withCamera(s, placeFixed(s, cam, t, position, look, fovLens(fov, frameAspect())));
    if (cam.kind === 'rig') {
      const view = { position, target: look, fov, lens: fovLens(fov, frameAspect()), roll: 0 };
      return withCamera(s, { ...cam, rig: rigFrom(s, cam, view, t, { size: cam.rig.size, lens: Math.round(view.lens) }) });
    }
    return withCamera(s, setPointAt(cam, fps, t, capturePoint(s, cam, t, position, look, fov)));
  }, key);
}

/** A point on a path camera's path at t (on a frame), where it passes then. */
export function addCameraPoint(store: Store, camera: string, t: number) {
  store.updateScene((s) => {
    const cam = pathCamera(s, camera);
    if (!s.animation || !cam) return s;
    const time = snapTime(s.animation, t);
    const view = viewOf(s, cam, time);
    return withCamera(s, setPointAt(cam, s.animation.fps, time, { ...capturePoint(s, cam, time, view.position, view.target, view.fov), ...(view.roll ? { roll: view.roll } : {}) }));
  });
}

/** Move a path camera's point at time t to another place in the world (dragged on the canvas); it keeps looking where it did. */
export function moveCameraPoint(store: Store, camera: string, t: number, position: THREE.Vector3, key = '') {
  store.updateScene((s) => {
    const cam = pathCamera(s, camera);
    if (!cam) return s;
    const before = viewOf(s, cam, t);
    const point = capturePoint(s, cam, t, position, before.target, before.fov);
    return withCamera(s, setPointAt(cam, s.animation?.fps ?? 24, t, { ...point, ...(before.roll ? { roll: before.roll } : {}) }));
  }, key);
}

/** Point a path camera at time t at another place in the world (its look point dragged). */
export function moveCameraLook(store: Store, camera: string, t: number, look: THREE.Vector3, key = '') {
  store.updateScene((s) => {
    const cam = pathCamera(s, camera);
    if (!cam) return s;
    const before = viewOf(s, cam, t);
    return withCamera(s, setPointAt(cam, s.animation?.fps ?? 24, t, capturePoint(s, cam, t, before.position, look, before.fov)));
  }, key);
}

/** A path camera's lens at its point at time t (the wheel over it), where it is and where it looks kept. */
export function setCameraLens(store: Store, camera: string, t: number, mm: number, key = '') {
  store.updateScene((s) => {
    const cam = pathCamera(s, camera);
    if (!cam) return s;
    const before = viewOf(s, cam, t);
    const point = capturePoint(s, cam, t, before.position, before.target, lensFov(mm, frameAspect()));
    return withCamera(s, setPointAt(cam, s.animation?.fps ?? 24, t, { ...point, ...(before.roll ? { roll: before.roll } : {}) }));
  }, key);
}

/** A path camera's point at t: the camera comes to a stop there (its path may turn sharply), or goes on through it (#16). */
export function setCameraPointStop(store: Store, camera: string, t: number, stop: boolean) {
  store.updateScene((s) => {
    const cam = pathCamera(s, camera);
    if (!cam) return s;
    const points = cam.points.map((p) => {
      if (Math.abs(p.t - t) > 1e-3) return p;
      const q: CameraPoint = { ...p };
      if (stop) q.stop = true;
      else delete q.stop;
      return q;
    });
    return withCamera(s, { ...cam, points });
  });
}

/** What a path camera's point at t looks at, its own (a figure, a spot), or (null) as the camera aims (#16). */
export function setCameraPointAim(store: Store, camera: string, t: number, aim: CameraPoint['aim'] | null) {
  store.updateScene((s) => {
    const cam = pathCamera(s, camera);
    if (!cam) return s;
    const points = cam.points.map((p) => {
      if (Math.abs(p.t - t) > 1e-3) return p;
      const q: CameraPoint = { ...p };
      if (aim) q.aim = aim;
      else delete q.aim;
      return q;
    });
    return withCamera(s, { ...cam, points });
  });
}

/** Remove the point at t of a path camera (by default the one filming then); its last point stays. */
export function deleteCameraPoint(store: Store, t = store.getState().time, camera?: string) {
  store.updateScene((s) => {
    const cam = camera ? pathCamera(s, camera) : liveCamera(s, t);
    if (!s.animation || cam?.kind !== 'path') return s;
    return withCamera(s, removePointAt(cam, s.animation.fps, snapTime(s.animation, t)));
  });
}

/** Retime the point at `from` of a path camera (by default the one filming then). */
export function retimeCameraPoint(store: Store, from: number, to: number, key = '', camera?: string) {
  store.updateScene((s) => {
    const cam = camera ? pathCamera(s, camera) : liveCamera(s, from);
    if (!s.animation || cam?.kind !== 'path') return s;
    return withCamera(s, movePoint(cam, s.animation, from, snapTime(s.animation, to)));
  }, key);
}

/**
 * Frame the subject of the camera filming at the playhead (or `camera`) at a shot size: the camera keeps its
 * angle and lens (`lens`: another one), and comes as near as that size takes; `place`: where the
 * subject sits in the frame. A rig keeps that size from then on.
 */
export function frameShot(store: Store, size: ShotSize, o: { lens?: number; place?: Placement; camera?: string } = {}) {
  const { t, fps } = here(store);
  store.updateScene((s) => {
    const cam = (o.camera && cameraById(s, o.camera)) || liveCamera(s, t);
    if (cam.kind === 'rig') {
      const { place: _place, ...rig } = cam.rig;
      void _place;
      const place = o.place ?? cam.rig.place;
      const framed = { ...rig, size, ...(o.lens ? { lens: o.lens } : {}), ...(place && place !== 'center' ? { place } : {}) };
      // (Fixed, #21: put where that framing is.)
      if (cam.rig.fixed) return withCamera(s, { ...cam, rig: restand(s, cam, { size, lens: framed.lens, place: framed.place }, framingTime(s, cam, t)) });
      return withCamera(s, { ...cam, rig: framed });
    }
    const view = viewOf(s, cam, t);
    const point = framePoint(s, cam, t, size, { ...angleOf(view), lens: o.lens ?? view.lens, place: o.place });
    return withCamera(s, setPointAt(cam, fps, t, point));
  });
}

/**
 * The lens at the playhead (mm) of the camera filming there (or `camera`). `keep: 'size'` keeps the subject the same size in the frame (the
 * camera moves nearer or further, as with a dolly zoom); `keep: 'place'` keeps the camera where it
 * is (the frame gets wider or tighter). A rig always keeps its shot size.
 */
export function setLens(store: Store, mm: number, keep: 'size' | 'place' = 'size', key = '', camera?: string) {
  const { t, fps } = here(store);
  const lens = Math.min(1200, Math.max(4, mm));
  store.updateScene((s) => {
    const cam = (camera && cameraById(s, camera)) || liveCamera(s, t);
    if (cam.kind === 'rig') return withCamera(s, { ...cam, rig: { ...cam.rig, lens } });
    const view = viewOf(s, cam, t);
    const position = keep === 'size'
      ? view.target.clone().add(view.position.clone().sub(view.target).multiplyScalar(lens / view.lens))
      : view.position;
    const point = capturePoint(s, cam, t, position, view.target, lensFov(lens, frameAspect()));
    return withCamera(s, setPointAt(cam, fps, t, { ...point, lens, ...(view.roll ? { roll: view.roll } : {}) }));
  }, key);
}

/**
 * A camera's settings: its name, what it films (subject, and whom it frames with them), how it
 * shakes; for a path camera, where its path is (anchor) and what it looks at (aim) — the path is
 * restated so the camera stays where it was — and how it eases.
 */
export function editCamera(store: Store, id: string, patch: { name?: string; subject?: string; also?: string[]; anchor?: PathCamera['anchor']; aim?: PathCamera['aim']; ease?: PathCamera['ease']; pace?: PathCamera['pace']; shake?: number }) {
  store.updateScene((s) => {
    const old = cameraById(s, id);
    if (!old) return s;
    const { name, subject, also, anchor, aim, ease, shake } = patch;
    let cam: Camera = old;
    const who = { ...(subject !== undefined ? { subject: subject || undefined } : {}) };
    if (cam.kind === 'path') {
      const where = { ...who, ...(anchor ? { anchor } : {}), ...(aim ? { aim } : {}) };
      cam = Object.keys(where).length ? restate(s, cam, where) : cam;
      cam = { ...cam, ...(ease ? { ease } : {}), ...('pace' in patch ? { pace: patch.pace } : {}) };
      if (cam.ease !== 'linear') delete cam.ease;
      if (cam.pace !== 'even') delete cam.pace;
    } else cam = { ...cam, ...who };
    // (A figure picked: no longer a point.)
    if (subject !== undefined && cam.point) {
      cam = cam.kind === 'path' ? restate(s, cam, { point: undefined }) : { ...cam };
      delete cam.point;
    }
    cam = { ...cam, ...(also ? { also } : {}), ...(shake !== undefined ? { shake } : {}), name: (name ?? cam.name).trim().slice(0, 60) || cam.name };
    if (!cam.subject) delete cam.subject;
    if (!cam.also?.length || !cam.subject) delete cam.also;
    if (!cam.shake) delete cam.shake;
    return withCamera(s, cam);
  }, `camera:${id}`);
}

/**
 * What a camera films (#16): a figure (its subject), or a point (its aim dropped on empty space,
 * or clicked through it). A path camera stays where it is at each of its points.
 */
export function aimCamera(store: Store, id: string, at: { figure: string } | { point: Vec3 }) {
  store.updateScene((s) => {
    const cam = cameraById(s, id);
    if (!cam) return s;
    const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
    const patch = 'figure' in at ? { subject: at.figure, point: undefined } : { subject: undefined, point: at.point.map(r3) as Vec3 };
    let next: Camera;
    if (cam.kind === 'path') {
      // (Each of its points where it is, now looking at its new subject's chest, or at the point.)
      const aimed = restate(s, cam, { ...patch, aim: 'figure' in at ? 'subject' : 'point' });
      const points = aimed.points.map((p) => {
        const v = viewOf(s, aimed, p.t);
        const look = 'figure' in at ? subjectPlace(s, aimed, p.t).setY(1.3) : new THREE.Vector3(...at.point);
        return { ...pointIn(s, aimed, p.t, v.position, look, p.lens, p.roll), ...(p.stop ? { stop: true as const } : {}), ...(p.aim ? { aim: p.aim } : {}) };
      });
      next = { ...aimed, points };
    } else next = { ...cam, ...patch };
    next = { ...next };
    if (!next.point) delete next.point;
    if (!next.subject) delete next.subject;
    if (!next.subject) delete next.also;
    return withCamera(s, next);
  }, `camera:${id}`);
}

/**
 * How a camera moves over each shot it films (#16), from its framing: none (it holds it), or a
 * move. A custom path becomes a camera framing its subject as it does at the playhead.
 */
export function setCameraMove(store: Store, id: string, move: CameraMove | null, key = `camera:${id}`) {
  const { t } = here(store);
  store.updateScene((s) => {
    const cam = cameraById(s, id);
    if (!cam) return s;
    const rig: CameraRig = { ...(cam.kind === 'rig' ? cam.rig : rigFrom(s, cam, viewOf(s, cam, t), t)) };
    if (move) rig.move = move;
    else delete rig.move;
    return withCamera(s, reform(cam, { kind: 'rig', rig, ...(cam.shake ? { shake: cam.shake } : {}) }));
  }, key);
}

/** What kind of camera it is to the user (#21): standing where it is put, following its subject, or along a path of its own. */
export type CameraStand = 'fixed' | 'follows' | 'path';
export const standOf = (cam: Camera): CameraStand => (cam.kind === 'path' ? 'path' : cam.rig.fixed ? 'fixed' : 'follows');

/**
 * Make a camera fixed, following or a path (#21), keeping the picture: fixed, it stands where it is
 * at the playhead (if it films then; else as it first films); following, it keeps its angle on its
 * subject from there. A fixed camera keeps only a tripod's move (a pan, tilt, zoom or roll).
 */
export function setCameraStand(store: Store, id: string, stand: CameraStand) {
  const cam = cameraById(store.scene, id);
  if (!cam || standOf(cam) === stand) return;
  if (stand === 'path') return editAsPath(store, id);
  const { t: now } = here(store);
  store.updateScene((s) => {
    const c = cameraById(s, id)!;
    const t = framingTime(s, c, now);
    // (Fixed to following: as if it had turned to its subject where it stands, to keep its angle on it.)
    const seen = c.kind === 'rig' && c.rig.fixed && stand === 'follows' ? { ...c, rig: { ...c.rig, move: undefined, fixed: { ...c.rig.fixed, aim: 'subject' as const } } } : c;
    const view = viewOf(s, { ...seen, shake: undefined } as Camera, t);
    const base: CameraRig = c.kind === 'rig' ? { ...c.rig } : rigFrom(s, c, view, t, { lens: Math.round(view.lens) });
    delete base.fixed;
    let rig: CameraRig;
    if (stand === 'fixed') {
      rig = { ...base, lens: Math.round(view.lens * 10) / 10, fixed: standing(view.position, view.target) };
      if (view.roll) rig.roll = Math.round(view.roll * 10) / 10;
      if (rig.move && !TRIPOD_MOVES.includes(rig.move.kind)) delete rig.move;
    } else {
      // (Its angle on its subject and its size from where it stood; its lens as it was.)
      rig = { ...rigFrom(s, reform(c, { kind: 'rig', rig: base }), view, t, { lens: base.lens }) };
      delete rig.fixed;
    }
    return withCamera(s, reform(c, { kind: 'rig', rig, ...(c.shake ? { shake: c.shake } : {}) }));
  }, `camera:${id}`);
}

/**
 * A camera as a custom path, to edit point by point (#16, one way): points where it goes over the
 * shots it films, every half second (a still scene: one).
 */
export function editAsPath(store: Store, id: string) {
  store.updateScene((s) => {
    const cam = cameraById(s, id);
    if (!cam || cam.kind === 'path') return s;
    const a = s.animation;
    const times = new Set<number>([0]);
    if (a) {
      times.clear();
      const spans = shotSpans(a).filter((x) => x.shot.camera === id);
      for (const sp of spans.length ? spans : [{ start: 0, end: a.duration }]) {
        const n = Math.max(1, Math.round((sp.end - sp.start) / 0.5));
        for (let i = 0; i <= n; i++) times.add(snapTime(a, sp.start + ((sp.end - sp.start) * i) / n));
      }
    }
    const path = reform(cam, { kind: 'path', anchor: 'world', aim: 'point', points: [], ...(cam.shake ? { shake: cam.shake } : {}) }) as PathCamera;
    const points = [...times].sort((p, q) => p - q).map((u) => {
      const v = viewOf(s, { ...cam, shake: undefined } as Camera, u);
      return capturePoint(s, path, u, v.position, v.target, v.fov);
    });
    return withCamera(s, { ...path, points });
  }, `camera:${id}`);
}

/** A rig's shot size, where the subject sits, its lens, its angle, how it turns, its smoothing, what its angle is measured from. */
export function editRig(store: Store, id: string, patch: Partial<CameraRig>, key = `rig:${id}`) {
  store.updateScene((s) => {
    const cam = cameraById(s, id);
    if (cam?.kind !== 'rig') return s;
    const rig: CameraRig = { ...cam.rig, ...patch };
    if (patch.yaw !== undefined) rig.yaw = wrapDeg(patch.yaw);
    if (patch.pitch !== undefined) rig.pitch = Math.min(89, Math.max(-89, patch.pitch));
    if (patch.smooth !== undefined) rig.smooth = Math.min(10, Math.max(0, patch.smooth));
    if (patch.lens !== undefined) rig.lens = Math.min(1200, Math.max(4, patch.lens));
    if (rig.place === 'center') delete rig.place;
    for (const k of ['turn', 'roll', 'move', 'toward', 'clear', 'smooth', 'fixed'] as const) if (!rig[k]) delete rig[k];
    // (Fixed, #21: a framing puts it where that framing is, at the playhead (if it films then); its
    // lens alone zooms, the camera staying.)
    const framing = (['yaw', 'pitch', 'size', 'place', 'toward'] as const).filter((k) => k in patch);
    if (rig.fixed && framing.length) {
      const changed = Object.fromEntries(framing.map((k) => [k, rig[k]])) as Partial<CameraRig>;
      return withCamera(s, { ...cam, rig: restand(s, { ...cam, rig }, changed, framingTime(s, cam, here(store).t)) });
    }
    return withCamera(s, { ...cam, rig });
  }, key);
}

/**
 * A new camera from the view at the playhead (where the camera filming there is now; `view`:
 * another one, as the editor's), fixed there; it films the shot at the playhead unless `film` is
 * false. Its id.
 */
export function addCamera(store: Store, view?: CameraView, film = true): string {
  const { t } = here(store);
  const s = store.scene;
  const live = liveCamera(s, t);
  const v = view ?? cameraAt(s, t);
  // (Fixed, #21: it stands where the view is, looking where it does.)
  const shell = reform(newCamera(s, live.subject ? { subject: live.subject } : {}), { kind: 'rig', rig: { yaw: 0, pitch: 0, size: 'fs', lens: 50, fixed: standing(v.position, v.target) } }) as RigCamera;
  const cam = placeFixed(s, shell, t, v.position, v.target, fovLens(v.fov, frameAspect()));
  store.updateScene((x) => {
    const a = x.animation;
    const withIt = { ...x, cameras: [...x.cameras, cam] };
    return a && film ? { ...withIt, animation: updateShot(a, spanAt(a, t).shot.id, { camera: cam.id }) } : withIt;
  });
  return cam.id;
}

/** A rig camera's shot size or lens a step closer (+1) or wider (−1): the wheel over it. */
export function stepRig(store: Store, cam: RigCamera, by: number, lens: boolean): string {
  if (lens) {
    const i = LENSES.reduce((b, mm, j) => (Math.abs(mm - cam.rig.lens) < Math.abs(LENSES[b] - cam.rig.lens) ? j : b), 0);
    const mm = LENSES[Math.min(LENSES.length - 1, Math.max(0, i + by))];
    editRig(store, cam.id, { lens: mm }, `wheel:${cam.id}`);
    return `${cam.name}: ${mm} mm lens`;
  }
  const i = SHOT_SIZES.findIndex((x) => x.id === cam.rig.size);
  const size = SHOT_SIZES[Math.min(SHOT_SIZES.length - 1, Math.max(0, i + by))];
  editRig(store, cam.id, { size: size.id }, `wheel:${cam.id}`);
  return `${cam.name}: ${size.name.toLowerCase()} shot`;
}

/** A camera of a shot's own to change (its id): the one it films with if no other shot does, or else a copy of it for it. */
export function ownCamera(store: Store, shotId: string): string | null {
  const s = store.scene;
  const a = s.animation;
  const span = a && shotSpans(a).find((x) => x.shot.id === shotId);
  if (!a || !span) return null;
  const cam = cameraById(s, span.shot.camera) ?? s.cameras[0];
  if (!shotSpans(a).some((x) => x.shot.id !== shotId && x.shot.camera === cam.id)) return cam.id;
  const fresh = newCamera(s);
  const copy = { ...structuredClone(cam), id: fresh.id, name: fresh.name };
  store.updateScene((x) => (x.animation ? { ...x, cameras: [...x.cameras, copy], animation: updateShot(x.animation, shotId, { camera: copy.id }) } : x));
  return copy.id;
}

/** Make a shot about one figure (or everyone: ''), on a camera of its own. */
export function setShotSubject(store: Store, shotId: string, figure: string) {
  const id = ownCamera(store, shotId);
  if (id) editCamera(store, id, { subject: figure });
}

/** A copy of a camera, as the user's own (not a coverage's), selected. Its id. */
export function duplicateCamera(store: Store, id: string): string | null {
  const src = cameraById(store.scene, id);
  if (!src) return null;
  const { made: _made, ...rest } = structuredClone(src);
  void _made;
  const copy = { ...rest, id: uid('cam'), name: nextName(`${src.name} copy`, store.scene.cameras.map((c) => c.name)) } as Camera;
  store.updateScene((s) => ({ ...s, cameras: [...s.cameras, copy] }));
  store.select({ kind: 'camera', camera: copy.id });
  return copy.id;
}

/** Remove a camera (not the scene's last): the shots it filmed are filmed by the first of the others. */
export function deleteCamera(store: Store, id: string): boolean {
  const s0 = store.scene;
  const cam = cameraById(s0, id);
  // One of the director's cameras deleted: the cameras and cuts are the user's from now on (By hand).
  const takeOver = !!s0.coverage?.live && !!cam?.made?.startsWith(`${s0.coverage.id}:`);
  store.updateScene((s) => {
    const next = removeCamera(s, id);
    return takeOver && next.coverage ? { ...next, coverage: { id: next.coverage.id, roles: next.coverage.roles } } : next;
  });
  if (store.getState().selection?.kind === 'camera') store.select(null);
  return takeOver;
}

/**
 * ProjectSettings the animation with a coverage (lib/coverage.ts): its cameras on the figures in its roles
 * (given, or as cast before, or A the active figure and B the one nearest it), cut on what they
 * do. The figures cast, or null if there are too few people for it.
 */
export function coverScene(store: Store, id: string, roles?: Record<string, string>): Record<string, string> | null {
  return store.group(() => cover(store, id, roles));
}

export function cover(store: Store, id: string, roles?: Record<string, string>): Record<string, string> | null {
  const c = coverageById(id);
  if (!c) return null;
  if (!store.scene.animation) startAnimation(store, 4);
  const s = store.scene;
  // (The roles it had, if those figures are all still there; else cast again.)
  const had = s.coverage?.id === id && c.roles.every((r) => s.figures.some((f) => f.id === s.coverage!.roles[r] && !f.hidden)) ? s.coverage.roles : null;
  const cast = roles ?? had ?? castCoverage(s, c, store.getState().activeFigure ?? undefined);
  if (!cast || c.roles.some((r) => !s.figures.some((f) => f.id === cast[r])) || new Set(c.roles.map((r) => cast[r])).size < c.roles.length) return null;
  store.updateScene((x) => applyCoverage(x, id, cast as Record<'A', string>));
  return cast;
}

/** Give the current shot (the whole animation without cuts) a ready-made camera move, or reshape one camera (`camera`) with it. */
export function applyCameraMove(store: Store, id: string, camera?: string) {
  const t = store.getState().time;
  store.updateScene((s) => {
    const animated = s.animation ? s : { ...s, animation: newAnimation(s, 4) };
    return camera ? reshapeCamera(animated, id, camera) : filmWith(animated, id, { index: spanAt(animated.animation!, t).index });
  });
}
/** Cut at the playhead: a new shot starts there, filming with the same camera until given another. */
/* (A shot cut, moved, joined or given another camera by hand is the user's: the director keeps it.) */

export function cutShot(store: Store) {
  const t = store.getState().time;
  store.updateScene((s) => {
    if (!s.animation) return s;
    const at = snapTime(s.animation, t);
    const a = cutAt(s.animation, at);
    // (The shot that starts at the cut: the one made.)
    const made = a !== s.animation ? a.shots.find((x) => Math.abs(x.start - at) < 0.5 / a.fps) : undefined;
    return { ...s, animation: made ? pinShots(a, [made.id]) : a };
  });
}

export function removeShotCut(store: Store, id: string) {
  store.updateScene((s) => {
    if (!s.animation) return s;
    const i = s.animation.shots.findIndex((x) => x.id === id);
    const a = removeCut(s.animation, id);
    return { ...s, animation: i > 0 ? pinShots(a, [s.animation.shots[i - 1].id]) : a };
  });
}

/** Move the cut at the start of a shot (dragged on the timeline): no camera changes. */
export function moveShotCut(store: Store, id: string, t: number, key = '') {
  store.updateScene((s) => {
    if (!s.animation) return s;
    const i = s.animation.shots.findIndex((x) => x.id === id);
    const a = moveCut(s.animation, id, t);
    return { ...s, animation: pinShots(a, [id, ...(i > 0 ? [s.animation.shots[i - 1].id] : [])]) };
  }, key);
}

/** A camera as a new scene has it: the default, never changed (its id aside). */
function untouched(c: Camera) {
  return JSON.stringify({ ...c, id: '' }) === JSON.stringify({ ...defaultCamera(c.name), id: '' });
}

/**
 * The director (#14): the scene filmed in a style (a coverage, cast from who is in it) and cut
 * again as what they do changes; null: by hand from now on (its cameras and cuts stay as they are).
 */

export function setDirector(store: Store, style: string | null, roles?: Record<string, string>): boolean {
  return store.group(() => {
    if (!style) {
      store.updateScene((s) => (s.coverage?.live ? { ...s, coverage: { id: s.coverage.id, roles: s.coverage.roles } } : s));
      return true;
    }
    // (Already filming in this style: as it is, its pinned shots kept.)
    if (store.scene.coverage?.live && store.scene.coverage.id === style) return true;
    const cast = cover(store, style, roles);
    if (cast) store.updateScene((s) => (s.coverage ? { ...s, coverage: { ...s.coverage, live: true } } : s));
    // (The camera the scene came with, filming none of it now and never changed: it goes, not left
    // in the outline beside the director's. One changed by hand stays.)
    if (cast) {
      store.updateScene((s) => {
        const shots = s.animation?.shots ?? [];
        const idle = (c: Camera) => !c.made && !shots.some((x) => x.camera === c.id) && untouched(c);
        return s.cameras.some(idle) && s.cameras.some((c) => !idle(c)) ? { ...s, cameras: s.cameras.filter((c) => !idle(c)) } : s;
      }, '');
    }
    return !!cast;
  });
}

/** A shot taken over by hand handed back to the director (cut again as it would be). */
export function unpinShot(store: Store, id: string) {
  store.updateScene((s) => (s.animation ? { ...s, animation: unpin(s.animation, id) } : s));
}

/** A shot's name and caption, the camera it films with (one of the scene's) and how long it blends in from the one before (0: a cut). */
export function editShot(store: Store, id: string, patch: { name?: string; caption?: string; camera?: string; blend?: number }) {
  store.updateScene((s) => {
    if (!s.animation) return s;
    const { camera, blend, ...rest } = patch;
    const given = camera && cameraById(s, camera) ? { camera } : {};
    const a0 = updateShot(s.animation, id, { ...rest, ...given });
    const a = 'camera' in given ? pinShots(a0, [id]) : a0;
    const shots = a.shots.map((x) => {
      if (x.id !== id || blend === undefined) return x;
      const { blend: _old, ...shot } = x;
      void _old;
      const b = Math.min(10, Math.max(0, Math.round(blend * 100) / 100));
      return { ...shot, ...(b ? { blend: b } : {}) };
    });
    return { ...s, animation: { ...a, shots } };
  }, `shot:${id}`);
}
