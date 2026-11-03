import * as THREE from 'three';
import { keysClip, partKeys } from './clip';
import { DEFAULT_BODY } from './body';
import { cameraFrom, newFigure, newProp, newScene } from './doc';
import { HAND_PRESETS, cloneHand } from './hands';
import { wrapDeg } from './joints';
import { anglesOf, bonesOf, facingOf, type Angles } from './pose';
import { Rig, withFacing } from './relations';
import { GRAVITY, feetOf, plantFeet, travelTime } from './locomotion';
import { keysAction } from './animation';
import { uid } from './uid';
import type { Action, Animation, BodyParams, ClipEvent, Figure, Hand, JointName, Pose, Scene, Side, Travel, Vec3, View } from './types';

/*
 * Built-in motions: walking, running and jumping ahead (generated, lib/locomotion.ts), dances, a
 * boxing exchange and more. Each is made as a scene on the default figure(s), with keys (and
 * travels where steps are generated), and plays as a Clip baked from it (lib/assets.ts): on a
 * figure like it exactly as made; on other proportions its planted feet are locked. Keys are
 * authored as joint angles (with IK for contacts and punches). A motion is only what the people
 * do: where it is filmed from, and what set it plays in, are up to the scene.
 */

/** Groups of the motion library, by what the person does (several-people motions are listed on their own). */
export const MOTION_GROUPS = [
  'Moving', 'Standing & waiting', 'Sitting & lying', 'Talking & gestures', 'Feelings', 'Using things', 'Weapons', 'Fighting', 'Sport & acrobatics', 'Dance',
] as const;

interface Motion {
  id: string;
  name: string;
  group: (typeof MOTION_GROUPS)[number];
  build(): Scene;
  /** When a hand lets a prop go or takes hold of it (motions that handle props). */
  events?: ClipEvent[];
  /** Its arms follow loosely as a person's do (lib/humanize.ts): not where the hands hold the floor or a thing. */
  looseArms?: true;
}

type Joints = Angles;

/** A figure's pose as joint angles (motions are written in angles; see lib/pose.ts). */
const J = (f: Pick<Figure, 'bones'>): Angles => anglesOf(f.bones);

const hand = (name: string): Hand => cloneHand(HAND_PRESETS.find((p) => p.name === name)!.hand);

function person(name: string, b: BodyParams, joints: Joints = {}, yaw = 0, pos: Vec3 = [0, 0, 0]): Figure {
  return withFacing({ ...newFigure({ name, body: b, position: pos }), bones: bonesOf(joints) }, yaw);
}

/** Same figure with different joints (keeps id, body, facing). */
function posed(f: Figure, joints: Joints, extra: Partial<Figure> = {}): Figure {
  const yaw = J(f).hips?.[1] ?? 0;
  const root = joints.hips ?? [0, 0, 0];
  return { ...f, ...extra, bones: bonesOf({ ...joints, hips: [root[0], wrapDeg(yaw + root[1]), root[2]] }) };
}

interface Key {
  t: number;
  figures: Figure[];
}

const poseOf = (f: Figure): Pose => ({ bones: f.bones, position: f.position, hands: f.hands, grounded: f.grounded });

/** A scene keyed with these poses: each figure's keys one action (going round, in a loop). */
function animated(name: string, keys: Key[], o: { duration: number; loop: boolean; view: View }): Scene {
  // Seen from its own angle (where its preview is filmed from).
  const scene = { ...newScene(name, keys[0].figures), cameras: [cameraFrom(o.view)] };
  const actions = keys[0].figures.map((f): Action => {
    // On frame times, so a motion plays exactly as made.
    const mine = keys.filter((k) => k.figures.some((x) => x.id === f.id)).map((k) => ({ t: Math.round(k.t * 24) / 24, pose: poseOf(k.figures.find((x) => x.id === f.id)!) }));
    if (!o.loop) return keysAction(f.id, mine);
    return { id: uid('act'), start: 0, duration: o.duration, roles: [{ figure: f.id }], source: { kind: 'keys', clip: keysClip(mine, true, o.duration) } };
  });
  const animation: Animation = { duration: o.duration, fps: 24, loop: o.loop, actions, shots: [{ id: 'main', start: 0, name: 'Shot 1', camera: scene.cameras[0].id }] };
  return { ...scene, animation };
}

/**
 * A figure's keys from t0 to t1 walked, run or jumped instead (its steps generated): the keys in
 * between become marks it passes on the way.
 */
function travelling(scene: Scene, figure: string, t0: number, t1: number, mode: Travel, strafe = false): Scene {
  const a = scene.animation!;
  const act = a.actions.find((x) => x.roles[0].figure === figure)!;
  const clip = (act.source as Extract<Action['source'], { kind: 'keys' }>).clip;
  const keys = partKeys(clip.parts[0]).map((k) => ({ ...k, t: act.start + k.t }));
  const mark = (p: Pose) => ({ at: [p.position[0], p.position[2]] as [number, number], facing: Math.round(facingOf(p.bones) * 10) / 10 || 0 });
  const on = (t: number) => (k: { t: number }) => Math.abs(k.t - t) < 1e-4;
  const inner = keys.filter((k) => k.t > t0 + 1e-4 && k.t < t1 - 1e-4);
  const travel: Action = {
    id: uid('act'), start: t0, duration: t1 - t0, roles: [{ figure, end: mark(keys.find(on(t1))!.pose) }],
    source: { kind: 'travel', mode, ...(strafe ? { strafe: true } : {}), ...(inner.length && mode !== 'jump' ? { via: inner.map((k) => mark(k.pose)) } : {}) },
  };
  const before = keys.filter((k) => k.t <= t0 + 1e-4);
  const after = keys.filter((k) => k.t >= t1 - 1e-4);
  const actions = [...a.actions.filter((x) => x !== act), keysAction(figure, before), travel, ...(after.length ? [keysAction(figure, after)] : [])];
  return { ...scene, animation: { ...a, actions } };
}

function withRig<T>(fn: (rig: Rig) => T): T {
  const rig = new Rig();
  try {
    return fn(rig);
  } finally {
    rig.dispose();
  }
}

/* ---------- poses ---------- */

const STAND: Joints = { leftUpperArm: [0, 0, 8], rightUpperArm: [0, 0, -8], leftLowerArm: [-10, 0, 0], rightLowerArm: [-10, 0, 0], leftUpperLeg: [0, 0, 3], rightUpperLeg: [0, 0, -3] };
/** The same joints with some changed (bending a guard, sinking a stance…). */
function adjusted(f: Figure, joints: Joints, extra: Partial<Figure> = {}): Figure {
  return { ...f, ...extra, bones: bonesOf({ ...J(f), ...joints }) };
}

/** Sink by bending the knees: thighs forward and shins back as much, so the feet stay put. */
function sink(f: Figure, knee: number): Figure {
  const j = J(f);
  const add = (r: Vec3 | undefined, by: number): Vec3 => [(r?.[0] ?? 0) + by, r?.[1] ?? 0, r?.[2] ?? 0];
  return adjusted(f, {
    leftLowerLeg: add(j.leftLowerLeg, knee), rightLowerLeg: add(j.rightLowerLeg, knee),
    leftUpperLeg: add(j.leftUpperLeg, -knee / 2), rightUpperLeg: add(j.rightUpperLeg, -knee / 2),
    leftFoot: add(j.leftFoot, -knee / 2), rightFoot: add(j.rightFoot, -knee / 2),
  });
}

/** The pose moved on the floor so its `side` foot is where `ref` has that foot (a step lands there). */
function footAt(rig: Rig, pose: Figure, ref: Figure, side: Side): Figure {
  const ankle = side === 'L' ? 'leftFoot' : 'rightFoot';
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
    const joints = Object.fromEntries([...new Set([...Object.keys(J(a)), ...Object.keys(J(b))])].map((j) => [j, mix(J(a)[j as JointName], J(b)[j as JointName])]));
    const position = a.position.map((v, c) => v + (b.position[c] - v) * u) as Vec3;
    return plantFeet(rig, { ...a, bones: bonesOf(joints), position, grounded: a.grounded && b.grounded }, ref, sides);
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
    figures: k.figures.map((p) => (p.grounded ? { ...p, grounded: false, position: [p.position[0], Math.round(rig.model(p).joints.hips.position.y * 1000) / 1000, p.position[2]] as Vec3 } : p)),
  }));
}

export const MOTIONS: Motion[] = [
  {
    id: 'leap',
    looseArms: true,
    name: 'Split leap',
    group: 'Sport & acrobatics',
    build: () => withRig((rig) => {
      const f = { ...person('Gymnast', { ...DEFAULT_BODY }, STAND), hands: { L: hand('Open'), R: hand('Open') } };
      const stand = posed(f, STAND);
      const at = (frame: number) => frame / 24;
      /** Where `side`'s foot is with the figure moved `dz` ahead. */
      const spot = (pose: Figure, side: Side, dz: number) => feetOf(rig, { ...pose, position: [pose.position[0], pose.position[1], pose.position[2] + dz] }, [side]);
      const ahead = (pose: Figure, z: number): Figure => ({ ...pose, position: [0, 0, z] });
      const prepArms: Joints = { leftUpperArm: [30, 0, 30], rightUpperArm: [30, 0, -30], leftLowerArm: [-20, 0, 0], rightLowerArm: [-20, 0, 0] };
      const risingArms: Joints = { leftUpperArm: [-15, 0, 60], rightUpperArm: [-15, 0, -60], leftLowerArm: [-15, 0, 0], rightLowerArm: [-15, 0, 0] };
      const openArms: Joints = { leftUpperArm: [-40, 0, 95], rightUpperArm: [-40, 0, -95], leftLowerArm: [-10, 0, 0], rightLowerArm: [-10, 0, 0] };
      // A step onto the right foot, a plié on it, and a push off it as the left leg swings up
      // ahead: legs split in the air, the arms open; landing on the left foot, the right comes down.
      const lift = plantFeet(rig, ahead(posed(f, { ...STAND, rightUpperLeg: [-40, 0, -3], rightLowerLeg: [60, 0, 0], rightFoot: [15, 0, 0] }), 0.08), stand, ['L']);
      const reachOut = spot(stand, 'R', 0.5).map((w) => ({ ...w, p: w.p.clone().add(new THREE.Vector3(0, 0.06, 0)) }));
      const reaching = plantFeet(rig, plantFeet(rig, ahead(posed(f, { ...STAND, ...prepArms }), 0.18), stand, ['L']), reachOut);
      /** Lower by `dy` (held there, not left to the floor): planted legs then bend to reach. */
      const lowered = (p: Figure, dy: number): Figure => ({ ...p, grounded: false, position: [p.position[0], Math.round((rig.model(p).joints.hips.position.y - dy) * 1000) / 1000, p.position[2]] });
      const step = plantFeet(rig, lowered(plantFeet(rig, ahead(sink(posed(f, { ...STAND, ...prepArms }), 30), 0.3), stand, ['L']), 0.04), [...feetOf(rig, stand, ['L']), ...spot(stand, 'R', 0.6)]);
      const plie = plantFeet(rig, ahead(sink(posed(f, { ...prepArms, hips: [10, 0, 0], spine: [6, 0, 0], leftUpperLeg: [25, 0, 4], leftLowerLeg: [60, 0, 0], leftFoot: [20, 0, 0] }), 30), 0.52), step, ['R']);
      const push = plantFeet(rig, ahead(posed(f, { ...risingArms, hips: [6, 0, 0], leftUpperLeg: [-60, 0, 4], leftLowerLeg: [40, 0, 0], leftFoot: [30, 0, 0], rightFoot: [30, 0, 0] }), 0.8), step, ['R']);
      const split = posed(f, { ...openArms, hips: [8, 0, 0], spine: [-6, 0, 0], neck: [-8, 0, 0], leftUpperLeg: [-88, 0, 4], leftLowerLeg: [0, 0, 0], leftFoot: [35, 0, 0], rightUpperLeg: [45, 0, -4], rightLowerLeg: [8, 0, 0], rightFoot: [35, 0, 0] });
      const land = plantFeet(rig, ahead(posed(f, { ...risingArms, hips: [6, 0, 0], leftUpperLeg: [-30, 0, 4], leftLowerLeg: [40, 0, 0], rightUpperLeg: [35, 0, -4], rightLowerLeg: [40, 0, 0], rightFoot: [30, 0, 0] }), 1.8), spot(stand, 'L', 1.95), ['L']);
      const absorb = plantFeet(rig, ahead(sink(posed(f, { ...prepArms, hips: [8, 0, 0], leftUpperLeg: [-30, 0, 4], leftLowerLeg: [40, 0, 0], rightUpperLeg: [30, 0, -4], rightLowerLeg: [50, 0, 0], rightFoot: [25, 0, 0] }), 35), 2.05), land, ['L']);
      const end = footAt(rig, stand, land, 'L');
      const lower = plantFeet(rig, { ...posed(f, { ...STAND, rightUpperLeg: [10, 0, -3], rightLowerLeg: [40, 0, 0], rightFoot: [20, 0, 0] }), position: [end.position[0], 0, (end.position[2] + absorb.position[2]) / 2] }, land, ['L']);
      // In the air a frame at a time: the pelvis flies a parabola under gravity from the push to
      // the landing, the limbs blending into the split and out of it.
      const pelvis = (p: Figure) => rig.model(p).joints.hips.getWorldPosition(new THREE.Vector3());
      const [from, to] = [pelvis(push), pelvis(land)];
      const [UP, AIR, DOWN] = [19, 10, 29];
      const T = at(AIR);
      const v = (to.y - from.y + (9.81 * T * T) / 2) / T;
      const r3 = (x: number) => Math.round(x * 1000) / 1000;
      const flight: Key[] = [];
      for (let i = 1; i < AIR; i++) {
        const u = i / AIR;
        const half = AIR / 2;
        const joints = (i < half ? inBetween(rig, push, { ...split, position: push.position }, half - 1, push, [])[i - 1] : i === half ? split : inBetween(rig, split, { ...land, position: split.position }, half - 1, split, [])[i - half - 1]).bones;
        const time = at(i);
        const y = from.y + v * time - (9.81 * time * time) / 2;
        flight.push({ t: at(UP + i), figures: [{ ...f, bones: joints, grounded: false, position: [r3(from.x + (to.x - from.x) * u), r3(y), r3(from.z + (to.z - from.z) * u)] }] });
      }
      return animated('Split leap', atHeights(rig, [
        { t: 0, figures: [stand] }, { t: at(5), figures: [lift] }, { t: at(8), figures: [reaching] }, { t: at(10), figures: [step] },
        ...inBetween(rig, step, plie, 5, step, ['R']).map((p, i) => ({ t: at(11 + i), figures: [p] })),
        { t: at(16), figures: [plie] },
        ...inBetween(rig, plie, push, 2, step, ['R']).map((p, i) => ({ t: at(17 + i), figures: [p] })),
        { t: at(UP), figures: [push] }, ...flight, { t: at(DOWN), figures: [land] },
        ...inBetween(rig, land, absorb, 5, land, ['L']).map((p, i) => ({ t: at(DOWN + 1 + i), figures: [p] })),
        { t: at(DOWN + 6), figures: [absorb] }, { t: at(DOWN + 12), figures: [lower] }, { t: at(DOWN + 18), figures: [end] },
      ]), { duration: 2.25, loop: false, view: { yaw: 90, pitch: 4, fov: 34 } });
    }),
  },
  {
    id: 'bow',
    looseArms: true,
    name: 'Bow',
    group: 'Talking & gestures',
    build: () => {
      const f = person('Ken', { ...DEFAULT_BODY }, STAND);
      const stand = posed(f, STAND);
      // (The back bowing along its length, the head going a little further; the hands sliding down
      // the thighs; a breath drawn up first, the head down a moment longer than the back.)
      const bow = posed(f, {
        ...STAND, hips: [40, 0, 0], leftUpperLeg: [-40, 0, 3], rightUpperLeg: [-40, 0, -3], spine: [6, 0, 0], chest: [5, 0, 0], upperChest: [4, 0, 0], neck: [12, 0, 0], head: [8, 0, 0],
        leftUpperArm: [-38, 0, 6], rightUpperArm: [-38, 0, -6], leftLowerArm: [-12, 0, 0], rightLowerArm: [-12, 0, 0],
      });
      const drawn = posed(f, { ...STAND, chest: [-3, 0, 0], upperChest: [-2, 0, 0], head: [-3, 0, 0] });
      const rising = posed(f, {
        ...STAND, hips: [14, 0, 0], leftUpperLeg: [-14, 0, 3], rightUpperLeg: [-14, 0, -3], spine: [2, 0, 0], chest: [2, 0, 0], neck: [14, 0, 0], head: [10, 0, 0],
        leftUpperArm: [-14, 0, 8], rightUpperArm: [-14, 0, -8],
      });
      return animated('Bow', [
        { t: 0, figures: [stand] }, { t: 0.25, figures: [drawn] }, { t: 0.85, figures: [bow] }, { t: 1.45, figures: [bow] }, { t: 1.85, figures: [rising] }, { t: 2.25, figures: [stand] },
      ], { duration: 2.6, loop: false, view: { yaw: 55, pitch: 6, fov: 24 } });
    },
  },
];

/* ---------- handling props ---------- */

/** One person's arms over the frames of a motion that handles a prop (played from the waist up, with the right hand; mirrored for the left). */
function handling(name: string, frames: [number, Joints][], o: { loop?: boolean; hands?: [string, string] } = {}): Scene {
  const [left, right] = o.hands ?? ['Grip', 'Grip'];
  const f = { ...person(name, { ...DEFAULT_BODY }, STAND), hands: { L: hand(left), R: hand(right) } };
  const last = frames[frames.length - 1][0];
  return animated(name, frames.map(([frame, arms]) => ({ t: frame / 24, figures: [posed(f, { ...STAND, ...arms })] })), { duration: last / 24, loop: !!o.loop, view: { yaw: 40, pitch: 6, fov: 26 } });
}

const relaxed: Joints = { leftUpperArm: [0, 0, 8], rightUpperArm: [0, 0, -8], leftLowerArm: [-10, 0, 0], rightLowerArm: [-10, 0, 0] };
const carrying: Joints = { leftUpperArm: [-10, 0, 8], rightUpperArm: [-10, 0, -8], leftLowerArm: [-25, 0, 0], rightLowerArm: [-25, 0, 0] };

/**
 * Motions that handle props, put on a figure's upper body by the prop's menu (not listed in the
 * library): their release lets the prop go where the action sends it, their grab takes hold of it.
 */
export const HANDLING: Motion[] = [
  {
    // Arms steady at the sides, hands closed on what they carry (a bag, a stretcher's handles): over a walk, they do not swing.
    id: 'carry',
    name: 'Carry',
    group: 'Using things',
    build: () => handling('Carry', [[0, carrying], [24, carrying]], { loop: true }),
  },
  {
    // A jump shot's arms: the ball up in front of the face, the arm up and out to the hoop, a follow-through; the other hand at the ball's side until it goes.
    id: 'shoot',
    name: 'Shot',
    group: 'Sport & acrobatics',
    events: [{ t: 16 / 24, part: 0, kind: 'release', hand: 'R' }],
    build: () => handling('Shot', [
      [0, { rightUpperArm: [-60, 0, -20], rightLowerArm: [-100, 0, 0], leftUpperArm: [-55, 0, 20], leftLowerArm: [-95, 0, 0] }],
      [8, { rightUpperArm: [-110, 0, -20], rightLowerArm: [-100, 0, 0], leftUpperArm: [-70, 0, 10], leftLowerArm: [-90, 0, 0] }],
      [16, { rightUpperArm: [-155, 0, -10], rightLowerArm: [-15, 0, 0], leftUpperArm: [-95, 0, 20], leftLowerArm: [-60, 0, 0] }],
      [24, { rightUpperArm: [-145, 0, -10], rightLowerArm: [-20, 0, 0], leftUpperArm: [-75, 0, 20], leftLowerArm: [-50, 0, 0] }],
      [36, relaxed],
    ]),
  },
  {
    // A pass from the chest: both hands at the ball, the arms push out and the right hand lets it go.
    id: 'pass',
    name: 'Pass',
    group: 'Sport & acrobatics',
    events: [{ t: 12 / 24, part: 0, kind: 'release', hand: 'R' }],
    build: () => handling('Pass', [
      [0, { rightUpperArm: [-50, 0, -15], rightLowerArm: [-100, 0, 0], leftUpperArm: [-50, 0, 15], leftLowerArm: [-100, 0, 0] }],
      [6, { rightUpperArm: [-30, 0, -25], rightLowerArm: [-120, 0, 0], leftUpperArm: [-30, 0, 25], leftLowerArm: [-120, 0, 0] }],
      [12, { rightUpperArm: [-85, 0, -10], rightLowerArm: [-10, 0, 0], leftUpperArm: [-80, 0, 10], leftLowerArm: [-15, 0, 0] }],
      [20, { rightUpperArm: [-75, 0, -12], rightLowerArm: [-15, 0, 0], leftUpperArm: [-70, 0, 12], leftLowerArm: [-20, 0, 0] }],
      [32, relaxed],
    ]),
  },
  {
    // Tossed up from the right hand (a gymnast's hoop, say): down, up and let go; the arm waits up to catch it.
    id: 'toss',
    name: 'Toss',
    group: 'Sport & acrobatics',
    events: [{ t: 12 / 24, part: 0, kind: 'release', hand: 'R' }],
    build: () => handling('Toss', [
      [0, { rightUpperArm: [-20, 0, -15], rightLowerArm: [-20, 0, 0] }],
      [6, { rightUpperArm: [20, 0, -15], rightLowerArm: [-10, 0, 0] }],
      [12, { rightUpperArm: [-150, 0, -10], rightLowerArm: [-5, 0, 0] }],
      [30, { rightUpperArm: [-120, 0, -12], rightLowerArm: [-15, 0, 0] }],
    ], { hands: ['Relaxed', 'Open'] }),
  },
  {
    // A dribble, one bounce every half second, out at the side: the arm pushes the ball down, the
    // hand meets it on its way back up and rides it to the top before pushing again.
    id: 'dribble',
    name: 'Dribble',
    group: 'Sport & acrobatics',
    events: [{ t: 0, part: 0, kind: 'release', hand: 'R' }, { t: 7 / 24, part: 0, kind: 'grab', hand: 'R' }],
    build: () => handling('Dribble', [
      [0, { rightUpperArm: [-30, 0, -45], rightLowerArm: [-10, 0, 0] }],
      [9, { rightUpperArm: [-18, 0, -48], rightLowerArm: [-60, 0, 0] }],
      [12, { rightUpperArm: [-30, 0, -45], rightLowerArm: [-10, 0, 0] }],
    ], { loop: true, hands: ['Relaxed', 'Open'] }),
  },
];

/** The high jump, with its bar and mat: a set-up for a scene template (lib/templates.ts), not a motion of the library. */
export const highJump = (): Scene => withRig((rig) => {
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
      const load = plantFeet(rig, { ...adjusted(sink(stand, 30), { leftUpperArm: [25, 0, 20], rightUpperArm: [25, 0, -20], leftLowerArm: [-30, 0, 0], rightLowerArm: [-30, 0, 0], spine: [8, 0, 0] }), position: [0, 0, take + 0.08] }, stand);
      // The right foot comes straight up off the floor first (it does not drag).
      const liftR = feetOf(rig, load, ['R']).map((w) => ({ ...w, p: w.p.clone().add(new THREE.Vector3(0, 0.14, 0.04)) }));
      const lifted = plantFeet(rig, plantFeet(rig, { ...adjusted(load, { leftUpperArm: [-45, 0, 18], rightUpperArm: [-45, 0, -18], leftLowerArm: [-25, 0, 0], rightLowerArm: [-25, 0, 0] }), position: [0, 0, take + 0.12] }, load, ['L']), liftR);
      const lifting = adjusted(lifted, { rightFoot: [10, 0, 0] });
      // Up on the toes of the left foot, the right knee and the arms driving up.
      const driveBase = adjusted(stand, { rightUpperLeg: [-90, 0, -6], rightLowerLeg: [95, 0, 0], rightFoot: [20, 0, 0], leftUpperArm: [-110, 0, 15], rightUpperArm: [-110, 0, -15], leftLowerArm: [-20, 0, 0], rightLowerArm: [-20, 0, 0], leftFoot: [35, 0, 0], spine: [-6, 0, 0] });
      const driveY = rig.model(driveBase).joints.hips.position.y;
      const drive = { ...driveBase, grounded: false, position: [0, r3(driveY + 0.05), r3(take + 0.22)] as Vec3 };
      // Shapes in the air (joints but the root); the root turns as a whole.
      const arch: Joints = { spine: [-25, 0, 0], chest: [-15, 0, 0], neck: [-20, 0, 0], head: [-10, 0, 0], leftUpperArm: [10, 0, 25], rightUpperArm: [10, 0, -25], leftLowerArm: [-20, 0, 0], rightLowerArm: [-20, 0, 0], leftUpperLeg: [10, 0, 10], rightUpperLeg: [10, 0, -10], leftLowerLeg: [70, 0, 0], rightLowerLeg: [70, 0, 0], leftFoot: [20, 0, 0], rightFoot: [20, 0, 0] };
      const kick: Joints = { spine: [-5, 0, 0], neck: [20, 0, 0], leftUpperArm: [0, 0, 40], rightUpperArm: [0, 0, -40], leftUpperLeg: [-80, 0, 8], rightUpperLeg: [-80, 0, -8], leftLowerLeg: [10, 0, 0], rightLowerLeg: [10, 0, 0], leftFoot: [20, 0, 0], rightFoot: [20, 0, 0] };
      const down: Joints = { neck: [25, 0, 0], leftUpperArm: [0, 0, 60], rightUpperArm: [0, 0, -60], leftUpperLeg: [-60, 0, 10], rightUpperLeg: [-60, 0, -10], leftLowerLeg: [30, 0, 0], rightLowerLeg: [30, 0, 0], leftFoot: [10, 0, 0], rightFoot: [10, 0, 0] };
      const rest: Joints = { neck: [10, 0, 0], leftUpperArm: [0, 0, 60], rightUpperArm: [0, 0, -60], leftUpperLeg: [-25, 0, 10], rightUpperLeg: [-25, 0, -10], leftLowerLeg: [50, 0, 0], rightLowerLeg: [50, 0, 0] };
      const mixJoints = (p: Joints, q: Joints, u: number): Joints => Object.fromEntries([...new Set([...Object.keys(p), ...Object.keys(q)])].map((j) => {
        const x = p[j as JointName] ?? [0, 0, 0];
        const y = q[j as JointName] ?? [0, 0, 0];
        return [j, [0, 1, 2].map((c) => Math.round((x[c] + wrapDeg(y[c] - x[c]) * u) * 10) / 10 || 0) as Vec3];
      }));
      const { hips: _r, ...driven } = J(drive);
      void _r;
      // Turns (the root's lean, then turn): the back to the bar first (half a turn by the top), laid
      // back face up over it, head down as the shoulders land; then rolled back flat.
      const upright: Vec3 = [0, 0, 0];
      const contact: Vec3 = [-115, 180, 0];
      const flat: Vec3 = [-88, 180, 0];
      const turnAt = (u: number): Vec3 => [r3(-115 * Math.sin((u * Math.PI) / 2)), r3(180 * smooth(u / 0.5)), 0];
      const between = (p: Vec3, q: Vec3, u: number): Vec3 => [r3(p[0] + (q[0] - p[0]) * u), r3(p[1] + (q[1] - p[1]) * u), 0];
      const posedIn = (joints: Joints, hips: Vec3, position: Vec3): Figure => ({ ...f, grounded: false, bones: bonesOf({ ...joints, hips }), position });
      // On the mat: the pelvis this high above its top.
      const pelvisOn = (joints: Joints, hips: Vec3) => rig.model({ ...f, grounded: true, bones: bonesOf({ ...joints, hips }) }).joints.hips.position.y;
      const yFlat = MAT + pelvisOn(down, flat);
      const yContact = MAT + pelvisOn(kick, contact);
      const from = rig.model(drive).joints.hips.getWorldPosition(new THREE.Vector3());
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
        { t: 0, figures: [{ ...stand, position: [0, 0, 0] }] }, { t: at(tRun), figures: [stand] }, { t: at(tRun + 6), figures: [load] }, { t: at(tRun + 9), figures: [lifting] }, { t: at(tRun + 12), figures: [{ ...drive, bones: bonesOf({ ...J(drive), hips: upright }) }] },
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
      // The run-up is generated: the take-off mark is reached running.
      const scene = travelling(animated('High jump', keys, { duration: end, loop: false, view: { yaw: 90, pitch: 4, fov: 40 } }), f.id, 0, at(tRun), 'run');
      const animation = scene.animation!;
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
    });
