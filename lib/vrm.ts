import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BONES, EXPRESSIONS, type Bone, type Expression } from './types';
import type { SpringSpec } from './springs';
import { ownLooks, type ToonLook } from './toon';

/*
 * VRM avatars (VRoid Studio's, and the many made like them) turned into our own on import and each
 * time they are read (#15): the skeleton map from its humanoid (VRM 1.0 `VRMC_vrm`, 0.x `VRM`; our
 * skeleton is the VRM 1.0 humanoid), each material's look from its MToon settings (as a ToonLook,
 * for the Anime style: lib/toon.ts), and who made it and on what terms. The file itself is kept as it
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
  await readExpressions(gltf, v1, v0);
  const springs = await readSprings(gltf, obj(ext.VRMC_springBone), v0);
  if (springs) gltf.scene.userData.springs = springs;
  return { bones, credit };
}

/**
 * Its spring bones (hair, a skirt: lib/springs.ts), by the names its bones are read with: 1.0's
 * springs and colliders; 0.x's bone groups (each bone and those under it, a chain) and collider groups.
 */
async function readSprings(gltf: GLTF, v1: Json, v0: Json): Promise<SpringSpec | null> {
  const parser = gltf.parser;
  const name = async (i: unknown) => (typeof i === 'number' && i >= 0 && parser.json.nodes?.[i] ? ((await parser.getDependency('node', i)) as THREE.Object3D).name : null);
  const vec = (v: unknown, d: [number, number, number]): [number, number, number] => (Array.isArray(v) && v.length >= 3 ? [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])] : d);
  const spec: SpringSpec = { springs: [], colliders: [] };
  if (Object.keys(v1).length) {
    for (const c of (v1.colliders as unknown[] | undefined) ?? []) {
      const bone = await name(obj(c).node);
      const shape = obj(obj(c).shape);
      const sphere = obj(shape.sphere), capsule = obj(shape.capsule);
      spec.colliders.push(bone && Object.keys(capsule).length
        ? { bone, offset: vec(capsule.offset, [0, 0, 0]), tail: vec(capsule.tail, [0, 0, 0]), radius: num(capsule.radius, 0) }
        : { bone: bone ?? '', offset: vec(sphere.offset, [0, 0, 0]), radius: num(sphere.radius, 0) });
    }
    const groups = ((v1.colliderGroups as unknown[] | undefined) ?? []).map((g) => ((obj(g).colliders as unknown[] | undefined) ?? []).filter((i): i is number => typeof i === 'number'));
    for (const sp of (v1.springs as unknown[] | undefined) ?? []) {
      const joints = [];
      for (const j of (obj(sp).joints as unknown[] | undefined) ?? []) {
        const bone = await name(obj(j).node);
        if (bone) joints.push({ bone, stiffness: num(obj(j).stiffness, 1), gravityPower: num(obj(j).gravityPower, 0), gravityDir: vec(obj(j).gravityDir, [0, -1, 0]), dragForce: num(obj(j).dragForce, 0.5), hitRadius: num(obj(j).hitRadius, 0) });
      }
      const colliders = ((obj(sp).colliderGroups as unknown[] | undefined) ?? []).flatMap((g) => (typeof g === 'number' ? groups[g] ?? [] : []));
      if (joints.length) spec.springs.push({ joints, colliders });
    }
  } else {
    const sec = obj(v0.secondaryAnimation);
    const groupStart: number[] = [];
    for (const g of (sec.colliderGroups as unknown[] | undefined) ?? []) {
      groupStart.push(spec.colliders.length);
      const bone = await name(obj(g).node);
      for (const c of (obj(g).colliders as unknown[] | undefined) ?? []) {
        const o = obj(obj(c).offset);
        // (0.x is in Unity's frame: x the other way.)
        spec.colliders.push({ bone: bone ?? '', offset: [-num(o.x, 0), num(o.y, 0), num(o.z, 0)], radius: num(obj(c).radius, 0) });
      }
    }
    const sizes = ((sec.colliderGroups as unknown[] | undefined) ?? []).map((g) => ((obj(g).colliders as unknown[] | undefined) ?? []).length);
    for (const g of (sec.boneGroups as unknown[] | undefined) ?? []) {
      const b = obj(g);
      const d = obj(b.gravityDir);
      const colliders = ((b.colliderGroups as unknown[] | undefined) ?? []).flatMap((i) => (typeof i === 'number' && groupStart[i] !== undefined ? Array.from({ length: sizes[i] }, (_, k) => groupStart[i] + k) : []));
      for (const root of (b.bones as unknown[] | undefined) ?? []) {
        // A chain: the bone, then its first child, and so on.
        const joints = [];
        for (let node = (await parser.getDependency('node', root as number).catch(() => null)) as THREE.Object3D | null; node; node = node.children.find((c) => (c as THREE.Bone).isBone) ?? null) {
          joints.push({ bone: node.name, stiffness: num(b.stiffiness, 1), gravityPower: num(b.gravityPower, 0), gravityDir: [-num(d.x, 0), num(d.y, -1), num(d.z, 0)] as [number, number, number], dragForce: num(b.dragForce, 0.4), hitRadius: num(b.hitRadius, 0.02) });
        }
        if (joints.length) spec.springs.push({ joints, colliders });
      }
    }
  }
  spec.colliders = spec.colliders.map((c) => (c.bone ? c : { ...c, radius: 0 }));
  return spec.springs.length ? spec : null;
}

/**
 * Its face's expressions (#15: a blink, the mouth's vowels, happy, sad, angry, surprised, relaxed),
 * each the shape keys it sets: kept on each mesh, by expression (`userData.faces`: shape key and
 * weight), so that a copy of the model has them (lib/model.ts ModelRig.setFace). 1.0's presets;
 * 0.x's blend shape groups by their preset names (a/i/u/e/o for the vowels, joy, sorrow, fun).
 */
async function readExpressions(gltf: GLTF, v1: Json, v0: Json) {
  const OLD: Record<string, Expression> = { a: 'aa', i: 'ih', u: 'ou', e: 'ee', o: 'oh', blink: 'blink', joy: 'happy', angry: 'angry', sorrow: 'sad', fun: 'relaxed', surprised: 'surprised' };
  const binds: [Expression, { node?: number; mesh?: number; index: number; weight: number }[]][] = [];
  if (Object.keys(v1).length) {
    for (const [name, def] of Object.entries(obj(obj(v1.expressions).preset))) {
      if (!(EXPRESSIONS as readonly string[]).includes(name)) continue;
      const list = ((obj(def).morphTargetBinds as unknown[] | undefined) ?? []).map((b) => ({ node: num(obj(b).node, -1), index: num(obj(b).index, -1), weight: num(obj(b).weight, 1) }));
      binds.push([name as Expression, list]);
    }
  } else {
    for (const g of (obj(v0.blendShapeMaster).blendShapeGroups as unknown[] | undefined) ?? []) {
      const name = OLD[String(obj(g).presetName ?? '').toLowerCase()];
      if (!name) continue;
      // (0.x: by mesh, its weights out of 100.)
      const list = ((obj(g).binds as unknown[] | undefined) ?? []).map((b) => ({ mesh: num(obj(b).mesh, -1), index: num(obj(b).index, -1), weight: num(obj(b).weight, 100) / 100 }));
      binds.push([name, list]);
    }
  }
  if (!binds.length) return;
  const parser = gltf.parser;
  // The meshes a node or a glTF mesh is drawn with (a mesh of several primitives: a group of them).
  const meshesOf = (o: THREE.Object3D) => {
    const out: THREE.Mesh[] = [];
    o.traverse((x) => { if ((x as THREE.Mesh).isMesh && (x as THREE.Mesh).morphTargetInfluences) out.push(x as THREE.Mesh); });
    return out;
  };
  const byMesh = new Map<number, THREE.Mesh[]>();
  gltf.scene.traverse((o) => {
    const m = parser.associations.get(o)?.meshes;
    if (m !== undefined) byMesh.set(m, [...(byMesh.get(m) ?? []), ...meshesOf(o)]);
  });
  for (const [name, list] of binds) {
    for (const b of list) {
      if (b.index < 0) continue;
      const targets = b.node !== undefined && b.node >= 0 ? meshesOf((await parser.getDependency('node', b.node)) as THREE.Object3D) : byMesh.get(b.mesh ?? -1) ?? [];
      for (const mesh of targets) {
        if (b.index >= (mesh.morphTargetInfluences?.length ?? 0)) continue;
        const faces = (mesh.userData.faces ??= {}) as Partial<Record<Expression, [number, number][]>>;
        (faces[name] ??= []).push([b.index, b.weight]);
      }
    }
  }
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
  // (0.x blends from its shift up to lerp(1, shift, toony) of the light's −1…1: the same band on ours.)
  const t0 = num(f._ShadeToony, 0.9), s0 = num(f._ShadeShift, 0);
  const soft = ((1 - t0) * (1 - s0)) / 2;
  return {
    color: vec('_Color', [1, 1, 1]), opacity: num(obj(v._Color)[3], 1), map: (await tex('_MainTex')) ?? m.map,
    shade: vec('_ShadeColor', [0.6, 0.6, 0.6]), shadeMap: await tex('_ShadeTexture'),
    shift: -s0 - soft, toony: 1 - soft,
    rim: vec('_RimColor', [0, 0, 0]), rimPower: num(f._RimFresnelPower, 5), rimLift: num(f._RimLift, 0),
    emissive: vec('_EmissionColor', [0, 0, 0]), emissiveMap: await tex('_EmissionMap'),
    alpha: blend === 1 ? 'mask' : blend >= 2 ? 'blend' : 'opaque', cutoff: num(f._Cutoff, 0.5),
    doubleSided: num(f._CullMode, 2) === 0,
    outline: num(f._OutlineWidthMode, 0) === 0 ? { width: 0, color: null } : { width: Math.min(3, num(f._OutlineWidth, 0) / 0.2), color: vec('_OutlineColor', [0, 0, 0]) },
  };
}
