import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadModelFile, saveModelFile } from './assetstore';
import { BODY_FIELDS } from './body';
import { BUILT_IN_CHARACTERS, characterFile, isBuiltInCharacter } from './characters';
import { legsOf } from './locomotion';
import { Rig } from './relations';
import { setWorldQuaternion } from './mannequin';
import { fingerBones, PARENT, worldTurns } from './skeleton';
import type { Ink } from './ink';
import { styleDef } from './styles';
import { BONES, JOINTS, type Bone, type BodyParams, type Figure, type JointName, type ModelInfo, type Proportions, type Style } from './types';
import { uid } from './uid';
import { readVrm, type VrmInfo } from './vrm';
import { ownLooks, paintedLook, toonMaterial, type ToonLook } from './toon';

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
  /** Its meshes, drawn in the scene's style as the mannequin is (not in the file's own materials). */
  private meshes: THREE.Mesh[] = [];
  /** Their own looks, where the file gives them (a VRM avatar's), for the Toon style; and the materials made of them. */
  private looks: (ToonLook | undefined)[] = [];
  private toons: (THREE.ShaderMaterial | undefined)[] = [];
  /** Their outline hulls (posed with them). */
  private hulls: THREE.Mesh[] = [];

  constructor(template: THREE.Object3D, readonly info: ModelInfo, private ink: Ink) {
    const copy = cloneSkinned(template);
    // (The copy's meshes in the same order as the model's, whose looks they take.)
    template.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.looks.push(ownLooks.get(o)); });
    this.fitted = new Fitted(copy, info.bones);
    this.object.add(this.fitted.frame);
    copy.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
    });
    for (const mesh of this.meshes) {
      const skinned = mesh as THREE.SkinnedMesh;
      let hull: THREE.Mesh;
      if (skinned.isSkinnedMesh) {
        const h = new THREE.SkinnedMesh(mesh.geometry, ink.outline);
        h.bindMode = skinned.bindMode;
        h.bind(skinned.skeleton, skinned.bindMatrix);
        hull = h;
      } else {
        hull = new THREE.Mesh(mesh.geometry, ink.outline);
      }
      hull.frustumCulled = false;
      hull.raycast = () => {};
      mesh.add(hull);
      this.hulls.push(hull);
    }
  }

  private linked = false;
  private style: Style = 'line';

  /** Draw it in a style, its body tinted as the figure's colour (in Toon, in its own looks where it has them). */
  setLook(style: Style, tint: string | null) {
    this.style = style;
    const m = this.ink.materialsFor(style, tint ?? undefined);
    this.meshes.forEach((mesh, i) => { mesh.material = this.own(i) ?? m.body; });
    this.setLinked(this.linked);
  }

  /** A mesh's own look's material, in the Toon style (made once). */
  private own(i: number): THREE.ShaderMaterial | undefined {
    const look = this.looks[i];
    if (this.style !== 'toon' || !look || this.ink.ghost) return undefined;
    return (this.toons[i] ??= toonMaterial(look, this.ink.uniforms.lightDir));
  }

  /** Outline it in the accent (linked to the pointer elsewhere), whatever the style. */
  setLinked(on: boolean) {
    this.linked = on;
    const outlined = !!styleDef(this.style).outline;
    this.hulls.forEach((h, i) => {
      // (In its own look: its own outline, or none; none where it is cut out or see-through.)
      const own = this.own(i) ? this.looks[i]! : null;
      const look = own?.outline;
      const cutout = own && own.alpha !== 'opaque' && own.map ? { map: own.map, cutoff: own.alpha === 'mask' ? own.cutoff : 0.5 } : undefined;
      h.material = on ? this.ink.linked : look ? this.ink.outlineAs(look.width, look.color, cutout) : this.ink.outline;
      h.visible = on || (outlined && (!look || look.width > 0));
    });
  }

  /** Flat per-part colours for the line pass (as the mannequin's parts); returns the next free id. */
  setIdMode(on: boolean, firstId: number, style: Style, tint: string | null) {
    if (!on) {
      this.setLook(style, tint);
      return firstId;
    }
    this.meshes.forEach((mesh, i) => { mesh.material = this.ink.idMaterial(firstId + i); });
    for (const h of this.hulls) h.visible = false;
    return firstId + this.meshes.length;
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

  /** The corners of what it draws, as posed (its hair, a hat, a weapon: beyond the mannequin under it). */
  forEachPoint(cb: (p: THREE.Vector3) => void) {
    const box = new THREE.Box3();
    for (const mesh of this.meshes) {
      // (A skinned mesh's box, as it is posed now: not kept from before.)
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).computeBoundingBox();
      box.expandByObject(mesh, false);
    }
    if (box.isEmpty()) return;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) cb(new THREE.Vector3(x, y, z));
  }

  /** (Its geometry and textures are the model's, shared by every figure drawn as it.) */
  dispose() {
    for (const m of this.toons) m?.dispose();
    this.object.clear();
  }
}

/* ---------- the mannequin fitted to a character ---------- */

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Proportions from where a body's joints are and the top of its head. */
function proportionsFrom(at: (b: 'hips' | 'head' | 'leftUpperArm' | 'rightUpperArm' | 'leftFoot' | 'rightFoot') => THREE.Vector3, top: number): Proportions {
  const floor = Math.min(at('leftFoot').y, at('rightFoot').y);
  const height = Math.max(1e-6, top - floor);
  return {
    legs: r4((at('hips').y - floor) / height),
    head: r4((top - at('head').y) / height),
    shoulders: r4(at('leftUpperArm').distanceTo(at('rightUpperArm')) / height),
  };
}

/**
 * A character's proportions, stood up at rest (a copy: the file's scene is left as it is). None
 * when its meshes do not reach over its head bone (nothing to measure the head by).
 */
export function characterProportions(root: THREE.Object3D, map: BoneMap): Proportions | undefined {
  const fitted = new Fitted(cloneSkinned(root), map);
  fitted.frame.updateMatrixWorld(true);
  // At rest the meshes are as they were bound: their vertices where the file has them.
  let top = -Infinity;
  const v = new THREE.Vector3();
  fitted.frame.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry.attributes.position : null;
    for (let i = 0; pos && i < pos.count; i++) top = Math.max(top, v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).y);
  });
  if (!(top > fitted.at('head')!.y)) return undefined;
  return proportionsFrom((b) => fitted.at(b)!, top);
}

/** The mannequin's proportions with a body. */
function mannequinProportions(rig: Rig, f: Figure): Proportions {
  const m = rig.model({ ...f, bones: {}, position: [0, 0, 0], grounded: true });
  let top = -Infinity;
  m.forEachPoint((p) => { top = Math.max(top, p.y); });
  return proportionsFrom((b) => m.joints[b].getWorldPosition(new THREE.Vector3()), top);
}

/**
 * A body for the mannequin under a character: as tall as it was, of the same sex, with the
 * character's legs, head and shoulders, so that picking, contacts and the motion check are on the
 * body that shows. Each setting mostly moves one share (leg length the legs, head size the head,
 * build the shoulders), so each is found from the shares at its two ends, twice over.
 */
export function fitBody(f: Figure, target: Proportions): BodyParams {
  const rig = new Rig();
  try {
    let body: BodyParams = { ...f.body };
    const settings: [keyof Proportions, 'legs' | 'head' | 'build'][] = [['legs', 'legs'], ['head', 'head'], ['shoulders', 'build']];
    for (let round = 0; round < 2; round++) {
      for (const [share, key] of settings) {
        const field = BODY_FIELDS.find((x) => x.key === key)!;
        const lo = mannequinProportions(rig, { ...f, body: { ...body, [key]: field.min } })[share];
        const hi = mannequinProportions(rig, { ...f, body: { ...body, [key]: field.max } })[share];
        if (Math.abs(hi - lo) < 1e-6) continue;
        const u = Math.min(1, Math.max(0, (target[share] - lo) / (hi - lo)));
        body = { ...body, [key]: Math.round((field.min + (field.max - field.min) * u) * 100) / 100 };
      }
    }
    return body;
  } finally {
    rig.dispose();
  }
}

/** The body of the mannequin under a figure drawn as a character: the character's own (listed, or fitted to its proportions). */
export function bodyFor(f: Figure, id: string): BodyParams {
  const info = infos.get(id);
  return info?.body ? { ...info.body } : info?.proportions ? fitBody(f, info.proportions) : f.body;
}

/* ---------- the library's models: their files read when a figure is first drawn as one ---------- */

const infos = new Map<string, ModelInfo>();
const templates = new Map<string, THREE.Object3D>();
const loading = new Set<string>();
const unreachable = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
for (const m of BUILT_IN_CHARACTERS) infos.set(m.id, m);

/** The library's models (called whenever its list changes), with the built-in characters. */
export function setModels(list: ModelInfo[] | undefined) {
  infos.clear();
  for (const m of [...BUILT_IN_CHARACTERS, ...(list ?? [])]) infos.set(m.id, m);
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
  if (hit || !info || loading.has(id) || unreachable.has(id)) return hit ?? null;
  loading.add(id);
  // A built-in character's file comes with the app (not asked for again this visit if it does
  // not come: offline); an imported one's is kept as an asset (it may come later, synced).
  const builtIn = isBuiltInCharacter(id);
  const file = builtIn ? fetch(characterFile(id)).then((r) => (r.ok ? r.arrayBuffer() : null), () => null) : loadModelFile(id);
  void file
    .then(async (data) => {
      if (!data) {
        if (builtIn) unreachable.add(id);
        return;
      }
      templates.set(id, await parseModel(info.format, data));
      changed();
    })
    .catch((err) => console.warn(`Could not read the model ${info.name}:`, err))
    .finally(() => loading.delete(id));
  return null;
}

/**
 * A model's file → its scene (a glTF/GLB or FBX character). A VRM avatar (a GLB) is read as one too
 * (lib/vrm.ts): its meshes given their own toon looks (`ownLooks`), what it says of itself in `userData.vrm`.
 */
export async function parseModel(format: ModelInfo['format'], data: ArrayBuffer): Promise<THREE.Object3D> {
  if (format === 'fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    return new FBXLoader().parse(data, '');
  }
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const vrm = await readVrm(gltf);
  if (vrm) gltf.scene.userData.vrm = vrm;
  else ownTextures(gltf.scene);
  return gltf.scene;
}

/** A character painted with textures (not a VRM avatar) drawn in its own colours in the Toon style: every mesh, textured or not. */
function ownTextures(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const materialOf = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
  if (!meshes.some((mesh) => materialOf(mesh)?.map)) return;
  for (const mesh of meshes) {
    const m = materialOf(mesh);
    if (m?.color) ownLooks.set(mesh, paintedLook(m));
  }
}

/**
 * A character's file with what comes with it (`others`: its textures, a .gltf's buffers), as one
 * GLB (its textures in it, fitted within 1024 px): an FBX or a .gltf is kept as that.
 */
async function asGlb(format: ModelInfo['format'], data: ArrayBuffer, others: File[]): Promise<ArrayBuffer> {
  const urls = new Map(others.map((f) => [f.name.toLowerCase(), URL.createObjectURL(f)]));
  // (Asked for by name, wherever the file says it was: "Textures\Body.png", "C:/…/body.png".)
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => urls.get(decodeURIComponent(url).split(/[\\/]/).pop()!.toLowerCase()) ?? url);
  let busy = false;
  const loaded = new Promise<void>((done) => { manager.onLoad = () => done(); });
  manager.onStart = () => { busy = true; };
  try {
    let root: THREE.Object3D;
    if (format === 'fbx') {
      const [{ FBXLoader }, { TGALoader }] = await Promise.all([
        import('three/examples/jsm/loaders/FBXLoader.js'), import('three/examples/jsm/loaders/TGALoader.js'),
      ]);
      manager.addHandler(/\.tga$/i, new TGALoader(manager));
      root = new FBXLoader(manager).parse(data, '');
      // (Its textures load after it is read.)
      if (busy) await loaded;
    } else {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      root = (await new GLTFLoader(manager).parseAsync(data, '')).scene;
    }
    exportable(root);
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    return (await new GLTFExporter().parseAsync(root, { binary: true, maxTextureSize: 1024 })) as ArrayBuffer;
  } finally {
    for (const url of urls.values()) URL.revokeObjectURL(url);
  }
}

/**
 * Its meshes and textures made fit to be written. Of its geometry, what we draw (position, normal,
 * one set of texture coordinates, skin), each vertex once (an FBX's triangles each have their own).
 * Of its textures, only those the Toon style draws (its colour and glow: not
 * normal, roughness… maps); one that did not load (a file not chosen, a kind the browser cannot
 * read) left off (the character imported without it); one read as pixels (a TGA) drawn on a canvas
 * (the exporter fits a canvas within its size, but crops pixels); a JPEG where nothing shows through.
 */
const DRAWN = new Set(['position', 'normal', 'uv', 'skinIndex', 'skinWeight']);

function exportable(root: THREE.Object3D) {
  const merged = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let geometry = merged.get(mesh.geometry);
    if (!geometry) {
      for (const name of Object.keys(mesh.geometry.attributes)) if (!DRAWN.has(name)) mesh.geometry.deleteAttribute(name);
      geometry = mergeVertices(mesh.geometry);
      merged.set(mesh.geometry, geometry);
    }
    mesh.geometry = geometry;
    for (const m of [mesh.material].flat()) {
      const solid = !m.transparent && !m.alphaTest;
      const fields = m as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(fields)) {
        const texture = value as THREE.Texture | null;
        if (!texture?.isTexture) continue;
        const image = texture.image as { width?: number; height?: number; data?: ArrayLike<number> | null } | null;
        // (A TGA that did not load: its loader's 1 × 1 stand-in, without pixels.)
        if ((key !== 'map' && key !== 'emissiveMap') || !image?.width || !image.height || image.data === null) {
          fields[key] = null;
          continue;
        }
        if (image.data) {
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
          texture.image = canvas;
        }
        // (PNG if any material shows through it.)
        if (!solid && key === 'map') texture.userData.mimeType = 'image/png';
        else texture.userData.mimeType ??= 'image/jpeg';
      }
    }
  });
}

/**
 * Import a character: read its file (an FBX or a .gltf with `others`, its textures, kept as one
 * GLB), find its bones (`map`: mapped by hand), keep the file. Throws MissingBones when not all are
 * found (to map them by hand).
 */
export async function importModel(name: string, data: ArrayBuffer, map?: BoneMap, others: File[] = []): Promise<ModelInfo> {
  const ext = name.toLowerCase().split('.').pop();
  if (ext !== 'fbx' && ext !== 'glb' && ext !== 'gltf' && ext !== 'vrm') throw new Error('Use a VRM, glTF/GLB or FBX character');
  // (A GLB or VRM as it is: a VRM's own extensions, which the GLB made of it would not keep. A
  // .gltf too, unless files come with it.)
  if (ext === 'fbx' || (ext === 'gltf' && others.length)) data = await asGlb(ext === 'fbx' ? 'fbx' : 'glb', data, others);
  const format = 'glb';
  const root = await parseModel(format, data);
  if (!rigBones(root).some((o) => (o as THREE.Bone).isBone)) throw new Error('The file has no skeleton');
  // (A VRM says which bone is which; the rest, and others' bones, are found by their names: only
  // bones its humanoid does not already have, so none is taken for two.)
  const vrm = root.userData.vrm as VrmInfo | undefined;
  const taken = new Set(Object.values(vrm?.bones ?? {}));
  const byName = Object.fromEntries(Object.entries(mapBones(root)).filter(([, name]) => !taken.has(name!)));
  const bones = map ?? { ...byName, ...vrm?.bones };
  const missing = missingBones(bones);
  if (missing.length) throw new MissingBones(rigBones(root).map((o) => o.name), bones, missing);
  const info: ModelInfo = {
    id: uid('model'), name: name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Character', format, bones,
  };
  const proportions = characterProportions(root, bones);
  if (proportions) info.proportions = proportions;
  if (vrm?.credit) info.credit = vrm.credit;
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
