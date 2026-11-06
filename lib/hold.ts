import * as THREE from 'three';
import { HAND_PRESETS } from './hands';
import { scaleOf } from './mannequin';
import { Rig } from './relations';
import { handlesOf } from './props';
import { clipById } from './assets';
import { mirrorPose, samplePart } from './clip';
import { newProp, nextName } from './doc';
import { PROP_LABELS, type BodyParams, type Figure, type Pose, type Prop, type PropKind, type Scene, type Side, type Vec3 } from './types';

/*
 * Props in a hand. A held prop's position and rotation are relative to the wrist (the hand hangs
 * along −Y, its palm faces the body: −X for the left hand, +X for the right), so it follows the
 * pose and the animation. These are starting grips; Move and the inspector fine-tune them.
 */

const D2R = Math.PI / 180;

/** Kinds that make sense in a hand (the handheld ones, a ball, a small box). */
export const HOLDABLE: readonly PropKind[] = ['stick', 'ring', 'ribbon', 'phone', 'cup', 'book', 'pistol', 'rifle', 'sword', 'knife', 'shield', 'bat', 'club', 'bag', 'bow', 'dumbbell', 'kettlebell', 'barbell', 'sphere', 'box'];

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
    case 'pistol': // the grip through the fist, the barrel along the fingers (ahead, the arm out)
    case 'rifle':
    case 'knife': // the handle through the fist, the blade on from the thumb
      return { position: at(0.02, -0.085, -0.055), rotation: [90, 0, 0] };
    case 'sword': // the handle through the fist, the blade on from the thumb
      return { position: at(0.02, -0.085, -0.1), rotation: [90, 0, 0] };
    case 'bow': // by its grip, the middle of it: its limbs up and down from the fist, its back ahead
      return { position: at(0.02, -0.085, -0.7), rotation: [90, 0, 0] };
    case 'dumbbell':
      return { position: at(0.02, -0.085, -0.13), rotation: [90, 0, 0] };
    case 'barbell': // overhand, 0.4 m from its middle: the bar on from the thumb, across to the other hand
      return { position: at(0.02, -0.305, 0.4), rotation: [0, -90, 0] };
    case 'kettlebell': // hanging from the fingers by its handle
      return { position: at(0.03, -0.3, 0), rotation: [0, 90, 0] };
    case 'bat':
    case 'club':
      return { position: at(0.02, -0.085, -0.08), rotation: [90, 0, 0] };
    case 'shield': // on the back of the forearm, its face out
      return { position: at(-0.07, -0.18, 0), rotation: [0, s > 0 ? 90 : -90, 0] };
    case 'bag': // hanging from the fingers by its handle
      return { position: at(0.03, -0.37, 0), rotation: [0, 90, 0] };
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

/**
 * What the Library's motions hold (by the file's name), in which hand: given someone, it comes to
 * that hand (lib/actions/motion.ts). `between`: in both, where the motion first has them (a box carried).
 */
export const GEAR: Record<string, { kind: PropKind; hand: Side; between?: boolean }[]> = {
  ...Object.fromEntries(['aim-pistol', 'pistol-idle', 'pistol-walk', 'pistol-whip', 'shooting', 'lower-pistol', 'pistol-kneeling-idle', 'pistol-run'].map((m) => [m, [{ kind: 'pistol' as const, hand: 'R' as const }]])),
  ...Object.fromEntries(['rifle-idle', 'rifle-aiming-idle', 'firing-rifle', 'firing-rifle-kneeling', 'rifle-reload', 'rifle-walk', 'rifle-walk-aiming', 'rifle-run'].map((m) => [m, [{ kind: 'rifle' as const, hand: 'R' as const }]])),
  ...Object.fromEntries(['sword-and-shield-idle', 'sword-and-shield-attack', 'sword-and-shield-block', 'sword-and-shield-impact', 'sword-and-shield-death', 'sword-and-shield-run'].map((m) => [m, [{ kind: 'sword' as const, hand: 'R' as const }, { kind: 'shield' as const, hand: 'L' as const }]])),
  ...Object.fromEntries(['draw-sword', 'sheath-sword', 'one-hand-sword-combo', 'great-sword-idle', 'great-sword-slash', 'great-sword-attack'].map((m) => [m, [{ kind: 'sword' as const, hand: 'R' as const }]])),
  stabbing: [{ kind: 'knife', hand: 'L' }],
  'knife-idle': [{ kind: 'knife', hand: 'L' }],
  'baseball-hit': [{ kind: 'bat', hand: 'R' }],
  'golf-drive': [{ kind: 'club', hand: 'R' }],
  'golf-putt': [{ kind: 'club', hand: 'R' }],
  'talking-on-phone': [{ kind: 'phone', hand: 'R' }],
  'texting-while-standing': [{ kind: 'phone', hand: 'R' }],
  'texting-and-walking': [{ kind: 'phone', hand: 'R' }],
  drinking: [{ kind: 'cup', hand: 'L' }],
  'sitting-drinking': [{ kind: 'cup', hand: 'R' }],
  carrying: [{ kind: 'box', hand: 'R', between: true }],
  'walk-carrying-box': [{ kind: 'box', hand: 'R', between: true }],
  ...Object.fromEntries(['standing-equip-bow', 'standing-draw-arrow', 'standing-aim-idle', 'standing-aim-recoil', 'standing-aim-walk-forward', 'standing-disarm-bow', 'shooting-arrow'].map((m) => [m, [{ kind: 'bow' as const, hand: 'L' as const }]])),
  'bicep-curl': [{ kind: 'dumbbell', hand: 'R' }, { kind: 'dumbbell', hand: 'L' }],
  'kettlebell-swing': [{ kind: 'kettlebell', hand: 'R' }],
  'overhead-squat': [{ kind: 'barbell', hand: 'R' }],
  'walk-with-briefcase': [{ kind: 'bag', hand: 'R' }],
  'walk-with-shopping-bag': [{ kind: 'bag', hand: 'R' }],
};

/**
 * A box held in both hands of `figure` posed as `pose` (a motion's start): in `hand`'s grip, level
 * and square to the line between them, as wide as they are apart (less the palms), its bottom below them.
 */
function heldBetween(prop: Prop, figure: Figure, pose: Pose, hand: Side): Prop {
  const rig = new Rig();
  try {
    const m = rig.model({ ...figure, ...pose, id: `${figure.id}:between` });
    const [l, r] = (['leftHand', 'rightHand'] as const).map((j) => m.joints[j].getWorldPosition(new THREE.Vector3()));
    const width = Math.max(0.15, l.distanceTo(r) - 0.06);
    const height = round(width * 0.7);
    const mid = l.clone().add(r).multiplyScalar(0.5);
    const across = r.clone().sub(l).setY(0);
    const yaw = Math.atan2(-across.z, across.x);
    const world = new THREE.Matrix4().compose(mid.sub(new THREE.Vector3(0, height / 2, 0)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    const wrist = m.joints[hand === 'L' ? 'leftHand' : 'rightHand'];
    wrist.updateWorldMatrix(true, false);
    const local = wrist.matrixWorld.clone().invert().multiply(world);
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    local.decompose(p, q, new THREE.Vector3());
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    return { ...prop, position: [round(p.x), round(p.y), round(p.z)], rotation: [e.x, e.y, e.z].map((v) => Math.round((v / D2R) * 10) / 10 || 0) as Vec3, scale: [round(width), height, round(width * 0.8)], hold: { figure: figure.id, hand } };
  } finally {
    rig.dispose();
  }
}

/**
 * The scene with the gear a Library motion holds (GEAR) in the hands its figure plays it with
 * (mirrored, the other ones): what it holds of it already moved there, what it lacks put there,
 * unless that hand holds something else. The motion's own hands hold it: the figure's are left as
 * they are (not keyed into a grip where it starts).
 */
export function withGear(scene: Scene, figureId: string, motionId: string, mirror = false): Scene {
  const gear = motionId.startsWith('library:') ? GEAR[motionId.slice(8)] : undefined;
  const clip = clipById(motionId);
  const figure = scene.figures.find((f) => f.id === figureId);
  if (!gear || !clip || !figure) return scene;
  let props = scene.props;
  // (Its own gear moving between the hands, a sword and a shield changing places, is in the way of nothing.)
  const ours = (p: Prop) => p.hold?.figure === figureId && gear.some((g) => g.kind === p.kind);
  for (const g of gear) {
    const hand: Side = mirror ? (g.hand === 'L' ? 'R' : 'L') : g.hand;
    // (One of a kind in each hand, a dumbbell in each: each its own.)
    const twice = gear.filter((x) => x.kind === g.kind).length > 1;
    const mine = props.find((p) => p.hold?.figure === figureId && p.kind === g.kind && (!twice || p.hold.hand === hand));
    if (mine?.hold?.hand === hand) continue;
    if (props.some((p) => p.hold?.figure === figureId && p.hold.hand === hand && !ours(p))) continue;
    const prop = mine ?? newProp(g.kind, [0, 0, 0], nextName(PROP_LABELS[g.kind], props.map((p) => p.name)));
    // (In both hands: where the motion first has them.)
    const first = samplePart(clip.parts[0], 0, clip.duration, clip.loop);
    const put = g.between ? heldBetween(prop, figure, mirror ? mirrorPose(first) : first, hand) : held(prop, figure, hand).prop;
    props = mine ? props.map((p) => (p.id === mine.id ? put : p)) : [...props, put];
  }
  return props === scene.props ? scene : { ...scene, props };
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
