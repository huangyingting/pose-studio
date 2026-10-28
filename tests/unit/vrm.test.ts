import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Ink } from '@/lib/ink';
import { ModelRig, importModel, mapBones, missingBones, parseModel } from '@/lib/model';
import { ownLooks, type ToonLook } from '@/lib/toon';
import { vrmGltf } from '../fixtures/gltf';

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

/** The looks the meshes of a model read from a file have of their own. */
function looksOf(root: THREE.Object3D) {
  const out: ToonLook[] = [];
  root.traverse((o) => { const l = ownLooks.get(o); if (l) out.push(l); });
  return out;
}

describe('VRM avatars made our own (#15)', () => {
  it('imports a VRM 1.0 by its humanoid (its bone names say nothing), with its author and terms', async () => {
    const root = await parseModel('glb', bytes(vrmGltf(1)));
    // (By name alone, nothing would be found.)
    expect(missingBones(mapBones(root)).length).toBeGreaterThan(0);
    const info = await importModel('Aoi.vrm', bytes(vrmGltf(1)));
    expect(missingBones(info.bones)).toEqual([]);
    expect(info.bones.hips).toMatch(/^Bone_/);
    expect(info.credit).toBe('by Ueda · personal use · credit required · not to be shared');
  });

  it('reads each material’s MToon settings as its look: shade, its edge, rim, outline', async () => {
    const [look] = looksOf(await parseModel('glb', bytes(vrmGltf(1))));
    expect(look.shade.toArray().map((v) => +v.toFixed(3))).toEqual([0.6, 0.3, 0.4]);
    expect(look.shift).toBeCloseTo(-0.2, 6);
    expect(look.toony).toBeCloseTo(0.95, 6);
    expect(look.rim.toArray().map((v) => +v.toFixed(3))).toEqual([0.2, 0.2, 0.3]);
    expect(look.outline.width).toBeCloseTo(1.5, 6);
    expect(look.outline.color!.toArray().map((v) => +v.toFixed(3))).toEqual([0.1, 0.05, 0.08]);
    expect(look.color.toArray().map((v) => +v.toFixed(3))).toEqual([1, 0.9, 0.85]);
  });

  it('reads a VRM 0.x too: its older thumb names, its MToon properties on its own scale', async () => {
    const info = await importModel('Old.vrm', bytes(vrmGltf(0)));
    expect(missingBones(info.bones)).toEqual([]);
    expect(info.bones.leftThumbMetacarpal).toMatch(/^Bone_/);
    expect(info.credit).toBe('by Ueda · personal use');
    const [look] = looksOf(await parseModel('glb', bytes(vrmGltf(0))));
    // (Its edge at shift + half its softness on the half-Lambert scale: 0.8 − 2 × 0.1 on ours.)
    expect(look.toony).toBeCloseTo(0.8, 6);
    expect(look.shift).toBeCloseTo(0.6, 6);
    expect(look.outline.width).toBeCloseTo(1.5, 6);
  });

  it('draws it in its own look in the Toon style (its outline its own), as any character in the others', async () => {
    const root = await parseModel('glb', bytes(vrmGltf(1)));
    const info = await importModel('Aoi.vrm', bytes(vrmGltf(1)));
    const ink = new Ink();
    const model = new ModelRig(root, info, ink);
    const meshes: THREE.Mesh[] = [];
    model.object.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o.parent as THREE.Mesh)?.isMesh) meshes.push(o as THREE.Mesh); });
    const body = meshes[0];
    const hull = body.children[0] as THREE.Mesh;
    model.setLook('toon', null);
    const mat = body.material as THREE.ShaderMaterial;
    expect(mat.uniforms.shade.value.toArray().map((v: number) => +v.toFixed(3))).toEqual([0.6, 0.3, 0.4]);
    expect(hull.material).not.toBe(ink.outline);
    expect(hull.visible).toBe(true);
    model.setLook('line', null);
    expect(body.material).toBe(ink.materialsFor('line').body);
    expect(hull.material).toBe(ink.outline);
  });
});

describe('Aoi, a VRM avatar made one of ours', () => {
  it('has her bones named as our skeleton’s, her MToon look and her licence kept, and is credited', async () => {
    const { readFileSync } = await import('node:fs');
    const { BUILT_IN_CHARACTERS } = await import('@/lib/characters');
    const file = readFileSync('public/characters/aoi.glb');
    const gltf = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
    for (const [bone, ref] of Object.entries(gltf.extensions.VRMC_vrm.humanoid.humanBones as Record<string, { node: number }>)) expect(gltf.nodes[ref.node].name).toBe(bone);
    expect(gltf.extensionsUsed).toContain('VRMC_materials_mtoon');
    expect(gltf.extensions.VRMC_springBone).toBeUndefined();
    expect(gltf.extensions.VRMC_vrm.meta.authors).toEqual(['Ueda']);
    const aoi = BUILT_IN_CHARACTERS.find((c) => c.name === 'Aoi')!;
    expect(aoi.credit).toMatch(/^by Ueda/);
    expect(readFileSync('public/characters/CREDITS.txt', 'utf8')).toMatch(/Aoi.*by Ueda/);
  });
});
