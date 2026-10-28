import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BONES, type Bone } from './types';
import { ownLooks, type ToonLook } from './toon';

/*
 * VRM avatars (VRoid Studio's, and the many made like them) turned into our own on import and each
 * time they are read (#15): the skeleton map from its humanoid (VRM 1.0 `VRMC_vrm`, 0.x `VRM`; our
 * skeleton is the VRM 1.0 humanoid), each material's look from its MToon settings (as a ToonLook,
 * for the Toon style: lib/toon.ts), and who made it and on what terms. The file itself is kept as it
 * is, in the user's own library only.
 */

/** What a VRM file says of itself: its skeleton map and who made it (null: not a VRM). */
export interface VrmInfo {
  bones: Partial<Record<Bone, string>>;
  /** Its author and licence, in a line (as it asks to be credited). */
  credit: string;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const rgb = (v: unknown, d: [number, number, number]) => (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => typeof x === 'number') ? new THREE.Color(v[0], v[1], v[2]) : new THREE.Color(...d));

/** VRM 0.x humanoid names that differ from 1.0's (the thumb's bones were renamed). */
const OLD_NAMES: Record<string, Bone> = {
  leftThumbProximal: 'leftThumbMetacarpal', leftThumbIntermediate: 'leftThumbProximal',
  rightThumbProximal: 'rightThumbMetacarpal', rightThumbIntermediate: 'rightThumbProximal',
};

/**
 * Read a loaded glTF as a VRM: its skeleton map and credit (null if it is not one), and each mesh
 * given its look (`ownLooks`, lib/toon.ts) from its material's MToon settings.
 */
export async function readVrm(gltf: GLTF): Promise<VrmInfo | null> {
  const ext = obj(gltf.userData.gltfExtensions);
  const v1 = obj(ext.VRMC_vrm), v0 = obj(ext.VRM);
  if (!Object.keys(v1).length && !Object.keys(v0).length) return null;
  const parser = gltf.parser;
  const nodeName = async (i: unknown) => (typeof i === 'number' ? ((await parser.getDependency('node', i)) as THREE.Object3D).name : null);

  // The skeleton: its humanoid's bones by our names (1.0: a record; 0.x: a list, older thumb names).
  const bones: VrmInfo['bones'] = {};
  const known = new Set<string>(BONES);
  if (Object.keys(v1).length) {
    for (const [b, def] of Object.entries(obj(obj(v1.humanoid).humanBones))) {
      const name = known.has(b) ? await nodeName(obj(def).node) : null;
      if (name) bones[b as Bone] = name;
    }
  } else {
    for (const def of (obj(v0.humanoid).humanBones as unknown[] | undefined) ?? []) {
      const d = obj(def);
      const b = typeof d.bone === 'string' ? OLD_NAMES[d.bone] ?? d.bone : '';
      const name = known.has(b) ? await nodeName(d.node) : null;
      if (name) bones[b as Bone] = name;
    }
  }

  // Each mesh's look, from its material's MToon settings (1.0 on the material; 0.x by its name).
  const old = new Map<string, Json>(((v0.materialProperties as unknown[] | undefined) ?? []).map((m) => [String(obj(m).name), obj(m)]));
  // (A colour texture, as sRGB: the loader says so only of those it puts on a material itself.
  // One it does not have, or that does not load: none; the rest of its look still is.)
  const texture = async (info: unknown) => {
    const i = obj(info).index;
    if (typeof i !== 'number' || !parser.json.textures?.[i]) return null;
    const t = (await parser.getDependency('texture', i).catch(() => null)) as THREE.Texture | null;
    if (t && t.colorSpace !== THREE.SRGBColorSpace) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
    }
    return t;
  };
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const mesh of meshes) {
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (Array.isArray(mesh.material) || !m) continue;
    const mtoon = obj(obj(m.userData.gltfExtensions).VRMC_materials_mtoon);
    const legacy = old.get(m.name);
    const look = Object.keys(mtoon).length ? await fromMtoon(m, mtoon, texture) : legacy && legacy.shader === 'VRM/MToon' ? await fromLegacy(m, legacy, texture) : null;
    if (look) ownLooks.set(mesh, look);
  }

  // Who made it, and how it may be used (as it asks to be credited).
  const meta = obj(v1.meta ?? v0.meta);
  const authors = Array.isArray(meta.authors) ? meta.authors.filter((a) => typeof a === 'string').join(', ') : typeof meta.author === 'string' ? meta.author : '';
  const terms = [
    meta.commercialUsage === 'personalNonProfit' || meta.commercialUssageName === 'Disallow' ? 'personal use' : null,
    meta.creditNotation === 'required' ? 'credit required' : null,
    meta.allowRedistribution === false ? 'not to be shared' : null,
  ].filter(Boolean);
  const credit = [authors ? `by ${authors}` : '', ...terms].filter(Boolean).join(' · ').slice(0, 160);
  return { bones, credit };
}

/** A look from VRM 1.0 MToon settings (the material's base colour and texture as glTF has them). */
async function fromMtoon(m: THREE.MeshStandardMaterial, x: Json, texture: (info: unknown) => Promise<THREE.Texture | null>): Promise<ToonLook> {
  const mode = String(obj(m.userData).gltfAlphaMode ?? '');
  const outlineMode = x.outlineWidthMode;
  return {
    color: m.color.clone(), opacity: m.opacity, map: m.map,
    shade: rgb(x.shadeColorFactor, [0, 0, 0]), shadeMap: await texture(x.shadeMultiplyTexture),
    shift: num(x.shadingShiftFactor, 0), toony: num(x.shadingToonyFactor, 0.9),
    rim: rgb(x.parametricRimColorFactor, [0, 0, 0]), rimPower: num(x.parametricRimFresnelPowerFactor, 5), rimLift: num(x.parametricRimLiftFactor, 0),
    emissive: m.emissive?.clone() ?? new THREE.Color(0, 0, 0), emissiveMap: m.emissiveMap ?? null,
    alpha: m.alphaTest > 0 || mode === 'MASK' ? 'mask' : m.transparent ? 'blend' : 'opaque', cutoff: m.alphaTest > 0 ? m.alphaTest : 0.5,
    doubleSided: m.side === THREE.DoubleSide,
    // (Its width as a share of ours: 2 mm across the world, or 0.2% of the picture's height, is ours.)
    outline: outlineMode === 'worldCoordinates' || outlineMode === 'screenCoordinates'
      ? { width: Math.min(3, num(x.outlineWidthFactor, 0) / 0.002), color: rgb(x.outlineColorFactor, [0, 0, 0]) }
      : { width: 0, color: null },
  };
}

/** A look from VRM 0.x MToon properties (by name, as Unity's shader has them). */
async function fromLegacy(m: THREE.MeshStandardMaterial, x: Json, texture: (info: unknown) => Promise<THREE.Texture | null>): Promise<ToonLook> {
  const f = obj(x.floatProperties), v = obj(x.vectorProperties), t = obj(x.textureProperties);
  // (0.x keeps its colours as Unity shows them: sRGB.)
  const vec = (k: string, d: [number, number, number]) => { const c = rgb(v[k], d); return new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace); };
  const tex = (k: string) => (typeof t[k] === 'number' ? texture({ index: t[k] }) : Promise.resolve(null));
  const blend = num(f._BlendMode, 0);
  // (0.x blends from its shift to its shift + (1 − toony) of the light's −1…1: the same band on ours.)
  const t0 = num(f._ShadeToony, 0.9), s0 = num(f._ShadeShift, 0);
  const toony = (1 + t0) / 2;
  return {
    color: vec('_Color', [1, 1, 1]), opacity: num(obj(v._Color)[3], 1), map: (await tex('_MainTex')) ?? m.map,
    shade: vec('_ShadeColor', [0.6, 0.6, 0.6]), shadeMap: await tex('_ShadeTexture'),
    shift: -s0 - (1 - t0) / 2, toony,
    rim: vec('_RimColor', [0, 0, 0]), rimPower: num(f._RimFresnelPower, 5), rimLift: num(f._RimLift, 0),
    emissive: vec('_EmissionColor', [0, 0, 0]), emissiveMap: await tex('_EmissionMap'),
    alpha: blend === 1 ? 'mask' : blend >= 2 ? 'blend' : 'opaque', cutoff: num(f._Cutoff, 0.5),
    doubleSided: num(f._CullMode, 2) === 0,
    outline: num(f._OutlineWidthMode, 0) === 0 ? { width: 0, color: null } : { width: Math.min(3, num(f._OutlineWidth, 0) / 0.2), color: vec('_OutlineColor', [0, 0, 0]) },
  };
}
