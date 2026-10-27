import * as THREE from 'three';
import { BODY_PRESETS, DEFAULT_BODY } from './body';
import { newFigure, newScene } from './doc';
import { sided } from './joints';
import { HAND_PRESETS, cloneHand } from './hands';
import {
  Rig, backToBack, besides, contactPoint, faceEachOther, facing, forward, headPoint, leftward, lookAt, reach, withFacing,
} from './relations';
import { withAngles, type Angles } from './pose';
import type { BodyParams, Figure, Hand, JointName, Scene, Side, Vec3, View } from './types';

/*
 * Multi-person scene templates. Each one is built with the same tools the editor offers:
 * placement (facing, spacing), look-at and reaching for a point on another figure, so hands
 * really land on shoulders, backs and each other.
 */

export interface Template {
  id: string;
  name: string;
  people: number;
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

function scene(name: string, figures: Figure[], view: View): Scene {
  return { ...newScene(name, figures), view };
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
export function waltzHold(rig: Rig, a: Figure, b: Figure): [Figure, Figure] {
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

export const TEMPLATES: Template[] = [
  {
    id: 'conversation',
    name: 'Conversation',
    people: 2,
    build: () => withRig((rig) => {
      let a = person('Anna', body('Female'), -0.55, 0, 0, {
        leftUpperLeg: [0, 0, 5], rightUpperLeg: [-4, 0, -7], rightLowerLeg: [10, 0, 0],
        leftUpperArm: [0, 0, 8], leftLowerArm: [-12, 0, 0],
        rightUpperArm: [-38, 10, -14], rightLowerArm: [-78, 0, 0], rightHand: [-20, 0, 10],
      });
      let b = person('Ben', body('Male'), 0.55, 0, 0, {
        leftUpperLeg: [-3, 0, 6], leftLowerLeg: [8, 0, 0], rightUpperLeg: [0, 0, -4],
        leftUpperArm: [8, -20, 40], leftLowerArm: [-105, 0, 0], rightUpperArm: [0, 0, -8], rightLowerArm: [-12, 0, 0],
      });
      [a, b] = faceEachOther(a, b);
      a = withHands(a, hand('Relaxed'), hand('Open'));
      [a, b] = lookAtEachOther(rig, a, b);
      return scene('Conversation', [a, b], { yaw: 12, pitch: 6, fov: 24 });
    }),
  },
  {
    id: 'handshake',
    name: 'Handshake',
    people: 2,
    build: () => withRig((rig) => {
      let a = person('Ben', body('Male'), -0.34, 0, 0, RELAXED_ARMS);
      let b = person('Anna', body('Female'), 0.34, 0, 0, RELAXED_ARMS);
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
    build: () => withRig((rig) => {
      const b = person('Ben', body('Athletic'), 0.3, 0, -8, {
        leftUpperArm: [6, -25, 38], leftLowerArm: [-100, 0, 0], rightUpperArm: [0, 0, -10], rightLowerArm: [-15, 0, 0], leftUpperLeg: [0, 0, 6], rightUpperLeg: [-3, 0, -3],
      });
      let a = besides(person('Anna', body('Female'), 0, 0, 0, RELAXED_ARMS), b, 'R', 0.58);
      a = pose(a, { hips: [0, 8, 0], rightUpperLeg: [-3, 0, -6], rightLowerLeg: [6, 0, 0] });
      a = reachTo(rig, a, 'L', contactPoint(rig.model(b), b, 'rightUpperArm'));
      a = withHands(a, hand('Relaxed'));
      return scene('Hand on shoulder', [a, b], { yaw: 0, pitch: 5, fov: 22 });
    }),
  },
  {
    id: 'walking',
    name: 'Walking hand in hand',
    people: 2,
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
      let a = person('Anna', body('Female'), -0.27, 0, 0, stride('L'));
      let b = person('Ben', body('Male'), 0.29, 0.04, 0, stride('R'));
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
    build: () => withRig((rig) => {
      const a = person('Ben', body('Male'), 0.04, -0.2, 0, { ...RELAXED_ARMS, spine: [-3, 0, 0], chest: [-4, 0, 0] });
      const b = person('Anna', body('Slender'), -0.04, 0.2, 180, { ...RELAXED_ARMS, spine: [-6, 0, 0], chest: [-8, 0, 0], neck: [-6, 0, 0] });
      return scene('Waltz hold', waltzHold(rig, a, b), { yaw: 70, pitch: 6, fov: 24 });
    }),
  },
  {
    id: 'backtoback',
    name: 'Back to back',
    people: 2,
    build: () => withRig((rig) => {
      const folded = (f: Figure) => {
        let g = reachTo(rig, f, 'L', local(rig, f, 'rightLowerArm', [0.02, 0.02, 0.1]));
        g = reachTo(rig, g, 'R', local(rig, g, 'leftLowerArm', [-0.02, -0.03, 0.12]));
        return g;
      };
      let a = person('Anna', body('Female'), 0, 0.15, 0, { ...RELAXED_ARMS, leftUpperLeg: [0, 0, 6], rightUpperLeg: [-2, 0, -4] });
      let b = backToBack(person('Ben', body('Heroic'), 0, 0, 0, RELAXED_ARMS), a, 0.32);
      a = folded(a);
      b = folded(b);
      a = lookTo(rig, a, new THREE.Vector3(1.5, 1.6, 5));
      b = lookTo(rig, b, local(rig, b, 'head', [-1.2, 0, 0.8]));
      return scene('Back to back', [a, b], { yaw: 60, pitch: 5, fov: 24 });
    }),
  },
  {
    id: 'sparring',
    name: 'Sparring',
    people: 2,
    build: () => withRig((rig) => {
      const stance: Angles = {
        hips: [6, 25, 0], spine: [6, -12, 0], chest: [4, -10, 0],
        leftUpperLeg: [-26, 0, 8], leftLowerLeg: [26, 0, 0], leftFoot: [-6, 0, 0],
        rightUpperLeg: [16, 0, -12], rightLowerLeg: [24, 0, 0], rightFoot: [6, 0, 0],
      };
      let a = person('Ben', body('Athletic'), -0.62, 0, 0, RELAXED_ARMS);
      let b = person('Kai', body('Male'), 0.62, 0, 0, RELAXED_ARMS);
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
    build: () => withRig((rig) => {
      let mid = person('Mia', body('Female'), 0, 0, 0, RELAXED_ARMS);
      let left = besides(person('Ben', body('Male'), 0, 0, 0, {
        leftUpperArm: [0, 0, 8], leftLowerArm: [-12, 0, 0], rightUpperArm: [6, 20, -40], rightLowerArm: [-100, 0, 0], leftUpperLeg: [-2, 0, 5],
      }), mid, 'R', 0.47);
      let right = besides(person('Ava', body('Slender'), 0, 0, 0, {
        rightUpperArm: [0, 0, -8], rightLowerArm: [-12, 0, 0], leftUpperArm: [-10, 0, 150], leftLowerArm: [-60, 0, 0], rightUpperLeg: [-3, 0, -6], rightLowerLeg: [8, 0, 0],
      }), mid, 'L', 0.45);
      left = withFacing(left, 10);
      right = withFacing(right, -10);
      right = withHands(right, hand('Relaxed'), hand('Open'));
      // Arms around the neighbours: hands on the far side of their near shoulders.
      mid = reachTo(rig, mid, 'L', local(rig, right, 'rightUpperArm', [0.05, 0.05, -0.04]));
      mid = reachTo(rig, mid, 'R', local(rig, left, 'leftUpperArm', [-0.05, 0.05, -0.04]));
      return scene('Group photo', [left, mid, right], { yaw: 0, pitch: 5, fov: 26 });
    }),
  },
];

/** A fresh copy of a template (new ids every time). */
export function buildTemplate(id: string): Scene | null {
  return TEMPLATES.find((t) => t.id === id)?.build() ?? null;
}
