// The sets' models and surfaces (#25), from Poly Haven (CC0), fitted to their budgets; trees grown
// by ez-tree (MIT: its shapes and leaves) with Poly Haven's bark, to their heights. Each model
// simplified to its triangles (meshoptimizer), its textures resized and made WebP, its geometry
// meshopt-compressed (three's decoder reads it); each surface's colour, normal and
// occlusion-roughness-metal maps resized and made WebP. Writes public/sets/ and its index.json
// (what each came to), lib/setassets.ts lists what. Downloads are kept in data/sets. Run with
// `npm run sets` (only what is new or changed is made again; `npm run sets -- --all` for all).
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, flatten, getBounds, join as joinMeshes, prune, quantize, reorder, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { BARK, MODELS, SURFACES, type ModelAsset, type SetIndex, type TreeAsset } from '../lib/setassets';

const CACHE = 'data/sets';
const OUT = 'public/sets';
const API = 'https://api.polyhaven.com';
const all = process.argv.includes('--all');

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

/** A file fetched once into the cache. */
async function download(url: string, to: string) {
  if (existsSync(to)) return to;
  await mkdir(dirname(to), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(`${to}.part`));
  await writeFile(to, await readFile(`${to}.part`));
  return to;
}

type Files = { gltf: Record<string, { gltf: { url: string; include: Record<string, { url: string }> } }> } & Record<string, Record<string, Record<string, { url: string }>>>;

/** A model's glTF (1K) and what it includes, fetched into the cache. */
async function fetchModel(ph: string) {
  const files = await json<Files>(`${API}/files/${ph}`);
  const g = files.gltf['1k'].gltf;
  const dir = join(CACHE, 'models', ph);
  const main = await download(g.url, join(dir, `${ph}.gltf`));
  for (const [path, f] of Object.entries(g.include)) await download(f.url, join(dir, path));
  return main;
}

const triangles = (doc: Document) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3, 0), 0);

const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

/** Poly Haven's 1K maps of a texture (colour, normal, occlusion-roughness-metal), fetched into the cache. */
async function fetchMaps(ph: string) {
  const files = await json<Files>(`${API}/files/${ph}`);
  const by = { color: files.Diffuse ?? files[Object.keys(files).filter((k) => /^col_/.test(k)).sort()[0]], normal: files.nor_gl, orm: files.arm };
  const out: Record<string, string> = {};
  for (const [kind, f] of Object.entries(by)) {
    if (!f?.['1k']?.jpg) throw new Error(`${ph}: no ${kind} map`);
    out[kind] = await download(f['1k'].jpg.url, join(CACHE, 'surfaces', ph, `${kind}.jpg`));
  }
  return out as { color: string; normal: string; orm: string };
}

/**
 * A tree grown from an ez-tree preset (its geometry; its own texture loading stood in for, Node
 * has none), to its height: its branches in Poly Haven's bark, its leaves in ez-tree's.
 */
async function growTree(a: TreeAsset) {
  (globalThis as { document?: unknown }).document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_: string) {}, style: {} }) };
  const { Tree } = await import('@dgreenheck/ez-tree');
  const t = new Tree();
  t.loadPreset(a.tree);
  const branches = t.branchesMesh.geometry as import('three').BufferGeometry;
  const leaves = t.leavesMesh.geometry as import('three').BufferGeometry;
  branches.computeBoundingBox();
  const scale = a.height / branches.boundingBox!.max.y;
  const o = t.options as { bark: { textureScale: { x: number; y: number } }; leaves: { type: string; tint: number } };
  const doc = new Document();
  const buffer = doc.createBuffer();
  const texture = async (file: string, mime: string) => doc.createTexture().setImage(new Uint8Array(await readFile(file))).setMimeType(mime);
  const bark = await fetchMaps(BARK);
  const orm = await texture(bark.orm, 'image/jpeg');
  const barkMat = doc.createMaterial('bark')
    .setBaseColorTexture(await texture(bark.color, 'image/jpeg')).setNormalTexture(await texture(bark.normal, 'image/jpeg'))
    .setOcclusionTexture(orm).setMetallicRoughnessTexture(orm).setRoughnessFactor(1).setMetallicFactor(1);
  const tint = o.leaves.tint;
  const leafMat = doc.createMaterial('leaves')
    .setBaseColorTexture(await texture(`node_modules/@dgreenheck/ez-tree/src/lib/assets/leaves/${o.leaves.type}_color.png`, 'image/png'))
    .setBaseColorFactor([((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255, 1])
    .setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true).setRoughnessFactor(0.8).setMetallicFactor(0);
  const prim = (g: import('three').BufferGeometry, mat: ReturnType<Document['createMaterial']>, uv: [number, number]) => {
    const acc = (array: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, type: 'VEC3' | 'VEC2' | 'SCALAR') => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const pos = Float32Array.from(g.attributes.position.array as Float32Array, (v) => v * scale);
    const uvs = Float32Array.from(g.attributes.uv.array as Float32Array, (v, i) => v * uv[i % 2]);
    return doc.createPrimitive()
      .setAttribute('POSITION', acc(pos, 'VEC3'))
      .setAttribute('NORMAL', acc(Float32Array.from(g.attributes.normal.array as Float32Array), 'VEC3'))
      .setAttribute('TEXCOORD_0', acc(uvs, 'VEC2'))
      .setIndices(acc(Uint32Array.from(g.index!.array as Uint16Array), 'SCALAR'))
      .setMaterial(mat);
  };
  // (The bark's texture repeated round and up the branches as ez-tree has it.)
  const mesh = doc.createMesh('tree').addPrimitive(prim(branches, barkMat, [o.bark.textureScale.x, 1 / o.bark.textureScale.y])).addPrimitive(prim(leaves, leafMat, [1, 1]));
  doc.createScene().addChild(doc.createNode('tree').setMesh(mesh));
  return doc;
}

/** A model fitted to its budget: simplified (allowing more error until it fits), textures resized, compressed. */
async function makeModel(id: string, a: ModelAsset | TreeAsset) {
  if ('tree' in a) {
    const doc = await growTree(a);
    if (triangles(doc) > a.tris) throw new Error(`${id}: ${triangles(doc)} triangles, over its ${a.tris}`);
    return finish(id, doc, a.tex);
  }
  const src = await fetchModel(a.ph);
  let doc: Document | null = null;
  // (Asked for fewer each time it comes out over, with more error allowed: some parts give way less.)
  let ratio = 1;
  for (const error of [0.001, 0.004, 0.01, 0.02, 0.04, 0.08, 0.15, 0.25]) {
    doc = await io.read(src);
    doc.setLogger(new Logger(Logger.Verbosity.WARN));
    await doc.transform(dedup(), flatten(), joinMeshes(), weld());
    const before = triangles(doc);
    if (before <= a.tris) break;
    ratio = Math.min(ratio, a.tris / before);
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error }));
    const got = triangles(doc);
    if (got <= a.tris) break;
    ratio *= (a.tris / got) * 0.95;
  }
  if (triangles(doc!) > a.tris) throw new Error(`${id}: ${triangles(doc!)} triangles, over its ${a.tris}`);
  // (Its real size, as Poly Haven gives it (mm): a file made at another scale brought to it.)
  const real = (await json<{ dimensions?: number[] }>(`${API}/info/${a.ph}`)).dimensions;
  const scene = doc!.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  const made = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const want = real ? Math.max(...real) / 1000 : made;
  if (Math.abs(want / made - 1) > 0.25) {
    const k = want / made;
    const holder = doc!.createNode('scaled').setScale([k, k, k]);
    for (const n of scene.listChildren()) { scene.removeChild(n); holder.addChild(n); }
    scene.addChild(holder);
    console.log(`${id}: made ${made.toFixed(2)} m across, really ${want.toFixed(2)} m: scaled ×${k.toFixed(3)}`);
  }
  return finish(id, doc!, a.tex);
}

/** A model's textures resized and made WebP, its geometry compressed; written, and what it came to. */
async function finish(id: string, doc: Document, tex: number) {
  await doc.transform(
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 82 }),
    reorder({ encoder: MeshoptEncoder }),
    quantize(),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const file = `models/${id}.glb`;
  const bytes = await io.writeBinary(doc);
  await mkdir(join(OUT, 'models'), { recursive: true });
  await writeFile(join(OUT, file), bytes);
  const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { file, tris: triangles(doc), bytes: bytes.byteLength, size: [r(max[0] - min[0]), r(max[1] - min[1]), r(max[2] - min[2])] as [number, number, number] };
}

/** A surface's maps (1K JPEGs) resized and made WebP; its tile's size from the texture's real one. */
async function makeSurface(id: string, a: { ph: string; tex: number }) {
  const [maps, info] = await Promise.all([fetchMaps(a.ph), json<{ dimensions?: number[] }>(`${API}/info/${a.ph}`)]);
  await mkdir(join(OUT, 'surfaces'), { recursive: true });
  let bytes = 0;
  const out: Record<string, string> = {};
  for (const [kind, src] of Object.entries(maps)) {
    const file = `surfaces/${id}-${kind}.webp`;
    await sharp(src).resize(a.tex, a.tex, { fit: 'inside' }).webp({ quality: kind === 'color' ? 82 : 88 }).toFile(join(OUT, file));
    bytes += (await stat(join(OUT, file))).size;
    out[kind] = file;
  }
  const tile = Math.round(((info.dimensions?.[0] ?? 2000) / 1000) * 100) / 100;
  return { color: out.color, normal: out.normal, orm: out.orm, bytes, tile };
}

async function main() {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  const indexFile = join(OUT, 'index.json');
  const before: SetIndex & { made?: Record<string, string> } = existsSync(indexFile) ? JSON.parse(await readFile(indexFile, 'utf8')) : { models: {}, surfaces: {} };
  const made = before.made ?? {};
  const index: SetIndex & { made: Record<string, string> } = { models: {}, surfaces: {}, made: {} };
  // (What each was made from: made again only if that changed.)
  const fresh = (key: string, recipe: unknown, file?: string) => !all && made[key] === JSON.stringify(recipe) && !!file && existsSync(join(OUT, file));
  const failed: string[] = [];
  for (const [id, a] of Object.entries(MODELS)) {
    const key = `model:${id}`;
    const was = before.models[id];
    try {
      index.models[id] = fresh(key, a, was?.file) ? was : await makeModel(id, a);
    } catch (e) {
      // (Kept as it was, if it was: the others made all the same, what failed said at the end.)
      failed.push(String((e as Error).message));
      if (!was) continue;
      index.models[id] = was;
      continue;
    }
    index.made[key] = JSON.stringify(a);
    const m = index.models[id];
    console.log(`${id.padEnd(16)} ${String(m.tris).padStart(7)} tris ${(m.bytes / 1024).toFixed(0).padStart(6)} KB  ${m.size.join(' × ')} m`);
  }
  for (const [id, a] of Object.entries(SURFACES)) {
    const key = `surface:${id}`;
    const was = before.surfaces[id];
    index.surfaces[id] = fresh(key, a, was?.color) ? was : await makeSurface(id, a);
    index.made[key] = JSON.stringify(a);
    const s = index.surfaces[id];
    console.log(`${id.padEnd(16)} surface ${(s.bytes / 1024).toFixed(0).padStart(6)} KB  tile ${s.tile} m`);
  }
  await writeFile(indexFile, `${JSON.stringify(index, null, 1)}\n`);
  // (What is no longer listed goes.)
  const kept = new Set([...Object.values(index.models).map((m) => m.file), ...Object.values(index.surfaces).flatMap((x) => [x.color, x.normal, x.orm])]);
  for (const dir of ['models', 'surfaces']) {
    for (const f of await readdir(join(OUT, dir)).catch(() => [] as string[])) if (!kept.has(`${dir}/${f}`)) await rm(join(OUT, dir, f));
  }
  const total = [...kept].length;
  // Where each came from, and on what terms.
  const ph = (id: string, kind: 'a') => `https://polyhaven.com/${kind}/${id}`;
  const credits = [
    'The sets\' models, surfaces and bark (public/sets) are from Poly Haven (https://polyhaven.com), CC0 1.0 (public domain):',
    ...Object.entries(MODELS).flatMap(([id, x]) => ('ph' in x ? [`  ${id}: ${ph(x.ph, 'a')}`] : [])),
    ...Object.entries(SURFACES).map(([id, x]) => `  ${id}: ${ph(x.ph, 'a')}`),
    `  bark: ${ph(BARK, 'a')}`,
    '',
    'The trees (' + Object.entries(MODELS).filter(([, x]) => 'tree' in x).map(([id]) => id).join(', ') + ') are grown by ez-tree (https://github.com/dgreenheck/ez-tree), whose leaves they use:',
    '',
    (await readFile('node_modules/@dgreenheck/ez-tree/LICENSE', 'utf8')).trim(),
    '',
  ];
  await writeFile(join(OUT, 'CREDITS.txt'), credits.join('\n'));
  if (failed.length) { console.error(`Not made:\n  ${failed.join('\n  ')}`); process.exitCode = 1; }
  console.log(`${total} files, ${(Object.values(index.models).reduce((n, m) => n + m.bytes, 0) / 1048576).toFixed(1)} MB of models, ${(Object.values(index.surfaces).reduce((n, x) => n + x.bytes, 0) / 1048576).toFixed(1)} MB of surfaces`);
}

main().catch((e) => { console.error(e); process.exit(1); });
