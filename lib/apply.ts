import { newAnimation, snapTime } from './animation';
import { cloneHand } from './hands';
import { wrapDeg } from './joints';
import { legsOf } from './locomotion';
import { Rig, facing, feetOf, plantFeet } from './relations';
import type { Animation, Figure, PoseAsset, PoseKey, Scene, Vec3 } from './types';

/*
 * Library assets applied to what is being edited: a pose to a figure, a motion to a figure's
 * track. The figure keeps where it stands and which way it faces.
 */

/** The figure in the given pose (joints and hands), still facing the same way. */
export function withPose(f: Figure, p: PoseAsset): Figure {
  const r = p.joints.root ?? [0, 0, 0];
  return {
    ...f,
    joints: { ...structuredClone(p.joints), root: [r[0], facing(f), r[2]] },
    hands: { L: cloneHand(p.hands.L), R: cloneHand(p.hands.R) },
  };
}

/** Rotate a floor offset by `deg` about the vertical axis (the same sense as turning a figure). */
function turn(x: number, z: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

/**
 * Put a one-person motion (an animated scene) on one figure's track, starting at `start`. Its
 * moves are turned and moved to start where the figure stands, facing its way; the figure's own
 * keys inside that time are replaced, the other figures' tracks are untouched. The animation is
 * created or lengthened as needed.
 */
export function insertMotion(scene: Scene, figureId: string, motion: Scene, start: number): Scene {
  const target = scene.figures.find((f) => f.id === figureId);
  const src = motion.figures[0];
  const m = motion.animation;
  if (!target || !src || !m) return scene;
  const end = Math.min(60, start + m.duration);
  let a: Animation = scene.animation ?? { ...newAnimation(scene, Math.max(end, 0.2)), loop: m.loop && start === 0 };
  if (end > a.duration) a = { ...a, duration: end };
  const t0 = snapTime(a, start);
  const t1 = snapTime(a, end);

  const turnBy = facing(target) - facing(src);
  // Heights are of the hips; a grounded figure's are those of standing.
  const hipsOf = (f: Figure) => (f.grounded ? legsOf(f.body).rootY : f.position[1]);
  const rise = hipsOf(target) - hipsOf(src);
  const retarget = (p: PoseKey): PoseKey => {
    const [dx, dz] = turn(p.position[0] - src.position[0], p.position[2] - src.position[2], turnBy);
    const root = p.joints.root ?? [0, 0, 0];
    const y = p.grounded ? target.position[1] : r3(p.position[1] + rise);
    return {
      joints: { ...structuredClone(p.joints), root: [root[0], r3(wrapDeg(root[1] + turnBy)), root[2]] },
      position: [r3(target.position[0] + dx), y, r3(target.position[2] + dz)] as Vec3,
      hands: { L: cloneHand(p.hands.L), R: cloneHand(p.hands.R) },
      grounded: p.grounded,
      ...(p.travel && { travel: p.travel }),
      ...(p.strafe && { strafe: p.strafe }),
      ...(p.spin && { spin: p.spin }),
      ...(p.flip && { flip: p.flip }),
    };
  };

  // The motion's keys for its figure, and for a loop the first again at the end (a full cycle).
  const moves = m.keys.filter((k) => k.poses[src.id]).map((k) => ({ t: k.t, pose: k.poses[src.id] }));
  if (m.loop && moves.length) moves.push({ t: m.duration, pose: moves[0].pose });

  // Clear the figure's keys in that span, then key the motion.
  let keys = a.keys
    .map((k) => (k.t >= t0 - 1e-6 && k.t <= t1 + 1e-6 && k.poses[figureId] ? { ...k, poses: Object.fromEntries(Object.entries(k.poses).filter(([id]) => id !== figureId)) } : k))
    .filter((k) => Object.keys(k.poses).length || Object.keys(k.props ?? {}).length);
  const retargeted = moves.map((m) => retarget(m.pose));
  const locked = JSON.stringify(src.body) === JSON.stringify(target.body) ? retargeted : lockFeet(src, target, moves.map((m) => m.pose), retargeted);
  for (const [n, { t }] of moves.entries()) {
    const time = snapTime(a, start + t);
    const i = keys.findIndex((k) => Math.abs(k.t - time) < 0.5 / a.fps);
    const keyed = locked[n];
    keys = i >= 0 ? keys.map((k, j) => (j === i ? { ...k, poses: { ...k.poses, [figureId]: keyed } } : k)) : [...keys, { t: time, poses: { [figureId]: keyed } }];
  }
  return { ...scene, animation: { ...a, keys: keys.sort((p, q) => p.t - q.t) } };
}

/**
 * Feet planted in a motion stay planted on the figure it is put on (whose legs may be longer or
 * hips wider), as game engines lock feet when retargeting: wherever a foot stays put from key to
 * key in the motion, the figure's leg is solved to keep its foot where it landed.
 */
function lockFeet(src: Figure, target: Figure, from: PoseKey[], to: PoseKey[]): PoseKey[] {
  const rig = new Rig();
  try {
    const as = (f: Figure, p: PoseKey): Figure => ({ ...f, joints: p.joints, position: p.position, hands: p.hands, grounded: p.grounded });
    const source = from.map((p) => feetOf(rig, as(src, p)));
    const floor = Math.min(...source.flat().map((foot) => foot.p.y));
    const landed = to.map((p) => feetOf(rig, as(target, p)));
    const anchors: ReturnType<typeof feetOf>[] = to.map(() => []);
    for (const side of [0, 1]) {
      let anchor: ReturnType<typeof feetOf>[number] | null = null;
      for (let i = 0; i < from.length; i++) {
        const now = source[i][side];
        const before = i > 0 ? source[i - 1][side] : null;
        const down = (y: number) => y - floor < 0.03;
        const stays = !!before && down(now.p.y) && down(before.p.y) && Math.hypot(now.p.x - before.p.x, now.p.z - before.p.z) < 0.02;
        if (!stays || from[i].travel) {
          anchor = landed[i][side];
          continue;
        }
        // Only where it would move (a pose that already keeps the foot is left as made).
        if (landed[i][side].p.distanceTo(anchor!.p) > 0.01) anchors[i].push(anchor!);
      }
    }
    return to.map((p, i) => (anchors[i].length ? { ...p, joints: plantFeet(rig, as(target, p), anchors[i]).joints } : p));
  } finally {
    rig.dispose();
  }
}
