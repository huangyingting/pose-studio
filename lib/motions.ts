import * as THREE from 'three';
import { poseOf } from './animation';
import { BODY_PRESETS, DEFAULT_BODY } from './body';
import { mirrorFigure, newFigure, newScene } from './doc';
import { HAND_PRESETS, cloneHand } from './hands';
import { wrapDeg } from './joints';
import { Rig, headPoint, leftward, forward, reach, withFacing } from './relations';
import { CAMERA_MOVES } from './shot';
import { buildTemplate } from './templates';
import type { Animation, BodyParams, Figure, Hand, JointName, Scene, Side, Vec3, View } from './types';

/*
 * Animated templates: walk and run cycles, a jump, dances, a boxing exchange and more.
 * Keys are authored as joint angles (with IK for contacts and punches) and each animation
 * comes with a camera move, so it plays like a short shot.
 */

export interface Motion {
  id: string;
  name: string;
  people: number;
  build(): Scene;
}

type Joints = Figure['joints'];

const body = (name: string): BodyParams => ({ ...(BODY_PRESETS.find((p) => p.name === name)?.body ?? DEFAULT_BODY) });
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
    keys: keys.map((k) => ({ t: k.t, poses: Object.fromEntries(k.figures.map((f) => [f.id, poseOf(f)])) })),
  };
  const move = CAMERA_MOVES.find((m) => m.id === (o.camera ?? 'static'));
  if (move) animation.camera = { keys: move.keys(animation, o.view), follow: move.follow ?? false, shake: move.shake ?? 0 };
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

/** Pelvis height that puts the lowest point of the pose on the floor (for airborne keys). */
function groundY(rig: Rig, f: Figure) {
  return rig.model({ ...f, grounded: true }).joints.root.position.y;
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

const WALK_CONTACT: Joints = {
  root: [4, 0, 0], spine: [2, -3, 0], chest: [0, -5, 0], head: [0, 6, 0],
  hipL: [-24, 0, 2], kneeL: [4, 0, 0], ankleL: [-10, 0, 0],
  hipR: [14, 0, -2], kneeR: [14, 0, 0], ankleR: [18, 0, 0],
  shoulderL: [18, 0, 8], elbowL: [-12, 0, 0], shoulderR: [-20, 0, -8], elbowR: [-28, 0, 0],
};
const WALK_PASSING: Joints = {
  root: [3, 0, 0], spine: [2, 0, 0],
  hipL: [2, 0, 2], kneeL: [6, 0, 0], ankleL: [2, 0, 0],
  hipR: [-14, 0, -2], kneeR: [50, 0, 0], ankleR: [-6, 0, 0],
  shoulderL: [4, 0, 8], elbowL: [-14, 0, 0], shoulderR: [-4, 0, -8], elbowR: [-18, 0, 0],
};
const RUN_CONTACT: Joints = {
  root: [12, 0, 0], spine: [4, -6, 0], chest: [2, -8, 0], head: [-8, 10, 0],
  hipL: [-40, 0, 3], kneeL: [22, 0, 0], ankleL: [-6, 0, 0],
  hipR: [22, 0, -3], kneeR: [72, 0, 0], ankleR: [30, 0, 0],
  shoulderL: [42, 0, 12], elbowL: [-95, 0, 0], shoulderR: [-52, 0, -12], elbowR: [-95, 0, 0],
};
const RUN_FLIGHT: Joints = {
  root: [12, 0, 0], spine: [4, 0, 0], head: [-8, 0, 0],
  hipL: [12, 0, 3], kneeL: [45, 0, 0], ankleL: [22, 0, 0],
  hipR: [-58, 0, -3], kneeR: [108, 0, 0], ankleR: [-4, 0, 0],
  shoulderL: [-5, 0, 12], elbowL: [-95, 0, 0], shoulderR: [5, 0, -12], elbowR: [-95, 0, 0],
};
const STAND: Joints = { shoulderL: [0, 0, 8], shoulderR: [0, 0, -8], elbowL: [-10, 0, 0], elbowR: [-10, 0, 0], hipL: [0, 0, 3], hipR: [0, 0, -3] };
const STANCE: Joints = {
  root: [6, 25, 0], spine: [6, -12, 0], chest: [4, -10, 0],
  hipL: [-26, 0, 8], kneeL: [26, 0, 0], ankleL: [-6, 0, 0],
  hipR: [16, 0, -12], kneeR: [24, 0, 0], ankleR: [6, 0, 0],
};

/** Fists up by the face (boxing guard), solved with IK for this figure's proportions. */
function guard(rig: Rig, f: Figure): Figure {
  let g = reachTo(rig, f, 'L', local(rig, f, 'head', [0.04, 0.02, 0.36]));
  g = reachTo(rig, g, 'R', local(rig, g, 'head', [-0.1, -0.04, 0.18]));
  return { ...g, hands: { L: hand('Fist'), R: hand('Fist') } };
}

export const MOTIONS: Motion[] = [
  {
    id: 'walk',
    name: 'Walk cycle',
    people: 1,
    build: () => {
      const f = person('Walker', body('Female'), WALK_CONTACT);
      const a = posed(f, WALK_CONTACT);
      const b = posed(f, WALK_PASSING);
      return animated('Walk cycle', [
        { t: 0, figures: [a] }, { t: 0.25, figures: [b] }, { t: 0.5, figures: [mirrored(a)] }, { t: 0.75, figures: [mirrored(b)] },
      ], { duration: 1, loop: true, view: { yaw: 70, pitch: 6, fov: 24 }, camera: 'orbit90' });
    },
  },
  {
    id: 'run',
    name: 'Run cycle',
    people: 1,
    build: () => {
      const f = { ...person('Runner', body('Athletic'), RUN_CONTACT), hands: { L: hand('Grip'), R: hand('Grip') } };
      const a = posed(f, RUN_CONTACT);
      const b = posed(f, RUN_FLIGHT);
      return animated('Run cycle', [
        { t: 0, figures: [a] }, { t: 0.18, figures: [b] }, { t: 0.36, figures: [mirrored(a)] }, { t: 0.54, figures: [mirrored(b)] },
      ], { duration: 0.72, loop: true, view: { yaw: 90, pitch: 4, fov: 26 }, camera: 'static' });
    },
  },
  {
    id: 'jump',
    name: 'Jump',
    people: 1,
    build: () => withRig((rig) => {
      const f = { ...person('Jumper', body('Athletic'), STAND), grounded: false };
      const at = (joints: Joints, lift = 0): Figure => {
        const g = posed(f, joints);
        return { ...g, position: [0, Math.round((groundY(rig, g) + lift) * 1000) / 1000, 0] };
      };
      const crouch: Joints = {
        root: [28, 0, 0], spine: [10, 0, 0], hipL: [-62, 0, 6], hipR: [-62, 0, -6], kneeL: [105, 0, 0], kneeR: [105, 0, 0], ankleL: [-32, 0, 0], ankleR: [-32, 0, 0],
        shoulderL: [50, 0, 12], shoulderR: [50, 0, -12], elbowL: [-20, 0, 0], elbowR: [-20, 0, 0],
      };
      const takeoff: Joints = {
        root: [4, 0, 0], hipL: [6, 0, 3], hipR: [6, 0, -3], kneeL: [2, 0, 0], kneeR: [2, 0, 0], ankleL: [42, 0, 0], ankleR: [42, 0, 0],
        shoulderL: [-160, 0, 14], shoulderR: [-160, 0, -14], elbowL: [-10, 0, 0], elbowR: [-10, 0, 0],
      };
      const tuck: Joints = {
        root: [10, 0, 0], spine: [8, 0, 0], hipL: [-55, 0, 6], hipR: [-55, 0, -6], kneeL: [80, 0, 0], kneeR: [80, 0, 0], ankleL: [22, 0, 0], ankleR: [22, 0, 0],
        shoulderL: [-120, 0, 30], shoulderR: [-120, 0, -30], elbowL: [-30, 0, 0], elbowR: [-30, 0, 0],
      };
      const land: Joints = {
        root: [12, 0, 0], hipL: [-24, 0, 5], hipR: [-24, 0, -5], kneeL: [30, 0, 0], kneeR: [30, 0, 0], ankleL: [-8, 0, 0], ankleR: [-8, 0, 0],
        shoulderL: [-70, 0, 30], shoulderR: [-70, 0, -30], elbowL: [-15, 0, 0], elbowR: [-15, 0, 0],
      };
      const absorb: Joints = { ...crouch, root: [22, 0, 0], shoulderL: [-40, 0, 25], shoulderR: [-40, 0, -25] };
      return animated('Jump', [
        { t: 0, figures: [at(STAND)] },
        { t: 0.4, figures: [at(crouch)] },
        { t: 0.62, figures: [at(takeoff, 0.06)] },
        { t: 0.9, figures: [at(tuck, 0.5)] },
        { t: 1.18, figures: [at(land)] },
        { t: 1.4, figures: [at(absorb)] },
        { t: 1.9, figures: [at(STAND)] },
      ], { duration: 1.9, loop: false, view: { yaw: 60, pitch: 4, fov: 26 }, camera: 'hero' });
    }),
  },
  {
    id: 'dance',
    name: 'Dance groove',
    people: 1,
    build: () => {
      const f = { ...person('Dancer', body('Slender'), STAND), hands: { L: hand('Open'), R: hand('Open') } };
      const up = posed(f, {
        root: [0, 8, 7], spine: [0, 0, -7], chest: [0, -6, -5], head: [0, 0, 8],
        hipL: [-6, 0, 10], hipR: [4, 0, -3], kneeL: [14, 0, 0], kneeR: [18, 0, 0], ankleL: [-6, 0, 0], ankleR: [-8, 0, 0],
        shoulderR: [-20, 0, -150], elbowR: [-24, 0, 0], shoulderL: [10, -20, 38], elbowL: [-95, 0, 0],
      });
      const dip = posed(f, {
        root: [6, 0, 0], spine: [6, 0, 0], head: [6, 0, 0],
        hipL: [-16, 0, 8], hipR: [-16, 0, -8], kneeL: [34, 0, 0], kneeR: [34, 0, 0], ankleL: [-16, 0, 0], ankleR: [-16, 0, 0],
        shoulderL: [-62, 0, 48], shoulderR: [-62, 0, -48], elbowL: [-75, 0, 0], elbowR: [-75, 0, 0],
      });
      return animated('Dance groove', [
        { t: 0, figures: [up] }, { t: 0.5, figures: [dip] }, { t: 1, figures: [mirrored(up)] }, { t: 1.5, figures: [mirrored(dip)] },
      ], { duration: 2, loop: true, view: { yaw: 10, pitch: 6, fov: 26 }, camera: 'orbit360' });
    },
  },
  {
    id: 'waltz-turn',
    name: 'Waltz turn',
    people: 2,
    build: () => {
      const hold = buildTemplate('waltz')!;
      const [a, b] = hold.figures;
      const centre = [(a.position[0] + b.position[0]) / 2, (a.position[2] + b.position[2]) / 2];
      const centred = (f: Figure): Figure => ({ ...f, position: [f.position[0] - centre[0], f.position[1], f.position[2] - centre[1]] });
      // Rise and fall: down on the first beat of each bar, up on the others.
      const knees = (f: Figure, bend: number): Figure => ({
        ...f,
        joints: { ...f.joints, kneeL: [bend, 0, 0], kneeR: [bend, 0, 0], hipL: [-bend / 2, 0, 3], hipR: [-bend / 2, 0, -3], ankleL: [-bend / 2, 0, 0], ankleR: [-bend / 2, 0, 0] },
      });
      const base = [centred(a), centred(b)];
      const keys: Key[] = [0, 1, 2, 3].map((i) => ({ t: i * 0.75, figures: base.map((f) => turnAbout(knees(f, i % 2 ? 4 : 18), -90 * i)) }));
      return animated('Waltz turn', keys, { duration: 3, loop: true, view: { yaw: 30, pitch: 10, fov: 26 }, camera: 'push' });
    },
  },
  {
    id: 'boxing',
    name: 'Boxing exchange',
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
      const slip = { ...b0, joints: { ...b0.joints, spine: [10, -12, -14], kneeL: [40, 0, 0], kneeR: [36, 0, 0] } } as Figure;
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
    people: 1,
    build: () => withRig((rig) => {
      const f = person('Fighter', body('Athletic'));
      const stance = guard(rig, posed(f, STANCE));
      const g = stance.joints;
      const chamber = { ...stance, joints: { ...g, root: [-2, g.root![1], 0] as Vec3, hipR: [-95, 0, -6] as Vec3, kneeR: [112, 0, 0] as Vec3, ankleR: [12, 0, 0] as Vec3 } };
      const extend = { ...stance, joints: { ...g, root: [-12, g.root![1], 0] as Vec3, spine: [-6, -12, 0] as Vec3, hipR: [-88, 0, -6] as Vec3, kneeR: [6, 0, 0] as Vec3, ankleR: [-25, 0, 0] as Vec3 } };
      return animated('Front kick', [
        { t: 0, figures: [stance] }, { t: 0.3, figures: [chamber] }, { t: 0.5, figures: [extend] }, { t: 0.72, figures: [chamber] }, { t: 1.05, figures: [stance] },
      ], { duration: 1.5, loop: true, view: { yaw: 70, pitch: 2, fov: 28 }, camera: 'hero' });
    }),
  },
  {
    id: 'wave',
    name: 'Wave hello',
    people: 1,
    build: () => {
      const f = { ...person('Mia', body('Female'), STAND), hands: { L: hand('Relaxed'), R: hand('Open') } };
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
    people: 1,
    build: () => {
      const f = person('Ken', body('Male'), STAND);
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
