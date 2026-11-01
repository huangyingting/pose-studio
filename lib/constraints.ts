import * as THREE from 'three';
import { DEFAULT_BODY } from './body';
import { RELAXED_HAND } from './hands';
import { samplePart } from './clip';
import { clampRotation } from './joints';
import { feetOf, plantFeet } from './locomotion';
import { IK_CHAINS, rotateWorld, scaleOf } from './mannequin';
import { angleToQuat, fromQuat, quatToAngle, toQuat } from './pose';
import { Rig } from './relations';
import type { Clip, ClipContact, Figure, Holder, JointName } from './types';

/*
 * Constraints: body parts held on something, solved for the actual bodies in one pass after the
 * actions have posed everyone (lib/evaluate.ts gathers them). They come from clips (their
 * planted feet, and hands holding another person, found once when the clip is made) and from
 * the user ("hold on to …": a hand on someone's shoulder, a foot on a step, the hips on a seat).
 */

/** Is the foot down (near the clip's floor) and in the same place from `a` to the later `b`, not lifting off? */
const stays = (a: { p: { x: number; y: number; z: number } }, b: { p: { x: number; y: number; z: number } }, floor: number) =>
  a.p.y - floor < 0.03 && b.p.y - floor < 0.03 && b.p.y - a.p.y < 0.005 && Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z) < 0.02;

/** The planted feet of one part of a clip: stretches where a foot stays put on the floor, sampled every frame. */
export function detectContacts(clip: Clip, index: number, fps: number): ClipContact[] {
  const part = clip.parts[index];
  const rig = new Rig();
  try {
    const frames = Math.max(1, Math.round(clip.duration * fps));
    const figure: Figure = { id: 'contacts', name: '', body: part.body ?? DEFAULT_BODY, bones: {}, hands: { L: RELAXED_HAND, R: RELAXED_HAND }, position: [0, 0, 0], grounded: true };
    const times = Array.from({ length: frames + 1 }, (_, i) => Math.min(clip.duration, i / fps));
    const feet = times.map((t) => feetOf(rig, { ...figure, ...samplePart(part, t, clip.duration, false) }));
    const floor = Math.min(...feet.flat().map((f) => f.p.y));
    const out: ClipContact[] = [];
    for (const [side, bone] of [[0, 'leftFoot'], [1, 'rightFoot']] as const) {
      let from = -1;
      for (let i = 1; i <= frames + 1; i++) {
        const on = i <= frames && stays(feet[i - 1][side], feet[i][side], floor);
        if (on && from < 0) from = i - 1;
        if (!on && from >= 0) {
          // Down for a few frames at least (not a foot passing low).
          if (i - 1 - from >= 3) out.push({ part: index, bone, start: times[from], end: times[i - 1] });
          from = -1;
        }
      }
    }
    return out;
  } finally {
    rig.dispose();
  }
}

/** How near a hand comes to another part's bone (its axis) to touch it, by bone (m). */
const REACH_IN: Partial<Record<JointName, number>> = { hips: 0.17, spine: 0.17, chest: 0.17, neck: 0.1, leftUpperArm: 0.08, rightUpperArm: 0.08, leftLowerArm: 0.07, rightLowerArm: 0.07, leftUpperLeg: 0.1, rightUpperLeg: 0.1, leftLowerLeg: 0.08, rightLowerLeg: 0.08 };
/** The joint a bone runs to (its axis is from its joint to that one). */
const BONE_END: Partial<Record<JointName, JointName>> = {
  hips: 'spine', spine: 'chest', chest: 'upperChest', upperChest: 'neck', neck: 'head',
  leftShoulder: 'leftUpperArm', rightShoulder: 'rightUpperArm', leftUpperArm: 'leftLowerArm', rightUpperArm: 'rightLowerArm', leftLowerArm: 'leftHand', rightLowerArm: 'rightHand',
  leftUpperLeg: 'leftLowerLeg', rightUpperLeg: 'rightLowerLeg', leftLowerLeg: 'leftFoot', rightLowerLeg: 'rightFoot', leftFoot: 'leftToes', rightFoot: 'rightToes',
};
/** A hand on the trunk is held in the chest's frame (it may sit over the spine or the chest from frame to frame). */
const TRUNK: JointName[] = ['hips', 'spine', 'chest', 'upperChest', 'leftShoulder', 'rightShoulder', 'neck'];

/**
 * Where the parts of a clip of several people hold each other: stretches where a hand stays on
 * the same spot of another part's body (a hold, a grip), sampled every frame.
 */
export function detectGrips(clip: Clip, fps: number): ClipContact[] {
  if (clip.parts.length < 2) return [];
  const rig = new Rig();
  try {
    const frames = Math.max(1, Math.round(clip.duration * fps));
    const times = Array.from({ length: frames + 1 }, (_, i) => Math.min(clip.duration, i / fps));
    const models = (t: number) => clip.parts.map((part, i) => rig.model({ id: `grip${i}`, name: '', body: part.body ?? DEFAULT_BODY, ...samplePart(part, t, clip.duration, false) }));
    // Per frame, for each part's hands: the spot on another part they touch (in that bone's frame), if any.
    type Touch = { part: number; bone: JointName; at: THREE.Vector3 } | null;
    const touches: Touch[][][] = times.map((t) => {
      const ms = models(t);
      return ms.map((m, p) => (['leftHand', 'rightHand'] as const).map((hand) => {
        const w = m.joints[hand].getWorldPosition(new THREE.Vector3());
        let best: Touch = null;
        let bestGap = Infinity;
        ms.forEach((o, q) => {
          if (q === p) return;
          for (const [bone, r] of Object.entries(REACH_IN) as [JointName, number][]) {
            const a = o.joints[bone].getWorldPosition(new THREE.Vector3());
            const b = o.joints[BONE_END[bone]!].getWorldPosition(new THREE.Vector3());
            const gap = new THREE.Line3(a, b).closestPointToPoint(w, true, new THREE.Vector3()).distanceTo(w) - r;
            const frame: JointName = TRUNK.includes(bone) ? 'chest' : bone;
            if (gap < 0.03 && gap < bestGap) [best, bestGap] = [{ part: q, bone: frame, at: o.joints[frame].worldToLocal(w.clone()) }, gap];
          }
        });
        return best;
      }));
    });
    const out: ClipContact[] = [];
    clip.parts.forEach((_, p) => (['leftHand', 'rightHand'] as const).forEach((hand, h) => {
      let from = -1;
      let last = -1;
      const close = () => {
        if (from >= 0 && last - from >= 3) {
          const t = touches[from][p][h]!;
          out.push({ part: p, bone: hand, start: times[from], end: times[last], on: { part: t.part, bone: t.bone } });
        }
        from = -1;
      };
      for (let i = 0; i <= frames; i++) {
        const now = touches[i][p][h];
        const held = from >= 0 ? touches[from][p][h]! : null;
        // The same spot of the same bone (a hand that slides along is not a hold); a frame or two
        // off it is the same hold still.
        const same = !!now && !!held && now.part === held.part && now.bone === held.bone && now.at.distanceTo(held.at) < 0.06;
        if (same) last = i;
        else if (from >= 0 && i - last > 2) close();
        if (from < 0 && now) [from, last] = [i, i];
      }
      close();
    }));
    return out;
  } finally {
    rig.dispose();
  }
}

/**
 * Two-bone IK with the least change: the middle joint (an elbow or knee, a hinge) bends or
 * straightens to the distance, then the upper bone turns the shortest way to the target, so the
 * limb keeps its twist (stable for a limb held almost straight).
 */
function reachLeast(m: ReturnType<Rig['model']>, chain: readonly [JointName, JointName, JointName], target: THREE.Vector3) {
  const [u, mid, e] = chain.map((j) => m.joints[j]);
  m.object.updateMatrixWorld(true);
  const A = u.getWorldPosition(new THREE.Vector3());
  const B = mid.getWorldPosition(new THREE.Vector3());
  const C = e.getWorldPosition(new THREE.Vector3());
  const [a, b] = [A.distanceTo(B), B.distanceTo(C)];
  // Near full stretch the reach saturates smoothly, so a limb going straight (a target out of
  // reach) does not stop bending all at once.
  const full = a + b - 1e-3;
  const knee0 = full * 0.9;
  const want = target.distanceTo(A);
  const d = THREE.MathUtils.clamp(want > knee0 ? knee0 + (full - knee0) * (1 - Math.exp(-(want - knee0) / (full - knee0))) : want, Math.abs(a - b) + 1e-3, full);
  const inner = (len: number) => Math.acos(THREE.MathUtils.clamp((a * a + b * b - len * len) / (2 * a * b), -1, 1));
  const knee = chain[0].endsWith('UpperLeg');
  // Elbows bend with a negative turn about their own x axis, knees with a positive one.
  mid.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (inner(A.distanceTo(C)) - inner(d)) * (knee ? 1 : -1)));
  m.object.updateMatrixWorld(true);
  const now = e.getWorldPosition(new THREE.Vector3()).sub(A);
  rotateWorld(u, new THREE.Quaternion().setFromUnitVectors(now.normalize(), target.clone().sub(A).normalize()));
}

/** A body part held somewhere in the world, so much (0–1). */
export interface Hold {
  bone: Holder;
  /** Where: what a hand's palm touches, where an ankle goes, where the pelvis goes. */
  at: THREE.Vector3;
  weight: number;
  /** The limb kept as it moves (a clip's way of moving): only what it takes to get the part from where it is to `at` changes. */
  relative?: boolean;
}

/**
 * Solve a figure's holds in one pass: the hips first (they carry the body), then each hand and
 * foot reaches its place with two-bone IK (within the joints' limits).
 */
export function solveHolds(rig: Rig, f: Figure, holds: Hold[], limits = true): Pick<Figure, 'bones' | 'position' | 'grounded'> {
  let fig = f;
  const hips = holds.find((h) => h.bone === 'hips');
  if (hips && hips.weight > 0) {
    const now = rig.model(fig).joints.hips.getWorldPosition(new THREE.Vector3());
    const d = hips.at.clone().sub(now).multiplyScalar(hips.weight);
    fig = { ...fig, grounded: false, position: [fig.position[0] + d.x, now.y + d.y, fig.position[2] + d.z] };
  }
  for (const h of holds) {
    if (h.bone === 'hips' || h.weight <= 0) continue;
    const chain = IK_CHAINS[h.bone];
    const side = h.bone.startsWith('left') ? 'L' : 'R';
    const foot = h.bone.endsWith('Foot');
    const m = rig.model(fig);
    const end = m.joints[h.bone];
    const here = { side, p: end.getWorldPosition(new THREE.Vector3()), q: end.getWorldQuaternion(new THREE.Quaternion()) } as const;
    let solved: Figure['bones'];
    if (foot && h.relative) {
      // The leg turned by what it takes to bring the foot from where it is to `at` (its own way of
      // bending kept); again from where that leaves it, while it is still off the spot (the turn is
      // worked out for the leg as the solver would bend it, not quite as the clip has it).
      // (Only while it comes nearer: a spot out of reach is not chased round.)
      let bonesNow = fig.bones;
      let best = { bones: fig.bones, miss: Infinity };
      // (Fully held only: easing onto or off the spot, one turn, as before — no jumps as it starts.)
      for (let pass = 0; pass < (h.weight >= 0.999 ? 3 : 1); pass++) {
        const cur = { ...fig, bones: bonesNow };
        const e = rig.model(cur).joints[h.bone];
        const at = { side, p: e.getWorldPosition(new THREE.Vector3()), q: e.getWorldQuaternion(new THREE.Quaternion()) } as const;
        const miss = at.p.distanceTo(h.at);
        if (pass > 0) {
          if (miss >= best.miss) break;
          best = { bones: bonesNow, miss };
          if (miss < 0.003) break;
        }
        const [from, to] = [plantFeet(rig, cur, [at]).bones, plantFeet(rig, cur, [{ ...at, p: h.at }]).bones];
        const next = { ...bonesNow, ...Object.fromEntries(chain.map((j) => [j, toQuat(fromQuat(bonesNow[j]).multiply(fromQuat(from[j]).invert().multiply(fromQuat(to[j]))))])) };
        // (A leg that would swing round to another way of bending — a deep crouch — is left as the first turn has it.)
        if (pass > 0 && chain.some((j) => fromQuat(next[j]).angleTo(fromQuat(fig.bones[j])) > 0.6)) break;
        bonesNow = next;
        if (pass === 0) best = { bones: bonesNow, miss: Infinity };
      }
      solved = best.bones;
    } else if (foot) solved = plantFeet(rig, fig, [{ ...here, p: h.at }]).bones;
    else {
      // A hand turns its arm by the least it takes (continuous as the target moves, from the pose
      // the arm is in); a hand held on a spot has its palm there, its wrist a little before it.
      const shoulder = m.joints[chain[0]].getWorldPosition(new THREE.Vector3());
      const wrist = h.relative ? h.at : h.at.clone().add(shoulder.sub(h.at).normalize().multiplyScalar(0.07 * scaleOf(fig.body)));
      reachLeast(m, chain, wrist);
      solved = m.read().bones;
    }
    const bones = { ...fig.bones };
    for (const j of chain) {
      let q = toQuat(fromQuat(fig.bones[j]).slerp(fromQuat(solved[j]), Math.min(1, h.weight)));
      // A knee or elbow does not bend backwards to reach.
      if (limits && j === chain[1]) q = angleToQuat(j, clampRotation(j, quatToAngle(j, q)));
      bones[j] = q;
    }
    fig = { ...fig, bones };
  }
  return { bones: fig.bones, position: fig.position, grounded: fig.grounded };
}
