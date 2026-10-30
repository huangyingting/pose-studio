import * as THREE from 'three';
import { BODY_PRESETS, DEFAULT_BODY } from './body';
import { cameraFrom, newFigure, newScene } from './doc';
import { sided } from './joints';
import { HAND_PRESETS, cloneHand } from './hands';
import {
  Rig, backToBack, besides, contactPoint, faceEachOther, facing, forward, headPoint, leftward, lookAt, reach, withFacing,
} from './relations';
import { withAngles, type Angles } from './pose';
import type { BodyParams, Figure, Hand, JointName, Scene, Side, Vec3, View } from './types';

/*
 * How several people stand together (a handshake, a waltz hold, a group photo): stagings that
 * scene templates (lib/templates.ts) start from and motions (lib/motions.ts) are built on. Each is
 * made with the same tools the editor offers: placement (facing, spacing), look-at and reaching
 * for a point on another figure, so hands really land on shoulders, backs and each other.
 */

export interface Staging {
  id: string;
  name: string;
  people: number;
  /** What they do, in words. */
  description: string;
  build(): Scene;
}

const body = (name: string): BodyParams => ({ ...(BODY_PRESETS.find((p) => p.name === name)?.body ?? DEFAULT_BODY) });
const hand = (name: string): Hand => cloneHand(HAND_PRESETS.find((p) => p.name === name)!.hand);

function person(name: string, b: BodyParams, x: number, z: number, yaw = 0, joints: Angles = {}): Figure {
  const f = newFigure({ name, body: b, position: [x, 0, z] });
  return withFacing({ ...f, bones: withAngles(f.bones, joints) }, yaw);
}

/** Merge joint angles into a figure, keeping its facing. */
function pose(f: Figure, joints: Angles): Figure {
  const yaw = facing(f);
  const next = { ...f, bones: withAngles(f.bones, joints) };
  return joints.hips ? withFacing(next, yaw + joints.hips[1]) : withFacing(next, yaw);
}

function withHands(f: Figure, l: Hand, r: Hand = l): Figure {
  return { ...f, hands: { L: cloneHand(l), R: cloneHand(r) } };
}

/** A point in a figure's own frame: right/left (+ = its left), up, forward, relative to a joint. */
function local(rig: Rig, f: Figure, joint: JointName, offset: Vec3) {
  const m = rig.model(f);
  const p = m.joints[joint].getWorldPosition(new THREE.Vector3());
  const [lx, lz] = leftward(f);
  const [fx, fz] = forward(f);
  return p.add(new THREE.Vector3(lx * offset[0] + fx * offset[2], offset[1], lz * offset[0] + fz * offset[2]));
}

function reachTo(rig: Rig, f: Figure, side: Side, target: THREE.Vector3): Figure {
  return { ...f, bones: reach(rig, f, side, target).bones };
}

function lookTo(rig: Rig, f: Figure, target: THREE.Vector3): Figure {
  return { ...f, bones: lookAt(rig, f, target) };
}

function lookAtEachOther(rig: Rig, a: Figure, b: Figure): [Figure, Figure] {
  const ha = headPoint(rig.model(a), a);
  const hb = headPoint(rig.model(b), b);
  return [lookTo(rig, a, hb), lookTo(rig, b, ha)];
}

/** A scene of these people, its first camera seeing them from an angle. */
function scene(name: string, figures: Figure[], view: View): Scene {
  return { ...newScene(name, figures), cameras: [cameraFrom(view)] };
}

/** Run a builder with a temporary rig. */
function withRig<T>(fn: (rig: Rig) => T): T {
  const rig = new Rig();
  try {
    return fn(rig);
  } finally {
    rig.dispose();
  }
}

/** Closed waltz hold for a lead `a` and follower `b` facing each other (also used by the waltz turn). */
function waltzHold(rig: Rig, a: Figure, b: Figure): [Figure, Figure] {
  // Lead's right hand on the follower's left shoulder blade.
  const blade = contactPoint(rig.model(b), b, 'back');
  const [blx, blz] = leftward(b);
  a = reachTo(rig, a, 'R', blade.add(new THREE.Vector3(blx * 0.09, -0.03, blz * 0.09)));
  // Follower's left hand on the lead's right shoulder.
  b = reachTo(rig, b, 'L', contactPoint(rig.model(a), a, 'rightUpperArm').add(new THREE.Vector3(0, -0.02, 0)));
  // Joined hands out to the lead's left, at eye level.
  const joined = local(rig, a, 'leftUpperArm', [0.3, 0.02, 0.16]);
  a = reachTo(rig, a, 'L', joined.clone().add(new THREE.Vector3(0, 0, -0.02)));
  b = reachTo(rig, b, 'R', joined.clone().add(new THREE.Vector3(0, 0, 0.02)));
  a = withHands(a, hand('Grip'), hand('Flat'));
  b = withHands(b, hand('Relaxed'), hand('Grip'));
  // Both look over their partner's right shoulder, heads to the left.
  a = lookTo(rig, a, local(rig, a, 'head', [0.9, 0.05, 1.2]));
  b = lookTo(rig, b, local(rig, b, 'head', [0.9, 0.1, 1.2]));
  return [a, b];
}

const RELAXED_ARMS: Angles = { leftUpperArm: [0, 0, 8], rightUpperArm: [0, 0, -8], leftLowerArm: [-10, 0, 0], rightLowerArm: [-10, 0, 0] };

export const STAGINGS: Staging[] = [
  {
    id: 'conversation',
    name: 'Conversation',
    people: 2,
    description: 'Two people stand facing each other a little apart, talking: one gestures with an open hand at waist height, the other listens with a hand on the hip, weight on one leg. They look at each other.',
    build: () => withRig((rig) => {
      let a = person('Anna', body('Woman'), -0.55, 0, 0, {
        leftUpperLeg: [0, 0, 5], rightUpperLeg: [-4, 0, -7], rightLowerLeg: [10, 0, 0],
        leftUpperArm: [0, 0, 8], leftLowerArm: [-12, 0, 0],
        rightUpperArm: [-30, 10, -14], rightLowerArm: [-55, 0, 0], rightHand: [-20, 0, 10],
      });
      let b = person('Ben', body('Man'), 0.55, 0, 0, {
        leftUpperLeg: [-3, 0, 6], leftLowerLeg: [8, 0, 0], rightUpperLeg: [0, 0, -4],
        leftUpperArm: [8, -20, 40], leftLowerArm: [-105, 0, 0], rightUpperArm: [0, 0, -8], rightLowerArm: [-12, 0, 0],
      });
      [a, b] = faceEachOther(a, b);
      // Ben's left hand on his hip, the elbow out.
      b = reachTo(rig, b, 'L', contactPoint(rig.model(b), b, 'leftUpperLeg').add(new THREE.Vector3(0, 0.1, 0)));
      a = withHands(a, hand('Relaxed'), hand('Open'));
      [a, b] = lookAtEachOther(rig, a, b);
      return scene('Conversation', [a, b], { yaw: 12, pitch: 6, fov: 24 });
    }),
  },
  {
    id: 'handshake',
    name: 'Handshake',
    people: 2,
    description: "Two people face each other an arm's length apart and shake right hands at waist height; their other arms hang relaxed. They look at each other.",
    build: () => withRig((rig) => {
      let a = person('Ben', body('Man'), -0.34, 0, 0, RELAXED_ARMS);
      let b = person('Anna', body('Woman'), 0.34, 0, 0, RELAXED_ARMS);
      [a, b] = faceEachOther(a, b);
      const meet = new THREE.Vector3(0, 0.95, 0);
      a = reachTo(rig, a, 'R', meet.clone().add(new THREE.Vector3(-0.025, 0, 0)));
      b = reachTo(rig, b, 'R', meet.clone().add(new THREE.Vector3(0.025, 0, 0)));
      a = withHands(a, hand('Relaxed'), hand('Grip'));
      b = withHands(b, hand('Relaxed'), hand('Grip'));
      [a, b] = lookAtEachOther(rig, a, b);
      return scene('Handshake', [a, b], { yaw: 18, pitch: 6, fov: 24 });
    }),
  },
  {
    id: 'shoulder',
    name: 'Hand on shoulder',
    people: 2,
    description: "Two people stand side by side facing the same way; the one on the right rests a hand on the other's near shoulder. The other has a hand on the hip.",
    build: () => withRig((rig) => {
      const b = person('Ben', body('Tall man'), 0.3, 0, -8, {
        leftUpperArm: [6, -25, 38], leftLowerArm: [-100, 0, 0], rightUpperArm: [2, 0, -4], rightLowerArm: [-15, 0, 0], leftUpperLeg: [0, 0, 6], rightUpperLeg: [-3, 0, -3],
      });
      let a = besides(person('Anna', body('Woman'), 0, 0, 0, RELAXED_ARMS), b, 'R', 0.64);
      a = pose(a, { hips: [0, 8, 0], rightUpperLeg: [-3, 0, -6], rightLowerLeg: [6, 0, 0] });
      // (Her hand on top of his shoulder, a little to the back: her arm clear of his.)
      const [fx, fz] = forward(b);
      a = reachTo(rig, a, 'L', contactPoint(rig.model(b), b, 'rightUpperArm').add(new THREE.Vector3(-fx * 0.04, 0.01, -fz * 0.04)));
      a = withHands(a, hand('Relaxed'));
      return scene('Hand on shoulder', [a, b], { yaw: 0, pitch: 5, fov: 22 });
    }),
  },
  {
    id: 'walking',
    name: 'Walking hand in hand',
    people: 2,
    description: 'Two people walk side by side mid-stride, holding hands between them; one looks at the other.',
    build: () => withRig((rig) => {
      const stride = (lead: Side): Angles => {
        const [f, r]: [Side, Side] = lead === 'L' ? ['L', 'R'] : ['R', 'L'];
        const s = (side: string) => (side === 'L' ? 1 : -1);
        return {
          [sided('UpperLeg', f)]: [-20, 0, 2 * s(f)], [sided('LowerLeg', f)]: [8, 0, 0], [sided('Foot', f)]: [-8, 0, 0],
          [sided('UpperLeg', r)]: [16, 0, -2 * s(f)], [sided('LowerLeg', r)]: [26, 0, 0], [sided('Foot', r)]: [14, 0, 0],
          [sided('UpperArm', f)]: [16, 0, 8 * s(f)], [sided('LowerArm', f)]: [-12, 0, 0],
          [sided('UpperArm', r)]: [-18, 0, 8 * s(r)], [sided('LowerArm', r)]: [-22, 0, 0],
          spine: [4, 0, 0],
        } as Angles;
      };
      let a = person('Anna', body('Woman'), -0.27, 0, 0, stride('L'));
      let b = person('Ben', body('Man'), 0.29, 0.04, 0, stride('R'));
      const held = new THREE.Vector3(0.01, 0.82, 0.05);
      a = reachTo(rig, a, 'L', held.clone().add(new THREE.Vector3(-0.02, 0, 0)));
      b = reachTo(rig, b, 'R', held.clone().add(new THREE.Vector3(0.02, 0, 0)));
      a = withHands(a, hand('Grip'), hand('Relaxed'));
      b = withHands(b, hand('Relaxed'), hand('Grip'));
      b = lookTo(rig, b, headPoint(rig.model(a), a));
      return scene('Walking hand in hand', [a, b], { yaw: 25, pitch: 6, fov: 24 });
    }),
  },
  {
    id: 'waltz',
    name: 'Waltz hold',
    people: 2,
    description: "A closed waltz hold: facing each other close, the lead's right hand on the partner's left shoulder blade, the partner's left hand on the lead's right shoulder, their other hands joined out to the side at eye level. Both look over the other's right shoulder.",
    build: () => withRig((rig) => {
      const a = person('Ben', body('Man'), 0.04, -0.2, 0, { ...RELAXED_ARMS, spine: [-3, 0, 0], chest: [-4, 0, 0] });
      const b = person('Anna', body('Tall woman'), -0.04, 0.2, 180, { ...RELAXED_ARMS, spine: [-6, 0, 0], chest: [-8, 0, 0], neck: [-6, 0, 0] });
      return scene('Waltz hold', waltzHold(rig, a, b), { yaw: 70, pitch: 6, fov: 24 });
    }),
  },
  {
    id: 'backtoback',
    name: 'Back to back',
    people: 2,
    description: 'Two people stand back to back, almost touching, arms folded, looking off to different sides.',
    build: () => withRig((rig) => {
      // Arms folded: the forearms across the chest, each hand by the other arm's elbow.
      const FOLDED: Angles = { leftUpperArm: [-60, -93, 11], leftLowerArm: [-105, 0, 0], rightUpperArm: [-54, 88, -19], rightLowerArm: [-122, 0, 0] };
      let a = person('Anna', body('Woman'), 0, 0.15, 0, { ...FOLDED, leftUpperLeg: [0, 0, 6], rightUpperLeg: [-2, 0, -4] });
      let b = backToBack(person('Ben', body('Big man'), 0, 0, 0, FOLDED), a, 0.32);
      a = lookTo(rig, a, new THREE.Vector3(1.5, 1.6, 5));
      b = lookTo(rig, b, local(rig, b, 'head', [-1.2, 0, 0.8]));
      return scene('Back to back', [a, b], { yaw: 60, pitch: 5, fov: 24 });
    }),
  },
  {
    id: 'sparring',
    name: 'Sparring',
    people: 2,
    description: 'Two boxers face each other in fighting stance, lead foot forward, knees bent, fists up guarding the face, eyes on each other.',
    build: () => withRig((rig) => {
      const stance: Angles = {
        hips: [6, 25, 0], spine: [6, -12, 0], chest: [4, -10, 0],
        leftUpperLeg: [-26, 0, 8], leftLowerLeg: [26, 0, 0], leftFoot: [-6, 0, 0],
        rightUpperLeg: [16, 0, -12], rightLowerLeg: [17, 0, 0], rightFoot: [6, 0, 0],
      };
      let a = person('Ben', body('Tall man'), -0.75, 0, 0, RELAXED_ARMS);
      let b = person('Kai', body('Man'), 0.75, 0, 0, RELAXED_ARMS);
      [a, b] = faceEachOther(a, b);
      const guard = (f: Figure) => {
        let g = pose(f, stance);
        g = reachTo(rig, g, 'L', local(rig, g, 'head', [0.04, 0.02, 0.36]));
        g = reachTo(rig, g, 'R', local(rig, g, 'head', [-0.1, -0.04, 0.18]));
        return withHands(g, hand('Fist'));
      };
      a = guard(a);
      b = guard(b);
      [a, b] = lookAtEachOther(rig, a, b);
      return scene('Sparring', [a, b], { yaw: 10, pitch: 6, fov: 26 });
    }),
  },
  {
    id: 'group',
    name: 'Group photo',
    people: 3,
    description: "Three people stand in a row for a photo, arms round each other's shoulders; the one on the right waves.",
    build: () => withRig((rig) => {
      let mid = person('Mia', body('Woman'), 0, 0, 0, RELAXED_ARMS);
      let left = besides(person('Ben', body('Man'), 0, 0, 0, {
        leftUpperArm: [0, 0, 8], leftLowerArm: [-12, 0, 0], rightUpperArm: [6, 20, -40], rightLowerArm: [-100, 0, 0], leftUpperLeg: [-2, 0, 5],
      }), mid, 'R', 0.52);
      let right = besides(person('Ava', body('Tall woman'), 0, 0, 0, {
        rightUpperArm: [0, 0, -8], rightLowerArm: [-12, 0, 0], leftUpperArm: [-10, 0, 150], leftLowerArm: [-60, 0, 0], rightUpperLeg: [-3, 0, -6], rightLowerLeg: [8, 0, 0],
      }), mid, 'L', 0.5);
      left = withFacing(left, 10);
      right = withFacing(right, -10);
      right = withHands(right, hand('Relaxed'), hand('Open'));
      // Arms around the neighbours: hands on the far side of their near shoulders; theirs round her back.
      mid = reachTo(rig, mid, 'L', local(rig, right, 'rightUpperArm', [0.05, 0.05, -0.04]));
      mid = reachTo(rig, mid, 'R', local(rig, left, 'leftUpperArm', [-0.05, 0.05, -0.04]));
      left = reachTo(rig, left, 'L', local(rig, mid, 'spine', [0.06, 0.04, -0.13]));
      right = reachTo(rig, right, 'R', local(rig, mid, 'spine', [-0.06, 0.08, -0.13]));
      return scene('Group photo', [left, mid, right], { yaw: 0, pitch: 5, fov: 26 });
    }),
  },
  {
    id: 'hug',
    name: 'Hug',
    people: 2,
    description: "Two people hug, chest to chest: one's arms go round the other's shoulders, the other's round the waist. Heads turn aside, each looking past the other's shoulder.",
    build: () => withRig((rig) => {
      let a = person('Anna', body('Woman'), -0.19, 0, 0, RELAXED_ARMS);
      let b = person('Ben', body('Man'), 0.19, 0, 0, RELAXED_ARMS);
      [a, b] = faceEachOther(a, b);
      a = reachTo(rig, a, 'L', local(rig, b, 'chest', [-0.1, 0.12, -0.13]));
      a = reachTo(rig, a, 'R', local(rig, b, 'chest', [0.1, 0.12, -0.13]));
      b = reachTo(rig, b, 'L', local(rig, a, 'spine', [-0.12, 0, -0.1]));
      b = reachTo(rig, b, 'R', local(rig, a, 'spine', [0.12, 0, -0.1]));
      a = withHands(a, hand('Flat'));
      b = withHands(b, hand('Flat'));
      a = lookTo(rig, a, local(rig, a, 'head', [0.6, -0.1, 1]));
      b = lookTo(rig, b, local(rig, b, 'head', [0.6, -0.2, 1]));
      return scene('Hug', [a, b], { yaw: 60, pitch: 6, fov: 24 });
    }),
  },
  {
    id: 'highfive',
    name: 'High five',
    people: 2,
    description: 'Two people face each other a step apart and slap raised right palms together above head height, their left arms down; they look at the hands.',
    build: () => withRig((rig) => {
      let a = person('Kai', body('Man'), -0.4, 0, 0, { ...RELAXED_ARMS, leftUpperLeg: [-6, 0, 5], leftLowerLeg: [8, 0, 0] });
      let b = person('Mia', body('Woman'), 0.4, 0, 0, { ...RELAXED_ARMS, rightUpperLeg: [-6, 0, -5], rightLowerLeg: [8, 0, 0] });
      [a, b] = faceEachOther(a, b);
      const meet = new THREE.Vector3(0, 1.72, 0);
      a = reachTo(rig, a, 'R', meet.clone().add(new THREE.Vector3(-0.02, 0, 0)));
      b = reachTo(rig, b, 'R', meet.clone().add(new THREE.Vector3(0.02, 0, 0)));
      a = withHands(a, hand('Relaxed'), hand('Open'));
      b = withHands(b, hand('Relaxed'), hand('Open'));
      a = lookTo(rig, a, meet);
      b = lookTo(rig, b, meet);
      return scene('High five', [a, b], { yaw: 15, pitch: 4, fov: 26 });
    }),
  },
  {
    id: 'fistbump',
    name: 'Fist bump',
    people: 2,
    description: 'Two people face each other a step apart and touch right fists at chest height, elbows bent; they look at each other.',
    build: () => withRig((rig) => {
      let a = person('Kai', body('Man'), -0.42, 0, 0, RELAXED_ARMS);
      let b = person('Leo', body('Tall man'), 0.42, 0, 0, RELAXED_ARMS);
      [a, b] = faceEachOther(a, b);
      const meet = new THREE.Vector3(0, 1.15, 0);
      a = reachTo(rig, a, 'R', meet.clone().add(new THREE.Vector3(-0.05, 0, 0)));
      b = reachTo(rig, b, 'R', meet.clone().add(new THREE.Vector3(0.05, 0, 0)));
      a = withHands(a, hand('Relaxed'), hand('Fist'));
      b = withHands(b, hand('Relaxed'), hand('Fist'));
      [a, b] = lookAtEachOther(rig, a, b);
      return scene('Fist bump', [a, b], { yaw: 15, pitch: 4, fov: 24 });
    }),
  },
  {
    id: 'bothhands',
    name: 'Holding both hands',
    people: 2,
    description: 'Two people stand facing each other close, holding both hands low between them, arms relaxed; they look into each other\'s eyes.',
    build: () => withRig((rig) => {
      let a = person('Anna', body('Woman'), -0.3, 0, 0, RELAXED_ARMS);
      let b = person('Ben', body('Man'), 0.3, 0, 0, RELAXED_ARMS);
      [a, b] = faceEachOther(a, b);
      const [lx, lz] = leftward(a);
      const at = (s: number) => new THREE.Vector3(lx * 0.17 * s, 0.92, lz * 0.17 * s);
      a = reachTo(rig, a, 'L', at(1));
      a = reachTo(rig, a, 'R', at(-1));
      b = reachTo(rig, b, 'R', at(1));
      b = reachTo(rig, b, 'L', at(-1));
      a = withHands(a, hand('Grip'));
      b = withHands(b, hand('Grip'));
      [a, b] = lookAtEachOther(rig, a, b);
      return scene('Holding both hands', [a, b], { yaw: 20, pitch: 5, fov: 24 });
    }),
  },
  {
    id: 'arminarm',
    name: 'Arm in arm',
    people: 2,
    description: "Two people stand side by side facing the same way, arm in arm: one bends the near arm with the elbow out, the other's hand rests on that forearm. Both look ahead.",
    build: () => withRig((rig) => {
      const b = person('Ben', body('Man'), 0.28, 0, 0, {
        rightUpperArm: [6, 25, -30], rightLowerArm: [-95, 0, 0], leftUpperArm: [0, 0, 8], leftLowerArm: [-12, 0, 0], leftUpperLeg: [-3, 0, 4],
      });
      let a = besides(person('Anna', body('Woman'), 0, 0, 0, RELAXED_ARMS), b, 'R', 0.46);
      a = pose(a, { leftUpperLeg: [-4, 0, 3], leftLowerLeg: [8, 0, 0] });
      a = reachTo(rig, a, 'L', contactPoint(rig.model(b), b, 'rightHand').add(new THREE.Vector3(0, 0.03, 0)));
      a = withHands(a, hand('Relaxed'));
      return scene('Arm in arm', [a, b], { yaw: 0, pitch: 5, fov: 22 });
    }),
  },
  {
    id: 'proposal',
    name: 'Proposal',
    people: 2,
    description: 'One person kneels on the right knee, left foot forward, holding up a ring box in the left hand and the partner\'s hand in the right. The partner stands in front, one hand to the mouth, looking down at them.',
    build: () => withRig((rig) => {
      let b = person('Ben', body('Man'), 0.4, 0, 0, {
        ...RELAXED_ARMS, spine: [-4, 0, 0],
        leftUpperLeg: [-99, 0, 6], leftLowerLeg: [88, 0, 0], leftFoot: [11, 0, 0], rightUpperLeg: [8, 0, -4], rightLowerLeg: [95, 0, 0], rightFoot: [70, 0, 0],
      });
      let a = person('Anna', body('Woman'), -0.4, 0, 0, { ...RELAXED_ARMS, rightUpperLeg: [-4, 0, -4], rightLowerLeg: [10, 0, 0] });
      [a, b] = faceEachOther(a, b);
      const held = new THREE.Vector3(-0.05, 0.98, -0.08);
      b = reachTo(rig, b, 'R', held.clone().add(new THREE.Vector3(0.03, 0, 0)));
      a = reachTo(rig, a, 'L', held.clone().add(new THREE.Vector3(-0.03, 0.01, 0)));
      b = reachTo(rig, b, 'L', local(rig, b, 'chest', [0.05, -0.05, 0.32]));
      a = reachTo(rig, a, 'R', local(rig, a, 'head', [-0.01, -0.08, 0.1]));
      a = withHands(a, hand('Grip'), hand('Relaxed'));
      b = withHands(b, hand('Grip'), hand('Grip'));
      [a, b] = lookAtEachOther(rig, a, b);
      return scene('Proposal', [a, b], { yaw: 30, pitch: 6, fov: 26 });
    }),
  },
  {
    id: 'helpup',
    name: 'Helping up',
    people: 2,
    description: 'One person sits on the floor, knees bent, leaning back on the left hand and reaching up with the right. The other stands in front, leaning forward over bent knees, gripping that hand to pull them up.',
    build: () => withRig((rig) => {
      let a = person('Mia', body('Woman'), -0.45, 0, 0, {
        hips: [-15, 0, 0], spine: [10, 0, 0],
        // (Leaning back on the left hand on the floor behind; the right arm forward, to reach up from.)
        leftUpperArm: [44, 0, 14], leftLowerArm: [-5, 0, 0], leftHand: [0, 0, 45], rightUpperArm: [-60, 0, -10],
        leftUpperLeg: [-130, 0, 14], leftLowerLeg: [114, 0, 0], leftFoot: [30, 0, 0], rightUpperLeg: [-125, 0, -10], rightLowerLeg: [105, 0, 0], rightFoot: [35, 0, 0],
      });
      let b = person('Ben', body('Man'), 0.45, 0, 0, {
        ...RELAXED_ARMS, hips: [25, 0, 0], spine: [10, 0, 0],
        leftUpperLeg: [-40, 0, 6], leftLowerLeg: [45, 0, 0], leftFoot: [-10, 0, 0], rightUpperLeg: [-10, 0, -6], rightLowerLeg: [25, 0, 0],
      });
      [a, b] = faceEachOther(a, b);
      const grip = new THREE.Vector3(-0.02, 0.85, 0);
      a = reachTo(rig, a, 'R', grip.clone().add(new THREE.Vector3(-0.03, 0, 0)));
      b = reachTo(rig, b, 'R', grip.clone().add(new THREE.Vector3(0.03, 0, 0)));
      a = withHands(a, hand('Open'), hand('Grip'));
      b = withHands(b, hand('Relaxed'), hand('Grip'));
      [a, b] = lookAtEachOther(rig, a, b);
      return scene('Helping up', [a, b], { yaw: 70, pitch: 8, fov: 26 });
    }),
  },
  {
    id: 'comfort',
    name: 'Comforting',
    people: 2,
    description: 'One person sits on the floor hugging the knees, head bowed. The other crouches close beside, a hand on their back, looking at them.',
    build: () => withRig((rig) => {
      let a = person('Mia', body('Woman'), 0, 0, 0, {
        hips: [-14, 0, 0], spine: [20, 0, 0], chest: [12, 0, 0], neck: [15, 0, 0], head: [20, 0, 0],
        leftUpperLeg: [-130, 0, 6], leftLowerLeg: [116, 0, 0], leftFoot: [29, 0, 0], rightUpperLeg: [-130, 0, -6], rightLowerLeg: [116, 0, 0], rightFoot: [29, 0, 0],
      });
      a = reachTo(rig, a, 'L', contactPoint(rig.model(a), a, 'rightLowerLeg').add(new THREE.Vector3(0, -0.05, 0.04)));
      a = reachTo(rig, a, 'R', contactPoint(rig.model(a), a, 'leftLowerLeg').add(new THREE.Vector3(0, -0.08, 0.04)));
      let b = besides(person('Ben', body('Man'), 0, 0, 0, {
        ...RELAXED_ARMS, hips: [20, 0, 0], spine: [8, 0, 0],
        leftUpperLeg: [-118, 0, 22], leftLowerLeg: [137, 0, 0], leftFoot: [-40, 0, 0], rightUpperLeg: [-118, 0, -22], rightLowerLeg: [137, 0, 0], rightFoot: [-40, 0, 0],
      }), a, 'R', 0.5);
      b = withFacing(b, facing(b) - 35);
      b = reachTo(rig, b, 'L', contactPoint(rig.model(a), a, 'back'));
      b = withHands(b, hand('Flat'), hand('Relaxed'));
      a = withHands(a, hand('Grip'));
      b = lookTo(rig, b, headPoint(rig.model(a), a));
      return scene('Comforting', [a, b], { yaw: 25, pitch: 10, fov: 26 });
    }),
  },
  {
    id: 'whisper',
    name: 'Whisper',
    people: 2,
    description: "Two people stand side by side; one leans in to the other's ear, a hand cupped beside the mouth. The other tilts the head to listen, eyes to the side.",
    build: () => withRig((rig) => {
      const b = person('Ben', body('Man'), 0.2, 0, 0, { ...RELAXED_ARMS, rightUpperArm: [0, 0, -3], neck: [0, -5, 6], head: [0, -10, 8] });
      let a = besides(person('Anna', body('Woman'), 0, 0, 0, { ...RELAXED_ARMS, hips: [0, 0, -4], spine: [0, 0, -8], chest: [0, 0, -6] }), b, 'R', 0.42);
      a = lookTo(rig, a, headPoint(rig.model(b), b));
      a = reachTo(rig, a, 'L', local(rig, a, 'head', [0.08, -0.05, 0.1]));
      a = withHands(a, hand('Open'), hand('Relaxed'));
      return scene('Whisper', [a, b], { yaw: 10, pitch: 5, fov: 22 });
    }),
  },
  {
    id: 'pointout',
    name: 'Pointing out',
    people: 2,
    description: 'Two people stand side by side; one points far ahead and up with a straight right arm, the other leans in and looks along the arm to where it points.',
    build: () => withRig((rig) => {
      let a = person('Kai', body('Man'), -0.25, 0, 0, RELAXED_ARMS);
      let b = besides(person('Mia', body('Woman'), 0, 0, 0, { ...RELAXED_ARMS, hips: [0, 0, 4], spine: [0, 0, 4] }), a, 'R', 0.45);
      const far = new THREE.Vector3(-2.5, 2.6, 6);
      a = reachTo(rig, a, 'R', local(rig, a, 'rightUpperArm', [-0.25, 0.25, 0.55]));
      a = withHands(a, hand('Relaxed'), hand('Point'));
      a = lookTo(rig, a, far);
      b = lookTo(rig, b, far);
      return scene('Pointing out', [a, b], { yaw: 160, pitch: 6, fov: 26 });
    }),
  },
  {
    id: 'selfie',
    name: 'Selfie',
    people: 2,
    description: "Two people stand close side by side; one holds a phone up and out in front with the right arm, the other's arm is round their shoulders. Both look up at the phone.",
    build: () => withRig((rig) => {
      let a = person('Mia', body('Woman'), 0.22, 0, 0, RELAXED_ARMS);
      let b = besides(person('Kai', body('Man'), 0, 0, 0, RELAXED_ARMS), a, 'L', 0.44);
      const phone = local(rig, a, 'head', [0.22, 0.18, 0.5]);
      a = reachTo(rig, a, 'R', phone);
      a = withHands(a, hand('Relaxed'), hand('Grip'));
      b = reachTo(rig, b, 'R', local(rig, a, 'rightUpperArm', [0.04, 0.03, -0.05]));
      b = withHands(b, hand('Relaxed'), hand('Flat'));
      a = lookTo(rig, a, phone);
      b = lookTo(rig, b, phone);
      return scene('Selfie', [a, b], { yaw: 0, pitch: 8, fov: 24 });
    }),
  },
  {
    id: 'sittogether',
    name: 'Sitting together',
    people: 2,
    description: 'Two people sit side by side on the floor, knees up and arms resting on them, shoulders close, heads turned towards each other.',
    build: () => withRig((rig) => {
      // (Each body's knees bent so its feet are on the floor with its seat: their legs differ.)
      const sit = (knee: number, foot: number): Angles => ({
        hips: [-15, 0, 0], spine: [8, 0, 0],
        leftUpperLeg: [-130, 0, 10], leftLowerLeg: [knee, 0, 0], leftFoot: [foot, 0, 0], rightUpperLeg: [-130, 0, -10], rightLowerLeg: [knee, 0, 0], rightFoot: [foot, 0, 0],
      });
      let a = person('Mia', body('Woman'), -0.24, 0, 0, sit(115, 29));
      let b = person('Kai', body('Man'), 0.26, 0, 0, sit(101, 44));
      const onKnees = (f: Figure) => {
        let g = reachTo(rig, f, 'L', contactPoint(rig.model(f), f, 'leftLowerLeg').add(new THREE.Vector3(0, 0.02, 0.06)));
        g = reachTo(rig, g, 'R', contactPoint(rig.model(g), g, 'rightLowerLeg').add(new THREE.Vector3(0, 0.02, 0.06)));
        return withHands(g, hand('Relaxed'));
      };
      a = onKnees(a);
      b = onKnees(b);
      [a, b] = lookAtEachOther(rig, a, b);
      return scene('Sitting together', [a, b], { yaw: 15, pitch: 8, fov: 26 });
    }),
  },
];

/** A fresh copy of a template (new ids every time). */
export function buildStaging(id: string): Scene | null {
  return STAGINGS.find((t) => t.id === id)?.build() ?? null;
}
