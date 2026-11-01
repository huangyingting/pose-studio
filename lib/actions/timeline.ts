import * as THREE from 'three';
import { wrapDeg } from '../joints';
import { uid, nextName } from '../doc';
import { snapTime, MAX_DURATION, newAnimation, placeAnimation, setDuration as setAnimDuration } from '../animation';
import { playedClip, clipById } from '../assets';
import { partKeys, type Key, placeClip, keysClip, partFromPoses, mirrorPose as mirrored } from '../clip';
import { figurePoseAt, naturalEnd, actionPoseAt, warpLimit } from '../evaluate';
import { rippleInStep, retimeAction, trimAction, unsplittable, splitAction, splitRepeats, playRange, slipAction, keysAction, correctionThroughout, correctionEveryRepeat, setBlendIn, recast, addTravel, rippleDelete, duplicateActions, actionLabel, clear, setPoseAt, removeKeyAt, moveKeyTo, moveKeysBy, setKeyEase as setTrackKeyEase, holdKeyFor, repeatAction as repeatTrack, keyAtTime, cutTo, removeCorrectionAt } from '../track';
import { Rig } from '../relations';
import { fromQuat, toQuat, facingOf } from '../pose';
import type { Store } from '../store';
import { strikeTime, REACT_LEAD } from '../strike';
import type { Action, Scene, Pose, Vec3, PropTarget, Marker } from '../types';
import { saveMotion } from './library';

/* The timeline: keys and actions moved, retimed, blended and recast; markers; the in and out, locked and muted rows. */

/** The playhead (on a frame; a still scene: 0), and its frame rate. */
export function here(store: Store) {
  const a = store.scene.animation;
  return a ? { t: snapTime(a, store.getState().time), fps: a.fps } : { t: 0, fps: 24 };
}

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
  const clip = src?.kind === 'clip' ? playedClip(src) : undefined;
  if (!act || !strike || !src || src.kind !== 'clip' || !clip) return null;
  const lands = strike.start + (src.lead ?? 0) + strikeTime(clip) / (src.speed ?? 1);
  moveAction(store, id, Math.max(0, lands - REACT_LEAD));
  // (Kept on its blow from now on, #23.)
  store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, actions: s.animation.actions.map((x) => (x.id === id ? { ...x, reactsTo: strikeId } : x)) } } : s));
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

/** Retime an action to last `duration`: a motion played faster or slower (see track.retimeAction). */
export function retime(store: Store, id: string, duration: number, key = '') {
  store.updateScene((s) => (s.animation ? keepPull(s, { ...s, animation: retimeAction(s.animation, id, duration) }, id) : s), key);
}

/** Trim an action's start or end to `t` (#22; see track.trimAction), its mark pulling it no more than it did. */
export function trim(store: Store, id: string, side: 'start' | 'end', t: number, key = '') {
  store.updateScene((s) => (s.animation ? keepPull(s, { ...s, animation: trimAction(s.animation, id, side, t) }, id) : s), key);
}

/** Split an action at the playhead (#22; see track.splitAction). Why not, if it can't be. */
export function splitAt(store: Store, id: string): string | null {
  const a = store.scene.animation;
  const t = store.getState().time;
  const why = a ? unsplittable(a, id, t) : 'Nothing to split';
  if (why) return why;
  store.updateScene((s) => (s.animation ? { ...s, animation: splitAction(s.animation, id, t) } : s));
  return null;
}

/** A repeated motion as one block per repeat (see track.splitRepeats). */
export function splitIntoRepeats(store: Store, id: string) {
  store.updateScene((s) => (s.animation ? { ...s, animation: splitRepeats(s.animation, id) } : s));
}

/** The part of a motion an action plays (#22; see track.playRange). */
export function setPlayRange(store: Store, id: string, from: number, to: number, key = '') {
  store.updateScene((s) => (s.animation ? keepPull(s, { ...s, animation: playRange(s.animation, id, from, to) }, id) : s), key);
}

/** Slip a motion: another part of it played where the block is (#22; see track.slipAction). */
export function slip(store: Store, id: string, by: number, key = '') {
  store.updateScene((s) => (s.animation ? keepPull(s, { ...s, animation: slipAction(s.animation, id, by) }, id) : s), key);
}

/**
 * A motion that now ends elsewhere by itself (played faster, trimmed, slipped): a mark set for it
 * moves as far, so it is pulled no more than it was, not held where it was, its steps sliding.
 */
function keepPull(s: Scene, next: Scene, id: string): Scene {
  const was = s.animation!.actions.find((x) => x.id === id);
  const now = next.animation!.actions.find((x) => x.id === id);
  if (!was || !now || was.source.kind !== 'clip' || !was.roles.some((r) => r.end)) return next;
  const roles = now.roles.map((r) => {
    if (!r.end) return r;
    const [a0, a1] = [naturalEnd(s, was, r.figure), naturalEnd(next, now, r.figure)];
    if (!a0 || !a1) return r;
    const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
    return { ...r, end: { at: [r3(r.end.at[0] + a1.at[0] - a0.at[0]), r3(r.end.at[1] + a1.at[1] - a0.at[1])] as [number, number], facing: Math.round(wrapDeg(r.end.facing + a1.facing - a0.facing) * 10) / 10 || 0 } };
  });
  return { ...next, animation: { ...next.animation!, actions: next.animation!.actions.map((x) => (x.id === id ? { ...x, roles } : x)) } };
}

/** Let a motion end where it takes the figure by itself: its mark goes (#18). */
export function clearMark(store: Store, id: string, figureId: string) {
  store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, actions: s.animation.actions.map((x) => (x.id !== id ? x : { ...x, roles: x.roles.map((r) => (r.figure === figureId ? { figure: r.figure } : r)) })) } } : s));
}

/** How near a motion edited as keys keeps to it: degrees for its bones, metres for where it is. */
const KEYS_NEAR = { deg: 2, m: 0.01 };

/**
 * A motion made into keys to edit freely (#23: Edit as keys): each person's own Posed block of its
 * poses, a key wherever its motion changes course (within 2° and 1 cm of it), its timing kept; where
 * it ends (its mark) as it was. What its motion did with a prop (a throw) is not kept.
 */
export function editAsKeys(store: Store, id: string): boolean {
  const s = store.scene;
  const a = s.animation;
  const act = a?.actions.find((x) => x.id === id);
  if (!a || !act || act.source.kind !== 'clip') return false;
  const frames = Math.max(1, Math.round(act.duration * a.fps));
  const made = act.roles.map((role) => {
    const poses = Array.from({ length: frames + 1 }, (_, i) => ({ t: act.start + Math.min(act.duration, i / a.fps), pose: actionPoseAt(s, act, role.figure, act.start + Math.min(act.duration, i / a.fps))! }));
    // (Kept: the first, the last, and wherever a straight run from the last kept would stray.)
    const near = (p: Pose, q: Pose) => Math.hypot(p.position[0] - q.position[0], p.position[1] - q.position[1], p.position[2] - q.position[2]) <= KEYS_NEAR.m
      && (Object.keys(p.bones) as (keyof Pose['bones'])[]).every((j) => !q.bones[j] || (fromQuat(p.bones[j]).angleTo(fromQuat(q.bones[j])) * 180) / Math.PI <= KEYS_NEAR.deg);
    const kept = [poses[0]];
    let from = 0;
    for (let j = 2; j < poses.length; j++) {
      const off = poses.slice(from + 1, j).some((k, n) => {
        const u = (n + 1) / (j - from);
        const between = { ...poses[from].pose, bones: Object.fromEntries((Object.keys(poses[from].pose.bones) as (keyof Pose['bones'])[]).filter((b) => poses[j].pose.bones[b]).map((b) => [b, toQuat(fromQuat(poses[from].pose.bones[b]).slerp(fromQuat(poses[j].pose.bones[b]), u))])) as Pose['bones'], position: poses[from].pose.position.map((v, i) => v + (poses[j].pose.position[i] - v) * u) as Vec3 };
        return !near(k.pose, between);
      });
      if (off) { kept.push(poses[j - 1]); from = j - 1; }
    }
    if (poses.length > 1) kept.push(poses[poses.length - 1]);
    return { ...keysAction(role.figure, kept), id: role.figure === act.roles[0].figure ? act.id : uid('act'), ...(act.blendIn ? { blendIn: act.blendIn } : {}) };
  });
  store.updateScene((x) => (x.animation ? { ...x, animation: { ...x.animation, actions: [...x.animation.actions.filter((y) => y.id !== id), ...made].sort((p, q) => p.start - q.start) } } : x));
  return true;
}

/** A reaction no longer kept on its blow (#23). */
export function unlinkReaction(store: Store, id: string) {
  store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, actions: s.animation.actions.map((x) => {
    if (x.id !== id) return x;
    const { reactsTo: _r, ...rest } = x;
    void _r;
    return rest;
  }) } } : s));
}

/**
 * A correction held over the whole of what it corrects, or changing it only around its edits (#23),
 * fading in and out over `reach` (s) either side of them.
 */
export function setCorrectionThroughout(store: Store, id: string, throughout: boolean, reach?: number, key = '') {
  store.updateScene((s) => (s.animation ? { ...s, animation: correctionThroughout(s, id, throughout, reach) } : s), key);
  store.setTime(store.getState().time);
}

/** A correction on a repeated motion put on the same moment of each of its repeats (#23). */
export function correctEveryRepeat(store: Store, id: string) {
  store.updateScene((s) => (s.animation ? { ...s, animation: correctionEveryRepeat(s, id) } : s));
  store.setTime(store.getState().time);
}

/** How much of an action over another (or a correction) shows, and what an action over another plays on (#23). */
export function setActionLook(store: Store, id: string, patch: { strength?: number; mask?: Action['mask'] | null }, key = '') {
  store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, actions: s.animation.actions.map((x) => {
    if (x.id !== id) return x;
    const next = { ...x };
    if (patch.strength !== undefined) {
      const k = Math.round(Math.min(1, Math.max(0, patch.strength)) * 100) / 100;
      if (k >= 1) delete next.strength;
      else next.strength = k;
    }
    if (patch.mask !== undefined) {
      if (patch.mask) next.mask = patch.mask;
      else delete next.mask;
    }
    return next;
  }) } } : s), key);
}

/** How an action's blend in goes (#23): smoothly (null), evenly, easing in or out. */
export function setBlendCurve(store: Store, id: string, curve: Action['blendCurve'] | null) {
  store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, actions: s.animation.actions.map((x) => {
    if (x.id !== id) return x;
    const { blendCurve: _c, ...rest } = x;
    void _c;
    return curve ? { ...rest, blendCurve: curve } : rest;
  }) } } : s));
}

/** How long an action blends in from what was before it (s). */
export function setBlend(store: Store, id: string, blendIn: number, key = '') {
  store.updateScene((s) => (s.animation ? { ...s, animation: setBlendIn(s.animation, id, blendIn) } : s), key);
}

/**
 * A clip action's speed (a clip that does not loop takes longer or shorter for it) and whether it
 * is mirrored (left for right).
 */
export function setClipOptions(store: Store, id: string, patch: { speed?: number; mirror?: boolean; seam?: number | null; alternate?: boolean; inPlace?: boolean; loops?: boolean }, key = '') {
  const act = actionById(store, id);
  if (act?.source.kind !== 'clip') return;
  const clip = playedClip(act.source);
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
      // (Between repeats, #23: a blend of its own, or (null) as it suits; every other one mirrored.)
      if (patch.seam !== undefined) {
        if (patch.seam === null) delete source.seam;
        else source.seam = Math.min(2, Math.max(0, Math.round(patch.seam * 100) / 100));
      }
      if (patch.alternate !== undefined) {
        if (patch.alternate) source.alternate = true;
        else delete source.alternate;
      }
      // (Going round, or done once: as the motion does by itself, nothing kept; going round, played whole, its repeats its laps.)
      if (patch.loops !== undefined) {
        if (patch.loops === !!clipById(x.source.clip)?.loop) delete source.loops;
        else source.loops = patch.loops;
        if (patch.loops) { delete source.repeat; delete source.seam; delete source.alternate; delete source.from; delete source.to; }
      }
      // (In place, #23: nowhere to be pulled to, its marks go.)
      if (patch.inPlace !== undefined) {
        if (!patch.inPlace) delete source.inPlace;
        else return { ...x, source: { ...source, inPlace: true }, roles: x.roles.map((r) => ({ figure: r.figure })) };
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

/** Take actions away, what follows moving up (#22: Shift + Delete; see track.rippleDelete). */
export function rippleDeleteActions(store: Store, ids: string[]) {
  store.updateScene((s) => (s.animation ? { ...s, animation: rippleDelete(s.animation, ids) } : s));
  store.setTime(store.getState().time);
}

/** Each action again right after itself (#22: Ctrl + D; see track.duplicateActions). */
export function duplicateBlocks(store: Store, ids: string[]) {
  store.updateScene((s) => (s.animation ? { ...s, animation: duplicateActions(s.animation, ids) } : s));
}

/** Blocks copied (#22): each with where its first person was and which way they faced as it began. */
let copied: { acts: Action[]; at: { x: number; z: number; facing: number }[] } | null = null;

/** Actions as copied (with where each began). */
export function copyOf(s: Scene, ids: string[]): NonNullable<typeof copied> | null {
  const all = s.animation?.actions ?? [];
  const picked = all.filter((x) => ids.includes(x.id));
  // (With the corrections on them, #23: they go where the blocks go.)
  const fixes = all.filter((x) => x.layer === 'correction' && !ids.includes(x.id) && picked.some((b) => !b.layer && b.roles[0].figure === x.roles[0].figure && x.start < b.start + b.duration - 1e-6 && x.start + x.duration > b.start + 1e-6));
  const acts = [...picked, ...fixes].sort((p, q) => p.start - q.start || (p.layer === 'correction' ? 1 : 0) - (q.layer === 'correction' ? 1 : 0));
  if (!acts.length) return null;
  return {
    acts: structuredClone(acts),
    at: acts.map((x) => {
      const p = figurePoseAt(s, x.roles[0].figure, x.start) ?? s.figures.find((f) => f.id === x.roles[0].figure)!;
      return { x: p.position[0], z: p.position[2], facing: facingOf(p.bones) };
    }),
  };
}

/** Copy actions (#22: Ctrl + C on blocks), to paste on someone at the playhead. How many. */
export function copyActions(store: Store, ids: string[]): number {
  copied = copyOf(store.scene, ids);
  return copied?.acts.length ?? 0;
}

/**
 * Give an action to another figure (#22: dragged onto their row), at the same time, from where they
 * are; `copy`: they do it too. One person's actions only (a motion of several is recast). Why not.
 */
export function giveAction(store: Store, id: string, figure: string, copy = false): string | null {
  const act = store.scene.animation?.actions.find((x) => x.id === id);
  if (!act) return 'Nothing to give';
  if (act.roles.length > 1) return 'A motion of several people is recast from its menu';
  if (act.roles[0].figure === figure) return null;
  const clip = copyOf(store.scene, [id])!;
  return store.group(() => {
    if (!copy) deleteAction(store, id);
    return pasteClip(store, clip, figure, act.start);
  });
}

export const hasCopiedActions = () => !!copied?.acts.length;

/**
 * Paste the copied actions on a figure from t (#22: Ctrl + V), in their timing: each from where its
 * person is then, turned their way (keys and marks moved and turned so); what they did there gives
 * way. A motion of several people goes on the figure and the nearest others. Why not, if it can't.
 */
export function pasteActions(store: Store, figure: string, t: number): string | null {
  return copied ? pasteClip(store, copied, figure, t) : 'Copy a block first (Ctrl + C on the timeline)';
}

function pasteClip(store: Store, clip: NonNullable<typeof copied>, figure: string, t: number): string | null {
  const base = clip.acts[0].start;
  let s = store.scene;
  let a = s.animation ?? newAnimation(s, 4);
  const made: string[] = [];
  for (const [i, act] of clip.acts.entries()) {
    const start = snapTime({ ...a, duration: MAX_DURATION }, t + act.start - base);
    s = { ...s, animation: a };
    const who = s.figures.find((f) => f.id === figure);
    if (!who) return 'Pick someone to paste on';
    // (The others of a motion of several: the nearest, as from the Library.)
    const here = figurePoseAt(s, figure, start) ?? who;
    const others = s.figures.filter((f) => f.id !== figure && !f.hidden)
      .map((f) => ({ f, d: Math.hypot((figurePoseAt(s, f.id, start) ?? f).position[0] - here.position[0], (figurePoseAt(s, f.id, start) ?? f).position[2] - here.position[2]) }))
      .sort((p, q) => p.d - q.d).map((x) => x.f.id);
    if (others.length < act.roles.length - 1) return `${actionLabel(act)} needs ${act.roles.length} people`;
    const cast = [figure, ...others.slice(0, act.roles.length - 1)];
    const from = clip.at[i];
    const deg = wrapDeg(facingOf(here.bones) - from.facing);
    const r = (deg * Math.PI) / 180;
    const place = (px: number, pz: number): [number, number] => {
      const [dx, dz] = [px - from.x, pz - from.z];
      return [dx * Math.cos(r) + dz * Math.sin(r) + here.position[0], -dx * Math.sin(r) + dz * Math.cos(r) + here.position[2]];
    };
    const moved = placeAnimation({ ...a, actions: [act] }, deg, place).actions[0];
    const pasted: Action = {
      ...moved,
      id: uid('act'),
      start,
      roles: moved.roles.map((role, k) => ({ figure: cast[k], ...(act.source.kind === 'travel' && role.end ? { end: role.end } : {}) })),
    };
    // (What they did there gives way; a correction goes on what it was pasted with.)
    if (act.layer !== 'correction') for (const f of cast) a = clear({ ...s, animation: a }, f, start, start + pasted.duration);
    a = { ...a, actions: [...a.actions, pasted].sort((p, q) => p.start - q.start), duration: Math.max(a.duration, Math.min(MAX_DURATION, start + pasted.duration)) };
    made.push(pasted.id);
  }
  store.updateScene((x) => ({ ...x, animation: a }));
  store.setTime(store.getState().time);
  if (made.length) store.select({ kind: 'action', action: made[0], figure, ...(made.length > 1 ? { also: made.slice(1) } : {}) });
  return null;
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
export function addKey(store: Store, figureIds?: string[]) {
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
export function deleteKey(store: Store, figureId = store.getState().activeFigure ?? undefined) {
  const t = store.getState().time;
  if (!figureId) return;
  store.updateScene((s) => (s.animation ? { ...s, animation: removeKeyAt(s.animation, figureId, t) } : s));
  store.setTime(t);
}

/** Keys copied (#22): a figure's poses at its picked keys, in their timing. */
let copiedKeys: Key[] | null = null;

/** Copy a figure's keys at these times (#22: Ctrl + C on picked keys). How many. */
export function copyKeys(store: Store, figure: string, times: number[]): number {
  const s = store.scene;
  const keys = [...times].sort((p, q) => p - q).flatMap((t) => { const pose = figurePoseAt(s, figure, t); return pose ? [{ t, pose }] : []; });
  copiedKeys = keys.length ? keys : null;
  return keys.length;
}

export const hasCopiedKeys = () => !!copiedKeys?.length;

/**
 * Paste the copied keys on a figure from t (#22: Ctrl + V; Ctrl + Shift + V `mirror`, left for
 * right): in their timing, from where the figure is then and turned its way; each as if posed there
 * (a key on a Posed block, a correction over a motion). Why not, if it can't.
 */
export function pasteKeys(store: Store, figure: string, t: number, mirror = false): string | null {
  const keys = copiedKeys;
  if (!keys) return 'Copy some keys first (Shift-click them, then Ctrl + C)';
  const s = store.scene;
  const here = figurePoseAt(s, figure, t);
  if (!s.animation || !here) return 'Animate the scene to paste keys';
  const ref = keys[0].pose;
  const turn = (deg: number, at: [number, number], to: [number, number]) => {
    const r = (deg * Math.PI) / 180;
    return (x: number, z: number): [number, number] => [(x - at[0]) * Math.cos(r) + (z - at[1]) * Math.sin(r) + to[0], -(x - at[0]) * Math.sin(r) + (z - at[1]) * Math.cos(r) + to[1]];
  };
  // To the first key's own frame (facing ahead, at the origin), mirrored there if asked, then to the figure's.
  let clip = placeClip(keysClip(keys.map((k) => ({ t: k.t - keys[0].t, pose: k.pose }))), -facingOf(ref.bones), turn(-facingOf(ref.bones), [ref.position[0], ref.position[2]], [0, 0]));
  if (mirror) clip = { ...clip, parts: [partFromPoses('Keys', partKeys(clip.parts[0]).map((k) => ({ ...k, pose: mirrored(k.pose) })), 'smooth')] };
  clip = placeClip(clip, facingOf(here.bones), turn(facingOf(here.bones), [0, 0], [here.position[0], here.position[2]]));
  const at = snapTime(s.animation, t);
  store.updateScene((x) => {
    let a = x.animation!;
    for (const k of partKeys(clip.parts[0])) a = setPoseAt({ ...x, animation: a }, figure, at + k.t, k.pose);
    return { ...x, animation: a };
  });
  store.setTime(store.getState().time);
  return null;
}

/** Delete a figure's keys at these times (#22: Delete on picked keys). */
export function deleteKeys(store: Store, figure: string, times: number[]) {
  store.updateScene((s) => (s.animation ? { ...s, animation: times.reduce((a, t) => removeKeyAt(a, figure, t), s.animation) } : s));
  store.setTime(store.getState().time);
}

/**
 * A figure's keys at `from` moved to `to` (the same count, in order: #22, picked keys scaled in
 * time). Each refused move (onto another key) leaves that key where it was. Where they are now.
 */
export function retimeKeys(store: Store, figure: string, from: number[], to: number[], key = ''): number[] {
  const a0 = store.scene.animation;
  if (!a0 || from.length !== to.length) return from;
  const pairs = from.map((f, i) => [f, snapTime(a0, to[i])] as const).sort((p, q) => p[0] - q[0]);
  // (Those moving later first, from the last; then those moving earlier, from the first.)
  const order = [...pairs.filter(([f, t]) => t > f).reverse(), ...pairs.filter(([f, t]) => t <= f)];
  const now = new Map(pairs.map(([f]) => [f, f]));
  store.updateScene((s) => {
    let a = s.animation!;
    for (const [f, t] of order) {
      const next = moveKeyTo(a, figure, f, t);
      if (next !== a) { a = next; now.set(f, t); }
    }
    return { ...s, animation: a };
  }, key);
  store.setTime(store.getState().time);
  return from.map((f) => now.get(f) ?? f);
}

/** Move several of a figure's keys in time together; returns whether they moved. */
export function moveKeys(store: Store, figure: string, times: number[], by: number, key = '') {
  const before = store.scene.animation;
  store.updateScene((s) => {
    const a = s.animation && moveKeysBy(s.animation, figure, times, by);
    return a && a !== s.animation ? { ...s, animation: a } : s;
  }, key);
  store.setTime(store.getState().time);
  return store.scene.animation !== before;
}

/** How a figure's key at t goes on to the next: smoothly, at an even speed, or held until the next (`step`). */
export function setKeyEase(store: Store, figure: string, t: number, ease: 'smooth' | 'linear' | 'step') {
  store.updateScene((s) => (s.animation ? { ...s, animation: setTrackKeyEase(s.animation, figure, t, ease) } : s));
  store.setTime(store.getState().time);
}

/** Hold a figure's key at t for `seconds` (a copy of it then; what comes after moves on). */
export function holdKey(store: Store, figure: string, t: number, seconds: number) {
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
export function moveKey(store: Store, from: number, to: number, figureId?: string) {
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

/** A marker at t (on a frame), named the next "Marker n". Its id. */
export function addMarker(store: Store, t: number, name?: string): string | null {
  const a = store.scene.animation;
  if (!a) return null;
  const at = snapTime(a, t);
  const existing = a.markers?.find((m) => Math.abs(m.t - at) < 0.5 / a.fps);
  if (existing) return existing.id;
  const mark = { id: uid('mark'), t: at, name: name?.trim().slice(0, 60) || nextName('Marker 1', (a.markers ?? []).map((m) => m.name)) };
  store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, markers: [...(s.animation.markers ?? []), mark].sort((p, q) => p.t - q.t) } } : s));
  return mark.id;
}

/** A marker moved to t, renamed, or (null) taken away. */
export function editMarker(store: Store, id: string, patch: { t?: number; name?: string; color?: Marker['color'] | null } | null, key = '') {
  store.updateScene((s) => {
    const a = s.animation;
    if (!a?.markers) return s;
    const markers = patch === null
      ? a.markers.filter((m) => m.id !== id)
      : a.markers.map((m) => {
        if (m.id !== id) return m;
        const next: Marker = { ...m, ...(patch.t !== undefined ? { t: snapTime(a, patch.t) } : {}), ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 60) || m.name } : {}) };
        if (patch.color === null) delete next.color;
        else if (patch.color) next.color = patch.color;
        return next;
      }).sort((p, q) => p.t - q.t);
    const { markers: _m, ...rest } = a;
    void _m;
    return { ...s, animation: markers.length ? { ...rest, markers } : rest };
  }, key);
}
/** The range's in (`'in'`) or out at t, the other kept if it can be (else the start or the end). */
export function setRangeAt(store: Store, which: 'in' | 'out', t: number) {
  store.updateScene((s) => {
    const a = s.animation;
    if (!a) return s;
    const at = snapTime(a, t);
    const was = a.range ?? { from: 0, to: a.duration };
    let range = which === 'in' ? { from: at, to: was.to } : { from: was.from, to: at };
    if (range.to - range.from < 0.1) range = which === 'in' ? { from: at, to: a.duration } : { from: 0, to: at };
    if (range.to - range.from < 0.1) return s;
    return { ...s, animation: { ...a, range } };
  }, 'range');
}

/** The range moved (both ends given), or (null) gone: the whole animation plays again. */
export function setRange(store: Store, range: { from: number; to: number } | null, key = 'range') {
  store.updateScene((s) => {
    const a = s.animation;
    if (!a) return s;
    const { range: _r, ...rest } = a;
    void _r;
    if (!range) return { ...s, animation: rest };
    const from = Math.max(0, Math.min(snapTime(a, range.from), a.duration - 0.1));
    const to = Math.max(from + 0.1, Math.min(snapTime(a, range.to), a.duration));
    return { ...s, animation: { ...rest, range: { from, to } } };
  }, key);
}

/** A person's row locked (nothing it does can be changed) or muted (what it does doesn't play), or not. */
export function setTrack(store: Store, figure: string, patch: { locked?: boolean; muted?: boolean }) {
  store.updateFigure(figure, (f) => {
    const next = { ...f, ...patch };
    if (!next.locked) delete next.locked;
    if (!next.muted) delete next.muted;
    return next;
  }, '');
}

export function cutAnimation(store: Store, duration: number) {
  store.updateScene((s) => cutTo(s, Math.max(0.2, duration)), 'anim-options');
  store.setTime(store.getState().time);
}
/** Remove a correction key of a figure at the playhead. */
export function deleteCorrection(store: Store, figureId: string, t: number) {
  store.updateScene((s) => (s.animation ? { ...s, animation: removeCorrectionAt(s.animation, figureId, t) } : s));
  store.setTime(store.getState().time);
}
