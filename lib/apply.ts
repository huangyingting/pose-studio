import { newAnimation, samplePose, snapTime } from './animation';
import { cloneHand } from './hands';
import { wrapDeg } from './joints';
import { feetOf, legsOf, plantFeet } from './locomotion';
import { anglesOf, bonesOf } from './pose';
import { Rig, facing, withFacing } from './relations';
import type { Animation, Figure, PoseAsset, PoseKey, Scene, Vec3 } from './types';

/*
 * Library assets applied to what is being edited: a pose to a figure, a motion to a figure's
 * track. The figure keeps where it stands and which way it faces.
 */

/** The figure in the given pose (joints and hands), still facing the same way. */
export function withPose(f: Figure, p: PoseAsset): Figure {
  return withFacing({ ...f, bones: { ...p.bones }, hands: { L: cloneHand(p.hands.L), R: cloneHand(p.hands.R) } }, facing(f));
}

/** Rotate a floor offset by `deg` about the vertical axis (the same sense as turning a figure). */
function turn(x: number, z: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

/**
 * Put a motion (an animated scene) on figures' tracks, starting at `start`: `cast` names the
 * figure taking each of its parts, in its order (one figure for a one-person motion). It is turned
 * and moved to start where the first of them (the lead) stands, facing its way; the others take
 * their places around the lead as in the motion. Their own keys inside that time are replaced, the
 * other figures' tracks are untouched. The animation is created or lengthened as needed.
 */
export function insertMotion(scene: Scene, cast: string | string[], motion: Scene, start: number): Scene {
  const ids = typeof cast === 'string' ? [cast] : cast;
  // Each figure as it is when the motion starts (where an animation has put it by then).
  const targets = ids.map((id) => {
    const f = scene.figures.find((x) => x.id === id);
    const p = f && scene.animation ? samplePose(scene.animation, id, start) : null;
    return f && p ? { ...f, bones: bonesOf(p.joints), position: p.position, grounded: p.grounded } : f;
  });
  const m = motion.animation;
  if (!m || ids.length > motion.figures.length || targets.some((f) => !f) || new Set(ids).size < ids.length) return scene;
  const end = Math.min(60, start + m.duration);
  let a: Animation = scene.animation ?? { ...newAnimation(scene, Math.max(end, 0.2)), loop: m.loop && start === 0 };
  if (end > a.duration) a = { ...a, duration: end };
  const t0 = snapTime(a, start);
  const t1 = snapTime(a, end);

  // Placed by the lead: turned to its facing, moved to where it stands.
  const lead = targets[0]!;
  const leadSrc = motion.figures[0];
  const turnBy = facing(lead) - facing(leadSrc);
  // Travel, spacing and changes of height scale with the figures (a child's cartwheel covers less
  // ground); people moving together keep together, spaced for the biggest of them so nobody walks
  // into anybody.
  const size = Math.max(...targets.map((f, n) => legsOf(f!.body).rootY / legsOf(motion.figures[n].body).rootY));
  // Heights are of the hips; a grounded figure's are those of standing.
  const hipsOf = (f: Figure) => (f.grounded ? legsOf(f.body).rootY : f.position[1]);

  let keys = a.keys;
  for (const [n, target] of targets.entries()) {
    const src = motion.figures[n];
    const figureId = target!.id;
    const retarget = (p: PoseKey): PoseKey => {
      const [dx, dz] = turn((p.position[0] - leadSrc.position[0]) * size, (p.position[2] - leadSrc.position[2]) * size, turnBy);
      const root = p.joints.hips ?? [0, 0, 0];
      const y = p.grounded ? lead.position[1] : r3(hipsOf(target!) + (p.position[1] - hipsOf(src)) * size);
      return {
        joints: { ...structuredClone(p.joints), hips: [root[0], r3(wrapDeg(root[1] + turnBy)), root[2]] },
        position: [r3(lead.position[0] + dx), y, r3(lead.position[2] + dz)] as Vec3,
        hands: { L: cloneHand(p.hands.L), R: cloneHand(p.hands.R) },
        grounded: p.grounded,
        ...(p.travel && { travel: p.travel }),
        ...(p.strafe && { strafe: p.strafe }),
        ...(p.spin && { spin: p.spin }),
        ...(p.flip && { flip: p.flip }),
      };
    };

    // The motion's keys for this part, and for a loop the first again at the end (a full cycle).
    const keyed = m.keys.filter((k) => k.poses[src.id]).map((k) => ({ t: k.t, pose: k.poses[src.id] }));
    if (m.loop && keyed.length && keyed[keyed.length - 1].t < m.duration - 1e-6) keyed.push({ t: m.duration, pose: keyed[0].pose });
    const same = JSON.stringify(src.body) === JSON.stringify(target!.body);
    // On other proportions, stretches with a foot planted get a key every frame, each with the
    // foot locked (blended joint angles alone would let it drift between keys far apart).
    const moves = same ? keyed : densePlanted(m, src, keyed);

    // How it got to where the motion starts (the end of a walk there, say) stays.
    const arrival = keys.find((k) => Math.abs(k.t - t0) < 1e-6)?.poses[figureId];
    const how = arrival ? { ...(arrival.travel && { travel: arrival.travel }), ...(arrival.strafe && { strafe: arrival.strafe }), ...(arrival.spin && { spin: arrival.spin }), ...(arrival.flip && { flip: arrival.flip }) } : {};
    // Clear the figure's keys in that span, then key the motion.
    keys = keys
      .map((k) => (k.t >= t0 - 1e-6 && k.t <= t1 + 1e-6 && k.poses[figureId] ? { ...k, poses: Object.fromEntries(Object.entries(k.poses).filter(([id]) => id !== figureId)) } : k))
      .filter((k) => Object.keys(k.poses).length || Object.keys(k.props ?? {}).length);
    const retargeted = moves.map((x, i) => (i === 0 && !x.pose.travel ? { ...retarget(x.pose), ...how } : retarget(x.pose)));
    const locked = same ? retargeted : lockFeet(src, target!, moves.map((x) => x.pose), retargeted);
    for (const [i, { t }] of moves.entries()) {
      const time = snapTime(a, start + t);
      const at = keys.findIndex((k) => Math.abs(k.t - time) < 0.5 / a.fps);
      keys = at >= 0 ? keys.map((k, j) => (j === at ? { ...k, poses: { ...k.poses, [figureId]: locked[i] } } : k)) : [...keys, { t: time, poses: { [figureId]: locked[i] } }];
    }
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
    const as = (f: Figure, p: PoseKey): Figure => ({ ...f, bones: bonesOf(p.joints), position: p.position, hands: p.hands, grounded: p.grounded });
    // Keyed heights keep their contacts: where the motion's figure touches the floor (a hand in a
    // cartwheel), this figure does too, whatever its proportions.
    to = to.map((p, i) => {
      if (p.grounded) return p;
      const touch = rig.model(as(src, from[i])).lowest();
      if (touch > 0.05) return p;
      const m = rig.model(as(target, p));
      const y = m.joints.hips.position.y - Math.max(0, m.lowest() - touch);
      return { ...p, position: [p.position[0], Math.round(y * 1000) / 1000, p.position[2]] };
    });
    const source = from.map((p) => feetOf(rig, as(src, p)));
    const floor = Math.min(...source.flat().map((foot) => foot.p.y));
    const landed = to.map((p) => feetOf(rig, as(target, p)));
    const anchors: ReturnType<typeof feetOf>[] = to.map(() => []);
    for (const side of [0, 1]) {
      let anchor: ReturnType<typeof feetOf>[number] | null = null;
      for (let i = 0; i < from.length; i++) {
        const now = source[i][side];
        const before = i > 0 ? source[i - 1][side] : null;
        if (!before || !stays(before, now, floor) || from[i].travel) {
          anchor = landed[i][side];
          // A run of planted keys starts here: this key's leg is solved too (where its foot is), so
          // it matches the keys after it (and a loop's closing copy of it).
          if (!from[i].travel && i + 1 < from.length && stays(now, source[i + 1][side], floor)) anchors[i].push(anchor);
          continue;
        }
        anchors[i].push(anchor!);
      }
    }
    return to.map((p, i) => (anchors[i].length ? { ...p, joints: anglesOf(plantFeet(rig, as(target, p), anchors[i]).bones) } : p));
  } finally {
    rig.dispose();
  }
}

/** Is the foot down (near the motion's floor) and in the same place from `a` to the later `b`, not lifting off? */
const stays = (a: { p: { x: number; y: number; z: number } }, b: { p: { x: number; y: number; z: number } }, floor: number) =>
  a.p.y - floor < 0.03 && b.p.y - floor < 0.03 && b.p.y - a.p.y < 0.005 && Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z) < 0.02;

/** The motion's keys, plus a sample every frame between keys where a foot stays planted. */
function densePlanted(m: Animation, src: Figure, keyed: { t: number; pose: PoseKey }[]) {
  const rig = new Rig();
  try {
    const feet = keyed.map((k) => feetOf(rig, { ...src, bones: bonesOf(k.pose.joints), position: k.pose.position, hands: k.pose.hands, grounded: k.pose.grounded }));
    const floor = Math.min(...feet.flat().map((f) => f.p.y));
    const step = 1 / m.fps;
    const out: { t: number; pose: PoseKey }[] = [];
    keyed.forEach((k, i) => {
      out.push(k);
      const next = keyed[i + 1];
      if (!next || next.pose.travel || !feet[i].some((f, s) => stays(f, feet[i + 1][s], floor))) return;
      for (let t = k.t + step; t < next.t - step / 2; t += step) {
        const pose = samplePose(m, src.id, Math.min(t, m.duration - 1e-6));
        if (pose) out.push({ t: Math.round(t * 1000) / 1000, pose });
      }
    });
    return out;
  } finally {
    rig.dispose();
  }
}
