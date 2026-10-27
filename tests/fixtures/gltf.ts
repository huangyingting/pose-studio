import * as THREE from 'three';
import { mixamoRig } from './rig';

/*
 * A character as a glTF file: the Mixamo-named skeleton (tests/fixtures/rig.ts) as a skin, with a
 * small mesh bound to its hips. Written by hand (three's exporter needs a browser).
 */
export function characterGltf(aPose = false): string {
  const rig = mixamoRig(aPose);
  const bones: THREE.Object3D[] = [];
  rig.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o); });
  const index = new Map(bones.map((b, i) => [b, i]));
  const nodes: Record<string, unknown>[] = bones.map((b) => ({
    name: b.name,
    translation: [b.position.x / 100, b.position.y / 100, b.position.z / 100],
    ...(b.children.length ? { children: b.children.map((c) => index.get(c)!) } : {}),
  }));
  // A triangle at the hips, all its weight on the first bone; inverse binds from the rest pose.
  const positions = new Float32Array([0, 1, 0, 0.1, 1, 0, 0, 1.1, 0]);
  const joints = new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  rig.scale.setScalar(0.01);
  rig.updateMatrixWorld(true);
  const ibm = new Float32Array(bones.flatMap((b) => [...b.matrixWorld.clone().invert().elements]));
  const parts = ([positions, joints, weights, ibm] as ArrayBufferView[]).map((a) => Buffer.from(a.buffer as ArrayBuffer, a.byteOffset, a.byteLength));
  const offsets = parts.map((_, i) => parts.slice(0, i).reduce((n, p) => n + p.length, 0));
  const view = (i: number) => ({ buffer: 0, byteOffset: offsets[i], byteLength: parts[i].length });
  const meshNode = bones.length;
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, meshNode] }],
    nodes: [...nodes, { name: 'Body', mesh: 0, skin: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
    skins: [{ joints: bones.map((_, i) => i), inverseBindMatrices: 3, skeleton: 0 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 1, 0], max: [0.1, 1.1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: bones.length, type: 'MAT4' },
    ],
    bufferViews: [view(0), view(1), view(2), view(3)],
    buffers: [{ byteLength: parts.reduce((n, p) => n + p.length, 0), uri: `data:application/octet-stream;base64,${Buffer.concat(parts).toString('base64')}` }],
  };
  return JSON.stringify(gltf);
}
