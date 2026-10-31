import { keyPose, keyTimes, keysClip, partKeys, placeClip, samplePart, setPartKey, startFacing, type Key } from './clip';
import { clipById, playedClip } from './assets';
import { MAX_DURATION, newAnimation, snapTime } from './animation';
import { actionPoseAt, actionsOf, basePoseAt, correctionOf, figurePoseAt, marksOf, seamOf } from './evaluate';
import { JUMP_PREP, jumpHeight, legsOf, travelTime, turnTime } from './locomotion';
import { facingOf, turnBones } from './pose';
import { uid } from './uid';
import { wrapDeg } from './joints';
import { shiftPropTrack } from './propmotion';
import type { Action, ActionSource, Animation, Mark, Pose, Scene, Travel, Vec3 } from './types';

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
const keysOf = (act: Action) => (act.source.kind === 'keys' ? partKeys(act.source.clip.parts[0]).map((k) => ({ ...k, t: act.start + k.t })) : []);
const isKeys = (act: Action) => act.source.kind === 'keys' && !act.layer;
const clipOfKeys = (act: Action) => (act.source as Extract<ActionSource, { kind: 'keys' }>).clip;

/** A keys action holding these poses (times in the animation), from the first to the last. */
export function keysAction(figure: string, keys: Key[], layer?: Action['layer']): Action {
  const start = keys[0].t;
  const clip = keysClip(keys.map((k) => ({ ...k, t: k.t - start })));
  return { id: uid('act'), start, duration: clip.duration, roles: [{ figure }], source: { kind: 'keys', clip }, ...(layer ? { layer } : {}) };
}

const replace = (a: Animation, old: Action, next: Action[]): Animation => ({ ...a, actions: [...a.actions.filter((x) => x !== old), ...next] });
const sorted = (a: Animation): Animation => ({ ...a, actions: [...a.actions].sort((p, q) => p.start - q.start || p.duration - q.duration) });
const longer = (a: Animation, t: number): Animation => (t > a.duration ? { ...a, duration: Math.min(MAX_DURATION, t) } : a);

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

/** How far an edit over a motion reaches either side of its moment (s, #23): it fades in and out over that. */
export const FALLOFF = 0.5;

/**
 * A hand edit over a clip or a travel: a key on the figure's correction there (#23: local, fading in
 * and out over FALLOFF either side of it, within what it corrects; edits whose reaches meet join up
 * in one correction). A correction made to hold over the whole motion (its ends keyed as its
 * edits) stays so.
 */
function correct(scene: Scene, figure: string, over: Action, t: number, pose: Pose): Animation {
  const a = scene.animation!;
  const tol = 0.5 / a.fps;
  const base = basePoseAt(scene, figure, t)!;
  const delta = correctionOf(base, pose);
  const none = correctionOf(delta, delta);
  const [lo, hi] = [over.start, end(over)];
  const fix = actionsOf(a, figure, 'correction').find((x) => x.start - FALLOFF - tol <= t && t <= end(x) + FALLOFF + tol && x.start < hi + tol && end(x) > lo - tol);
  const changes = (k: Key) => JSON.stringify(k.pose) !== JSON.stringify(none);
  const held = !!fix && changes(keysOf(fix)[0]) && changes(keysOf(fix).at(-1)!);
  // Its edits (not the no-change keys it fades from and to), this one put in.
  const edits = [...(fix ? keysOf(fix).filter((k) => (held || changes(k)) && Math.abs(k.t - t) >= tol) : []), { t, pose: delta }].sort((p, q) => p.t - q.t);
  const keys = held ? edits : [
    ...(edits[0].t - FALLOFF > lo + tol ? [{ t: snapTime(a, edits[0].t - FALLOFF), pose: none }] : edits[0].t > lo + tol ? [{ t: lo, pose: none }] : []),
    ...edits,
    ...(edits.at(-1)!.t + FALLOFF < hi - tol ? [{ t: snapTime(a, edits.at(-1)!.t + FALLOFF), pose: none }] : edits.at(-1)!.t < hi - tol ? [{ t: hi, pose: none }] : []),
  ];
  const made = keysAction(figure, keys, 'correction');
  return sorted(fix ? replace(a, fix, [{ ...made, id: fix.id }]) : { ...a, actions: [...a.actions, made] });
}

/** Whether a correction is held over the whole of what it corrects (its ends keyed as its edits, #23). */
export function correctionHeld(fix: Action): boolean {
  const keys = keysOf(fix);
  if (!keys.length) return false;
  const none = JSON.stringify(correctionOf(keys[0].pose, keys[0].pose));
  return JSON.stringify(keys[0].pose) !== none && JSON.stringify(keys.at(-1)!.pose) !== none;
}

/**
 * A correction over the whole of what it corrects (#23: one change held throughout), or back to
 * changing it only around its edits.
 */
export function correctionThroughout(scene: Scene, id: string, throughout: boolean): Animation {
  const a = scene.animation!;
  const fix = a.actions.find((x) => x.id === id && x.layer === 'correction');
  if (!fix) return a;
  const figure = fix.roles[0].figure;
  const keys = keysOf(fix);
  const none = correctionOf(keys[0].pose, keys[0].pose);
  const changes = (k: Key) => JSON.stringify(k.pose) !== JSON.stringify(none);
  const edits = keys.filter(changes);
  if (!edits.length) return a;
  // (What it corrects: the motion or walk under its middle.)
  const mid = edits[Math.floor(edits.length / 2)].t;
  const over = actionsOf(a, figure).find((x) => x.duration > 1e-6 && x.source.kind !== 'keys' && x.start - 1e-6 <= mid && mid <= end(x) + 1e-6);
  const [lo, hi] = over ? [over.start, end(over)] : [fix.start, end(fix)];
  // (Back to around its edits: not the ends it was held to, unless that is all there is.)
  const inner = edits.filter((k) => k.t > lo + 1e-6 && k.t < hi - 1e-6);
  if (!throughout && inner.length) edits.splice(0, edits.length, ...inner);
  const next = throughout
    ? [{ t: lo, pose: edits[0].pose }, ...inner, { t: hi, pose: edits.at(-1)!.pose }]
    : [
      ...(edits[0].t - FALLOFF > lo ? [{ t: snapTime(a, edits[0].t - FALLOFF), pose: none }] : []),
      ...edits,
      ...(edits.at(-1)!.t + FALLOFF < hi ? [{ t: snapTime(a, edits.at(-1)!.t + FALLOFF), pose: none }] : []),
    ];
  return sorted(replace(a, fix, [{ ...keysAction(figure, next, 'correction'), id: fix.id }]));
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

/** Move several of a figure's keys (at `times`) by `by` seconds together (refused onto other keys or actions). */
export function moveKeysBy(a: Animation, figure: string, times: number[], by: number): Animation {
  const tol = 0.5 / a.fps;
  const picked = (t: number) => times.some((x) => Math.abs(x - t) < tol);
  const touched = actionsOf(a, figure).filter((x) => isKeys(x) && keysOf(x).some((k) => picked(k.t)));
  const nexts: Action[] = [];
  for (const act of touched) {
    const moved = keysOf(act).map((k) => (picked(k.t) ? { ...k, t: Math.round((k.t + by) * a.fps) / a.fps } : k)).sort((p, q) => p.t - q.t);
    // (All of them go, or none: not past either end, not onto another key.)
    if (moved[0].t < -EPS || moved[moved.length - 1].t > MAX_DURATION + EPS || moved.some((k, i) => i > 0 && k.t - moved[i - 1].t < tol)) return a;
    nexts.push({ ...keysAction(figure, moved, act.layer), id: act.id });
  }
  // Not over another action, staying or moved.
  const after = [...actionsOf(a, figure).filter((x) => !touched.includes(x)), ...nexts];
  if (nexts.some((n) => after.some((x) => x !== n && x.start < end(n) - EPS && end(x) > n.start + EPS))) return a;
  return sorted({ ...a, actions: [...a.actions.filter((x) => !touched.includes(x)), ...nexts] });
}

/** How a figure's keys that do not go on smoothly go on, by their times (as keyTimesOf has them), their poses not read. */
export function keyEasesOf(a: Animation, figure: string): Map<number, NonNullable<Key['ease']>> {
  const out = new Map<number, NonNullable<Key['ease']>>();
  for (const act of actionsOf(a, figure).filter(isKeys)) {
    const part = clipOfKeys(act).parts[0];
    keyTimes(part).forEach((t, i) => {
      const e = part.eases?.[i];
      if (e && e !== 'smooth') out.set(Math.round((act.start + t) * 1e6) / 1e6, e);
    });
  }
  return out;
}

/** How a figure's key at t goes on to the next (null: no key there). */
export function keyEaseAt(a: Animation, figure: string, t: number): Key['ease'] | null {
  const hit = keyAtTime(a, figure, t);
  return hit ? (keysOf(hit.act)[hit.i].ease ?? 'smooth') : null;
}

/** Set how a figure's key at t goes on to the next: smoothly, at an even speed, or held until the next key (`step`). */
export function setKeyEase(a: Animation, figure: string, t: number, ease: NonNullable<Key['ease']>): Animation {
  const hit = keyAtTime(a, figure, t);
  if (!hit) return a;
  const keys = keysOf(hit.act).map((k, i) => (i === hit.i ? { ...k, ease } : k));
  return replace(a, hit.act, [{ ...keysAction(figure, keys, hit.act.layer), id: hit.act.id }]);
}

/** Hold a figure's key at t for `by` seconds: a copy of it then, and what comes after moved on by as much. */
export function holdKeyFor(a: Animation, figure: string, t: number, by: number): Animation {
  const hit = keyAtTime(a, figure, t);
  if (!hit || by <= EPS) return a;
  const key = keysOf(hit.act)[hit.i];
  // The key and all that comes from then on move on (an action starting there too); a copy of it
  // stays where it was, holding still (smooth between equal poses) until it.
  const moved = ripple(a, figure, key.t - 0.5 / a.fps, Math.round(by * a.fps) / a.fps);
  const act = moved.actions.find((x) => x.id === hit.act.id)!;
  const keys = [{ t: key.t, pose: key.pose }, ...keysOf(act)].sort((p, q) => p.t - q.t);
  const next = { ...keysAction(figure, keys, act.layer), id: act.id };
  return longer(sorted(replace(moved, act, [next])), end(next));
}

/**
 * An action played `times` times in all, one after another (what follows moved on): a keyed block's
 * keys repeated (its travel carried on each time: a cycle walks on), a clip played again.
 */
export function repeatAction(a: Animation, id: string, times: number): Animation {
  const act = a.actions.find((x) => x.id === id);
  if (!act || times < 1) return a;
  const src = act.source;
  if (src.kind === 'clip') {
    const clip = playedClip(src);
    if (!clip) return a;
    // (One play takes as long as it does now: its speed is kept.)
    const once = clip.duration / (src.speed ?? 1);
    const { repeat: _repeat, ...rest } = src;
    void _repeat;
    const source = clip.loop || times === 1 ? rest : { ...rest, repeat: times };
    return retimeAction(replace(a, act, [{ ...act, source }]), id, once * times);
  }
  if (src.kind !== 'keys' || times < 2) return a;
  const keys = keysOf(act);
  if (keys.length < 2) return a;
  const [first, last] = [keys[0], keys[keys.length - 1]];
  const span = last.t - first.t;
  const [dx, dz] = [last.pose.position[0] - first.pose.position[0], last.pose.position[2] - first.pose.position[2]];
  const all = [...keys];
  for (let r = 1; r < times; r++) {
    // Each time round goes on from its first key as the first did.
    const join = all[all.length - 1];
    all[all.length - 1] = { ...join, ...(first.ease ? { ease: first.ease } : {}) };
    if (!first.ease) delete all[all.length - 1].ease;
    for (const k of keys.slice(1)) {
      const p = k.pose.position;
      all.push({ ...k, t: Math.round((k.t + r * span) * a.fps) / a.fps, pose: { ...k.pose, position: [r3(p[0] + r * dx), p[1], r3(p[2] + r * dz)] } });
    }
  }
  const by = span * (times - 1);
  const moved = rippleInStep(a, act.roles.map((r) => r.figure), end(act), by, [end(act)]);
  const now = moved.actions.find((x) => x.id === id)!;
  const next = { ...keysAction(act.roles[0].figure, all, act.layer), id };
  return longer(sorted(replace(moved, now, [next])), end(next));
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
  const shift = (t: number) => Math.min(MAX_DURATION, Math.round((t + by) * a.fps) / a.fps);
  const actions = a.actions.map((x) => {
    if (!x.roles.some((r) => who.includes(r.figure))) return x;
    if (x.source.kind === 'keys' && x.start < from - EPS && end(x) >= from - EPS) {
      const keys = keysOf(x).map((k) => (k.t >= from - EPS ? { ...k, t: shift(k.t) } : k));
      return { ...keysAction(x.roles[0].figure, keys, x.layer), id: x.id };
    }
    return x.start >= from - EPS ? { ...x, start: shift(x.start) } : x;
  });
  const last = Math.max(a.duration, ...actions.map(end));
  return sorted({ ...a, actions, duration: Math.min(MAX_DURATION, last) });
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
  const shift = (t: number) => Math.min(MAX_DURATION, Math.round((t + by) * a.fps) / a.fps);
  const actions = a.actions.map((x) => {
    if (x.source.kind === 'keys' && x.roles.length === 1 && since.has(x.roles[0].figure)) {
      const t0 = since.get(x.roles[0].figure)! - half;
      if (x.start < t0 && end(x) >= t0) return { ...keysAction(x.roles[0].figure, keysOf(x).map((k) => (k.t >= t0 ? { ...k, t: shift(k.t) } : k)), x.layer), id: x.id };
    }
    return moves(x) ? { ...x, start: shift(x.start) } : x;
  });
  let out = sorted({ ...a, actions, duration: Math.min(MAX_DURATION, Math.max(a.duration, ...actions.map(end))) });
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
  const act: Action = { id: uid('act'), start: t0, duration: Math.min(MAX_DURATION - t0, length), layer: 'upper', roles: [{ figure }], source: { kind: 'clip', clip: clipId } };
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
export function addTravel(scene: Scene, figure: string, t: number, to: [number, number], mode: Travel, opts: { strafe?: boolean; height?: number; facing?: number } = {}): { animation: Animation; from: number; to: number } | null {
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
  // (Nowhere to go, another way to face: a turn on the spot, stepping round.)
  const turning = d < 0.05 && opts.facing !== undefined && mode !== 'jump';
  const time = turning ? turnTime(wrapDeg(opts.facing! - facing)) : travelTime(mode, d, f.body, opts.height, sideways);
  const t1 = Math.round((t0 + time) * a.fps) / a.fps;
  const yaw = opts.facing ?? (mode === 'jump' || opts.strafe || d < 0.05 ? facing : heading);
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

/** The most a walk or run turns as it arrives to face what comes next (degrees): further, its last steps would cross the legs. */
export const ARRIVE_TURN = 90;

/**
 * The animation with the walk or run a figure arrives by at t (going somewhere, not stepping aside)
 * ending facing this way instead, its last steps taking it round; null if there is none or the turn
 * is more than a quarter.
 */
export function turnArriving(scene: Scene, figure: string, t: number, facing: number): Animation | null {
  const a = scene.animation;
  const into = a && travelInto(a, figure, t);
  const end = into?.roles.find((r) => r.figure === figure)?.end;
  if (!a || !into || !end || into.source.kind !== 'travel' || into.source.mode === 'jump' || into.source.strafe) return null;
  if (Math.abs(wrapDeg(facing - end.facing)) > ARRIVE_TURN) return null;
  // (From the mark it set off from: the one before it ends on, else as evaluated.)
  const before = actionsOf(a, figure).filter((x) => x !== into && x.start + x.duration <= into.start + 1e-6).at(-1)?.roles.find((r) => r.figure === figure)?.end;
  const from = before?.at ?? marksOf(scene, into, figure)?.start.at;
  if (!from || Math.hypot(end.at[0] - from[0], end.at[1] - from[1]) < 0.5) return null;
  const turned = { ...end, facing: Math.round(wrapDeg(facing) * 10) / 10 || 0 };
  return { ...a, actions: a.actions.map((x) => (x.id === into.id ? { ...x, roles: x.roles.map((r) => (r.figure === figure ? { ...r, end: turned } : r)) } : x)) };
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
    const clip = playedClip(src);
    if (clip && !clip.loop) next = { ...next, source: { ...src, speed: Math.round(((clip.duration * (src.repeat ?? 1)) / d) * 1000) / 1000 } };
  } else if (src.kind === 'keys') {
    const k = d / Math.max(EPS, act.duration);
    const keys = keysOf(act).map((x) => ({ ...x, t: snapTime({ ...a, duration: MAX_DURATION }, act.start + (x.t - act.start) * k) }));
    next = { ...keysAction(act.roles[0].figure, keys, act.layer), id: act.id, duration: d };
  }
  // (A correction is retimed by itself: it is over what it corrects, which stays.)
  const moved = act.layer === 'correction' ? a : rippleInStep(a, act.roles.map((r) => r.figure), end(act), by, [end(act)]);
  return longer(sorted(replace(moved, moved.actions.find((x) => x.id === id)!, [next])), end(next));
}

/** The least a trimmed block keeps (s). */
const MIN_BLOCK = 0.1;

/**
 * Trim an action (#22) at its start or its end to `t`, what it plays staying where it is in time:
 * - a motion: the part of it it plays (`from` / `to`), within the motion; repeated, whole repeats
 *   added or taken away; a loop, more or fewer laps (from its start);
 * - keys: how long the last pose holds (its end), or where its keys start (the pose there keyed);
 * - a walk, run or jump: its end is how long it takes (as retimeAction); its start is not trimmed.
 * A shorter or longer end moves what that person (each of its people) does after along; a later
 * start leaves a gap before it. Not before what comes before it on its layer.
 */
export function trimAction(a: Animation, id: string, side: 'start' | 'end', t: number): Animation {
  const act = a.actions.find((x) => x.id === id);
  if (!act) return a;
  const src = act.source;
  const frame = (v: number) => Math.round(v * a.fps) / a.fps;
  const least = Math.max(MIN_BLOCK, 1 / a.fps);
  if (src.kind === 'travel' || act.layer === 'correction') return side === 'end' ? retimeAction(a, id, t - act.start) : a;
  if (side === 'end') {
    let d = Math.max(least, frame(t) - act.start);
    let source: ActionSource = src;
    if (src.kind === 'clip') {
      const whole = clipById(src.clip);
      if (!whole) return a;
      const speed = src.speed ?? 1;
      const from = src.from ?? 0;
      if (whole.loop) source = src;
      else if ((src.repeat ?? 1) > 1) {
        // (Whole repeats: as many as reach there.)
        const once = ((src.to ?? whole.duration) - from) / speed;
        const n = Math.max(1, Math.min(50, Math.round(d / once)));
        d = once * n;
        const { repeat: _r, ...rest } = src;
        void _r;
        source = n > 1 ? { ...rest, repeat: n } : rest;
      } else {
        // (Within the motion; past its end, its last pose held there, #23.)
        const lead = src.lead ?? 0;
        const to = Math.min(whole.duration, from + Math.max(0, d - lead) * speed);
        source = { ...src, to: Math.round(to * 1000) / 1000 };
        if (source.to! >= whole.duration - 1e-3) delete source.to;
      }
    } else {
      // Keys: the last pose held for longer, or less (not before the last key).
      const last = keysOf(act).at(-1)?.t ?? act.start;
      d = Math.max(d, last - act.start, least);
    }
    d = Math.max(least, frame(d));
    const by = d - act.duration;
    if (Math.abs(by) < 1e-6 && source === src) return a;
    const next: Action = { ...act, duration: d, source };
    const moved = rippleInStep(a, act.roles.map((r) => r.figure), end(act), by, [end(act)]);
    return longer(sorted(replace(moved, moved.actions.find((x) => x.id === id)!, [next])), end(next));
  }
  // The start: later or earlier, its end where it is.
  const who = act.roles.map((r) => r.figure);
  const layer = (x: Action) => x.layer ?? 'base';
  const before = a.actions.filter((x) => x !== act && layer(x) === layer(act) && x.roles.some((r) => who.includes(r.figure)) && end(x) <= act.start + 1e-6);
  const floor = Math.max(0, ...before.map(end));
  let start = Math.min(end(act) - least, Math.max(floor, frame(t)));
  let source: ActionSource = src;
  if (src.kind === 'clip') {
    const whole = clipById(src.clip);
    if (!whole) return a;
    const speed = src.speed ?? 1;
    if (whole.loop) source = src;
    else if ((src.repeat ?? 1) > 1) {
      const once = ((src.to ?? whole.duration) - (src.from ?? 0)) / speed;
      const n = Math.max(1, Math.min(50, Math.round((end(act) - start) / once)));
      start = end(act) - once * n;
      if (start < floor - 1e-6) start = end(act) - once * Math.max(1, n - 1);
      const { repeat: _r, ...rest } = src;
      void _r;
      source = Math.round((end(act) - start) / once) > 1 ? { ...rest, repeat: Math.round((end(act) - start) / once) } : rest;
    } else {
      // (What it plays stays where it was; before the motion's first frame, that pose held from
      // there, #23: its lead.)
      const at = (src.from ?? 0) - (src.lead ?? 0) * speed + (start - act.start) * speed;
      source = { ...src, from: Math.round(Math.max(0, at) * 1000) / 1000, lead: Math.round((Math.max(0, -at) / speed) * 1000) / 1000 };
      if (source.from! <= 1e-3) delete source.from;
      if (!source.lead) delete source.lead;
    }
  } else if (src.kind === 'keys') {
    // Keys before it go; the pose there is keyed (later); earlier, its first pose held from there.
    const keys = keysOf(act);
    const clip = src.clip;
    const posed = samplePart(clip.parts[0], Math.min(clip.duration, Math.max(0, start - act.start)), clip.duration, false);
    const kept = keys.filter((k) => k.t > start + 1e-6);
    const at = start < act.start ? [{ t: start, pose: keys[0].pose }, ...keys] : [{ t: start, pose: posed }, ...kept];
    return sorted(replace(a, act, [{ ...keysAction(act.roles[0].figure, at, act.layer), id: act.id, duration: end(act) - start, ...(act.blendIn ? { blendIn: act.blendIn } : {}) }]));
  }
  if (Math.abs(start - act.start) < 1e-6 && source === src) return a;
  return sorted(replace(a, act, [{ ...act, start, duration: end(act) - start, source }]));
}

/**
 * The part of a motion an action plays, from `from` to `to` (seconds of the motion, #22), its block
 * where it starts, as long as that takes at its speed (repeats repeating it); what that person (each
 * of its people) does after moves along. Not for a loop.
 */
export function playRange(a: Animation, id: string, from: number, to: number): Animation {
  const act = a.actions.find((x) => x.id === id);
  const src = act?.source;
  if (!act || src?.kind !== 'clip') return a;
  const whole = clipById(src.clip);
  if (!whole || whole.loop) return a;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const least = Math.max(MIN_BLOCK, 1 / a.fps) * (src.speed ?? 1);
  const f = r3(Math.max(0, Math.min(whole.duration - least, from)));
  const t = r3(Math.max(f + least, Math.min(whole.duration, to)));
  const source = { ...src, from: f, to: t };
  if (source.from <= 1e-3) delete (source as { from?: number }).from;
  if (source.to >= whole.duration - 1e-3) delete (source as { to?: number }).to;
  const d = Math.round((((t - f) * (src.repeat ?? 1)) / (src.speed ?? 1)) * a.fps) / a.fps;
  const by = d - act.duration;
  const next: Action = { ...act, duration: d, source };
  const moved = Math.abs(by) < 1e-6 ? a : rippleInStep(a, act.roles.map((r) => r.figure), end(act), by, [end(act)]);
  return longer(sorted(replace(moved, moved.actions.find((x) => x.id === id)!, [next])), end(next));
}

/** Why an action can't be split at t (#22), or null if it can. */
export function unsplittable(a: Animation, id: string, t: number): string | null {
  const act = a.actions.find((x) => x.id === id);
  if (!act) return 'Nothing to split';
  if (act.source.kind === 'travel') return 'A walk, run or jump goes all the way to its mark: it is not split';
  const least = Math.max(MIN_BLOCK, 1 / a.fps);
  if (t < act.start + least - 1e-6 || t > end(act) - least + 1e-6) return `Put the playhead inside ${actionLabel(act)} to split it there`;
  return null;
}

/**
 * Split a repeated motion into its repeats (#22, #23): one block each, the part of the motion and
 * its speed kept; the first keeps its blend in, the last its mark.
 */
export function splitRepeats(a: Animation, id: string): Animation {
  const act = a.actions.find((x) => x.id === id);
  const src = act?.source;
  if (!act || src?.kind !== 'clip' || (src.repeat ?? 1) < 2) return a;
  const n = src.repeat!;
  const once = act.duration / n;
  const { repeat: _r, seam: _s, alternate, ...one } = src;
  void _r; void _s;
  // (Each after the first blends in as the repeat did, #23; every other one mirrored if they were.)
  const played = playedClip(src);
  const seam = played?.parts[0] ? seamOf(src, played, played.parts[0]) : 0;
  const blocks = Array.from({ length: n }, (_, i): Action => {
    const mirror = !!src.mirror !== (!!alternate && i % 2 === 1);
    const { mirror: _m, ...rest } = one;
    void _m;
    const x: Action = {
      ...act,
      id: i ? uid('act') : act.id,
      start: act.start + once * i,
      duration: once,
      source: mirror ? { ...rest, mirror: true } : rest,
      roles: act.roles.map((r) => (i === n - 1 ? r : { figure: r.figure })),
    };
    if (i) {
      if (seam > 0) x.blendIn = seam;
      else delete x.blendIn;
    }
    return x;
  });
  return sorted(replace(a, act, blocks));
}

/**
 * Split an action at t (#22): two blocks, the second going on from where the first leaves off (no
 * blend), the part of its motion each plays its own; the first keeps its blend in, the second its
 * mark. A repeated motion splits into its repeats first, then the one under t; a loop into two
 * loops; keys into two Posed blocks, the pose at t keyed in both. A walk, run or jump is not split.
 */
export function splitAction(a: Animation, id: string, t: number): Animation {
  if (unsplittable(a, id, t)) return a;
  const time = Math.round(t * a.fps) / a.fps;
  const act0 = a.actions.find((x) => x.id === id)!;
  const src0 = act0.source;
  if (src0.kind === 'clip' && (src0.repeat ?? 1) > 1) {
    const apart = splitRepeats(a, id);
    // (At a repeat's end: apart already.)
    const under = apart.actions.find((x) => x.roles[0].figure === act0.roles[0].figure && x.layer === act0.layer && x.start < time - 1e-6 && time < end(x) - 1e-6 && x.source.kind === 'clip');
    return under && !unsplittable(apart, under.id, time) ? splitAction(apart, under.id, time) : apart;
  }
  const act = act0;
  const src = act.source;
  const first: Action = { ...act, duration: time - act.start, roles: act.roles.map((r) => ({ figure: r.figure })) };
  const second: Action = { ...act, id: uid('act'), start: time, duration: end(act) - time };
  delete second.blendIn;
  if (src.kind === 'clip') {
    const whole = clipById(src.clip);
    if (!whole) return a;
    if (!whole.loop) {
      const speed = src.speed ?? 1;
      const cut = Math.round(((src.from ?? 0) + (time - act.start) * speed) * 1000) / 1000;
      first.source = { ...src, to: cut };
      second.source = { ...src, from: cut };
      if ((second.source as { to?: number }).to === undefined) delete (second.source as { to?: number }).to;
    }
  } else if (src.kind === 'keys') {
    const keys = keysOf(act);
    const clip = src.clip;
    const pose = samplePart(clip.parts[0], Math.min(clip.duration, time - act.start), clip.duration, false);
    const before = [...keys.filter((k) => k.t < time - 1e-6), { t: time, pose }];
    const after = [{ t: time, pose }, ...keys.filter((k) => k.t > time + 1e-6)];
    const figure = act.roles[0].figure;
    return sorted(replace(a, act, [
      { ...keysAction(figure, before, act.layer), id: act.id, duration: time - act.start, ...(act.blendIn ? { blendIn: act.blendIn } : {}) },
      { ...keysAction(figure, after, act.layer), duration: end(act) - time },
    ]));
  }
  return sorted(replace(a, act, [first, second]));
}

/**
 * Take actions away, what each of their people does after moving up (#22: a ripple delete), the
 * latest first. Not the corrections on them (they go with the time, as with any gap closed).
 */
export function rippleDelete(a: Animation, ids: string[]): Animation {
  const acts = a.actions.filter((x) => ids.includes(x.id)).sort((p, q) => q.start - p.start);
  let out = a;
  for (const act of acts) {
    const now = out.actions.find((x) => x.id === act.id);
    if (!now) continue;
    out = replace(out, now, []);
    if (!now.layer) out = rippleInStep(out, now.roles.map((r) => r.figure), end(now), -now.duration, [end(now)]);
  }
  return out;
}

/**
 * Each action again right after itself (#22: duplicate), what follows moving along; it ends where
 * it goes by itself (no mark). A walk, run or jump is not duplicated (it would go nowhere).
 */
export function duplicateActions(a: Animation, ids: string[]): Animation {
  const acts = a.actions.filter((x) => ids.includes(x.id) && x.source.kind !== 'travel').sort((p, q) => q.start - p.start);
  let out = a;
  for (const act of acts) {
    const now = out.actions.find((x) => x.id === act.id);
    if (!now) continue;
    const copy: Action = { ...now, id: uid('act'), start: end(now), roles: now.roles.map((r) => ({ figure: r.figure })) };
    // (The corrections on it again on its copy, #23.)
    const fixes = now.layer ? [] : actionsOf(out, now.roles[0].figure, 'correction').filter((x) => x.start >= now.start - 1e-6 && x.start < end(now) - 1e-6)
      .map((x) => ({ ...x, id: uid('act'), start: x.start + now.duration }));
    if (!now.layer) out = rippleInStep(out, now.roles.map((r) => r.figure), end(now), now.duration, [end(now)]);
    out = longer(sorted({ ...out, actions: [...out.actions, copy, ...fixes] }), end(copy));
  }
  return out;
}

/**
 * Slip a motion (#22): the part of it it plays moved by `by` seconds of the block's time (later in
 * the motion: positive), the block where it is. Within the motion; not for a repeat or a loop.
 */
export function slipAction(a: Animation, id: string, by: number): Animation {
  const act = a.actions.find((x) => x.id === id);
  const src = act?.source;
  if (!act || src?.kind !== 'clip' || (src.repeat ?? 1) > 1) return a;
  const whole = clipById(src.clip);
  if (!whole || whole.loop) return a;
  const speed = src.speed ?? 1;
  const length = act.duration * speed;
  const from = Math.max(0, Math.min(whole.duration - length, (src.from ?? 0) + by * speed));
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const source = { ...src, from: r3(from), to: r3(from + length) };
  if (source.from <= 1e-3) delete (source as { from?: number }).from;
  if (source.to >= whole.duration - 1e-3) delete (source as { to?: number }).to;
  // (The corrections on it stay on the moments they correct, #23: they move as far the other way.)
  const moved = (from - (src.from ?? 0)) / speed;
  const out = replace(a, act, [{ ...act, source }]);
  return { ...out, actions: out.actions.map((x) => (x.layer === 'correction' && x.roles[0].figure === act.roles[0].figure && x.start >= act.start - 1e-6 && x.start < end(act) - 1e-6
    ? { ...x, start: Math.round((x.start - moved) * a.fps) / a.fps } : x)) };
}

/**
 * What an action is called on the timeline and in the inspector: the motion's name, or how the
 * figure gets there (in its scene: a walk that goes nowhere but round is a turn).
 */
export function actionLabel(act: Action, scene?: Scene): string {
  const src = act.source;
  if (src.kind === 'keys') return act.layer === 'correction' ? 'Correction' : 'Posed';
  if (src.kind === 'clip') return `${clipById(src.clip)?.name ?? 'Motion'}${src.repeat ? ` ×${src.repeat}` : ''}`;
  const marks = scene && src.mode !== 'jump' ? marksOf(scene, act, act.roles[0].figure) : null;
  if (marks && Math.hypot(marks.end.at[0] - marks.start.at[0], marks.end.at[1] - marks.start.at[1]) < 0.05 && Math.abs(wrapDeg(marks.end.facing - marks.start.facing)) > 5) return 'Turn';
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
  const t0 = snapTime({ ...a, duration: MAX_DURATION }, start);
  const t1 = Math.min(MAX_DURATION, Math.round((t0 + clip.duration) * a.fps) / a.fps);
  a = longer(a, t1);
  for (const id of cast) a = clear({ ...scene, animation: a }, id, t0, t1);
  const act: Action = { id: uid('act'), start: t0, duration: t1 - t0, blendIn: BLEND, roles: cast.map((figure) => ({ figure })), source: { kind: 'clip', clip: clipId } };
  let s: Scene = { ...scene, animation: sorted({ ...a, actions: [...a.actions, act] }) };
  // Where the partners go: placed around the lead as in the clip (from where the lead starts it,
  // turned as the lead's part is turned there), spaced for the biggest of them.
  const lead = marksOf(s, act, cast[0])!.start;
  const firsts = clip.parts.map((p) => keyPose(p, 0));
  const by = lead.facing - startFacing(clip.parts[0], firsts[0]);
  const size = Math.max(...cast.map((id, n) => legsOf(scene.figures.find((f) => f.id === id)!.body).rootY / legsOf(clip.parts[n].body ?? scene.figures.find((f) => f.id === id)!.body).rootY));
  for (const [n, id] of cast.entries()) {
    if (!n) continue;
    const off = turn((firsts[n].position[0] - firsts[0].position[0]) * size, (firsts[n].position[2] - firsts[0].position[2]) * size, by);
    const spot: Mark = { at: [r3(lead.at[0] + off[0]), r3(lead.at[1] + off[1])], facing: Math.round(wrapDeg(startFacing(clip.parts[n], firsts[n]) + by) * 10) / 10 };
    s = { ...s, animation: goTo(s, id, spot, t0) };
  }
  return { ...s, animation: sorted(s.animation!) };
}

function turn(x: number, z: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) + z * Math.sin(r), -x * Math.sin(r) + z * Math.cos(r)];
}

/** Make room on a figure's track from t0 to t1: keys there go (one is kept at t0), actions starting there go, ones running into it end at t0. */
/** An action ending at t instead (#22): a motion plays only the part of it up to there (its `to`). */
function cutShort(x: Action, t: number): Action {
  const src = x.source;
  const whole = src.kind === 'clip' ? clipById(src.clip) : null;
  if (src.kind !== 'clip' || !whole || whole.loop || (src.repeat ?? 1) > 1) return { ...x, duration: t - x.start };
  const to = Math.round(((src.from ?? 0) + (t - x.start) * (src.speed ?? 1)) * 1000) / 1000;
  return { ...x, duration: t - x.start, source: { ...src, to: Math.min(whole.duration, to) } };
}

export function clear(scene: Scene, figure: string, t0: number, t1: number): Animation {
  const split = splitAt(scene, figure, t0);
  let a = split.a;
  for (const x of actionsOf(a, figure)) {
    if (x.start < t0 - EPS && end(x) > t0 + EPS) a = replace(a, x, [cutShort(x, t0)]);
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
 * A scene's animation made `length` seconds long, keeping its timing (#14, a film of a chosen
 * length): longer, a motion that loops and is the last of what its figures do goes on (a dance
 * keeps dancing; the rest is idle life); shorter, what is past the end is cut.
 */
export function fitted(scene: Scene, length: number): Scene {
  const a = scene.animation;
  if (!a) return scene;
  if (length < a.duration - EPS) return cutTo(scene, length);
  // (A looping motion: a Library clip, or keys made to go round, as the built-in templates' are.)
  const loops = (x: Action) => (x.source.kind === 'clip' ? !!clipById(x.source.clip)?.loop : x.source.kind === 'keys' && x.source.clip.loop);
  const actions = a.actions.map((x) => {
    if (x.layer || !loops(x) || end(x) < a.duration - 0.05 || !x.roles.every((r) => actionsOf(a, r.figure).at(-1) === x)) return x;
    return x.source.kind === 'clip' ? { ...x, duration: length - x.start } : unrolled(x, length - x.start, a.fps);
  });
  return { ...scene, animation: { ...a, actions, duration: length } };
}

/**
 * A looping keys action as its keys gone round as many whole times as fit in `span`: keys like
 * any others, to pose and edit anywhere along it (idle life after, to the end).
 */
function unrolled(x: Action, span: number, fps: number): Action {
  const clip = clipOfKeys(x);
  const laps = Math.floor(span / clip.duration + EPS);
  if (laps * clip.duration <= x.duration + EPS) return x;
  const keys = partKeys(clip.parts[0]);
  // (A key at the lap's end is the next lap's first.)
  const lap = keys.filter((k) => k.t < clip.duration - 0.5 / fps);
  const at = (t: number) => Math.round((x.start + t) * fps) / fps;
  const all = Array.from({ length: laps }, (_, r) => lap.map((k) => ({ ...k, t: at(k.t + r * clip.duration) }))).flat();
  return { ...keysAction(x.roles[0].figure, [...all, { t: at(laps * clip.duration), pose: keys[0].pose }]), id: x.id };
}

/**
 * The animation cut to `d` seconds, keeping its timing (where the length field scales it): what is
 * past the cut goes (a key kept there), what runs into it ends there.
 */
export function cutTo(scene: Scene, d: number): Scene {
  if (!scene.animation) return scene;
  let a = scene.animation;
  // A walk under way at the cut goes only as far as it has got by then, by the marks it has passed, at its pace.
  const under = new Map(a.actions.filter((x) => x.source.kind === 'travel' && x.start < d - EPS && end(x) > d + EPS).map((x) => {
    const id = x.roles[0].figure;
    const via = (x.source as Extract<ActionSource, { kind: 'travel' }>).via ?? [];
    const m = marksOf(scene, x, id)!;
    const points = [m.start.at, ...via.map((v) => v.at), m.end.at];
    const legs = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
    // The marks before the leg it is on at the cut (the one nearest where it is then).
    const here = markOf(figurePoseAt(scene, id, d)!);
    const off = (i: number) => {
      const [p, q] = [points[i], points[i + 1]];
      const len2 = legs[i] ** 2 || 1;
      const k = Math.min(1, Math.max(0, ((here.at[0] - p[0]) * (q[0] - p[0]) + (here.at[1] - p[1]) * (q[1] - p[1])) / len2));
      return Math.hypot(here.at[0] - (p[0] + (q[0] - p[0]) * k), here.at[1] - (p[1] + (q[1] - p[1]) * k));
    };
    // (Legs over one another, as on a way out and back: the one about as far along as its time.)
    const nearest = Math.min(...legs.map((_, i) => off(i)));
    const total = legs.reduce((t, l) => t + l, 0) || 1;
    const u = (d - x.start) / x.duration;
    const from = (i: number) => legs.slice(0, i).reduce((t, l) => t + l, 0) / total;
    const apart = (i: number) => Math.max(0, from(i) - u, u - from(i + 1));
    const leg = legs.map((_, i) => i).filter((i) => off(i) < nearest + 0.05).reduce((best, i) => (apart(i) < apart(best) ? i : best));
    return [x.id, { mark: here, via: via.slice(0, leg) }];
  }));
  for (const f of scene.figures) a = clear({ ...scene, animation: a }, f.id, d, Infinity);
  const actions = a.actions.flatMap((x): Action[] => {
    if (x.start >= d - EPS && x.start > 0) return [];
    const cut = under.get(x.id);
    if (cut && x.source.kind === 'travel') {
      const { via: _via, ...source } = x.source;
      void _via;
      return [{ ...x, duration: d - x.start, roles: [{ ...x.roles[0], end: cut.mark }], source: cut.via.length ? { ...source, via: cut.via } : source }];
    }
    return end(x) <= d + EPS ? [x] : [cutShort(x, d)];
  });
  const props = a.props && Object.fromEntries(Object.entries(a.props).map(([id, keys]) => [id, keys.filter((k) => k.t <= d + EPS)]));
  const shots = a.shots.filter((x, i) => i === 0 || x.start < d - EPS);
  const constraints = a.constraints?.filter((c) => c.start < d - EPS).map((c) => ({ ...c, end: Math.min(c.end, d) }));
  const cameras = scene.cameras.map((c) => (c.kind === 'path' ? { ...c, points: c.points.filter((p, i) => i === 0 || p.t <= d + EPS) } : c));
  const markers = a.markers?.filter((m) => m.t <= d + EPS);
  const { range: was, ...rest } = a;
  const range = was && was.from < d - 0.1 ? { from: was.from, to: Math.min(was.to, d) } : undefined;
  return { ...scene, cameras, animation: { ...rest, duration: d, actions, ...(props ? { props } : {}), shots, ...(constraints ? { constraints } : {}), ...(a.markers ? { markers } : {}), ...(range ? { range } : {}) } };
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
  const side = Math.abs(Math.sin((off * Math.PI) / 180));
  // Walking, leaving in time to get there (briskly, if short of time); well short of time,
  // running (at once, if need be).
  const leaving = (mode: Travel, sideways = 0) => {
    const need = travelTime(mode, d, f.body, undefined, sideways);
    return { mode, need, leave: Math.max(Math.round(free * a.fps) / a.fps, Math.round((t - need) * a.fps) / a.fps) };
  };
  // Stepping over facing the partner, backwards or sideways (a long turn at the end of a walk
  // would twist the legs), if there is time for the steps; else walking there facing the way.
  const steps = leaving('walk', side);
  const strafe = off > 90 && t - steps.leave >= steps.need * 0.6;
  const walk = strafe ? steps : leaving('walk');
  const { mode, leave, need } = !strafe && t - walk.leave < walk.need * 0.7 ? leaving('run') : walk;
  // Not even a run gets there in time after what it does before: that travel goes there instead.
  const retarget = mode === 'run' && t - leave < need * 0.7 && !!prev && !isKeys(prev) && prev.source.kind === 'travel';
  if (d >= 0.3 && t - leave >= 0.4 && !retarget) {
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

/**
 * A move of whole performances across the floor (a track offset): turned by `turn` degrees about
 * `about` (x, z), then moved by (dx, dz).
 */
export interface Offset {
  dx: number;
  dz: number;
  turn: number;
  about: [number, number];
}

/** The figures whose performances move with `figures`': those sharing an action with them, and theirs (a waltz, a bout). */
export function partnersOf(a: Animation, figures: string[]): string[] {
  const out = new Set(figures);
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of a.actions) {
      if (x.roles.length < 2 || !x.roles.some((r) => out.has(r.figure))) continue;
      for (const r of x.roles) if (!out.has(r.figure)) { out.add(r.figure); grew = true; }
    }
  }
  return [...out];
}

/**
 * Stage figures elsewhere: everything they do (their keys, marks, routes, where their throws land,
 * the places they hold on to) moved and turned on the floor as one, as a track offset is (Unity's
 * Track Offsets, Unreal's Transform Origin). What follows from them follows by itself: clips
 * played from where they are, props in their hands, cameras on them. Actions shared with others
 * move only if all of theirs do (see `partnersOf`).
 */
export function restage(a: Animation, figures: string[], o: Offset): Animation {
  const ids = new Set(figures);
  const place = (x: number, z: number): [number, number] => {
    const [ox, oz] = turn(x - o.about[0], z - o.about[1], o.turn);
    return [r3(o.about[0] + ox + o.dx), r3(o.about[1] + oz + o.dz)];
  };
  const move = (m: Mark): Mark => ({ at: place(...m.at), facing: Math.round(wrapDeg(m.facing + o.turn) * 10) / 10 || 0 });
  const actions = a.actions.map((x): Action => {
    if (!x.roles.every((r) => ids.has(r.figure))) return x;
    const roles = x.roles.map((r) => (r.end ? { ...r, end: move(r.end) } : r));
    const target = x.target && 'at' in x.target ? { target: { at: place(...x.target.at) } } : {};
    const src = x.source;
    const source: ActionSource = src.kind === 'keys' ? { kind: 'keys', clip: placeClip(src.clip, o.turn, place, x.layer === 'correction') }
      : src.kind === 'travel' && src.via ? { ...src, via: src.via.map(move) } : src;
    return { ...x, roles, source, ...target };
  });
  const constraints = a.constraints?.map((c) => {
    if (!ids.has(c.figure) || !('point' in c.target)) return c;
    const [x, z] = place(c.target.point[0], c.target.point[2]);
    return { ...c, target: { point: [x, c.target.point[1], z] as Vec3 } };
  });
  return { ...a, actions, ...(constraints ? { constraints } : {}) };
}

/** Times where something happens on figures' tracks (a key, an action starting or ending): one figure's, or everyone's. */
export function moments(a: Animation, figure?: string): number[] {
  const ids = figure ? [figure] : [...new Set(a.actions.flatMap((x) => x.roles.map((r) => r.figure)))];
  const times = ids.flatMap((id) => [...keyTimesOf(a, id), ...actionsOf(a, id).filter((x) => !isKeys(x)).flatMap((x) => [x.start, end(x)])]);
  return [...new Set(times.map((t) => Math.round(t * 1e4) / 1e4))].sort((p, q) => p - q);
}
