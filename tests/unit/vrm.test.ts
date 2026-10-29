import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadModelFile } from '@/lib/assetstore';
import { Ink } from '@/lib/ink';
import { MissingBones, ModelRig, importModel, mapBones, missingBones, parseModel } from '@/lib/model';
import { ownLooks, paintedLook, type ToonLook } from '@/lib/toon';
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
    // (Found by its humanoid; kept named as our skeleton's.)
    expect(info.bones.hips).toBe('hips');
    expect(info.credit).toBe('by Ueda · personal use · credit required · not to be shared');
  });

  it('asks only for the bones its humanoid leaves out (the rest found by it)', async () => {
    const gltf = JSON.parse(vrmGltf(1));
    delete gltf.extensions.VRMC_vrm.humanoid.humanBones.neck;
    const err = await importModel('NoNeck.vrm', bytes(JSON.stringify(gltf))).catch((e) => e);
    expect(err).toBeInstanceOf(MissingBones);
    expect(err.missing).toEqual(['neck']);
  });

  it('never takes one bone for two (a bone found by where it sits is not one its humanoid has)', async () => {
    const gltf = JSON.parse(vrmGltf(1, true));
    const human = gltf.extensions.VRMC_vrm.humanoid.humanBones;
    // (A rig without shoulders: its humanoid's upper arm the bone named as a shoulder.)
    human.leftUpperArm = human.leftShoulder;
    delete human.leftShoulder;
    const info = await importModel('NoShoulder.vrm', bytes(JSON.stringify(gltf))).catch((e) => ({ bones: (e as MissingBones).found }));
    const names = Object.values(info.bones);
    expect(new Set(names).size).toBe(names.length);
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
    expect(info.bones.leftThumbMetacarpal).toBe('leftThumbMetacarpal');
    expect(info.credit).toBe('by Ueda · personal use');
    const [look] = looksOf(await parseModel('glb', bytes(vrmGltf(0))));
    // (0.x blends from 0.1 up to lerp(1, 0.1, 0.8) = 0.28 of the light's −1…1: the same band on ours.)
    expect(look.toony).toBeCloseTo(0.91, 6);
    expect(look.shift).toBeCloseTo(-0.19, 6);
    const soft = 1 - look.toony;
    expect([-look.shift - soft, -look.shift + soft].map((v) => +v.toFixed(6))).toEqual([0.1, 0.28]);
    // (Its colours as sRGB: the shade's red 0.6 is 0.319 in linear.)
    expect(look.shade.r).toBeCloseTo(new THREE.Color().setRGB(0.6, 0, 0, THREE.SRGBColorSpace).r, 6);
    expect(look.outline.width).toBeCloseTo(1.5, 6);
  });

  it('draws it in its own look in the Toon style (its outline its own), as any character in the others', async () => {
    const info = await importModel('Aoi.vrm', bytes(vrmGltf(1)));
    const root = await parseModel('glb', (await loadModelFile(info.id))!);
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
    expect(body.material).toBe(ink.materialsFor('line').skin);
    expect(hull.material).toBe(ink.outline);
  });
});

describe('outlines of a look of its own', () => {
  it('are none where its surface is cut out, and follow the style’s width', () => {
    const ink = new Ink();
    const map = new THREE.Texture();
    const plain = ink.outlineAs(1.5, null);
    const cut = ink.outlineAs(1.5, null, { map, cutoff: 0.4 });
    expect(plain.defines?.CUTOUT).toBeUndefined();
    expect(cut.defines?.CUTOUT).toBe('');
    expect(cut.uniforms.map.value).toBe(map);
    expect(cut.uniforms.cutoff.value).toBe(0.4);
    expect(ink.outlineAs(1.5, null, { map, cutoff: 0.4 })).toBe(cut);
    ink.setThickness(2);
    expect(cut.uniforms.thickness.value).toBeCloseTo(ink.uniforms.thickness.value * 1.5, 6);
  });
});

describe('characters painted with textures (not VRM avatars)', () => {
  it('are drawn in their own texture, shaded a darker of it, cut out and two-sided as their material is', () => {
    const map = new THREE.Texture();
    const look = paintedLook(new THREE.MeshStandardMaterial({ color: '#ffcc99', map, alphaTest: 0.4, side: THREE.DoubleSide }));
    expect(look.map).toBe(map);
    expect(look.shadeMap).toBe(map);
    expect(look.shade.r).toBeLessThan(look.color.r * 0.7);
    expect(look).toMatchObject({ alpha: 'mask', cutoff: 0.4, doubleSided: true, outline: { width: 1, color: null } });
    expect(paintedLook(new THREE.MeshStandardMaterial({ transparent: true })).alpha).toBe('blend');
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
