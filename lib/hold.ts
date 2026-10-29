import * as THREE from 'three';
import { HAND_PRESETS } from './hands';
import { scaleOf } from './mannequin';
import { Rig } from './relations';
import { handlesOf } from './props';
import type { BodyParams, Figure, Prop, PropKind, Scene, Side, Vec3 } from './types';

/*
 * Props in a hand. A held prop's position and rotation are relative to the wrist (the hand hangs
 * along −Y, its palm faces the body: −X for the left hand, +X for the right), so it follows the
 * pose and the animation. These are starting grips; Move and the inspector fine-tune them.
 */

const D2R = Math.PI / 180;

/** Kinds that make sense in a hand (the handheld ones, a ball, a small box). */
export const HOLDABLE: readonly PropKind[] = ['stick', 'ring', 'ribbon', 'phone', 'cup', 'book', 'sphere', 'box'];

/**
 * Where a prop sits in the hand of a figure with `body`: by its first handle (in the fist, its
 * length along the way the figure faces, behind the hand), or as its kind is held.
 */
export function grip(prop: Pick<Prop, 'kind' | 'scale' | 'handles'>, hand: Side, body: BodyParams): Pick<Prop, 'position' | 'rotation'> & { scale?: Vec3 } {
  const s = hand === 'L' ? 1 : -1;
  const k = scaleOf(body);
  const at = (x: number, y: number, z: number): Vec3 => [round(-s * x * k), round(y * k), round(z * k)];
  const handle = handlesOf(prop)[0];
  if (handle) {
    // Turned a quarter about the arm, so the prop's x runs along the hand's z (forward, the arm hanging).
    const fist = new THREE.Vector3(...at(0.02, -0.085, 0));
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
    const p = fist.sub(new THREE.Vector3(...handle).applyQuaternion(turn));
    return { position: [round(p.x), round(p.y), round(p.z)], rotation: [0, -90, 0] };
  }
  switch (prop.kind) {
    case 'stick': // through the fist, pointing forward
      return { position: at(0.02, -0.085, -0.12), rotation: [90, 0, 0] };
    case 'ribbon': // the stick held at its end, pointing on from the hand
      return { position: at(0.02, -0.085, -0.03), rotation: [90, 0, 0] };
    case 'phone': // flat on the palm, along the hand
      return { position: at(0.027, -0.04, 0), rotation: [180, 90, 0] };
    case 'book':
      return { position: at(0.035, -0.02, 0), rotation: [180, 90, 0] };
    case 'cup': // upright in the fingers, handle away from the palm
      return { position: at(0.06, -0.14, 0.01), rotation: [0, s > 0 ? 180 : 0, 0] };
    case 'ring': // by its rim, hanging down beside the hand
      return { position: at(0.02, -0.07, 0), rotation: [0, 90, 0] };
    case 'sphere':
      return { position: at(0.13, -0.18, 0), rotation: [0, 0, 0], scale: [0.22, 0.22, 0.22] };
    default: // carried at the side
      return { position: at(0.17, -0.23, 0), rotation: [0, 0, 0], scale: [0.3, 0.3, 0.3] };
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** The prop put in `figure`'s hand, which closes into a grip. */
export function held(prop: Prop, figure: Figure, hand: Side): { prop: Prop; figure: Figure } {
  const g = grip(prop, hand, figure.body);
  const grab = HAND_PRESETS.find((p) => p.name === 'Grip')!.hand;
  return {
    prop: { ...prop, position: g.position, rotation: g.rotation, scale: g.scale ?? prop.scale, hold: { figure: figure.id, hand } },
    figure: { ...figure, hands: { ...figure.hands, [hand]: { curl: [...grab.curl], spread: grab.spread } } },
  };
}

/** The prop let go: it lands upright on the floor under where it was, keeping its heading. */
export function released(prop: Prop, scene: Scene): Prop {
  const hold = prop.hold;
  const figure = hold && scene.figures.find((f) => f.id === hold.figure);
  const { hold: _, ...free } = prop;
  void _;
  if (!figure || !hold) return free;
  const rig = new Rig();
  try {
    const wrist = rig.model(figure).joints[hold.hand === 'L' ? 'leftHand' : 'rightHand'];
    wrist.updateWorldMatrix(true, false);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...prop.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...prop.rotation.map((r) => r * D2R) as Vec3, 'XYZ')),
      new THREE.Vector3(1, 1, 1),
    );
    const world = wrist.matrixWorld.clone().multiply(local);
    const p = new THREE.Vector3().setFromMatrixPosition(world);
    const forward = new THREE.Vector3(0, 0, 1).transformDirection(world);
    const yaw = Math.abs(forward.y) > 0.99 ? 0 : Math.atan2(forward.x, forward.z) / D2R;
    return { ...free, position: [round(p.x), 0, round(p.z)], rotation: [0, Math.round(yaw * 10) / 10, 0] };
  } finally {
    rig.dispose();
  }
}
