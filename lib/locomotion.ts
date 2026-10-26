import { wrapDeg } from './joints';
import { Rig } from './relations';
import type { Animation, BodyParams, Figure, JointName, PoseKey, Travel, Vec3 } from './types';

/*
 * Locomotion between keys. A key with `travel` is reached from the figure's previous key by
 * walking, running or jumping: its legs, its root and the swing of its arms are generated along
 * the way; the keys only say where and when (and how the upper body looks).
 *
 * As in games: steps advance with the distance travelled (not the time), and every footfall is a
 * fixed point on the floor, so a planted foot never slides; the legs reach their foot targets by
 * two-bone IK. A jump follows gravity: the longer it is in the air, the higher it goes.
 *
 * Consecutive keys with the same travel form one chain: the keys in between are waypoints of the
 * path and shape the upper body (in a jump: the whole pose in the air), the steps run through.
 * A figure faces where it goes, or (strafe) keeps its keyed facing: side steps, backing up.
 * Feet stand on whatever is under them: the floor, or the top of a box or a step (`ground`).
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
      id: 'legs', name: '', body, joints: {}, position: [0, 0, 0], grounded: true,
      hands: { L: { curl: [0, 0, 0, 0, 0], spread: 0 }, R: { curl: [0, 0, 0, 0, 0], spread: 0 } },
    });
    const at = (j: JointName) => m.joints[j].getWorldPosition(m.joints[j].position.clone());
    const root = at('root');
    const hip = at('hipL');
    const knee = at('kneeL');
    const ankle = at('ankleL');
    legs = {
      thigh: hip.distanceTo(knee),
      shin: knee.distanceTo(ankle),
      rootY: root.y,
      ankleY: ankle.y,
      hipDrop: root.y - hip.y,
      hipX: Math.abs(hip.x - root.x),
      foot: 0.13 * (root.y / 0.93),
    };
  } finally {
    rig.dispose();
  }
  legsCache.set(key, legs);
  return legs;
}

/** Where a keyed pose puts the ankles (world), cached per key: walks start and end on them. */
const feetCache = new WeakMap<PoseKey, Record<'L' | 'R', [number, number, number]>>();

function keyedFeet(body: BodyParams, pose: PoseKey) {
  let feet = feetCache.get(pose);
  if (feet) return feet;
  const rig = new Rig();
  try {
    const m = rig.model({ id: 'feet', name: '', body, joints: pose.joints, position: pose.position, hands: pose.hands, grounded: pose.grounded });
    const at = (j: 'ankleL' | 'ankleR') => {
      const p = m.joints[j].getWorldPosition(m.joints[j].position.clone());
      return [p.x, p.y, p.z] as [number, number, number];
    };
    feet = { L: at('ankleL'), R: at('ankleR') };
  } finally {
    rig.dispose();
  }
  feetCache.set(pose, feet);
  return feet;
}

/* ---------- the chain of keys a time falls in ---------- */

export interface Chain {
  kind: Travel;
  t0: number;
  t1: number;
  start: PoseKey;
  end: PoseKey;
  /** Floor positions of the keys, start to end. */
  path: [number, number][];
  /** The keyed facing at each point of the path (turned to from mark to mark when strafing). */
  yaws: number[];
  /** The figure's keys inside the chain (waypoints; poses in the air for a jump). */
  inner: number;
}

/** The travel chain of figure `id` at time t, if t is inside one. */
export function chainAt(a: Animation, id: string, t: number): Chain | null {
  const track = a.keys.filter((k) => k.poses[id]).map((k) => ({ t: k.t, pose: k.poses[id] }));
  let i = track.length - 2;
  while (i >= 0 && track[i].t > t) i--;
  // Before the first key or after the last, the figure stands as keyed.
  if (i < 0 || i >= track.length - 1 || t > track[i + 1].t + 1e-9) return null;
  const kind = track[i + 1].pose.travel;
  if (!kind) return null;
  let s = i;
  while (s > 0 && track[s].pose.travel === kind) s--;
  let e = i + 1;
  while (e + 1 < track.length && track[e + 1].pose.travel === kind) e++;
  const keys = track.slice(s, e + 1);
  return {
    kind,
    t0: track[s].t,
    t1: track[e].t,
    start: track[s].pose,
    end: track[e].pose,
    path: (kind === 'jump' ? [keys[0], keys[keys.length - 1]] : keys).map((k) => [k.pose.position[0], k.pose.position[2]]),
    yaws: (kind === 'jump' ? [keys[0], keys[keys.length - 1]] : keys).map((k) => k.pose.joints.root?.[1] ?? 0),
    inner: keys.length - 2,
  };
}

/** Every travel chain of a figure (for the timeline and the path drawn on the floor). */
export function chainsOf(a: Animation, id: string): Chain[] {
  const out: Chain[] = [];
  const times = a.keys.filter((k) => k.poses[id]).map((k) => k.t);
  for (let i = 0; i < times.length - 1; i++) {
    const c = chainAt(a, id, (times[i] + times[i + 1]) / 2);
    if (c && !out.some((o) => o.t0 === c.t0)) out.push(c);
  }
  return out;
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

/** A world offset seen from the pelvis (yaw, then pitch): [left, up, forward]. */
function toPelvis(d: [number, number, number], yaw: number, pitch: number): [number, number, number] {
  const c = Math.cos(yaw * D2R);
  const s = Math.sin(yaw * D2R);
  const x = d[0] * c - d[2] * s;
  const z = d[0] * s + d[2] * c;
  const p = pitch * D2R;
  return [x, d[1] * Math.cos(p) + z * Math.sin(p), -d[1] * Math.sin(p) + z * Math.cos(p)];
}

/* ---------- the generated pose ---------- */

/** The figure's pose at t with its locomotion applied (or `pose` unchanged outside any). */
export function locomote(a: Animation, f: Figure, t: number, pose: PoseKey, ground: Ground = FLOOR): PoseKey {
  const chain = chainAt(a, f.id, t);
  if (!chain || chain.t1 - chain.t0 < 1e-3) return pose;
  // At the marks it starts and ends at, the figure is as keyed (standing on the floor).
  if (Math.abs(t - chain.t0) < 1e-6 || Math.abs(t - chain.t1) < 1e-6) return pose;
  const legs = legsOf(f.body);
  return chain.kind === 'jump' ? jump(chain, legs, t, pose, ground, f.body) : gait(chain, legs, t, pose, ground, f.body);
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
function compose(pose: PoseKey, legs: Legs, g: Generated): PoseKey {
  const joints: Record<string, Vec3> = { ...(structuredClone(pose.joints) as Record<string, Vec3>) };
  joints.root = [r1(wrapDeg(g.pitch)), r1(wrapDeg(g.yaw)), r1(g.roll)];
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const foot = g.feet[side];
    if (foot) {
      let target: [number, number, number];
      if ('world' in foot) {
        const off = toPelvis([foot.world[0] - g.position[0], foot.world[1] - g.position[1], foot.world[2] - g.position[2]], g.yaw, g.pitch);
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
      joints[`hip${side}`] = ik.hip.map(r1) as Vec3;
      joints[`knee${side}`] = [r1(ik.knee), 0, 0];
      // Planted: level with the floor (or up on its toes). Swinging or in the air: the foot follows
      // the shin, toes down a little.
      const tiptoe = heel > 0 ? Math.asin(clamp(heel / legs.foot, 0, 1)) * R2D : 0;
      const ankle = 'world' in foot ? lerp(ik.ankle[0] + tiptoe, 12, foot.swing) : foot.point;
      joints[`ankle${side}`] = [r1(clamp(ankle, -40, 60)), 0, r1('world' in foot ? ik.ankle[2] * (1 - foot.swing) : 0)];
    }
    const sh = joints[`shoulder${side}`] ?? [0, 0, 0];
    joints[`shoulder${side}`] = [r1(sh[0] + s * g.swing + g.raise), sh[1], sh[2]];
    const el = joints[`elbow${side}`] ?? [0, 0, 0];
    joints[`elbow${side}`] = [r1(el[0] + g.elbows), el[1], el[2]];
  }
  const clean = Object.fromEntries(Object.entries(joints).filter(([, v]) => v.some((x) => x !== 0))) as Figure['joints'];
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
  const step = run
    ? clamp(1.15 * leg * Math.sqrt(v / (SPEED.run * scale)), 0.6 * leg, 2 * leg)
    : clamp(0.72 * leg * Math.sqrt(v / (SPEED.walk * scale)), 0.25 * leg, 1 * leg);
  const stance = run ? 0.38 : 0.62;
  const startYaw = c.start.joints.root?.[1] ?? 0;
  const endYaw = c.end.joints.root?.[1] ?? 0;
  const strafe = !!c.end.strafe;
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
  const steps: Step[] = [];
  const last: Record<'L' | 'R', number> = { L: 0, R: 0 };
  for (let k = 1; k <= n + 1; k++) {
    const side = k % 2 === 1 ? 'R' : 'L';
    const to = Math.min(D, k * len);
    const centre = (k - 1) * len;
    const s0 = k === 1 ? 0 : Math.max(steps[steps.length - 1].s0 + 1e-3, centre - half);
    // The first step lands with the body `half` along, as every later one does past its centre.
    const s1 = k === 1 ? Math.max(1e-3, half) : k === n + 1 ? D : centre + half;
    steps.push({ side, from: last[side], to, s0, s1: Math.max(s0 + 1e-3, s1) });
    last[side] = to;
  }
  // Standing at either end: exactly where the keyed pose has its feet, on what is under them (a
  // grounded key stands on the floor, or on top of a box or step).
  const onGround = (key: PoseKey, side: 'L' | 'R'): [number, number, number] => {
    const k = keyedFeet(body, key)[side];
    return key.grounded ? [k[0], k[1] + ground(key.position[0], key.position[2]), k[2]] : k;
  };
  const place = (arc: number, side: 'L' | 'R') => {
    const [px, pz] = line.point(arc);
    const l = leftOf(yawAt(arc));
    const sgn = side === 'L' ? 1 : -1;
    return [px + l[0] * sgn * width, pz + l[1] * sgn * width] as const;
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
export function footprints(a: Animation, f: Figure, ground: Ground = FLOOR) {
  const legs = legsOf(f.body);
  const out: { x: number; z: number; yaw: number; side: 'L' | 'R' }[] = [];
  for (const c of chainsOf(a, f.id)) {
    if (c.kind === 'jump') continue;
    const p = planGait(c, legs, ground, f.body);
    for (const st of p.steps) {
      const [x, , z] = p.spot(st.to, st.side);
      out.push({ x, z, yaw: st.to >= p.D - 1e-6 ? p.endYaw : p.yawAt(st.to), side: st.side });
    }
  }
  return out;
}

/** Walking or running along the chain's path. */
function gait(c: Chain, legs: Legs, t: number, pose: PoseKey, ground: Ground, body: BodyParams): PoseKey {
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
  const keyedYaw = pose.joints.root?.[1] ?? 0;
  const yaw = D < 0.05
    ? keyedYaw
    : plan.strafe
      ? yawAt(s)
      : lerpAngle(lerpAngle(startYaw, yawAt(s), smooth(tau / turn)), endYaw, smooth(1 - (dur - tau) / turn));
  const [x, z] = line.point(s);
  // Lean into the way it goes (forwards, or to the side or back when strafing).
  const heading = D > 0.05 ? yawOf(line.direction(s)) : yaw;
  const lean = (run ? 9 : 3) * w;
  const pitch = (pose.joints.root?.[0] ?? 0) + lean * Math.cos((heading - yaw) * D2R);
  const roll = (pose.joints.root?.[2] ?? 0) - lean * 0.6 * Math.sin((heading - yaw) * D2R);

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
    const k = run ? smoother(q) : smooth(q);
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
  // Safety: never higher than a planted foot ahead can reach (steps onto props).
  for (const side of ['L', 'R'] as const) {
    const { world: f, swing } = feet[side];
    const off = toPelvis([f[0] - x, 0, f[2] - z], yaw, 0);
    const lateral = off[0] - (side === 'L' ? 1 : -1) * legs.hipX;
    const fwd = off[2] + legs.hipDrop * Math.sin(pitch * D2R);
    const horizontal = Math.min(reach * 0.9, Math.hypot(fwd, lateral));
    const limit = f[1] + Math.sqrt(reach * reach - horizontal * horizontal) + hipUp;
    y = lerp(y, softMin(y, limit + 0.01, 0.03), (1 - swing) * smooth(fwd / (0.15 * len)));
  }
  const keyedY = pose.grounded ? floor + legs.rootY : pose.position[1];
  y = lerp(keyedY, y, w);

  return compose(pose, legs, {
    position: [x, y, z], yaw, pitch, roll, feet,
    swing: (run ? 34 : 17) * w * Math.cos(2 * Math.PI * phase), raise: 0, elbows: (run ? -75 : -8) * w,
  });
}

/**
 * A jump from the chain's first key to its last: crouch, fly under gravity, land. It can take off
 * from and land on a raised surface; keys in between pose the body in the air; `spin` and `flip`
 * (whole turns, on the landing key) rotate it on the way. Every phase hands over to the next at
 * the same height and speed, so nothing snaps.
 */
function jump(c: Chain, legs: Legs, t: number, pose: PoseKey, ground: Ground, body: BodyParams): PoseKey {
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
  const startYaw = c.start.joints.root?.[1] ?? 0;
  const endYaw = c.end.joints.root?.[1] ?? 0;
  const startPitch = c.start.joints.root?.[0] ?? 0;
  const endPitch = c.end.joints.root?.[0] ?? 0;
  const leg = legs.thigh + legs.shin;
  const apex = Math.max(0, (vy * vy) / (2 * GRAVITY));
  const crouch = Math.min(0.3 * leg, 0.1 + apex * 0.25);
  const posed = c.inner > 0;
  const spin = c.end.spin ?? 0;
  const flip = c.end.flip ?? 0;

  let x: number;
  let z: number;
  let y: number;
  let yaw: number;
  let pitch: number;
  let roll = pose.joints.root?.[2] ?? 0;
  // The arms: wound back in the crouch, swung up through the take-off (overhead at the top, or to
  // the keyed arms of a posed jump), brought down forward into the landing and relaxed. Each swing starts and ends at rest and
  // takes enough frames not to snap.
  const back = 0.4 * prep;
  const top = posed ? prep + 0.15 * flight : prep + 0.45 * flight;
  const armsAt = (s: number) => {
    if (s < back) return 30 * smoother(s / back);
    if (s < top) return lerp(30, posed ? -60 : -150, smoother((s - back) / (top - back)));
    if (posed) return lerp(-60, 0, smoother((s - top) / (0.3 * flight)));
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
    // Turns in the air: the keyed facing plus whole spins and flips, eased in and out.
    const turnU = smoother(u);
    yaw = (posed ? (pose.joints.root?.[1] ?? 0) : lerpAngle(startYaw, endYaw, turnU)) + 360 * spin * turnU;
    pitch = (posed ? (pose.joints.root?.[0] ?? 0) : lerp(startPitch, endPitch, turnU)) + 360 * flip * turnU;
    if (!posed) {
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
    }
  } else {
    // Land at the speed the flight ends with, absorb, stand up.
    const u = (tau - prep - flight) / land;
    [x, z, yaw] = [bx, bz, endYaw + 360 * spin];
    pitch = endPitch + 360 * flip + 12 * bump(Math.min(1, u / 0.8) * 0.5) * (1 - smooth((u - 0.4) / 0.6));
    y = u < 0.4
      ? hermite01(y1, vLand * land * 0.4, y1 - crouch * 0.9, 0, u / 0.4)
      : hermite01(y1 - crouch * 0.9, 0, y1 + soft, 0, (u - 0.4) / 0.6);
    roll = c.end.joints.root?.[2] ?? 0;
    planted('end', gb);
  }
  return compose(pose, legs, { position: [x, y, z], yaw, pitch, roll, feet, swing: 0, raise, elbows: raise < 0 ? 0.12 * raise : 0 });
}
