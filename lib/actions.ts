import * as THREE from 'three';
import { cloneHand } from './hands';
import { jointLimits, sided, wrapDeg } from './joints';
import {
  NEUTRAL_ANGLES, cameraFrom, duplicateScene, mirrorFigure, newFigure, newProp, newScene, symmetrize, uid, withPosture,
} from './doc';
import { MAX_DURATION, newAnimation, normalize, propKeyOf, setDuration as setAnimDuration, snapTime } from './animation';
import { BUILT_IN, clipById, hasClip } from './assets';
import { applyCoverage, castCoverage, coverageById } from './coverage';
import { asTemplate, putTemplate, shootsOf, templatesOf } from './templates';
import { clipInfo, partKeys } from './clip';
import { saveClips, saveImage } from './assetstore';
import { projectSettingsOf } from './project';
import { LIGHTING_PRESETS, MAX_LIGHTS, clampLight, fromPreset, keyLight, lightingOf, newLight } from './lighting';
import { CATCH_LEAD, UPPER_EASE, actionsOf, arrivalAt, figurePoseAt, propStretchesOf, propWorldAt, sceneAt, settledAt, warpLimit } from './evaluate';
import { physicsOf, putPropKey, setPropKey } from './propmotion';
import { handlesOf, localBounds } from './props';
import {
  actionLabel, addTravel, addUpper, cutTo, fitted, holdKeyFor, moveKeysBy, insertClip, repeatAction as repeatTrack, setKeyEase, partnersOf, recast, removeCorrectionAt, keyAtTime, moments, moveKeyTo, moveMarkTo, removeKeyAt, restage, retimeAction, ripple, rippleInStep, setBlendIn, setPoseAt, setTravelMode, travelInto,
} from './track';
import { JUMP_PREP, flightTime } from './locomotion';
import { bodyFor } from './model';
import { HANDLING, MOTIONS } from './motions';
import { allPoses, poseFromFigure, withPose } from './poses';
import {
  Rig, atDistance, backToBack, besides, contactPoint, contactSpot, distance, faceEachOther, headPoint, inFrontOf, lookAt, reach, turnTowards,
  facing, forward, withFacing, withPosition, type Contact,
} from './relations';
import { angleAt, angleOf, cameraAt, cameraById, capturePoint, filmWith, reshapeCamera, fovLens, frameAspect, framePoint, lensFov, liveCamera, newCamera, reform, restate, rigFrom, viewOf, withCamera, type CameraView, type Placement, type ShotSize } from './cameras';
import { angle, bonesOf, withAngles } from './pose';
import { cutAt, moveCut, movePoint, pinShots, removeCamera, removeCut, removePointAt, setPointAt, shotSpans, spanAt, unpinShot as unpin, updateShot } from './shots';
import { openingSelection, type Store } from './store';
import { HANDHELD, PROP_LABELS } from './types';
import { held, released } from './hold';
import { REACT_LEAD, strikeTime } from './strike';
import type { Action, Ambient, Animation, Camera, CameraRig, Clip, PathCamera, Constraint, Figure, PropTarget, Hand, JointName, Light, Lighting, ModelInfo, ProjectSettings, Posture, Prop, PropKind, Reference, Scene, Selection, ShootPreset, Side, Travel, Vec3 } from './types';

/* Scenes (library entries) */

export function addScene(store: Store, scene: Scene = newScene(`Scene ${store.getState().library.scenes.length + 1}`)) {
  const at = store.getState().sceneIndex + 1;
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes.slice(0, at), scene, ...lib.scenes.slice(at)] }), '', {
    sceneIndex: at, selection: openingSelection(scene), activeFigure: null,
  });
}

export function appendScenes(store: Store, scenes: Scene[]) {
  const at = store.getState().library.scenes.length;
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes, ...scenes] }), '', { sceneIndex: at, selection: openingSelection(scenes[0]), activeFigure: null });
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
  if (index < 0 || index >= library.scenes.length) return false;
  // (The last one: a new blank scene in its place, as a new project has.)
  const blank = library.scenes.length === 1 ? [newScene('Scene 1')] : [];
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes.filter((_, i) => i !== index), ...blank] }), '', {
    sceneIndex: index <= sceneIndex ? Math.max(0, sceneIndex - 1) : sceneIndex, selection: null, activeFigure: null,
  });
  store.select(openingSelection(store.scene));
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


export function replaceLibrary(store: Store, scenes: Scene[]) {
  store.commit((lib) => ({ ...lib, scenes }), '', { sceneIndex: 0, selection: openingSelection(scenes[0]), activeFigure: null });
}

export function renameScene(store: Store, name: string) {
  store.updateScene((s) => ({ ...s, name }), 'rename');
}

/** Light the open scene: all its lights at once (a scheme). The light selected, gone, gives way to the key light. */
export function setLighting(store: Store, lighting: Lighting, key = '') {
  store.updateScene((s) => ({ ...s, lighting }), key);
  const sel = store.getState().selection;
  if (sel?.kind === 'light' && !lighting.lights.some((l) => l.id === sel.light)) store.select({ kind: 'light', light: keyLight(lighting)!.id });
}

/** Light the open scene with a lighting scheme (lib/lighting.ts LIGHTING_PRESETS). */
export function applyLightingPreset(store: Store, id: string) {
  const p = LIGHTING_PRESETS.find((x) => x.id === id);
  if (p) setLighting(store, fromPreset(p.lighting));
}

/** Change one of the scene's lights. */
export function editLight(store: Store, id: string, patch: Partial<Omit<Light, 'id'>>, key = '') {
  const l = lightingOf(store.scene);
  setLighting(store, { ...l, lights: l.lights.map((x) => (x.id === id ? clampLight({ ...x, ...patch }) : x)) }, key);
}

/** Change the scene's ambient light. */
export function editAmbient(store: Store, patch: Partial<Ambient>, key = '') {
  const l = lightingOf(store.scene);
  setLighting(store, { ...l, ambient: { ...l.ambient, ...patch } }, key);
}

/**
 * Add a light to the scene (up to MAX_LIGHTS), selected: the role not taken yet (a fill, then a
 * rim), from the side it lights from. Its id, or null (as many as there can be).
 */
export function addLight(store: Store): string | null {
  const l = lightingOf(store.scene);
  if (l.lights.length >= MAX_LIGHTS) return null;
  const taken = new Set(l.lights.map((x) => x.role));
  const role = (['key', 'fill', 'rim'] as const).find((r) => !taken.has(r)) ?? 'custom';
  const key = keyLight(l);
  const from = { key: { azimuth: 40, elevation: 45 }, fill: { azimuth: -(key?.azimuth ?? 40) * 1.3, elevation: 20, intensity: 0.4 }, rim: { azimuth: 160, elevation: 40, intensity: 0.9 }, custom: { azimuth: -120, elevation: 35, intensity: 0.6 } }[role];
  const light = clampLight(newLight(role, from));
  setLighting(store, { ...l, lights: [...l.lights, light] });
  store.select({ kind: 'light', light: light.id });
  return light.id;
}

/** Take a light out of the scene (not its last one). Whether it was. */
export function deleteLight(store: Store, id: string) {
  const l = lightingOf(store.scene);
  if (l.lights.length < 2 || !l.lights.some((x) => x.id === id)) return false;
  setLighting(store, { ...l, lights: l.lights.filter((x) => x.id !== id) });
  return true;
}

/** An image as PNG, JPEG or WebP (what is kept and synced): others (GIF, BMP…) are drawn into a PNG. */
async function webImage(image: Blob): Promise<Blob> {
  if (/^image\/(png|jpeg|webp)$/.test(image.type)) return image;
  const bitmap = await createImageBitmap(image);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** A photo or drawing over the open scene (kept as an asset, saved with the scene), shown. */
export async function setReferenceImage(store: Store, image: Blob) {
  const id = uid('ref');
  await saveImage(id, await webImage(image));
  store.updateScene((s) => ({ ...s, reference: { image: id, opacity: s.reference?.opacity ?? 0.45, visible: true } }));
}

/** How the scene's reference image shows (null: none). */
export function editReference(store: Store, patch: Partial<Omit<Reference, 'image'>> | null, key = '') {
  store.updateScene((s) => {
    if (!s.reference) return s;
    const { reference, ...rest } = s;
    return patch ? { ...s, reference: { ...reference, ...patch } } : rest;
  }, key);
}

/* Figures */

/** Where a new figure goes unless told: beside the existing ones. */
function besideFigures(store: Store, gap: number): Vec3 {
  const xs = store.scene.figures.map((f) => f.position[0]);
  return [xs.length ? Math.max(...xs) + gap : 0, 0, 0];
}

/** A new figure where asked (`at`, facing `yaw`), or beside the others. */
export function addFigure(store: Store, at = besideFigures(store, 0.8), yaw = 0) {
  const scene = store.scene;
  const base = store.figure;
  // Same proportions as the active figure.
  const fig = newFigure({
    name: nextName('Figure', scene.figures.map((f) => f.name)),
    position: at,
    ...(base ? { body: { ...base.body } } : {}),
  });
  addFigures(store, [yaw ? withFacing(fig, yaw) : fig]);
}

/** A stand-in for blocking: placed like a figure, in a posture, not posed joint by joint. */
export function addStandIn(store: Store, at = besideFigures(store, 0.8), yaw = 0) {
  const f = withPosture(newFigure({ name: nextName('Stand-in', store.scene.figures.map((x) => x.name)), position: at }), 'stand');
  addFigures(store, [yaw ? withFacing(f, yaw) : f]);
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
  const copies = a.actions.filter((x) => x.roles.length === 1 && x.roles[0].figure === from).map((x): Action => ({ ...structuredClone(x), id: uid('act'), roles: [{ ...x.roles[0], figure: to }] }));
  const b = restage({ ...a, actions: [...a.actions.filter((x) => !x.roles.some((r) => r.figure === to)), ...copies] }, [to], { dx: offset[0], dz: offset[1], turn: 0, about: [0, 0] });
  return { ...b, actions: [...b.actions].sort((p, q) => p.start - q.start || p.duration - q.duration) };
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

/** Whether a figure has idle life in the gaps of a film (breathing, shifting, glances), or holds still. */
export function setIdleLife(store: Store, id: string, on: boolean) {
  store.updateFigure(id, (f) => {
    const next = { ...f, still: true };
    if (on) delete (next as Partial<Figure>).still;
    return next;
  });
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
/** A new prop where asked (`at`, turned `yaw`), or ahead of the active figure; a hand prop into its hand. */
export function addProp(store: Store, kind: PropKind, at?: Vec3, turn?: number) {
  const f = store.figure;
  const [fx, fz] = f ? forward(f) : [0, 1];
  const d = AHEAD[kind];
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const place: Vec3 = at ?? (d && f ? [r3(f.position[0] + fx * d), 0, r3(f.position[2] + fz * d)] : besideFigures(store, 0.9));
  const toward = f ? Math.atan2(f.position[0] - place[0], f.position[2] - place[2]) * (180 / Math.PI) : 180;
  const yaw = turn ?? (kind === 'hoop' ? toward : kind === 'bar' || kind === 'mat' ? toward + 180 : 0);
  const prop = { ...newProp(kind, place, nextName(PROP_LABELS[kind], store.scene.props.map((p) => p.name))), rotation: [0, Math.round(wrapDeg(yaw) * 10) / 10 || 0, 0] as Vec3 };
  // (A hand prop goes into the active figure's hand unless it is put at a spot on the floor.)
  const figure = HANDHELD.includes(kind) && !at ? store.figure : null;
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
  const start = Math.max(0, got && got.t0 > 0 ? got.t0 + CATCH_LEAD + UPPER_EASE : 0, snapTime({ ...a, duration: MAX_DURATION }, t - release));
  const act: Action = {
    id: uid('act'), start, duration: Math.min(MAX_DURATION - start, clip.duration * laps), layer: 'upper', roles: [{ figure: hold.figure }],
    source: { kind: 'clip', clip: clip.id, ...(hold.hand === 'L' ? { mirror: true } : {}) }, prop: id, target,
  };
  const first = propNow(store, id, 0)!;
  store.updateScene((s) => {
    if (!s.animation) return s;
    // Where it starts, so what happens to it later does not change that.
    const keyed = s.animation.props?.[id]?.length ? s.animation : putPropKey(s.animation, 0, id, propKeyOf(first, 0));
    return { ...s, animation: { ...keyed, actions: [...keyed.actions, act], duration: Math.min(MAX_DURATION, Math.max(keyed.duration, act.start + act.duration)) } };
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
  if (still) store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, duration: Math.min(MAX_DURATION, Math.max(s.animation.duration, Math.min(done.release + 6, still + 0.2))) } } : s));
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

/** How a prop bounces and grips when it flies free (null: its kind's own); its flights are worked out again. */
export function setPropPhysics(store: Store, id: string, patch: Partial<{ bounce: number; friction: number }> | null, key = '') {
  store.updateProp(id, (p) => {
    const { physics: _old, ...rest } = p;
    void _old;
    if (!patch) return rest;
    const now = physicsOf(p);
    const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 100) / 100));
    return { ...rest, physics: { bounce: clamp(patch.bounce ?? now.bounce), friction: clamp(patch.friction ?? now.friction) } };
  }, key);
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
  const cam = sel?.kind === 'camera' ? cameraById(scene, sel.camera) : null;
  if (cam && scene.cameras.length > 1) {
    deleteCamera(store, cam.id);
    return cam.name;
  }
  return null;
}

/** Duplicate the selected prop, figure (also when one of its joints is selected) or camera. False when there is none. */
export function duplicateSelection(store: Store) {
  const sel = store.getState().selection;
  if (sel?.kind === 'prop') duplicateProp(store, sel.prop);
  else if (sel?.kind === 'camera') duplicateCamera(store, sel.camera);
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
/**
 * Why a figure cannot take the other end of a prop someone carries, if it cannot: the one at the
 * back much taller than the one in front tips it so far that what lies on it hits them
 * (measured on every pair of builds).
 */
export function carryProblem(store: Store, figure: string, prop: string): string | null {
  const p = store.scene.props.find((x) => x.id === prop);
  const back = store.scene.figures.find((f) => f.id === figure);
  const front = store.scene.figures.find((f) => f.id === p?.hold?.figure);
  return back && front && back.body.height - front.body.height > 0.4 ? `${back.name} is too tall to carry ${p!.name} level with ${front.name}` : null;
}

export function holdHandle(store: Store, figure: string, prop: string, hand: Side) {
  const p = store.scene.props.find((x) => x.id === prop);
  const handles = p ? handlesOf(p) : [];
  if (!handles.length || carryProblem(store, figure, prop)) return null;
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
    const to = Math.max(floor, snapTime({ ...a, duration: MAX_DURATION }, start));
    return Math.abs(to - act.start) < 1e-6 ? s : { ...s, animation: rippleInStep(a, who, act.start, to - act.start) };
  }, key);
}

/**
 * Time an action as a reaction to another figure's strike (a clip): moved to start just before the
 * strike lands (strike.ts), as the films time theirs. How far the blow then falls short of the one
 * reacting (its hand or foot from their head, chest or hips, m), or null if the strike's motion is
 * not at hand.
 */
export function reactTo(store: Store, id: string, strikeId: string): number | null {
  const a = store.scene.animation;
  const act = a?.actions.find((x) => x.id === id);
  const strike = a?.actions.find((x) => x.id === strikeId);
  const src = strike?.source;
  const clip = src?.kind === 'clip' ? clipById(src.clip) : undefined;
  if (!act || !strike || !src || src.kind !== 'clip' || !clip) return null;
  const lands = strike.start + strikeTime(clip) / (src.speed ?? 1);
  moveAction(store, id, Math.max(0, lands - REACT_LEAD));
  const scene = store.scene;
  const striker = figurePoseAt(scene, strike.roles[0].figure, lands);
  const struck = figurePoseAt(scene, act.roles[0].figure, lands);
  if (!striker || !struck) return null;
  const rig = new Rig();
  try {
    const m = rig.model(striker);
    const hips = m.joints.hips.getWorldPosition(new THREE.Vector3());
    const ends = (['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const).map((j) => m.joints[j].getWorldPosition(new THREE.Vector3()));
    const blow = ends.reduce((p, q) => (Math.hypot(q.x - hips.x, q.z - hips.z) > Math.hypot(p.x - hips.x, p.z - hips.z) ? q : p));
    const them = rig.model(struck);
    return Math.min(...(['head', 'chest', 'hips'] as const).map((j) => them.joints[j].getWorldPosition(new THREE.Vector3()).distanceTo(blow)));
  } finally {
    rig.dispose();
  }
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
  if (patch.speed !== undefined && clip && !clip.loop) retime(store, id, (clip.duration * (act.source.repeat ?? 1)) / Math.min(4, Math.max(0.25, patch.speed)), key);
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

/** Move several of a figure's keys in time together; returns whether they moved. */
export function moveKeyframes(store: Store, figure: string, times: number[], by: number, key = '') {
  const before = store.scene.animation;
  store.updateScene((s) => {
    const a = s.animation && moveKeysBy(s.animation, figure, times, by);
    return a && a !== s.animation ? { ...s, animation: a } : s;
  }, key);
  store.setTime(store.getState().time);
  return store.scene.animation !== before;
}

/** How a figure's key at t goes on to the next: smoothly, at an even speed, or held until the next (`step`). */
export function setKeyframeEase(store: Store, figure: string, t: number, ease: 'smooth' | 'linear' | 'step') {
  store.updateScene((s) => (s.animation ? { ...s, animation: setKeyEase(s.animation, figure, t, ease) } : s));
  store.setTime(store.getState().time);
}

/** Hold a figure's key at t for `seconds` (a copy of it then; what comes after moves on). */
export function holdKeyframe(store: Store, figure: string, t: number, seconds: number) {
  store.updateScene((s) => (s.animation ? { ...s, animation: holdKeyFor(s.animation, figure, t, seconds) } : s));
  store.setTime(store.getState().time);
}

/** Play an action `times` times in all, one after another (what follows moves on). */
export function repeatAction(store: Store, id: string, times: number) {
  store.updateScene((s) => (s.animation ? { ...s, animation: repeatTrack(s.animation, id, times) } : s));
  store.setTime(store.getState().time);
}

/**
 * A keyed block kept in the Library (My motions) as a motion of its own, to give to any figure: its
 * keys from where it starts, made on its figure's proportions. Returns its name.
 */
export function saveKeysAsMotion(store: Store, id: string): string | null {
  const act = store.scene.animation?.actions.find((x) => x.id === id);
  const f = act && store.scene.figures.find((x) => x.id === act.roles[0].figure);
  if (!act || !f || act.source.kind !== 'keys' || act.layer || act.duration <= 1e-6) return null;
  const name = nextName(`${f.name}'s motion`, (store.getState().library.clips ?? []).map((c) => c.name));
  const part = act.source.clip.parts[0];
  saveMotion(store, { ...act.source.clip, id: uid('clip'), name, loop: false, duration: act.duration, parts: [{ ...part, name: f.name, body: { ...f.body } }] });
  return name;
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
    const next = patch.duration !== undefined ? setAnimDuration(s, patch.duration) : s;
    let a = next.animation!;
    if (patch.loop !== undefined) a = { ...a, loop: patch.loop };
    if (patch.fps !== undefined) a = { ...a, fps: Math.round(Math.min(60, Math.max(4, patch.fps))) };
    return { ...next, animation: a };
  }, 'anim-options');
  store.setTime(store.getState().time);
}

/** Shorten the animation to `duration` keeping its timing: what is past the new end goes (the length field scales instead). */
export function cutAnimation(store: Store, duration: number) {
  store.updateScene((s) => cutTo(s, Math.max(0.2, duration)), 'anim-options');
  store.setTime(store.getState().time);
}

/* Cameras: objects of the scene (lib/cameras.ts); shots film with them */

/** The playhead (on a frame; a still scene: 0), and its frame rate. */
function here(store: Store) {
  const a = store.scene.animation;
  return a ? { t: snapTime(a, store.getState().time), fps: a.fps } : { t: 0, fps: 24 };
}

/** A path camera of a scene, by id. */
const pathCamera = (s: Scene, id: string) => {
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
    if (cam.kind === 'rig') {
      const view = { position, target: look, fov, lens: fovLens(fov, frameAspect()), roll: 0 };
      return withCamera(s, { ...cam, rig: rigFrom(s, cam, view, t, cam.rig.body, { size: cam.rig.size, lens: Math.round(view.lens) }) });
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
      return withCamera(s, { ...cam, rig: { ...rig, size, ...(o.lens ? { lens: o.lens } : {}), ...(place && place !== 'center' ? { place } : {}) } });
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
export function editCamera(store: Store, id: string, patch: { name?: string; subject?: string; also?: string[]; anchor?: PathCamera['anchor']; aim?: PathCamera['aim']; ease?: PathCamera['ease']; shake?: number }) {
  store.updateScene((s) => {
    const old = cameraById(s, id);
    if (!old) return s;
    const { name, subject, also, anchor, aim, ease, shake } = patch;
    let cam: Camera = old;
    const who = { ...(subject !== undefined ? { subject: subject || undefined } : {}) };
    if (cam.kind === 'path') {
      const where = { ...who, ...(anchor ? { anchor } : {}), ...(aim ? { aim } : {}) };
      cam = Object.keys(where).length ? restate(s, cam, where) : cam;
      cam = { ...cam, ...(ease ? { ease } : {}) };
      if (cam.ease !== 'linear') delete cam.ease;
    } else cam = { ...cam, ...who };
    cam = { ...cam, ...(also ? { also } : {}), ...(shake !== undefined ? { shake } : {}), name: (name ?? cam.name).trim().slice(0, 60) || cam.name };
    if (!cam.subject) delete cam.subject;
    if (!cam.also?.length || !cam.subject) delete cam.also;
    if (!cam.shake) delete cam.shake;
    return withCamera(s, cam);
  }, `camera:${id}`);
}

/**
 * How a camera moves: along a path, or placing itself every frame from its subject, following it
 * or circling it (from where it is at the playhead). A rig turned into a path leaves points where
 * it went over the shots it films, every half second (a still scene: one).
 */
export function setCameraBody(store: Store, id: string, body: 'path' | CameraRig['body']) {
  const { t } = here(store);
  store.updateScene((s) => {
    const cam = cameraById(s, id);
    if (!cam || (body === 'path' ? cam.kind === 'path' : cam.kind === 'rig' && cam.rig.body === body)) return s;
    if (body !== 'path') {
      const keep = cam.kind === 'rig' ? { size: cam.rig.size, lens: cam.rig.lens, smooth: cam.rig.smooth } : {};
      return withCamera(s, reform(cam, { kind: 'rig', rig: rigFrom(s, cam, viewOf(s, cam, t), t, body, keep), ...(cam.shake ? { shake: cam.shake } : {}) }));
    }
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
export function editRig(store: Store, id: string, patch: Partial<Omit<CameraRig, 'body'>>, key = `rig:${id}`) {
  store.updateScene((s) => {
    const cam = cameraById(s, id);
    if (cam?.kind !== 'rig') return s;
    const rig: CameraRig = { ...cam.rig, ...patch };
    if (patch.yaw !== undefined) rig.yaw = wrapDeg(patch.yaw);
    if (patch.pitch !== undefined) rig.pitch = Math.min(89, Math.max(-89, patch.pitch));
    if (patch.smooth !== undefined) rig.smooth = Math.min(10, Math.max(0, patch.smooth));
    if (patch.lens !== undefined) rig.lens = Math.min(1200, Math.max(4, patch.lens));
    if (rig.place === 'center') delete rig.place;
    for (const k of ['turn', 'spin', 'toward', 'clear', 'smooth'] as const) if (!rig[k]) delete rig[k];
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
  const shell = reform(newCamera(s, live.subject ? { subject: live.subject } : {}), { kind: 'path', anchor: 'world', aim: 'point', points: [] }) as PathCamera;
  const cam: PathCamera = { ...shell, points: [capturePoint(s, shell, t, v.position, v.target, v.fov)] };
  store.updateScene((x) => {
    const a = x.animation;
    const withIt = { ...x, cameras: [...x.cameras, cam] };
    return a && film ? { ...withIt, animation: updateShot(a, spanAt(a, t).shot.id, { camera: cam.id }) } : withIt;
  });
  return cam.id;
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

function cover(store: Store, id: string, roles?: Record<string, string>): Record<string, string> | null {
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

/* Shots */

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

/** The project's settings: its frame shape (16:9, 9:16, 1:1, 2.39:1) and its render style. */
export function editProjectSettings(store: Store, patch: Partial<ProjectSettings>) {
  store.commit((lib) => ({ ...lib, settings: { ...projectSettingsOf(lib), ...patch } }));
}

/* Storyboard */

/** Put a scene in the story or leave it out of it (the storyboard and its exports). */
export function setInStory(store: Store, sceneId: string, inStory: boolean) {
  store.commit((lib) => ({ ...lib, scenes: lib.scenes.map((s) => (s.id !== sceneId ? s : inStory ? (({ offStory: _, ...rest }) => rest)(s) : { ...s, offStory: true })) }));
}

/** How long a still scene stays on screen in the story. */
export function setHold(store: Store, sceneId: string, hold: number) {
  store.commit((lib) => ({ ...lib, scenes: lib.scenes.map((s) => (s.id === sceneId ? { ...s, hold: Math.min(60, Math.max(0.2, hold)) } : s)) }), `hold:${sceneId}`);
}

/** What happens in a shot (`shot`) of any scene of the project, or in a still scene. */
export function setCaption(store: Store, sceneId: string, shot: string | null, caption: string) {
  const text = caption.slice(0, 500);
  store.commit((lib) => ({
    ...lib,
    scenes: lib.scenes.map((s) => {
      if (s.id !== sceneId) return s;
      if (shot && s.animation) return { ...s, animation: updateShot(s.animation, shot, { caption: text || undefined }) };
      const { caption: _old, ...rest } = s;
      void _old;
      return text ? { ...rest, caption: text } : rest;
    }),
  }), `caption:${sceneId}:${shot}`);
}

/* Library assets applied to the scene */

/** Put a library pose on a figure (it keeps its place and facing; keyed when animated). */
export function applyPose(store: Store, figureId: string, poseId: string) {
  const pose = allPoses(store.getState().library).find((p) => p.id === poseId);
  if (!pose) return false;
  store.updateFigure(figureId, (f) => (f.proxy ? f : withPose(f, pose)), '');
  return true;
}

/**
 * People posed from a photo, with a "Photo camera" looking as the photo did (straight on): in a
 * new scene, or (`figure`) the first on that figure, the others beside it as they stood in the
 * photo, as a pose from the library is applied (keyed at the playhead), in one undo step.
 */
export function applyPhotoPose(store: Store, figures: Figure[], figure?: string) {
  const photo = cameraFrom({ yaw: 0, pitch: 0, fov: 30 }, 'Photo camera');
  if (!figure) {
    appendScenes(store, [{ ...newScene('From photo', figures), cameras: [photo] }]);
    return;
  }
  const on = store.scene.figures.find((f) => f.id === figure);
  if (!on || on.proxy) return;
  const [first, ...rest] = figures;
  const [dx, dz] = [on.position[0] - first.position[0], on.position[2] - first.position[2]];
  store.group(() => {
    store.updateFigure(figure, (f) => ({ ...f, bones: first.bones }));
    store.updateScene((s) => {
      const had = s.cameras.find((c) => c.name === photo.name);
      return withCamera(s, had ? { ...photo, id: had.id } : photo);
    });
    if (rest.length) addFigures(store, rest.map((f) => ({ ...f, position: [f.position[0] + dx, f.position[1], f.position[2] + dz] })));
  });
}

/** Save a figure's pose to the library; returns the saved pose. */
export function savePose(store: Store, figureId: string, name: string) {
  const f = store.scene.figures.find((x) => x.id === figureId);
  if (!f) return null;
  const pose = poseFromFigure(f, name, angleAt(store.scene, store.getState().time));
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
 * A new scene that is a film from the start (#14): empty, a template, or a shoot preset (a template
 * and how to film it), `length` seconds long, filmed by the director (the preset's way, else one
 * that suits who is in it). Whether it was made.
 */
export function startFilm(store: Store, what: { template?: string; shoot?: string }, length: number): boolean {
  return store.group(() => {
    // (A shoot preset: its template, filmed its way if it can be, else as suits who is in it.)
    const preset = what.shoot ? shootsOf(store.getState().library).find((x) => x.id === what.shoot) : undefined;
    if (what.shoot) {
      if (!preset || !sceneFromTemplate(store, preset.template)) return false;
      store.updateScene((s) => ({ ...s, name: preset.name }));
    } else if (what.template) {
      if (!sceneFromTemplate(store, what.template)) return false;
    } else addScene(store);
    if (!store.scene.animation) startAnimation(store, length);
    store.updateScene((s) => fitted(s, length));
    const people = store.scene.figures.filter((f) => !f.hidden && !f.proxy).length;
    const fallback = people > 1 ? 'dialogue' : 'follow';
    if (!setDirector(store, preset?.coverage ?? fallback, preset && presetCast(store, preset))) setDirector(store, fallback);
    store.setTime(0);
    return true;
  });
}

/** A shoot preset (lib/templates.ts): its template as a new scene, filmed with its coverage. */
export function newShoot(store: Store, id: string) {
  return store.group(() => shoot(store, id));
}

function shoot(store: Store, id: string) {
  const p = shootsOf(store.getState().library).find((x) => x.id === id);
  const t = p && templatesOf(store.getState().library).find((x) => x.id === p.template);
  if (!p || !t) return false;
  addScene(store, { ...t.build(), name: p.name });
  if (!store.scene.animation) startAnimation(store, p.duration ?? 6);
  return !!cover(store, p.coverage, presetCast(store, p));
}

/** Who plays a shoot preset's coverage's roles in the scene just made from its template (its cast, if it says). */
function presetCast(store: Store, p: ShootPreset): Record<string, string> | undefined {
  const roles = coverageById(p.coverage)?.roles;
  const figures = store.scene.figures;
  if (!p.cast || !roles || p.cast.some((i) => !figures[i])) return undefined;
  return Object.fromEntries(roles.map((r, i) => [r, figures[p.cast![i]].id]));
}

/**
 * Put a template into the open scene, at the playhead: its first role taken by the active figure
 * (where it stands, facing its way), the next by the figures nearest it, new figures for the rest.
 * The figures it brings in or casts, by role.
 */
export function placeTemplate(store: Store, id: string, lead: string | null | undefined = store.getState().activeFigure, at?: Vec3, yaw = 0): string[] | null {
  const t = templatesOf(store.getState().library).find((x) => x.id === id);
  if (!t) return null;
  const built = t.build();
  const cast = lead && store.scene.figures.some((f) => f.id === lead) ? [lead, ...nearestPartners(store, lead, built.figures.length - 1)] : [];
  const before = new Set(store.scene.figures.map((f) => f.id));
  const t0 = store.scene.animation ? snapTime(store.scene.animation, store.getState().time) : 0;
  store.updateScene((s) => putTemplate(s, built, cast, t0, at, yaw));
  return [...cast, ...store.scene.figures.filter((f) => !before.has(f.id)).map((f) => f.id)];
}

/** Save the open scene as a template in the library (its cast, set, actions and light). */
export function saveTemplate(store: Store, name: string) {
  const t = asTemplate(store.scene, name.trim().slice(0, 80) || store.scene.name);
  store.commit((lib) => ({ ...lib, templates: [...(lib.templates ?? []), t] }));
  return t;
}

/** Delete one of my templates, and my shoot presets that film it (their names). */
export function deleteTemplate(store: Store, id: string): string[] {
  const gone = (store.getState().library.shoots ?? []).filter((p) => p.template === id).map((p) => p.name);
  store.commit((lib) => {
    const templates = (lib.templates ?? []).filter((t) => t.id !== id);
    const shoots = (lib.shoots ?? []).filter((p) => p.template !== id);
    const { templates: _t, shoots: _s, ...rest } = lib;
    void [_t, _s];
    return { ...rest, ...(templates.length ? { templates } : {}), ...(shoots.length ? { shoots } : {}) };
  });
  return gone;
}

/** Keep a shoot preset of my own: a template filmed with a coverage (and, for a still template, for how long). */
export function saveShoot(store: Store, p: Omit<ShootPreset, 'id'>): ShootPreset {
  const preset: ShootPreset = { ...p, id: uid('shoot'), name: p.name.trim().slice(0, 80) || 'Shoot' };
  store.commit((lib) => ({ ...lib, shoots: [...(lib.shoots ?? []), preset] }));
  return preset;
}

/** The open scene, filmed with a coverage, kept as a template and a shoot preset filming it so, in one step. */
export function saveAsShoot(store: Store, name: string): ShootPreset | null {
  const s = store.scene;
  if (!s.coverage) return null;
  const coverage = s.coverage.id;
  return store.group(() => {
    const t = saveTemplate(store, name);
    return saveShoot(store, { name, template: t.id, coverage, ...(s.animation ? {} : { duration: 6 }) });
  });
}

export function deleteShoot(store: Store, id: string) {
  store.commit((lib) => {
    const shoots = (lib.shoots ?? []).filter((p) => p.id !== id);
    const { shoots: _old, ...rest } = lib;
    void _old;
    return shoots.length ? { ...rest, shoots } : rest;
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

/** Draw a figure as a character (null: the mannequin), the mannequin under it fitted to the character's build. */
export function setFigureModel(store: Store, figureId: string, model: string | null) {
  store.updateFigure(figureId, (f) => {
    const { model: _old, ...rest } = f;
    void _old;
    if (!model) return rest;
    return { ...rest, model, body: bodyFor(f, model) };
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

/** The figures nearest to one (posable ones, shown), nearest first: the cast of a template around it. */
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
 * Play a motion from the waist up over what a figure is doing at the playhead (waving while
 * walking): an upper-body action. False if it cannot (a walk).
 */
export function applyUpperBody(store: Store, figureId: string, motionId: string) {
  const mine = store.getState().library.clips?.some((c) => c.id === motionId);
  // (A motion from the Library, or one of those prop menus put on, as carrying.)
  const motion = [...MOTIONS, ...HANDLING].find((m) => m.id === motionId);
  if (!mine && (!motion || motion.travel)) return false;
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
 * (the scene is animated if it is not yet). A motion is one person's (several people's are made
 * by giving each their own). Returns false if it cannot.
 */
export function applyMotion(store: Store, figureId: string, motionId: string) {
  const start = store.scene.animation ? store.getState().time : 0;
  // (An imported clip: one of my motions, or the local motion library's, at hand.)
  if (store.getState().library.clips?.some((c) => c.id === motionId) || hasClip(motionId)) {
    if ((clipById(motionId)?.parts.length ?? 1) > 1) return false;
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
  store.updateScene((s) => insertClip(s, [figureId], BUILT_IN + motion.id, start));
  store.setTime(start);
  return true;
}

/* Several things at once (a selection of many) */

/** What is selected, as lists of whole figures and props (a joint: its figure). */
export function selectedThings(sel: Selection): { figures: string[]; props: string[] } {
  if (sel?.kind === 'many') return { figures: sel.figures, props: sel.props };
  if (sel?.kind === 'figure' || sel?.kind === 'joint') return { figures: [sel.figure], props: [] };
  if (sel?.kind === 'prop') return { figures: [], props: [sel.prop] };
  return { figures: [], props: [] };
}

/** Add a figure or a prop to what is selected, or take it away (Shift-click): one left is selected alone. */
export function toggleSelected(store: Store, thing: { figure: string } | { prop: string }) {
  const { figures, props } = selectedThings(store.getState().selection);
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const f = 'figure' in thing ? flip(figures, thing.figure) : figures;
  const p = 'prop' in thing ? flip(props, thing.prop) : props;
  if (f.length + p.length > 1) store.select({ kind: 'many', figures: f, props: p });
  else if (f.length) store.select({ kind: 'figure', figure: f[0] });
  else if (p.length) store.select({ kind: 'prop', prop: p[0] });
  else store.select(null);
}

/** Delete several figures and props (one undo step); the scene keeps at least one figure. How many went. */
export function deleteMany(store: Store, figures: string[], props: string[]) {
  const keep = store.scene.figures.filter((f) => !figures.includes(f.id));
  const gone = keep.length ? figures : figures.slice(1);
  store.updateScene((s) => ({
    ...s,
    figures: s.figures.filter((f) => !gone.includes(f.id)),
    props: s.props.filter((p) => !props.includes(p.id)).map((p) => (p.hold && gone.includes(p.hold.figure) ? released(p, s) : p)),
  }));
  store.select(null);
  return gone.length + props.length;
}

/** Copies of several figures and props, beside them (one undo step), selected together. */
export function duplicateMany(store: Store, figures: string[], props: string[]) {
  const before = { figures: new Set(store.scene.figures.map((f) => f.id)), props: new Set(store.scene.props.map((p) => p.id)) };
  /** The id a duplicate added to a list (none if nothing was added). */
  const added = <T extends { id: string }>(list: () => T[], copy: () => void) => {
    const n = list().length;
    copy();
    return list().length > n ? list()[list().length - 1].id : null;
  };
  store.group(() => {
    // Copies beside the originals, all moved alike (as a figure's copy is), so the group keeps its layout.
    const copyOf = new Map<string, string>();
    for (const id of figures) {
      const copy = added(() => store.scene.figures, () => duplicateFigure(store, id));
      if (copy) copyOf.set(id, copy);
    }
    for (const id of props) {
      const src = store.scene.props.find((p) => p.id === id);
      const copy = src && added(() => store.scene.props, () => duplicateProp(store, id));
      if (!src || !copy) continue;
      const holder = src.hold && copyOf.get(src.hold.figure);
      store.updateScene((s) => {
        // In the copy of the hand that held it, held as the original is (not a second one in the original's hand).
        if (holder && src.hold) {
          return { ...s, props: s.props.map((x) => (x.id === copy ? { ...x, position: src.position, rotation: src.rotation, scale: src.scale, hold: { ...src.hold!, figure: holder } } : x)) };
        }
        // (Held by someone not copied: as a single copy of it is.)
        if (src.hold) return s;
        return { ...s, props: s.props.map((x) => (x.id === copy ? { ...x, position: [src.position[0] + 0.8, src.position[1], src.position[2]] as Vec3 } : x)) };
      });
    }
  });
  store.select({ kind: 'many', figures: store.scene.figures.filter((f) => !before.figures.has(f.id)).map((f) => f.id), props: store.scene.props.filter((p) => !before.props.has(p.id)).map((p) => p.id) });
}

/* Steps from the keyboard (#13): small moves and turns of what is selected, at the playhead */

/** Move a figure across the floor (and, off the floor, up or down) by a step; keyed at the playhead in an animated scene. */
export function stepFigure(store: Store, id: string, dx: number, dz: number, dy = 0) {
  store.updateFigure(id, (f) => {
    const moved = withPosition(f, f.position[0] + dx, f.position[2] + dz);
    return dy && !f.grounded ? { ...moved, position: [moved.position[0], Math.max(0, moved.position[1] + dy), moved.position[2]] } : moved;
  }, `step:${id}`);
}

/** Turn a figure about itself by a step (degrees, + to its left). */
export function turnFigure(store: Store, id: string, by: number) {
  store.updateFigure(id, (f) => withFacing(f, facing(f) + by), `step:${id}`);
}

/** Move a prop by a step (one in a hand goes with the hand: not moved). */
export function stepProp(store: Store, id: string, dx: number, dz: number, dy = 0) {
  store.updateProp(id, (p) => (p.hold ? p : { ...p, position: [p.position[0] + dx, Math.max(0, p.position[1] + dy), p.position[2] + dz] }), `step:${id}`);
}

/** Turn a prop about its own up axis by a step (degrees). */
export function turnProp(store: Store, id: string, by: number) {
  store.updateProp(id, (p) => (p.hold ? p : { ...p, rotation: [p.rotation[0], wrapDeg(p.rotation[1] + by), p.rotation[2]] }), `step:${id}`);
}

/** Move several figures and props together by a step, or turn them about their middle (one undo step). */
export function stepMany(store: Store, figures: string[], props: string[], move: { dx: number; dz: number } | { turn: number }) {
  const s = store.scene;
  const spots = [
    ...s.figures.filter((f) => figures.includes(f.id)).map((f) => f.position),
    ...s.props.filter((p) => props.includes(p.id) && !p.hold).map((p) => p.position),
  ];
  if (!spots.length) return;
  const [cx, cz] = [spots.reduce((a, p) => a + p[0], 0) / spots.length, spots.reduce((a, p) => a + p[2], 0) / spots.length];
  const place = (x: number, z: number): [number, number] => {
    if ('dx' in move) return [x + move.dx, z + move.dz];
    const r = (move.turn * Math.PI) / 180;
    const [ox, oz] = [x - cx, z - cz];
    return [cx + ox * Math.cos(r) + oz * Math.sin(r), cz - ox * Math.sin(r) + oz * Math.cos(r)];
  };
  store.group(() => {
    for (const id of figures) {
      store.updateFigure(id, (f) => {
        const [x, z] = place(f.position[0], f.position[2]);
        const moved = withPosition(f, x, z);
        return 'turn' in move ? withFacing(moved, facing(moved) + move.turn) : moved;
      });
    }
    for (const id of props) {
      store.updateProp(id, (p) => {
        if (p.hold) return p;
        const [x, z] = place(p.position[0], p.position[2]);
        return { ...p, position: [x, p.position[1], z], rotation: 'turn' in move ? [p.rotation[0], wrapDeg(p.rotation[1] + move.turn), p.rotation[2]] : p.rotation };
      });
    }
  });
}

/**
 * Move whole performances across the floor (#13: a track offset, without a key): everything
 * `figures` do, and those they share an action with, moved by (dx, dz) and turned by `turn`
 * degrees about where they are at the playhead (or `about`). In a still scene: the figures themselves. Returns
 * the figures moved.
 */
export function offsetPerformance(store: Store, figures: string[], move: { dx?: number; dz?: number; turn?: number; about?: [number, number] }, key = ''): string[] {
  const s = store.scene;
  const a = s.animation;
  const ids = a ? partnersOf(a, figures) : figures;
  const spots = s.figures.filter((f) => ids.includes(f.id)).map((f) => f.position);
  if (!spots.length) return [];
  const { dx = 0, dz = 0, turn = 0 } = move;
  if (!a) {
    store.group(() => {
      if (dx || dz) stepMany(store, ids, [], { dx, dz });
      if (turn) stepMany(store, ids, [], { turn });
    });
    return ids;
  }
  const about = move.about ?? [spots.reduce((t, p) => t + p[0], 0) / spots.length, spots.reduce((t, p) => t + p[2], 0) / spots.length];
  // The track only: the figures are posed from it again (an edit to them would key them here). (One
  // added since it was animated holds its pose on a track of its own first.)
  store.updateScene((x) => (x.animation ? { ...x, animation: restage(normalize(x.animation, x.figures), ids, { dx, dz, turn, about }) } : x), key);
  store.setTime(store.getState().time);
  return ids;
}

/** Turn one of a joint's sliders by a step (degrees), kept to its limits when they are on. */
export function stepJoint(store: Store, figure: string, joint: JointName, axis: number, by: number) {
  const f = store.scene.figures.find((x) => x.id === figure);
  if (!f) return null;
  const v = angle(f.bones, joint);
  const next: Vec3 = [...v];
  // Within the joint's limits; without them it goes round (as a drag does).
  if (store.getState().settings.limits) {
    const [lo, hi] = jointLimits(joint)[axis];
    next[axis] = Math.min(hi, Math.max(lo, v[axis] + by));
  } else next[axis] = wrapDeg(v[axis] + by);
  setJoint(store, figure, joint, next, `step:${figure}:${joint}:${axis}`);
  return next[axis];
}

/**
 * Move or turn a path camera by a step at the playhead (a point there, made if there is none):
 * across, in and out, up and down (metres, as it looks), and panned or tilted (degrees).
 */
export function stepCamera(store: Store, id: string, step: { right?: number; forward?: number; up?: number; pan?: number; tilt?: number }) {
  const cam = cameraById(store.scene, id);
  if (!cam || cam.kind !== 'path') return;
  const view = viewOf(store.scene, cam, store.scene.animation ? store.getState().time : 0);
  const dir = view.target.clone().sub(view.position);
  const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
  const right = new THREE.Vector3().crossVectors(flat, new THREE.Vector3(0, 1, 0)).normalize();
  const shift = right.multiplyScalar(step.right ?? 0).add(flat.clone().multiplyScalar(step.forward ?? 0)).add(new THREE.Vector3(0, step.up ?? 0, 0));
  const position = view.position.clone().add(shift);
  let look = dir.clone();
  if (step.pan) look.applyAxisAngle(new THREE.Vector3(0, 1, 0), (-step.pan * Math.PI) / 180);
  if (step.tilt) look.applyAxisAngle(new THREE.Vector3().crossVectors(look, new THREE.Vector3(0, 1, 0)).normalize(), (step.tilt * Math.PI) / 180);
  look = position.clone().add(look);
  const { t, fps } = here(store);
  // Its roll stays.
  store.updateScene((s) => {
    const c = pathCamera(s, id);
    return c ? withCamera(s, setPointAt(c, fps, t, { ...capturePoint(s, c, t, position, look, view.fov), ...(view.roll ? { roll: view.roll } : {}) })) : s;
  }, `step:${id}`);
}
