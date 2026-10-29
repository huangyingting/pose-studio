/*
 * Characters made built-in ones (public/characters/<id>.glb and .png): Mixamo's, and figures
 * rigged by scripts/characters/rig.py (Sketchfab's).
 *
 *     npm run dev -- -p 3399    (then, in another terminal)
 *     npx jiti scripts/characters/import.ts data/library/characters/{Adam,Brute,Elizabeth,'Erika Archer',Joe,Ninja,'Paladin J Nordstrom',Pete,Remy,Swat}.fbx
 *     npx jiti scripts/characters/import.ts /tmp/swat-operator.glb /tmp/male-base.glb
 *
 * (Mixamo's with natural proportions, and Brute; not the cartoon ones, nor Mixamo's own mannequin.)
 *
 * Each file is imported in the running app as a user would (Import character…), which keeps it as a
 * GLB with its colour textures (lib/model.ts: fitted within 1024 px, JPEG where nothing shows
 * through) and draws its thumbnail; both are taken out of the page. Then the GLB is made as the
 * other built-ins are: in metres (Mixamo's FBX are in centimetres: a root scaled to a hundredth over
 * its scene; Remy's twice as big), its bones named as our skeleton's (as the app found them). It
 * prints each one's entry for lib/characters.ts (`mixamo(…)`): the bones it lacks (fingers' ends, some fingers),
 * and the body the mannequin under it takes (its proportions; the height at which the mannequin's
 * hips are the character's: it is drawn at its own size).
 */
import { writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { chromium } from 'playwright';
import { newFigure } from '../../lib/doc';
import { legsOf } from '../../lib/locomotion';
import { Fitted, characterProportions, fitBody, mapBones } from '../../lib/model';
import { BONES, type BodyParams } from '../../lib/types';

const APP = process.env.APP ?? 'http://localhost:3399/';
// (Remy's file is drawn at twice a man's size.)
const UNITS: Record<string, number> = { remy: 0.005 };
// Who is a woman (and her bust); the rest are men.
const WOMEN: Record<string, [number, number]> = { elizabeth: [1, 0.4], 'erika-archer': [1, 0.4], 'fashion-model': [1, 0.5], athlete: [1, 0.4] };
// Named by their roles, not as Mixamo names them (their files' names stay their ids).
const ROLES: Record<string, string> = {
  adam: 'Jogger', brute: 'Barbarian', elizabeth: 'Casual woman', 'erika-archer': 'Archer', joe: 'Businessman',
  ninja: 'Ninja', 'paladin-j-nordstrom': 'Knight', pete: 'Construction worker', remy: 'Student', swat: 'SWAT officer',
  'swat-operator': 'Tactical officer', 'male-base': 'Life model', 'fashion-model': 'Fashion model', athlete: 'Athlete',
};

type Gltf = { scene?: number; scenes: { nodes: number[] }[]; nodes: { name?: string; scale?: number[]; children?: number[] }[]; materials?: Record<string, Record<string, unknown>>[]; images?: unknown; textures?: unknown; samplers?: unknown };

function readGlb(glb: Buffer) {
  const length = glb.readUInt32LE(12);
  return { gltf: JSON.parse(glb.subarray(20, 20 + length).toString()) as Gltf, rest: glb.subarray(20 + length) };
}

function writeGlb(gltf: Gltf, rest: Buffer) {
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + json.length + rest.length, 8);
  head.writeUInt32LE(json.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, json, rest]);
}

/** Read in Node (which cannot decode images): without its textures. */
async function load(glb: Buffer) {
  const { gltf, rest } = readGlb(glb);
  for (const m of gltf.materials ?? []) {
    delete m.pbrMetallicRoughness?.baseColorTexture;
    delete m.emissiveTexture;
  }
  delete gltf.images;
  delete gltf.textures;
  delete gltf.samplers;
  const out = writeGlb(gltf, rest);
  return new GLTFLoader().parseAsync(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer, '');
}

/** Its file, the bones it lacks and its body. */
async function made(id: string, glb: Buffer, fbx: boolean) {
  const { gltf, rest } = readGlb(glb);
  // In metres.
  const s = fbx ? UNITS[id] ?? 0.01 : 1;
  const scene = gltf.scenes[gltf.scene ?? 0];
  if (s !== 1) {
    gltf.nodes.push({ name: 'Metres', scale: [s, s, s], children: scene.nodes });
    scene.nodes = [gltf.nodes.length - 1];
  }
  // Its bones named as ours (by the node each was read from).
  const read = await load(glb);
  const bones = mapBones(read.scene);
  for (const [bone, name] of Object.entries(bones)) {
    const node = read.parser.associations.get(read.scene.getObjectByName(name!)!)?.nodes;
    if (node === undefined) throw new Error(`${id}: no node for ${bone}`);
    gltf.nodes[node].name = bone;
  }
  const out = writeGlb(gltf, rest);
  // Its body: its proportions, at the height that puts its hips where the mannequin's are.
  const root = (await load(out)).scene;
  const ours = mapBones(root);
  const hips = new Fitted(root, ours).hipHeight;
  const proportions = characterProportions(root, ours)!;
  const [sex, bust] = WOMEN[id] ?? [0, 0];
  let body: BodyParams = { ...newFigure().body, sex, bust };
  for (let round = 0; round < 3; round++) {
    body = fitBody({ ...newFigure(), body }, proportions);
    let lo = 0.8, hi = 2.4;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const legs = legsOf({ ...body, height: mid });
      if (legs.rootY - legs.ankleY < hips) lo = mid;
      else hi = mid;
    }
    body = { ...body, height: Math.round(lo * 100) / 100 };
  }
  const lacks = BONES.filter((b) => !(b in ours));
  return { out, lacks, body };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: npx jiti scripts/characters/import.ts <character.fbx|.glb>…');
  process.exit(1);
}
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(APP);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.stage canvas');
const tab = page.getByRole('tab', { name: 'Library', exact: true });
if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
await page.getByRole('tablist', { name: 'Library' }).getByRole('tab', { name: 'Characters', exact: true }).click();

type Page = { __poseStudio: { store: { getState(): { library: { models?: { id: string; thumb?: string }[] } } } } };
for (const file of files) {
  const count = await page.evaluate(() => (window as unknown as Page).__poseStudio.store.getState().library.models?.length ?? 0);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Import character/ }).click()]);
  await chooser.setFiles(file);
  await page.waitForFunction((n) => ((window as unknown as Page).__poseStudio.store.getState().library.models?.length ?? 0) > n, count, { timeout: 300_000 });
  const info = await page.evaluate(() => (window as unknown as Page).__poseStudio.store.getState().library.models!.at(-1)!);
  // (Its file as the app keeps it: IndexedDB, lib/assetstore.ts.)
  const data = await page.evaluate((key) => new Promise<string>((resolve, reject) => {
    const req = indexedDB.open('pose-studio-assets');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const get = req.result.transaction('models').objectStore('models').get(key);
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const bytes = new Uint8Array(get.result.data);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        resolve(btoa(s));
      };
    };
  }), info.id);
  const fbx = extname(file).toLowerCase() === '.fbx';
  const id = basename(file, extname(file)).toLowerCase().replace(/\s+/g, '-');
  const name = ROLES[id] ?? basename(file, extname(file));
  const { out, lacks, body } = await made(id, Buffer.from(data, 'base64'), fbx);
  writeFileSync(`public/characters/${id}.glb`, out);
  writeFileSync(`public/characters/${id}.png`, Buffer.from(info.thumb!.split(',')[1], 'base64'));
  // (A rigged figure's bones are always the same, without fingers or toes: its author goes in their place.)
  const rest = !fbx ? ", '<author>'" : lacks.length ? `, oursWithout(${lacks.map((b) => `'${b}'`).join(', ')})` : '';
  console.log(`  ${fbx ? 'mixamo' : 'sketchfab'}('${id}', '${name}', ${JSON.stringify(body).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ').replace(/^\{/, '{ ').replace(/\}$/, ' }')}${rest}), // ${(out.length / 1e6).toFixed(1)} MB`);
}
await browser.close();
