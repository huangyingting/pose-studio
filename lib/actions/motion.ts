import { wrapDeg } from '../joints';
import { newAnimation, snapTime } from '../animation';
import { BUILT_IN, clipById, hasClip } from '../assets';
import { figurePoseAt, actionsOf, warpOf, naturalEnd } from '../evaluate';
import { addTravel, insertClip, turnArriving, moments, ripple, setTravelMode, travelInto, moveMarkTo } from '../track';
import { legsOf, GAITS, flightTime, JUMP_PREP } from '../locomotion';
import LIBRARY_INDEX from '../../public/motions/index.json';
import { DEFAULT_BODY } from '../body';
import { facingOf } from '../pose';
import { MOTIONS } from '../motions';
import { forward } from '../relations';
import type { Store } from '../store';
import type { Issue } from '../qa';
import { REACT_LEAD } from '../strike';
import type { Travel } from '../types';
import { retime, setBlend, setClipOptions } from './timeline';

/* Animating a scene, and walking, running and jumping from mark to mark (lib/locomotion.ts). */

/** Turn the open pose into an animation (its current pose becomes the first key). */
export function startAnimation(store: Store, duration = 2) {
  store.updateScene((s) => (s.animation ? s : { ...s, animation: newAnimation(s, duration) }));
  store.setTime(0);
}
/**
 * Walk, run or jump a figure from where it is at the playhead to a floor point: a new mark. Its
 * later actions move on by the time it takes (the other figures are untouched); the playhead goes
 * to the new mark, so the next "…to here" continues from there. Walking and running face the way
 * they go unless `strafe` (side steps, backing up); a jump keeps the figure's facing.
 */
export function travelTo(store: Store, figureId: string, to: [number, number], kind: Travel, opts: { strafe?: boolean; height?: number } = {}) {
  if (!store.scene.animation) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
  // (A walk a short way back: stepping back, still facing the way it does, not turning round and back.)
  const here = figurePoseAt(store.scene, figureId, store.getState().time);
  if (here && kind === 'walk' && !opts.strafe) {
    const d = Math.hypot(to[0] - here.position[0], to[1] - here.position[2]);
    const heading = (Math.atan2(to[0] - here.position[0], to[1] - here.position[2]) * 180) / Math.PI;
    if (d > 0.05 && d <= BACK_STEP && Math.abs(wrapDeg(heading - facingOf(here.bones))) > 120) opts = { ...opts, strafe: true };
  }
  const done = addTravel(store.scene, figureId, store.getState().time, to, kind, opts);
  if (!done) return null;
  store.updateScene((s) => ({ ...s, animation: done.animation }));
  store.setTime(done.to);
  store.select({ kind: 'figure', figure: figureId });
  return { from: done.from, to: done.to };
}

/** The Library's strikes one figure can throw at another, and how the one struck takes each (#18). */
export const STRIKES: { id: string; name: string; reaction: string }[] = [
  { id: 'library:jab-cross', reaction: 'library:receive-punch-to-the-face' },
  { id: 'library:hook-punch', reaction: 'library:receive-punch-to-the-face' },
  { id: 'library:uppercut', reaction: 'library:receive-punch-to-the-face' },
  { id: 'library:roundhouse-kick', reaction: 'library:hit-reaction' },
].map((x) => ({ ...x, name: (LIBRARY_INDEX as unknown as { id: string; name: string }[]).find((m) => m.id === x.id)!.name }));
/** How far in front of someone's middle a blow lands on them (their chest, their face; m). */
const SURFACE = 0.14;

/**
 * `who` strikes `target` with one of the Library's strikes from the playhead, as the films stage
 * theirs: stepping (or running) in to where the blow reaches, turned so it lands on them, and the
 * one struck reacting as it lands. Its clips must be at hand (fetchLibraryClips). When the blow
 * lands (the playhead goes there), or null.
 */
export function strikeFigure(store: Store, who: string, target: string, strike: string): number | null {
  const how = STRIKES.find((x) => x.id === strike);
  const m = (LIBRARY_INDEX as unknown as { id: string; impact?: number; reach?: [number, number, number] }[]).find((x) => x.id === strike);
  if (!how || !m?.reach || m.impact === undefined || who === target || !hasClip(strike) || !hasClip(how.reaction)) return null;
  return store.group(() => {
    if (!store.scene.animation) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
    const t0 = store.getState().time;
    const me = figurePoseAt(store.scene, who, t0);
    const them = figurePoseAt(store.scene, target, t0);
    if (!me || !them) return null;
    const legs = legsOf(me.body).rootY;
    const [rx, rz] = [m.reach![0] * legs, m.reach![2] * legs];
    const [mx, mz, tx, tz] = [me.position[0], me.position[2], them.position[0], them.position[2]];
    const d0 = Math.hypot(mx - tx, mz - tz);
    const back: [number, number] = d0 > 1e-3 ? [(mx - tx) / d0, (mz - tz) / d0] : [Math.sin((facingOf(them.bones) * Math.PI) / 180), Math.cos((facingOf(them.bones) * Math.PI) / 180)];
    // Where the blow lands on them, and where it is thrown from: as far back from that as it reaches.
    const hit: [number, number] = [tx + back[0] * SURFACE, tz + back[1] * SURFACE];
    const far = Math.hypot(rx, rz);
    const at: [number, number] = [Math.round((hit[0] + back[0] * far) * 100) / 100, Math.round((hit[1] + back[1] * far) * 100) / 100];
    const facing = (Math.atan2(hit[0] - at[0], hit[1] - at[1]) - Math.atan2(rx, rz)) * (180 / Math.PI);
    const d = Math.hypot(at[0] - mx, at[1] - mz);
    if (d > 0.1) travelTo(store, who, at, d > 3 ? 'run' : 'walk');
    turnTo(store, who, facing);
    const start = store.getState().time;
    if (!applyMotion(store, who, strike)) return null;
    const lands = start + m.impact!;
    store.setTime(Math.max(0, snapTime(store.scene.animation!, lands - REACT_LEAD)));
    applyMotion(store, target, how.reaction);
    store.setTime(snapTime(store.scene.animation!, lands));
    store.select({ kind: 'figure', figure: who });
    return lands;
  });
}

/**
 * The fix the motion check offers for an issue (#18), if there is one: a foot sliding as a motion
 * is turned to face another way steps round first instead; a pop where an action starts eases
 * into it for longer.
 */
export function issueFix(store: Store, issue: Issue): { label: string; run(): void } | null {
  const a = store.scene.animation;
  if (!a) return null;
  const mine = actionsOf(a, issue.figure);
  if (issue.kind === 'slide') {
    // (Its motion, or the one it ends as its last frames are drawn: a frame or two after it, its feet still on it.)
    const act = mine.find((x) => x.source.kind === 'clip' && x.start <= issue.start + 1e-6 && issue.start < x.start + x.duration + 2 / a.fps);
    const w = act && warpOf(store.scene, act, issue.figure);
    if (!act || !w || w.angle < 10) return null;
    return {
      label: 'Step round instead',
      run: () => store.group(() => {
        const want = act.roles.find((r) => r.figure === issue.figure)!.end!.facing;
        // (Turned first, stepping round; then the motion as it goes by itself from there.)
        store.setTime(act.start);
        turnTo(store, issue.figure, want);
        const moved = store.scene.animation!.actions.find((x) => x.id === act.id)!;
        const natural = naturalEnd(store.scene, moved, issue.figure);
        if (natural) {
          store.updateScene((s) => ({ ...s, animation: { ...s.animation!, actions: s.animation!.actions.map((x) => (x.id !== act.id ? x : { ...x, roles: x.roles.map((r) => (r.figure === issue.figure && r.end ? { ...r, end: { ...r.end, facing: natural.facing } } : r)) })) } }));
        }
      }),
    };
  }
  if (issue.kind === 'pop') {
    const act = mine.find((x) => !x.layer && x.source.kind === 'clip' && Math.abs(x.start - issue.start) < 0.4 && (x.blendIn ?? 0) < 0.5);
    if (act) return { label: 'Ease into it', run: () => setBlend(store, act.id, 0.5) };
    // (At a repeat's start, #23: a blend between the repeats.)
    const rep = mine.find((x) => x.source.kind === 'clip' && (x.source.repeat ?? 1) > 1 && x.start < issue.start && issue.start < x.start + x.duration
      && Array.from({ length: (x.source as { repeat: number }).repeat - 1 }, (_, k) => x.start + ((k + 1) * x.duration) / (x.source as { repeat: number }).repeat).some((s) => Math.abs(s - issue.start) < 0.4));
    if (rep) return { label: 'Blend between the repeats', run: () => setClipOptions(store, rep.id, { seam: 0.3 }) };
    return null;
  }
  return null;
}

/** How far back a walk steps back, still facing the way it does (m). */
const BACK_STEP = 1;

/**
 * Turn a figure from the playhead to face a floor point (or a facing, degrees), stepping round where
 * it stands. The playhead goes to where it has turned. Whether it turned (already facing it: no).
 */
export function turnTo(store: Store, figureId: string, toward: [number, number] | number) {
  if (!store.scene.animation) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
  const here = figurePoseAt(store.scene, figureId, store.getState().time);
  if (!here) return false;
  const facing = typeof toward === 'number' ? toward : (Math.atan2(toward[0] - here.position[0], toward[1] - here.position[2]) * 180) / Math.PI;
  if (Math.abs(wrapDeg(facing - facingOf(here.bones))) < 5) return false;
  // (Just arrived by walking or running there: the walk turns as it arrives instead, its last steps taking it round.)
  const arriving = turnArriving(store.scene, figureId, snapTime(store.scene.animation!, store.getState().time), facing);
  if (arriving) {
    store.updateScene((s) => ({ ...s, animation: arriving }));
    store.select({ kind: 'figure', figure: figureId });
    return true;
  }
  const done = addTravel(store.scene, figureId, store.getState().time, [here.position[0], here.position[2]], 'walk', { facing: Math.round(wrapDeg(facing) * 10) / 10 || 0 });
  if (!done) return false;
  store.updateScene((s) => ({ ...s, animation: done.animation }));
  store.setTime(done.to);
  store.select({ kind: 'figure', figure: figureId });
  return true;
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

/** A walk or run's steps: one of the Library's captured cycles (#26), or (null) generated. */
export function setGait(store: Store, id: string, gait: string | null) {
  store.group(() => {
    store.updateScene((s) => (s.animation ? { ...s, animation: { ...s.animation, actions: s.animation.actions.map((x) => {
      if (x.id !== id || x.source.kind !== 'travel' || x.source.mode === 'jump') return x;
      const { gait: _g, ...rest } = x.source;
      void _g;
      return { ...x, source: gait && GAITS[x.source.mode].includes(gait) ? { ...rest, gait } : rest };
    }) } } : s));
    // (At the cycle's own pace: as far as the way goes, at the speed its person walked it, scaled to the figure's legs.)
    const act = store.scene.animation?.actions.find((x) => x.id === id);
    const m = (LIBRARY_INDEX as unknown as { id: string; duration: number; move: [number, number] }[]).find((x) => x.id === gait);
    const f = act && store.scene.figures.find((x) => x.id === act.roles[0].figure);
    if (act?.source.kind === 'travel' && act.source.gait && m && f) {
      const from = figurePoseAt(store.scene, f.id, act.start)!.position;
      const marks = [[from[0], from[2]], ...(act.source.via ?? []).map((v) => v.at), act.roles[0].end?.at ?? [from[0], from[2]]];
      const way = marks.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - marks[i][0], p[1] - marks[i][1]), 0);
      const speed = (Math.hypot(...m.move) / m.duration) * (legsOf(f.body).rootY / legsOf(DEFAULT_BODY).rootY);
      if (way > 0.05 && speed > 0.1) retime(store, id, Math.round((way / speed) * 24) / 24);
    }
  });
  store.setTime(store.getState().time);
}

/** The Steps last chosen for a walk and for a run (#26), which Walk here and Run here take (kept in the browser). */
const STEPS_KEY = (mode: 'walk' | 'run') => `pose-studio-steps-${mode}`;
export function rememberSteps(mode: 'walk' | 'run', gait: string | null) {
  try { localStorage.setItem(STEPS_KEY(mode), gait ?? ''); } catch { /* ignore */ }
}
export function lastSteps(mode: 'walk' | 'run'): string | null {
  const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(STEPS_KEY(mode));
  return v && GAITS[mode].includes(v) ? v : null;
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
