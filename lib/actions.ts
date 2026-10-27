import * as THREE from 'three';
import { cloneHand } from './hands';
import { sided, wrapDeg } from './joints';
import {
  NEUTRAL_ANGLES, duplicateScene, mirrorFigure, mirrorScene, newFigure, newProp, newScene, symmetrize, uid, withPosture,
} from './doc';
import { DEFAULT_HOLD, boardPanels, insertPanel, movePanel, newPanel, withBoard } from './board';
import { newAnimation, setDuration as setAnimDuration, snapTime } from './animation';
import { BUILT_IN } from './assets';
import { keysClip, partKeys } from './clip';
import { actionsOf, figurePoseAt, sceneAt } from './evaluate';
import { handPosition, propKeyTimes, putPropKey, rimOf, setPropKey, shiftPropTrack, throwTime, worldOfProp } from './propmotion';
import { addTravel, insertClip, keyAtTime, keyTimesOf, moments, moveKeyTo, moveMarkTo, removeKeyAt, ripple, setPoseAt, setTravelMode, travelInto } from './track';
import { RIM } from './props';
import { groundOf } from './surfaces';
import { JUMP_PREP, flightTime } from './locomotion';
import { MOTIONS } from './motions';
import { allPoses, poseFromFigure, withPose } from './poses';
import {
  Rig, atDistance, backToBack, besides, contactPoint, contactSpot, distance, faceEachOther, headPoint, inFrontOf, lookAt, reach, turnTowards,
  facing, forward, leftward, withFacing, withPosition, type Contact,
} from './relations';
import { CAMERA_MOVES, shotAt } from './shot';
import { bonesOf, withAngles, type Angles } from './pose';
import { cutAt, keysInShot, removeCut, spanAt, updateShot } from './shots';
import type { Store } from './store';
import { HANDHELD, PROP_LABELS } from './types';
import { grip, held, released } from './hold';
import type { Action, Animation, CameraKey, CameraTrack, Clip, Constraint, Figure, Hand, JointName, Light, Panel, Pose, Posture, Prop, PropKey, PropKind, Scene, Side, Travel, Vec3, View } from './types';

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

/** A prop as it is at the playhead (in whose hand, where), not where it was put at the start. */
export function propNow(store: Store, id: string): Prop | undefined {
  const s = store.scene;
  const p = (s.animation ? sceneAt(s, store.getState().time).props : s.props).find((x) => x.id === id);
  if (!p) return undefined;
  const { trail: _, ...prop } = p;
  void _;
  return prop;
}

/**
 * Throw a prop from the hand holding it at the playhead: to a floor point, into a figure's hand
 * (caught there; into the thrower's own hand it is tossed up two metres, as a gymnast's hoop), or
 * through a basketball hoop (it drops through the rim to the floor). It flies under gravity; the
 * hands are wherever the figures have them at those moments. The playhead goes to where it lands.
 */
export function throwProp(store: Store, id: string, target: { at: [number, number] } | { figure: string; hand: Side } | { hoop: string; miss?: boolean }) {
  if (!store.scene.animation) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
  const scene = store.scene;
  const a = scene.animation!;
  const prop = propNow(store, id);
  if (!prop?.hold) return null;
  let t0 = snapTime(a, store.getState().time);
  // A shot is shot: the ball up in front of the face, then the arm up and out to the hoop, and a
  // follow-through; the other hand at the ball's side until it goes. It takes a moment to gather
  // (after a dribble, say): the ball goes then.
  let anim0 = a;
  const shooter = scene.figures.find((f) => f.id === prop.hold!.figure);
  if ('hoop' in target && shooter) {
    const [hand, other]: [Side, Side] = prop.hold.hand === 'R' ? ['R', 'L'] : ['L', 'R'];
    const s = hand === 'L' ? 1 : -1;
    const frame = 1 / a.fps;
    // After the shooter's last key and the ball's (a catch, say), so neither is overwritten.
    const before = [...keyTimesOf(a, shooter.id), ...propKeyTimes(a, id)].filter((t) => t < t0 + 1e-6).sort((p, q) => p - q).at(-1);
    if (before !== undefined) t0 = Math.min(60, Math.max(t0, Math.round((before + 16 * frame) * a.fps) / a.fps));
    const shot: [number, Angles][] = [
      [t0 - 8 * frame, { [sided('UpperArm', hand)]: [-110, 0, 20 * s], [sided('LowerArm', hand)]: [-100, 0, 0], [sided('UpperArm', other)]: [-70, 0, -10 * s], [sided('LowerArm', other)]: [-90, 0, 0] }],
      [t0, { [sided('UpperArm', hand)]: [-155, 0, 10 * s], [sided('LowerArm', hand)]: [-15, 0, 0], [sided('UpperArm', other)]: [-95, 0, -20 * s], [sided('LowerArm', other)]: [-60, 0, 0] }],
      [t0 + 8 * frame, { [sided('UpperArm', hand)]: [-145, 0, 10 * s], [sided('LowerArm', hand)]: [-20, 0, 0], [sided('UpperArm', other)]: [-75, 0, -20 * s], [sided('LowerArm', other)]: [-50, 0, 0] }],
    ];
    const onFrame = (t: number) => Math.round(t * a.fps) / a.fps;
    const times = shot.map(([t]) => onFrame(t));
    // Long enough for the follow-through (keys are kept within the animation).
    anim0 = { ...anim0, duration: Math.min(60, Math.max(anim0.duration, times[2])) };
    // Its keys and marks in the middle of the shot (the end of a run, say) hold the ball up too.
    for (const t of moments(a, shooter.id)) {
      if (t > times[0] + 1e-6 && t < times[2] - 1e-6 && !times.some((x) => Math.abs(x - t) < 1e-6)) anim0 = keyJoints(scene, anim0, shooter, t, shot[t < times[1] ? 0 : 1][1]);
    }
    for (const [i, [, joints]] of shot.entries()) if (times[i] >= 0 && times[i] <= 60) anim0 = keyJoints(scene, anim0, shooter, times[i], joints);
  }
  const posedScene = { ...scene, animation: anim0 };
  const at = (fid: string, t: number) => figurePoseAt(posedScene, fid, t);
  const from = worldOfProp(posedScene, id, at, t0);
  if (!from) return null;
  let to: Vec3;
  let end: Omit<PropKey, 't'>;
  // After a shot: where it bounces on (each a hop to a point, rising so high), then it rests.
  let hops: { at: Vec3; rise: number }[] = [];
  if ('at' in target) {
    const [x, z] = target.at;
    to = [Math.round(x * 1000) / 1000, groundOf(scene.props, id)(x, z), Math.round(z * 1000) / 1000];
    end = { position: to, rotation: from.rotation, throw: true };
  } else if ('hoop' in target) {
    const hoop = scene.props.find((p) => p.id === target.hoop && p.kind === 'hoop');
    if (!hoop) return null;
    const rim = rimOf(hoop);
    const r = prop.scale[1] / 2;
    const d = Math.hypot(rim[0] - from.position[0], rim[2] - from.position[2]) || 1;
    const [dx, dz] = [(rim[0] - from.position[0]) / d, (rim[2] - from.position[2]) / d];
    const ground = groundOf(scene.props, id);
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    /** A floor point `k` metres on from (x, z) the way it flew. */
    const on = (x: number, z: number, k: number): Vec3 => [r3(x + dx * k), ground(x + dx * k, z + dz * k), r3(z + dz * k)];
    if (target.miss) {
      // Off the front of the rim: back out towards the shooter, bouncing on the floor.
      const front = RIM.radius * hoop.scale[0] + r * 0.6;
      to = [r3(rim[0] - dx * front), r3(rim[1] - r * 0.5), r3(rim[2] - dz * front)];
      const first = on(to[0], to[2], -1.6);
      hops = [{ at: first, rise: 0.5 }, { at: on(first[0], first[2], -0.6), rise: 0.3 }, { at: on(first[0], first[2], -0.9), rise: 0.1 }];
    } else {
      // Its centre through the rim's centre (a prop's place is its base), down through the net and a couple of bounces.
      to = [rim[0], r3(rim[1] - r), rim[2]];
      const below = on(rim[0], rim[2], 0.05);
      hops = [{ at: below, rise: 0 }, { at: on(below[0], below[2], 0.35), rise: 0.4 }, { at: on(below[0], below[2], 0.55), rise: 0.12 }];
    }
    end = { position: to, rotation: from.rotation, throw: true };
  } else {
    const catcher = at(target.figure, t0);
    if (!catcher) return null;
    to = handPosition(catcher, target.hand, scene.props);
    const g = grip(prop.kind, target.hand, catcher.body.height);
    end = { position: g.position, rotation: g.rotation, hold: { ...target }, throw: true };
  }
  const toss = 'figure' in target && target.figure === prop.hold.figure;
  const t1 = Math.min(60, Math.round((t0 + throwTime(from.position, to, toss ? 2 : undefined)) * a.fps) / a.fps);
  // A shot bounces on: the animation runs on until it is down.
  const after: { t: number; key: Omit<PropKey, 't'> }[] = [];
  let last = { t: t1, at: to };
  for (const h of hops) {
    const t = Math.round((last.t + throwTime(last.at, h.at, h.rise)) * a.fps) / a.fps;
    if (t > 60) break;
    after.push({ t, key: { position: h.at, rotation: from.rotation, throw: true } });
    last = { t, at: h.at };
  }
  const settled = Math.min(60, last.t + (after.length ? 0.4 : 0));
  store.updateScene((s) => {
    if (!s.animation) return s;
    const free = { ...prop, position: from.position, rotation: from.rotation, hold: undefined };
    let anim = setPropKey(anim0, t0, free, { release: true }, prop);
    anim = shiftPropTrack(anim, id, t0, last.t - t0);
    anim = putPropKey(anim, t1, id, end);
    for (const k of after) anim = putPropKey(anim, k.t, id, k.key);
    return {
      ...s,
      animation: { ...anim, duration: Math.min(60, Math.max(anim.duration, settled)) },
    };
  });
  store.setTime(t1);
  store.select({ kind: 'prop', prop: id });
  return { from: t0, to: t1 };
}

/**
 * Dribble a ball from the hand holding it at the playhead, `bounces` times, half a second each:
 * the arm pushes it down, it bounces off the floor under the hand (between where the hand is as
 * it lets go and as it meets it again, so it works on the run) and the hand meets it on the way up
 * and rides it to the top before pushing again. The arm is keyed (inside a walk or run: waypoints
 * that pose the upper body). The playhead goes to the end.
 */
export function dribbleProp(store: Store, id: string, bounces = 4) {
  if (!store.scene.animation) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
  const scene = store.scene;
  const a = scene.animation!;
  const prop = propNow(store, id);
  const hold = prop?.hold;
  const holder = scene.figures.find((f) => f.id === hold?.figure);
  if (!prop || !hold || !holder) return null;
  const t0 = snapTime(a, store.getState().time);
  const from = worldOfProp(scene, id, (fid, t) => figurePoseAt(scene, fid, t), t0);
  if (!from) return null;
  const frame = 1 / a.fps;
  // In frames of a bounce: let go (arm down), off the floor, met by the hand, at the top.
  const [P, FLOOR, MEET, TOP] = [12, 4, 7, 9].map((n) => n * frame);
  const t1 = Math.min(60, t0 + bounces * P);
  const g = grip(prop.kind, hold.hand, holder.body.height);
  const ground = groundOf(scene.props, id);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const s = hold.hand === 'L' ? 1 : -1;
  const arm = (up: boolean): Angles => ({
    [sided('UpperArm', hold.hand)]: up ? [-20, 0, 24 * s] : [-32, 0, 22 * s],
    [sided('LowerArm', hold.hand)]: up ? [-62, 0, 0] : [-10, 0, 0],
  });
  // The arm first: where the hand is depends on it.
  let anim = a;
  for (let i = 0; i < bounces; i++) {
    for (const [t, up] of [[t0 + i * P, false], [t0 + i * P + TOP, true]] as const) {
      if (t <= 60) anim = keyJoints(scene, anim, holder, t, arm(up));
    }
  }
  const armed = { ...scene, animation: anim };
  const at = (fid: string, t: number) => figurePoseAt(armed, fid, t);
  store.updateScene((sc) => {
    if (!sc.animation) return sc;
    const free = { ...prop, position: from.position, rotation: from.rotation, hold: undefined };
    let next = setPropKey(anim, t0, free, { release: true }, prop);
    next = shiftPropTrack(next, id, t0, t1 - t0);
    for (let i = 0; i < bounces; i++) {
      const out = t0 + i * P;
      if (out + MEET > 60) break;
      const h0 = handPosition(at(hold.figure, out)!, hold.hand, sc.props);
      const h1 = handPosition(at(hold.figure, out + MEET)!, hold.hand, sc.props);
      // Out to the side of the legs and a little ahead.
      const body = at(hold.figure, out + FLOOR)!;
      const [lx, lz] = leftward(body);
      const [fx, fz] = forward(body);
      const side = 0.22 * s;
      const [x, z] = [r3((h0[0] + h1[0]) / 2 + lx * side + fx * 0.12), r3((h0[2] + h1[2]) / 2 + lz * side + fz * 0.12)];
      if (i) next = putPropKey(next, out, id, { position: h0, rotation: from.rotation, release: true });
      next = putPropKey(next, out + FLOOR, id, { position: [x, ground(x, z), z], rotation: from.rotation });
      next = putPropKey(next, out + MEET, id, { position: g.position, rotation: g.rotation, hold: { ...hold } });
    }
    return {
      ...sc,
      animation: { ...next, duration: Math.min(60, Math.max(next.duration, t1)) },
    };
  });
  store.setTime(t1);
  store.select({ kind: 'prop', prop: id });
  return { from: t0, to: t1 };
}

/**
 * Key some of a figure's joints at a time, the rest as they are then (inside a walk, run or clip:
 * a correction posing the upper body on the way).
 */
function keyJoints(scene: Scene, a: Animation, f: Figure, t: number, joints: Angles): Animation {
  const at = { ...scene, animation: a.duration < t ? { ...a, duration: Math.min(60, t) } : a };
  const p = figurePoseAt(at, f.id, t)!;
  const pose: Pose = { bones: withAngles(p.bones, joints), position: p.position, hands: p.hands, grounded: p.grounded };
  return setPoseAt(at, f.id, t, pose);
}

/** Put a prop in a figure's hand (it closes into a grip), or (null) let it go onto the floor. */
export function holdProp(store: Store, id: string, to: { figure: string; hand: Side } | null) {
  // Animated: letting go at the playhead drops it from the hand; it falls under gravity.
  const scene = store.scene;
  const current = scene.props.find((p) => p.id === id);
  if (!to && scene.animation && current?.hold) {
    const t = snapTime(scene.animation, store.getState().time);
    const from = worldOfProp(scene, id, (fid, at) => figurePoseAt(scene, fid, at), t);
    if (!from) return;
    store.updateScene((s) => {
      if (!s.animation) return s;
      const free = { ...current, position: from.position, rotation: from.rotation, hold: undefined };
      return { ...s, props: s.props.map((p) => (p.id === id ? free : p)), animation: setPropKey(s.animation, t, free, { release: true }, current) };
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
    const doing = actionsOf(anim, a).find((x) => x.start <= t + 1e-6 && t < x.start + x.duration - 1e-6);
    const end = doing ? doing.start + doing.duration : anim.duration;
    const hold: Constraint = { id: uid('hold'), figure: a, bone: sided('Hand', side) as Constraint['bone'], target: { figure: b, ...spot }, start: t, end: end > t ? end : anim.duration };
    store.updateScene((sc) => (sc.animation ? { ...sc, animation: { ...sc.animation, constraints: [...(sc.animation.constraints ?? []), hold] } } : sc));
    return reached;
  } finally {
    rig.dispose();
  }
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
    // On frames, inside the shot (a key a hair before a cut would belong to the shot before).
    const keys = move.keys(local, s.view).map((k) => ({ ...k, t: Math.min(span.end, Math.max(span.start, Math.round((k.t + span.start) * a.fps) / a.fps)) }));
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

export function editShot(store: Store, id: string, patch: { name?: string; caption?: string; subject?: string }) {
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

/** Keep an imported motion in the library (My motions). */
export function saveMotion(store: Store, clip: Clip) {
  store.commit((lib) => ({ ...lib, clips: [...(lib.clips ?? []), clip] }));
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
 * Give a figure a motion from the library (built in, or one of mine), starting at the playhead
 * (the scene is animated if it is not yet). A motion of several people goes on this figure (the
 * lead: the first part) and `partners` (by default the nearest figures), who take their places
 * around it, walking there first if there is time. Returns false if it cannot (a set-up with its
 * own props, or too few figures).
 */
export function applyMotion(store: Store, figureId: string, motionId: string, partners?: string[]) {
  const start = store.scene.animation ? store.getState().time : 0;
  if (store.getState().library.clips?.some((c) => c.id === motionId)) {
    store.updateScene((s) => insertClip(s, [figureId], motionId, start));
    store.setTime(start);
    return true;
  }
  const motion = MOTIONS.find((m) => m.id === motionId);
  if (!motion || motion.setUp) return false;
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
