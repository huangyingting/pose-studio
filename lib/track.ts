import { keyPose, keysClip, partKeys, setPartKey } from './clip';
import { clipById } from './assets';
import { newAnimation, snapTime } from './animation';
import { actionPoseAt, actionsOf, basePoseAt, correctionOf, figurePoseAt, marksOf } from './evaluate';
import { JUMP_PREP, jumpHeight, legsOf, travelTime } from './locomotion';
import { facingOf, turnBones } from './pose';
import { uid } from './uid';
import { wrapDeg } from './joints';
import { shiftPropTrack } from './propmotion';
import type { Action, ActionSource, Animation, Mark, Pose, Scene, Travel } from './types';

/*
 * Editing figures' tracks: their actions in time. Keys are set where the figure is keyed (or a
 * hand edit goes on a correction over a clip or a travel), actions are put in, moved and
 * retimed, and a figure's actions after a time move along with an edit (a pause put in or
 * taken out). Nothing here touches another figure's track, except actions done together.
 */

const EPS = 1e-6;
/** How long a clip takes to blend in from the pose before it (s). */
const BLEND = 0.2;
const end = (a: Action) => a.start + a.duration;
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
const markOf = (p: Pose): Mark => ({ at: [r3(p.position[0]), r3(p.position[2])], facing: Math.round(facingOf(p.bones) * 10) / 10 || 0 });
const keysOf = (act: Action) => (act.source.kind === 'keys' ? partKeys(act.source.clip.parts[0]).map((k) => ({ t: act.start + k.t, pose: k.pose })) : []);
const isKeys = (act: Action) => act.source.kind === 'keys' && !act.layer;
const clipOfKeys = (act: Action) => (act.source as Extract<ActionSource, { kind: 'keys' }>).clip;

/** A keys action holding these poses (times in the animation), from the first to the last. */
export function keysAction(figure: string, keys: { t: number; pose: Pose }[], layer?: Action['layer']): Action {
  const start = keys[0].t;
  const clip = keysClip(keys.map((k) => ({ t: k.t - start, pose: k.pose })));
  return { id: uid('act'), start, duration: clip.duration, roles: [{ figure }], source: { kind: 'keys', clip }, ...(layer ? { layer } : {}) };
}

const replace = (a: Animation, old: Action, next: Action[]): Animation => ({ ...a, actions: [...a.actions.filter((x) => x !== old), ...next] });
const sorted = (a: Animation): Animation => ({ ...a, actions: [...a.actions].sort((p, q) => p.start - q.start || p.duration - q.duration) });
const longer = (a: Animation, t: number): Animation => (t > a.duration ? { ...a, duration: Math.min(60, t) } : a);

/** Times of a figure's keys (in its keys actions). */
export function keyTimesOf(a: Animation, figure: string): number[] {
  return actionsOf(a, figure).filter(isKeys).flatMap((x) => keysOf(x).map((k) => Math.round(k.t * 1e6) / 1e6));
}

/** The figure's keys action holding a key at t, and the key's index. */
export function keyAtTime(a: Animation, figure: string, t: number) {
  const tol = 0.5 / a.fps;
  for (const act of actionsOf(a, figure).filter(isKeys)) {
    const i = keysOf(act).findIndex((k) => Math.abs(k.t - t) < tol);
    if (i >= 0) return { act, i };
  }
  return null;
}

/* ---------- keying ---------- */

/**
 * The figure posed so at time t (auto-key): a key in the keys action there; over a clip or a
 * travel, a correction; at the end of one, a new held pose there (the mark it goes to moves with
 * it); between actions, a key on the keys before (or a new held pose).
 */
export function setPoseAt(scene: Scene, figure: string, time: number, pose: Pose): Animation {
  const a = scene.animation!;
  const tol = 0.5 / a.fps;
  const t = snapTime(a, time);
  const acts = actionsOf(a, figure);
  // Over an upper-body action, what is seen is that action: an edit there corrects it.
  const upper = actionsOf(a, figure, 'upper').find((x) => x.start < t && t < end(x));
  if (upper) return correct(scene, figure, upper, t, pose);
  const keyed = acts.find((x) => isKeys(x) && x.start - tol <= t && t <= end(x) + tol);
  if (keyed) {
    const clip = clipOfKeys(keyed);
    const local = Math.min(keyed.duration, Math.max(0, t - keyed.start));
    const part = setPartKey(clip.parts[0], local, pose, tol);
    return syncMarks(scene, replace(a, keyed, [{ ...keyed, source: { kind: 'keys', clip: { ...clip, parts: [part] } } }]), figure);
  }
  const ending = acts.find((x) => Math.abs(end(x) - t) < tol);
  if (ending) return syncMarks(scene, sorted({ ...a, actions: [...a.actions, keysAction(figure, [{ t: end(ending), pose }])] }), figure);
  const over = acts.find((x) => x.start < t && t < end(x));
  if (over) return correct(scene, figure, over, t, pose);
  const prev = acts.filter((x) => end(x) < t).at(-1);
  if (prev && isKeys(prev)) {
    const keys = [...keysOf(prev), { t, pose }];
    return sorted(replace(a, prev, [{ ...keysAction(figure, keys), id: prev.id }]));
  }
  return sorted({ ...a, actions: [...a.actions, keysAction(figure, [{ t, pose }])] });
}

/** A hand edit over a clip or a travel: a key on the figure's correction there (starting and ending at no change). */
function correct(scene: Scene, figure: string, over: Action, t: number, pose: Pose): Animation {
  const a = scene.animation!;
  const tol = 0.5 / a.fps;
  const base = basePoseAt(scene, figure, t)!;
  const delta = correctionOf(base, pose);
  const fix = actionsOf(a, figure, 'correction').find((x) => x.start - tol <= t && t <= end(x) + tol);
  if (fix) {
    const keys = [...keysOf(fix).filter((k) => Math.abs(k.t - t) >= tol), { t, pose: delta }].sort((p, q) => p.t - q.t);
    return replace(a, fix, [{ ...keysAction(figure, keys, 'correction'), id: fix.id }]);
  }
  const none = correctionOf(delta, delta);
  const keys = [{ t: over.start, pose: none }, { t, pose: delta }, { t: end(over), pose: none }];
  return sorted({ ...a, actions: [...a.actions, keysAction(figure, keys, 'correction')] });
}

/**
 * Marks follow keys: a walk, run, jump or clip that ends where keys begin ends on their first key
 * (moving that key moves the mark it goes to).
 */
function syncMarks(scene: Scene, a: Animation, figure: string): Animation {
  const acts = actionsOf(a, figure);
  let out = a;
  for (const [i, x] of acts.entries()) {
    const next = acts[i + 1];
    if (isKeys(x) || x.layer || !next || !isKeys(next) || Math.abs(next.start - end(x)) > EPS) continue;
    const want = markOf(keyPose(clipOfKeys(next).parts[0], 0));
    const now = marksOf({ ...scene, animation: out }, x, figure)?.end;
    if (now && Math.hypot(now.at[0] - want.at[0], now.at[1] - want.at[1]) < 0.002 && Math.abs(wrapDeg(now.facing - want.facing)) < 0.2) continue;
    out = replace(out, x, [{ ...x, roles: x.roles.map((r) => (r.figure === figure ? { ...r, end: want } : r)) }]);
  }
  return sorted(out);
}

/** Remove a figure's key at t (an action left without keys goes; the figure keeps one). */
export function removeKeyAt(a: Animation, figure: string, t: number): Animation {
  const hit = keyAtTime(a, figure, t);
  if (!hit) return a;
  const keys = keysOf(hit.act).filter((_, i) => i !== hit.i);
  if (!keys.length) return actionsOf(a, figure).length > 1 ? replace(a, hit.act, []) : a;
  return sorted(replace(a, hit.act, [{ ...keysAction(figure, keys), id: hit.act.id }]));
}

/** Retime a figure's key (refused onto another key, or past the actions around its own). */
export function moveKeyTo(a: Animation, figure: string, from: number, to: number): Animation {
  const hit = keyAtTime(a, figure, from);
  const time = snapTime(a, to);
  if (!hit || keyAtTime(a, figure, time)) return a;
  const keys = keysOf(hit.act).map((k, i) => (i === hit.i ? { ...k, t: time } : k)).sort((p, q) => p.t - q.t);
  const next = { ...keysAction(figure, keys), id: hit.act.id };
  const others = actionsOf(a, figure).filter((x) => x !== hit.act);
  if (others.some((x) => x.start < end(next) - EPS && end(x) > next.start + EPS)) return a;
  return sorted(replace(a, hit.act, [next]));
}

/**
 * Move everything of a figure from time `from` on by `by` seconds (its keys there and after, and
 * its actions starting then or later): a pause put in or taken out. Actions done together move
 * for everyone in them. (Several figures: each moved once.)
 */
export function ripple(a: Animation, figure: string | string[], from: number, by: number): Animation {
  const who = typeof figure === 'string' ? [figure] : figure;
  const shift = (t: number) => Math.min(60, Math.round((t + by) * a.fps) / a.fps);
  const actions = a.actions.map((x) => {
    if (!x.roles.some((r) => who.includes(r.figure))) return x;
    if (x.source.kind === 'keys' && x.start < from - EPS && end(x) >= from - EPS) {
      const keys = keysOf(x).map((k) => (k.t >= from - EPS ? { ...k, t: shift(k.t) } : k));
      return { ...keysAction(x.roles[0].figure, keys, x.layer), id: x.id };
    }
    return x.start >= from - EPS ? { ...x, start: shift(x.start) } : x;
  });
  const last = Math.max(a.duration, ...actions.map(end));
  return sorted({ ...a, actions, duration: Math.min(60, last) });
}

/**
 * Move what figures do from `from` on by `by`, and what happens in step with it: someone whose
 * action starts just as one of the moving actions ends (a relay runner off as the baton comes in)
 * comes along from then, and so on down the line; a prop keyed then (the baton changing hands)
 * too. `ends`: more moments that move (where an action that was retimed ended).
 */
export function rippleInStep(a: Animation, figures: string[], from: number, by: number, ends: number[] = []): Animation {
  const half = 0.5 / a.fps;
  const since = new Map(figures.map((f) => [f, from]));
  const props = new Map<string, number>();
  const at = (t: number, u: number) => Math.abs(t - u) < half;
  // An action moves when it starts once one of its people is moving.
  const moves = (x: Action) => x.roles.some((r) => since.has(r.figure) && x.start >= since.get(r.figure)! - half);
  for (let grew = true; grew;) {
    grew = false;
    // The moments that move: where the moving actions end (a held pose of no length is no moment).
    const moments = [...ends, ...a.actions.filter((x) => !x.layer && x.duration > half && moves(x)).map(end)];
    for (const t of moments) {
      for (const x of a.actions) {
        if (x.layer || x.source.kind === 'keys' || !at(x.start, t)) continue;
        for (const r of x.roles) if (!since.has(r.figure) || since.get(r.figure)! > t + half) { since.set(r.figure, t); grew = true; }
      }
      for (const [id, keys] of Object.entries(a.props ?? {})) if (keys.some((k) => at(k.t, t)) && (props.get(id) ?? Infinity) > t + half) props.set(id, t);
    }
  }
  // Each action moved once (one done by several moves for all of them).
  const shift = (t: number) => Math.min(60, Math.round((t + by) * a.fps) / a.fps);
  const actions = a.actions.map((x) => {
    if (x.source.kind === 'keys' && x.roles.length === 1 && since.has(x.roles[0].figure)) {
      const t0 = since.get(x.roles[0].figure)! - half;
      if (x.start < t0 && end(x) >= t0) return { ...keysAction(x.roles[0].figure, keysOf(x).map((k) => (k.t >= t0 ? { ...k, t: shift(k.t) } : k)), x.layer), id: x.id };
    }
    return moves(x) ? { ...x, start: shift(x.start) } : x;
  });
  let out = sorted({ ...a, actions, duration: Math.min(60, Math.max(a.duration, ...actions.map(end))) });
  for (const [id, t] of props) out = shiftPropTrack(out, id, t - half, by);
  return out;
}

/**
 * Split a figure's keys at t: the keys action there gets a key at t (as it is then), and its keys
 * after t become an action of their own. Returns the animation and that later action, if any.
 */
function splitAt(scene: Scene, figure: string, t: number): { a: Animation; after: Action | null } {
  const a = scene.animation!;
  const act = actionsOf(a, figure).find((x) => isKeys(x) && x.start - EPS <= t && t <= end(x) + EPS);
  if (!act) return { a, after: null };
  const keys = keysOf(act);
  const here = actionPoseAt(scene, act, figure, t)!;
  const before = [...keys.filter((k) => k.t < t - EPS), { t, pose: here }];
  const later = keys.filter((k) => k.t > t + EPS);
  const after = later.length ? keysAction(figure, later) : null;
  return { a: sorted(replace(a, act, [{ ...keysAction(figure, before), id: act.id }, ...(after ? [after] : [])])), after };
}

/** Play a clip from the waist up over what a figure is doing (waving while walking), from `start`. */
export function addUpper(scene: Scene, figure: string, clipId: string, start: number): Animation | null {
  const clip = clipById(clipId);
  if (!clip || !scene.animation) return null;
  const a = scene.animation;
  const t0 = snapTime(a, start);
  // A motion that loops goes on as long as what the figure does under it (a lap at least).
  const under = clip.loop ? actionsOf(a, figure).filter((x) => x.start <= t0 + 1e-6 && end(x) > t0).at(-1) : undefined;
  const length = Math.max(clip.duration, under ? end(under) - t0 : 0);
  const act: Action = { id: uid('act'), start: t0, duration: Math.min(60 - t0, length), layer: 'upper', roles: [{ figure }], source: { kind: 'clip', clip: clipId } };
  return longer(sorted({ ...a, actions: [...a.actions, act] }), t0 + act.duration);
}

/** Times of a figure's correction keys (not the no-change keys a correction starts and ends with). */
export function correctionTimesOf(a: Animation, figure: string): number[] {
  return actionsOf(a, figure, 'correction').flatMap((x) => keysOf(x).slice(1, -1).map((k) => k.t));
}

/** Remove a figure's correction key at t (a correction left without changes goes). */
export function removeCorrectionAt(a: Animation, figure: string, t: number): Animation {
  const tol = 0.5 / a.fps;
  for (const x of actionsOf(a, figure, 'correction')) {
    const keys = keysOf(x);
    const i = keys.findIndex((k, n) => Math.abs(k.t - t) < tol && n > 0 && n < keys.length - 1);
    if (i < 0) continue;
    const rest = keys.filter((_, n) => n !== i);
    return rest.length > 2 ? replace(a, x, [{ ...keysAction(figure, rest, 'correction'), id: x.id }]) : replace(a, x, []);
  }
  return a;
}

/* ---------- travel ---------- */

/**
 * Walk, run or jump a figure from where it is at time t to `to`: a travel action, its later
 * actions moved on by the time it takes. (Inside a clip or another travel, it sets off when that
 * ends.) Walking and running face the way they go unless `strafe`; a jump keeps the facing.
 */
export function addTravel(scene: Scene, figure: string, t: number, to: [number, number], mode: Travel, opts: { strafe?: boolean; height?: number } = {}): { animation: Animation; from: number; to: number } | null {
  let a = scene.animation!;
  const f = scene.figures.find((x) => x.id === figure);
  if (!f) return null;
  let t0 = snapTime(a, t);
  const busy = actionsOf(a, figure).find((x) => !isKeys(x) && x.start < t0 - EPS && t0 < end(x) - EPS);
  if (busy) t0 = Math.round(end(busy) * a.fps) / a.fps;
  a = longer(a, t0);
  a = splitAt({ ...scene, animation: a }, figure, t0).a;
  const here = figurePoseAt({ ...scene, animation: a }, figure, t0)!;
  const d = Math.hypot(to[0] - here.position[0], to[1] - here.position[2]);
  const heading = Math.atan2(to[0] - here.position[0], to[1] - here.position[2]) * (180 / Math.PI);
  const facing = facingOf(here.bones);
  const sideways = opts.strafe && d > 0.05 ? Math.abs(Math.sin((heading - facing) * (Math.PI / 180))) : 0;
  const t1 = Math.round((t0 + travelTime(mode, d, f.body, opts.height, sideways)) * a.fps) / a.fps;
  const yaw = mode === 'jump' || opts.strafe || d < 0.05 ? facing : heading;
  a = ripple(a, figure, t0 + 0.5 / a.fps, t1 - t0);
  // What it did from then on (a walk starting then) comes after it.
  a = { ...a, actions: a.actions.map((x) => (!x.layer && !isKeys(x) && x.roles.some((r) => r.figure === figure) && Math.abs(x.start - t0) < EPS ? { ...x, start: t1 } : x)) };
  const travel: Action = {
    id: uid('act'), start: t0, duration: t1 - t0,
    roles: [{ figure, end: { at: [r3(to[0]), r3(to[1])], facing: Math.round(wrapDeg(yaw) * 10) / 10 || 0 } }],
    source: { kind: 'travel', mode, ...(opts.strafe ? { strafe: true } : {}) },
  };
  return { animation: longer(sorted({ ...a, actions: [...a.actions, travel] }), t1), from: t0, to: t1 };
}

/** The travel arriving at time t (it ends then), or null. */
export function travelInto(a: Animation, figure: string, t: number): Action | null {
  return actionsOf(a, figure).find((x) => x.source.kind === 'travel' && Math.abs(end(x) - t) < 0.5 / a.fps) ?? null;
}

/**
 * How a figure gets to where it is at time t (a key, or the end of a travel): walking, running,
 * jumping, or (null) gliding there as keyed.
 */
export function setTravelMode(scene: Scene, figure: string, t: number, mode: Travel | null, patch: { strafe?: boolean; spin?: number; flip?: number } = {}): Animation {
  const a = scene.animation!;
  const tr = travelInto(a, figure, t);
  if (tr && tr.source.kind === 'travel') {
    if (!mode) {
      // Gliding: the keys there are glided to; with none, the figure is keyed where it arrived.
      const arrival = figurePoseAt(scene, figure, end(tr))!;
      const next = actionsOf(a, figure).find((x) => isKeys(x) && Math.abs(x.start - end(tr)) < EPS);
      return sorted(replace(a, tr, next ? [] : [keysAction(figure, [{ t: end(tr), pose: arrival }])]));
    }
    const src = { ...tr.source, mode, ...patch };
    for (const k of ['strafe', 'spin', 'flip'] as const) if (!src[k]) delete src[k];
    if (mode !== 'jump') { delete src.spin; delete src.flip; } else delete src.via;
    return replace(a, tr, [{ ...tr, source: src }]);
  }
  if (!mode) return a;
  // A key reached by gliding: from the key before it (or where the figure was) it travels there instead.
  const hit = keyAtTime(a, figure, t);
  if (!hit) return a;
  const keys = keysOf(hit.act);
  const target = keys[hit.i];
  let next = a;
  let start: number;
  if (hit.i > 0) {
    start = keys[hit.i - 1].t;
    next = replace(next, hit.act, [{ ...keysAction(figure, keys.slice(0, hit.i)), id: hit.act.id }, keysAction(figure, keys.slice(hit.i))]);
  } else {
    const prev = actionsOf(a, figure).filter((x) => end(x) <= hit.act.start + EPS && x !== hit.act).at(-1);
    if (!prev) return a;
    start = end(prev);
  }
  if (target.t - start < 1 / a.fps) return a;
  const travel: Action = {
    id: uid('act'), start, duration: target.t - start, roles: [{ figure, end: markOf(target.pose) }],
    source: { kind: 'travel', mode, ...(patch.strafe ? { strafe: true } : {}), ...(mode === 'jump' && patch.spin ? { spin: patch.spin } : {}), ...(mode === 'jump' && patch.flip ? { flip: patch.flip } : {}) },
  };
  return sorted({ ...next, actions: [...next.actions, travel] });
}

/**
 * Move a figure's mark at t to another floor point: where its travel or clip ending then goes (a
 * clip of several people takes them all along, as a formation), or where its key then puts it.
 */
export function moveMarkTo(scene: Scene, figure: string, t: number, to: [number, number]): Animation {
  const a = scene.animation!;
  const act = actionsOf(a, figure).find((x) => !isKeys(x) && x.source.kind !== 'keys' && Math.abs(end(x) - t) < 0.5 / a.fps);
  const hit = keyAtTime(a, figure, t);
  let out = a;
  if (act) {
    const was = act.roles.find((r) => r.figure === figure)!.end ?? marksOf(scene, act, figure)!.end;
    const [dx, dz] = [to[0] - was.at[0], to[1] - was.at[1]];
    const roles = act.roles.map((r) => {
      const m = r.end ?? marksOf(scene, act, r.figure)!.end;
      return { ...r, end: { ...m, at: [r3(m.at[0] + dx), r3(m.at[1] + dz)] as [number, number] } };
    });
    out = replace(out, act, [{ ...act, roles }]);
  }
  if (hit) {
    const keys = keysOf(hit.act).map((k, i) => (i === hit.i ? { ...k, pose: { ...k.pose, position: [r3(to[0]), k.pose.position[1], r3(to[1])] as Pose['position'] } } : k));
    out = sorted(replace(out, hit.act, [{ ...keysAction(figure, keys), id: hit.act.id }]));
  }
  return out;
}

/* ---------- actions ---------- */

/**
 * Retime an action to last `duration`: a clip plays faster or slower (one that loops goes round
 * more or fewer times), a walk takes longer, hand keys spread out. What everyone in it does after
 * moves on by the difference.
 */
export function retimeAction(a: Animation, id: string, duration: number): Animation {
  const act = a.actions.find((x) => x.id === id);
  if (!act) return a;
  const d = Math.max(1, Math.round(duration * a.fps)) / a.fps;
  const by = d - act.duration;
  if (Math.abs(by) < EPS) return a;
  let next: Action = { ...act, duration: d };
  const src = act.source;
  if (src.kind === 'clip') {
    const clip = clipById(src.clip);
    if (clip && !clip.loop) next = { ...next, source: { ...src, speed: Math.round((clip.duration / d) * 1000) / 1000 } };
  } else if (src.kind === 'keys') {
    const k = d / Math.max(EPS, act.duration);
    const keys = keysOf(act).map((x) => ({ t: snapTime({ ...a, duration: 60 }, act.start + (x.t - act.start) * k), pose: x.pose }));
    next = { ...keysAction(act.roles[0].figure, keys, act.layer), id: act.id, duration: d };
  }
  const moved = rippleInStep(a, act.roles.map((r) => r.figure), end(act), by, [end(act)]);
  return longer(sorted(replace(moved, moved.actions.find((x) => x.id === id)!, [next])), end(next));
}

/** What an action is called on the timeline and in the inspector: the motion's name, or how the figure gets there. */
export function actionLabel(act: Action): string {
  const src = act.source;
  if (src.kind === 'keys') return act.layer === 'correction' ? 'Correction' : 'Posed';
  if (src.kind === 'clip') return clipById(src.clip)?.name ?? 'Motion';
  let label = src.mode === 'walk' ? 'Walk' : src.mode === 'run' ? 'Run' : 'Jump';
  if (src.mode === 'jump') {
    label += ` ${jumpHeight(Math.max(0, act.duration - 2 * JUMP_PREP)).toFixed(1)} m`;
    if (src.spin) label += ` · ${src.spin === 0.5 ? '½' : src.spin} turn${Math.abs(src.spin) > 1 ? 's' : ''}`;
    if (src.flip) label += src.flip > 0 ? ' · front flip' : ' · back flip';
  } else if (src.strafe) label += ' · keep facing';
  return label;
}

/** How long an action takes to blend in from what was before it (s). */
export function setBlendIn(a: Animation, id: string, blendIn: number): Animation {
  const act = a.actions.find((x) => x.id === id);
  if (!act) return a;
  const b = Math.round(Math.min(2, Math.max(0, blendIn)) * 100) / 100;
  const { blendIn: _old, ...rest } = act;
  void _old;
  return replace(a, act, [b > 0 ? { ...rest, blendIn: b } : rest]);
}

/**
 * Give a role of an action of several people to another figure: one already in it swaps places;
 * anyone else gives way on their track for it, and the one who had the role is left out.
 */
export function recast(scene: Scene, id: string, index: number, figure: string): Animation {
  let a = scene.animation!;
  const act = a.actions.find((x) => x.id === id);
  if (!act || !act.roles[index] || act.roles[index].figure === figure) return a;
  const other = act.roles.findIndex((r) => r.figure === figure);
  const roles = act.roles.map((r, i) => (i === index ? { ...r, figure } : i === other ? { ...r, figure: act.roles[index].figure } : r));
  if (other < 0) a = clear({ ...scene, animation: a }, figure, act.start, end(act));
  return sorted({ ...a, actions: [...a.actions.filter((x) => x.id !== id), { ...act, roles }] });
}

/* ---------- clips ---------- */

/**
 * Put a clip on figures' tracks at `start`: `cast` names the figure taking each of its parts (the
 * first leads). What they had keyed in that time gives way; partners who are elsewhere walk to
 * their places in it first (or, short of time, are put there). The animation is created or
 * lengthened as needed.
 */
export function insertClip(scene: Scene, cast: string[], clipId: string, start: number): Scene {
  const clip = clipById(clipId);
  if (!clip || cast.length > clip.parts.length || new Set(cast).size < cast.length || cast.some((id) => !scene.figures.some((f) => f.id === id))) return scene;
  let a: Animation = scene.animation ?? { ...newAnimation(scene, Math.max(0.2, start + clip.duration)), loop: clip.loop && start === 0 };
  const t0 = snapTime({ ...a, duration: 60 }, start);
  const t1 = Math.min(60, Math.round((t0 + clip.duration) * a.fps) / a.fps);
  a = longer(a, t1);
  for (const id of cast) a = clear({ ...scene, animation: a }, id, t0, t1);
  let s: Scene = { ...scene, animation: a };
  // Where the partners go: placed around the lead as in the clip, spaced for the biggest of them.
  const lead = figurePoseAt(s, cast[0], t0)!;
  const firsts = clip.parts.map((p) => keyPose(p, 0));
  const by = facingOf(lead.bones) - facingOf(firsts[0].bones);
  const size = Math.max(...cast.map((id, n) => legsOf(scene.figures.find((f) => f.id === id)!.body).rootY / legsOf(clip.parts[n].body ?? scene.figures.find((f) => f.id === id)!.body).rootY));
  for (const [n, id] of cast.entries()) {
    if (!n) continue;
    const off = turn((firsts[n].position[0] - firsts[0].position[0]) * size, (firsts[n].position[2] - firsts[0].position[2]) * size, by);
    const spot: Mark = { at: [r3(lead.position[0] + off[0]), r3(lead.position[2] + off[1])], facing: Math.round(wrapDeg(facingOf(firsts[n].bones) + by) * 10) / 10 };
    s = { ...s, animation: goTo(s, id, spot, t0) };
  }
  const act: Action = { id: uid('act'), start: t0, duration: t1 - t0, blendIn: BLEND, roles: cast.map((figure) => ({ figure })), source: { kind: 'clip', clip: clipId } };
  return { ...s, animation: sorted({ ...s.animation!, actions: [...s.animation!.actions, act] }) };
}

function turn(x: number, z: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) + z * Math.sin(r), -x * Math.sin(r) + z * Math.cos(r)];
}

/** Make room on a figure's track from t0 to t1: keys there go (one is kept at t0), actions starting there go, ones running into it end at t0. */
function clear(scene: Scene, figure: string, t0: number, t1: number): Animation {
  const split = splitAt(scene, figure, t0);
  let a = split.a;
  for (const x of actionsOf(a, figure)) {
    if (x.start < t0 - EPS && end(x) > t0 + EPS) a = replace(a, x, [{ ...x, duration: t0 - x.start }]);
    else if (x.start > t0 + EPS && x.start < t1 - EPS) {
      if (isKeys(x)) {
        const later = keysOf(x).filter((k) => k.t >= t1 - EPS);
        a = replace(a, x, later.length ? [{ ...keysAction(figure, later), id: x.id }] : []);
      } else a = replace(a, x, []);
    }
  }
  for (const x of actionsOf(a, figure, 'correction')) if (x.start < t1 && end(x) > t0) a = replace(a, x, []);
  return sorted(a);
}

/**
 * Get a figure to a spot by time t: walking there (if it is elsewhere and there is time; facing
 * the way it goes or, to go backwards or sideways, its partner), or else put there.
 */
function goTo(scene: Scene, figure: string, spot: Mark, t: number): Animation {
  const a = scene.animation!;
  const f = scene.figures.find((x) => x.id === figure)!;
  const here = figurePoseAt(scene, figure, t)!;
  const d = Math.hypot(spot.at[0] - here.position[0], spot.at[1] - here.position[2]);
  if (d < 0.05 && Math.abs(wrapDeg(spot.facing - facingOf(here.bones))) < 5) return a;
  const acts = actionsOf(a, figure).filter((x) => x.start < t - EPS || (isKeys(x) && x.start <= t + EPS));
  const prev = acts.at(-1);
  const free = Math.max(...actionsOf(a, figure).filter((x) => x.start < t - EPS).map(end), 0);
  const heading = Math.atan2(spot.at[0] - here.position[0], spot.at[1] - here.position[2]) * (180 / Math.PI);
  const off = Math.abs(wrapDeg(heading - spot.facing));
  const strafe = off > 90;
  const side = strafe ? Math.abs(Math.sin((off * Math.PI) / 180)) : 0;
  // Walking, leaving in time to get there (briskly, if short of time; side steps can be quick);
  // well short of time for walking ahead, running (at once, if need be).
  const leaving = (mode: Travel) => {
    const need = travelTime(mode, d, f.body, undefined, side);
    return { mode, need, leave: Math.max(Math.round(free * a.fps) / a.fps, Math.round((t - need) * a.fps) / a.fps) };
  };
  const walk = leaving('walk');
  const { mode, leave } = !strafe && t - walk.leave < walk.need * 0.7 ? leaving('run') : walk;
  if (d >= 0.3 && t - leave >= 0.4) {
    const s = { ...scene, animation: splitAt(scene, figure, leave).a };
    let b = s.animation!;
    for (const x of actionsOf(b, figure)) if (x.start > leave + EPS && x.start < t - EPS) b = replace(b, x, []);
    const keyed = actionsOf(b, figure).find((x) => isKeys(x) && Math.abs(x.start - t) < EPS);
    if (keyed) b = replace(b, keyed, []);
    const travel: Action = { id: uid('act'), start: leave, duration: t - leave, roles: [{ figure, end: spot }], source: { kind: 'travel', mode, ...(strafe ? { strafe: true } : {}) } };
    return sorted({ ...b, actions: [...b.actions, travel] });
  }
  // No time to walk there: the figure is there when it starts.
  const placed: Pose = { ...here, position: [spot.at[0], here.position[1], spot.at[1]] };
  const turned = { ...placed, bones: turnBones(placed.bones, wrapDeg(spot.facing - facingOf(placed.bones))) };
  const at = actionsOf(a, figure).find((x) => isKeys(x) && Math.abs(end(x) - t) < EPS);
  if (at) {
    const keys = keysOf(at).map((k, i, all) => (i === all.length - 1 ? { ...k, pose: turned } : k));
    return sorted(replace(a, at, [{ ...keysAction(figure, keys), id: at.id }]));
  }
  if (prev && !isKeys(prev)) return replace(a, prev, [{ ...prev, roles: prev.roles.map((r) => (r.figure === figure ? { ...r, end: spot } : r)) }]);
  return sorted({ ...a, actions: [...a.actions, keysAction(figure, [{ t, pose: turned }])] });
}

/** Stage a figure elsewhere: everything it does by itself moved across the floor by (dx, dz) and turned by `turnBy`. */
export function restage(a: Animation, figure: string, dx: number, dz: number, turnBy: number): Animation {
  const move = (m: Mark): Mark => ({ at: [r3(m.at[0] + dx), r3(m.at[1] + dz)], facing: Math.round(wrapDeg(m.facing + turnBy) * 10) / 10 || 0 });
  const actions = a.actions.map((x): Action => {
    if (x.roles.length !== 1 || x.roles[0].figure !== figure) return x;
    const roles = [{ ...x.roles[0], ...(x.roles[0].end ? { end: move(x.roles[0].end) } : {}) }];
    const src = x.source;
    if (src.kind === 'keys' && !x.layer) {
      const keys = keysOf(x).map((k) => ({ t: k.t, pose: { ...k.pose, bones: turnBones(k.pose.bones, turnBy), position: [r3(k.pose.position[0] + dx), k.pose.position[1], r3(k.pose.position[2] + dz)] as Pose['position'] } }));
      const clip = keysClip(keys.map((k) => ({ t: k.t - x.start, pose: k.pose })), src.clip.loop, src.clip.duration);
      return { ...x, roles, source: { kind: 'keys', clip: { ...clip, id: src.clip.id } } };
    }
    if (src.kind === 'travel' && src.via) return { ...x, roles, source: { ...src, via: src.via.map(move) } };
    return { ...x, roles };
  });
  return { ...a, actions };
}

/** Times where something happens on figures' tracks (a key, an action starting or ending): one figure's, or everyone's. */
export function moments(a: Animation, figure?: string): number[] {
  const ids = figure ? [figure] : [...new Set(a.actions.flatMap((x) => x.roles.map((r) => r.figure)))];
  const times = ids.flatMap((id) => [...keyTimesOf(a, id), ...actionsOf(a, id).filter((x) => !isKeys(x)).flatMap((x) => [x.start, end(x)])]);
  return [...new Set(times.map((t) => Math.round(t * 1e4) / 1e4))].sort((p, q) => p - q);
}
