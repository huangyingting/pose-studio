import { mapBones } from '@/lib/model';
import * as THREE from 'three';
import { mixamoRig } from './rig';

/*
 * A character as a glTF file: the Mixamo-named skeleton (tests/fixtures/rig.ts) as a skin, with a
 * small mesh bound to its hips. Written by hand (three's exporter needs a browser).
 */
export function characterGltf(aPose = false, tall = false): string {
  const rig = mixamoRig(aPose);
  const bones: THREE.Object3D[] = [];
  rig.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o); });
  const index = new Map(bones.map((b, i) => [b, i]));
  const nodes: Record<string, unknown>[] = bones.map((b) => ({
    name: b.name,
    translation: [b.position.x / 100, b.position.y / 100, b.position.z / 100],
    ...(b.children.length ? { children: b.children.map((c) => index.get(c)!) } : {}),
  }));
  // A triangle at the hips (or, `tall`, from the floor to over the head), all its weight on the
  // first bone; inverse binds from the rest pose.
  const [y0, y1] = tall ? [0, 1.85] : [1, 1.1];
  const positions = new Float32Array([0, y0, 0, 0.1, y0, 0, 0, y1, 0]);
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
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, y0, 0], max: [0.1, y1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: bones.length, type: 'MAT4' },
    ],
    bufferViews: [view(0), view(1), view(2), view(3)],
    buffers: [{ byteLength: parts.reduce((n, p) => n + p.length, 0), uri: `data:application/octet-stream;base64,${Buffer.concat(parts).toString('base64')}` }],
  };
  return JSON.stringify(gltf);
}

/**
 * The same character as a VRM avatar (1.0 or 0.x): its bones renamed so nothing can be told from
 * their names (only from its humanoid), a material with MToon settings, and who made it.
 */
export function vrmGltf(version: 1 | 0 = 1): string {
  const gltf = JSON.parse(characterGltf()) as { nodes: { name: string }[]; extensions?: unknown; extensionsUsed?: string[]; materials?: unknown[]; meshes: { primitives: { material?: number }[] }[] };
  // Which of our bones each node is, by the Mixamo names it had; then names that say nothing.
  const ours = new Map(Object.entries(mapBones(mixamoRig(false))).map(([bone, name]) => [name, bone]));
  const human: Record<string, number> = {};
  gltf.nodes.forEach((n, i) => {
    const bone = ours.get(n.name);
    if (bone) human[bone] = i;
    if (n.name !== 'Body') n.name = `Bone_${String(i).padStart(3, '0')}`;
  });
  gltf.meshes[0].primitives[0].material = 0;
  const mtoon = {
    specVersion: '1.0', shadeColorFactor: [0.6, 0.3, 0.4], shadingShiftFactor: -0.2, shadingToonyFactor: 0.95,
    parametricRimColorFactor: [0.2, 0.2, 0.3], parametricRimFresnelPowerFactor: 3, parametricRimLiftFactor: 0.1,
    outlineWidthMode: 'worldCoordinates', outlineWidthFactor: 0.003, outlineColorFactor: [0.1, 0.05, 0.08],
  };
  if (version === 1) {
    gltf.materials = [{ name: 'Skin', pbrMetallicRoughness: { baseColorFactor: [1, 0.9, 0.85, 1] }, extensions: { VRMC_materials_mtoon: mtoon } }];
    gltf.extensionsUsed = ['VRMC_vrm', 'VRMC_materials_mtoon'];
    gltf.extensions = {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: { name: 'Test', authors: ['Ueda'], licenseUrl: 'https://vrm.dev/licenses/1.0/', commercialUsage: 'personalNonProfit', creditNotation: 'required', allowRedistribution: false },
        humanoid: { humanBones: Object.fromEntries(Object.entries(human).map(([b, node]) => [b, { node }])) },
      },
    };
  } else {
    gltf.materials = [{ name: 'Skin', pbrMetallicRoughness: { baseColorFactor: [1, 0.9, 0.85, 1] } }];
    gltf.extensionsUsed = ['VRM'];
    gltf.extensions = {
      VRM: {
        meta: { title: 'Test', author: 'Ueda', commercialUssageName: 'Disallow' },
        // (0.x calls the thumb's first two bones Proximal and Intermediate.)
        humanoid: { humanBones: Object.entries(human).map(([b, node]) => ({ bone: b.replace(/ThumbProximal$/, 'ThumbIntermediate').replace(/ThumbMetacarpal$/, 'ThumbProximal'), node })) },
        materialProperties: [{
          name: 'Skin', shader: 'VRM/MToon',
          floatProperties: { _ShadeToony: 0.8, _ShadeShift: 0.1, _RimFresnelPower: 3, _RimLift: 0.1, _OutlineWidthMode: 1, _OutlineWidth: 0.3, _BlendMode: 0, _Cutoff: 0.5, _CullMode: 2 },
          vectorProperties: { _Color: [1, 0.9, 0.85, 1], _ShadeColor: [0.6, 0.3, 0.4, 1], _RimColor: [0.2, 0.2, 0.3, 1], _OutlineColor: [0.1, 0.05, 0.08, 1], _EmissionColor: [0, 0, 0, 1] },
          textureProperties: {},
        }],
      },
    };
  }
  return JSON.stringify(gltf);
}
