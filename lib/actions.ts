import * as THREE from 'three';
import { cloneHand } from './hands';
import { sided, wrapDeg } from './joints';
import {
  NEUTRAL_ANGLES, duplicateScene, mirrorFigure, newFigure, newProp, newScene, symmetrize, uid, withPosture,
} from './doc';
import { DEFAULT_HOLD, boardPanels, insertPanel, movePanel, newPanel, withBoard } from './board';
import { newAnimation, propKeyOf, setDuration as setAnimDuration, snapTime } from './animation';
import { BUILT_IN, clipById } from './assets';
import { applyCoverage, castCoverage, coverageById } from './coverage';
import { asTemplate, putTemplate, templatesOf } from './templates';
import { clipInfo, keysClip, partKeys } from './clip';
import { saveClips } from './assetstore';
import { CATCH_LEAD, UPPER_EASE, actionsOf, arrivalAt, figurePoseAt, propStretchesOf, propWorldAt, sceneAt, settledAt, warpLimit } from './evaluate';
import { putPropKey, setPropKey } from './propmotion';
import { handlesOf, localBounds } from './props';
import {
  actionLabel, addTravel, addUpper, insertClip, recast, removeCorrectionAt, keyAtTime, moments, moveKeyTo, moveMarkTo, removeKeyAt, retimeAction, ripple, rippleInStep, setBlendIn, setPoseAt, setTravelMode, travelInto,
} from './track';
import { JUMP_PREP, flightTime } from './locomotion';
import { MOTIONS } from './motions';
import { allPoses, poseFromFigure, withPose } from './poses';
import {
  Rig, atDistance, backToBack, besides, contactPoint, contactSpot, distance, faceEachOther, headPoint, inFrontOf, lookAt, reach, turnTowards,
  facing, forward, withFacing, withPosition, type Contact,
} from './relations';
import { angleOf, cameraAt, cameraById, capturePoint, filmWith, fovLens, frameAspect, framePoint, lensFov, liveCamera, restate, rigFrom, viewOf, withCamera, type Placement, type ShotSize } from './shot';
import { bonesOf, withAngles } from './pose';
import { cutAt, movePoint, newCamera, removeCamera, removeCut, removePointAt, setPointAt, shotSpans, spanAt, updateShot } from './shots';
import type { Store } from './store';
import { HANDHELD, PROP_LABELS } from './types';
import { held, released } from './hold';
import type { Action, Animation, Camera, CameraRig, Clip, Constraint, Figure, PropTarget, Hand, JointName, Light, ModelInfo, Panel, FrameShape, Posture, Prop, PropKind, Scene, Side, Travel, Vec3, View } from './types';

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
  store.commit((lib) => ({ ...lib, scenes, board }), '', { sceneIndex: 0, selection: null, activeFigure: null });
}

export function renameScene(store: Store, name: string) {
  store.updateScene((s) => ({ ...s, name }), 'rename');
}

/** Light the open scene. */
export function setSceneLight(store: Store, light: Light, key = '') {
  store.updateScene((s) => ({ ...s, light }), key);
}

export function setSceneView(store: Store, view: View) {
  store.updateScene((s) => ({ ...s, view }), 'view');
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
  // An animated figure's copy moves the same way, alongside.
  if (store.scene.animation && actionsOf(store.scene.animation, id).length > 1) {
    store.updateScene((s) => (s.animation ? { ...s, animation: copyTrack(s.animation, id, copy.id, [0.8, 0]) } : s));
  }
}

/**
 * `to`'s track becomes a copy of `from`'s (what it does by itself), moved across the floor by
 * `offset` (x, z).
 */
function copyTrack(a: Animation, from: string, to: string, offset: [number, number]): Animation {
  const move = (m: { at: [number, number]; facing: number }) => ({ ...m, at: [m.at[0] + offset[0], m.at[1] + offset[1]] as [number, number] });
  const copies = a.actions.filter((x) => x.roles.length === 1 && x.roles[0].figure === from).map((x): Action => {
    const roles = [{ figure: to, ...(x.roles[0].end ? { end: move(x.roles[0].end) } : {}) }];
    const src = x.source;
    if (src.kind === 'keys' && !x.layer) {
      const keys = partKeys(src.clip.parts[0]).map((k) => ({ t: k.t, pose: { ...k.pose, position: [k.pose.position[0] + offset[0], k.pose.position[1], k.pose.position[2] + offset[1]] as Vec3 } }));
      return { ...x, id: uid('act'), roles, source: { kind: 'keys', clip: keysClip(keys, src.clip.loop, src.clip.duration) } };
    }
    if (src.kind === 'travel' && src.via) return { ...x, id: uid('act'), roles, source: { ...src, via: src.via.map(move) } };
    return { ...structuredClone(x), id: uid('act'), roles };
  });
  return { ...a, actions: [...a.actions.filter((x) => !x.roles.some((r) => r.figure === to)), ...copies].sort((p, q) => p.start - q.start || p.duration - q.duration) };
}

/**
 * Give figure `to` the same moves as `from` (a crowd, a synchronised routine): `from`'s actions,
 * moved to start where `to` stands now. `to`'s own are replaced.
 */
export function copyMotion(store: Store, from: string, to: string) {
  const a = store.scene.animation;
  const target = store.scene.figures.find((f) => f.id === to);
  const first = a && actionsOf(a, from)[0];
  if (!a || !target || !first || first.source.kind !== 'keys' || from === to) return false;
  const p = partKeys(first.source.clip.parts[0])[0].pose;
  const at = figurePoseAt(store.scene, to, 0)!;
  const offset: [number, number] = [at.position[0] - p.position[0], at.position[2] - p.position[2]];
  store.updateScene((s) => (s.animation ? { ...s, animation: copyTrack(s.animation, from, to, offset) } : s));
  return true;
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

/** Keep a figure's eyes on another figure or a prop (its head turns to it), or (null) not. */
export function setGaze(store: Store, id: string, target: Figure['gaze'] | null) {
  store.updateFigure(id, (f) => {
    const next = { ...f };
    if (target) next.gaze = target;
    else delete next.gaze;
    return next;
  });
}

/** Tint a figure to tell it apart (null: none). */
export function setFigureColor(store: Store, id: string, color: string | null) {
  store.updateFigure(id, (f) => {
    const next = { ...f };
    if (color) next.color = color;
    else delete next.color;
    return next;
  });
}

export function resetPose(store: Store) {
  store.updateActiveFigure((f) => withFacing({ ...f, bones: bonesOf(NEUTRAL_ANGLES) }, facing(f)));
}

export function mirrorPose(store: Store) {
  store.updateActiveFigure((f) => ({ ...mirrorFigure(f), position: f.position }));
}

export function symmetrizePose(store: Store, from: Side) {
  store.updateActiveFigure((f) => symmetrize(f, from));
}

export function setJoint(store: Store, figure: string, joint: JointName, value: Vec3, key: string) {
  store.updateFigure(figure, (f) => ({ ...f, bones: withAngles(f.bones, { [joint]: value }) }), key);
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
  store.clipboard = { bones: { ...f.bones }, hands: structuredClone(f.hands) };
  return true;
}

export function pastePose(store: Store) {
  const clip = store.clipboard;
  if (!clip || !store.figure) return false;
  store.updateActiveFigure((f) => ({ ...f, bones: { ...clip.bones }, hands: structuredClone(clip.hands) }));
  return true;
}

/* Props */

/** Where sports gear goes ahead of the selected figure: the hoop to shoot at, the bar to clear and the mat beyond it. */
const AHEAD: Partial<Record<PropKind, number>> = { hoop: 5, bar: 3, mat: 4.3 };

/**
 * Add a prop. Handheld kinds go into the active figure's free hand (the right one first). Sports
 * gear goes ahead of it (or at `at`), turned to it: a hoop's board facing it, a bar and a mat across its way.
 */
export function addProp(store: Store, kind: PropKind, at?: Vec3) {
  const f = store.figure;
  const [fx, fz] = f ? forward(f) : [0, 1];
  const d = AHEAD[kind];
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const place: Vec3 = at ?? (d && f ? [r3(f.position[0] + fx * d), 0, r3(f.position[2] + fz * d)] : besideFigures(store, 0.9));
  const toward = f ? Math.atan2(f.position[0] - place[0], f.position[2] - place[2]) * (180 / Math.PI) : 180;
  const yaw = kind === 'hoop' ? toward : kind === 'bar' || kind === 'mat' ? toward + 180 : 0;
  const prop = { ...newProp(kind, place, nextName(PROP_LABELS[kind], store.scene.props.map((p) => p.name))), rotation: [0, Math.round(wrapDeg(yaw) * 10) / 10 || 0, 0] as Vec3 };
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

/** A prop as it is at the playhead (or `t`: in whose hand, where), not where it was put at the start. */
export function propNow(store: Store, id: string, t = store.getState().time): Prop | undefined {
  const s = store.scene;
  const p = (s.animation ? sceneAt(s, t).props : s.props).find((x) => x.id === id);
  if (!p) return undefined;
  const { trail: _, ...prop } = p;
  void _;
  return prop;
}

/**
 * The prop handled by an action from the playhead on: the action plays a clip with the prop's
 * releases and grabs on the upper body of the figure holding it, its release sent to `target`.
 * The prop keeps where it starts (a key at the start). Returns the action, or null if nobody holds the prop.
 */
function handle(store: Store, id: string, motion: string, target: PropTarget, t: number, laps = 1) {
  if (!store.scene.animation) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
  const prop = propNow(store, id);
  const hold = prop?.hold;
  const clip = clipById(BUILT_IN + motion);
  if (!prop || !hold || !clip) return null;
  const a = store.scene.animation!;
  const release = clip.events.find((e) => e.kind === 'release')?.t ?? 0;
  // After it is caught or picked up (a shot right after a catch): the arms ease into the motion
  // once the hand is back with it, not while it reaches for it.
  const got = propStretchesOf(store.scene, id).filter((x) => x.kind === 'held' && x.t0 <= t + 1e-6).at(-1);
  const start = Math.max(0, got && got.t0 > 0 ? got.t0 + CATCH_LEAD + UPPER_EASE : 0, snapTime({ ...a, duration: 60 }, t - release));
  const act: Action = {
    id: uid('act'), start, duration: Math.min(60 - start, clip.duration * laps), layer: 'upper', roles: [{ figure: hold.figure }],
    source: { kind: 'clip', clip: clip.id, ...(hold.hand === 'L' ? { mirror: true } : {}) }, prop: id, target,
  };
  const first = propNow(store, id, 0)!;
  store.updateScene((s) => {
    if (!s.animation) return s;
    // Where it starts, so what happens to it later does not change that.
    const keyed = s.animation.props?.[id]?.length ? s.animation : putPropKey(s.animation, 0, id, propKeyOf(first, 0));
    return { ...s, animation: { ...keyed, actions: [...keyed.actions, act], duration: Math.min(60, Math.max(keyed.duration, act.start + act.duration)) } };
  });
  return { act, release: start + release };
}

/**
 * Throw a prop from the hand holding it at the playhead: to a floor point, into a figure's hand
 * (caught there; into the thrower's own hand it is tossed up two metres, as a gymnast's hoop), or
 * at a basketball hoop (through it, or off the front of the rim): a pass, a toss or a shot on the
 * thrower's upper body, its release sent there. It flies free (physics) and is caught if the hand
 * can reach it when it arrives. The playhead goes to where it arrives.
 */
export function throwProp(store: Store, id: string, target: { at: [number, number] } | { figure: string; hand: Side } | { hoop: string; miss?: boolean }) {
  const holder = propNow(store, id)?.hold;
  if (!holder) return null;
  const toss = 'figure' in target && target.figure === holder.figure;
  const motion = 'hoop' in target ? 'shoot' : toss ? 'toss' : 'pass';
  const done = handle(store, id, motion, toss ? { ...target, rise: 2 } : target, store.getState().time);
  if (!done) return null;
  const to = arrivalAt(store.scene, id, done.release) ?? done.release;
  // Not caught: the animation runs on until it is down and still (a few seconds at most).
  const still = 'figure' in target ? null : settledAt(store.scene, id, done.release);
  if (still) store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, duration: Math.min(60, Math.max(s.animation.duration, Math.min(done.release + 6, still + 0.2))) } } : s));
  store.setTime(to);
  store.select({ kind: 'prop', prop: id });
  return { from: done.release, to };
}

/**
 * Dribble a ball from the hand holding it at the playhead, `bounces` times, half a second each:
 * the arm pushes it down, it bounces off the floor and the hand meets it on the way up and rides
 * it to the top before pushing again (on the upper body, so it goes with a walk or run). The
 * playhead goes to the end.
 */
export function dribbleProp(store: Store, id: string, bounces = 4) {
  const done = handle(store, id, 'dribble', { bounce: true }, store.getState().time, bounces);
  if (!done) return null;
  const to = done.act.start + done.act.duration;
  store.setTime(to);
  store.select({ kind: 'prop', prop: id });
  return { from: done.act.start, to };
}

/** Put a prop in a figure's hand (it closes into a grip), or (null) let it go onto the floor. */
export function holdProp(store: Store, id: string, to: { figure: string; hand: Side } | null) {
  // Animated: letting go at the playhead drops it from the hand; it falls under gravity.
  const scene = store.scene;
  const current = scene.props.find((p) => p.id === id);
  if (!to && scene.animation && current?.hold) {
    const t = snapTime(scene.animation, store.getState().time);
    const from = propWorldAt(scene, id, t);
    const first = propNow(store, id, 0);
    if (!from) return;
    store.updateScene((s) => {
      if (!s.animation) return s;
      const free = { ...current, position: from.position, rotation: from.rotation, hold: undefined };
      return { ...s, props: s.props.map((p) => (p.id === id ? free : p)), animation: setPropKey(s.animation, t, free, { release: true }, first) };
    });
    return;
  }
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
  if (sel?.kind === 'action') {
    const act = scene.animation?.actions.find((x) => x.id === sel.action);
    if (!act) return null;
    deleteAction(store, act.id);
    return actionLabel(act);
  }
  if (sel?.kind === 'shot' && scene.animation?.shots?.[0]?.id !== sel.shot && scene.animation?.shots?.some((x) => x.id === sel.shot)) {
    const name = scene.animation.shots.find((x) => x.id === sel.shot)!.name;
    removeShotCut(store, sel.shot);
    return `the cut before ${name}`;
  }
  const cam = sel?.kind === 'camera' ? cameraById(scene.animation, sel.camera) : null;
  if (cam) {
    deleteCamera(store, cam.id);
    return cam.name;
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
    const bones = lookAt(rig, fa, target, store.getState().settings.limits);
    store.updateFigure(a, (f) => ({ ...f, bones }));
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
    const { bones, reached } = reach(rig, fa, side, target, store.getState().settings.limits);
    store.updateFigure(a, (f) => ({ ...f, bones }));
    return reached;
  } finally {
    rig.dispose();
  }
}

/* Holding on (constraints, lib/constraints.ts) */

/**
 * Hold `a`'s hand on a part of `b` from the playhead to the end of what `a` is doing then (or of
 * the animation): wherever either of them moves, the hand stays on it. In a still scene, the hand
 * just reaches there. False if it cannot reach it now.
 */
export function holdOn(store: Store, a: string, side: Side, b: string, contact: Contact) {
  const s = store.scene;
  if (!s.animation) return reachFor(store, a, side, b, contact);
  const anim = s.animation;
  const t = snapTime(anim, store.getState().time);
  const fa = figurePoseAt(s, a, t);
  const fb = figurePoseAt(s, b, t);
  if (!fa || !fb) return false;
  const rig = new Rig();
  try {
    const spot = contactSpot(rig.model(fb), fb, contact);
    const reached = reach(rig, fa, side, rig.model(fb).joints[spot.bone].localToWorld(new THREE.Vector3(...spot.at))).reached;
    addHold(store, a, sided('Hand', side) as Constraint['bone'], { figure: b, ...spot });
    return reached;
  } finally {
    rig.dispose();
  }
}

/** A hold from the playhead to the end of what the figure is doing then (or of the animation). */
function addHold(store: Store, figure: string, bone: Constraint['bone'], target: Constraint['target']) {
  if (!store.scene.animation) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
  const anim = store.scene.animation!;
  const t = snapTime(anim, store.getState().time);
  const doing = actionsOf(anim, figure).find((x) => x.start <= t + 1e-6 && t < x.start + x.duration - 1e-6);
  const end = doing ? doing.start + doing.duration : anim.duration;
  const hold: Constraint = { id: uid('hold'), figure, bone, target, start: t, end: end > t ? end : anim.duration };
  store.updateScene((sc) => (sc.animation ? { ...sc, animation: { ...sc.animation, constraints: [...(sc.animation.constraints ?? []), hold] } } : sc));
  return hold;
}

/** Take the other end of a prop someone carries: a hand held on its last handle (two people carrying a stretcher). */
export function holdHandle(store: Store, figure: string, prop: string, hand: Side) {
  const p = store.scene.props.find((x) => x.id === prop);
  const handles = p ? handlesOf(p) : [];
  if (!handles.length) return null;
  return addHold(store, figure, sided('Hand', hand) as Constraint['bone'], { prop, at: handles[handles.length - 1] });
}

/** Lie on top of a prop (a stretcher, a bench, a mat): the hips held on its top, wherever it goes. */
export function lieOn(store: Store, figure: string, prop: string) {
  const p = store.scene.props.find((x) => x.id === prop);
  if (!p) return null;
  const b = localBounds(p.kind);
  const top: Vec3 = [((b.min.x + b.max.x) / 2) * p.scale[0], b.max.y * p.scale[1] + 0.1, ((b.min.z + b.max.z) / 2) * p.scale[2]];
  return addHold(store, figure, 'hips', { prop, at: top });
}

/** Let go of a hold at the playhead (one that has not started by then goes). */
export function letGo(store: Store, id: string) {
  const t = store.getState().time;
  store.updateScene((s) => {
    const a = s.animation;
    if (!a?.constraints) return s;
    const constraints = a.constraints.flatMap((c) => (c.id !== id ? [c] : t > c.start + 1e-6 ? [{ ...c, end: Math.min(c.end, snapTime(a, t)) }] : []));
    const { constraints: _old, ...rest } = a;
    void _old;
    return { ...s, animation: constraints.length ? { ...rest, constraints } : rest };
  });
}

/* Animation */

/** Turn the open pose into an animation (its current pose becomes the first keyframe). */
export function startAnimation(store: Store, duration = 2) {
  store.updateScene((s) => (s.animation ? s : { ...s, animation: newAnimation(s, duration) }));
  store.setTime(0);
}

/* Locomotion: walking, running and jumping from mark to mark (lib/locomotion.ts) */

/**
 * Walk, run or jump a figure from where it is at the playhead to a floor point: a new mark. Its
 * later actions move on by the time it takes (the other figures are untouched); the playhead goes
 * to the new mark, so the next "…to here" continues from there. Walking and running face the way
 * they go unless `strafe` (side steps, backing up); a jump keeps the figure's facing.
 */
export function travelTo(store: Store, figureId: string, to: [number, number], kind: Travel, opts: { strafe?: boolean; height?: number } = {}) {
  if (!store.scene.animation) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
  const done = addTravel(store.scene, figureId, store.getState().time, to, kind, opts);
  if (!done) return null;
  store.updateScene((s) => ({ ...s, animation: done.animation }));
  store.setTime(done.to);
  store.select({ kind: 'figure', figure: figureId });
  return { from: done.from, to: done.to };
}

/**
 * Move a figure's key (or action) at `from` and everything of its after it by `by` seconds: a
 * pause put in or taken out of what it does (the other figures keep their timing). It cannot
 * move back past what comes before.
 */
export function rippleKeys(store: Store, figureId: string, from: number, by: number, key = '') {
  store.updateScene((s) => {
    const a = s.animation;
    if (!a) return s;
    const before = moments(a, figureId).filter((t) => t < from - 1e-6).at(-1);
    const step = before === undefined ? Math.max(by, -from) : Math.max(by, before + 1 / a.fps - from);
    // From the key at `from` on (keys sit on frames, so half a frame before it is safe).
    return Math.abs(step) < 1e-6 ? s : { ...s, animation: ripple(a, figureId, from - 0.5 / a.fps, step) };
  }, key);
}

/** How a figure gets to its key (or mark) at time t: walk, run, jump, or (null) glide as keyed. */
export function setTravel(store: Store, figureId: string, t: number, kind: Travel | null, patch: { strafe?: boolean; spin?: number; flip?: number } = {}) {
  store.updateScene((s) => (s.animation ? { ...s, animation: setTravelMode(s, figureId, t, kind, patch) } : s));
}

/** Set a jump's height: its time in the air changes (gravity), the figure's later actions move with it. */
export function setJumpHeight(store: Store, figureId: string, t: number, height: number) {
  const a = store.scene.animation;
  const jump = a && travelInto(a, figureId, t);
  if (!a || !jump) return;
  const by = Math.round((jump.start + flightTime(height) + 2 * JUMP_PREP - (jump.start + jump.duration)) * a.fps) / a.fps;
  if (Math.abs(by) < 1e-6) return;
  store.updateScene((s) => {
    if (!s.animation) return s;
    const moved = ripple(s.animation, figureId, jump.start + jump.duration - 0.5 / a.fps, by);
    return { ...s, animation: { ...moved, actions: moved.actions.map((x) => (x.id === jump.id ? { ...x, duration: x.duration + by } : x)) } };
  });
  store.setTime(t + by);
}

/** Move a figure's mark (where it is keyed, or a travel ends, at time t) to another floor point. */
export function moveMark(store: Store, figureId: string, t: number, to: [number, number], key = '') {
  store.updateScene((s) => (s.animation ? { ...s, animation: moveMarkTo(s, figureId, t, to) } : s), key);
}

/* Actions on the timeline: moved, retimed, blended, recast, and their marks fitted */

const actionById = (store: Store, id: string) => store.scene.animation?.actions.find((x) => x.id === id);

/**
 * Move an action to start at `start` (on a frame): what everyone in it does after it comes along.
 * It stops at the end of what any of them does before it.
 */
export function moveAction(store: Store, id: string, start: number, key = '') {
  store.updateScene((s) => {
    const a = s.animation;
    const act = a?.actions.find((x) => x.id === id);
    if (!a || !act) return s;
    const who = act.roles.map((r) => r.figure);
    const layer = (x: Action) => x.layer ?? 'base';
    const before = a.actions.filter((x) => x !== act && layer(x) === layer(act) && x.roles.some((r) => who.includes(r.figure)) && x.start < act.start - 1e-6);
    const floor = Math.max(0, ...before.map((x) => (x.source.kind === 'keys' ? x.start + (partKeys(x.source.clip.parts[0]).at(-1)?.t ?? 0) : x.start + x.duration)));
    const to = Math.max(floor, snapTime({ ...a, duration: 60 }, start));
    return Math.abs(to - act.start) < 1e-6 ? s : { ...s, animation: rippleInStep(a, who, act.start, to - act.start) };
  }, key);
}

/** Retime an action to last `duration` (see track.retimeAction). */
export function retime(store: Store, id: string, duration: number, key = '') {
  store.updateScene((s) => (s.animation ? { ...s, animation: retimeAction(s.animation, id, duration) } : s), key);
}

/** How long an action blends in from what was before it (s). */
export function setBlend(store: Store, id: string, blendIn: number, key = '') {
  store.updateScene((s) => (s.animation ? { ...s, animation: setBlendIn(s.animation, id, blendIn) } : s), key);
}

/**
 * A clip action's speed (a clip that does not loop takes longer or shorter for it) and whether it
 * is mirrored (left for right).
 */
export function setClipOptions(store: Store, id: string, patch: { speed?: number; mirror?: boolean }, key = '') {
  const act = actionById(store, id);
  if (act?.source.kind !== 'clip') return;
  const clip = clipById(act.source.clip);
  if (patch.speed !== undefined && clip && !clip.loop) retime(store, id, clip.duration / Math.min(4, Math.max(0.25, patch.speed)), key);
  store.updateScene((s) => {
    if (!s.animation) return s;
    const actions = s.animation.actions.map((x) => {
      if (x.id !== id || x.source.kind !== 'clip') return x;
      const source = { ...x.source };
      if (patch.speed !== undefined && clip?.loop) source.speed = Math.min(4, Math.max(0.25, patch.speed));
      if (patch.mirror !== undefined) {
        if (patch.mirror) source.mirror = true;
        else delete source.mirror;
      }
      return { ...x, source };
    });
    return { ...s, animation: { ...s.animation, actions } };
  }, key);
}

/** Give a role of an action of several people to another figure (see track.recast). */
export function recastRole(store: Store, id: string, index: number, figure: string) {
  store.updateScene((s) => (s.animation ? { ...s, animation: recast(s, id, index, figure) } : s));
  store.setTime(store.getState().time);
}

/**
 * A clip's end mark dragged further than the clip can be warped: put it back to the nearest place
 * it can reach, or keep it and walk the rest of the way after the clip.
 */
export function fitWarp(store: Store, id: string, figure: string, how: 'back' | 'walk') {
  const act = actionById(store, id);
  const want = act?.roles.find((r) => r.figure === figure)?.end;
  const limit = act && warpLimit(store.scene, act, figure);
  if (!act || !want || !limit) return;
  store.updateScene((s) => {
    if (!s.animation) return s;
    const actions = s.animation.actions.map((x) => (x.id === id ? { ...x, roles: x.roles.map((r) => (r.figure === figure ? { ...r, end: limit } : r)) } : x));
    return { ...s, animation: { ...s.animation, actions } };
  });
  if (how === 'walk') {
    const done = addTravel(store.scene, figure, act.start + act.duration, want.at, 'walk');
    if (done) store.updateScene((s) => ({ ...s, animation: done.animation }));
  }
  store.setTime(store.getState().time);
}

/** Where an action handling a prop sends it: a pass to another hand, a shot that goes in or off the rim. */
export function setActionTarget(store: Store, id: string, target: PropTarget) {
  store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, actions: s.animation.actions.map((x) => (x.id === id ? { ...x, target } : x)) } } : s));
  store.setTime(store.getState().time);
}

/** Remove an action (a motion, say) from the tracks of everyone in it. */
export function deleteAction(store: Store, id: string) {
  store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, actions: s.animation.actions.filter((x) => x.id !== id) } } : s));
  store.setTime(store.getState().time);
}

export function removeAnimation(store: Store) {
  store.updateScene((s) => {
    if (!s.animation) return s;
    const { animation: _removed, ...rest } = s;
    void _removed;
    return rest;
  });
}

/** Key the active figure's pose at the playhead (or `figureIds`'). */
export function addKeyframe(store: Store, figureIds?: string[]) {
  const t = store.getState().time;
  const ids = figureIds ?? (store.getState().activeFigure ? [store.getState().activeFigure!] : store.scene.figures.map((f) => f.id));
  store.updateScene((s) => {
    if (!s.animation) return s;
    let animation = s.animation;
    for (const f of s.figures.filter((x) => ids.includes(x.id))) animation = setPoseAt({ ...s, animation }, f.id, t, { bones: f.bones, position: f.position, hands: f.hands, grounded: f.grounded });
    return { ...s, animation };
  });
}

/** Delete the active figure's key at the playhead (it keeps at least one). */
export function deleteKeyframe(store: Store, figureId = store.getState().activeFigure ?? undefined) {
  const t = store.getState().time;
  if (!figureId) return;
  store.updateScene((s) => (s.animation ? { ...s, animation: removeKeyAt(s.animation, figureId, t) } : s));
  store.setTime(t);
}

/** Retime one figure's key (or, without `figureId`, every figure's key at that time). */
export function moveKeyframe(store: Store, from: number, to: number, figureId?: string) {
  store.updateScene((s) => {
    if (!s.animation) return s;
    const ids = figureId ? [figureId] : s.figures.map((f) => f.id).filter((id) => keyAtTime(s.animation!, id, from));
    return { ...s, animation: ids.reduce((a, id) => moveKeyTo(a, id, from, to), s.animation) };
  }, `move-key:${figureId ?? ''}`);
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

/* Cameras: objects in the scene with paths (lib/shot.ts); shots film with them */

/** The shot playing at the playhead, and the time (on a frame). */
function shotHere(store: Store) {
  const a = store.scene.animation;
  if (!a) return null;
  const t = snapTime(a, store.getState().time);
  return { a, t, span: spanAt(a, t) };
}

/** The camera filming at t, given one (a new camera for its shot) if it is filmed by the still camera. */
function filming(s: Scene, t: number): { s: Scene; cam: Camera } {
  const a = s.animation!;
  const span = spanAt(a, t);
  const cam = cameraById(a, span.shot.camera);
  if (cam) return { s, cam };
  const made = newCamera(a);
  return { s: { ...s, animation: { ...updateShot(a, span.shot.id, { camera: made.id }), cameras: [...(a.cameras ?? []), made] } }, cam: made };
}

/** What a camera sees at t: its own view once it has a path, before that what the shot shows. */
const seenBy = (s: Scene, cam: Camera, t: number) => (cam.points.length ? viewOf(s, cam, t) : cameraAt(s, t));

/** Set (or replace) a path point at the playhead of the camera filming then: there, looking at `look`, through a lens with this field of view. */
export function setCameraPoint(store: Store, position: THREE.Vector3, look: THREE.Vector3, fov: number, key = '') {
  const here = shotHere(store);
  if (!here) return;
  store.updateScene((x) => {
    const { s, cam } = filming(x, here.t);
    if (cam.rig) {
      // A rig takes the view's angle (from its subject) and lens; it keeps its shot size.
      const view = { position, target: look, fov, lens: fovLens(fov, frameAspect(s)), roll: 0 };
      return withCamera(s, { ...cam, rig: rigFrom(s, cam, view, here.t, cam.rig.body, { size: cam.rig.size, lens: Math.round(view.lens) }) });
    }
    return { ...s, animation: setPointAt(s.animation!, cam, here.t, capturePoint(s, cam, here.t, position, look, fov)) };
  }, key);
}

/** The camera with this id, or the one filming at t. */
const cameraOf = (s: Scene, t: number, id?: string) => (id ? cameraById(s.animation, id) : liveCamera(s, t));

/** A point on a camera's path at t (on a frame), where it passes then. */
export function addCameraPoint(store: Store, camera: string, t: number) {
  store.updateScene((s) => {
    const cam = cameraById(s.animation, camera);
    if (!s.animation || !cam) return s;
    const time = snapTime(s.animation, t);
    const view = viewOf(s, cam, time);
    return { ...s, animation: setPointAt(s.animation, cam, time, { ...capturePoint(s, cam, time, view.position, view.target, view.fov), ...(view.roll ? { roll: view.roll } : {}) }) };
  });
}

/** Move a camera's path point at time t to another place in the world (dragged on the canvas); it keeps looking where it did. */
export function moveCameraPoint(store: Store, camera: string, t: number, position: THREE.Vector3, key = '') {
  store.updateScene((s) => {
    const cam = cameraOf(s, t, camera);
    if (!s.animation || !cam) return s;
    const before = viewOf(s, cam, t);
    const point = capturePoint(s, cam, t, position, before.target, before.fov);
    return { ...s, animation: setPointAt(s.animation, cam, t, { ...point, ...(before.roll ? { roll: before.roll } : {}) }) };
  }, key);
}

/** Point a camera at time t at another place in the world (its look point dragged). */
export function moveCameraLook(store: Store, camera: string, t: number, look: THREE.Vector3, key = '') {
  store.updateScene((s) => {
    const cam = cameraOf(s, t, camera);
    if (!s.animation || !cam) return s;
    const before = viewOf(s, cam, t);
    return { ...s, animation: setPointAt(s.animation, cam, t, capturePoint(s, cam, t, before.position, look, before.fov)) };
  }, key);
}

/** Remove the path point at t of a camera (by default the one filming then). */
export function deleteCameraPoint(store: Store, t = store.getState().time, camera?: string) {
  store.updateScene((s) => {
    const cam = cameraOf(s, t, camera);
    return s.animation && cam ? { ...s, animation: removePointAt(s.animation, cam, snapTime(s.animation, t)) } : s;
  });
}

/** Retime the path point at `from` of a camera (by default the one filming then). */
export function retimeCameraPoint(store: Store, from: number, to: number, key = '', camera?: string) {
  store.updateScene((s) => {
    const cam = cameraOf(s, from, camera);
    return s.animation && cam ? { ...s, animation: movePoint(s.animation, cam, from, snapTime(s.animation, to)) } : s;
  }, key);
}

/**
 * Frame the subject of the camera filming at the playhead at a shot size: the camera keeps its
 * angle and lens (`lens`: another one), and comes as near as that size takes; `place`: where the
 * subject sits in the frame.
 */
export function frameShot(store: Store, size: ShotSize, o: { lens?: number; place?: Placement } = {}) {
  const here = shotHere(store);
  if (!here) return;
  store.updateScene((x) => {
    const { s, cam } = filming(x, here.t);
    if (cam.rig) return withCamera(s, { ...cam, rig: { ...cam.rig, size, ...(o.lens ? { lens: o.lens } : {}), ...(o.place && o.place !== 'center' ? { place: o.place } : {}), ...(o.place === 'center' ? { place: undefined } : {}) } });
    const view = seenBy(s, cam, here.t);
    const { yaw, pitch } = angleOf(view);
    const point = framePoint(s, cam, here.t, size, { yaw, pitch, lens: o.lens ?? view.lens, place: o.place });
    return { ...s, animation: setPointAt(s.animation!, cam, here.t, point) };
  });
}

/**
 * The lens at the playhead (mm). `keep: 'size'` keeps the subject the same size in the frame (the
 * camera moves nearer or further, as with a dolly zoom); `keep: 'place'` keeps the camera where it
 * is (the frame gets wider or tighter).
 */
export function setLens(store: Store, mm: number, keep: 'size' | 'place' = 'size', key = '') {
  const here = shotHere(store);
  if (!here) return;
  const lens = Math.min(1200, Math.max(4, mm));
  store.updateScene((x) => {
    const { s, cam } = filming(x, here.t);
    // A rig keeps its shot size whatever the lens (it moves nearer or further).
    if (cam.rig) return withCamera(s, { ...cam, rig: { ...cam.rig, lens } });
    const view = seenBy(s, cam, here.t);
    const position = keep === 'size'
      ? view.target.clone().add(view.position.clone().sub(view.target).multiplyScalar(lens / view.lens))
      : view.position;
    const point = capturePoint(s, cam, here.t, position, view.target, lensFov(lens, frameAspect(s)));
    return { ...s, animation: setPointAt(s.animation!, cam, here.t, { ...point, lens, ...(view.roll ? { roll: view.roll } : {}) }) };
  }, key);
}

/**
 * A camera's settings: its name, what it films (subject), where its path is (anchor), what it
 * looks at (aim) — the path is restated so the camera stays where it was — how it eases, how it
 * shakes.
 */
export function editCamera(store: Store, id: string, patch: Partial<Pick<Camera, 'name' | 'subject' | 'anchor' | 'aim' | 'ease' | 'shake'>>) {
  store.updateScene((s) => {
    const a = s.animation;
    const old = cameraById(a, id);
    if (!a || !old) return s;
    const { subject, anchor, aim, ...rest } = patch;
    const where = { ...(subject !== undefined ? { subject: subject || undefined } : {}), ...(anchor ? { anchor } : {}), ...(aim ? { aim } : {}) };
    let cam = Object.keys(where).length ? restate(s, old, where) : old;
    if (!cam.subject) delete cam.subject;
    cam = { ...cam, ...rest, name: (rest.name ?? cam.name).trim() || cam.name };
    if (!cam.shake) delete cam.shake;
    if (cam.ease !== 'linear') delete cam.ease;
    return withCamera(s, cam);
  }, `camera:${id}`);
}

/**
 * How a camera moves: by its path, or placing itself every frame from its subject, following it
 * or circling it (from where it is at the playhead). A rig turned into a path leaves points where
 * it went over the shots it films, every half second.
 */
export function setCameraBody(store: Store, id: string, body: 'path' | CameraRig['body']) {
  const t = store.getState().time;
  store.updateScene((s) => {
    const a = s.animation;
    const cam = cameraById(a, id);
    if (!a || !cam || (body === 'path' ? !cam.rig : cam.rig?.body === body)) return s;
    if (body !== 'path') {
      const view = cam.rig || cam.points.length ? viewOf(s, cam, t) : cameraAt(s, t);
      const { rig: _rig, ...rest } = cam;
      void _rig;
      return withCamera(s, { ...cam, points: [], rig: rigFrom(s, rest, view, t, body, cam.rig ? { size: cam.rig.size, lens: cam.rig.lens, smooth: cam.rig.smooth } : {}) });
    }
    const spans = shotSpans(a).filter((x) => x.shot.camera === id);
    const times = new Set<number>();
    for (const sp of spans.length ? spans : [{ start: 0, end: a.duration }]) {
      const n = Math.max(1, Math.round((sp.end - sp.start) / 0.5));
      for (let i = 0; i <= n; i++) times.add(snapTime(a, sp.start + ((sp.end - sp.start) * i) / n));
    }
    const { rig: _rig, ...path } = { ...cam, anchor: 'world' as const, aim: 'point' as const };
    void _rig;
    const points = [...times].sort((p, q) => p - q).map((u) => {
      const v = viewOf(s, cam, u);
      return capturePoint(s, path, u, v.position, v.target, v.fov);
    });
    return withCamera(s, { ...path, points });
  }, `camera:${id}`);
}

/** A rig's shot size, where the subject sits, its lens, its angle, how it turns, its smoothing, what its angle is measured from. */
export function editRig(store: Store, id: string, patch: Partial<Omit<CameraRig, 'body'>>, key = `rig:${id}`) {
  store.updateScene((s) => {
    const cam = cameraById(s.animation, id);
    if (!cam?.rig) return s;
    const rig: CameraRig = { ...cam.rig, ...patch };
    if (patch.yaw !== undefined) rig.yaw = wrapDeg(patch.yaw);
    if (patch.pitch !== undefined) rig.pitch = Math.min(89, Math.max(-89, patch.pitch));
    if (patch.smooth !== undefined) rig.smooth = Math.min(10, Math.max(0, patch.smooth));
    if (patch.lens !== undefined) rig.lens = Math.min(1200, Math.max(4, patch.lens));
    if (rig.place === 'center') delete rig.place;
    for (const k of ['turn', 'spin', 'toward', 'smooth'] as const) if (!rig[k]) delete rig[k];
    return withCamera(s, { ...cam, rig });
  }, key);
}

/** A new camera for the shot at the playhead, where the camera filming there is now (its id). */
export function addCamera(store: Store) {
  const here = shotHere(store);
  if (!here) return null;
  const s = store.scene;
  const before = cameraById(here.a, here.span.shot.camera);
  const view = cameraAt(s, here.t);
  let cam = newCamera(here.a, before?.subject ? { subject: before.subject } : {});
  cam = { ...cam, points: [capturePoint(s, cam, here.t, view.position, view.target, view.fov)] };
  store.updateScene((x) => (x.animation ? { ...x, animation: { ...updateShot(x.animation, here.span.shot.id, { camera: cam.id }), cameras: [...(x.animation.cameras ?? []), cam] } } : x));
  return cam.id;
}

/**
 * A camera of a shot's own to change (its id): the one it films with if no other shot does, or
 * else a copy of it; a new camera if it has none.
 */
export function ownCamera(store: Store, shotId: string): string | null {
  const a = store.scene.animation;
  const span = a && shotSpans(a).find((x) => x.shot.id === shotId);
  if (!a || !span) return null;
  const cam = cameraById(a, span.shot.camera);
  if (cam && !shotSpans(a).some((x) => x.shot.id !== shotId && x.shot.camera === cam.id)) return cam.id;
  const { id: _id, name: _name, ...rest } = cam ?? newCamera(a);
  void _id;
  void _name;
  const copy = { ...newCamera(a), ...rest };
  store.updateScene((s) => (s.animation ? { ...s, animation: { ...updateShot(s.animation, shotId, { camera: copy.id }), cameras: [...(s.animation.cameras ?? []), copy] } } : s));
  return copy.id;
}

/** Make a shot about one figure (or everyone: ''), on a camera of its own. */
export function setShotSubject(store: Store, shotId: string, figure: string) {
  const id = ownCamera(store, shotId);
  if (id) editCamera(store, id, { subject: figure });
}

/** Remove a camera: the shots it filmed are filmed by the still camera. */
export function deleteCamera(store: Store, id: string) {
  store.updateScene((s) => (s.animation ? { ...s, animation: removeCamera(s.animation, id) } : s));
  if (store.getState().selection?.kind === 'camera') store.select(null);
}

/**
 * Film the animation with a coverage (lib/coverage.ts): its cameras on the figures in its roles
 * (given, or as cast before, or A the active figure and B the one nearest it), cut on what they
 * do. The figures cast, or null if there are too few people for it.
 */
export function coverScene(store: Store, id: string, roles?: Record<string, string>): Record<string, string> | null {
  const c = coverageById(id);
  if (!c) return null;
  if (!store.scene.animation) startAnimation(store, 4);
  const a = store.scene.animation!;
  const cast = roles ?? (a.coverage?.id === id ? a.coverage.roles : castCoverage(store.scene, c, store.getState().activeFigure ?? undefined));
  if (!cast || c.roles.some((r) => !store.scene.figures.some((f) => f.id === cast[r])) || new Set(c.roles.map((r) => cast[r])).size < c.roles.length) return null;
  store.updateScene((s) => applyCoverage(s, id, cast as Record<'A', string>));
  return cast;
}

/** The frame shape the scene's shots are filmed in (16:9, 9:16, 1:1, 2.39:1). */
export function setFrameShape(store: Store, frame: FrameShape) {
  store.updateScene((s) => {
    if (!s.animation) return s;
    const { frame: _old, ...rest } = s.animation;
    void _old;
    return { ...s, animation: frame === '16:9' ? rest : { ...rest, frame } };
  });
}

/** Give the current shot (the whole animation without cuts) a ready-made camera move. */
export function applyCameraMove(store: Store, id: string) {
  const t = store.getState().time;
  store.updateScene((s) => {
    const animated = s.animation ? s : { ...s, animation: newAnimation(s, 4) };
    return filmWith(animated, id, { index: spanAt(animated.animation!, t).index });
  });
}

/* Shots */

/** Cut at the playhead: a new shot starts there, filming with the same camera until given another. */
export function cutShot(store: Store) {
  const t = store.getState().time;
  store.updateScene((s) => (s.animation ? { ...s, animation: cutAt(s.animation, snapTime(s.animation, t)) } : s));
}

export function removeShotCut(store: Store, id: string) {
  store.updateScene((s) => (s.animation ? { ...s, animation: removeCut(s.animation, id) } : s));
}

/** A shot's name and caption, the camera it films with (null: the still camera) and how long it blends in from the one before (0: a cut). */
export function editShot(store: Store, id: string, patch: { name?: string; caption?: string; camera?: string | null; blend?: number }) {
  store.updateScene((s) => {
    if (!s.animation) return s;
    const { camera, blend, ...rest } = patch;
    const a = updateShot(s.animation, id, rest);
    const shots = a.shots!.map((x) => {
      if (x.id !== id) return x;
      const { camera: oldCam, blend: oldBlend, ...shot } = x;
      const cam = camera === undefined ? oldCam : camera ?? undefined;
      const b = blend === undefined ? oldBlend : Math.min(10, Math.max(0, Math.round(blend * 100) / 100));
      return { ...shot, ...(cam ? { camera: cam } : {}), ...(b ? { blend: b } : {}) };
    });
    return { ...s, animation: { ...a, shots } };
  }, `shot:${id}`);
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

/* Scene templates (lib/templates.ts) */

/** A new scene from a template, opened. */
export function sceneFromTemplate(store: Store, id: string) {
  const t = templatesOf(store.getState().library).find((x) => x.id === id);
  if (!t) return false;
  addScene(store, t.build());
  return true;
}

/**
 * Put a template into the open scene, at the playhead: its first role taken by the active figure
 * (where it stands, facing its way), the next by the figures nearest it, new figures for the rest.
 * The figures it brings in or casts, by role.
 */
export function placeTemplate(store: Store, id: string, lead = store.getState().activeFigure ?? undefined): string[] | null {
  const t = templatesOf(store.getState().library).find((x) => x.id === id);
  if (!t) return null;
  const built = t.build();
  const cast = lead && store.scene.figures.some((f) => f.id === lead) ? [lead, ...nearestPartners(store, lead, built.figures.length - 1)] : [];
  const before = new Set(store.scene.figures.map((f) => f.id));
  const t0 = store.scene.animation ? snapTime(store.scene.animation, store.getState().time) : 0;
  store.updateScene((s) => putTemplate(s, built, cast, t0));
  return [...cast, ...store.scene.figures.filter((f) => !before.has(f.id)).map((f) => f.id)];
}

/** Save the open scene as a template in the library (its cast, set, actions and light). */
export function saveTemplate(store: Store, name: string) {
  const t = asTemplate(store.scene, name.trim().slice(0, 80) || store.scene.name);
  store.commit((lib) => ({ ...lib, templates: [...(lib.templates ?? []), t] }));
  return t;
}

export function deleteTemplate(store: Store, id: string) {
  store.commit((lib) => {
    const templates = (lib.templates ?? []).filter((t) => t.id !== id);
    const { templates: _old, ...rest } = lib;
    void _old;
    return templates.length ? { ...rest, templates } : rest;
  });
}

/** Keep an imported motion in the library (My motions): listed there, its frames kept as an asset. */
export function saveMotion(store: Store, clip: Clip) {
  void saveClips([clip]);
  store.commit((lib) => ({ ...lib, clips: [...(lib.clips ?? []), clipInfo(clip)] }));
}

/** Imported motions brought in from a library file: listed (those not listed yet), their frames kept. */
export function addMotions(store: Store, clips: Clip[]) {
  if (!clips.length) return;
  void saveClips(clips);
  store.commit((lib) => {
    const have = new Set((lib.clips ?? []).map((c) => c.id));
    return { ...lib, clips: [...(lib.clips ?? []), ...clips.filter((c) => !have.has(c.id)).map(clipInfo)] };
  });
}

/** Keep an imported character in the library (its file is already kept: lib/model.ts importModel). */
export function addModel(store: Store, info: ModelInfo) {
  store.commit((lib) => ({ ...lib, models: [...(lib.models ?? []), info] }));
}

export function deleteModel(store: Store, id: string) {
  store.commit((lib) => {
    const models = (lib.models ?? []).filter((m) => m.id !== id);
    const { models: _old, ...rest } = lib;
    void _old;
    return models.length ? { ...rest, models } : rest;
  });
}

/** Draw a figure as an imported character, or (null) as the mannequin. */
export function setFigureModel(store: Store, figureId: string, model: string | null) {
  store.updateFigure(figureId, (f) => {
    const { model: _old, ...rest } = f;
    void _old;
    return model ? { ...rest, model } : rest;
  });
}

export function deleteMotion(store: Store, id: string) {
  store.commit((lib) => {
    const clips = (lib.clips ?? []).filter((m) => m.id !== id);
    const { clips: _old, ...rest } = lib;
    void _old;
    return clips.length ? { ...rest, clips } : rest;
  });
}

/** The figures nearest to one (posable ones, shown), nearest first: partners for a motion of several people. */
export function nearestPartners(store: Store, figureId: string, count: number) {
  const f = store.scene.figures.find((x) => x.id === figureId);
  if (!f) return [];
  return store.scene.figures
    .filter((x) => x.id !== figureId && !x.proxy && !x.hidden)
    .sort((p, q) => Math.hypot(p.position[0] - f.position[0], p.position[2] - f.position[2]) - Math.hypot(q.position[0] - f.position[0], q.position[2] - f.position[2]))
    .slice(0, count)
    .map((x) => x.id);
}

/**
 * Play a one-person motion from the waist up over what a figure is doing at the playhead (waving
 * while walking): an upper-body action. False if it cannot (a motion of several people, or a walk).
 */
export function applyUpperBody(store: Store, figureId: string, motionId: string) {
  const mine = store.getState().library.clips?.some((c) => c.id === motionId);
  const motion = MOTIONS.find((m) => m.id === motionId);
  if (!mine && (!motion || motion.people > 1 || motion.travel)) return false;
  if (!store.scene.animation) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
  const animation = addUpper(store.scene, figureId, mine ? motionId : BUILT_IN + motionId, store.getState().time);
  if (!animation) return false;
  store.updateScene((s) => ({ ...s, animation }));
  return true;
}

/** Remove a correction key of a figure at the playhead. */
export function deleteCorrection(store: Store, figureId: string, t: number) {
  store.updateScene((s) => (s.animation ? { ...s, animation: removeCorrectionAt(s.animation, figureId, t) } : s));
  store.setTime(store.getState().time);
}

/**
 * Give a figure a motion from the library (built in, or one of mine), starting at the playhead
 * (the scene is animated if it is not yet). A motion of several people goes on this figure (the
 * lead: the first part) and `partners` (by default the nearest figures), who take their places
 * around it, walking there first if there is time. Returns false if it cannot (too few figures).
 */
export function applyMotion(store: Store, figureId: string, motionId: string, partners?: string[]) {
  const start = store.scene.animation ? store.getState().time : 0;
  if (store.getState().library.clips?.some((c) => c.id === motionId)) {
    store.updateScene((s) => insertClip(s, [figureId], motionId, start));
    store.setTime(start);
    return true;
  }
  const motion = MOTIONS.find((m) => m.id === motionId);
  if (!motion) return false;
  if (motion.travel) {
    // Walk, run or jump ahead from where the figure stands, facing its way.
    const f = store.figure?.id === figureId ? store.figure : store.scene.figures.find((x) => x.id === figureId);
    if (!f) return false;
    const [fx, fz] = forward(f);
    const d = motion.travel.distance;
    travelTo(store, figureId, [f.position[0] + fx * d, f.position[2] + fz * d], motion.travel.kind);
    return true;
  }
  const cast = [figureId, ...(motion.people > 1 ? partners ?? nearestPartners(store, figureId, motion.people - 1) : [])];
  if (cast.length < motion.people) return false;
  store.updateScene((s) => insertClip(s, cast, BUILT_IN + motion.id, start));
  store.setTime(start);
  return true;
}
