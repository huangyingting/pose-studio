import * as THREE from 'three';
import { poseOf } from './animation';
import { DEFAULT_BODY } from './body';
import { mirrorFigure, newFigure, newScene } from './doc';
import { HAND_PRESETS, cloneHand } from './hands';
import { wrapDeg } from './joints';
import { Rig, headPoint, leftward, forward, reach, withFacing } from './relations';
import { CAMERA_MOVES } from './shot';
import { buildTemplate, waltzHold } from './templates';
import { plantFeet, travelTime } from './locomotion';
import type { Animation, BodyParams, Figure, Hand, JointName, PoseKey, Scene, Side, Travel, Vec3, View } from './types';

/*
 * Animated templates: walking, running and jumping ahead (generated, lib/locomotion.ts), dances,
 * a boxing exchange and more. One-person motions are made on the default figure, so on a figure
 * like it they play exactly as made (on other proportions, planted feet are locked: apply.ts).
 * Keys are authored as joint angles (with IK for contacts and punches) and each animation
 * comes with a camera move, so it plays like a short shot.
 */

/** Groups of the motion library (several-people motions are listed on their own). */
export const MOTION_GROUPS = ['Getting around', 'Fighting', 'Sport & gymnastics', 'Dance', 'Everyday', 'Two people'] as const;

export interface Motion {
  id: string;
  name: string;
  group: (typeof MOTION_GROUPS)[number];
  people: number;
  build(): Scene;
  /** Moving from mark to mark (generated steps): applied, the figure goes this far ahead. */
  travel?: { kind: Travel; distance: number };
}

type Joints = Figure['joints'];

const hand = (name: string): Hand => cloneHand(HAND_PRESETS.find((p) => p.name === name)!.hand);

function person(name: string, b: BodyParams, joints: Joints = {}, yaw = 0, pos: Vec3 = [0, 0, 0]): Figure {
  return withFacing({ ...newFigure({ name, body: b, position: pos }), joints }, yaw);
}

/** Same figure with different joints (keeps id, body, facing). */
function posed(f: Figure, joints: Joints, extra: Partial<Figure> = {}): Figure {
  const yaw = f.joints.root?.[1] ?? 0;
  const root = joints.root ?? [0, 0, 0];
  return { ...f, ...extra, joints: { ...joints, root: [root[0], wrapDeg(yaw + root[1]), root[2]] } };
}

/** Swap left and right limbs, keeping where the figure stands and faces. */
function mirrored(f: Figure): Figure {
  const m = mirrorFigure(f);
  const r = f.joints.root ?? [0, 0, 0];
  return { ...m, position: f.position, joints: { ...m.joints, root: [r[0], r[1], -r[2] || 0] } };
}

interface Key {
  t: number;
  figures: Figure[];
}

function animated(name: string, keys: Key[], o: { duration: number; loop: boolean; view: View; camera?: string }): Scene {
  const scene = { ...newScene(name, keys[0].figures), view: o.view };
  const animation: Animation = {
    duration: o.duration,
    fps: 24,
    loop: o.loop,
    // On frame times, so a motion put on a figure's track plays exactly as made.
    keys: keys.map((k) => ({ t: Math.round(k.t * 24) / 24, poses: Object.fromEntries(k.figures.map((f) => [f.id, poseOf(f)])) })),
  };
  const move = CAMERA_MOVES.find((m) => m.id === (o.camera ?? 'static'));
  if (move) animation.camera = { keys: move.keys(animation, o.view), follow: move.follow ?? false, shake: move.shake ?? 0 };
  return { ...scene, animation };
}

/** A figure walking, running or jumping `distance` metres ahead, its steps generated. */
function travelled(f: Figure, kind: Travel, distance: number, o: { view: View; camera?: string }): Scene {
  const t = Math.round(travelTime(kind, distance, f.body) * 24) / 24;
  const there: PoseKey = { ...poseOf(f), position: [f.position[0], f.position[1], f.position[2] + distance], travel: kind };
  const scene = animated(f.name, [{ t: 0, figures: [f] }], { duration: t, loop: false, ...o });
  const a = scene.animation!;
  const keys = [...a.keys, { t, poses: { [f.id]: there } }];
  const animation = { ...a, keys };
  if (a.camera) {
    const move = CAMERA_MOVES.find((m) => m.id === (o.camera ?? 'static'))!;
    animation.camera = { ...a.camera, keys: move.keys(animation, o.view), follow: true };
  }
  return { ...scene, animation };
}

function withRig<T>(fn: (rig: Rig) => T): T {
  const rig = new Rig();
  try {
    return fn(rig);
  } finally {
    rig.dispose();
  }
}

/** A point in a figure's own frame relative to one of its joints: [left, up, forward]. */
function local(rig: Rig, f: Figure, joint: JointName, offset: Vec3) {
  const p = rig.model(f).joints[joint].getWorldPosition(new THREE.Vector3());
  const [lx, lz] = leftward(f);
  const [fx, fz] = forward(f);
  return p.add(new THREE.Vector3(lx * offset[0] + fx * offset[2], offset[1], lz * offset[0] + fz * offset[2]));
}

function reachTo(rig: Rig, f: Figure, side: Side, target: THREE.Vector3) {
  return { ...f, joints: reach(rig, f, side, target).joints };
}

/** Rotate a figure rigidly about the vertical axis through the origin. */
function turnAbout(f: Figure, deg: number): Figure {
  const a = THREE.MathUtils.degToRad(deg);
  const [x, y, z] = f.position;
  const r = f.joints.root ?? [0, 0, 0];
  return {
    ...f,
    position: [Math.round((x * Math.cos(a) + z * Math.sin(a)) * 1000) / 1000, y, Math.round((-x * Math.sin(a) + z * Math.cos(a)) * 1000) / 1000],
    joints: { ...f.joints, root: [r[0], wrapDeg(r[1] + deg), r[2]] },
  };
}

/* ---------- poses ---------- */

const STAND: Joints = { shoulderL: [0, 0, 8], shoulderR: [0, 0, -8], elbowL: [-10, 0, 0], elbowR: [-10, 0, 0], hipL: [0, 0, 3], hipR: [0, 0, -3] };
const STANCE: Joints = {
  root: [6, 25, 0], spine: [6, -12, 0], chest: [4, -10, 0],
  hipL: [-26, 0, 8], kneeL: [26, 0, 0], ankleL: [-6, 0, 0],
  hipR: [16, 0, -12], kneeR: [24, 0, 0], ankleR: [6, 0, 0],
};

/** Fists up by the face (boxing guard), solved with IK for this figure's proportions. */
function guard(rig: Rig, f: Figure): Figure {
  let g = reachTo(rig, f, 'L', local(rig, f, 'head', [0.04, 0.02, 0.36]));
  g = reachTo(rig, g, 'R', local(rig, g, 'head', [-0.13, -0.04, 0.2]));
  return { ...g, hands: { L: hand('Fist'), R: hand('Fist') } };
}

/** The same joints with some changed (bending a guard, sinking a stance…). */
function adjusted(f: Figure, joints: Joints, extra: Partial<Figure> = {}): Figure {
  return { ...f, ...extra, joints: { ...f.joints, ...joints } };
}

/** Pitch the pelvis by `by` (negative: back), the thighs countering it so the feet stay put. */
function rock(f: Figure, by: number): Figure {
  const j = f.joints;
  const r = j.root ?? [0, 0, 0];
  const thigh = (h: Vec3 | undefined): Vec3 => [(h?.[0] ?? 0) - by, h?.[1] ?? 0, h?.[2] ?? 0];
  return adjusted(f, { root: [r[0] + by, r[1], r[2]], hipL: thigh(j.hipL), hipR: thigh(j.hipR) });
}

/** Sink by bending the knees: thighs forward and shins back as much, so the feet stay put. */
function sink(f: Figure, knee: number): Figure {
  const j = f.joints;
  const add = (r: Vec3 | undefined, by: number): Vec3 => [(r?.[0] ?? 0) + by, r?.[1] ?? 0, r?.[2] ?? 0];
  return adjusted(f, {
    kneeL: add(j.kneeL, knee), kneeR: add(j.kneeR, knee),
    hipL: add(j.hipL, -knee / 2), hipR: add(j.hipR, -knee / 2),
    ankleL: add(j.ankleL, -knee / 2), ankleR: add(j.ankleR, -knee / 2),
  });
}

/** A point near one of a figure's joints, offset in the world ([x, y, z]; motions are built facing +Z, +X on the left). */
function near(rig: Rig, f: Figure, joint: JointName, offset: Vec3) {
  return rig.model(f).joints[joint].getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(...offset));
}

/** The pose moved on the floor so its `side` foot is where `ref` has that foot (a step lands there). */
function footAt(rig: Rig, pose: Figure, ref: Figure, side: Side): Figure {
  const ankle = side === 'L' ? 'ankleL' : 'ankleR';
  const want = rig.model(ref).joints[ankle].getWorldPosition(new THREE.Vector3());
  const have = rig.model(pose).joints[ankle].getWorldPosition(new THREE.Vector3());
  const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
  return { ...pose, position: [r3(pose.position[0] + want.x - have.x), pose.position[1], r3(pose.position[2] + want.z - have.z)] };
}

/** Poses between `a` and `b` (joints and place blended), with feet kept where `ref` has them: a big change of pose with the feet planted all through. */
function inBetween(rig: Rig, a: Figure, b: Figure, count: number, ref: Figure, sides: Side[] = ['L', 'R']): Figure[] {
  return Array.from({ length: count }, (_, i) => {
    const u = (i + 1) / (count + 1);
    const mix = (p: Vec3 | undefined, q: Vec3 | undefined): Vec3 => [0, 1, 2].map((c) => (p?.[c] ?? 0) + wrapDeg((q?.[c] ?? 0) - (p?.[c] ?? 0)) * u) as Vec3;
    const joints = Object.fromEntries([...new Set([...Object.keys(a.joints), ...Object.keys(b.joints)])].map((j) => [j, mix(a.joints[j as JointName], b.joints[j as JointName])]));
    const position = a.position.map((v, c) => v + (b.position[c] - v) * u) as Vec3;
    return plantFeet(rig, { ...a, joints, position, grounded: a.grounded && b.grounded }, ref, sides);
  });
}


/** Turn a figure about a vertical axis through a floor point (a pirouette turns on the standing foot). */
function turnOn(f: Figure, deg: number, pivot: [number, number]): Figure {
  const t = turnAbout({ ...f, position: [f.position[0] - pivot[0], f.position[1], f.position[2] - pivot[1]] }, deg);
  return { ...t, position: [Math.round((t.position[0] + pivot[0]) * 1000) / 1000 || 0, t.position[1], Math.round((t.position[2] + pivot[1]) * 1000) / 1000 || 0] };
}

export const MOTIONS: Motion[] = [
  {
    id: 'walk',
    name: 'Walk ahead',
    group: 'Getting around',
    people: 1,
    travel: { kind: 'walk', distance: 3 },
    build: () => travelled(person('Walker', { ...DEFAULT_BODY }, STAND), 'walk', 3, { view: { yaw: 70, pitch: 6, fov: 30 }, camera: 'static' }),
  },
  {
    id: 'run',
    name: 'Run ahead',
    group: 'Getting around',
    people: 1,
    travel: { kind: 'run', distance: 6 },
    build: () => travelled({ ...person('Runner', { ...DEFAULT_BODY }, STAND), hands: { L: hand('Grip'), R: hand('Grip') } }, 'run', 6, { view: { yaw: 90, pitch: 4, fov: 34 }, camera: 'static' }),
  },
  {
    id: 'jump',
    name: 'Jump ahead',
    group: 'Getting around',
    people: 1,
    travel: { kind: 'jump', distance: 1 },
    build: () => travelled(person('Jumper', { ...DEFAULT_BODY }, STAND), 'jump', 1, { view: { yaw: 70, pitch: 4, fov: 30 }, camera: 'static' }),
  },
  {
    id: 'dance',
    name: 'Dance groove',
    group: 'Dance',
    people: 1,
    build: () => {
      const f = { ...person('Dancer', { ...DEFAULT_BODY }, STAND), hands: { L: hand('Open'), R: hand('Open') } };
      // The feet stay where they stand: the hips sway (tilted, the legs kept upright at the hips),
      // the knees dip evenly, and the chest and arms groove.
      const stance: Joints = { hipL: [0, 0, 6], hipR: [0, 0, -6] };
      const up = posed(f, {
        ...stance, root: [0, 0, 6], hipL: [0, 0, 0], hipR: [0, 0, -12], spine: [0, 12, -8], chest: [0, 10, -5], head: [0, -10, 8],
        shoulderR: [-20, 0, -150], elbowR: [-24, 0, 0], shoulderL: [10, -20, 38], elbowL: [-95, 0, 0],
      });
      const dip = sink(posed(f, {
        ...stance, spine: [8, 0, 0], head: [6, 0, 0],
        shoulderL: [-62, 0, 48], shoulderR: [-62, 0, -48], elbowL: [-75, 0, 0], elbowR: [-75, 0, 0],
      }), 30);
      return animated('Dance groove', [
        { t: 0, figures: [up] }, { t: 0.5, figures: [dip] }, { t: 1, figures: [mirrored(up)] }, { t: 1.5, figures: [mirrored(dip)] },
      ], { duration: 2, loop: true, view: { yaw: 10, pitch: 6, fov: 26 }, camera: 'orbit360' });
    },
  },
  {
    id: 'waltz-turn',
    name: 'Waltz turn',
    group: 'Two people',
    people: 2,
    build: () => withRig((rig) => {
      const hold = buildTemplate('waltz')!;
      const [a, b] = hold.figures;
      // A slightly open hold (room for the knees as they step), solved again at that spacing.
      const centre = [(a.position[0] + b.position[0]) / 2, (a.position[2] + b.position[2]) / 2];
      const spaced = (f: Figure): Figure => ({ ...f, position: [(f.position[0] - centre[0]) * 1.3, f.position[1], (f.position[2] - centre[1]) * 1.3] });
      const couple = waltzHold(rig, spaced(a), spaced(b));
      // A full turn in eight steps: each dancer side-steps around the couple's centre, turning with
      // it (generated steps, keeping their facing), so no foot slides and the hold keeps its shape.
      const keys: Key[] = Array.from({ length: 9 }, (_, i) => ({ t: i * 0.375, figures: couple.map((f) => turnAbout(f, -45 * i)) }));
      const scene = animated('Waltz turn', keys, { duration: 3, loop: true, view: { yaw: 30, pitch: 10, fov: 26 }, camera: 'push' });
      const anim = scene.animation!;
      return {
        ...scene,
        animation: {
          ...anim,
          keys: anim.keys.map((k, i) => (i ? { ...k, poses: Object.fromEntries(Object.entries(k.poses).map(([id, p]) => [id, { ...p, travel: 'walk' as const, strafe: true }])) } : k)),
        },
      };
    }),
  },
  {
    id: 'boxing',
    name: 'Boxing exchange',
    group: 'Two people',
    people: 2,
    build: () => withRig((rig) => {
      const [a0, b0] = buildTemplate('sparring')!.figures;
      const head = (f: Figure) => headPoint(rig.model(f), f);
      const towards = (from: Figure, to: Figure, short: number) => {
        const h = head(to);
        const s = local(rig, from, 'chest', [0, 0.2, 0]);
        return h.clone().add(s.clone().sub(h).normalize().multiplyScalar(short));
      };
      const jab = reachTo(rig, { ...a0, joints: { ...a0.joints, chest: [4, -16, 0] } }, 'L', towards(a0, b0, 0.12));
      const lean = { ...b0, joints: { ...b0.joints, spine: [-4, -12, 0], neck: [-12, 0, 0] } } as Figure;
      const crossBody: Figure = { ...a0, joints: { ...a0.joints, chest: [6, 18, 0], spine: [8, 10, 0] } };
      const cross = reachTo(rig, crossBody, 'R', towards(crossBody, b0, 0.14));
      // Slip: sink by bending the knees, thighs forward and shins back as much, so the feet stay put.
      const sink = (j: JointName, by: number): Vec3 => { const r = b0.joints[j] ?? [0, 0, 0]; return [r[0] + by, r[1], r[2]]; };
      const slip: Figure = { ...b0, joints: {
        ...b0.joints, spine: [10, -12, -14], kneeL: sink('kneeL', 14), kneeR: sink('kneeR', 12),
        hipL: sink('hipL', -7), hipR: sink('hipR', -6), ankleL: sink('ankleL', -7), ankleR: sink('ankleR', -6),
      } };
      const counter = reachTo(rig, { ...b0, joints: { ...b0.joints, chest: [4, -16, 0] } }, 'L', towards(b0, a0, 0.12));
      return animated('Boxing exchange', [
        { t: 0, figures: [a0, b0] },
        { t: 0.28, figures: [jab, lean] },
        { t: 0.55, figures: [a0, b0] },
        { t: 0.82, figures: [cross, slip] },
        { t: 1.15, figures: [a0, counter] },
        { t: 1.42, figures: [a0, b0] },
      ], { duration: 1.7, loop: true, view: { yaw: 15, pitch: 6, fov: 28 }, camera: 'handheld' });
    }),
  },
  {
    id: 'kick',
    name: 'Front kick',
    group: 'Fighting',
    people: 1,
    build: () => withRig((rig) => {
      const f = person('Fighter', { ...DEFAULT_BODY });
      const stance = guard(rig, posed(f, STANCE));
      const g = stance.joints;
      // Leaning the pelvis back would swing the standing leg forward: counter it at the hip.
      const support = (pitch: number): Vec3 => [g.hipL![0] - (pitch - g.root![0]), g.hipL![1], g.hipL![2]];
      const chamber = { ...stance, joints: { ...g, root: [-2, g.root![1], 0] as Vec3, hipL: support(-2), hipR: [-95, 0, -6] as Vec3, kneeR: [112, 0, 0] as Vec3, ankleR: [12, 0, 0] as Vec3 } };
      const extend = { ...stance, joints: { ...g, root: [-12, g.root![1], 0] as Vec3, spine: [-6, -12, 0] as Vec3, hipL: support(-12), hipR: [-88, 0, -6] as Vec3, kneeR: [6, 0, 0] as Vec3, ankleR: [-25, 0, 0] as Vec3 } };
      return animated('Front kick', [
        { t: 0, figures: [stance] }, { t: 0.3, figures: [chamber] }, { t: 0.5, figures: [extend] }, { t: 0.72, figures: [chamber] }, { t: 1.05, figures: [stance] },
      ], { duration: 1.5, loop: true, view: { yaw: 70, pitch: 2, fov: 28 }, camera: 'hero' });
    }),
  },
  {
    id: 'jab-cross',
    name: 'Jab & cross',
    group: 'Fighting',
    people: 1,
    build: () => withRig((rig) => {
      const stance = guard(rig, posed(person('Boxer', { ...DEFAULT_BODY }), STANCE));
      // Straight ahead at chin height, arm's length away.
      const target = near(rig, stance, 'head', [0.08, -0.06, 0.62]);
      const jab = reachTo(rig, adjusted(stance, { chest: [4, -16, 0] }), 'L', target);
      const turned = adjusted(stance, { chest: [6, 18, 0], spine: [8, 10, 0], ankleR: [16, 0, 0] });
      const cross = reachTo(rig, turned, 'R', target.clone().add(new THREE.Vector3(-0.08, 0, 0.1)));
      return animated('Jab & cross', [
        { t: 0, figures: [stance] }, { t: 4 / 24, figures: [jab] }, { t: 9 / 24, figures: [stance] }, { t: 15 / 24, figures: [cross] }, { t: 22 / 24, figures: [stance] },
      ], { duration: 1.25, loop: false, view: { yaw: 60, pitch: 4, fov: 28 }, camera: 'static' });
    }),
  },
  {
    id: 'block-duck',
    name: 'Block & duck',
    group: 'Fighting',
    people: 1,
    build: () => withRig((rig) => {
      const stance = guard(rig, posed(person('Boxer', { ...DEFAULT_BODY }), STANCE));
      // Forearms up in front of the face, then under a swing: knees bent, chest down.
      let block = reachTo(rig, adjusted(stance, { chest: [10, -10, 0], neck: [12, 0, 0] }), 'L', near(rig, stance, 'head', [0.06, 0.06, 0.16]));
      block = reachTo(rig, block, 'R', near(rig, stance, 'head', [-0.07, 0.05, 0.15]));
      const duck = plantFeet(rig, adjusted(sink(stance, 40), { spine: [24, -12, -10], chest: [10, -10, 0], neck: [-10, 0, 0] }), stance);
      return animated('Block & duck', [
        { t: 0, figures: [stance] }, { t: 0.2, figures: [block] }, { t: 0.55, figures: [block] }, { t: 0.75, figures: [stance] },
        { t: 1.0, figures: [duck] }, { t: 1.3, figures: [duck] }, { t: 1.6, figures: [stance] },
      ], { duration: 1.9, loop: true, view: { yaw: 60, pitch: 4, fov: 28 }, camera: 'static' });
    }),
  },
  {
    id: 'hit',
    name: 'Take a hit',
    group: 'Fighting',
    people: 1,
    build: () => withRig((rig) => {
      const stance = guard(rig, posed(person('Boxer', { ...DEFAULT_BODY }), STANCE));
      // The head snaps back and aside, the body rocks back on its heels, the guard flies open.
      const snap = plantFeet(rig, adjusted(rock(stance, -10), {
        spine: [-14, -4, 8], chest: [-10, 10, 0], neck: [-30, 18, 10], head: [-15, 10, 0],
        shoulderL: [-30, 0, 45], elbowL: [-40, 0, 0], shoulderR: [-20, 0, -50], elbowR: [-35, 0, 0],
      }, { hands: { L: hand('Open'), R: hand('Open') } }), stance);
      const reel = plantFeet(rig, adjusted(sink(rock(stance, -4), 16), { spine: [6, -8, 4], neck: [10, 8, 0], shoulderL: [-25, 0, 25], elbowL: [-60, 0, 0], shoulderR: [-25, 0, -25], elbowR: [-60, 0, 0] }), stance);
      return animated('Take a hit', [
        { t: 0, figures: [stance] }, { t: 0.16, figures: [snap] }, { t: 0.6, figures: [reel] }, { t: 1.2, figures: [stance] },
      ], { duration: 1.4, loop: false, view: { yaw: 50, pitch: 4, fov: 28 }, camera: 'static' });
    }),
  },
  {
    id: 'throw',
    name: 'Throw overhand',
    group: 'Sport & gymnastics',
    people: 1,
    build: () => withRig((rig) => {
      // Left foot forward. The shoulders wind up side-on (the left one to the target) with the arm
      // back behind the head, then unwind as the arm whips over and follows through across the body.
      // The pelvis stays put (turning it would slide the feet): the spine and chest do the turning.
      const f = { ...person('Thrower', { ...DEFAULT_BODY }, STAND), hands: { L: hand('Open'), R: hand('Grip') } };
      const ready = posed(f, { ...STAND, root: [0, -20, 0], hipL: [-22, 0, 6], kneeL: [12, 0, 0], hipR: [14, 0, -6], kneeR: [10, 0, 0], ankleR: [8, 0, 0] });
      let windup = adjusted(ready, { spine: [-4, -30, 0], chest: [-6, -35, 0], neck: [0, 30, 0], head: [0, 25, 0] });
      windup = reachTo(rig, windup, 'R', near(rig, windup, 'shoulderR', [-0.12, 0.3, -0.38]));
      windup = reachTo(rig, windup, 'L', near(rig, windup, 'shoulderL', [-0.05, 0.08, 0.5]));
      let release = adjusted(ready, { spine: [8, 15, 0], chest: [8, 20, 0], neck: [0, -10, 0], hipL: [-26, 0, 6], kneeL: [14, 0, 0] });
      release = reachTo(rig, release, 'R', near(rig, release, 'shoulderR', [0.04, 0.26, 0.45]));
      release = reachTo(rig, release, 'L', near(rig, release, 'shoulderL', [0.12, -0.35, -0.05]));
      let follow = adjusted(sink(ready, 16), { spine: [26, 20, 0], chest: [12, 25, 0], neck: [-10, -15, 0] }, { hands: { L: hand('Open'), R: hand('Open') } });
      follow = reachTo(rig, follow, 'R', near(rig, follow, 'hipL', [0.15, 0.05, 0.35]));
      return animated('Throw overhand', [
        { t: 0, figures: [ready] }, ...[windup, release, follow].map((k, i) => ({ t: [0.5, 0.68, 0.88][i], figures: [plantFeet(rig, k, ready)] })), { t: 1.5, figures: [ready] },
      ], { duration: 1.7, loop: false, view: { yaw: 80, pitch: 4, fov: 30 }, camera: 'static' });
    }),
  },
  {
    id: 'pirouette',
    name: 'Pirouette',
    group: 'Dance',
    people: 1,
    build: () => withRig((rig) => {
      const f = { ...person('Dancer', { ...DEFAULT_BODY }, STAND), hands: { L: hand('Open'), R: hand('Open') } };
      // Demi-plié, then up on the left toes with the right foot at the knee and the arms rounded, turning once on the toes.
      const prep = sink(posed(f, { shoulderL: [-20, 0, 60], shoulderR: [-20, 0, -60], elbowL: [-15, 0, 0], elbowR: [-15, 0, 0], hipL: [0, 0, 3], hipR: [0, 0, -3] }), 30);
      const up = posed(f, {
        hipL: [0, 0, 3], ankleL: [40, 0, 0], hipR: [-50, -35, -55], kneeR: [125, 0, 0], ankleR: [35, 0, 0],
        shoulderL: [-75, 0, 18], shoulderR: [-75, 0, -18], elbowL: [-55, 0, 0], elbowR: [-55, 0, 0], neck: [-4, 0, 0],
      });
      const m = rig.model(up);
      const toe = m.joints.ankleL.getWorldPosition(new THREE.Vector3());
      const pivot: [number, number] = [toe.x, toe.z];
      return animated('Pirouette', [
        { t: 0, figures: [posed(f, STAND)] }, { t: 0.35, figures: [prep] }, { t: 0.45, figures: [prep] },
        { t: 0.7, figures: [up] }, { t: 0.95, figures: [turnOn(up, 120, pivot)] }, { t: 1.2, figures: [turnOn(up, 240, pivot)] }, { t: 1.45, figures: [turnOn(up, 360, pivot)] },
        { t: 1.75, figures: [prep] }, { t: 1.9, figures: [prep] }, { t: 2.25, figures: [posed(f, STAND)] },
      ], { duration: 2.5, loop: false, view: { yaw: 20, pitch: 6, fov: 26 }, camera: 'static' });
    }),
  },
  {
    id: 'cartwheel',
    name: 'Cartwheel',
    group: 'Sport & gymnastics',
    people: 1,
    build: () => withRig((rig) => {
      const f = { ...person('Gymnast', { ...DEFAULT_BODY }, STAND), hands: { L: hand('Open'), R: hand('Open') } };
      const stand = posed(f, STAND);
      const arms = posed(f, { ...STAND, shoulderL: [0, 0, 140], shoulderR: [0, 0, -140], elbowL: [0, 0, 0], elbowR: [0, 0, 0] });
      const x = (roll: number, at: number): Figure => ({ ...posed(f, { root: [0, 0, roll], shoulderL: [0, 0, 140], shoulderR: [0, 0, -140], hipL: [0, 0, 40], hipR: [0, 0, -40] }), position: [at, 0, 0] });
      // Arms up, a step out to the right into an X (the left foot stays), then the X wheels over
      // sideways: hand, hand, foot, foot. The hips' height is keyed from where the X rests at each
      // eighth of the turn, so they ride smoothly from one contact to the next. It lands in the X
      // and steps the trailing foot in.
      const start = footAt(rig, x(0, 0), stand, 'L');
      const reach = plantFeet(rig, { ...posed(f, { ...arms.joints, hipR: [-35, 0, -30], kneeR: [75, 0, 0], ankleR: [20, 0, 0] }), position: [start.position[0] / 2, 0, 0] }, stand, ['L']);
      // Each step lifts the foot straight up where it stands first (thigh and shin at equal angles), then carries it over.
      const lift = (from: Figure, side: Side, spread: number) => plantFeet(rig, { ...from, joints: { ...from.joints, [`hip${side}`]: [-30, 0, spread], [`knee${side}`]: [60, 0, 0], [`ankle${side}`]: [15, 0, 0] } }, from, [side === 'L' ? 'R' : 'L']);
      const keys: Key[] = [{ t: 0, figures: [stand] }, { t: 0.3, figures: [arms] }, { t: 0.42, figures: [lift(arms, 'R', -3)] }, { t: 0.55, figures: [reach] }];
      let last = start;
      for (let i = 0; i <= 8; i++) {
        const star = x(wrapDeg(45 * i), Math.round((start.position[0] - 0.26 * i) * 1000) / 1000);
        const y = rig.model(star).joints.root.position.y;
        last = { ...star, grounded: false, position: [star.position[0], Math.round(y * 1000) / 1000, 0] };
        keys.push({ t: Math.round((0.8 + i * 0.16) * 1000) / 1000, figures: [last] });
      }
      const together = footAt(rig, arms, last, 'R');
      const close = plantFeet(rig, { ...posed(f, { ...arms.joints, hipL: [-35, 0, 30], kneeL: [75, 0, 0], ankleL: [20, 0, 0] }), position: [(last.position[0] + together.position[0]) / 2, 0, 0] }, last, ['R']);
      // Landing, the hips carry on over the right foot (no dead stop) as the left one lifts.
      const landing = plantFeet(rig, lift({ ...last, position: [last.position[0] - 0.1, last.position[1], last.position[2]] }, 'L', 40), last, ['R']);
      // Both feet stay down for a frame as the hips carry on, then the left one lifts over two.
      const settle = plantFeet(rig, inBetween(rig, last, landing, 3, last, ['R'])[0], last);
      keys.push({ t: 51 / 24, figures: [settle] }, ...inBetween(rig, settle, landing, 2, last, ['R']).map((p, i) => ({ t: (52 + i) / 24, figures: [p] })));
      keys.push({ t: 54 / 24, figures: [landing] }, { t: 2.4, figures: [close] }, { t: 2.65, figures: [together] }, { t: 2.95, figures: [{ ...stand, position: together.position }] });
      // Every key at the height it stands at (keyed, not left to the floor), so the hips' height
      // blends evenly from the steps into the wheel and out again.
      // It starts and ends standing on the floor, so it joins whatever comes before and after.
      const held = keys.map((k, i) => (i === 0 || i >= keys.length - 2 ? k : { ...k, figures: k.figures.map((p) => (p.grounded ? { ...p, grounded: false, position: [p.position[0], Math.round(rig.model(p).joints.root.position.y * 1000) / 1000, p.position[2]] as Vec3 } : p)) }));
      return animated('Cartwheel', held, { duration: 3.1, loop: false, view: { yaw: 0, pitch: 4, fov: 36 }, camera: 'static' });
    }),
  },
  {
    id: 'fall',
    name: 'Fall & get up',
    group: 'Everyday',
    people: 1,
    build: () => withRig((rig) => {
      const f = person('Faller', { ...DEFAULT_BODY }, STAND);
      const stand = posed(f, STAND);
      // Off balance backwards, down to a crouch, rolled onto the back; then sitting up, onto a knee and up.
      const totter = posed(f, { root: [-14, 0, 0], hipL: [-10, 0, 6], hipR: [5, 0, -6], kneeL: [20, 0, 0], kneeR: [70, 0, 0], shoulderL: [-90, 0, 30], shoulderR: [-100, 0, -30], elbowL: [-20, 0, 0], elbowR: [-20, 0, 0], neck: [20, 0, 0] });
      const crouch = posed(f, { root: [-10, 0, 0], hipL: [-115, 0, 12], hipR: [-115, 0, -12], kneeL: [140, 0, 0], kneeR: [140, 0, 0], ankleL: [-25, 0, 0], ankleR: [-25, 0, 0], shoulderL: [-70, 0, 25], shoulderR: [-70, 0, -25], spine: [20, 0, 0], neck: [25, 0, 0] });
      const down = { ...posed(f, { root: [-88, 0, 0], hipL: [-70, 0, 10], hipR: [-55, 0, -10], kneeL: [100, 0, 0], kneeR: [80, 0, 0], shoulderL: [0, 0, 50], shoulderR: [0, 0, -50], neck: [8, 0, 0] }), position: [0, 0, -0.55] as Vec3 };
      const sitUp = { ...posed(f, { root: [-20, 0, 0], spine: [15, 0, 0], hipL: [-60, 0, 8], hipR: [-75, 0, -8], kneeL: [40, 0, 0], kneeR: [110, 0, 0], shoulderL: [30, 0, 25], shoulderR: [30, 0, -25], elbowL: [-10, 0, 0], elbowR: [-10, 0, 0] }), position: [0, 0, -0.35] as Vec3 };
      const kneel = { ...posed(f, { root: [20, 0, 0], hipL: [-80, 0, 6], kneeL: [90, 0, 0], hipR: [10, 0, -6], kneeR: [100, 0, 0], ankleR: [40, 0, 0], shoulderL: [-30, 0, 15], shoulderR: [-30, 0, -15], spine: [10, 0, 0] }), position: [0, 0, -0.2] as Vec3 };
      // The feet stay where they stand until the body is down, and where they land while it sits
      // up; it rises over the left foot while the right comes through.
      const tottering = plantFeet(rig, totter, stand, ['L']);
      const crouched = plantFeet(rig, { ...crouch, position: [0, 0, -0.15] }, stand);
      const lying = plantFeet(rig, down, crouched);
      const sitting = plantFeet(rig, sitUp, lying);
      const kneeling = plantFeet(rig, kneel, sitting, ['L']);
      const up = plantFeet(rig, footAt(rig, stand, kneeling, 'L'), kneeling, ['L']);
      // Times in frames (24 a second). Going down, rolling back and sitting up are big changes:
      // in-between poses every other frame keep the feet planted.
      const at = (frame: number) => frame / 24;
      const keys: Key[] = [{ t: 0, figures: [stand] }, { t: at(7), figures: [tottering] }];
      inBetween(rig, tottering, crouched, 3, stand, ['L']).forEach((p, i) => keys.push({ t: at(9 + 2 * i), figures: [p] }));
      keys.push({ t: at(15), figures: [crouched] });
      inBetween(rig, crouched, lying, 4, crouched).forEach((p, i) => keys.push({ t: at(17 + 2 * i), figures: [p] }));
      keys.push({ t: at(25), figures: [lying] }, { t: at(43), figures: [lying] });
      inBetween(rig, lying, sitting, 2, lying).forEach((p, i) => keys.push({ t: at(47 + 4 * i), figures: [p] }));
      // Rising over the left foot, the right comes through off the floor and lands beside it.
      const rising = plantFeet(rig, { ...up, joints: { ...up.joints, hipR: [-40, 0, -6], kneeR: [80, 0, 0], ankleR: [20, 0, 0] }, position: [(kneeling.position[0] + up.position[0]) / 2, 0, (kneeling.position[2] + up.position[2]) / 2] }, kneeling, ['L']);
      keys.push({ t: at(55), figures: [sitting] }, { t: at(67), figures: [kneeling] }, { t: at(76), figures: [rising] }, { t: at(84), figures: [up] });
      return animated('Fall & get up', keys, { duration: 3.6, loop: false, view: { yaw: 80, pitch: 6, fov: 32 }, camera: 'static' });
    }),
  },
  {
    id: 'wave',
    name: 'Wave hello',
    group: 'Everyday',
    people: 1,
    build: () => {
      const f = { ...person('Mia', { ...DEFAULT_BODY }, STAND), hands: { L: hand('Relaxed'), R: hand('Open') } };
      const wave = (twist: number, tilt: number) => posed(f, {
        ...STAND, hipL: [0, 0, 6], hipR: [-3, 0, -3], kneeR: [8, 0, 0],
        shoulderR: [-10, twist, -138], elbowR: [-55, 0, 0], head: [0, 0, tilt],
      });
      return animated('Wave hello', [
        { t: 0, figures: [wave(28, 6)] }, { t: 0.3, figures: [wave(-22, 3)] }, { t: 0.6, figures: [wave(28, 6)] }, { t: 0.9, figures: [wave(-22, 3)] },
      ], { duration: 1.2, loop: true, view: { yaw: 0, pitch: 4, fov: 24 }, camera: 'push' });
    },
  },
  {
    id: 'bow',
    name: 'Bow',
    group: 'Everyday',
    people: 1,
    build: () => {
      const f = person('Ken', { ...DEFAULT_BODY }, STAND);
      const stand = posed(f, STAND);
      const bow = posed(f, {
        ...STAND, root: [40, 0, 0], hipL: [-40, 0, 3], hipR: [-40, 0, -3], spine: [8, 0, 0], neck: [10, 0, 0],
        shoulderL: [-38, 0, 6], shoulderR: [-38, 0, -6],
      });
      return animated('Bow', [
        { t: 0, figures: [stand] }, { t: 0.7, figures: [bow] }, { t: 1.4, figures: [bow] }, { t: 2.1, figures: [stand] },
      ], { duration: 2.6, loop: true, view: { yaw: 55, pitch: 6, fov: 24 }, camera: 'static' });
    },
  },
];

export function buildMotion(id: string): Scene | null {
  return MOTIONS.find((m) => m.id === id)?.build() ?? null;
}
