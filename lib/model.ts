import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadModelFile, saveModelFile } from './assetstore';
import { legsOf } from './locomotion';
import { setWorldQuaternion } from './mannequin';
import { fingerBones, PARENT, worldTurns } from './skeleton';
import { BONES, JOINTS, type Bone, type BodyParams, type Figure, type JointName, type ModelInfo } from './types';
import { uid } from './uid';

/*
 * Rigs from other tools (a Mixamo character, a VRM avatar, a BVH capture's skeleton) fitted to the
 * standard skeleton (lib/skeleton.ts): which of their bones is which, how they stand (up, facing,
 * size), and the turn each bone has in their T-pose. With that, a model is posed from a figure's
 * bones, and a motion's frames are read into them (lib/importmotion.ts).
 */

/** Which of a rig's bones (by name) is each bone of the skeleton. */
export type BoneMap = Partial<Record<Bone, string>>;

/** The bones a rig must have to be posed or read: the mannequin's, but the spine's middle (which can be missed). */
export const NEEDED: JointName[] = JOINTS.filter((j) => j !== 'spine' && j !== 'chest');

type Side = 'L' | 'R';

/** Which side a bone is on, from its name: "LeftArm", "LHipJoint", "upperarm_l", "J_Bip_L_Hand", "Bip01 L Foot". */
function sideOf(raw: string): Side | null {
  const n = raw.toLowerCase();
  if (/left|(^|[^a-z])l([^a-z]|$)/.test(n) || /^L[A-Z]/.test(raw)) return 'L';
  if (/right|(^|[^a-z])r([^a-z]|$)/.test(n) || /^R[A-Z]/.test(raw)) return 'R';
  return null;
}

/** A bone's name without rig prefixes, side markers and numbering: "mixamorig:LeftUpLeg" → "upleg". */
function baseOf(raw: string) {
  return raw.replace(/^[LR](?=[A-Z])/, '').toLowerCase()
    .replace(/mixamorig\d*:|left|right/g, '')
    .replace(/(^|[^a-z])[lr](?=[^a-z]|$)/g, '$1')
    .replace(/[^a-z0-9]/g, '')
    .replace(/^(mixamorig\d*|jbipc|jbip|bip0*1|def)/, '')
    .replace(/(?<=[a-z])0*1$/, '');
}

const isBone = (o: THREE.Object3D) => !!o.name && ((o as THREE.Bone).isBone || o.type === 'Object3D' || o.type === 'Group');

/** The rig's bones (named nodes that are bones or joints), each once. */
export function rigBones(root: THREE.Object3D): THREE.Object3D[] {
  const all: THREE.Object3D[] = [];
  root.traverse((o) => { if (isBone(o) && !(o as THREE.Mesh).isMesh) all.push(o); });
  return all;
}

const ancestors = (o: THREE.Object3D, stop?: THREE.Object3D) => {
  const out: THREE.Object3D[] = [];
  for (let p = o.parent; p && p !== stop; p = p.parent) out.push(p);
  return out;
};

/**
 * Find the skeleton's bones in a rig: the hands, feet and head by their names, the rest by the
 * rig's shape (a hand's parent is the forearm, its parent the upper arm, then the shoulder; the
 * spine is what runs from the hips to the neck), the fingers by their names under each hand.
 */
export function mapBones(root: THREE.Object3D): BoneMap {
  const all = rigBones(root);
  const named = (names: string[], side: Side | null) => {
    for (const n of names) {
      const hit = all.find((o) => baseOf(o.name) === n && sideOf(o.name) === side);
      if (hit) return hit;
    }
    return null;
  };
  const map: BoneMap = {};
  const put = (b: Bone, o: THREE.Object3D | null | undefined) => { if (o && isBone(o)) map[b] = o.name; };
  const head = named(['head'], null);
  const legs: Partial<Record<Side, THREE.Object3D>> = {};
  for (const s of ['L', 'R'] as const) {
    const side = s === 'L' ? 'left' : 'right';
    const hand = named(['hand', 'wrist'], s);
    const lower = hand?.parent;
    const upper = lower?.parent;
    put(`${side}Hand`, hand);
    put(`${side}LowerArm`, lower);
    put(`${side}UpperArm`, upper);
    // A bone between the upper arm and the spine: the shoulder (clavicle).
    const above = upper?.parent;
    if (above && head && !ancestors(head).includes(above) && isBone(above)) put(`${side}Shoulder`, above);
    const foot = named(['foot', 'ankle'], s);
    put(`${side}Foot`, foot);
    put(`${side}LowerLeg`, foot?.parent);
    put(`${side}UpperLeg`, foot?.parent?.parent);
    legs[s] = foot?.parent?.parent ?? undefined;
    const toes = foot?.children.find(isBone);
    put(`${side}Toes`, toes);
    if (hand) fingersOf(hand, side, put);
  }
  // The hips: where the legs meet; the spine runs from there up to the neck, under the head.
  const hips = legs.L?.parent && legs.L.parent === legs.R?.parent ? legs.L.parent : named(['hips', 'hip', 'pelvis'], null);
  put('hips', hips);
  if (hips && head) {
    const path = [head, ...ancestors(head, hips)].reverse();
    // path: the spine's bones, the neck, the head.
    put('head', head);
    if (path.length >= 2) put('neck', path[path.length - 2]);
    const spine = path.slice(0, -2);
    put('spine', spine[0]);
    if (spine.length >= 2) put('chest', spine[1]);
    if (spine.length >= 3) put('upperChest', spine[spine.length - 1]);
  }
  return map;
}

const FINGER_NAMES: [string, RegExp][] = [['Thumb', /thumb/], ['Index', /index|point/], ['Middle', /middle|mid/], ['Ring', /ring/], ['Little', /pinky|little|small/]];

/** The fingers under a hand: each finger's first three bones, named for what they are. */
function fingersOf(hand: THREE.Object3D, side: 'left' | 'right', put: (b: Bone, o: THREE.Object3D) => void) {
  for (const start of hand.children.filter(isBone)) {
    const finger = FINGER_NAMES.find(([, re]) => re.test(start.name.toLowerCase()));
    if (!finger) continue;
    const chain: THREE.Object3D[] = [];
    for (let o: THREE.Object3D | undefined = start; o && chain.length < 3; o = o.children.find(isBone)) chain.push(o);
    const segs = finger[0] === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    chain.forEach((o, i) => put(`${side}${finger[0]}${segs[i]}` as Bone, o));
  }
}

/** The skeleton's needed bones a map lacks. */
export const missingBones = (map: BoneMap) => NEEDED.filter((j) => !map[j]);

/* ---------- a rig stood up, facing +Z, its T-pose known ---------- */

/** Which way each limb bone points in the T-pose (to the next one down the limb). */
function tPoseDir(b: Bone): THREE.Vector3 | null {
  if (/Thumb/.test(b)) return null;
  if (/^(left|right)(Shoulder|UpperArm|LowerArm|Hand|Index|Middle|Ring|Little)/.test(b)) return new THREE.Vector3(b.startsWith('left') ? 1 : -1, 0, 0);
  if (/^(left|right)(UpperLeg|LowerLeg)$/.test(b)) return new THREE.Vector3(0, -1, 0);
  return null;
}

/** The next bone down a limb (what a bone points at). */
function nextOf(b: Bone): Bone | null {
  const side = b.startsWith('left') ? 'left' : 'right';
  const part = b.replace(/^(left|right)/, '');
  const next: Record<string, string> = {
    Shoulder: 'UpperArm', UpperArm: 'LowerArm', LowerArm: 'Hand', Hand: 'MiddleProximal', UpperLeg: 'LowerLeg', LowerLeg: 'Foot',
    IndexProximal: 'IndexIntermediate', IndexIntermediate: 'IndexDistal', MiddleProximal: 'MiddleIntermediate', MiddleIntermediate: 'MiddleDistal',
    RingProximal: 'RingIntermediate', RingIntermediate: 'RingDistal', LittleProximal: 'LittleIntermediate', LittleIntermediate: 'LittleDistal',
  };
  return next[part] ? (`${side}${next[part]}` as Bone) : null;
}

/**
 * A rig fitted to the skeleton. `frame` holds it stood up (its spine up +Y, facing +Z); each
 * mapped bone's turn in the T-pose is known, from its rest pose (an A-pose's arms are swung up).
 */
export class Fitted {
  readonly frame: THREE.Group = new THREE.Group();
  readonly bones = new Map<Bone, THREE.Object3D>();
  /** Each bone's turn in the frame in the T-pose. */
  readonly rest = new Map<Bone, THREE.Quaternion>();
  /** Hips above the ankles at rest (in the rig's units). */
  readonly hipHeight: number;
  /** Bones in the rig's order (parents first). */
  private order: Bone[];

  /** `frame`: one stood up already (another person in the same file keeps their place in it). */
  constructor(readonly root: THREE.Object3D, map: BoneMap, frame?: THREE.Group) {
    if (frame) this.frame = frame;
    else this.frame.add(root);
    for (const b of BONES) {
      const name = map[b];
      const o = name ? root.getObjectByName(name) : undefined;
      if (o) this.bones.set(b, o);
    }
    const at = (b: Bone) => this.bones.get(b)?.getWorldPosition(new THREE.Vector3()) ?? null;
    this.frame.updateMatrixWorld(true);
    if (!frame) {
      // Stood up: the spine's way up, the left leg's way left.
      const hips = at('hips')!;
      const up = (at('neck') ?? at('head')!).clone().sub(hips).normalize();
      const left = at('leftUpperLeg')!.clone().sub(at('rightUpperLeg')!);
      const forward = new THREE.Vector3().crossVectors(left, up).normalize();
      left.crossVectors(up, forward).normalize();
      const basis = new THREE.Matrix4().makeBasis(left, up, forward);
      this.frame.quaternion.setFromRotationMatrix(basis).invert();
      this.frame.updateMatrixWorld(true);
    }
    const feet = Math.min(at('leftFoot')!.y, at('rightFoot')!.y);
    this.hipHeight = Math.max(1e-6, at('hips')!.y - feet);
    this.order = [...this.bones.keys()].sort((p, q) => ancestors(this.bones.get(p)!).length - ancestors(this.bones.get(q)!).length);
    // The T-pose turns: each limb bone swung from where it points at rest to where the T-pose has it
    // (bones below one, without a way of their own, swung with it).
    const swing = new Map<Bone, THREE.Quaternion>();
    for (const b of BONES) {
      const o = this.bones.get(b);
      const dir = tPoseDir(b);
      const next = nextOf(b);
      const there = next && this.bones.get(next) ? at(next) : null;
      let s: THREE.Quaternion | undefined;
      if (o && dir && there) s = new THREE.Quaternion().setFromUnitVectors(there.sub(at(b)!).normalize(), dir);
      else if (b !== 'hips' && !['spine', 'chest', 'upperChest', 'neck', 'head'].includes(b)) s = swing.get(PARENT[b as Exclude<Bone, 'hips'>]);
      if (s) swing.set(b, s);
      if (o) this.rest.set(b, (s ?? new THREE.Quaternion()).clone().multiply(o.getWorldQuaternion(new THREE.Quaternion())));
    }
  }

  /** Put the rig's bones where the skeleton has them: each bone's turn in the world (in the frame's space). */
  pose(world: Map<Bone, THREE.Quaternion>) {
    for (const b of this.order) setWorldQuaternion(this.bones.get(b)!, world.get(b)!.clone().multiply(this.rest.get(b)!));
  }

  /** The skeleton's bones' turns in the world from the rig as it is now (bones it lacks turn with their parent). */
  read(): Map<Bone, THREE.Quaternion> {
    this.frame.updateMatrixWorld(true);
    const out = new Map<Bone, THREE.Quaternion>();
    for (const b of BONES) {
      const o = this.bones.get(b);
      if (o) out.set(b, o.getWorldQuaternion(new THREE.Quaternion()).multiply(this.rest.get(b)!.clone().invert()));
      else out.set(b, b === 'hips' ? new THREE.Quaternion() : out.get(PARENT[b as Exclude<Bone, 'hips'>])!.clone());
    }
    return out;
  }

  /** Where a bone is (in the frame's space). */
  at(b: Bone) {
    return this.bones.get(b)?.getWorldPosition(new THREE.Vector3()) ?? null;
  }
}

/* ---------- models: a figure drawn as an imported character ---------- */

/**
 * A figure drawn as a model: the character's bones posed from the figure's (fingers from its hand
 * presets when the pose has none), its hips where the mannequin has them, at the figure's size.
 */
export class ModelRig {
  readonly object = new THREE.Group();
  private fitted: Fitted;
  private size = '';

  constructor(template: THREE.Object3D, readonly info: ModelInfo) {
    const copy = cloneSkinned(template);
    this.fitted = new Fitted(copy, info.bones);
    this.object.add(this.fitted.frame);
    copy.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }

  /** Pose it as the figure is; `hips`: where the mannequin's hips are (it rests on what it stands on). */
  apply(fig: Figure, hips: THREE.Vector3) {
    this.scaleTo(fig.body);
    const bones = Object.keys(fig.bones).some((b) => /Proximal$/.test(b)) ? fig.bones : { ...fingerBones(fig.hands), ...fig.bones };
    this.object.position.set(0, 0, 0);
    this.object.updateMatrixWorld(true);
    this.fitted.pose(worldTurns(bones));
    this.object.updateMatrixWorld(true);
    this.object.position.copy(hips.clone().sub(this.fitted.at('hips')!));
    this.object.updateMatrixWorld(true);
  }

  private scaleTo(body: BodyParams) {
    const key = JSON.stringify(body);
    if (key === this.size) return;
    this.size = key;
    const legs = legsOf(body);
    this.object.scale.setScalar((legs.rootY - legs.ankleY) / this.fitted.hipHeight);
  }

  /** (Its meshes and materials are the model's, shared by every figure drawn as it.) */
  dispose() {
    this.object.clear();
  }
}

/* ---------- the library's models: their files read when a figure is first drawn as one ---------- */

const infos = new Map<string, ModelInfo>();
const templates = new Map<string, THREE.Object3D>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** The library's models (called whenever its list changes). */
export function setModels(list: ModelInfo[] | undefined) {
  infos.clear();
  for (const m of list ?? []) infos.set(m.id, m);
}

export const modelInfo = (id: string) => infos.get(id) ?? null;

/** Call `f` whenever a model's file has been read (figures drawn as it can be now). Returns a function that stops it. */
export function onModels(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** A model, as read from its file (null until it has been: reading starts now). */
export function modelTemplate(id: string): THREE.Object3D | null {
  const hit = templates.get(id);
  const info = infos.get(id);
  if (hit || !info || loading.has(id)) return hit ?? null;
  loading.add(id);
  void loadModelFile(id)
    .then(async (data) => {
      if (!data) return;
      templates.set(id, await parseModel(info.format, data));
      changed();
    })
    .catch((err) => console.warn(`Could not read the model ${info.name}:`, err))
    .finally(() => loading.delete(id));
  return null;
}

/** A model's file → its scene (a glTF/GLB or FBX character). */
export async function parseModel(format: ModelInfo['format'], data: ArrayBuffer): Promise<THREE.Object3D> {
  if (format === 'fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    return new FBXLoader().parse(data, '');
  }
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  return (await new GLTFLoader().parseAsync(data, '')).scene;
}

/**
 * Import a character: read its file, find its bones (`map`: mapped by hand), keep the file. Throws
 * MissingBones when not all are found (to map them by hand).
 */
export async function importModel(name: string, data: ArrayBuffer, map?: BoneMap): Promise<ModelInfo> {
  const ext = name.toLowerCase().split('.').pop();
  const format = ext === 'fbx' ? 'fbx' : ext === 'glb' || ext === 'gltf' ? 'glb' : null;
  if (!format) throw new Error('Use a glTF/GLB or FBX character');
  const root = await parseModel(format, data);
  if (!rigBones(root).some((o) => (o as THREE.Bone).isBone)) throw new Error('The file has no skeleton');
  const bones = map ?? mapBones(root);
  const missing = missingBones(bones);
  if (missing.length) throw new MissingBones(rigBones(root).map((o) => o.name), bones, missing);
  const info: ModelInfo = { id: uid('model'), name: name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Character', format, bones };
  await saveModelFile(info.id, data);
  infos.set(info.id, info);
  templates.set(info.id, root);
  return info;
}

/** The skeleton's bones could not all be found: the rig's bone names, and what was found, to map by hand. */
export class MissingBones extends Error {
  constructor(readonly names: string[], readonly found: BoneMap, readonly missing: Bone[]) {
    super(`Could not find the skeleton's ${missing.slice(0, 4).join(', ')} bones (names not recognised)`);
  }
}
