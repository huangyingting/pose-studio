import type { JointName, Vec3 } from './types';

/*
 * Idle life (#14): what a figure does in the gaps between what it is given to do, so no one in a
 * scene stands frozen: breathing, small shifts of weight, the arms hanging loose, and now and then
 * a look at someone nearby. It is worked out from the time and the figure alone (the same every
 * time: a scene plays and exports the same), as small turns added to the pose it holds, never a
 * step away from its place. It shows when a scene plays or is exported, not while posing.
 */

/** A number in 0…1 from a figure's id and a salt: its own phases and periods. */
function seed(id: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** A period fitted to a loop of `cycle` seconds (a whole number of times round in it), or as it is (no loop). */
const fit = (period: number, cycle: number) => (cycle > 0 ? cycle / Math.max(1, Math.round(cycle / period)) : period);

/** A slow, smooth wander in −1…1 about `period` seconds long (a few sines at the figure's own phases). */
function wander(id: string, salt: number, t: number, period: number, cycle: number) {
  const w = (k: number, p: number) => Math.sin((2 * Math.PI * t) / fit(p, cycle) + 2 * Math.PI * seed(id, salt + k));
  return (w(1, period) * 0.55 + w(2, period * 1.618) * 0.3 + w(3, period * 2.71) * 0.15);
}

/** How long a glance lasts, and how often one comes (s). */
const GLANCE = { length: 1.8, every: 9 };

/**
 * A look now: how far into it (0…1, eased in and out) the figure is at t, or 0 between looks.
 * Looks come every `GLANCE.every` seconds or so, each at the figure's own moment.
 */
export function glanceAt(id: string, t: number, cycle = 0): number {
  const every = fit(GLANCE.every * (0.8 + 0.4 * seed(id, 7)), cycle);
  // (A loop too short to look away and back now and then: no looks.)
  if (every < GLANCE.length * 3) return 0;
  const u = (t + every * seed(id, 8)) % every;
  if (u > GLANCE.length) return 0;
  const x = u / GLANCE.length;
  // Turn there, hold, turn back.
  return x < 0.25 ? smooth(x / 0.25) : x > 0.75 ? smooth((1 - x) / 0.25) : 1;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * The turns idle life adds at t (degrees, per joint's sliders): breathing in the chest (the upper
 * chest and shoulders rising with it), a slow
 * sway of weight through the spine (the hips and legs stay, so the feet do), the head drifting,
 * the arms hanging loose.
 */
export function idleTurns(id: string, t: number, cycle = 0): Partial<Record<JointName, Vec3>> {
  const breath = Math.sin((2 * Math.PI * t) / fit(3.6 + seed(id, 1), cycle) + 2 * Math.PI * seed(id, 2));
  const sway = wander(id, 10, t, 7, cycle);
  const drift = wander(id, 20, t, 5, cycle);
  const nod = wander(id, 30, t, 6, cycle);
  return {
    chest: [breath * 1.4, 0, sway * 0.4],
    // (Breathing in lifts the upper chest and the shoulders a little, #30.)
    upperChest: [-breath * 0.8, 0, 0],
    leftShoulder: [0, 0, breath * 0.7],
    rightShoulder: [0, 0, -breath * 0.7],
    spine: [breath * 0.5, drift * 0.8, sway * 0.9],
    neck: [nod * 1.2, drift * 2, 0],
    head: [nod * 1.5, drift * 3, sway * 1.2],
    leftUpperArm: [wander(id, 40, t, 6, cycle) * 1.5, 0, breath * 0.6 + 0.5],
    rightUpperArm: [wander(id, 50, t, 6, cycle) * 1.5, 0, -breath * 0.6 - 0.5],
    leftLowerArm: [wander(id, 60, t, 8, cycle) * 2, 0, 0],
    rightLowerArm: [wander(id, 70, t, 8, cycle) * 2, 0, 0],
  };
}

/** How far a glance turns the head toward someone (degrees, + to the figure's left), at most this. */
export const GLANCE_TURN = 35;
