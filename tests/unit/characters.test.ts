import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addFigure, applyMotion, setFigureModel } from '@/lib/actions';
import { BUILT_IN_CHARACTERS, characterFile } from '@/lib/characters';
import { parseScene } from '@/lib/doc';
import { Fitted, mapBones, missingBones, modelInfo, parseModel } from '@/lib/model';
import { legsOf } from '@/lib/locomotion';
import { checkMotion } from '@/lib/qa';
import { fresh } from '../fixtures/scenes';

/** A GLB as the test can read it (Node has no image decoding): its textures left out. */
function withoutTextures(file: Buffer): ArrayBuffer {
  const length = file.readUInt32LE(12);
  const gltf = JSON.parse(file.subarray(20, 20 + length).toString());
  for (const m of gltf.materials ?? []) {
    delete m.pbrMetallicRoughness?.baseColorTexture;
    delete m.emissiveTexture;
  }
  delete gltf.images;
  delete gltf.textures;
  delete gltf.samplers;
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const rest = file.subarray(20 + length);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + json.length + rest.length, 8);
  head.writeUInt32LE(json.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, json, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

describe('built-in characters', () => {
  it('ship small, and their skeletons are found without help, as listed', async () => {
    for (const c of BUILT_IN_CHARACTERS) {
      const path = `public${characterFile(c.id)}`;
      // (Drawn in our styles only: small. One in its own look, its textures (Aoi, in Toon): larger, fetched when first drawn.)
      const file = readFileSync(path);
      const textured = !!JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString()).images?.length;
      expect(statSync(path).size, c.name).toBeLessThan((textured ? 16 : 2) * 1024 * 1024);
      const root = await parseModel('glb', withoutTextures(readFileSync(path)));
      const map = mapBones(root);
      expect(missingBones(map), c.name).toEqual([]);
      expect(map, c.name).toEqual(c.bones);
      // Drawn at its own size: the mannequin under it, at the body listed, has its hips where it has.
      const legs = legsOf(c.body!);
      expect((legs.rootY - legs.ankleY) / new Fitted(root, c.bones).hipHeight, c.name).toBeCloseTo(1, 1);
    }
  }, 60_000);

  it('are drawn by id (a scene keeps it), the mannequin under them fitted, and dance together cleanly', () => {
    const { store, a } = fresh();
    addFigure(store, [1, 0, 0]);
    const b = store.getState().activeFigure!;
    const [woman, man] = BUILT_IN_CHARACTERS;
    setFigureModel(store, a, man.id);
    setFigureModel(store, b, woman.id);
    expect(modelInfo(man.id)?.name).toBe(man.name);
    const [fa, fb] = store.scene.figures;
    expect(fa.model).toBe(man.id);
    expect(fa.body).not.toEqual(fb.body);
    expect(parseScene(JSON.parse(JSON.stringify(store.scene))).figures.map((f) => f.model)).toEqual([man.id, woman.id]);
    // Each with its own body under it: a man's, a woman's; a child's is a child's height.
    expect(fa.body).toEqual(man.body);
    expect(BUILT_IN_CHARACTERS.find((c) => c.name === 'Child')!.body!.height).toBeLessThan(1.4);
    store.setTime(0);
    expect(applyMotion(store, a, 'waltz-turn', [b])).toBe(true);
    expect(checkMotion(store.scene).filter((i) => i.kind !== 'camera' && i.kind !== 'hidden').map((i) => i.message)).toEqual([]);
  }, 300_000);
});
