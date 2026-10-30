import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadModelFile, saveModelFile } from './assetstore';
import { BUILT_IN_CHARACTERS, characterFile, isBuiltInCharacter } from './characters';
import { legsOf } from './locomotion';
import { setWorldQuaternion } from './mannequin';
import { FINGER_CURL, FINGER_NAMES as FINGERS4, FINGER_SPREAD, SEGMENTS, fingerBones, PARENT, worldTurns } from './skeleton';
import { toQuat, type Bones } from './pose';
import { LINES_LAYER, idMaterialOf, type Ink } from './ink';
import { styleDef } from './styles';
import { BONES, JOINTS, type Bone, type BodyParams, type Figure, type JointName, type Hand, type ModelInfo, type Style } from './types';
import { uid } from './uid';
import { readVrm, type VrmInfo } from './vrm';
import { ownLooks, paintedLook, toonMaterial, type ToonLook } from './toon';
import { CUTOFF, cutoutMaterial, featureMaterial, weighHead } from './features';

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
    const toes = foot && onward(foot);
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
    for (let o: THREE.Object3D | undefined = start; o && chain.length < 3; o = onward(o)) chain.push(o);
    const segs = finger[0] === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    chain.forEach((o, i) => put(`${side}${finger[0]}${segs[i]}` as Bone, o));
  }
}

/**
 * The bone a chain goes on to from one: its child bone furthest from it (some rigs give a bone a
 * child of the same name where it is, holding nothing, beside the next joint).
 */
function onward(o: THREE.Object3D): THREE.Object3D | undefined {
  let best: THREE.Object3D | undefined;
  for (const c of o.children) if (isBone(c) && (!best || c.position.lengthSq() > best.position.lengthSq())) best = c;
  return best;
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
  /** Each hand's axes in the T-pose (fingerTurns): what its fingers curl about, its palm's way, its thumb's fold. */
  private hands = new Map<'left' | 'right', { curl: THREE.Vector3; palm: THREE.Vector3; thumb: { axis: THREE.Vector3; angle: number } | null }>();

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
    // Each hand as the T-pose has it: which way its palm faces (fingers curl towards it), and the
    // way its thumb folds into a fist: a model's own.
    for (const side of ['left', 'right'] as const) {
      const turn = swing.get(`${side}Hand`) ?? new THREE.Quaternion();
      const T = (b: Bone) => at(b)?.applyQuaternion(turn) ?? null;
      const [index, little] = [T(`${side}IndexProximal`), T(`${side}LittleProximal`) ?? T(`${side}RingProximal`)];
      if (!index || !little) continue;
      const out = new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0);
      const across = index.clone().sub(little).normalize();
      const palm = (side === 'left' ? out.clone().cross(across) : across.clone().cross(out)).normalize();
      // (The thumb, in a fist, lies across the curled index and middle fingers' middle segments:
      // turned from where it points to there.)
      const curl = out.clone().cross(palm).normalize();
      const fisted = (f: 'Index' | 'Middle') => {
        const [p0, p1, p2] = (['Proximal', 'Intermediate', 'Distal'] as const).map((seg) => T(`${side}${f}${seg}`));
        if (!p0 || !p1 || !p2) return null;
        const turn = (p: THREE.Vector3, about: THREE.Vector3, angle: number) => p.clone().sub(about).applyAxisAngle(curl, angle).add(about);
        const q1 = turn(p1, p0, FINGER_CURL[0]);
        const q2 = turn(turn(p2, p0, FINGER_CURL[0]), q1, FINGER_CURL[1]);
        return q1.add(q2).multiplyScalar(0.5);
      };
      const [i1, m1] = [fisted('Index'), fisted('Middle')];
      const base = T(`${side}ThumbMetacarpal`) ?? T(`${side}ThumbProximal`);
      const tip = T(`${side}ThumbDistal`) ?? T(`${side}ThumbProximal`);
      let thumb: { axis: THREE.Vector3; angle: number } | null = null;
      if (base && tip && i1 && tip.distanceTo(base) > 1e-6) {
        const over = (m1 ? i1.clone().add(m1).multiplyScalar(0.5) : i1).addScaledVector(palm, 0.25 * index.distanceTo(little));
        const q = new THREE.Quaternion().setFromUnitVectors(tip.clone().sub(base).normalize(), over.sub(base).normalize());
        const axis = new THREE.Vector3(q.x, q.y, q.z);
        if (axis.lengthSq() > 1e-12) thumb = { axis: axis.normalize(), angle: 2 * Math.acos(Math.min(1, q.w)) };
      }
      this.hands.set(side, { curl, palm, thumb });
    }
  }

  /**
   * The finger bones' turns (local, as the skeleton has them) for hands as the presets have them:
   * each finger curled towards this model's palm, spread about it, the thumb folded its own way (a
   * hand it cannot tell: as a T-pose's usually is, palm down).
   */
  fingerTurns(hands: Record<Side, Hand>): Bones {
    const out = fingerBones(hands);
    const about = (axis: THREE.Vector3, angle: number) => toQuat(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    for (const s of ['L', 'R'] as const) {
      const side = s === 'L' ? 'left' : 'right';
      const hand = this.hands.get(side);
      if (!hand) continue;
      const h = hands[s];
      const k = s === 'L' ? -1 : 1;
      FINGERS4.forEach((f, i) => SEGMENTS.forEach((seg, n) => {
        const curl = new THREE.Quaternion().setFromAxisAngle(hand.curl, FINGER_CURL[n] * h.curl[i + 1]);
        const spread = n === 0 ? new THREE.Quaternion().setFromAxisAngle(hand.palm, k * FINGER_SPREAD[i] * h.spread) : new THREE.Quaternion();
        out[`${side}${f}${seg}` as Bone] = toQuat(spread.multiply(curl));
      }));
      if (hand.thumb) {
        // (Aimed there from its root; its joints bend on the same way, round the fingers; out from
        // the palm as the hand spreads.)
        const { axis, angle } = hand.thumb;
        const c = h.curl[0];
        out[`${side}ThumbMetacarpal` as Bone] = about(axis, angle * c - 0.3 * h.spread);
        out[`${side}ThumbProximal` as Bone] = about(axis, 0.35 * c);
        out[`${side}ThumbDistal` as Bone] = about(axis, 0.45 * c);
      }
    }
    return out;
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

/** What a character's eyes, brows and lashes are drawn in where the face is inked. */
const WHITE = { value: new THREE.Color('#ffffff') };

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
  /** The face's features inked from its textures, by mesh (lib/features.ts): for the styles that draw it in one colour. */
  private features: (THREE.Mesh | undefined)[] = [];
  /**
   * Where the face is inked, what is cut out where its texture is clear (hair and lashes are cards,
   * an eye has a clear cornea over it), by mesh, and the colour it is drawn in: hair the line's, an
   * eye, a brow or a lash white (its features inked over it); and the material made of each.
   */
  private cut: ({ map: THREE.Texture; color: { value: THREE.Color } } | undefined)[] = [];
  private cuts: (THREE.ShaderMaterial | undefined)[] = [];
  /** Drawn in one colour (line art, minimal): its cut-outs then; in the shaded styles, their own material. */
  private flat = false;
  /** Its scalp (the skin under the hair, coloured as it): lined as the skin it is part of. */
  private scalp: boolean[] = [];

  constructor(template: THREE.Object3D, readonly info: ModelInfo, private ink: Ink) {
    const copy = cloneSkinned(template);
    // (The copy's meshes in the same order as the model's, whose looks they take.)
    template.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.looks.push(ownLooks.get(o)); });
    // (Its bones as its entry names them, or, where the file has other names (one cached from
    // before it was remade), as they are found in it: never a figure without its hips.)
    const named = (['hips', 'head', 'leftUpperLeg', 'rightUpperLeg'] as const).every((b) => info.bones[b] && copy.getObjectByName(info.bones[b]!));
    this.fitted = new Fitted(copy, named ? info.bones : mapBones(copy));
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
      hull.layers.set(LINES_LAYER);
      hull.raycast = () => {};
      mesh.add(hull);
      this.hulls.push(hull);
    }
    const nameOf = (mesh: THREE.Mesh) => `${mesh.name} ${(mesh.material as THREE.Material).name ?? ''}`;
    this.cut = this.meshes.map((mesh, i) => {
      const look = this.looks[i];
      const hair = /hair/i.test(nameOf(mesh));
      return look?.map && (hair || look.alpha !== 'opaque') ? { map: look.map, color: hair ? ink.uniforms.color : WHITE } : undefined;
    });
    this.scalp = this.meshes.map((mesh) => /scalp/i.test((mesh.material as THREE.Material).name ?? ''));
    // (Where its eyes and brows are meshes of their own, only they are inked: the skin's texture,
    // shaded round the eyes, the nose and the mouth, would blot.)
    const own = this.meshes.some((mesh) => /brow/i.test(nameOf(mesh)));
    this.features = this.meshes.map((mesh, i) => (own && !/eye|brow|lash/i.test(nameOf(mesh)) ? undefined : this.featuresOf(mesh, i, nameOf(mesh))));
  }

  /** A mesh's face features, if it has a texture and is of the head (not its hair). */
  private featuresOf(mesh: THREE.Mesh, i: number, named: string): THREE.Mesh | undefined {
    const map = this.looks[i]?.map;
    const head = this.fitted.bones.get('head');
    if (!map || !head || /hair|hat|helmet|cap\b/i.test(named)) return undefined;
    const ofHead = new Set<THREE.Object3D>();
    head.traverse((o) => { ofHead.add(o); });
    const skinned = mesh as THREE.SkinnedMesh;
    let under = false;
    for (let o: THREE.Object3D | null = mesh.parent; o; o = o.parent) under ||= ofHead.has(o);
    const indices = new Set(skinned.isSkinnedMesh ? skinned.skeleton.bones.flatMap((b, k) => (ofHead.has(b) ? [k] : [])) : []);
    if (!weighHead(mesh.geometry, indices, !skinned.isSkinnedMesh && under)) return undefined;
    const material = featureMaterial(map, this.ink.uniforms.color, /\beyes?\b/i.test(named) && !/brow|lash/i.test(named));
    let f: THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      const sk = new THREE.SkinnedMesh(mesh.geometry, material);
      sk.bindMode = skinned.bindMode;
      sk.bind(skinned.skeleton, skinned.bindMatrix);
      f = sk;
    } else {
      f = new THREE.Mesh(mesh.geometry, material);
    }
    f.frustumCulled = false;
    f.renderOrder = 2;
    f.layers.set(LINES_LAYER);
    f.raycast = () => {};
    mesh.add(f);
    return f;
  }

  private linked = false;
  private style: Style = 'line';

  /** Draw it in a style, its body tinted as the figure's colour (in Toon, in its own looks where it has them). */
  setLook(style: Style, tint: string | null) {
    this.style = style;
    const m = this.ink.materialsFor(style, tint ?? undefined);
    this.flat = !!m.skin;
    this.meshes.forEach((mesh, i) => { mesh.material = this.own(i) ?? this.cutOf(i) ?? m.skin ?? m.body; });
    // (Its face from its textures where it is drawn in one colour; in its own look, the look has it.)
    this.features.forEach((f, i) => { if (f) f.visible = !this.own(i) && !this.ink.ghost && style !== 'toon'; });
    this.setLinked(this.linked);
  }

  /** A mesh's cut-out material, where it is drawn in one colour, cut out (made once; only in the styles drawn in one colour). */
  private cutOf(i: number): THREE.ShaderMaterial | undefined {
    const cut = this.cut[i];
    if (!cut || this.ink.ghost || !this.flat) return undefined;
    return (this.cuts[i] ??= cutoutMaterial(cut.map, cut.color));
  }

  /** A mesh's own look's material, in the Toon style (made once). */
  private own(i: number): THREE.ShaderMaterial | undefined {
    const look = this.looks[i];
    if (this.style !== 'toon' || !look || this.ink.ghost) return undefined;
    return (this.toons[i] ??= toonMaterial(look, this.ink.uniforms));
  }

  /** Outline it in the accent (linked to the pointer elsewhere), whatever the style. */
  setLinked(on: boolean) {
    this.linked = on;
    const outlined = !!styleDef(this.style).outline;
    this.hulls.forEach((h, i) => {
      // (In its own look: its own outline, or none; none where it is cut out or see-through.)
      const own = this.own(i) ? this.looks[i]! : null;
      const look = own?.outline;
      const cutout = own && own.alpha !== 'opaque' && own.map ? { map: own.map, cutoff: own.alpha === 'mask' ? own.cutoff : 0.5 }
        : this.cutOf(i) ? { map: this.cut[i]!.map, cutoff: CUTOFF } : undefined;
      h.material = on ? this.ink.linked : look || cutout ? this.ink.outlineAs(look?.width ?? 1, look?.color ?? null, cutout) : this.ink.outline;
      h.visible = on || (outlined && (!look || look.width > 0));
    });
  }

  /** Flat per-part colours for the line pass (as the mannequin's parts), or back as they were; returns the next free id. */
  setIdMode(on: boolean, firstId: number) {
    this.meshes.forEach((mesh, i) => {
      // (The scalp as the skin it is part of: no line round it. Hair only where it is drawn.)
      const as = this.scalp[i] ? this.meshes.findIndex((m, k) => !this.scalp[k] && m.parent === mesh.parent) : -1;
      const cut = this.cutOf(i) && { map: this.cut[i]!.map, cutoff: CUTOFF };
      idMaterialOf(mesh, on ? this.ink.idMaterial(firstId + (as >= 0 ? as : i), false, cut) : null);
    });
    return firstId + this.meshes.length;
  }

  /** Pose it as the figure is; `hips`: where the mannequin's hips are (it rests on what it stands on). */
  apply(fig: Figure, hips: THREE.Vector3) {
    this.scaleTo(fig.body);
    const bones = Object.keys(fig.bones).some((b) => /Proximal$/.test(b)) ? fig.bones : { ...this.fitted.fingerTurns(fig.hands), ...fig.bones };
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
    const one = new THREE.Box3();
    for (const mesh of this.meshes) {
      // (A skinned mesh's box as it is posed now, not kept from before; not its outline's.)
      const skinned = mesh as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh) skinned.computeBoundingBox();
      else if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(one.copy(skinned.isSkinnedMesh ? skinned.boundingBox! : mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld));
    }
    if (box.isEmpty()) return;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) cb(new THREE.Vector3(x, y, z));
  }

  /** (Its geometry and textures are the model's, shared by every figure drawn as it.) */
  dispose() {
    for (const m of this.toons) m?.dispose();
    for (const f of this.features) (f?.material as THREE.Material | undefined)?.dispose();
    for (const m of this.cuts) m?.dispose();
    this.object.clear();
  }
}

/** The body of the mannequin under a figure drawn as a character: the character's own (a built-in's), or the figure's. */
export function bodyFor(f: Figure, id: string): BodyParams {
  const info = infos.get(id);
  return info?.body ? { ...info.body } : f.body;
}

/* ---------- the library's models: their files read when a figure is first drawn as one ---------- */

const infos = new Map<string, ModelInfo>();
const templates = new Map<string, THREE.Object3D>();
const loading = new Set<string>();
/** When a model's file last could not be got: asked for again after RETRY_MS. */
const failedAt = new Map<string, number>();
const RETRY_MS = 30_000;
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
/** A model's file is here now (synced): asked for at once, whatever failed before. */
export function modelArrived(id: string) {
  failedAt.delete(id);
  unreachable.delete(id);
  return modelTemplate(id);
}

export function modelTemplate(id: string): THREE.Object3D | null {
  const hit = templates.get(id);
  const info = infos.get(id);
  if (hit || !info || loading.has(id) || unreachable.has(id) || Date.now() - (failedAt.get(id) ?? -Infinity) < RETRY_MS) return hit ?? null;
  loading.add(id);
  // A built-in character's file comes with the app; an imported one's is kept as an asset (it may
  // come later, synced: none yet is no failure).
  const builtIn = isBuiltInCharacter(id);
  // Not got (offline, the server, the browser's storage): asked for again after a while (the
  // scene woken to ask then). Got but not readable: not again this visit.
  const later = (err?: unknown) => {
    failedAt.set(id, Date.now());
    setTimeout(changed, RETRY_MS);
    if (err) console.warn(`Could not get the model ${info.name}:`, err);
  };
  const file = builtIn ? fetch(characterFile(id)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`)))) : loadModelFile(id);
  void file
    .then(async (data) => {
      if (!data) return;
      try {
        templates.set(id, await parseModel(info.format, data));
        changed();
      } catch (err) {
        unreachable.add(id);
        console.warn(`Could not read the model ${info.name}:`, err);
      }
    }, later)
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
  gltf.scene.traverse((o) => {
    const node = gltf.parser.associations.get(o)?.nodes;
    if (node !== undefined) nodeOf.set(o, node);
  });
  const vrm = await readVrm(gltf);
  if (vrm) gltf.scene.userData.vrm = vrm;
  else ownTextures(gltf.scene);
  return gltf.scene;
}

/** Which of its file's nodes each object of a glTF scene was read from. */
const nodeOf = new WeakMap<THREE.Object3D, number>();

/**
 * A glTF/GLB file with some of its nodes renamed (`names`: by node), all else as it was (a VRM's
 * own extensions too).
 */
function renamed(data: ArrayBuffer, names: Map<number, string>): ArrayBuffer {
  const bytes = new Uint8Array(data);
  const glb = new DataView(data).getUint32(0, true) === 0x46546c67;
  const length = glb ? new DataView(data).getUint32(12, true) : data.byteLength;
  const json = JSON.parse(new TextDecoder().decode(glb ? bytes.subarray(20, 20 + length) : bytes)) as { nodes?: { name?: string }[] };
  const nodes = json.nodes ?? [];
  // (A node of another name that already has one of the new names gives it up.)
  const taken = new Set(names.values());
  nodes.forEach((n, i) => { if (!names.has(i) && n.name && taken.has(n.name)) n.name = `${n.name}_`; });
  for (const [i, name] of names) nodes[i].name = name;
  const text = new TextEncoder().encode(JSON.stringify(json));
  if (!glb) return text.buffer as ArrayBuffer;
  const padded = Math.ceil(text.length / 4) * 4;
  const rest = bytes.subarray(20 + length);
  const out = new Uint8Array(20 + padded + rest.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + padded);
  out.set(rest, 20 + padded);
  return out.buffer;
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
      for (const [name, attr] of Object.entries(mesh.geometry.attributes)) {
        if (!DRAWN.has(name)) mesh.geometry.deleteAttribute(name);
        // (Merged as plain arrays: a glTF's interleaved ones copied out.)
        else if ((attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) mesh.geometry.setAttribute(name, attr.clone());
      }
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
  // Its bones named as our skeleton's, in the file kept and as read (a character of ours).
  const names = new Map<number, string>();
  const ours: BoneMap = {};
  for (const [bone, was] of Object.entries(bones) as [Bone, string][]) {
    const o = root.getObjectByName(was);
    const node = o && nodeOf.get(o);
    // (Not one of its file's nodes: as it is.)
    if (node === undefined) {
      ours[bone] = was;
      continue;
    }
    // (A bone two parts were mapped to, by hand, takes the first one's name; both are on it.)
    if (!names.has(node)) names.set(node, bone);
    ours[bone] = names.get(node)!;
  }
  data = renamed(data, names);
  const given = new Set(names.values());
  root.traverse((o) => {
    const node = nodeOf.get(o);
    if (node !== undefined && names.has(node)) o.name = names.get(node)!;
    else if (given.has(o.name)) o.name = `${o.name}_`;
  });
  const info: ModelInfo = {
    id: uid('model'), name: name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Character', format, bones: ours,
  };
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
