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
export const SPEED: Record<Exclude<Travel, 'jump'>, number> = { walk: 1.35, run: 3.6 };

/** Time a jump spends in the air to rise `h` metres (and back to the same height). */
export const flightTime = (h: number) => Math.sqrt((8 * Math.max(0.02, h)) / GRAVITY);
/** Height of a jump with `t` seconds in the air. */
export const jumpHeight = (t: number) => (GRAVITY * t * t) / 8;
/** Crouch before and absorb after a jump, at most (s). */
export const JUMP_PREP = 0.3;

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
    };
  } finally {
    rig.dispose();
  }
  legsCache.set(key, legs);
  return legs;
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
  /** The figure's keys inside the chain (waypoints; poses in the air for a jump). */
  inner: number;
}

/** The travel chain of figure `id` at time t, if t is inside one. */
export function chainAt(a: Animation, id: string, t: number): Chain | null {
  const track = a.keys.filter((k) => k.poses[id]).map((k) => ({ t: k.t, pose: k.poses[id] }));
  let i = track.length - 2;
  while (i >= 0 && track[i].t > t) i--;
  if (i < 0 || i >= track.length - 1) return null;
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
  const len = clamp(Math.hypot(...t), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995);
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
  const legs = legsOf(f.body);
  return chain.kind === 'jump' ? jump(chain, legs, t, pose, ground) : gait(chain, legs, t, pose, ground);
}

interface Generated {
  position: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  feet: Record<'L' | 'R', [number, number, number] | null>;
  /** Added to the keyed pose (degrees). */
  shoulders: number;
  elbows: number;
  ankleKick: Record<'L' | 'R', number>;
}

/** Write a generated root and legs (and arm swing) into a pose. */
function compose(pose: PoseKey, legs: Legs, g: Generated): PoseKey {
  const joints: Record<string, Vec3> = { ...(structuredClone(pose.joints) as Record<string, Vec3>) };
  joints.root = [r1(g.pitch), r1(wrapDeg(g.yaw)), r1(g.roll)];
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const foot = g.feet[side];
    if (foot) {
      const off = toPelvis([foot[0] - g.position[0], foot[1] - g.position[1], foot[2] - g.position[2]], g.yaw, g.pitch);
      const ik = legAngles(legs, [off[0] - s * legs.hipX, off[1] + legs.hipDrop, off[2]], g.pitch);
      joints[`hip${side}`] = ik.hip.map(r1) as Vec3;
      joints[`knee${side}`] = [r1(ik.knee), 0, 0];
      joints[`ankle${side}`] = [r1(ik.ankle[0] + g.ankleKick[side]), 0, r1(ik.ankle[2])];
    }
    // Arms swing against the legs (and lift in a jump), on top of the keyed arms.
    const sh = joints[`shoulder${side}`] ?? [0, 0, 0];
    joints[`shoulder${side}`] = [r1(sh[0] + s * g.shoulders), sh[1], sh[2]];
    const el = joints[`elbow${side}`] ?? [0, 0, 0];
    joints[`elbow${side}`] = [r1(el[0] + g.elbows), el[1], el[2]];
  }
  const clean = Object.fromEntries(Object.entries(joints).filter(([, v]) => v.some((x) => x !== 0))) as Figure['joints'];
  return { ...pose, joints: clean, position: g.position.map((v) => Math.round(v * 1000) / 1000) as Vec3, grounded: false };
}

/** Walking or running along the chain's path. */
function gait(c: Chain, legs: Legs, t: number, pose: PoseKey, ground: Ground): PoseKey {
  const line = polyline(c.path);
  const D = line.length;
  const dur = c.t1 - c.t0;
  const tau = clamp(t - c.t0, 0, dur);
  const run = c.kind === 'run';
  const leg = legs.thigh + legs.shin;
  // Speed: a ramp up at the start, a ramp down at the end, steady in between.
  const ramp = Math.min(run ? 0.45 : 0.35, dur / 3);
  const v = D / Math.max(1e-3, dur - ramp);
  const s = tau < ramp ? (v * tau * tau) / (2 * ramp) : tau > dur - ramp ? D - (v * (dur - tau) ** 2) / (2 * ramp) : v * (tau - ramp / 2);
  // Into and out of the gait from the standing keys.
  const w = D < 0.05 ? 0 : Math.min(smooth(tau / ramp), smooth((dur - tau) / ramp));
  // Longer steps at higher speed, as people do.
  const scale = leg / 0.85;
  const step = run
    ? clamp(1.25 * leg * Math.sqrt(v / (SPEED.run * scale)), 0.6 * leg, 2.2 * leg)
    : clamp(0.82 * leg * Math.sqrt(v / (SPEED.walk * scale)), 0.25 * leg, 1.05 * leg);
  const stride = 2 * step;
  const stance = run ? 0.36 : 0.62;
  const lift = (run ? 0.16 : 0.07) * scale;
  const phase = s / stride;

  // Facing: where it goes (turning from the start key, and to the end key's facing at the end),
  // or, strafing, the keyed facing all the way.
  const turn = Math.min(0.35, dur / 3);
  const startYaw = c.start.joints.root?.[1] ?? 0;
  const endYaw = c.end.joints.root?.[1] ?? 0;
  const keyedYaw = pose.joints.root?.[1] ?? 0;
  const strafe = !!c.end.strafe;
  const yawAt = (arc: number) => (strafe || D < 0.05 ? keyedYaw : yawOf(line.direction(arc)));
  const yaw = strafe || D < 0.05
    ? keyedYaw
    : lerpAngle(lerpAngle(startYaw, yawAt(s), smooth(tau / turn)), endYaw, smooth(1 - (dur - tau) / turn));
  const [x, z] = line.point(s);
  // Lean into the way it goes (forwards, or to the side or back when strafing).
  const heading = D > 0.05 ? yawOf(line.direction(s)) : yaw;
  const lean = (run ? 9 : 3) * w;
  const pitch = (pose.joints.root?.[0] ?? 0) + lean * Math.cos((heading - yaw) * D2R);
  const roll = (pose.joints.root?.[2] ?? 0) - lean * 0.6 * Math.sin((heading - yaw) * D2R);

  // Each foot: planted at a fixed point of the path while in stance, swinging to the next one.
  // Footfalls within half a step of the start or the end are the standing spots there, so the
  // first step leaves from where the figure stands and the last one closes the feet together.
  const width = legs.hipX * (run ? 0.6 : 0.9);
  const feet = {} as Generated['feet'];
  const ankleKick = { L: 0, R: 0 };
  for (const side of ['L', 'R'] as const) {
    const sgn = side === 'L' ? 1 : -1;
    const off = side === 'L' ? 0 : 0.5;
    const u = phase + off;
    const n = Math.floor(u);
    const frac = u - n;
    const plant = (k: number) => (k - off) * stride + (stance * stride) / 2;
    const spot = (k: number): [number, number, number] => {
      const raw = plant(k);
      const arc = raw < 0.5 * step ? 0 : raw > D - 0.5 * step ? D : raw;
      const standing = arc === 0 || arc === D;
      const [px, pz] = line.point(arc);
      const l = leftOf(arc === 0 ? (strafe ? keyedYaw : startYaw) : arc === D ? (strafe ? keyedYaw : endYaw) : yawAt(arc));
      const half = standing ? legs.hipX : width;
      const fx = px + l[0] * sgn * half;
      const fz = pz + l[1] * sgn * half;
      return [fx, ground(fx, fz) + legs.ankleY, fz];
    };
    if (frac < stance) feet[side] = spot(n);
    else {
      const q = (frac - stance) / (1 - stance);
      const a = spot(n);
      const b = spot(n + 1);
      const moves = Math.hypot(b[0] - a[0], b[2] - a[2]) > 1e-3;
      const k = smooth(q);
      // Up over the swing (and over a step up), unless the foot has nowhere to go.
      const up = moves ? lift * Math.sin(Math.PI * q) + Math.max(0, b[1] - a[1]) * Math.sin(Math.PI * q) : 0;
      feet[side] = [lerp(a[0], b[0], k), lerp(a[1], b[1], k) + up, lerp(a[2], b[2], k)];
      // Toe-off: the foot points down a little as it leaves the floor.
      if (moves) ankleKick[side] = (run ? 25 : 12) * Math.sin(Math.PI * q);
    }
  }

  // Pelvis: a gentle bob over the ground, never higher than the planted legs can reach.
  const floor = Math.max(ground(x, z), Math.min(feet.L![1], feet.R![1]) - legs.ankleY);
  const bob = run ? 0.035 * scale * Math.cos(4 * Math.PI * phase) : -0.012 * scale * Math.cos(4 * Math.PI * phase);
  let y = floor + legs.rootY * (run ? 0.94 : 0.985) + bob * w;
  for (const side of ['L', 'R'] as const) {
    const f = feet[side]!;
    const off = toPelvis([f[0] - x, 0, f[2] - z], yaw, 0);
    const lateral = off[0] - (side === 'L' ? 1 : -1) * legs.hipX;
    const reach = (legs.thigh + legs.shin) * 0.985;
    const horizontal = Math.hypot(off[2] + legs.hipDrop * Math.sin(pitch * D2R), lateral);
    y = Math.min(y, f[1] + Math.sqrt(Math.max(0, reach * reach - horizontal * horizontal)) + legs.hipDrop * Math.cos(pitch * D2R));
  }
  const keyedY = pose.grounded ? floor + legs.rootY : pose.position[1];
  y = lerp(keyedY, y, w);

  const swing = (run ? 34 : 17) * w * Math.cos(2 * Math.PI * phase);
  return compose(pose, legs, {
    position: [x, y, z], yaw, pitch, roll, feet, ankleKick,
    shoulders: swing, elbows: (run ? -75 : -8) * w,
  });
}

/**
 * A jump from the chain's first key to its last: crouch, fly under gravity, land. It can take off
 * from and land on a raised surface; keys in between pose the body in the air; `spin` and `flip`
 * (whole turns, on the landing key) rotate it on the way.
 */
function jump(c: Chain, legs: Legs, t: number, pose: PoseKey, ground: Ground): PoseKey {
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
  const y0 = ga + legs.rootY;
  const y1 = gb + legs.rootY;
  const vy = (y1 - y0) / flight + (GRAVITY * flight) / 2;
  const startYaw = c.start.joints.root?.[1] ?? 0;
  const endYaw = c.end.joints.root?.[1] ?? 0;
  const startPitch = c.start.joints.root?.[0] ?? 0;
  const leg = legs.thigh + legs.shin;
  const apex = Math.max(0, (vy * vy) / (2 * GRAVITY));
  const crouch = Math.min(0.32 * leg, 0.12 + apex * 0.25);
  const posed = c.inner > 0;

  let x: number;
  let z: number;
  let y: number;
  let yaw: number;
  let pitch: number;
  let roll = pose.joints.root?.[2] ?? 0;
  let tuck = 0;
  let arms = 0;
  let planted: 'start' | 'end' | null;
  if (tau < prep) {
    const u = tau / prep;
    [x, z, yaw, planted] = [ax, az, startYaw, 'start'];
    y = y0 - crouch * Math.sin(Math.PI * u);
    pitch = startPitch + 14 * Math.sin(Math.PI * u);
    arms = 50 * Math.sin((Math.PI / 2) * u);
  } else if (tau <= prep + flight) {
    const u = (tau - prep) / flight;
    const ft = tau - prep;
    x = lerp(ax, bx, u);
    z = lerp(az, bz, u);
    y = y0 + vy * ft - (GRAVITY * ft * ft) / 2;
    // Turns in the air: the keyed facing plus whole spins and flips, eased in and out.
    const turnU = smooth(u);
    yaw = posed ? (pose.joints.root?.[1] ?? 0) : lerpAngle(startYaw, endYaw, turnU);
    yaw += 360 * (c.end.spin ?? 0) * turnU;
    pitch = (posed ? (pose.joints.root?.[0] ?? 0) : lerp(startPitch, c.end.joints.root?.[0] ?? 0, turnU)) + 360 * (c.end.flip ?? 0) * turnU;
    if (!posed) {
      tuck = Math.sin(Math.PI * u) * clamp(apex / 0.35, 0.3, 1) * (c.end.flip ? 1.3 : 1);
      arms = lerp(50, -150, smooth(u * 2.5)) * (1 - smooth((u - 0.6) / 0.4)) + -40 * smooth((u - 0.6) / 0.4);
    }
    planted = null;
  } else {
    const u = (tau - prep - flight) / land;
    [x, z, yaw, planted] = [bx, bz, endYaw, 'end'];
    y = y1 - crouch * 0.9 * Math.sin(Math.PI * Math.min(1, u * 1.15));
    pitch = (c.end.joints.root?.[0] ?? 0) + 14 * Math.sin(Math.PI * Math.min(1, u * 1.15));
    arms = posed ? 0 : -40 * (1 - smooth(u));
    roll = c.end.joints.root?.[2] ?? 0;
  }

  const feet = {} as Generated['feet'];
  for (const side of ['L', 'R'] as const) {
    const sgn = side === 'L' ? 1 : -1;
    if (planted) {
      const [px, pz, py] = planted === 'start' ? [ax, az, ga] : [bx, bz, gb];
      const l = leftOf(planted === 'start' ? startYaw : endYaw);
      feet[side] = [px + l[0] * sgn * legs.hipX, py + legs.ankleY, pz + l[1] * sgn * legs.hipX];
    } else if (posed) {
      // Posed in the air: the keyed legs as they are.
      feet[side] = null;
    } else {
      // In the air: knees come up, the feet trail below the hips (in the body's own frame).
      feet[side] = null;
    }
  }
  const out = compose(pose, legs, {
    position: [x, y, z], yaw, pitch, roll, feet, ankleKick: { L: 0, R: 0 },
    shoulders: 0, elbows: arms ? -15 * Math.abs(arms) / 150 : 0,
  });
  // The tuck and the arm swing of an unposed jump.
  const joints = { ...out.joints };
  if (!planted && !posed) {
    for (const side of ['L', 'R'] as const) {
      joints[`hip${side}`] = [r1(-60 * tuck), 0, side === 'L' ? 4 : -4];
      joints[`knee${side}`] = [r1(110 * tuck), 0, 0];
      joints[`ankle${side}`] = [r1(25 * (1 - tuck)), 0, 0];
    }
  }
  if (arms) {
    for (const side of ['L', 'R'] as const) {
      const sh = joints[`shoulder${side}`] ?? [0, 0, 0];
      joints[`shoulder${side}`] = [r1(sh[0] + arms), sh[1], sh[2]];
    }
  }
  return { ...out, joints };
}
