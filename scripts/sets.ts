// The sets' models and surfaces (#25), from Poly Haven (CC0), fitted to their budgets; trees grown
// by ez-tree (MIT: its shapes and leaves) with Poly Haven's bark, to their heights. Each model
// simplified to its triangles (meshoptimizer), its textures resized and made WebP, its geometry
// meshopt-compressed (three's decoder reads it); each surface's colour, normal and
// occlusion-roughness-metal maps resized and made WebP. Writes public/sets/ and its index.json
// (what each came to), lib/setassets.ts lists what. Downloads are kept in data/sets. Run with
// `npm run sets` (only what is new or changed is made again; `npm run sets -- --all` for all).
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Document, Logger, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, type Transmission } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, flatten, getBounds, join as joinMeshes, joinPrimitives, metalRough, prune, quantize, reorder, simplify, textureCompress, transformPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { BARK, MODELS, SCENES, SKIES, SURFACES, VIEWS, type ModelAsset, type SceneAsset, type SetIndex, type SurfaceAsset, type TreeAsset } from '../lib/setassets';

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

const triangles = (doc: Document) => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getMode() === Primitive.Mode.TRIANGLES ? (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3 : 0), 0), 0);

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

/**
 * A ready-made scene's file from Sketchfab (#27), fetched once into the cache: its GLB, or its glTF
 * (a zip, unpacked). Fetched as the site gives it to a signed-in visitor, with the session kept in
 * ~/.sketchfab_token (cookies exported from a browser: never printed, never in the repo).
 */
async function fetchScene(sf: string): Promise<string> {
  const dir = join(CACHE, 'sketchfab');
  await mkdir(dir, { recursive: true });
  const have = (await readdir(dir)).find((f) => f.startsWith(`${sf}-`) && /\.(glb|zip)$/.test(f));
  let file = have ? join(dir, have) : null;
  if (!file) {
    const { chromium } = await import('playwright');
    const raw = JSON.parse(await readFile(join(process.env.HOME ?? '', '.sketchfab_token'), 'utf8')) as { name: string; value: string; domain: string; path?: string; expirationDate?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string }[];
    const same: Record<string, 'None' | 'Lax' | 'Strict'> = { no_restriction: 'None', lax: 'Lax', strict: 'Strict' };
    const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext({ acceptDownloads: true });
      await ctx.addCookies(raw.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path || '/', expires: Math.round(c.expirationDate ?? -1), httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite: same[c.sameSite ?? ''] ?? 'Lax' })));
      const page = await ctx.newPage();
      await page.goto(`https://sketchfab.com/3d-models/${sf}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.getByRole('button', { name: /download 3d model/i }).first().click({ timeout: 60_000 });
      const buttons = page.getByRole('button', { name: /^download$/i });
      await buttons.first().waitFor({ timeout: 30_000 });
      // (Each button's row says its kind of file: the GLB, else the glTF.)
      const kinds = await buttons.evaluateAll((els) => els.map((el) => {
        let e = el.parentElement;
        for (let k = 0; e && k < 6; k++, e = e.parentElement) if (/\.(glb|gltf|fbx|usdz|zip|obj|blend)\b/i.test(e.innerText) && e.querySelectorAll('button').length === 1) return e.innerText;
        return '';
      }));
      const pick = [/\.glb\b/i, /\.gltf\b/i].map((re) => kinds.findIndex((t) => re.test(t))).find((i) => i >= 0);
      if (pick === undefined) throw new Error(`${sf}: no GLB or glTF to download`);
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 600_000 }), buttons.nth(pick).click()]);
      file = join(dir, `${sf}-${download.suggestedFilename()}`);
      await download.saveAs(file);
    } finally {
      await browser.close();
    }
  }
  if (file.endsWith('.glb')) return file;
  const out = join(dir, sf);
  if (!existsSync(out)) execFileSync('unzip', ['-o', '-q', file, '-d', out]);
  const find = async (d: string): Promise<string | null> => {
    for (const f of await readdir(d, { withFileTypes: true })) {
      if (f.isFile() && /\.(gltf|glb)$/.test(f.name)) return join(d, f.name);
      if (f.isDirectory()) { const x = await find(join(d, f.name)); if (x) return x; }
    }
    return null;
  };
  const gltf = await find(out);
  if (!gltf) throw new Error(`${sf}: no glTF in its download`);
  return gltf;
}

/**
 * Where a scene's floor is and the middle of it (after its scale and turn): the level with the
 * most floor facing up (in 5 cm bands), and the middle of what lies at that level — the acting
 * area round the origin, its floor at 0.
 */
function floorOf(doc: Document): { y: number; x: number; z: number } {
  const bands = new Map<number, { area: number; x: number; z: number; y: number }>();
  const [a, b, c] = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const at = (m: number[], pos: { getElement(i: number, t: number[]): number[] }, i: number, out: Float64Array) => {
    const p = pos.getElement(i, [0, 0, 0]);
    for (let r = 0; r < 3; r++) out[r] = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
  };
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix() as unknown as number[];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      for (let t = 0; t + 2 < n; t += 3) {
        const [i0, i1, i2] = idx ? [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)] : [t, t + 1, t + 2];
        at(m, pos, i0, a); at(m, pos, i1, b); at(m, pos, i2, c);
        const [ux, uy, uz, vx, vy, vz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        const len = Math.hypot(nx, ny, nz);
        // (Facing up: a floor, a seat, a table; 2 × the triangle's area.)
        if (len < 1e-9 || ny / len < 0.95) continue;
        const y = (a[1] + b[1] + c[1]) / 3;
        const key = Math.round(y / 0.05);
        const band = bands.get(key) ?? { area: 0, x: 0, z: 0, y: 0 };
        band.area += len;
        band.x += len * (a[0] + b[0] + c[0]) / 3;
        band.z += len * (a[2] + b[2] + c[2]) / 3;
        band.y += len * y;
        bands.set(key, band);
      }
    }
  }
  // (The lowest of the big ones: a roof or a ceiling's top faces up too, over the floor.)
  const most = Math.max(0, ...[...bands.values()].map((x) => x.area));
  const top = [...bands.values()].filter((x) => x.area >= 0.35 * most).reduce((p, q) => (q.y / q.area < p.y / p.area ? q : p), { area: 1, x: 0, z: 0, y: Infinity });
  return Number.isFinite(top.y) ? { y: top.y / top.area, x: top.x / top.area, z: top.z / top.area } : { y: 0, x: 0, z: 0 };
}

/**
 * A scene cut into pieces where it stands (#27), so that the view cuts away only what is in its way
 * (lib/sets.ts: a piece the eye is in, or one between it and what it looks at), not the whole
 * scene: its floor, its ceiling and the rest, each in cells of the ground (a few dozen of them);
 * one piece per cell and material.
 */
function cutUp(doc: Document) {
  const sc = doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(sc);
  const cell = Math.min(12, Math.max(3, Math.sqrt(((max[0] - min[0]) * (max[2] - min[2])) / 40)));
  const pieces = new Map<string, Primitive[]>();
  const [a, b, c] = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  for (const node of sc.listChildren()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix() as unknown as number[];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')!;
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      const at = (i: number, out: Float64Array) => {
        const p = pos.getElement(i, [0, 0, 0]);
        for (let r = 0; r < 3; r++) out[r] = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
      };
      const into = new Map<string, number[]>();
      for (let t = 0; t + 2 < n; t += 3) {
        const v = idx ? [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)] : [t, t + 1, t + 2];
        at(v[0], a); at(v[1], b); at(v[2], c);
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        const len = Math.hypot((b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny, (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
        const y = (a[1] + b[1] + c[1]) / 3;
        const flat = len > 1e-12 && Math.abs(ny) / len > 0.95;
        const part = flat && y < 0.25 ? 'floor' : flat && y > 2.2 ? 'ceiling' : 'rest';
        const key = `${part} ${Math.floor((a[0] + b[0] + c[0]) / 3 / cell)} ${Math.floor((a[2] + b[2] + c[2]) / 3 / cell)}`;
        let list = into.get(key);
        if (!list) into.set(key, (list = []));
        list.push(...v);
      }
      for (const [key, list] of into) {
        const part = prim.clone().setIndices(doc.createAccessor().setType('SCALAR').setArray(pos.getCount() > 65535 ? new Uint32Array(list) : new Uint16Array(list)));
        compactPrimitive(part);
        transformPrimitive(part, m as unknown as Parameters<typeof transformPrimitive>[1]);
        pieces.set(key, [...(pieces.get(key) ?? []), part]);
      }
    }
    node.dispose();
  }
  for (const [key, prims] of pieces) {
    const mesh = doc.createMesh(key);
    // (One per material: those of the same (and with the same attributes) joined.)
    const alike = Map.groupBy(prims, (p) => `${doc.getRoot().listMaterials().indexOf(p.getMaterial()!)} ${p.listSemantics().sort()}`);
    for (const same of alike.values()) mesh.addPrimitive(same.length > 1 ? joinPrimitives(same) : same[0]);
    for (const p of prims) if (!mesh.listPrimitives().includes(p)) p.dispose();
    sc.addChild(doc.createNode(key).setMesh(mesh));
  }
}

/** A ready-made scene made into a set's (#27): fitted to the stage, simplified to its budget, its textures resized, compressed. */
async function makeScene(id: string, a: SceneAsset) {
  const src = await fetchScene(a.sf);
  let doc: Document | null = null;
  let ratio = 1;
  for (const error of [0.001, 0.004, 0.01, 0.02, 0.04, 0.08]) {
    doc = await io.read(src);
    doc.setLogger(new Logger(Logger.Verbosity.WARN));
    // (Fitted to the stage first: scaled, turned, moved.)
    const sc = doc.getRoot().listScenes()[0];
    const k = a.fit?.scale ?? 1;
    const yaw = ((a.fit?.yaw ?? 0) * Math.PI) / 180;
    const holder = doc.createNode('fitted').setScale([k, k, k]).setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
    for (const n of sc.listChildren()) { sc.removeChild(n); holder.addChild(n); }
    sc.addChild(holder);
    // (Only its faces: a scene's lines and points are its author's guides.)
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) if (p.getMode() !== Primitive.Mode.TRIANGLES) p.dispose();
    // (Moved so that its floor is at 0 and its middle at the origin, then as asked.)
    const f = floorOf(doc);
    const at = a.fit?.at ?? [0, 0, 0];
    holder.setTranslation([at[0] - f.x, at[1] - f.y, at[2] - f.z]);
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
  // (Its materials as the rest are: metal and roughness (not the old specular-glossiness), glass
  // see-through as a blend, not as transmission, which draws the whole scene again behind it.)
  await doc!.transform(metalRough());
  for (const m of doc!.getRoot().listMaterials()) {
    const glass = m.getExtension<Transmission>('KHR_materials_transmission');
    if (!glass) continue;
    const [r, g, b] = m.getBaseColorFactor();
    m.setBaseColorFactor([r, g, b, Math.min(m.getBaseColorFactor()[3], 1 - 0.75 * glass.getTransmissionFactor())]).setAlphaMode('BLEND');
    m.setExtension('KHR_materials_transmission', null);
  }
  // (A blend only where it is see-through: a floor or a wall blended for nothing is drawn out of
  // order, the ground showing through it; one with holes in it cut out.)
  for (const m of doc!.getRoot().listMaterials()) {
    const image = m.getBaseColorTexture()?.getImage();
    if (m.getAlphaMode() !== 'BLEND' || !image || m.getBaseColorFactor()[3] < 0.99) continue;
    const alpha = await sharp(image).ensureAlpha().extractChannel(3).raw().toBuffer();
    let [clear, between] = [0, 0];
    for (const v of alpha) if (v < 10) clear++; else if (v < 245) between++;
    if (between > 0.05 * alpha.length) continue;
    m.setAlphaMode(clear ? 'MASK' : 'OPAQUE');
  }
  const walls = wallsOf(doc!);
  cutUp(doc!);
  return { ...(await finish(`scenes/${id}.glb`, doc!, a.tex)), walls };
}

/**
 * Where a figure can stand on what an asset is made of (#29: a table's top, a bench's seat, steps, a
 * dais, a stage): its faces turned up, from a hand's breadth over its floor to TOP_MAX, in 10 cm cells
 * joined into boxes on the floor, [x0, z0, x1, z1, top] (m). A model's in its own frame (its
 * bottom's middle at the origin, as the app places it); a scene's where it stands.
 */
/** The highest a figure climbs onto (a counter, not a bookcase's top). */
const TOP_MAX = 1.2;
async function topsOfFile(file: string, model: boolean): Promise<number[][]> {
  const doc = await io.read(join(OUT, file));
  const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
  const [ox, oy, oz] = model ? [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2] : [0, 0, 0];
  const cell = 0.1;
  const [gx, gz] = [Math.floor((min[0] - ox) / cell) - 1, Math.floor((min[2] - oz) / cell) - 1];
  const [W, D] = [Math.ceil((max[0] - min[0]) / cell) + 3, Math.ceil((max[2] - min[2]) / cell) + 3];
  const top = new Float32Array(W * D);
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix() as unknown as number[];
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES || prim.getMaterial()?.getAlphaMode() === 'BLEND') continue;
      const pos = prim.getAttribute('POSITION')!;
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      const at = (i: number) => { const p = pos.getElement(i, [0, 0, 0]); return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] - [ox, oy, oz][r]); };
      for (let t = 0; t + 2 < n; t += 3) {
        const [a, b, c] = (idx ? [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)] : [t, t + 1, t + 2]).map(at);
        if (Math.max(a[1], b[1], c[1]) < 0.05 || Math.min(a[1], b[1], c[1]) > TOP_MAX) continue;
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const ny = u[2] * v[0] - u[0] * v[2];
        const len = Math.hypot(u[1] * v[2] - u[2] * v[1], ny, u[0] * v[1] - u[1] * v[0]);
        if (len < 1e-9 || ny / len < 0.7) continue;
        const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
        if (Math.abs(d) < 1e-12) continue;
        for (let k = Math.floor(Math.min(a[2], b[2], c[2]) / cell); k <= Math.ceil(Math.max(a[2], b[2], c[2]) / cell); k++) {
          for (let i = Math.floor(Math.min(a[0], b[0], c[0]) / cell); i <= Math.ceil(Math.max(a[0], b[0], c[0]) / cell); i++) {
            const [px, pz] = [(i + 0.5) * cell, (k + 0.5) * cell];
            const w1 = ((b[0] - px) * (c[2] - pz) - (c[0] - px) * (b[2] - pz)) / d, w2 = ((c[0] - px) * (a[2] - pz) - (a[0] - px) * (c[2] - pz)) / d, w3 = 1 - w1 - w2;
            if (w1 < 0 || w2 < 0 || w3 < 0) continue;
            const h = w1 * a[1] + w2 * b[1] + w3 * c[1];
            const [ci, ck] = [i - gx, k - gz];
            if (h < 0.05 || h > TOP_MAX || ci < 0 || ck < 0 || ci >= W || ck >= D) continue;
            if (h > top[ck * W + ci]) top[ck * W + ci] = h;
          }
        }
      }
    }
  }
  // Cells of one height (to 2 cm); a patch of them too small for a foot (under 5 cells, 0.05 m²) left out.
  const lv = Int32Array.from(top, (v) => (v > 0 ? Math.round(v / 0.02) : 0));
  const seen = new Uint8Array(W * D);
  for (let c0 = 0; c0 < W * D; c0++) {
    if (!lv[c0] || seen[c0]) continue;
    const patch = [c0];
    seen[c0] = 1;
    for (let q = 0; q < patch.length; q++) {
      const c = patch[q];
      const [ci, ck] = [c % W, Math.floor(c / W)];
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const [ni, nk] = [ci + di, ck + dk];
        const nc = nk * W + ni;
        if (ni < 0 || nk < 0 || ni >= W || nk >= D || seen[nc] || lv[nc] !== lv[c0]) continue;
        seen[nc] = 1;
        patch.push(nc);
      }
    }
    if (patch.length < 5) for (const c of patch) lv[c] = 0;
  }
  // Joined along x, then rows alike along z.
  const open = new Map<string, number[]>();
  const boxes: number[][] = [];
  for (let k = 0; k < D; k++) {
    for (let i = 0; i < W;) {
      const h = lv[k * W + i];
      if (!h) { i++; continue; }
      let j = i;
      while (j + 1 < W && lv[k * W + j + 1] === h) j++;
      const key = `${i} ${j} ${h}`;
      const run = open.get(key);
      if (run && run[3] === k) run[3] = k + 1;
      else { const b = [i, k, j + 1, k + 1, h]; open.set(key, b); boxes.push(b); }
      i = j + 1;
    }
  }
  const r = (v: number) => Math.round(v * 100) / 100;
  return boxes
    .map(([i0, k0, i1, k1, h]) => [r((i0 + gx) * cell), r((k0 + gz) * cell), r((i1 + gx) * cell), r((k1 + gz) * cell), r(h * 0.02)]);
}

/**
 * A scene's walls (#27), what stops a camera as a built set's do: where upright faces stand from
 * the floor to over a person's head (a wall, a pillar, a tall cupboard; not a table, a chair, a
 * window's opening, glass), in 25 cm cells of the floor joined into boxes: [x0, z0, x1, z1, top].
 */
function wallsOf(doc: Document): number[][] {
  const cell = 0.25;
  const bins = 9; // (0 to 2.25 m, a quarter metre each)
  const seen = new Map<string, { bins: number; top: number }>();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix() as unknown as number[];
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()?.getAlphaMode() === 'BLEND') continue;
      const pos = prim.getAttribute('POSITION')!;
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      const at = (i: number) => { const p = pos.getElement(i, [0, 0, 0]); return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]); };
      for (let t = 0; t + 2 < n; t += 3) {
        const [a, b, c] = (idx ? [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)] : [t, t + 1, t + 2]).map(at);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
        const area = Math.hypot(nx, ny, nz) / 2;
        // (Upright faces only, sampled every 10 cm or so.)
        if (area < 1e-6 || Math.abs(ny) / (2 * area) > 0.3) continue;
        const k = Math.min(60, Math.ceil(Math.sqrt(area) / 0.1));
        for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
          const [p, q] = [i / k, j / k];
          const [x, y, z] = [0, 1, 2].map((r) => a[r] + u[r] * p + v[r] * q);
          const bin = Math.floor(y / cell);
          const key = `${Math.floor(x / cell)} ${Math.floor(z / cell)}`;
          const was = seen.get(key) ?? { bins: 0, top: 0 };
          seen.set(key, { bins: bin >= 0 && bin < bins ? was.bins | (1 << bin) : was.bins, top: Math.max(was.top, y) });
        }
      }
    }
  }
  // (Standing over all but one of the bins: a gap under a cupboard, a skirting, a missed sample.)
  const solid = new Map<string, number>();
  for (const [key, x] of seen) {
    let count = 0;
    for (let i = 0; i < bins; i++) if (x.bins & (1 << i)) count++;
    if (count >= bins - 1) solid.set(key, x.top);
  }
  // Rows of cells along x joined, then rows alike one after another along z.
  const runs = new Map<string, { x0: number; x1: number; z0: number; z1: number; top: number }>();
  const zs = [...new Set([...solid.keys()].map((k) => +k.split(' ')[1]))].sort((p, q) => p - q);
  const boxes: { x0: number; x1: number; z0: number; z1: number; top: number }[] = [];
  for (const z of zs) {
    const xs = [...solid.keys()].filter((k) => +k.split(' ')[1] === z).map((k) => +k.split(' ')[0]).sort((p, q) => p - q);
    for (let i = 0; i < xs.length;) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      const top = Math.max(...xs.slice(i, j + 1).map((x) => solid.get(`${x} ${z}`)!));
      const key = `${xs[i]} ${xs[j]}`;
      const run = runs.get(key);
      if (run && run.z1 === z) { run.z1 = z + 1; run.top = Math.max(run.top, top); } else {
        const made = { x0: xs[i], x1: xs[j] + 1, z0: z, z1: z + 1, top };
        runs.set(key, made);
        boxes.push(made);
      }
      i = j + 1;
    }
  }
  const r = (v: number) => Math.round(v * 100) / 100;
  return boxes.map((b) => [r(b.x0 * cell), r(b.z0 * cell), r(b.x1 * cell), r(b.z1 * cell), r(b.top)]);
}

/** A model fitted to its budget: simplified (allowing more error until it fits), textures resized, compressed. */
async function makeModel(id: string, a: ModelAsset | TreeAsset) {
  if ('tree' in a) {
    const doc = await growTree(a);
    if (triangles(doc) > a.tris) throw new Error(`${id}: ${triangles(doc)} triangles, over its ${a.tris}`);
    return finish(`models/${id}.glb`, doc, a.tex);
  }
  const src = a.sf ? await fetchScene(a.sf.uid) : await fetchModel(a.ph!);
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
  const real = a.ph ? (await json<{ dimensions?: number[] }>(`${API}/info/${a.ph}`)).dimensions : undefined;
  const scene = doc!.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  const made = a.height ? max[1] - min[1] : Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const want = a.height ?? (real ? Math.max(...real) / 1000 : made);
  // (Its height as given, or its size where it is far from what its source says.)
  if (Math.abs(want / made - 1) > (a.height ? 0.01 : 0.25)) {
    const k = want / made;
    const holder = doc!.createNode('scaled').setScale([k, k, k]);
    for (const n of scene.listChildren()) { scene.removeChild(n); holder.addChild(n); }
    scene.addChild(holder);
    console.log(`${id}: made ${made.toFixed(2)} m across, really ${want.toFixed(2)} m: scaled ×${k.toFixed(3)}`);
  }
  return finish(`models/${id}.glb`, doc!, a.tex);
}

/** A model's textures resized and made WebP, its geometry compressed; written, and what it came to. */
async function finish(file: string, doc: Document, tex: number) {
  await doc.transform(
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 82 }),
    reorder({ encoder: MeshoptEncoder }),
    quantize(),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const bytes = await io.writeBinary(doc);
  await mkdir(dirname(join(OUT, file)), { recursive: true });
  await writeFile(join(OUT, file), bytes);
  const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { file, tris: triangles(doc), bytes: bytes.byteLength, size: [r(max[0] - min[0]), r(max[1] - min[1]), r(max[2] - min[2])] as [number, number, number], min: min.map(r), max: max.map(r) };
}

/**
 * ambientCG's 1K maps of a texture, fetched into the cache: colour, normal, and its occlusion and
 * roughness packed as Poly Haven's are (red, green); its real size (m).
 */
async function fetchAcgMaps(acg: string) {
  const dir = join(CACHE, 'surfaces', acg);
  const zip = await download(`https://ambientcg.com/get?file=${acg}_1K-JPG.zip`, join(dir, `${acg}.zip`));
  const at = (kind: string) => join(dir, `${acg}_1K-JPG_${kind}.jpg`);
  if (!existsSync(at('Color'))) execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  const orm = join(dir, 'orm.png');
  if (!existsSync(orm)) {
    const [ao, rough] = await Promise.all([at('AmbientOcclusion'), at('Roughness')].map((f) => sharp(f).greyscale().raw().toBuffer({ resolveWithObject: true })));
    const { width, height } = ao.info;
    const px = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) { px[i * 3] = ao.data[i]; px[i * 3 + 1] = rough.data[i]; }
    await sharp(px, { raw: { width, height, channels: 3 } }).png().toFile(orm);
  }
  const info = await json<{ foundAssets: { dimensionX?: number }[] }>(`https://ambientcg.com/api/v2/full_json?id=${acg}&include=dimensionsData`);
  return { maps: { color: at('Color'), normal: at('NormalGL'), orm }, size: (info.foundAssets[0]?.dimensionX ?? 200) / 100 };
}

/** A surface's maps (1K JPEGs) resized and made WebP; its tile's size from the texture's real one. */
async function makeSurface(id: string, a: SurfaceAsset) {
  const [maps, size] = 'acg' in a
    ? await fetchAcgMaps(a.acg).then((x) => [x.maps, x.size] as const)
    : await Promise.all([fetchMaps(a.ph), json<{ dimensions?: number[] }>(`${API}/info/${a.ph}`).then((x) => (x.dimensions?.[0] ?? 2000) / 1000)]);
  await mkdir(join(OUT, 'surfaces'), { recursive: true });
  let bytes = 0;
  const out: Record<string, string> = {};
  for (const [kind, src] of Object.entries(maps)) {
    const file = `surfaces/${id}-${kind}.webp`;
    await sharp(src).resize(a.tex, a.tex, { fit: 'inside' }).webp({ quality: kind === 'color' ? 82 : 88 }).toFile(join(OUT, file));
    bytes += (await stat(join(OUT, file))).size;
    out[kind] = file;
  }
  const tile = Math.round(size * 100) / 100;
  return { color: out.color, normal: out.normal, orm: out.orm, bytes, tile };
}

async function main() {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  const indexFile = join(OUT, 'index.json');
  const before: SetIndex & { made?: Record<string, string> } = existsSync(indexFile) ? JSON.parse(await readFile(indexFile, 'utf8')) : { models: {}, surfaces: {}, skies: {}, views: {}, scenes: {} };
  const made = before.made ?? {};
  const index: SetIndex & { made: Record<string, string> } = { models: {}, surfaces: {}, skies: {}, views: {}, scenes: {}, made: {} };
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
  // The ready-made scenes (#27): where each one's bounds came to, to fit it.
  for (const [id, a] of Object.entries(SCENES) as [string, SceneAsset][]) {
    const key = `scene:${id}`;
    const was = before.scenes?.[id];
    try {
      const made = fresh(key, a, was?.file) ? was! : await makeScene(id, a);
      index.scenes[id] = { file: made.file, tris: made.tris, bytes: made.bytes, size: made.size, walls: made.walls, ...(was?.tops && made === was ? { tops: was.tops } : {}) };
      index.made[key] = JSON.stringify(a);
      const b = made as { min?: number[]; max?: number[] };
      console.log(`${id.padEnd(16)} scene ${String(made.tris).padStart(7)} tris ${(made.bytes / 1048576).toFixed(1).padStart(5)} MB  ${made.size.join(' × ')} m${b.min ? `  from ${b.min.join(',')} to ${b.max!.join(',')}` : ''}`);
    } catch (e) {
      failed.push(String((e as Error).message));
      if (was) index.scenes[id] = was;
    }
  }
  // Where a figure can stand on each model and scene (#29), worked out from what was made.
  for (const [kind, list] of [['models', index.models], ['scenes', index.scenes]] as const) {
    for (const [id, x] of Object.entries(list) as [string, { file: string; tops?: number[][] }][]) {
      // (Again only for what was made again.)
      const key = `${kind === 'models' ? 'model' : 'scene'}:${id}`;
      if (!x.tops || index.made[key] !== made[key]) x.tops = await topsOfFile(x.file, kind === 'models');
    }
  }
  // The skies and the views out of windows: Poly Haven's 1K HDR as it is.
  for (const [kind, list] of [['skies', SKIES], ['views', VIEWS]] as const) {
    await mkdir(join(OUT, kind), { recursive: true });
    for (const [id, ph] of Object.entries(list)) {
      const file = `${kind}/${id}.hdr`;
      if (!fresh(`${kind}:${id}`, ph, file)) {
        const files = await json<{ hdri: Record<string, { hdr: { url: string } }> }>(`${API}/files/${ph}`);
        await writeFile(join(OUT, file), await readFile(await download(files.hdri['1k'].hdr.url, join(CACHE, kind, `${ph}.hdr`))));
      }
      index[kind][id] = { file, bytes: (await stat(join(OUT, file))).size };
      index.made[`${kind}:${id}`] = JSON.stringify(ph);
      console.log(`${id.padEnd(16)} ${kind.padEnd(7)} ${(index[kind][id].bytes / 1024).toFixed(0).padStart(6)} KB`);
    }
  }
  await writeFile(indexFile, `${JSON.stringify(index, null, 1)}\n`);
  // (What is no longer listed goes.)
  const kept = new Set([...Object.values(index.models).map((m) => m.file), ...Object.values(index.surfaces).flatMap((x) => [x.color, x.normal, x.orm]), ...Object.values(index.skies).map((x) => x.file), ...Object.values(index.views).map((x) => x.file), ...Object.values(index.scenes).map((x) => x.file)]);
  for (const dir of ['models', 'surfaces', 'skies', 'views', 'scenes']) {
    for (const f of await readdir(join(OUT, dir)).catch(() => [] as string[])) if (!kept.has(`${dir}/${f}`)) await rm(join(OUT, dir, f));
  }
  const total = [...kept].length;
  // Where each came from, and on what terms.
  const ph = (id: string, kind: 'a') => `https://polyhaven.com/${kind}/${id}`;
  const credits = [
    'The sets\' models, surfaces and bark (public/sets) are from Poly Haven (https://polyhaven.com), CC0 1.0 (public domain):',
    ...Object.entries(MODELS).flatMap(([id, x]) => ('ph' in x && x.ph ? [`  ${id}: ${ph(x.ph, 'a')}`] : [])),
    ...Object.entries(SURFACES).flatMap(([id, x]) => ('ph' in x ? [`  ${id}: ${ph(x.ph, 'a')}`] : [])),
    `  bark: ${ph(BARK, 'a')}`,
    ...Object.entries(SKIES).map(([id, x]) => `  ${id} sky: ${ph(x, 'a')}`),
    ...Object.entries(VIEWS).map(([id, x]) => `  ${id} view out of windows: ${ph(x, 'a')}`),
    '',
    'From ambientCG (https://ambientcg.com), CC0 1.0 (public domain):',
    ...Object.entries(SURFACES).flatMap(([id, x]) => ('acg' in x ? [`  ${id}: https://ambientcg.com/view?id=${x.acg}`] : [])),
    '',
    'Ready-made scenes from Sketchfab (https://sketchfab.com), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), fitted to the stage, simplified and their textures resized:',
    ...(Object.entries(SCENES) as [string, SceneAsset][]).map(([id, x]) => `  ${id}: "${x.title}" by ${x.author}, https://sketchfab.com/3d-models/${x.sf}`),
    ...Object.entries(MODELS).flatMap(([id, x]) => ('sf' in x && x.sf ? [`  ${id}: "${x.sf.title}" by ${x.sf.author}, https://sketchfab.com/3d-models/${x.sf.uid}`] : [])),
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
