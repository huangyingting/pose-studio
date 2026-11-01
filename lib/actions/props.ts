import { wrapDeg } from '../joints';
import { newProp, nextName, uid } from '../doc';
import { newAnimation, snapTime, MAX_DURATION, propKeyOf } from '../animation';
import { clipById, BUILT_IN } from '../assets';
import { sceneAt, propStretchesOf, CATCH_LEAD, UPPER_EASE, arrivalAt, settledAt, propWorldAt } from '../evaluate';
import { putPropKey, setPropKey, physicsOf } from '../propmotion';
import { forward } from '../relations';
import type { Store } from '../store';
import { PROP_LABELS, HANDHELD } from '../types';
import { held, released } from '../hold';
import type { PropKind, Vec3, Side, Prop, PropTarget, Action } from '../types';
import { besideFigures } from './figures';

/* Props: adding, placing and holding them, and what they do over time. */

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
