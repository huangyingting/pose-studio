import { cloneHand } from './hands';
import {
  NEUTRAL_JOINTS, duplicateScene, mirrorFigure, mirrorScene, newFigure, newProp, newScene, symmetrize, uid, withPosture,
} from './doc';
import { insertMotion, withPose } from './apply';
import { DEFAULT_HOLD, boardPanels, insertPanel, movePanel, newPanel, withBoard } from './board';
import { figureKeyTimes, keyAt, moveKey, newAnimation, poseOf, removeKey, setDuration as setAnimDuration, setKey, snapTime } from './animation';
import { JUMP_PREP, SPEED, flightTime, legsOf } from './locomotion';
import { MOTIONS } from './motions';
import { allPoses, poseFromFigure } from './poses';
import {
  Rig, atDistance, backToBack, besides, contactPoint, distance, faceEachOther, headPoint, inFrontOf, lookAt, reach, turnTowards,
  facing, withFacing, withPosition, type Contact,
} from './relations';
import { CAMERA_MOVES, shotAt } from './shot';
import { cutAt, keysInShot, removeCut, spanAt, updateShot } from './shots';
import type { Store } from './store';
import { HANDHELD, PROP_LABELS } from './types';
import { held, released } from './hold';
import type { Animation, CameraKey, CameraTrack, Figure, Hand, JointName, Panel, PoseKey, Posture, Prop, PropKind, Scene, Side, Travel, Vec3, View } from './types';

/* Scenes (library entries) */

export function addScene(store: Store, scene: Scene = newScene(`Scene ${store.getState().library.scenes.length + 1}`)) {
  const at = store.getState().sceneIndex + 1;
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes.slice(0, at), scene, ...lib.scenes.slice(at)] }), '', {
    sceneIndex: at, selection: null, activeFigure: null,
  });
}

export function appendScenes(store: Store, scenes: Scene[]) {
  const at = store.getState().library.scenes.length;
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes, ...scenes] }), '', { sceneIndex: at, selection: null, activeFigure: null });
}

/** Duplicate a scene (the open one by default); the copy opens next to it. */
export function duplicateCurrentScene(store: Store, index = store.getState().sceneIndex) {
  const src = store.getState().library.scenes[index];
  if (!src) return;
  if (index !== store.getState().sceneIndex) store.setSceneIndex(index);
  addScene(store, duplicateScene(src));
}

/** A name not used yet: "Chair", then "Chair 2", "Chair 3", … */
export function nextName(base: string, taken: string[]) {
  const stem = base.replace(/\s+\d+$/, '').trim() || base;
  const used = new Set(taken);
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n++) if (!used.has(`${stem} ${n}`)) return `${stem} ${n}`;
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


export function replaceLibrary(store: Store, scenes: Scene[], board?: Panel[]) {
  store.commit(() => (board ? { version: 2, scenes, board } : { version: 2, scenes }), '', { sceneIndex: 0, selection: null, activeFigure: null });
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

/** Where a new figure goes unless told: beside the existing ones. */
function besideFigures(store: Store, gap: number): Vec3 {
  const xs = store.scene.figures.map((f) => f.position[0]);
  return [xs.length ? Math.max(...xs) + gap : 0, 0, 0];
}

export function addFigure(store: Store, at = besideFigures(store, 0.8)) {
  const scene = store.scene;
  const base = store.figure;
  // Same proportions as the active figure.
  const fig = newFigure({
    name: nextName('Figure', scene.figures.map((f) => f.name)),
    position: at,
    ...(base ? { body: { ...base.body } } : {}),
  });
  addFigures(store, [fig]);
}

/** A capsule stand-in for blocking: placed like a figure, in a posture, not posed joint by joint. */
export function addStandIn(store: Store, at = besideFigures(store, 0.8)) {
  addFigures(store, [withPosture(newFigure({ name: nextName('Stand-in', store.scene.figures.map((f) => f.name)), position: at }), 'stand')]);
}

/** Change a stand-in's posture, or (null) turn it into a posable figure. */
export function setPosture(store: Store, id: string, posture: Posture | null) {
  store.updateFigure(id, (f) => {
    if (posture) return withPosture(f, posture);
    const figure = { ...f };
    delete figure.proxy;
    return figure;
  }, '');
}

export function addFigures(store: Store, figures: Figure[]) {
  const i = store.getState().sceneIndex;
  store.commit(
    (lib) => ({ ...lib, scenes: lib.scenes.map((s, j) => (j === i ? { ...s, figures: [...s.figures, ...figures] } : s)) }),
    '',
    { activeFigure: figures[0].id, selection: { kind: 'figure', figure: figures[0].id } },
  );
}

export function duplicateFigure(store: Store, id: string) {
  const src = store.scene.figures.find((f) => f.id === id);
  if (!src) return;
  const copy: Figure = { ...structuredClone(src), id: uid('f'), name: nextName(src.name, store.scene.figures.map((f) => f.name)), position: [src.position[0] + 0.8, src.position[1], src.position[2]] };
  addFigures(store, [copy]);
}

export function deleteFigure(store: Store, id: string) {
  if (store.scene.figures.length <= 1) return false;
  // What it held falls to the floor.
  store.updateScene((s) => ({
    ...s,
    figures: s.figures.filter((f) => f.id !== id),
    props: s.props.map((p) => (p.hold?.figure === id ? released(p, s) : p)),
  }));
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

/** Add a prop. Handheld kinds go into the active figure's free hand (the right one first). */
export function addProp(store: Store, kind: PropKind, at = besideFigures(store, 0.9)) {
  const prop = newProp(kind, at, nextName(PROP_LABELS[kind], store.scene.props.map((p) => p.name)));
  const figure = HANDHELD.includes(kind) ? store.figure : null;
  const busy = (hand: Side) => store.scene.props.some((p) => p.hold?.figure === figure?.id && p.hold?.hand === hand);
  const hand: Side | null = figure ? (!busy('R') ? 'R' : !busy('L') ? 'L' : null) : null;
  if (figure && hand) {
    const h = held(prop, figure, hand);
    store.updateScene((s) => ({ ...s, props: [...s.props, h.prop], figures: s.figures.map((f) => (f.id === figure.id ? h.figure : f)) }));
  } else {
    store.updateScene((s) => ({ ...s, props: [...s.props, prop] }));
  }
  store.select({ kind: 'prop', prop: prop.id });
}

/** Put a prop in a figure's hand (it closes into a grip), or (null) let it go onto the floor. */
export function holdProp(store: Store, id: string, to: { figure: string; hand: Side } | null) {
  store.updateScene((s) => {
    const prop = s.props.find((p) => p.id === id);
    if (!prop) return s;
    const free = prop.hold ? released(prop, s) : prop;
    const figure = to && s.figures.find((f) => f.id === to.figure);
    if (!to || !figure) return { ...s, props: s.props.map((p) => (p.id === id ? free : p)) };
    // One prop per hand: whatever was in it is let go.
    const props = s.props.map((p) => (p.hold?.figure === to.figure && p.hold.hand === to.hand && p.id !== id ? released(p, s) : p));
    const h = held(free, figure, to.hand);
    return { ...s, props: props.map((p) => (p.id === id ? h.prop : p)), figures: s.figures.map((f) => (f.id === figure.id ? h.figure : f)) };
  });
}

export function duplicateProp(store: Store, id: string) {
  const src = store.scene.props.find((p) => p.id === id);
  if (!src) return;
  const copy: Prop = { ...structuredClone(src), id: uid('p'), name: nextName(src.name, store.scene.props.map((p) => p.name)), position: [src.position[0] + 0.3, src.position[1], src.position[2] + 0.3] };
  store.updateScene((s) => ({ ...s, props: [...s.props, copy] }));
  store.select({ kind: 'prop', prop: copy.id });
}

export function deleteProp(store: Store, id: string) {
  store.updateScene((s) => ({ ...s, props: s.props.filter((p) => p.id !== id) }));
}

/** Change a prop's place, turn or size. */
export function moveProp(store: Store, id: string, patch: Partial<Pick<Prop, 'position' | 'rotation' | 'scale'>>, key = '') {
  store.updateProp(id, (p) => ({ ...p, ...patch }), key);
}

export function renameProp(store: Store, id: string, name: string) {
  store.updateProp(id, (p) => ({ ...p, name }), `rename:${id}`);
}

/** Delete what is selected (a figure, a prop or a shot's cut). Returns its name for the toast, or null. */
export function deleteSelection(store: Store): string | null {
  const sel = store.getState().selection;
  const scene = store.scene;
  if (sel?.kind === 'prop') {
    const p = scene.props.find((x) => x.id === sel.prop);
    deleteProp(store, sel.prop);
    return p?.name ?? 'Prop';
  }
  if (sel?.kind === 'figure') {
    const f = scene.figures.find((x) => x.id === sel.figure);
    return f && deleteFigure(store, f.id) ? f.name : null;
  }
  if (sel?.kind === 'shot' && scene.animation?.shots?.[0]?.id !== sel.shot && scene.animation?.shots?.some((x) => x.id === sel.shot)) {
    const name = scene.animation.shots.find((x) => x.id === sel.shot)!.name;
    removeShotCut(store, sel.shot);
    return `the cut before ${name}`;
  }
  return null;
}

/** Duplicate the selected prop or figure (also when one of its joints is selected). False when there is none. */
export function duplicateSelection(store: Store) {
  const sel = store.getState().selection;
  if (sel?.kind === 'prop') duplicateProp(store, sel.prop);
  else if (sel?.kind === 'figure' || sel?.kind === 'joint') duplicateFigure(store, sel.figure);
  else return false;
  return true;
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

/* Locomotion: walking, running and jumping from mark to mark (lib/locomotion.ts) */

/** Default jump height (metres the body rises). */
export const JUMP_HEIGHT = 0.45;

/**
 * Walk, run or jump a figure from where it is at the playhead to a floor point: a new mark. Its
 * later keys move on by the time it takes (the other figures are untouched); the playhead goes to
 * the new mark, so the next "…to here" continues from there. Walking and running face the way
 * they go unless `strafe` (side steps, backing up); a jump keeps the figure's facing.
 */
export function travelTo(store: Store, figureId: string, to: [number, number], kind: Travel, opts: { strafe?: boolean; height?: number } = {}) {
  const fresh = !store.scene.animation;
  if (fresh) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
  const a = store.scene.animation!;
  const f = store.scene.figures.find((x) => x.id === figureId);
  if (!f) return null;
  const t0 = snapTime(a, store.getState().time);
  const legs = legsOf(f.body);
  const scale = (legs.thigh + legs.shin) / 0.85;
  const d = Math.hypot(to[0] - f.position[0], to[1] - f.position[2]);
  const duration = kind === 'jump'
    ? flightTime(opts.height ?? JUMP_HEIGHT) + 2 * JUMP_PREP
    : Math.max(0.6, d / (SPEED[kind] * scale) + (kind === 'run' ? 0.45 : 0.35));
  const t1 = Math.round((t0 + duration) * a.fps) / a.fps;
  const yaw = kind === 'jump' || opts.strafe || d < 0.05 ? facing(f) : Math.atan2(to[0] - f.position[0], to[1] - f.position[2]) * (180 / Math.PI);
  const end: PoseKey = {
    ...poseOf(withFacing(f, yaw)),
    position: [Math.round(to[0] * 1000) / 1000, f.position[1], Math.round(to[1] * 1000) / 1000],
    travel: kind,
    ...(opts.strafe ? { strafe: true } : {}),
  };
  store.updateScene((s) => {
    if (!s.animation) return s;
    // Keep the start as a mark, make room after it on this figure's track, then key the arrival.
    let anim = setKey(s.animation, t0, [f]);
    anim = shiftTrack(anim, figureId, t0, t1 - t0);
    const keys = anim.keys.filter((k) => Math.abs(k.t - t1) >= 0.5 / anim.fps || !k.poses[figureId]);
    const at = keys.findIndex((k) => Math.abs(k.t - t1) < 0.5 / anim.fps);
    const withEnd = at >= 0
      ? keys.map((k, i) => (i === at ? { ...k, poses: { ...k.poses, [figureId]: end } } : k))
      : [...keys, { t: t1, poses: { [figureId]: end } }].sort((p, q) => p.t - q.t);
    const last = Math.max(...withEnd.map((k) => k.t));
    return { ...s, animation: { ...anim, keys: withEnd, duration: Math.min(60, Math.max(anim.duration, last)) } };
  });
  store.setTime(t1);
  store.select({ kind: 'figure', figure: figureId });
  return { from: t0, to: t1 };
}

/** Move one figure's keys after `after` later by `by` seconds (its other keys stay; others' too). */
function shiftTrack(a: Animation, id: string, after: number, by: number): Animation {
  const moved: { t: number; pose: PoseKey }[] = [];
  const keys = a.keys.map((k) => {
    if (k.t <= after + 1e-6 || !k.poses[id]) return k;
    moved.push({ t: Math.min(60, Math.round((k.t + by) * a.fps) / a.fps), pose: k.poses[id] });
    const { [id]: _, ...rest } = k.poses;
    void _;
    return { ...k, poses: rest };
  }).filter((k) => Object.keys(k.poses).length);
  for (const m of moved) {
    const i = keys.findIndex((k) => Math.abs(k.t - m.t) < 0.5 / a.fps);
    if (i >= 0) keys[i] = { ...keys[i], poses: { ...keys[i].poses, [id]: m.pose } };
    else keys.push({ t: m.t, poses: { [id]: m.pose } });
  }
  const last = Math.max(a.duration, ...keys.map((k) => k.t));
  return { ...a, keys: keys.sort((p, q) => p.t - q.t), duration: Math.min(60, last) };
}

/** How a figure gets to its key at time t: walk, run, jump, or (null) glide as keyed. */
export function setTravel(store: Store, figureId: string, t: number, kind: Travel | null, patch: Partial<Pick<PoseKey, 'strafe' | 'spin' | 'flip'>> = {}) {
  store.updateScene((s) => {
    const a = s.animation;
    if (!a) return s;
    const i = keyAt(a, t);
    const pose = i >= 0 ? a.keys[i].poses[figureId] : undefined;
    if (!pose) return s;
    const next: PoseKey = { ...pose, ...patch };
    if (kind) next.travel = kind;
    else delete next.travel;
    for (const k of ['strafe', 'spin', 'flip'] as const) if (!next[k]) delete next[k];
    if (next.travel !== 'jump') { delete next.spin; delete next.flip; }
    return { ...s, animation: { ...a, keys: a.keys.map((k, j) => (j === i ? { ...k, poses: { ...k.poses, [figureId]: next } } : k)) } };
  });
}

/** Set a jump's height: its time in the air changes (gravity), the figure's later keys move with it. */
export function setJumpHeight(store: Store, figureId: string, t: number, height: number) {
  const a = store.scene.animation;
  if (!a) return;
  const times = figureKeyTimes(a, figureId);
  const i = times.findIndex((x) => Math.abs(x - t) < 0.5 / a.fps);
  if (i <= 0) return;
  const want = flightTime(height) + 2 * JUMP_PREP;
  const by = Math.round((times[i - 1] + want - times[i]) * a.fps) / a.fps;
  if (Math.abs(by) < 1e-6) return;
  store.updateScene((s) => (s.animation ? { ...s, animation: shiftTrack(s.animation, figureId, times[i - 1], by) } : s));
  store.setTime(times[i] + by);
}

/** Move a figure's mark (its key at time t) to another floor point. */
export function moveMark(store: Store, figureId: string, t: number, to: [number, number], key = '') {
  store.updateScene((s) => {
    const a = s.animation;
    if (!a) return s;
    const i = keyAt(a, t);
    const pose = i >= 0 ? a.keys[i].poses[figureId] : undefined;
    if (!pose) return s;
    const moved: PoseKey = { ...pose, position: [Math.round(to[0] * 1000) / 1000, pose.position[1], Math.round(to[1] * 1000) / 1000] };
    return { ...s, animation: { ...a, keys: a.keys.map((k, j) => (j === i ? { ...k, poses: { ...k.poses, [figureId]: moved } } : k)) } };
  }, key);
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
/** Key the active figure's pose at the playhead (or `figureIds`, or every figure with `all`). */
export function addKeyframe(store: Store, figureIds?: string[]) {
  const t = store.getState().time;
  const ids = figureIds ?? (store.getState().activeFigure ? [store.getState().activeFigure!] : store.scene.figures.map((f) => f.id));
  store.updateScene((s) => (s.animation ? { ...s, animation: setKey(s.animation, t, s.figures.filter((f) => ids.includes(f.id))) } : s));
}

/** Delete the active figure's key at the playhead (it keeps at least one key). */
export function deleteKeyframe(store: Store, figureId = store.getState().activeFigure ?? undefined) {
  const t = store.getState().time;
  store.updateScene((s) => (s.animation ? { ...s, animation: removeKey(s.animation, t, figureId) } : s));
  store.setTime(t);
}

/** Retime one figure's key (or, without `figureId`, the whole keyframe). */
export function moveKeyframe(store: Store, from: number, to: number, figureId?: string) {
  store.updateScene((s) => (s.animation ? { ...s, animation: moveKey(s.animation, from, to, figureId) } : s), `move-key:${figureId ?? ''}`);
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

/** Change the camera key at time t (e.g. dragged in the viewport); one undo step per drag. */
export function editCameraKey(store: Store, t: number, patch: Partial<Omit<CameraKey, 't'>>, key = '') {
  store.updateScene((s) => {
    const a = s.animation;
    if (!a?.camera) return s;
    const tol = 0.5 / a.fps;
    return { ...s, animation: { ...a, camera: { ...a.camera, keys: a.camera.keys.map((k) => (Math.abs(k.t - t) < tol ? { ...k, ...patch } : k)) } } };
  }, key);
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

/** Give the current shot (the whole animation without cuts) a ready-made camera move. */
export function applyCameraMove(store: Store, id: string) {
  const move = CAMERA_MOVES.find((m) => m.id === id);
  if (!move) return;
  const t = store.getState().time;
  store.updateScene((s) => {
    const a = s.animation ?? newAnimation(s, 4);
    const span = spanAt(a, t);
    const cuts = (a.shots?.length ?? 0) > 1;
    const local = { ...a, duration: span.end - span.start, loop: cuts ? false : a.loop };
    const keys = move.keys(local, s.view).map((k) => ({ ...k, t: Math.round((k.t + span.start) * 1000) / 1000 }));
    const others = cuts ? keysOutside(a, span) : [];
    return { ...s, animation: { ...a, camera: { keys: [...others, ...keys].sort((p, q) => p.t - q.t), follow: move.follow ?? false, shake: move.shake ?? 0 } } };
  });
}

function keysOutside(a: Animation, span: { start: number; end: number }) {
  const inside = new Set(keysInShot(a, span));
  return (a.camera?.keys ?? []).filter((k) => !inside.has(k));
}

/* Shots */

/** Cut at the playhead: a new shot starts there, holding the current framing until re-keyed. */
export function cutShot(store: Store) {
  const t = store.getState().time;
  store.updateScene((s) => {
    if (!s.animation) return s;
    const time = snapTime(s.animation, t);
    return { ...s, animation: cutAt(s.animation, time, { ...shotAt(s, time), t: time }) };
  });
}

export function removeShotCut(store: Store, id: string) {
  store.updateScene((s) => (s.animation ? { ...s, animation: removeCut(s.animation, id) } : s));
}

export function editShot(store: Store, id: string, patch: { name?: string; caption?: string }) {
  store.updateScene((s) => (s.animation ? { ...s, animation: updateShot(s.animation, id, patch) } : s), `shot:${id}`);
}

/** Cut the shots for a video model (its clip length becomes each shot's limit), or clear it. */
export function setTargetModel(store: Store, target: string | null) {
  store.updateScene((s) => {
    if (!s.animation) return s;
    const { target: _old, ...rest } = s.animation;
    void _old;
    return { ...s, animation: target ? { ...rest, target } : rest };
  });
}

export function setCameraOptions(store: Store, patch: Partial<Pick<CameraTrack, 'follow' | 'shake'>>) {
  store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, camera: { ...cameraTrack(s.animation), ...patch } } } : s), 'camera-options');
}

/* Storyboard */

function updateBoard(store: Store, fn: (board: Panel[]) => Panel[], key = '') {
  store.commit((lib) => {
    const board = boardPanels(lib);
    const next = fn(board);
    return next === board ? lib : withBoard(lib, next);
  }, key);
}

/** Add a pose (the open one by default) to the end of the storyboard. */
export function addToBoard(store: Store, sceneId = store.scene.id) {
  const a = store.getState().library.scenes.find((s) => s.id === sceneId)?.animation;
  updateBoard(store, (b) => insertPanel(b, newPanel(sceneId, a ? Math.round(a.duration * 10) / 10 : DEFAULT_HOLD)));
}

export function removeFromBoard(store: Store, id: string) {
  updateBoard(store, (b) => b.filter((p) => p.id !== id));
}

export function moveOnBoard(store: Store, from: number, to: number) {
  updateBoard(store, (b) => movePanel(b, from, to));
}

export function editPanel(store: Store, id: string, patch: { caption?: string; hold?: number }) {
  updateBoard(store, (b) => b.map((p) => (p.id === id ? { ...p, ...patch } : p)), `panel:${id}:${Object.keys(patch).join()}`);
}

/* Library assets applied to the scene */

/** Put a library pose on a figure (it keeps its place and facing; keyed when animated). */
export function applyPose(store: Store, figureId: string, poseId: string) {
  const pose = allPoses(store.getState().library).find((p) => p.id === poseId);
  if (!pose) return false;
  store.updateFigure(figureId, (f) => (f.proxy ? f : withPose(f, pose)), '');
  return true;
}

/** Save a figure's pose to the library; returns the saved pose. */
export function savePose(store: Store, figureId: string, name: string) {
  const f = store.scene.figures.find((x) => x.id === figureId);
  if (!f) return null;
  const pose = poseFromFigure(f, name, store.scene.view);
  store.commit((lib) => ({ ...lib, poses: [...(lib.poses ?? []), pose] }));
  return pose;
}

export function deletePose(store: Store, id: string) {
  store.commit((lib) => {
    const poses = (lib.poses ?? []).filter((p) => p.id !== id);
    const { poses: _old, ...rest } = lib;
    void _old;
    return poses.length ? { ...rest, poses } : rest;
  });
}

/**
 * Give a figure a one-person motion from the library, starting at the playhead (the scene is
 * animated if it is not yet). Returns false for motions with several people.
 */
export function applyMotion(store: Store, figureId: string, motionId: string) {
  const motion = MOTIONS.find((m) => m.id === motionId);
  if (!motion || motion.people !== 1) return false;
  const start = store.scene.animation ? store.getState().time : 0;
  store.updateScene((s) => insertMotion(s, figureId, motion.build(), start));
  store.setTime(start);
  return true;
}
