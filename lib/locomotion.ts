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

/** Typical speeds (m/s for a 1.8 m figure), used to time a new walk or run. */
export /** The highest step up a walk or run takes onto a prop, as a share of the leg's length. */
const MAX_STEP_UP = 0.55;
const SPEED: Record<Exclude<Travel, 'jump'>, number> = { walk: 1.35, run: 3.6 };

/** Time a jump spends in the air to rise `h` metres (and back to the same height). */
export const flightTime = (h: number) => Math.sqrt((8 * Math.max(0.02, h)) / GRAVITY);
/** Height of a jump with `t` seconds in the air. */
export const jumpHeight = (t: number) => (GRAVITY * t * t) / 8;
/** Crouch before and absorb after a jump, at most (s). */
export const JUMP_PREP = 0.3;
/** Default jump height (metres the body rises). */
export const JUMP_HEIGHT = 0.45;

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
export interface Legs {
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
  /** A captured cycle it goes with, instead of generated steps (#26), and which way it goes from the facing (keeping it: back 180, left 90, right -90). */
  cycle?: Cycle;
  way?: number;
}

/** The Library's captured cycles a walk or a run can go with (#26), the first the usual one. */
export const GAITS: Record<'walk' | 'run', readonly string[]> = {
  walk: ['library:walk', 'library:walk-forward', 'library:happy-walk', 'library:crouch-walk-forward'],
  run: ['library:jog-forward', 'library:run-forward', 'library:sprint'],
};

/**
 * The cycles a walk or run with captured steps goes with where it keeps its facing (#26): backing
 * up (by the steps chosen: the Library's only walk backward is a sneak), and stepping sideways (to
 * the left as captured; to the right, mirrored). None: generated steps.
 */
export const GAIT_WAYS: Record<'walk' | 'run', { back: Record<string, string>; side: string }> = {
  walk: { back: { 'library:crouch-walk-forward': 'library:walk-backward' }, side: 'library:walk-left' },
  run: { back: Object.fromEntries(GAITS.run.map((g) => [g, 'library:run-backward'])), side: 'library:strafe-left' },
};

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
}

/* ---------- geometry helpers ---------- */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (u: number) => { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpAngle = (a: number, b: number, u: number) => wrapDeg(a + wrapDeg(b - a) * u);
const r1 = (v: number) => Math.round(v * 10) / 10 || 0;

/** A polyline on the floor, walked by arc length (and extrapolated past its ends). */
export function polyline(points: [number, number][]) {
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
/** How many steps a turn on the spot takes. */
const pivotSteps = (degrees: number) => Math.ceil(Math.abs(degrees) / PIVOT_STEP) + 1;

/** How long a turn on the spot takes (s). */
export function turnTime(degrees: number) {
  return Math.max(0.6, pivotSteps(degrees) * PIVOT_TIME);
}

/**
 * A turn on the spot: small steps round, foot after foot (the one on the side it turns to first),
 * each set down turned a little further about where the body stands, the last two where the end
 * key has its feet. Planted feet stay put; the body turns smoothly over it all.
 */
function pivot(c: Chain, legs: Legs, t: number, pose: AnglePose, ground: Ground, body: BodyParams): AnglePose {
  const dur = c.t1 - c.t0;
  const u = clamp((t - c.t0) / dur, 0, 1);
  const by = turnOf(c);
  const [x, z] = [lerp(c.start.position[0], c.end.position[0], smooth(u)), lerp(c.start.position[2], c.end.position[2], smooth(u))];
  const yaw = lerpAngle(c.yaws[0], c.yaws[c.yaws.length - 1], smooth(u));
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
  // Steps: n of them, alternate feet, the lead foot (on the side it turns to) first; each goes on
  // round by an even share, so no foot goes round much more than twice a step; the last of each
  // foot's lands where the end key has it.
  const n = pivotSteps(by);
  const lead: 'L' | 'R' = by > 0 ? 'L' : 'R';
  const sideOf = (j: number): 'L' | 'R' => ((j % 2 === 0) === (lead === 'L') ? 'L' : 'R');
  const share = (j: number) => Math.min(1, (j + 1) / (n - 1));
  const feet = {} as Record<'L' | 'R', { world: [number, number, number]; swing: number }>;
  for (const side of ['L', 'R'] as const) {
    const mine = [...Array(n).keys()].filter((j) => sideOf(j) === side);
    // (Each step takes its share of the time, swinging over most of it.)
    const now = mine.find((j) => u > j / n && u < (j + 1) / n);
    const done = mine.filter((j) => u >= (j + 1) / n);
    const was = done.length ? share(done[done.length - 1]) : 0;
    if (now === undefined) {
      feet[side] = { world: turned(side, was), swing: 0 };
      continue;
    }
    const q = clamp((u * n - now - 0.1) / 0.8, 0, 1);
    const k = smoother(q);
    // (Round the body, not across it: the foot follows the turn.)
    const at = turned(side, lerp(was, share(now), k));
    const y = lerp(turned(side, was)[1], turned(side, share(now))[1], k);
    const up = 0.05 * (legs.thigh + legs.shin) * bump(q);
    feet[side] = { world: [at[0], y + up, at[2]], swing: bump(q) };
  }
  const floor = Math.min(feet.L.world[1], feet.R.world[1]) - legs.ankleY;
  const y = pose.grounded ? floor + legs.rootY : pose.position[1];
  return compose(pose, legs, {
    position: [x, y, z], yaw, pitch: pose.joints.hips?.[0] ?? 0, roll: pose.joints.hips?.[2] ?? 0, feet, swing: 0, raise: 0, elbows: 0,
  });
}

/** Where a foot goes: on the floor (`world`, level when planted, hanging as it swings), or in the air relative to its hip in the body's frame (`body`, toes pointed). */
type FootGoal =
  | { world: [number, number, number]; swing: number }
  | { body: [number, number, number]; point: number };

interface Generated {
  position: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  /** null: the keyed leg as it is. */
  feet: Record<'L' | 'R', FootGoal | null>;
  /** Added to the keyed arms (degrees): swing against the legs (L +, R −), raise both, bend. */
  swing: number;
  raise: number;
  elbows: number;
}

/** Write a generated root and legs (and arm swing) into a pose. */
function compose(pose: AnglePose, legs: Legs, g: Generated): AnglePose {
  const joints: Record<string, Vec3> = { ...(structuredClone(pose.joints) as Record<string, Vec3>) };
  joints.hips = [r1(wrapDeg(g.pitch)), r1(wrapDeg(g.yaw)), r1(g.roll)];
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const foot = g.feet[side];
    if (foot) {
      let target: [number, number, number];
      if ('world' in foot) {
        const off = toPelvis([foot.world[0] - g.position[0], foot.world[1] - g.position[1], foot.world[2] - g.position[2]], g.yaw, g.pitch, joints.hips[2]);
        target = [off[0] - s * legs.hipX, off[1] + legs.hipDrop, off[2]];
      } else target = foot.body;
      // A planted foot behind the hip and out of reach rolls onto its toes: the heel lifts.
      let heel = 0;
      if ('world' in foot && target[2] < 0) {
        const reach = (legs.thigh + legs.shin) * 0.985;
        const flat = Math.hypot(target[0], target[2]);
        const need = -Math.sqrt(Math.max(0, reach * reach - flat * flat)) - target[1];
        // Only for a foot well behind (standing feet stay flat), easing in with the distance.
        if (need > 0) {
          heel = Math.min(need, 0.6 * legs.foot) * smooth(-target[2] / (0.25 * (legs.thigh + legs.shin)));
          target = [target[0], target[1] + heel, target[2] + heel * 0.35];
        }
      }
      const ik = legAngles(legs, target, 'world' in foot ? g.pitch : 0);
      joints[sided('UpperLeg', side)] = ik.hip.map(r1) as Vec3;
      joints[sided('LowerLeg', side)] = [r1(ik.knee), 0, 0];
      // Planted: level with the floor (or up on its toes). Swinging or in the air: the foot follows
      // the shin, toes down a little.
      const tiptoe = heel > 0 ? Math.asin(clamp(heel / legs.foot, 0, 1)) * R2D : 0;
      const ankle = 'world' in foot ? lerp(ik.ankle[0] + tiptoe, 12, foot.swing) : foot.point;
      // (Rolled to stay flat on the floor no further than an ankle rolls.)
      joints[sided('Foot', side)] = [r1(clamp(ankle, -40, 60)), 0, r1('world' in foot ? clamp(ik.ankle[2] * (1 - foot.swing), -35, 35) : 0)];
      // Up on its toes, they bend back at the ball of the foot, flat on the floor (#30).
      if (tiptoe > 0 && 'world' in foot) joints[sided('Toes', side)] = [r1(-clamp(tiptoe * (1 - foot.swing), 0, 50)), 0, 0];
    }
    const sh = joints[sided('UpperArm', side)] ?? [0, 0, 0];
    joints[sided('UpperArm', side)] = [r1(sh[0] + s * g.swing + g.raise), sh[1], sh[2]];
    const el = joints[sided('LowerArm', side)] ?? [0, 0, 0];
    // (Bent for running as far as an elbow goes, from however bent it was keyed.)
    joints[sided('LowerArm', side)] = [r1(Math.max(-150, Math.min(el[0], el[0] + g.elbows))), el[1], el[2]];
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

/**
 * The plan of a walk or run along a chain: its speed profile, step length and footsteps (as
 * 3ds Max's Biped plans them): whole steps of equal length along the path, feet alternating, the
 * first leaving from the standing spot and the last closing the feet together at the end. Each
 * step swings while the body covers a fixed stretch of the path, centred on the other foot: in a
 * walk the stretches never overlap (one foot is always down), in a run they do (both feet in the
 * air). Footfalls are fixed points on the floor: nothing slides.
 */
/** How much of a path goes sideways to the way the body faces along it (0 forward or back, 1 sideways). */
function sidewaysShare(line: ReturnType<typeof polyline>, D: number, yawAt: (arc: number) => number) {
  return Math.max(...[0.1, 0.3, 0.5, 0.7, 0.9].map((u) => {
    const d = line.direction(u * D);
    const l = leftOf(yawAt(u * D));
    return Math.abs(d[0] * l[0] + d[1] * l[1]);
  }));
}

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
  const half = (1 - stance) * len;
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
  return { line, D, dur, run, ramp, distance, scale, step, stance, len, half, width, steps, spot, yawAt, startYaw, endYaw, strafe };
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

/** Walking or running along the chain's path. */
function gait(c: Chain, legs: Legs, t: number, pose: AnglePose, ground: Ground, body: BodyParams): AnglePose {
  return walking(c, legs, t, pose, ground, body).pose;
}

/** The walk's pose, and where its feet are (world) and how far through a swing each is (0 planted). */
function walking(c: Chain, legs: Legs, t: number, pose: AnglePose, ground: Ground, body: BodyParams) {
  const plan = planGait(c, legs, ground, body);
  const { line, D, dur, run, ramp, scale, step, len, half, width, steps, spot, yawAt, startYaw, endYaw } = plan;
  const tau = clamp(t - c.t0, 0, dur);
  const s = plan.distance(tau);
  // Arm swing and lean come in and out with the speed.
  const w = D < 0.05 ? 0 : Math.min(smooth(tau / ramp), smooth((dur - tau) / ramp));
  const stride = 2 * step;
  const lift = (run ? 0.2 : 0.07) * scale;
  const phase = s / stride;

  // Facing: where it goes (turning from the start key, and to the end key's facing at the end),
  // or, strafing, the keyed facing all the way.
  const turn = Math.min(0.35, dur / 3);
  const keyedYaw = pose.joints.hips?.[1] ?? 0;
  const yaw = D < 0.05
    ? keyedYaw
    : plan.strafe
      ? yawAt(s)
      : lerpAngle(lerpAngle(startYaw, yawAt(s), smooth(tau / turn)), endYaw, smooth(1 - (dur - tau) / turn));
  const [x, z] = line.point(s);
  // Lean into the way it goes (forwards, or to the side or back when strafing).
  const heading = D > 0.05 ? yawOf(line.direction(s)) : yaw;
  const lean = (run ? 9 : 3) * w;
  const pitch = (pose.joints.hips?.[0] ?? 0) + lean * Math.cos((heading - yaw) * D2R);
  const roll = (pose.joints.hips?.[2] ?? 0) - lean * 0.6 * Math.sin((heading - yaw) * D2R);

  const feet = {} as Record<'L' | 'R', { world: [number, number, number]; swing: number }>;
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
    feet[side] = { world: [lerp(a[0], b[0], k), lerp(a[1], b[1], k) + up, lerp(a[2], b[2], k)], swing: bump(q) };
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

  const out = compose(pose, legs, {
    position: [x, y, z], yaw, pitch, roll, feet,
    swing: (run ? 34 : 17) * w * Math.cos(2 * Math.PI * phase), raise: 0, elbows: (run ? -75 : -8) * w,
  });
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
  return { pose: out, feet, plan, s, w };
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
  // (Each sample's ankle heights, the root where it is, on one rig.)
  const rig = new Rig();
  const heights = poses.map((p) => {
    const m = rig.model({ id: 'cycle', name: '', body, bones: bonesOf(p.joints), position: [0, p.position[1], 0], hands: p.hands, grounded: false });
    const y = (j: 'leftFoot' | 'rightFoot') => m.joints[j].getWorldPosition(new THREE.Vector3()).y;
    return { L: y('leftFoot'), R: y('rightFoot') };
  });
  rig.dispose();
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
  return { at, duration, stride, facing, heading: yawOf([b.position[0] - a.position[0], b.position[2] - a.position[2]]), body, contacts };
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
  const { pose: generated, feet, plan, s, w } = walking(c, legs, t, pose, ground, body);
  if (plan.D < 0.05 || w <= 0) return generated;
  const k = legs.rootY / legsOf(cyc.body).rootY;
  const stride = 2 * plan.step;
  // The phase: the cycle's right foot comes down where the plan's does (its first, `half` along).
  const right = cyc.contacts.find((x) => x.side === 'R');
  const offset = (right ? right.start / cyc.duration : 0) - plan.half / stride;
  const laps = s / stride + offset;
  const q = cyc.at((laps - Math.floor(laps)) * cyc.duration);
  const hips = q.joints.hips ?? [0, 0, 0];
  const yaw = generated.joints.hips?.[1] ?? 0;
  // (Its root where the generated walk has it, at the cycle's height: the legs reach the floor.)
  // (Turned so that its own way goes the path's: the body as turned from it as the captured one's.)
  const out: AnglePose = { ...q, joints: { ...q.joints, hips: [hips[0], wrapDeg(yaw + (c.way ?? 0) + hips[1] - cyc.heading), hips[2]] }, position: [generated.position[0], Math.min(generated.position[1], q.position[1] * k + (generated.position[1] - legs.rootY * 0.975)), generated.position[2]], hands: pose.hands, grounded: false };
  const mixed = mixPoses(generated, out, w);
  // Planted feet held where the plan has them; swinging, the cycle's legs (eased onto the hold as they come down).
  for (const side of ['L', 'R'] as const) plantLeg(mixed, legs, side, feet[side].world, 1 - smooth(feet[side].swing * 2.5));
  return mixed;
}

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
  // The arms: wound back in the crouch, swung up through the take-off (overhead at the top),
  // brought down forward into the landing and relaxed. Each swing starts and ends at rest and
  // takes enough frames not to snap.
  const back = 0.4 * prep;
  const top = prep + 0.45 * flight;
  const armsAt = (s: number) => {
    if (s < back) return 30 * smoother(s / back);
    if (s < top) return lerp(30, -150, smoother((s - back) / (top - back)));
    const settle = prep + flight + 0.3 * land;
    if (s < settle) return lerp(-150, -30, smoother((s - top) / (settle - top)));
    return -30 * (1 - smoother((s - settle) / (0.7 * land)));
  };
  const raise = armsAt(tau);
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
    // Knees up at the top (tighter in a flip), legs reaching down again for the landing.
    const tuck = bump(u) * clamp(apex / 0.35, 0.35, 1) * (flip ? 1.25 : 1);
    // The legs keep extending at the speed they left the floor with, and compress at the speed
    // the body comes down with when they meet it again.
    const full = leg * 0.995;
    const lenOff = clamp(y0 - legs.hipDrop - ga - legs.ankleY, 0.5 * leg, full);
    const lenOn = clamp(y1 - legs.hipDrop - gb - legs.ankleY, 0.5 * leg, full);
    const ext = Math.min(full, u < 0.25
      ? hermite01(lenOff, vy * flight * 0.25, full, 0, u / 0.25)
      : u > 0.75 ? hermite01(full, 0, lenOn, vLand * flight * 0.25, (u - 0.75) / 0.25) : full);
    // Toes: from the angle they left the floor with, pointed in the air, ready to land.
    const offAnkle = legAngles(legs, [0, -lenOff, 0], startPitch).ankle[0];
    const onAnkle = legAngles(legs, [0, -lenOn, 0], endPitch).ankle[0];
    const point = lerp(lerp(offAnkle, 35, smooth(u / 0.3)), onAnkle, smooth((u - 0.7) / 0.3));
    for (const side of ['L', 'R'] as const) {
      const len = ext - 0.5 * leg * clamp(tuck, 0, 1);
      const ahead = 0.32 * leg * clamp(tuck, 0, 1);
      feet[side] = { body: [0, -Math.sqrt(Math.max(1e-4, len * len - ahead * ahead)), ahead], point };
    }
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
  return compose(pose, legs, { position: [x, y, z], yaw, pitch, roll, feet, swing: 0, raise, elbows: raise < 0 ? 0.12 * raise : 0 });
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
