import * as THREE from 'three';
import { clampRotation, sided, wrapDeg } from './joints';
import { angleToQuat, bonesOf, type Angles } from './pose';
import { scaleOf } from './mannequin';
import { Rig } from './relations';
import type { BodyParams, Figure, Hand, JointName, Side, Travel, Vec3 } from './types';

/*
 * Locomotion: a Travel action's walk, run or jump from the pose it leaves in to the pose it
 * arrives in (lib/evaluate.ts gives both): its legs, its root and the swing of its arms are
 * generated along the way.
 *
 * As in games: steps advance with the distance travelled (not the time), and every footfall is a
 * fixed point on the floor, so a planted foot never slides; the legs reach their foot targets by
 * two-bone IK. A jump follows gravity: the longer it is in the air, the higher it goes.
 *
 * A walk or run can pass other marks on its way (waypoints). A figure faces where it goes, or
 * (strafe) keeps the marks' facings: side steps, backing up. Feet stand on whatever is under
 * them: the floor, or the top of a box or a step (`ground`). Inside, poses are joint angles.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
export const GRAVITY = 9.81;

/** The highest step up a walk or run takes onto a prop, as a share of the leg's length. */
const MAX_STEP_UP = 0.55;

/** Typical speeds (m/s for a 1.8 m figure), used to time a new walk or run. */
const SPEED: Record<Exclude<Travel, 'jump'>, number> = { walk: 1.35, run: 3.6 };

/** Time a jump spends in the air to rise `h` metres (and back to the same height). */
export const flightTime = (h: number) => Math.sqrt((8 * Math.max(0.02, h)) / GRAVITY);
/** Height of a jump with `t` seconds in the air. */
export const jumpHeight = (t: number) => (GRAVITY * t * t) / 8;
/** Crouch before and absorb after a jump, at most (s): about a real person's (the captured jump's, played over it). */
export const JUMP_PREP = 0.45;
/** Default jump height (metres the body rises). */
const JUMP_HEIGHT = 0.45;

/** How long a figure takes to walk or run `distance` metres, or to jump `height` high. */
export function travelTime(kind: Travel, distance: number, body: BodyParams, height = JUMP_HEIGHT, sideways = 0) {
  if (kind === 'jump') return flightTime(height) + 2 * JUMP_PREP;
  const legs = legsOf(body);
  const scale = (legs.thigh + legs.shin) / 0.85;
  // Side-stepping is slower than walking (short steps that do not cross).
  const speed = SPEED[kind] * scale / (kind === 'walk' ? 1 + 2 * sideways : 1);
  return Math.max(0.6, distance / speed + (kind === 'run' ? 0.45 : 0.35));
}

/** Height of what stands under a floor point (0: the floor). */
export type Ground = (x: number, z: number) => number;
const FLOOR: Ground = () => 0;

/** The lengths a figure moves with, measured once per body. */
interface Legs {
  thigh: number;
  shin: number;
  /** Pelvis (root) height when standing. */
  rootY: number;
  /** Ankle height above the floor with the foot flat. */
  ankleY: number;
  /** Hip joint below the pelvis, and out to the side. */
  hipDrop: number;
  hipX: number;
  /** Ankle to the ball of the foot. */
  foot: number;
}

const legsCache = new Map<string, Legs>();

export function legsOf(body: BodyParams): Legs {
  const key = JSON.stringify(body);
  let legs = legsCache.get(key);
  if (legs) return legs;
  const rig = new Rig();
  try {
    const m = rig.model({
      id: 'legs', name: '', body, bones: {}, position: [0, 0, 0], grounded: true,
      hands: { L: { curl: [0, 0, 0, 0, 0], spread: 0 }, R: { curl: [0, 0, 0, 0, 0], spread: 0 } },
    });
    const at = (j: JointName) => m.joints[j].getWorldPosition(m.joints[j].position.clone());
    const root = at('hips');
    const hip = at('leftUpperLeg');
    const knee = at('leftLowerLeg');
    const ankle = at('leftFoot');
    legs = {
      thigh: hip.distanceTo(knee),
      shin: knee.distanceTo(ankle),
      rootY: root.y,
      ankleY: ankle.y,
      hipDrop: root.y - hip.y,
      hipX: Math.abs(hip.x - root.x),
      foot: 0.13 * scaleOf(body),
    };
  } finally {
    rig.dispose();
  }
  legsCache.set(key, legs);
  return legs;
}

/** A pose in joint angles, as locomotion works with it. */
export interface AnglePose {
  joints: Angles;
  position: Vec3;
  hands: Record<Side, Hand>;
  grounded: boolean;
}

/** Where a pose puts the ankles (world), cached per pose: walks start and end on them. */
const feetCache = new WeakMap<AnglePose, Record<'L' | 'R', [number, number, number]>>();

function keyedFeet(body: BodyParams, pose: AnglePose) {
  let feet = feetCache.get(pose);
  if (feet) return feet;
  const rig = new Rig();
  try {
    const m = rig.model({ id: 'feet', name: '', body, bones: bonesOf(pose.joints), position: pose.position, hands: pose.hands, grounded: pose.grounded });
    const at = (j: 'leftFoot' | 'rightFoot') => {
      const p = m.joints[j].getWorldPosition(m.joints[j].position.clone());
      return [p.x, p.y, p.z] as [number, number, number];
    };
    feet = { L: at('leftFoot'), R: at('rightFoot') };
  } finally {
    rig.dispose();
  }
  feetCache.set(pose, feet);
  return feet;
}

/* ---------- a travel ---------- */

/** A walk, run or jump from one pose to another. */
export interface Chain {
  kind: Travel;
  t0: number;
  t1: number;
  start: AnglePose;
  end: AnglePose;
  /** Floor points of the way, start to end (the marks passed on the way between). */
  path: [number, number][];
  /** The facing at each point of the path (turned to from mark to mark when strafing). */
  yaws: number[];
  /** Keep the marks' facings on the way (side steps, backing up) instead of facing where it goes. */
  strafe?: boolean;
  /** A jump's turns in the air: about the vertical (spin) and head over heels (flip, + forwards). */
  spin?: number;
  flip?: number;
  /** The captured cycle it goes with (#26), and which way it goes from the facing (keeping it: back 180, left 90, right -90). None: a jump, or its cycle not at hand yet. */
  cycle?: Cycle;
  way?: number;
  /** A jump's body, a real person's (their take-off, flight and landing): the jump's way, height and turns its own. None: not at hand yet. */
  leap?: Leap;
  /** A turn on the spot's steps and body, a real person's turning (their rhythm, which foot when, the body leading): the turn's angle and footing its own. */
  twist?: Twist;
  /** It holds something on the way (a stretcher, a ball): its hips, back and arms as posed, not the walking person's. */
  holding?: boolean;
}

/**
 * A captured turn on the spot as a turn's steps and body (lib/evaluate.ts twistOf): poses by the
 * clip's time (turned the way the turn goes), and when each foot is off the floor. A turn further
 * than it goes takes it twice.
 */
export interface Twist {
  at(u: number): AnglePose;
  duration: number;
  swings: { side: 'L' | 'R'; start: number; end: number }[];
}
/** The Library's turn on the spot every turn goes with (a real person's, to the left; mirrored to the right). */
export const TWIST_CLIP = 'library:turn-90-left';

/**
 * A captured jump as a jump's body (lib/evaluate.ts leapOf): poses by the clip's time, and when
 * its feet leave the floor and come down again. The jump keeps its own path, height and turns
 * (under gravity, to the mark, spins and flips): the person's crouch, swing, tuck and landing are
 * played over them, each phase in the jump's time.
 */
export interface Leap {
  at(u: number): AnglePose;
  takeoff: number;
  landing: number;
  duration: number;
}
/** The Library's jump every jump goes with: a real person's, jumping up from where they stand. */
export const LEAP_CLIP = 'library:standing-jump';
/** How long a jump's legs take to come off the floor and onto it again (s of its flight). */
const LEG_EASE = 0.15;
const LEG_JOINTS: JointName[] = ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'leftToes', 'rightToes'];
/** How much of a captured jump after it lands is played as the jump lands (s: the rest is standing up again). */
const LEAP_LANDING = 0.6;

/** The Library's captured cycles a walk or a run can go with (#26), the first the usual one. */
export const GAITS: Record<'walk' | 'run', readonly string[]> = {
  walk: ['library:walk', 'library:walk-forward', 'library:happy-walk', 'library:crouch-walk-forward'],
  run: ['library:jog-forward', 'library:run-forward', 'library:sprint'],
};
/** The steps a walk or run takes unless others are chosen: a real person's. */
export const CAPTURED_STEPS: Record<'walk' | 'run', string> = { walk: 'library:walk', run: 'library:run-forward' };

/** The captured steps a walk or run goes with: those chosen, else a real person's walk or run; a jump has none. */
export function gaitOf(src: { mode: Travel; gait?: string }): string | null {
  if (src.mode === 'jump') return null;
  return src.gait && GAITS[src.mode].includes(src.gait) ? src.gait : CAPTURED_STEPS[src.mode];
}

/**
 * The cycles a walk or run with captured steps goes with where it keeps its facing (#26): backing
 * up (the Library's only walk backward is a sneak, so every walk backs up as one), and stepping sideways (to
 * the left as captured; to the right, mirrored).
 */
export const GAIT_WAYS: Record<'walk' | 'run', { back: Record<string, string>; side: string }> = {
  walk: { back: Object.fromEntries(GAITS.walk.map((g) => [g, 'library:walk-backward'])), side: 'library:walk-left' },
  run: { back: Object.fromEntries(GAITS.run.map((g) => [g, 'library:run-backward'])), side: 'library:strafe-left' },
};

/** The recordings walks, runs, jumps and turns go with unless others are chosen: brought to hand as a project opens (lib/store.ts), before anyone moves. */
export const PRIMITIVES = [...new Set([
  ...Object.values(CAPTURED_STEPS), ...Object.values(GAIT_WAYS).flatMap((w) => [...Object.values(w.back), w.side]), LEAP_CLIP, TWIST_CLIP,
])];

/** Which way a travel keeping its facing goes, from start to end, against that facing (on the whole). */
export function wayOf(path: [number, number][], yaws: number[]): 'forward' | 'back' | 'left' | 'right' {
  const [a, b] = [path[0], path[path.length - 1]];
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return 'forward';
  const facing = Math.atan2(yaws.reduce((n, y) => n + Math.sin(y * D2R), 0), yaws.reduce((n, y) => n + Math.cos(y * D2R), 0)) * R2D;
  const off = wrapDeg(yawOf([b[0] - a[0], b[1] - a[1]]) - facing);
  return Math.abs(off) <= 45 ? 'forward' : Math.abs(off) >= 135 ? 'back' : off > 0 ? 'left' : 'right';
}

/**
 * A captured walk or run cycle (one lap of a Library motion that goes round): its pose at a time
 * of the lap (in joint angles), the lap's length (s), how far a lap goes and which way it faces
 * (for its own body), its body, and when each foot is on the floor.
 */
export interface Cycle {
  at(u: number): AnglePose;
  duration: number;
  stride: number;
  facing: number;
  /** Which way a lap goes (its own heading: a captured sideways walk's body is turned from it). */
  heading: number;
  body: BodyParams;
  contacts: { side: 'L' | 'R'; start: number; end: number }[];
  /** How far ahead of the root a foot comes down (m, at the cycle's body's size; on average). */
  reach: number;
}

/* ---------- geometry helpers ---------- */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (u: number) => { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpAngle = (a: number, b: number, u: number) => wrapDeg(a + wrapDeg(b - a) * u);
const r1 = (v: number) => Math.round(v * 10) / 10 || 0;

/** A polyline on the floor, walked by arc length (and extrapolated past its ends). */
function polyline(points: [number, number][]) {
  const segs = points.slice(1).map((p, i) => {
    const q = points[i];
    const len = Math.hypot(p[0] - q[0], p[1] - q[1]);
    return { from: q, len, dir: len > 1e-6 ? [(p[0] - q[0]) / len, (p[1] - q[1]) / len] as [number, number] : null };
  });
  const length = segs.reduce((n, s) => n + s.len, 0);
  const dirs = segs.map((s) => s.dir).filter((d): d is [number, number] => !!d);
  const first = dirs[0] ?? [0, 1];
  const last = dirs[dirs.length - 1] ?? first;
  const point = (s: number): [number, number] => {
    if (s <= 0) return [points[0][0] + first[0] * s, points[0][1] + first[1] * s];
    let rest = s;
    for (const g of segs) {
      if (rest <= g.len && g.dir) return [g.from[0] + g.dir[0] * rest, g.from[1] + g.dir[1] * rest];
      rest -= g.len;
    }
    const end = points[points.length - 1];
    return [end[0] + last[0] * rest, end[1] + last[1] * rest];
  };
  /** Direction of travel at s, rounded over corners. */
  const direction = (s: number): [number, number] => {
    const a = point(s - 0.3);
    const b = point(s + 0.3);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return len > 1e-6 ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : first;
  };
  return { length, point, direction };
}

const yawOf = (d: [number, number]) => Math.atan2(d[0], d[1]) * R2D;
const leftOf = (yaw: number): [number, number] => [Math.cos(yaw * D2R), -Math.sin(yaw * D2R)];

/**
 * Leg IK: hip (pitch, spread), knee and ankle angles that put the ankle at `t` — given in the
 * pelvis's own frame from the hip joint (x left, y up, z forward) — with the foot level.
 */
function legAngles(legs: Legs, t: [number, number, number], pitch: number) {
  const { thigh: l1, shin: l2 } = legs;
  const len = clamp(Math.hypot(...t), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.99995);
  const knee = Math.acos(clamp((len * len - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1));
  // The leg in its own plane, straight down with the shin bent back by the knee.
  const yc = -l1 - l2 * Math.cos(knee);
  const zc = -l2 * Math.sin(knee);
  const spread = Math.asin(clamp(t[0] / -yc, -1, 1));
  const swing = Math.atan2(t[2], t[1]) - Math.atan2(zc, yc * Math.cos(spread));
  const hip = wrapDeg(swing * R2D);
  return { hip: [hip, 0, spread * R2D] as Vec3, knee: knee * R2D, ankle: [-(pitch + hip + knee * R2D), 0, -spread * R2D] as Vec3 };
}

/** A world offset seen from the pelvis (yaw, then pitch, then roll): [left, up, forward]. */
function toPelvis(d: [number, number, number], yaw: number, pitch: number, roll = 0): [number, number, number] {
  const c = Math.cos(yaw * D2R);
  const s = Math.sin(yaw * D2R);
  const x = d[0] * c - d[2] * s;
  const z = d[0] * s + d[2] * c;
  const p = pitch * D2R;
  const y = d[1] * Math.cos(p) + z * Math.sin(p);
  const r = roll * D2R;
  return [x * Math.cos(r) + y * Math.sin(r), -x * Math.sin(r) + y * Math.cos(r), -d[1] * Math.sin(p) + z * Math.cos(p)];
}

/* ---------- the generated pose ---------- */

/** The pose at t along a travel: `pose` (the upper body on the way) with the legs, root and arm swing generated. */
export function locomote(chain: Chain, body: BodyParams, t: number, pose: AnglePose, ground: Ground = FLOOR): AnglePose {
  if (chain.t1 - chain.t0 < 1e-3) return pose;
  // At the marks it starts and ends at, the figure is as posed there (standing on the floor).
  if (Math.abs(t - chain.t0) < 1e-6 || Math.abs(t - chain.t1) < 1e-6) return pose;
  const legs = legsOf(body);
  if (chain.kind === 'jump') return jump(chain, legs, t, pose, ground, body);
  if (pivots(chain)) return pivot(chain, legs, t, pose, ground, body);
  return chain.cycle ? cycleGait(chain, legs, t, pose, ground, body) : gait(chain, legs, t, pose, ground, body);
}

/**
 * How far the hips are keyed turned from the facing at a travel's start and its end (degrees): a
 * person standing at ease may stand with them turned from where they face (a captured idle, 40°
 * and more). The hips go from and to that, not from the facing in a frame.
 */
const atEase = (c: Chain) => ({
  from: c.start.joints.hips ? wrapDeg(c.start.joints.hips[1] - c.yaws[0]) : 0,
  to: c.end.joints.hips ? wrapDeg(c.end.joints.hips[1] - c.yaws[c.yaws.length - 1]) : 0,
});

/** How far a travel turns from its start to its end (degrees, + to the left). */
const turnOf = (c: Chain) => wrapDeg(c.yaws[c.yaws.length - 1] - c.yaws[0]);
/** Whether a walk or run is a turn where it stands: (nearly) nowhere to go, another way to face. */
const pivots = (c: Chain) => {
  const [a, b] = [c.path[0], c.path[c.path.length - 1]];
  return Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05 && Math.abs(turnOf(c)) > 5;
};
/** How far a turn on the spot goes round with each step (degrees; a foot, stepping every other one, goes twice as far). */
const PIVOT_STEP = 40;
/** How long each step of a turn on the spot takes (s). */
const PIVOT_TIME = 0.27;
/** How long a turn on the spot takes (s): a step for every PIVOT_STEP round, and one more. */
export function turnTime(degrees: number) {
  return Math.max(0.6, (Math.ceil(Math.abs(degrees) / PIVOT_STEP) + 1) * PIVOT_TIME);
}

/**
 * A turn on the spot: a real person's steps round (which foot when, as they did it), each set down
 * turned a little further about where the body stands, the last two where the end key has its
 * feet. Planted feet stay put; the body turns smoothly over it all. (Before the recording has come,
 * the feet turn with the body.)
 */
function pivot(c: Chain, legs: Legs, t: number, pose: AnglePose, ground: Ground, body: BodyParams): AnglePose {
  const dur = c.t1 - c.t0;
  const u = clamp((t - c.t0) / dur, 0, 1);
  const by = turnOf(c);
  const [x, z] = [lerp(c.start.position[0], c.end.position[0], smooth(u)), lerp(c.start.position[2], c.end.position[2], smooth(u))];
  // (The hips as keyed at either end, atEase, the feet turning about the facings.)
  const yaw = lerpAngle(c.yaws[0], c.yaws[c.yaws.length - 1], smooth(u)) + atEase(c).from * (1 - smooth(u)) + atEase(c).to * smooth(u);
  const onGround = (key: AnglePose, side: 'L' | 'R'): [number, number, number] => {
    const k = keyedFeet(body, key)[side];
    return key.grounded ? [k[0], k[1] + ground(key.position[0], key.position[2]), k[2]] : k;
  };
  // Where a foot stands turned `share` of the way round: its start place turned about where the body
  // stands, drawn over the turn to where the end key has it (there at the end).
  const startOf = { L: onGround(c.start, 'L'), R: onGround(c.start, 'R') };
  const arc = (side: 'L' | 'R', share: number): [number, number, number] => {
    const f = startOf[side];
    const [ox, oz] = [f[0] - c.start.position[0], f[2] - c.start.position[2]];
    const r = by * share * D2R;
    const [cx, cz] = [lerp(c.start.position[0], c.end.position[0], share), lerp(c.start.position[2], c.end.position[2], share)];
    return [cx + ox * Math.cos(r) + oz * Math.sin(r), f[1], cz - ox * Math.sin(r) + oz * Math.cos(r)];
  };
  const endOf = { L: onGround(c.end, 'L'), R: onGround(c.end, 'R') };
  const off = { L: arc('L', 1).map((v, i) => endOf.L[i] - v), R: arc('R', 1).map((v, i) => endOf.R[i] - v) };
  // (On the floor where it stood until its last step sets it where the end key has it, raised or not.)
  const turned = (side: 'L' | 'R', share: number): [number, number, number] => {
    const [x, , z] = arc(side, share);
    return [x + off[side][0] * share, share >= 1 ? endOf[side][1] : startOf[side][1], z + off[side][2] * share];
  };
  // Steps, each when its foot is off the floor, going on round by an even share (the last of each
  // foot's lands where the end key has it): a real person's turning (which foot when, as they did
  // it; twice round for more than a quarter and a half).
  const twist = c.twist;
  const laps = twist && Math.abs(by) > 135 ? 2 : 1;
  const steps = !twist ? [] : Array.from({ length: laps }, (_, l) => twist.swings.map((w) => ({ side: w.side, a: (l + w.start / twist.duration) / laps, b: (l + w.end / twist.duration) / laps }))).flat();
  const n = steps.length;
  const share = (j: number) => (j >= n - 2 ? 1 : (j + 1) / (n - 1));
  // (The body as the person turning carries it: their back, arms and head; the legs go where the steps put them.)
  // (Coming over to it from how the turn sets off, and back to how it ends, over a moment: not snapped.)
  if (twist) {
    const { hips: _h, leftUpperLeg: _a, rightUpperLeg: _b, leftLowerLeg: _c, rightLowerLeg: _d, leftFoot: _e, rightFoot: _f, ...upper } = twist.at(((u * laps) % 1 || (u >= 1 ? 1 : 0)) * twist.duration).joints;
    void [_h, _a, _b, _c, _d, _e, _f];
    const ease = Math.min(UPPER_EASE, dur / 2);
    const w = Math.min(smooth((u * dur) / ease), smooth(((1 - u) * dur) / ease));
    pose = mixPoses(pose, { ...pose, joints: { ...pose.joints, ...upper } }, w);
  }
  const feet = {} as Record<'L' | 'R', { world: [number, number, number]; swing: number }>;
  for (const side of ['L', 'R'] as const) {
    if (!twist) {
      feet[side] = { world: turned(side, smooth(u)), swing: 0 };
      continue;
    }
    const mine = steps.map((x, j) => ({ ...x, j })).filter((x) => x.side === side);
    const step = mine.find((x) => u > x.a && u < x.b);
    const done = mine.filter((x) => u >= x.b);
    const was = done.length ? share(done[done.length - 1].j) : 0;
    if (!step) {
      feet[side] = { world: turned(side, was), swing: 0 };
      continue;
    }
    const now = step.j;
    const q = clamp((u - step.a) / (step.b - step.a), 0, 1);
    const k = smoother(q);
    // (Round the body, not across it: the foot follows the turn.)
    const at = turned(side, lerp(was, share(now), k));
    const y = lerp(turned(side, was)[1], turned(side, share(now))[1], k);
    const up = 0.05 * (legs.thigh + legs.shin) * bump(q);
    feet[side] = { world: [at[0], y + up, at[2]], swing: bump(q) };
  }
  const floor = Math.min(feet.L.world[1], feet.R.world[1]) - legs.ankleY;
  const y = pose.grounded ? floor + legs.rootY : pose.position[1];
  const out = compose(pose, legs, {
    position: [x, y, z], yaw, pitch: pose.joints.hips?.[0] ?? 0, roll: pose.joints.hips?.[2] ?? 0, feet,
  });
  // (A real person's within our ranges, as their walks are.)
  if (twist) for (const j of Object.keys(out.joints) as JointName[]) if (j !== 'hips') out.joints[j] = clampRotation(j, out.joints[j]!);
  return out;
}

/** Where a foot goes: on the floor (level when planted), or stepping (hanging as it swings, 0 to 1). */
type FootGoal = { world: [number, number, number]; swing: number };

interface Generated {
  position: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  /** null: the keyed leg as it is. */
  feet: Record<'L' | 'R', FootGoal | null>;
}

/** Write a generated root and legs into a pose. */
function compose(pose: AnglePose, legs: Legs, g: Generated): AnglePose {
  const joints: Record<string, Vec3> = { ...(structuredClone(pose.joints) as Record<string, Vec3>) };
  joints.hips = [r1(wrapDeg(g.pitch)), r1(wrapDeg(g.yaw)), r1(g.roll)];
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const foot = g.feet[side];
    if (foot) {
      const off = toPelvis([foot.world[0] - g.position[0], foot.world[1] - g.position[1], foot.world[2] - g.position[2]], g.yaw, g.pitch, joints.hips[2]);
      let target: [number, number, number] = [off[0] - s * legs.hipX, off[1] + legs.hipDrop, off[2]];
      // A planted foot behind the hip and out of reach rolls onto its toes: the heel lifts.
      let heel = 0;
      if (target[2] < 0) {
        const reach = (legs.thigh + legs.shin) * 0.985;
        const flat = Math.hypot(target[0], target[2]);
        const need = -Math.sqrt(Math.max(0, reach * reach - flat * flat)) - target[1];
        // Only for a foot well behind (standing feet stay flat), easing in with the distance.
        if (need > 0) {
          heel = Math.min(need, 0.6 * legs.foot) * smooth(-target[2] / (0.25 * (legs.thigh + legs.shin)));
          target = [target[0], target[1] + heel, target[2] + heel * 0.35];
        }
      }
      const ik = legAngles(legs, target, g.pitch);
      joints[sided('UpperLeg', side)] = ik.hip.map(r1) as Vec3;
      joints[sided('LowerLeg', side)] = [r1(ik.knee), 0, 0];
      // Planted: level with the floor (or up on its toes). Swinging: the foot follows the shin, toes
      // down a little.
      const tiptoe = heel > 0 ? Math.asin(clamp(heel / legs.foot, 0, 1)) * R2D : 0;
      const ankle = lerp(ik.ankle[0] + tiptoe, 12, foot.swing);
      // (Rolled to stay flat on the floor no further than an ankle rolls.)
      joints[sided('Foot', side)] = [r1(clamp(ankle, -40, 60)), 0, r1(clamp(ik.ankle[2] * (1 - foot.swing), -35, 35))];
      // Up on its toes, they bend back at the ball of the foot, flat on the floor (#30).
      if (tiptoe > 0) joints[sided('Toes', side)] = [r1(-clamp(tiptoe * (1 - foot.swing), 0, 50)), 0, 0];
    }
  }
  const clean = Object.fromEntries(Object.entries(joints).filter(([, v]) => v.some((x) => x !== 0))) as Angles;
  return { ...pose, joints: clean, position: g.position.map((v) => Math.round(v * 1000) / 1000) as Vec3, grounded: false };
}

/** Smooth 0→1 with zero speed and acceleration at both ends. */
const smoother = (u: number) => { const x = clamp(u, 0, 1); return x * x * x * (x * (6 * x - 15) + 10); };
/** 0→1→0 with zero speed at both ends. */
const bump = (u: number) => (1 - Math.cos(2 * Math.PI * clamp(u, 0, 1))) / 2;
/** A soft minimum (no corner where one limit takes over from the other). */
const softMin = (a: number, b: number, k = 0.015) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));
/** Cubic Hermite from (y0, slope m0) to (y1, slope m1) over u in [0, 1]. */
const hermite01 = (y0: number, m0: number, y1: number, m1: number, u: number) => {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * m1;
};

/** How much of a path goes sideways to the way the body faces along it (0 forward or back, 1 sideways). */
function sidewaysShare(line: ReturnType<typeof polyline>, D: number, yawAt: (arc: number) => number) {
  return Math.max(...[0.1, 0.3, 0.5, 0.7, 0.9].map((u) => {
    const d = line.direction(u * D);
    const l = leftOf(yawAt(u * D));
    return Math.abs(d[0] * l[0] + d[1] * l[1]);
  }));
}

/**
 * The plan of a walk or run along a chain: its speed profile, step length and footsteps (as
 * 3ds Max's Biped plans them): whole steps of equal length along the path, feet alternating, the
 * first leaving from the standing spot and the last closing the feet together at the end. Each
 * step swings while the body covers a fixed stretch of the path, centred on the other foot: in a
 * walk the stretches never overlap (one foot is always down), in a run they do (both feet in the
 * air). Footfalls are fixed points on the floor: nothing slides.
 */
function planGait(c: Chain, legs: Legs, ground: Ground, body: BodyParams) {
  const line = polyline(c.path);
  const D = line.length;
  const dur = c.t1 - c.t0;
  const run = c.kind === 'run';
  const leg = legs.thigh + legs.shin;
  // Speed: a ramp up at the start, a ramp down at the end, steady in between.
  const ramp = Math.min(run ? 0.45 : 0.35, dur / 3);
  const v = D / Math.max(1e-3, dur - ramp);
  const distance = (tau: number) => (tau < ramp ? (v * tau * tau) / (2 * ramp) : tau > dur - ramp ? D - (v * (dur - tau) ** 2) / (2 * ramp) : v * (tau - ramp / 2));
  // Longer steps at higher speed, as people do.
  const scale = leg / 0.85;
  // (With a captured cycle, its own steps: half its lap's stride, scaled to the legs, #26.)
  const step = c.cycle
    ? (c.cycle.stride * (legs.rootY / legsOf(c.cycle.body).rootY)) / 2
    : run
      ? clamp(1.15 * leg * Math.sqrt(v / (SPEED.run * scale)), 0.6 * leg, 2 * leg)
      : clamp(0.72 * leg * Math.sqrt(v / (SPEED.walk * scale)), 0.25 * leg, 1 * leg);
  const stance = run ? 0.38 : 0.62;
  const startYaw = c.yaws[0];
  const endYaw = c.yaws[c.yaws.length - 1];
  const strafe = !!c.strafe;
  // Which way the body faces at a point of the path: along it, or (strafing) turning from each
  // mark's keyed facing to the next's over the way between them.
  const marks = c.path.map((_, i) => c.path.slice(1, i + 1).reduce((n, p, j) => n + Math.hypot(p[0] - c.path[j][0], p[1] - c.path[j][1]), 0));
  const yawAt = (arc: number) => {
    if (!strafe && D >= 0.05) return yawOf(line.direction(arc));
    if (D <= 1e-3) return endYaw;
    let i = 0;
    while (i < marks.length - 2 && marks[i + 1] < arc) i++;
    const seg = marks[i + 1] - marks[i];
    return lerpAngle(c.yaws[i], c.yaws[i + 1], seg > 1e-6 ? clamp((arc - marks[i]) / seg, 0, 1) : 1);
  };
  const width = legs.hipX * (run ? 0.6 : 0.9);
  // Walking sideways, a step moves less than the feet are apart, so the legs never cross (a
  // runner may cross over, as in sport).
  const sideways = run || D < 0.05 ? 0 : sidewaysShare(line, D, yawAt);
  const n = Math.max(1, Math.round(D / (sideways > 0.2 ? Math.min(step, (1.8 * width) / sideways) : step)));
  const len = D / n;
  // How far past a footfall the body is as the next comes down: with a captured cycle going
  // forwards or back, as far as its foot comes down ahead of the body (scaled to the legs and the
  // step), so the captured foot lands where the plan has it. (Stepping sideways, a leading foot and
  // a trailing one: no one reach.)
  const timed = !!c.cycle && Math.abs(c.way ?? 0) !== 90;
  const ahead = timed ? (c.cycle!.reach * (legs.rootY / legsOf(c.cycle!.body).rootY) * len) / step : stance * len;
  const half = len - clamp(ahead, 0.15 * len, 0.75 * len);
  type Step = { side: 'L' | 'R'; from: number; to: number; s0: number; s1: number };
  const place = (arc: number, side: 'L' | 'R') => {
    const [px, pz] = line.point(arc);
    const l = leftOf(yawAt(arc));
    const sgn = side === 'L' ? 1 : -1;
    return [px + l[0] * sgn * width, pz + l[1] * sgn * width] as const;
  };
  // A foot does not come down just short of a step up (its shin would go into the edge as the
  // body goes over it): it comes down far enough back, its toes and shin clear.
  const clear = legs.foot + 0.1 * leg;
  const shortOf = (arc: number, side: 'L' | 'R', after: number) => {
    const here = ground(...place(arc, side));
    for (let d = 0.02; d < clear; d += 0.02) {
      if (ground(...place(arc + d, side)) > here + 0.02) return Math.max(after + 0.05 * leg, arc + d - clear);
    }
    return arc;
  };
  const steps: Step[] = [];
  const last: Record<'L' | 'R', number> = { L: 0, R: 0 };
  for (let k = 1; k <= n + 1; k++) {
    const side = k % 2 === 1 ? 'R' : 'L';
    const to = k * len < D - 1e-6 ? Math.min(k * len, shortOf(k * len, side, Math.max(last.L, last.R))) : D;
    const centre = (k - 1) * len;
    const s0 = k === 1 ? 0 : Math.max(steps[steps.length - 1].s0 + 1e-3, centre - half);
    // The first step lands with the body `half` along, as every later one does past its centre.
    const s1 = k === 1 ? Math.max(1e-3, half) : k === n + 1 ? D : centre + half;
    steps.push({ side, from: last[side], to, s0, s1: Math.max(s0 + 1e-3, s1) });
    last[side] = to;
  }
  // Standing at either end: exactly where the keyed pose has its feet, on what is under them (a
  // grounded key stands on the floor, or on top of a box or step).
  const onGround = (key: AnglePose, side: 'L' | 'R'): [number, number, number] => {
    const k = keyedFeet(body, key)[side];
    return key.grounded ? [k[0], k[1] + ground(key.position[0], key.position[2]), k[2]] : k;
  };
  // What each step stands on: a top under it, unless that is higher than a step up from the foot
  // before (then it stays on its level, and the motion check says it walks through the prop).
  const levels = new Map<string, number>();
  let support = Math.min(onGround(c.start, 'L')[1], onGround(c.start, 'R')[1]) - legs.ankleY;
  for (const st of steps) {
    if (st.to >= D - 1e-6) break;
    const g = ground(...place(st.to, st.side));
    support = g - support > MAX_STEP_UP * leg ? support : g;
    levels.set(`${st.side}${st.to}`, support);
  }
  const spot = (arc: number, side: 'L' | 'R'): [number, number, number] => {
    if (arc <= 1e-6) return onGround(c.start, side);
    if (arc >= D - 1e-6) return onGround(c.end, side);
    const [fx, fz] = place(arc, side);
    return [fx, (levels.get(`${side}${arc}`) ?? ground(fx, fz)) + legs.ankleY, fz];
  };
  return { line, D, dur, run, ramp, distance, scale, step, stance, len, half, timed, width, steps, spot, yawAt, startYaw, endYaw, strafe };
}

/** Where a figure's feet will land on its walks and runs (drawn on the floor while editing). */
export function footprints(chains: Chain[], body: BodyParams, ground: Ground = FLOOR) {
  const legs = legsOf(body);
  const out: { x: number; z: number; yaw: number; side: 'L' | 'R' }[] = [];
  for (const c of chains) {
    if (c.kind === 'jump') continue;
    const p = planGait(c, legs, ground, body);
    for (const st of p.steps) {
      const [x, , z] = p.spot(st.to, st.side);
      out.push({ x, z, yaw: st.to >= p.D - 1e-6 ? p.endYaw : p.yawAt(st.to), side: st.side });
    }
  }
  return out;
}

/** Walking or running along the chain's path before its captured steps have come: the feet stepping where the plan has them, the body as keyed. */
function gait(c: Chain, legs: Legs, t: number, pose: AnglePose, ground: Ground, body: BodyParams): AnglePose {
  return walking(c, legs, t, pose, ground, body).pose;
}

/** The walk's pose, and where its feet are (world) and how far through a swing each is (0 planted). */
function walking(c: Chain, legs: Legs, t: number, pose: AnglePose, ground: Ground, body: BodyParams) {
  const plan = planGait(c, legs, ground, body);
  const { line, D, dur, run, ramp, scale, len, half, width, steps, spot, yawAt, startYaw, endYaw } = plan;
  const tau = clamp(t - c.t0, 0, dur);
  const s = plan.distance(tau);
  // (The captured steps come in and out with the speed.)
  const w = D < 0.05 ? 0 : Math.min(smooth(tau / ramp), smooth((dur - tau) / ramp));
  const lift = (run ? 0.2 : 0.07) * scale;

  // Facing: where it goes (turning from the start key, and to the end key's facing at the end),
  // or, strafing, the keyed facing all the way.
  // (From and to the way the hips are keyed, atEase: they turn on into the way it goes, not in a frame.)
  const turn = Math.min(0.35, dur / 3);
  const ease = atEase(c);
  const keyedYaw = pose.joints.hips?.[1] ?? 0;
  const yaw = D < 0.05
    ? keyedYaw
    : plan.strafe
      ? yawAt(s)
      : lerpAngle(lerpAngle(startYaw, yawAt(s), smooth(tau / turn)), endYaw, smooth(1 - (dur - tau) / turn))
        + ease.from * (1 - smooth(tau / turn)) + ease.to * smooth(1 - (dur - tau) / turn);
  const [x, z] = line.point(s);
  // (Leaning as the captured steps do.)
  const pitch = pose.joints.hips?.[0] ?? 0;
  const roll = pose.joints.hips?.[2] ?? 0;

  // (Where each foot is, how far through a swing (0: planted), and how far up or down the step it is taking goes.)
  const feet = {} as Record<'L' | 'R', { world: [number, number, number]; swing: number; rise?: number }>;
  // The level each foot stands on, or is stepping to (eased over the swing, without its lift).
  const level = {} as Record<'L' | 'R', number>;
  for (const side of ['L', 'R'] as const) {
    const mine = steps.filter((st) => st.side === side);
    const now = mine.find((st) => s > st.s0 && s < st.s1);
    if (!now) {
      const done = mine.filter((st) => s >= st.s1);
      feet[side] = { world: spot(done.length ? done[done.length - 1].to : 0, side), swing: 0 };
      level[side] = feet[side].world[1];
      continue;
    }
    const q = (s - now.s0) / (now.s1 - now.s0);
    const a = spot(now.from, side);
    const b = spot(now.to, side);
    // (Easing in and out fully, so it is over its footfall before it is down: it does not slide in.)
    const k = smoother(q);
    // Up over the swing (and over a step up).
    const up = (lift * Math.min(1, (now.to - now.from) / (2 * len) + 0.35) + Math.max(0, b[1] - a[1])) * bump(q);
    feet[side] = { world: [lerp(a[0], b[0], k), lerp(a[1], b[1], k) + up, lerp(a[2], b[2], k)], swing: bump(q), rise: Math.abs(b[1] - a[1]) };
    level[side] = lerp(a[1], b[1], smoother(q));
  }

  // Pelvis: the height of a walking body follows a smooth wave (the "compass gait"): lowest as
  // the front heel lands, highest passing over the planted foot; a runner is lowest mid-stance and
  // highest in the air. The walk's dip is just deep enough for the landing leg to reach the floor.
  // The level is the lower foot's (feet stand on what is under them), so a step up raises the body
  // over the trailing foot's step, not all at once when the pelvis passes an edge.
  const floor = Math.min(level.L, level.R) - legs.ankleY;
  const reach = (legs.thigh + legs.shin) * 0.985;
  const hipUp = legs.hipDrop * Math.cos(pitch * D2R);
  let y: number;
  // Height at which a leg reaches a foot `ahead` of the hip (knees a little bent when running).
  const strikeAt = (ahead: number, give: number) => legs.ankleY + Math.sqrt(Math.max(0, (reach * give) ** 2 - ahead * ahead - (legs.hipX - width) ** 2)) + hipUp;
  if (run) {
    // Lowest mid-stance (over the planted foot), highest in the air; the landing foot, ahead of
    // the body, is just within reach of a slightly bent leg.
    const dip = 0.05 * scale;
    const ahead = len - half;
    const top = Math.min(legs.rootY * 0.97, strikeAt(ahead, 0.97) + dip * (1 + Math.cos((2 * Math.PI * ahead) / len)) / 2);
    y = floor + top - dip * (1 + Math.cos((2 * Math.PI * s) / len)) / 2;
  } else {
    const base = legs.rootY * 0.975;
    const ahead = len - half;
    const strike = strikeAt(ahead, 1);
    const dip = clamp(base - strike + 0.005, 0.008 * scale, 0.07 * scale);
    // Heels land when the body is `half` past each footfall.
    y = floor + base - dip * (1 + Math.cos((2 * Math.PI * (s - half)) / len)) / 2;
  }
  const keyedY = pose.grounded ? floor + legs.rootY : pose.position[1];
  y = lerp(keyedY, y, w);
  // Safety: never higher than a planted foot ahead can reach (steps onto props; slowing to a stop,
  // the body rising to stand before it is over the last step).
  for (const side of ['L', 'R'] as const) {
    const { world: f, swing } = feet[side];
    const off = toPelvis([f[0] - x, 0, f[2] - z], yaw, 0);
    const lateral = off[0] - (side === 'L' ? 1 : -1) * legs.hipX;
    const fwd = off[2] + legs.hipDrop * Math.sin(pitch * D2R);
    const horizontal = Math.min(reach * 0.9, Math.hypot(fwd, lateral));
    const limit = f[1] + Math.sqrt(reach * reach - horizontal * horizontal) + hipUp;
    y = lerp(y, softMin(y, limit + 0.01, 0.03), (1 - swing) * smooth(fwd / (0.15 * len)));
  }

  const out = compose(pose, legs, { position: [x, y, z], yaw, pitch, roll, feet });
  // Setting off and coming to rest, standing where the keyed pose has its feet: the ankles ease
  // from and into the keyed ones (a wide stance's feet rolled as it has them, not as level as the
  // legs would put them), so they do not snap where the actions before and after take over. (The
  // ankles only: the feet stay where they are.)
  const keyed = D < 0.05 ? 0 : 1 - smooth(Math.min(tau, dur - tau) / Math.min(0.25, ramp));
  if (keyed > 0) {
    for (const side of ['L', 'R'] as const) {
      const j = sided('Foot', side);
      const [g, k] = [out.joints[j] ?? [0, 0, 0], pose.joints[j] ?? [0, 0, 0]];
      out.joints[j] = g.map((v, i) => r1(v + wrapDeg(k[i] - v) * keyed)) as Vec3;
    }
  }
  return { pose: out, feet, plan, s, w, floor };
}

/**
 * A captured cycle from one lap of a motion that goes round (its pose at a time of the lap), or
 * null if it goes nowhere (not a walk or a run): how far a lap goes, which way it faces on the
 * whole, and when each foot is down — near its lowest, found round the lap (a contact may run on
 * past the lap's end into its start).
 */
export function makeCycle(at: (u: number) => AnglePose, duration: number, body: BodyParams): Cycle | null {
  const [a, b] = [at(0), at(duration)];
  const stride = Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]);
  if (stride < 0.2 || duration < 0.2) return null;
  const n = 48;
  const poses = Array.from({ length: n }, (_, i) => at((duration * i) / n));
  const yaws = poses.map((p) => (p.joints.hips?.[1] ?? 0) * D2R);
  const facing = Math.atan2(yaws.reduce((x, y) => x + Math.sin(y), 0), yaws.reduce((x, y) => x + Math.cos(y), 0)) * R2D;
  const contacts: Cycle['contacts'] = [];
  // (Each sample's ankles, the root over the origin, on one rig.)
  const rig = new Rig();
  const ankles = poses.map((p) => {
    const m = rig.model({ id: 'cycle', name: '', body, bones: bonesOf(p.joints), position: [0, p.position[1], 0], hands: p.hands, grounded: false });
    const at = (j: 'leftFoot' | 'rightFoot') => m.joints[j].getWorldPosition(new THREE.Vector3());
    return { L: at('leftFoot'), R: at('rightFoot') };
  });
  rig.dispose();
  const heights = ankles.map((a) => ({ L: a.L.y, R: a.R.y }));
  const heading = yawOf([b.position[0] - a.position[0], b.position[2] - a.position[2]]);
  const ahead = (v: THREE.Vector3) => v.x * Math.sin(heading * D2R) + v.z * Math.cos(heading * D2R);
  for (const side of ['L', 'R'] as const) {
    // (Lowest within 2.5 cm is down.)
    const ys = heights.map((h) => h[side]);
    const low = Math.min(...ys);
    const down = ys.map((y) => y < low + 0.025);
    if (down.every(Boolean) || !down.some(Boolean)) continue;
    // (From where a run of down samples begins after an up one, round the lap.)
    for (let i = 0; i < n; i++) {
      if (!down[i] || down[(i - 1 + n) % n]) continue;
      let j = i;
      while (down[(j + 1) % n] && j - i < n) j++;
      contacts.push({ side, start: (duration * i) / n, end: (duration * (j + 1)) / n });
    }
  }
  const downs = contacts.map((x) => ahead(ankles[Math.round((x.start / duration) * n) % n][x.side]));
  const reach = downs.length ? downs.reduce((x, y) => x + y, 0) / downs.length : stride / 4;
  return { at, duration, stride, facing, heading, body, contacts, reach };
}

/**
 * Walking or running along the chain's path with a captured cycle (#26), as games drive one: the
 * walk's plan as generated (the path, how fast along it, and where every foot comes down: the
 * cycle's own steps, scaled to the figure), the body the cycle's, played in place at the phase
 * the distance covered gives (its feet coming down as the plan's do), turned along the path with
 * its own sway. A planted foot is held by IK where the plan has it (round a turn too: it does not
 * slide); a swinging leg is the cycle's. Setting off and coming to rest, it blends from and into
 * the generated walk, which starts and ends on the keyed poses.
 */
function cycleGait(c: Chain, legs: Legs, t: number, pose: AnglePose, ground: Ground, body: BodyParams): AnglePose {
  const cyc = c.cycle!;
  const { pose: generated, feet, plan, s, w, floor } = walking(c, legs, t, pose, ground, body);
  if (plan.D < 0.05 || w <= 0) return generated;
  const k = legs.rootY / legsOf(cyc.body).rootY;
  // (A lap every two of the plan's steps: its own, a little longer or shorter to fit the way evenly.)
  const stride = 2 * plan.len;
  // The phase: the cycle's right foot comes down where the plan's does (its first, `half` along).
  const right = cyc.contacts.find((x) => x.side === 'R');
  const offset = (right ? right.start / cyc.duration : 0) - plan.half / stride;
  const laps = s / stride + offset;
  const q = cyc.at((laps - Math.floor(laps)) * cyc.duration);
  const hips = q.joints.hips ?? [0, 0, 0];
  const yaw = generated.joints.hips?.[1] ?? 0;
  // (Its root where the plan has it on the floor, at the cycle's height over what it stands on: the
  // body rising and falling with its own steps, a runner's in the air when the feet are.)
  // (Turned so that its own way goes the path's: the body as turned from it as the captured one's.)
  // (Keeping its facing, it keeps looking where it did: not over its shoulder where the captured
  // person backing up or side-stepping looked.)
  const look = c.way ? { neck: pose.joints.neck ?? [0, 0, 0], head: pose.joints.head ?? [0, 0, 0] } : {};
  // (Holding something, the hips as the plan has them: the person's sway would swing what is held.)
  const out: AnglePose = { ...q, joints: { ...q.joints, ...look, hips: c.holding ? generated.joints.hips ?? [0, yaw, 0] : [hips[0], wrapDeg(yaw + (c.way ?? 0) + hips[1] - cyc.heading), hips[2]] }, position: [generated.position[0], floor + q.position[1] * k, generated.position[2]], hands: pose.hands, grounded: false };
  // (The legs take the captured steps as the speed comes up; the arms and back come over to them,
  // and back to what comes next, more slowly: an arm raised for what comes next is not dropped and
  // raised again in a few frames.)
  const u = Math.max(plan.ramp, Math.min(UPPER_EASE, plan.dur / 2));
  const tau = clamp(t - c.t0, 0, plan.dur);
  const wu = Math.min(w, smooth(tau / u), smooth((plan.dur - tau) / u));
  const mixed = mixPoses(generated, out, w);
  const upper = mixPoses(generated, out, c.holding ? 0 : wu);
  for (const j of UPPER) if (upper.joints[j]) mixed.joints[j] = upper.joints[j];
  // Planted feet held where the plan has them; swinging, the cycle's legs (eased onto the hold as
  // they come down, and off it as they leave the floor: when the plan's step says so, and the
  // person's where the plan is timed by their steps).
  const phase = (laps - Math.floor(laps)) * cyc.duration;
  const down = (side: 'L' | 'R') => Math.max(0, ...cyc.contacts.filter((x) => x.side === side).map((x) => {
    const off = Math.min(...[-cyc.duration, 0, cyc.duration].map((d) => Math.max(0, x.start + d - phase, phase - (x.end + d))));
    return 1 - smooth(off / CONTACT_EASE);
  }));
  // (A step up or down: the foot taken over the edge as the plan lifts it, not through it as the person's level steps would.)
  for (const side of ['L', 'R'] as const) {
    const held = (1 - smooth(feet[side].swing * 2.5)) * (plan.timed ? lerp(1, down(side), w) : 1);
    plantLeg(mixed, legs, side, feet[side].world, Math.max(held, smooth((feet[side].rise ?? 0) / STEP_RISE)));
  }
  // (Every joint within its range: a captured one past ours, as recorded and retargeted, would read as bent too far.)
  for (const j of Object.keys(mixed.joints) as JointName[]) if (j !== 'hips') mixed.joints[j] = clampRotation(j, mixed.joints[j]!);
  return mixed;
}

/** A step up or down this high (m) or more is taken as the plan lifts the foot, over the edge. */
const STEP_RISE = 0.06;

/** How long a captured foot takes onto the floor and off it (s of its lap): its leg eases onto and off where the plan holds it. */
const CONTACT_EASE = 0.06;

/** How long a captured walk's upper body takes to come over from what it set off in, and back to what it arrives in (s, at most half the walk). */
const UPPER_EASE = 0.5;
const UPPER: JointName[] = ['spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'];

/** A leg's angles turned towards reaching `world` with its ankle (two-bone IK), by `weight`. */
function plantLeg(p: AnglePose, legs: Legs, side: 'L' | 'R', world: [number, number, number], weight: number) {
  if (weight <= 0) return;
  const hips = p.joints.hips ?? [0, 0, 0];
  const s = side === 'L' ? 1 : -1;
  const off = toPelvis([world[0] - p.position[0], world[1] - p.position[1], world[2] - p.position[2]], hips[1], hips[0], hips[2]);
  const ik = legAngles(legs, [off[0] - s * legs.hipX, off[1] + legs.hipDrop, off[2]], hips[0]);
  const mix = (j: JointName, to: Vec3) => {
    const from = p.joints[j] ?? [0, 0, 0];
    p.joints[j] = from.map((v, i) => r1(v + wrapDeg(to[i] - v) * weight)) as Vec3;
  };
  mix(sided('UpperLeg', side), ik.hip);
  mix(sided('LowerLeg', side), [ik.knee, 0, 0]);
  mix(sided('Foot', side), [clamp(ik.ankle[0], -40, 60), 0, clamp(ik.ankle[2], -35, 35)]);
}

/** Two poses mixed (joint angles the short way round, the root in between): `w` of the second. */
function mixPoses(a: AnglePose, b: AnglePose, w: number): AnglePose {
  if (w >= 1) return b;
  const joints: Record<string, Vec3> = {};
  for (const j of new Set([...Object.keys(a.joints), ...Object.keys(b.joints)])) {
    const [p, q] = [(a.joints as Record<string, Vec3>)[j] ?? [0, 0, 0], (b.joints as Record<string, Vec3>)[j] ?? [0, 0, 0]];
    joints[j] = p.map((v, i) => r1(v + wrapDeg(q[i] - v) * w)) as Vec3;
  }
  return { ...b, joints: joints as Angles, position: a.position.map((v, i) => v + (b.position[i] - v) * w) as Vec3 };
}

/**
 * A jump from the chain's start to its end: crouch, fly under gravity, land. It can take off from
 * and land on a raised surface; `spin` and `flip` (whole turns) rotate it on the way. Every phase
 * hands over to the next at the same height and speed, so nothing snaps.
 */
function jump(c: Chain, legs: Legs, t: number, pose: AnglePose, ground: Ground, body: BodyParams): AnglePose {
  const dur = c.t1 - c.t0;
  const tau = clamp(t - c.t0, 0, dur);
  const prep = Math.min(JUMP_PREP, dur * 0.28);
  const land = Math.min(JUMP_PREP, dur * 0.28);
  const flight = Math.max(0.05, dur - prep - land);
  const [ax, az] = c.path[0];
  const [bx, bz] = c.path[c.path.length - 1];
  const ga = ground(ax, az);
  const gb = ground(bx, bz);
  // Under gravity from the take-off height to the landing height in `flight` seconds.
  // Leave and meet the floor with the knees a little bent (a straight leg reacts too sharply).
  const soft = 0.035 * (legs.thigh + legs.shin) / 0.85;
  const y0 = ga + legs.rootY - soft;
  const y1 = gb + legs.rootY - soft;
  const vy = (y1 - y0) / flight + (GRAVITY * flight) / 2;
  const vLand = vy - GRAVITY * flight;
  const startYaw = c.yaws[0];
  const endYaw = c.yaws[c.yaws.length - 1];
  const startPitch = c.start.joints.hips?.[0] ?? 0;
  const endPitch = c.end.joints.hips?.[0] ?? 0;
  const leg = legs.thigh + legs.shin;
  const apex = Math.max(0, (vy * vy) / (2 * GRAVITY));
  const crouch = Math.min(0.3 * leg, 0.1 + apex * 0.25);
  const spin = c.spin ?? 0;
  const flip = c.flip ?? 0;

  let x: number;
  let z: number;
  let y: number;
  let yaw: number;
  let pitch: number;
  let roll = pose.joints.hips?.[2] ?? 0;
  // (Leaving the floor and meeting it again, the legs as they take off or land: how much.)
  let reach: { at: 'start' | 'end'; w: number } | null = null;
  // A real person's jump: their body in each phase (crouch, swing, tuck, landing), in this one's
  // time. (Before the recording has come, the body as keyed, legs reaching for the floor.)
  const leap = c.leap;
  const leapAt = !leap ? null
    : tau < prep ? leap.at(leap.takeoff * (tau / prep))
      : tau <= prep + flight ? leap.at(lerp(leap.takeoff, leap.landing, (tau - prep) / flight))
        : leap.at(leap.landing + Math.min(LEAP_LANDING, leap.duration - leap.landing) * ((tau - prep - flight) / land));
  if (leapAt) {
    const { hips: _h, ...body } = leapAt.joints;
    void _h;
    pose = { ...pose, joints: { ...pose.joints, ...body }, hands: leapAt.hands };
  }
  const feet: Generated['feet'] = { L: null, R: null };
  // Taking off from and landing on the keyed feet (raised onto a prop if the key stands on one).
  const startFeet = keyedFeet(body, c.start);
  const endFeet = keyedFeet(body, c.end);
  const planted = (at: 'start' | 'end', py: number) => {
    for (const side of ['L', 'R'] as const) {
      const k = (at === 'start' ? startFeet : endFeet)[side];
      feet[side] = { world: [k[0], k[1] + py, k[2]], swing: 0 };
    }
  };
  if (tau < prep) {
    // Crouch, then drive up: leaving the floor at the speed the flight starts with.
    const u = tau / prep;
    [x, z, yaw] = [ax, az, startYaw];
    y = u < 0.55
      ? hermite01(y0 + soft, 0, y0 - crouch, 0, u / 0.55)
      : hermite01(y0 - crouch, 0, y0, vy * prep * 0.45, (u - 0.55) / 0.45);
    pitch = startPitch + 16 * bump(u * 0.5) * (1 - smooth((u - 0.6) / 0.4));
    planted('start', ga);
  } else if (tau <= prep + flight) {
    const u = (tau - prep) / flight;
    const ft = tau - prep;
    x = lerp(ax, bx, u);
    z = lerp(az, bz, u);
    y = y0 + vy * ft - (GRAVITY * ft * ft) / 2;
    // Turns in the air: from the facing it leaves with to the one it lands with, plus whole spins
    // and flips, eased in and out.
    const turnU = smoother(u);
    yaw = lerpAngle(startYaw, endYaw, turnU) + 360 * spin * turnU;
    pitch = lerp(startPitch, endPitch, turnU) + 360 * flip * turnU;
    // In the air, a real person's legs: coming off the floor, and onto it, over a moment.
    const off = 1 - smooth(ft / LEG_EASE);
    const on = 1 - smooth((flight - ft) / LEG_EASE);
    reach = off >= on ? { at: 'start', w: off } : { at: 'end', w: on };
  } else {
    // Land at the speed the flight ends with, absorb, stand up.
    const u = (tau - prep - flight) / land;
    [x, z, yaw] = [bx, bz, endYaw + 360 * spin];
    pitch = endPitch + 360 * flip + 12 * bump(Math.min(1, u / 0.8) * 0.5) * (1 - smooth((u - 0.4) / 0.6));
    y = u < 0.4
      ? hermite01(y1, vLand * land * 0.4, y1 - crouch * 0.9, 0, u / 0.4)
      : hermite01(y1 - crouch * 0.9, 0, y1 + soft, 0, (u - 0.4) / 0.6);
    roll = c.end.joints.hips?.[2] ?? 0;
    planted('end', gb);
  }
  const out = compose(pose, legs, { position: [x, y, z], yaw, pitch, roll, feet });
  if (reach && reach.w > 0) {
    // (The legs as they are the moment it leaves the floor, or meets it: on the floor, the body where it then is.)
    const start = reach.at === 'start';
    planted(reach.at, start ? ga : gb);
    const held = compose(pose, legs, start
      ? { position: [ax, y0, az], yaw: startYaw, pitch: startPitch, roll: pose.joints.hips?.[2] ?? 0, feet }
      : { position: [bx, y1, bz], yaw: endYaw + 360 * spin, pitch: endPitch + 360 * flip, roll: c.end.joints.hips?.[2] ?? 0, feet });
    for (const j of LEG_JOINTS) {
      const [a, b] = [out.joints[j] ?? [0, 0, 0], held.joints[j] ?? [0, 0, 0]];
      out.joints[j] = a.map((v, i) => r1(v + wrapDeg(b[i] - v) * reach!.w)) as Vec3;
    }
  }
  // (A real person's within our ranges: captured and retargeted, an arm thrown up may read past one.)
  if (leapAt) for (const j of Object.keys(out.joints) as JointName[]) if (j !== 'hips') out.joints[j] = clampRotation(j, out.joints[j]!);
  return out;
}

/* ---------- planting feet in keyed poses ---------- */

/** Where a figure's feet are in the world (ankles, and how they are turned). */
export function feetOf(rig: Rig, f: Figure, sides: ('L' | 'R')[] = ['L', 'R']) {
  const m = rig.model(f);
  return sides.map((side) => {
    const j = m.joints[side === 'L' ? 'leftFoot' : 'rightFoot'];
    return { side, p: j.getWorldPosition(new THREE.Vector3()), q: j.getWorldQuaternion(new THREE.Quaternion()) };
  });
}

/**
 * The pose with its feet (or one) put where they are in `ref` (or at `feet`), turned as they were:
 * planted feet do not slide from key to key. The legs are solved as walking solves them (swing and
 * spread at the hip, the knee a hinge, no twist), in the pelvis's own frame however it is turned.
 */
export function plantFeet(rig: Rig, pose: Figure, ref: Figure | ReturnType<typeof feetOf>, sides: ('L' | 'R')[] = ['L', 'R']): Figure {
  const want = Array.isArray(ref) ? ref : feetOf(rig, ref, sides);
  const legs = legsOf(pose.body);
  const r1 = (v: number) => Math.round(v * 10) / 10 || 0;
  let f = pose;
  // A grounded figure settles on its new lowest point: solve again until the feet stay.
  for (let i = 0; i < 3; i++) {
    let m = rig.model(f);
    // (Settled: the feet where they are wanted, as they stand now.)
    if (i > 0 && want.every((w) => m.joints[w.side === 'L' ? 'leftFoot' : 'rightFoot'].getWorldPosition(new THREE.Vector3()).distanceTo(w.p) < 5e-4)) break;
    const bones = { ...f.bones };
    for (const w of want) {
      const hip = m.joints[sided('UpperLeg', w.side)];
      const frame = hip.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      const t = w.p.clone().sub(hip.getWorldPosition(new THREE.Vector3())).applyQuaternion(frame);
      const ik = legAngles(legs, [t.x, t.y, t.z], 0);
      bones[sided('UpperLeg', w.side)] = angleToQuat(sided('UpperLeg', w.side), [r1(ik.hip[0]), 0, r1(ik.hip[2])]);
      bones[sided('LowerLeg', w.side)] = angleToQuat(sided('LowerLeg', w.side), [r1(ik.knee), 0, 0]);
    }
    m = rig.model({ ...f, bones });
    // The foot turned as wanted, from the shin it hangs on.
    for (const w of want) {
      const ankle = m.joints[w.side === 'L' ? 'leftFoot' : 'rightFoot'];
      const local = ankle.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(w.q);
      const e = new THREE.Euler().setFromQuaternion(local, 'XZY');
      // Within the ankle's range: past it (a deep squat) the heel lifts, as people's do.
      const name = w.side === 'L' ? 'leftFoot' : 'rightFoot';
      bones[name] = angleToQuat(name, clampRotation(name, [r1(e.x * R2D), r1(e.y * R2D), r1(e.z * R2D)]));
    }
    f = { ...f, bones };
  }
  return f;
}
