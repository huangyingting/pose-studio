import * as THREE from 'three';

/*
 * A character's skeleton as Mixamo names its bones (in centimetres, facing +Z), standing in a
 * T-pose or an A-pose (arms 45° down), with a hand's fingers: for fitting rigs to the skeleton.
 */
export function mixamoRig(aPose = false): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Armature';
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = `mixamorig:${name}`;
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  const hips = bone('Hips', root, 0, 100, 0);
  const spine = bone('Spine', hips, 0, 10, 0);
  const spine1 = bone('Spine1', spine, 0, 12, 0);
  const spine2 = bone('Spine2', spine1, 0, 12, 0);
  const neck = bone('Neck', spine2, 0, 16, 0);
  bone('Head', neck, 0, 10, 0);
  const down = aPose ? Math.SQRT1_2 : 0;
  const out = aPose ? Math.SQRT1_2 : 1;
  for (const [side, s] of [['Left', 1], ['Right', -1]] as const) {
    const shoulder = bone(`${side}Shoulder`, spine2, s * 5, 10, 0);
    const arm = bone(`${side}Arm`, shoulder, s * 12, 0, 0);
    const fore = bone(`${side}ForeArm`, arm, s * 28 * out, -28 * down, 0);
    const hand = bone(`${side}Hand`, fore, s * 25 * out, -25 * down, 0);
    for (const [finger, z] of [['Thumb', 3], ['Index', 2], ['Middle', 0], ['Ring', -1.5], ['Pinky', -3]] as const) {
      let at: THREE.Object3D = hand;
      for (let k = 1; k <= 3; k++) at = bone(`${side}Hand${finger}${k}`, at, s * (k === 1 ? 8 : 3) * out, -(k === 1 ? 8 : 3) * down, k === 1 ? z : 0);
    }
    const up = bone(`${side}UpLeg`, hips, s * 9, -5, 0);
    const leg = bone(`${side}Leg`, up, 0, -45, 0);
    const foot = bone(`${side}Foot`, leg, 0, -45, 0);
    bone(`${side}ToeBase`, foot, 0, -6, 12);
  }
  root.updateMatrixWorld(true);
  return root;
}
