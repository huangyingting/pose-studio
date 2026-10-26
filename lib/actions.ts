import { cloneHand } from './hands';
import {
  NEUTRAL_JOINTS, duplicateScene, mirrorFigure, mirrorScene, newFigure, newProp, newScene, symmetrize, uid,
} from './doc';
import { moveKey, newAnimation, removeKey, setDuration as setAnimDuration, setKey, snapTime } from './animation';
import { presetScenes } from './presets';
import {
  Rig, atDistance, backToBack, besides, contactPoint, distance, faceEachOther, headPoint, inFrontOf, lookAt, reach, turnTowards,
  withFacing, withPosition, type Contact,
} from './relations';
import { CAMERA_MOVES } from './shot';
import type { Store } from './store';
import type { Animation, CameraKey, CameraTrack, Figure, Hand, JointName, Prop, PropKind, Scene, Side, Vec3, View } from './types';

/* Scenes (library entries) */

export function addScene(store: Store, scene: Scene = newScene()) {
  const at = store.getState().sceneIndex + 1;
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes.slice(0, at), scene, ...lib.scenes.slice(at)] }), '', {
    sceneIndex: at, selection: null, activeFigure: null,
  });
}

export function appendScenes(store: Store, scenes: Scene[]) {
  const at = store.getState().library.scenes.length;
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes, ...scenes] }), '', { sceneIndex: at, selection: null, activeFigure: null });
}

export function duplicateCurrentScene(store: Store) {
  addScene(store, duplicateScene(store.scene));
}

export function deleteScene(store: Store, index = store.getState().sceneIndex) {
  const { library, sceneIndex } = store.getState();
  if (library.scenes.length <= 1) return false;
  store.commit((lib) => ({ ...lib, scenes: lib.scenes.filter((_, i) => i !== index) }), '', {
    sceneIndex: index <= sceneIndex ? Math.max(0, sceneIndex - 1) : sceneIndex, selection: null,
  });
  return true;
}

export function moveScene(store: Store, from: number, to: number) {
  const n = store.getState().library.scenes.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return;
  const scenes = [...store.getState().library.scenes];
  const [s] = scenes.splice(from, 1);
  scenes.splice(to, 0, s);
  // Keep the open pose selected, wherever it ends up.
  const current = store.scene.id;
  store.commit((lib) => ({ ...lib, scenes }), '', { sceneIndex: scenes.findIndex((x) => x.id === current) });
}

export function resetLibrary(store: Store) {
  store.commit(() => ({ version: 2, scenes: presetScenes() }), '', { sceneIndex: 0, selection: null, activeFigure: null });
}

export function replaceLibrary(store: Store, scenes: Scene[]) {
  store.commit(() => ({ version: 2, scenes }), '', { sceneIndex: 0, selection: null, activeFigure: null });
}

export function renameScene(store: Store, name: string) {
  store.updateScene((s) => ({ ...s, name }), 'rename');
}

export function setSceneView(store: Store, view: View) {
  store.updateScene((s) => ({ ...s, view }), 'view');
}

export function mirrorCurrentScene(store: Store) {
  store.updateScene(mirrorScene);
}

/* Figures */

export function addFigure(store: Store) {
  const scene = store.scene;
  const base = store.figure;
  // Place the new figure beside the existing ones, with the same proportions as the active one.
  const xs = scene.figures.map((f) => f.position[0]);
  const fig = newFigure({
    name: `Figure ${scene.figures.length + 1}`,
    position: [xs.length ? Math.max(...xs) + 0.8 : 0, 0, 0],
    ...(base ? { body: { ...base.body } } : {}),
  });
  addFigures(store, [fig]);
}

export function addFigures(store: Store, figures: Figure[]) {
  const i = store.getState().sceneIndex;
  store.commit(
    (lib) => ({ ...lib, scenes: lib.scenes.map((s, j) => (j === i ? { ...s, figures: [...s.figures, ...figures] } : s)) }),
    '',
    { activeFigure: figures[0].id, selection: null },
  );
}

export function duplicateFigure(store: Store, id: string) {
  const src = store.scene.figures.find((f) => f.id === id);
  if (!src) return;
  const copy: Figure = { ...structuredClone(src), id: uid('f'), name: `${src.name} copy`, position: [src.position[0] + 0.8, src.position[1], src.position[2]] };
  addFigures(store, [copy]);
}

export function deleteFigure(store: Store, id: string) {
  if (store.scene.figures.length <= 1) return false;
  store.updateScene((s) => ({ ...s, figures: s.figures.filter((f) => f.id !== id) }));
  return true;
}

export function setFigureHidden(store: Store, id: string, hidden: boolean) {
  store.updateFigure(id, (f) => {
    const next = { ...f, hidden: true };
    if (!hidden) delete (next as Partial<Figure>).hidden;
    return next;
  });
  if (hidden && store.getState().selection?.kind === 'joint') store.select(null);
}

export function renameFigure(store: Store, id: string, name: string) {
  store.updateFigure(id, (f) => ({ ...f, name }), `rename:${id}`);
}

export function resetPose(store: Store) {
  store.updateActiveFigure((f) => ({ ...f, joints: structuredClone(NEUTRAL_JOINTS) }));
}

export function mirrorPose(store: Store) {
  store.updateActiveFigure((f) => ({ ...mirrorFigure(f), position: f.position }));
}

export function symmetrizePose(store: Store, from: Side) {
  store.updateActiveFigure((f) => symmetrize(f, from));
}

export function setJoint(store: Store, figure: string, joint: JointName, value: Vec3, key: string) {
  store.updateFigure(figure, (f) => ({ ...f, joints: { ...f.joints, [joint]: value } }), key);
}

export function setGrounded(store: Store, figure: string, grounded: boolean, currentPosition?: Vec3) {
  store.updateFigure(figure, (f) => ({ ...f, grounded, position: currentPosition ?? f.position }));
}

export function setHand(store: Store, side: Side, hand: Hand, key = '') {
  store.updateActiveFigure((f) => ({ ...f, hands: { ...f.hands, [side]: cloneHand(hand) } }), key);
}

export function copyPose(store: Store) {
  const f = store.figure;
  if (!f) return false;
  store.clipboard = { joints: structuredClone(f.joints), hands: structuredClone(f.hands) };
  return true;
}

export function pastePose(store: Store) {
  const clip = store.clipboard;
  if (!clip || !store.figure) return false;
  store.updateActiveFigure((f) => ({ ...f, joints: structuredClone(clip.joints), hands: structuredClone(clip.hands) }));
  return true;
}

/* Props */

export function addProp(store: Store, kind: PropKind) {
  const scene = store.scene;
  const xs = scene.figures.map((f) => f.position[0]);
  const prop = newProp(kind, [(xs.length ? Math.max(...xs) : 0) + 0.9, 0, 0]);
  store.updateScene((s) => ({ ...s, props: [...s.props, prop] }));
  store.select({ kind: 'prop', prop: prop.id });
}

export function duplicateProp(store: Store, id: string) {
  const src = store.scene.props.find((p) => p.id === id);
  if (!src) return;
  const copy: Prop = { ...structuredClone(src), id: uid('p'), position: [src.position[0] + 0.3, src.position[1], src.position[2] + 0.3] };
  store.updateScene((s) => ({ ...s, props: [...s.props, copy] }));
  store.select({ kind: 'prop', prop: copy.id });
}

export function deleteProp(store: Store, id: string) {
  store.updateScene((s) => ({ ...s, props: s.props.filter((p) => p.id !== id) }));
}

export function deleteSelection(store: Store) {
  const sel = store.getState().selection;
  if (sel?.kind === 'prop') {
    deleteProp(store, sel.prop);
    return true;
  }
  return false;
}

/* Placement and relationships between figures */

/** Move / turn a figure on the floor (any of x, z, facing yaw). */
export function setPlacement(store: Store, id: string, p: { x?: number; z?: number; yaw?: number }, key = '') {
  store.updateFigure(id, (f) => {
    let next = f;
    if (p.x !== undefined || p.z !== undefined) next = withPosition(next, p.x ?? f.position[0], p.z ?? f.position[2]);
    if (p.yaw !== undefined) next = withFacing(next, p.yaw);
    return next;
  }, key);
}

export type Arrangement = 'face' | 'faceEachOther' | 'besideL' | 'besideR' | 'backToBack' | 'inFront';

/** Arrange figure `a` relative to figure `b` (only `faceEachOther` also turns `b`). */
export function arrange(store: Store, a: string, b: string, how: Arrangement) {
  const fa = store.scene.figures.find((f) => f.id === a);
  const fb = store.scene.figures.find((f) => f.id === b);
  if (!fa || !fb || a === b) return;
  let na = fa;
  let nb = fb;
  if (how === 'face') na = turnTowards(fa, fb);
  else if (how === 'faceEachOther') [na, nb] = faceEachOther(fa, fb);
  else if (how === 'besideL' || how === 'besideR') na = besides(fa, fb, how === 'besideL' ? 'L' : 'R', 0.55 * (fa.body.height + fb.body.height) / 3.4);
  else if (how === 'backToBack') na = backToBack(fa, fb, 0.32);
  else na = inFrontOf(fa, fb, Math.max(0.8, distance(fa, fb)));
  store.updateScene((s) => ({ ...s, figures: s.figures.map((f) => (f.id === a ? na : f.id === b ? nb : f)) }));
}

/** Set the floor distance between two figures by moving `a`. */
export function setDistance(store: Store, a: string, b: string, d: number, key = '') {
  const fb = store.scene.figures.find((f) => f.id === b);
  if (!fb || a === b) return;
  store.updateFigure(a, (f) => atDistance(f, fb, d), key);
}

/** Turn `a`'s head (and if needed its chest) to look at `b`'s face. */
export function lookAtFigure(store: Store, a: string, b: string) {
  const fa = store.scene.figures.find((f) => f.id === a);
  const fb = store.scene.figures.find((f) => f.id === b);
  if (!fa || !fb || a === b) return;
  const rig = new Rig();
  try {
    const target = headPoint(rig.model(fb), fb);
    const joints = lookAt(rig, fa, target, store.getState().settings.limits);
    store.updateFigure(a, (f) => ({ ...f, joints }));
  } finally {
    rig.dispose();
  }
}

/** Put `a`'s hand on a part of `b`. Returns false if it could not reach (the arm still stretches towards it). */
export function reachFor(store: Store, a: string, side: Side, b: string, contact: Contact) {
  const fa = store.scene.figures.find((f) => f.id === a);
  const fb = store.scene.figures.find((f) => f.id === b);
  if (!fa || !fb) return false;
  const rig = new Rig();
  try {
    const target = contactPoint(rig.model(fb), fb, contact);
    const { joints, reached } = reach(rig, fa, side, target, store.getState().settings.limits);
    store.updateFigure(a, (f) => ({ ...f, joints }));
    return reached;
  } finally {
    rig.dispose();
  }
}

/* Animation */

/** Turn the open pose into an animation (its current pose becomes the first keyframe). */
export function startAnimation(store: Store, duration = 2) {
  store.updateScene((s) => (s.animation ? s : { ...s, animation: newAnimation(s, duration) }));
  store.setTime(0);
}

export function removeAnimation(store: Store) {
  store.updateScene((s) => {
    if (!s.animation) return s;
    const { animation: _removed, ...rest } = s;
    void _removed;
    return rest;
  });
}

/** Record the current pose as a keyframe at the playhead. */
export function addKeyframe(store: Store) {
  const t = store.getState().time;
  store.updateScene((s) => (s.animation ? { ...s, animation: setKey(s.animation, t, s.figures) } : s));
}

export function deleteKeyframe(store: Store) {
  const t = store.getState().time;
  store.updateScene((s) => (s.animation ? { ...s, animation: removeKey(s.animation, t) } : s));
  store.setTime(t);
}

export function moveKeyframe(store: Store, from: number, to: number) {
  store.updateScene((s) => (s.animation ? { ...s, animation: moveKey(s.animation, from, to) } : s), 'move-key');
  store.setTime(store.getState().time);
}

export function setAnimationOptions(store: Store, patch: { duration?: number; loop?: boolean; fps?: number }) {
  store.updateScene((s) => {
    if (!s.animation) return s;
    let a = s.animation;
    if (patch.duration !== undefined) a = setAnimDuration(a, patch.duration);
    if (patch.loop !== undefined) a = { ...a, loop: patch.loop };
    if (patch.fps !== undefined) a = { ...a, fps: Math.round(Math.min(60, Math.max(4, patch.fps))) };
    return { ...s, animation: a };
  }, 'anim-options');
  store.setTime(store.getState().time);
}

/* Shot camera */

function cameraTrack(a: Animation): CameraTrack {
  return a.camera ?? { keys: [], follow: false, shake: 0 };
}

/** Set (or replace) the camera key at the playhead. */
export function setCameraKey(store: Store, shot: Omit<CameraKey, 't'>) {
  const t = store.getState().time;
  store.updateScene((s) => {
    if (!s.animation) return s;
    const a = s.animation;
    const track = cameraTrack(a);
    const time = snapTime(a, t);
    const tol = 0.5 / a.fps;
    const keys = [...track.keys.filter((k) => Math.abs(k.t - time) >= tol), { ...shot, t: time }].sort((p, q) => p.t - q.t);
    return { ...s, animation: { ...a, camera: { ...track, keys } } };
  });
}

export function deleteCameraKey(store: Store) {
  const t = store.getState().time;
  store.updateScene((s) => {
    const a = s.animation;
    if (!a?.camera) return s;
    const tol = 0.5 / a.fps;
    return { ...s, animation: { ...a, camera: { ...a.camera, keys: a.camera.keys.filter((k) => Math.abs(k.t - t) >= tol) } } };
  });
}

/** Replace the camera track with a ready-made move. */
export function applyCameraMove(store: Store, id: string) {
  const move = CAMERA_MOVES.find((m) => m.id === id);
  if (!move) return;
  store.updateScene((s) => {
    const a = s.animation ?? newAnimation(s, 4);
    const keys = move.keys(a, s.view);
    return { ...s, animation: { ...a, camera: { keys, follow: move.follow ?? false, shake: move.shake ?? 0 } } };
  });
}

export function setCameraOptions(store: Store, patch: Partial<Pick<CameraTrack, 'follow' | 'shake'>>) {
  store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, camera: { ...cameraTrack(s.animation), ...patch } } } : s), 'camera-options');
}
