import * as THREE from 'three';
import { poseOf } from './animation';
import { DEFAULT_BODY } from './body';
import { mirrorFigure, newFigure, newProp, newScene } from './doc';
import { HAND_PRESETS, cloneHand } from './hands';
import { wrapDeg } from './joints';
import { Rig, headPoint, leftward, forward, reach, withFacing } from './relations';
import { CAMERA_MOVES } from './shot';
import { buildTemplate, waltzHold } from './templates';
import { GRAVITY, feetOf, plantFeet, travelTime } from './locomotion';
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
  /** A whole set-up with its props (a bar and a mat): it opens as a new scene. */
  setUp?: boolean;
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
    position: [Math.round((x * Math.cos(a) + z * Math.sin(a)) * 1000) / 1000 || 0, y, Math.round((-x * Math.sin(a) + z * Math.cos(a)) * 1000) / 1000 || 0],
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


/** Ease 0→1, slow at both ends. */
const smooth = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

/**
 * Every key at the height it stands at (keyed, not left to the floor), so the hips' height blends
 * evenly from steps into flight or a wheel and out again, on figures of any build. It starts and
 * ends standing on the floor, so it joins whatever comes before and after.
 */
function atHeights(rig: Rig, keys: Key[]): Key[] {
  return keys.map((k, i) => (i === 0 || i >= keys.length - 2 ? k : {
    ...k,
    figures: k.figures.map((p) => (p.grounded ? { ...p, grounded: false, position: [p.position[0], Math.round(rig.model(p).joints.root.position.y * 1000) / 1000, p.position[2]] as Vec3 } : p)),
  }));
}

/**
 * Falling backwards from standing (facing +Z): off balance, down to a crouch, rolled onto the
 * back. The feet stay where they stand until the body is down; the big changes have in-between
 * poses every other frame to keep them planted. `falling` is timed in frames from the start.
 */
function fallBack(rig: Rig, f: Figure) {
  const stand = posed(f, STAND);
  const totter = posed(f, { root: [-14, 0, 0], hipL: [-10, 0, 6], hipR: [5, 0, -6], kneeL: [20, 0, 0], kneeR: [70, 0, 0], shoulderL: [-90, 0, 30], shoulderR: [-100, 0, -30], elbowL: [-20, 0, 0], elbowR: [-20, 0, 0], neck: [20, 0, 0] });
  const crouch = posed(f, { root: [-10, 0, 0], hipL: [-115, 0, 12], hipR: [-115, 0, -12], kneeL: [140, 0, 0], kneeR: [140, 0, 0], ankleL: [-25, 0, 0], ankleR: [-25, 0, 0], shoulderL: [-70, 0, 25], shoulderR: [-70, 0, -25], spine: [20, 0, 0], neck: [25, 0, 0] });
  const down = { ...posed(f, { root: [-88, 0, 0], hipL: [-70, 0, 10], hipR: [-55, 0, -10], kneeL: [100, 0, 0], kneeR: [80, 0, 0], shoulderL: [0, 0, 50], shoulderR: [0, 0, -50], neck: [8, 0, 0] }), position: [f.position[0], 0, f.position[2] - 0.55] as Vec3 };
  const tottering = plantFeet(rig, totter, stand, ['L']);
  const crouched = plantFeet(rig, { ...crouch, position: [f.position[0], 0, f.position[2] - 0.15] }, stand);
  const lying = plantFeet(rig, down, crouched);
  const falling = [
    { frame: 7, pose: tottering },
    ...inBetween(rig, tottering, crouched, 3, stand, ['L']).map((pose, i) => ({ frame: 9 + 2 * i, pose })),
    { frame: 15, pose: crouched },
    ...inBetween(rig, crouched, lying, 4, crouched).map((pose, i) => ({ frame: 17 + 2 * i, pose })),
    { frame: 25, pose: lying },
  ];
  return { stand, lying, falling };
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
    id: 'takedown',
    name: 'Clinch & takedown',
    group: 'Two people',
    people: 2,
    build: () => withRig((rig) => {
      // Built facing each other along Z (B at the origin facing +Z, A in front facing back), then
      // turned side-on to the camera. They tie up (A gripping B's collar and sleeve, B's hands on A's shoulders),
      // A steps in behind B's heel and drives B back over it: B goes down onto the back as a fall
      // does, and A steps back out, bent over B in guard.
      let a0 = person('Ben', { ...DEFAULT_BODY }, STAND, 180, [0, 0, 0.72]);
      const b0 = person('Kai', { ...DEFAULT_BODY }, STAND);
      a0 = posed(a0, STAND);
      const at = (frame: number) => frame / 24;
      const { stand: bStand, falling } = fallBack(rig, b0);
      const tie = (f: Figure, other: Figure, right: THREE.Vector3, left: THREE.Vector3) => reachTo(rig, reachTo(rig, f, 'R', right), 'L', left);
      const grips = (f: Figure) => tie(f, bStand, local(rig, bStand, 'shoulderL', [0.04, -0.06, 0.15]), local(rig, bStand, 'shoulderR', [0, -0.04, 0.14]));
      const aClinch = { ...grips(adjusted(a0, { spine: [10, 0, 0] })), hands: { L: hand('Grip'), R: hand('Grip') } };
      const bClinch = { ...tie(adjusted(bStand, { spine: [10, 0, 0] }), a0, local(rig, a0, 'shoulderL', [0, 0.04, 0]), local(rig, a0, 'shoulderR', [0, 0.04, 0])), hands: { L: hand('Grip'), R: hand('Grip') } };
      // A's right foot: up, then down behind B's left heel (a little outside it), then back.
      const aFeet = feetOf(rig, aClinch);
      const bLeft = feetOf(rig, bStand, ['L'])[0];
      const behind = [{ ...aFeet.find((w) => w.side === 'R')!, p: new THREE.Vector3(bLeft.p.x + 0.2, aFeet[0].p.y, bLeft.p.z - 0.12) }];
      const aLift = plantFeet(rig, adjusted(aClinch, { hipR: [-45, 0, -10], kneeR: [70, 0, 0], ankleR: [15, 0, 0] }), aClinch, ['L']);
      const stepped = plantFeet(rig, plantFeet(rig, { ...aClinch, position: [aClinch.position[0] + 0.08, 0, aClinch.position[2] - 0.22] }, aClinch, ['L']), behind);
      // Closer in, the arms bend to keep the same grips.
      const aIn = grips(stepped);
      // Driving B back: A's chest over, hands on B's chest as B topples.
      const bTotter = falling[0].pose;
      const push = (b: Figure) => reachTo(rig, reachTo(rig, adjusted(aIn, { spine: [25, 0, 0], chest: [10, 0, 0] }, { hands: { L: hand('Open'), R: hand('Open') } }), 'R', local(rig, b, 'chest', [-0.1, 0.05, 0.16])), 'L', local(rig, b, 'chest', [0.1, 0.05, 0.16]));
      const aPush = plantFeet(rig, push(bTotter), aIn);
      const aOut = plantFeet(rig, adjusted(aPush, { hipR: [-40, 0, -8], kneeR: [65, 0, 0], ankleR: [15, 0, 0] }), aIn, ['L']);
      const guarded = guard(rig, adjusted(a0, { spine: [22, 0, 0], neck: [20, 0, 0] }));
      const aOver = plantFeet(rig, sink(guarded, 20), aClinch);
      const keys: Key[] = [
        { t: 0, figures: [a0, bStand] },
        { t: at(8), figures: [aClinch, bClinch] },
        { t: at(14), figures: [aClinch, bClinch] },
        { t: at(18), figures: [aLift, bClinch] },
        { t: at(22), figures: [aIn, bClinch] },
      ];
      // B falls (its fall's frame 7, the totter, at A's push); A's foot is out before B comes down on it.
      for (const { frame, pose } of falling) {
        const aPose = frame <= 9 ? aPush : frame === 13 ? aOut : frame >= 21 ? aOver : null;
        keys.push({ t: at(22 + frame), figures: aPose ? [aPose, pose] : [pose] });
      }
      const lying = falling[falling.length - 1].pose;
      keys.push({ t: at(56), figures: [aOver, lying] }, { t: at(64), figures: [aOver, lying] });
      // Side-on to the camera.
      const turned = keys.map((k) => ({ ...k, figures: k.figures.map((f) => turnAbout(f, 90)) }));
      return animated('Clinch & takedown', turned, { duration: 2.8, loop: false, view: { yaw: 0, pitch: 8, fov: 30 }, camera: 'static' });
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
    id: 'high-jump',
    name: 'High jump',
    group: 'Sport & gymnastics',
    people: 1,
    setUp: true,
    build: () => withRig((rig) => {
      // The Fosbury flop: a run-up, a plant and a drive off the left foot, turning the back to the
      // bar in the air; over it head first, face up, the back arched, the legs kicking up after
      // the hips; the shoulders land first on the mat and the body rolls back flat on it.
      const f = { ...person('Jumper', { ...DEFAULT_BODY }, STAND), hands: { L: hand('Open'), R: hand('Open') } };
      const [BAR, MAT] = [1.2, 0.8];
      const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
      const at = (frame: number) => frame / 24;
      const take = 3.6;
      const tRun = Math.round(travelTime('run', take, f.body) * 24);
      const stand = { ...posed(f, STAND), position: [0, 0, take] as Vec3 };
      const load = plantFeet(rig, { ...adjusted(sink(stand, 30), { shoulderL: [25, 0, 20], shoulderR: [25, 0, -20], elbowL: [-30, 0, 0], elbowR: [-30, 0, 0], spine: [8, 0, 0] }), position: [0, 0, take + 0.08] }, stand);
      // The right foot comes straight up off the floor first (it does not drag).
      const liftR = feetOf(rig, load, ['R']).map((w) => ({ ...w, p: w.p.clone().add(new THREE.Vector3(0, 0.14, 0.04)) }));
      const lifted = plantFeet(rig, plantFeet(rig, { ...adjusted(load, { shoulderL: [-45, 0, 18], shoulderR: [-45, 0, -18], elbowL: [-25, 0, 0], elbowR: [-25, 0, 0] }), position: [0, 0, take + 0.12] }, load, ['L']), liftR);
      const lifting = adjusted(lifted, { ankleR: [10, 0, 0] });
      // Up on the toes of the left foot, the right knee and the arms driving up.
      const driveBase = adjusted(stand, { hipR: [-90, 0, -6], kneeR: [95, 0, 0], ankleR: [20, 0, 0], shoulderL: [-110, 0, 15], shoulderR: [-110, 0, -15], elbowL: [-20, 0, 0], elbowR: [-20, 0, 0], ankleL: [35, 0, 0], spine: [-6, 0, 0] });
      const driveY = rig.model(driveBase).joints.root.position.y;
      const drive = { ...driveBase, grounded: false, position: [0, r3(driveY + 0.05), r3(take + 0.22)] as Vec3 };
      // Shapes in the air (joints but the root); the root turns as a whole.
      const arch: Joints = { spine: [-25, 0, 0], chest: [-15, 0, 0], neck: [-20, 0, 0], head: [-10, 0, 0], shoulderL: [10, 0, 25], shoulderR: [10, 0, -25], elbowL: [-20, 0, 0], elbowR: [-20, 0, 0], hipL: [10, 0, 10], hipR: [10, 0, -10], kneeL: [70, 0, 0], kneeR: [70, 0, 0], ankleL: [20, 0, 0], ankleR: [20, 0, 0] };
      const kick: Joints = { spine: [-5, 0, 0], neck: [20, 0, 0], shoulderL: [0, 0, 40], shoulderR: [0, 0, -40], hipL: [-80, 0, 8], hipR: [-80, 0, -8], kneeL: [10, 0, 0], kneeR: [10, 0, 0], ankleL: [20, 0, 0], ankleR: [20, 0, 0] };
      const down: Joints = { neck: [25, 0, 0], shoulderL: [0, 0, 60], shoulderR: [0, 0, -60], hipL: [-60, 0, 10], hipR: [-60, 0, -10], kneeL: [30, 0, 0], kneeR: [30, 0, 0], ankleL: [10, 0, 0], ankleR: [10, 0, 0] };
      const rest: Joints = { neck: [10, 0, 0], shoulderL: [0, 0, 60], shoulderR: [0, 0, -60], hipL: [-25, 0, 10], hipR: [-25, 0, -10], kneeL: [50, 0, 0], kneeR: [50, 0, 0] };
      const mixJoints = (p: Joints, q: Joints, u: number): Joints => Object.fromEntries([...new Set([...Object.keys(p), ...Object.keys(q)])].map((j) => {
        const x = p[j as JointName] ?? [0, 0, 0];
        const y = q[j as JointName] ?? [0, 0, 0];
        return [j, [0, 1, 2].map((c) => Math.round((x[c] + wrapDeg(y[c] - x[c]) * u) * 10) / 10 || 0) as Vec3];
      }));
      const { root: _r, ...driven } = drive.joints;
      void _r;
      // Turns (the root's lean, then turn): the back to the bar first (half a turn by the top), laid
      // back face up over it, head down as the shoulders land; then rolled back flat.
      const upright: Vec3 = [0, 0, 0];
      const contact: Vec3 = [-115, 180, 0];
      const flat: Vec3 = [-88, 180, 0];
      const turnAt = (u: number): Vec3 => [r3(-115 * Math.sin((u * Math.PI) / 2)), r3(180 * smooth(u / 0.5)), 0];
      const between = (p: Vec3, q: Vec3, u: number): Vec3 => [r3(p[0] + (q[0] - p[0]) * u), r3(p[1] + (q[1] - p[1]) * u), 0];
      const posedIn = (joints: Joints, root: Vec3, position: Vec3): Figure => ({ ...f, grounded: false, joints: { ...joints, root }, position });
      // On the mat: the pelvis this high above its top.
      const pelvisOn = (joints: Joints, root: Vec3) => rig.model({ ...f, grounded: true, joints: { ...joints, root } }).joints.root.position.y;
      const yFlat = MAT + pelvisOn(down, flat);
      const yContact = MAT + pelvisOn(kick, contact);
      const from = rig.model(drive).joints.root.getWorldPosition(new THREE.Vector3());
      // The flight: up to the top (the hips well over the bar) and down to the contact.
      const top = BAR + 0.3;
      const tUp = Math.sqrt((2 * (top - from.y)) / GRAVITY);
      const tDown = Math.sqrt((2 * (top - yContact)) / GRAVITY);
      const AIR = Math.round((tUp + tDown) * 24);
      const T = at(AIR);
      const v = (yContact - from.y + (GRAVITY * T * T) / 2) / T;
      const apex = v / GRAVITY / T;
      const speed = 0.13;
      const keys: Key[] = [
        { t: 0, figures: [{ ...stand, position: [0, 0, 0] }] }, { t: at(tRun), figures: [stand] }, { t: at(tRun + 6), figures: [load] }, { t: at(tRun + 9), figures: [lifting] }, { t: at(tRun + 12), figures: [{ ...drive, joints: { ...drive.joints, root: upright } }] },
      ];
      const T0 = tRun + 12;
      for (let i = 1; i <= AIR; i++) {
        const u = i / AIR;
        const time = at(i);
        const y = from.y + v * time - (GRAVITY * time * time) / 2;
        const shape = u <= apex ? mixJoints(driven, arch, smooth(u / apex)) : mixJoints(arch, kick, smooth((u - apex) / (1 - apex) / 0.7));
        const q = turnAt(u);
        keys.push({ t: at(T0 + i), figures: [posedIn(shape, q, [0, r3(y), r3(from.z + speed * 24 * time)])] });
      }
      // Down on the mat: the body rolls back flat, resting on it, sliding to a stop.
      const zEnd = from.z + speed * AIR;
      const ROLL = 8;
      for (let i = 1; i <= ROLL; i++) {
        const u = Math.min(1, i / 4);
        const dz = speed * 4 * (u - (u * u) / 2);
        const shape = mixJoints(kick, down, smooth(i / ROLL));
        const q = between(contact, flat, smooth(i / ROLL));
        keys.push({ t: at(T0 + AIR + i), figures: [posedIn(shape, q, [0, r3(MAT + pelvisOn(shape, q)), r3(zEnd + dz)])] });
      }
      const flatZ = r3(zEnd + speed * 2);
      const lie = posedIn(rest, flat, [0, r3(yFlat), flatZ]);
      keys.push({ t: at(T0 + AIR + ROLL + 12), figures: [lie] }, { t: at(T0 + AIR + ROLL + 24), figures: [lie] });
      const end = at(T0 + AIR + ROLL + 24);
      const to = { z: zEnd };
      const scene = animated('High jump', keys, { duration: end, loop: false, view: { yaw: 90, pitch: 4, fov: 40 } });
      const anim = scene.animation!;
      // The run-up is generated: the key at the take-off mark is reached running.
      const run = anim.keys.map((k) => (Math.abs(k.t - at(tRun)) < 1e-6 ? { ...k, poses: Object.fromEntries(Object.entries(k.poses).map(([id, p]) => [id, { ...p, travel: 'run' as const }])) } : k));
      const animation: Animation = { ...anim, keys: run };
      const move = CAMERA_MOVES.find((m) => m.id === 'static')!;
      animation.camera = { keys: move.keys(animation, scene.view), follow: true, shake: 0 };
      // The bar where the hips are at the top of the flight; the mat beyond it.
      const bar = r3(from.z + (to.z - from.z) * apex);
      return {
        ...scene,
        props: [
          { ...newProp('bar', [0, 0, bar], 'Bar'), scale: [1, BAR, 1] },
          { ...newProp('mat', [0, 0, r3(bar + 1.3)], 'Mat'), scale: [1, MAT / 0.4, 1] },
        ],
        animation,
      };
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
      return animated('Cartwheel', atHeights(rig, keys), { duration: 3.1, loop: false, view: { yaw: 0, pitch: 4, fov: 36 }, camera: 'static' });
    }),
  },
  {
    id: 'leap',
    name: 'Split leap',
    group: 'Sport & gymnastics',
    people: 1,
    build: () => withRig((rig) => {
      const f = { ...person('Gymnast', { ...DEFAULT_BODY }, STAND), hands: { L: hand('Open'), R: hand('Open') } };
      const stand = posed(f, STAND);
      const at = (frame: number) => frame / 24;
      /** Where `side`'s foot is with the figure moved `dz` ahead. */
      const spot = (pose: Figure, side: Side, dz: number) => feetOf(rig, { ...pose, position: [pose.position[0], pose.position[1], pose.position[2] + dz] }, [side]);
      const ahead = (pose: Figure, z: number): Figure => ({ ...pose, position: [0, 0, z] });
      const prepArms: Joints = { shoulderL: [30, 0, 30], shoulderR: [30, 0, -30], elbowL: [-20, 0, 0], elbowR: [-20, 0, 0] };
      const risingArms: Joints = { shoulderL: [-15, 0, 60], shoulderR: [-15, 0, -60], elbowL: [-15, 0, 0], elbowR: [-15, 0, 0] };
      const openArms: Joints = { shoulderL: [-40, 0, 95], shoulderR: [-40, 0, -95], elbowL: [-10, 0, 0], elbowR: [-10, 0, 0] };
      // A step onto the right foot, a plié on it, and a push off it as the left leg swings up
      // ahead: legs split in the air, the arms open; landing on the left foot, the right comes down.
      const lift = plantFeet(rig, ahead(posed(f, { ...STAND, hipR: [-40, 0, -3], kneeR: [60, 0, 0], ankleR: [15, 0, 0] }), 0.08), stand, ['L']);
      const reachOut = spot(stand, 'R', 0.5).map((w) => ({ ...w, p: w.p.clone().add(new THREE.Vector3(0, 0.06, 0)) }));
      const reaching = plantFeet(rig, plantFeet(rig, ahead(posed(f, { ...STAND, ...prepArms }), 0.18), stand, ['L']), reachOut);
      /** Lower by `dy` (held there, not left to the floor): planted legs then bend to reach. */
      const lowered = (p: Figure, dy: number): Figure => ({ ...p, grounded: false, position: [p.position[0], Math.round((rig.model(p).joints.root.position.y - dy) * 1000) / 1000, p.position[2]] });
      const step = plantFeet(rig, lowered(plantFeet(rig, ahead(sink(posed(f, { ...STAND, ...prepArms }), 30), 0.3), stand, ['L']), 0.04), [...feetOf(rig, stand, ['L']), ...spot(stand, 'R', 0.6)]);
      const plie = plantFeet(rig, ahead(sink(posed(f, { ...prepArms, root: [10, 0, 0], spine: [6, 0, 0], hipL: [25, 0, 4], kneeL: [60, 0, 0], ankleL: [20, 0, 0] }), 30), 0.52), step, ['R']);
      const push = plantFeet(rig, ahead(posed(f, { ...risingArms, root: [6, 0, 0], hipL: [-60, 0, 4], kneeL: [40, 0, 0], ankleL: [30, 0, 0], ankleR: [30, 0, 0] }), 0.8), step, ['R']);
      const split = posed(f, { ...openArms, root: [8, 0, 0], spine: [-6, 0, 0], neck: [-8, 0, 0], hipL: [-88, 0, 4], kneeL: [0, 0, 0], ankleL: [35, 0, 0], hipR: [45, 0, -4], kneeR: [8, 0, 0], ankleR: [35, 0, 0] });
      const land = plantFeet(rig, ahead(posed(f, { ...risingArms, root: [6, 0, 0], hipL: [-30, 0, 4], kneeL: [40, 0, 0], hipR: [35, 0, -4], kneeR: [40, 0, 0], ankleR: [30, 0, 0] }), 1.8), spot(stand, 'L', 1.95), ['L']);
      const absorb = plantFeet(rig, ahead(sink(posed(f, { ...prepArms, root: [8, 0, 0], hipL: [-30, 0, 4], kneeL: [40, 0, 0], hipR: [30, 0, -4], kneeR: [50, 0, 0], ankleR: [25, 0, 0] }), 35), 2.05), land, ['L']);
      const end = footAt(rig, stand, land, 'L');
      const lower = plantFeet(rig, { ...posed(f, { ...STAND, hipR: [10, 0, -3], kneeR: [40, 0, 0], ankleR: [20, 0, 0] }), position: [end.position[0], 0, (end.position[2] + absorb.position[2]) / 2] }, land, ['L']);
      // In the air a frame at a time: the pelvis flies a parabola under gravity from the push to
      // the landing, the limbs blending into the split and out of it.
      const pelvis = (p: Figure) => rig.model(p).joints.root.getWorldPosition(new THREE.Vector3());
      const [from, to] = [pelvis(push), pelvis(land)];
      const [UP, AIR, DOWN] = [19, 10, 29];
      const T = at(AIR);
      const v = (to.y - from.y + (9.81 * T * T) / 2) / T;
      const r3 = (x: number) => Math.round(x * 1000) / 1000;
      const flight: Key[] = [];
      for (let i = 1; i < AIR; i++) {
        const u = i / AIR;
        const half = AIR / 2;
        const joints = (i < half ? inBetween(rig, push, { ...split, position: push.position }, half - 1, push, [])[i - 1] : i === half ? split : inBetween(rig, split, { ...land, position: split.position }, half - 1, split, [])[i - half - 1]).joints;
        const time = at(i);
        const y = from.y + v * time - (9.81 * time * time) / 2;
        flight.push({ t: at(UP + i), figures: [{ ...posed(f, joints), joints, grounded: false, position: [r3(from.x + (to.x - from.x) * u), r3(y), r3(from.z + (to.z - from.z) * u)] }] });
      }
      return animated('Split leap', atHeights(rig, [
        { t: 0, figures: [stand] }, { t: at(5), figures: [lift] }, { t: at(8), figures: [reaching] }, { t: at(10), figures: [step] },
        ...inBetween(rig, step, plie, 5, step, ['R']).map((p, i) => ({ t: at(11 + i), figures: [p] })),
        { t: at(16), figures: [plie] },
        ...inBetween(rig, plie, push, 2, step, ['R']).map((p, i) => ({ t: at(17 + i), figures: [p] })),
        { t: at(UP), figures: [push] }, ...flight, { t: at(DOWN), figures: [land] },
        ...inBetween(rig, land, absorb, 5, land, ['L']).map((p, i) => ({ t: at(DOWN + 1 + i), figures: [p] })),
        { t: at(DOWN + 6), figures: [absorb] }, { t: at(DOWN + 12), figures: [lower] }, { t: at(DOWN + 18), figures: [end] },
      ]), { duration: 2.25, loop: false, view: { yaw: 90, pitch: 4, fov: 34 }, camera: 'static' });
    }),
  },
  {
    id: 'fall',
    name: 'Fall & get up',
    group: 'Everyday',
    people: 1,
    build: () => withRig((rig) => {
      const f = person('Faller', { ...DEFAULT_BODY }, STAND);
      const { stand, lying, falling } = fallBack(rig, f);
      const sitUp = { ...posed(f, { root: [-20, 0, 0], spine: [15, 0, 0], hipL: [-60, 0, 8], hipR: [-75, 0, -8], kneeL: [40, 0, 0], kneeR: [110, 0, 0], shoulderL: [30, 0, 25], shoulderR: [30, 0, -25], elbowL: [-10, 0, 0], elbowR: [-10, 0, 0] }), position: [0, 0, -0.35] as Vec3 };
      const kneel = { ...posed(f, { root: [20, 0, 0], hipL: [-80, 0, 6], kneeL: [90, 0, 0], hipR: [10, 0, -6], kneeR: [100, 0, 0], ankleR: [40, 0, 0], shoulderL: [-30, 0, 15], shoulderR: [-30, 0, -15], spine: [10, 0, 0] }), position: [0, 0, -0.2] as Vec3 };
      // It rises over the left foot while the right comes through.
      const sitting = plantFeet(rig, sitUp, lying);
      const kneeling = plantFeet(rig, kneel, sitting, ['L']);
      const up = plantFeet(rig, footAt(rig, stand, kneeling, 'L'), kneeling, ['L']);
      // Times in frames (24 a second). Going down, rolling back and sitting up are big changes:
      // in-between poses every other frame keep the feet planted.
      const at = (frame: number) => frame / 24;
      const keys: Key[] = [{ t: 0, figures: [stand] }, ...falling.map((p) => ({ t: at(p.frame), figures: [p.pose] })), { t: at(43), figures: [lying] }];
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
