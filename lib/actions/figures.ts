import * as THREE from 'three';
import { cloneHand } from '../hands';
import { sided } from '../joints';
import { newFigure, nextName, withPosture, uid, NEUTRAL_ANGLES, mirrorFigure, symmetrize } from '../doc';
import { snapTime, newAnimation, MAX_DURATION } from '../animation';
import { partKeys } from '../clip';
import { actionsOf, figurePoseAt } from '../evaluate';
import { handlesOf, localBounds } from '../props';
import { restage, addTravel } from '../track';
import { legsOf } from '../locomotion';
import LIBRARY_INDEX from '../../public/motions/index.json';
import { seatAt } from '../sets';
import { withFacing, facing, withPosition, turnTowards, faceEachOther, besides, backToBack, inFrontOf, distance, atDistance, Rig, headPoint, lookAt, type Contact, contactPoint, reach, contactSpot } from '../relations';
import { bonesOf, withAngles } from '../pose';
import type { Store } from '../store';
import { released } from '../hold';
import { FINGER_BONES, type Vec3, type Posture, type Figure, type Animation, type Action, type Side, type JointName, type Hand, type Constraint, type Scene } from '../types';
import { here } from './timeline';

/* Figures: posing, placing and naming them, how they stand to each other, and holding on (lib/constraints.ts). */

/** Where a new figure goes unless told: beside the existing ones. */
export function besideFigures(store: Store, gap: number): Vec3 {
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

/** Whether a figure has idle life in the gaps of an animated scene (breathing, shifting, glances), or holds still. */
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

/** A hand's preset (its curl and spread): its fingers posed by it, not bone by bone any more (a captured motion's). */
export function setHand(store: Store, side: Side, hand: Hand, key = '') {
  const fingers = (b: string) => b.startsWith(side === 'L' ? 'left' : 'right') && (FINGER_BONES as readonly string[]).includes(b);
  store.updateActiveFigure((f) => ({ ...f, hands: { ...f.hands, [side]: cloneHand(hand) }, bones: Object.fromEntries(Object.entries(f.bones).filter(([b]) => !fingers(b))) }), key);
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
/** Move / turn a figure on the floor (any of x, z, facing yaw). */
export function setPlacement(store: Store, id: string, p: { x?: number; z?: number; yaw?: number }, key = '') {
  store.updateFigure(id, (f) => {
    let next = f;
    if (p.x !== undefined || p.z !== undefined) next = withPosition(next, p.x ?? f.position[0], p.z ?? f.position[2]);
    if (p.yaw !== undefined) next = withFacing(next, p.yaw);
    return next;
  }, key);
}

type Arrangement = 'face' | 'faceEachOther' | 'besideL' | 'besideR' | 'backToBack' | 'inFront';

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

/** Sitting: what a figure plays down onto a seat, there, and back up (the Library's motions). */
const SIT = { down: 'library:stand-to-sit', idle: 'library:sitting-idle', up: 'library:sit-to-stand' };
const SITTING = ['library:stand-to-sit', 'library:sitting-idle', 'library:sitting-talking', 'library:sit-to-type'];

/** A Library motion's entry in its index: how long it is, and where it takes its person (in leg lengths). */
function course(id: string) {
  return (LIBRARY_INDEX as unknown as { id: string; duration: number; move: [number, number] }[]).find((m) => m.id === id)!;
}

/**
 * Sit on a chair or a stool from the playhead (#14): the figure walks to the front of it, turns its
 * back to it and sits down onto it, then sits there (its hips a little forward of the seat's
 * middle). The playhead goes to where it sits. Whether it could.
 */
export function sitOn(store: Store, figureId: string, propId: string) {
  const chair = store.scene.props.find((p) => p.id === propId);
  if (!chair || chair.hold || (chair.kind !== 'chair' && chair.kind !== 'stool')) return false;
  // (A chair is sat on facing the way it does; a stool, with the back to it from where the figure is.)
  return sitDown(store, figureId, [chair.position[0], chair.position[2]], chair.kind === 'chair' ? chair.rotation[1] : null);
}

/** Sit on a set's seat under (x, z) (lib/sets.ts seatAt: a chair at a table faces it), as on a chair. Whether there was one, and it could. */
export function sitAt(store: Store, figureId: string, x: number, z: number) {
  const f = figurePoseAt(store.scene, figureId, store.getState().time) ?? store.scene.figures.find((g) => g.id === figureId);
  const seat = f && seatAt(store.scene.set, x, z, [f.position[0], f.position[2]]);
  return !!seat && sitDown(store, figureId, seat.at, seat.facing);
}

/**
 * Walk to the front of a seat (its middle `seat`), turn and sit down onto it facing `facing`
 * (null: with the back to it from where the figure is), then sit there.
 */
function sitDown(store: Store, figureId: string, middle: [number, number], facing: number | null) {
  const f = store.scene.figures.find((x) => x.id === figureId);
  if (!f) return false;
  if (!store.scene.animation) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
  const here = figurePoseAt(store.scene, figureId, store.getState().time) ?? f;
  const way = facing ?? (Math.atan2(here.position[0] - middle[0], here.position[2] - middle[1]) * 180) / Math.PI;
  const r = (way * Math.PI) / 180;
  const ahead: [number, number] = [Math.sin(r), Math.cos(r)];
  const seat: [number, number] = [middle[0] + ahead[0] * 0.1, middle[1] + ahead[1] * 0.1];
  const legs = legsOf(f.body).rootY;
  const down = course(SIT.down);
  // (Where it stands to sit down: as far in front of the seat as sitting down takes it back.)
  const back = -down.move[1] * legs;
  const front: [number, number] = [seat[0] + ahead[0] * back, seat[1] + ahead[1] * back];
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const walked = addTravel(store.scene, figureId, store.getState().time, front, 'walk');
  if (!walked) return false;
  const a = walked.animation;
  const at = (x: [number, number]) => ({ at: [r3(x[0]), r3(x[1])] as [number, number], facing: Math.round(way * 10) / 10 || 0 });
  const clipAction = (clip: string, start: number, duration: number, end: [number, number]): Action => ({
    id: uid('act'), start, duration, blendIn: 0.25, roles: [{ figure: figureId, end: at(end) }], source: { kind: 'clip', clip },
  });
  const t1 = walked.to;
  const turned = clipAction('library:idle', t1, 0.6, front);
  const sits = clipAction(SIT.down, t1 + 0.6, snapTime({ ...a, duration: MAX_DURATION }, down.duration), seat);
  const stays = clipAction(SIT.idle, sits.start + sits.duration, 4, seat);
  const end = stays.start + stays.duration;
  store.updateScene((s) => ({ ...s, animation: { ...a, actions: [...a.actions, turned, sits, stays].sort((p, q) => p.start - q.start), duration: Math.min(MAX_DURATION, Math.max(a.duration, end)) } }));
  void store.loadClips();
  store.setTime(stays.start);
  store.select({ kind: 'figure', figure: figureId });
  return true;
}

/** Whether a figure is sitting at t (playing one of the Library's sitting motions). */
export function sittingAt(scene: Scene, figureId: string, t: number) {
  const a = scene.animation;
  return !!a && a.actions.some((x) => !x.layer && x.source.kind === 'clip' && SITTING.includes(x.source.clip) && x.roles.some((r) => r.figure === figureId) && x.start <= t && t < x.start + x.duration);
}

/** Get up from where a figure sits, at the playhead: what it was doing sitting ends there, and it stands up, stepping forward. */
export function standUp(store: Store, figureId: string) {
  const a = store.scene.animation;
  const t = a ? snapTime(a, store.getState().time) : 0;
  const sitting = (x: Action) => !x.layer && x.source.kind === 'clip' && SITTING.includes(x.source.clip) && x.roles.some((r) => r.figure === figureId);
  const act = a?.actions.filter((x) => sitting(x) && x.start <= t && t < x.start + x.duration).sort((p, q) => q.start - p.start)[0];
  const f = store.scene.figures.find((x) => x.id === figureId);
  if (!a || !act || !f) return false;
  // (Its sitting on after it, there, goes: sitting down, then sitting there, all one sit.)
  const gone = new Set<string>();
  for (let end = act.start + act.duration, next; (next = a.actions.find((x) => sitting(x) && !gone.has(x.id) && x.id !== act.id && Math.abs(x.start - end) < 1.5 / a.fps)); end = next.start + next.duration) gone.add(next.id);
  const seat = act.roles[0].end ?? { at: [f.position[0], f.position[2]] as [number, number], facing: 0 };
  const up = course(SIT.up);
  const r = (seat.facing * Math.PI) / 180;
  const step = up.move[1] * legsOf(f.body).rootY;
  const stood: [number, number] = [Math.round((seat.at[0] + Math.sin(r) * step) * 1000) / 1000, Math.round((seat.at[1] + Math.cos(r) * step) * 1000) / 1000];
  const rise: Action = { id: uid('act'), start: t, duration: snapTime({ ...a, duration: MAX_DURATION }, up.duration), blendIn: 0.2, roles: [{ figure: figureId, end: { at: stood, facing: seat.facing } }], source: { kind: 'clip', clip: SIT.up } };
  // (What it does later starts once it is up.)
  const later = a.actions.filter((x) => !x.layer && !gone.has(x.id) && x.roles.some((rr) => rr.figure === figureId) && x.start >= t + 1e-6);
  const shift = Math.max(0, rise.start + rise.duration - Math.min(Infinity, ...later.map((x) => x.start)));
  const actions = a.actions.filter((x) => !gone.has(x.id)).map((x) => (x.id === act.id ? { ...x, duration: Math.max(1 / a.fps, t - x.start) } : later.includes(x) ? { ...x, start: x.start + shift } : x));
  const end = Math.max(a.duration, rise.start + rise.duration, ...actions.map((x) => x.start + x.duration));
  store.updateScene((s) => ({ ...s, animation: { ...a, actions: [...actions, rise].sort((p, q) => p.start - q.start), duration: Math.min(MAX_DURATION, end) } }));
  void store.loadClips();
  store.setTime(rise.start + rise.duration);
  return true;
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
