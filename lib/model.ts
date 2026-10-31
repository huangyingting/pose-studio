import { Springs, type SpringSpec } from './springs';
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
import { BONES, JOINTS, type Bone, type BodyParams, type Expression, type Face, type Figure, type JointName, type Hand, type ModelInfo, type Style } from './types';
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
  /** Their own looks, where the file gives them (a VRM avatar's, a painted one's): their materials in the Anime and 3D styles. */
  private looks: (ToonLook | undefined)[] = [];
  private toons: (THREE.Material | undefined)[] = [];
  private renders: (THREE.Material | undefined)[] = [];
  /** Their outline hulls (posed with them). */
  private hulls: THREE.Mesh[] = [];
  /** The face's features inked from its textures, by mesh (lib/features.ts): in the styles drawn with lines. */
  private features: (THREE.Mesh | undefined)[] = [];
  /**
   * What is cut out where its texture is clear (hair and lashes are cards, an eye has a clear cornea
   * over it), by mesh, and the colour it is drawn in: hair the line's, an eye, a brow or a lash
   * the style's own surface colour (its features inked over it); and the material made of each. An eye, a brow or a lash
   * wherever the face is inked (else a cornea hides the iris); the rest only where it is all drawn
   * in one colour (line art, minimal: in the shaded styles, in their own material).
   */
  private cut: ({ map: THREE.Texture; color: { value: THREE.Color }; face: boolean } | undefined)[] = [];
  private cuts: (THREE.ShaderMaterial | undefined)[] = [];
  private flat = false;
  /** The style's surface colour, what an eye, a brow or a lash is cut out in. */
  private surface = { value: new THREE.Color('#ffffff') };
  /** Its scalp (the skin under the hair, coloured as it): lined as the skin it is part of. */
  private scalp: boolean[] = [];
  /**
   * A tint over each of its meshes (not hair, an eye or a lash, cut out), as the mannequin's parts
   * are tinted: the selected joint's, or what a drag would move. By its bones: each bone's joint (a
   * finger's the hand's), each bone marked selected or under the pointer.
   */
  private glazes: Glaze[] = [];
  private selected: JointName | 'all' | null = null;
  private hover: ReadonlySet<JointName> | 'all' | null = null;

  constructor(template: THREE.Object3D, readonly info: ModelInfo, private ink: Ink) {
    const copy = cloneSkinned(template);
    // (Its hair and its skirt's spring bones, if it has them: lib/springs.ts.)
    const spec = template.userData.springs as SpringSpec | undefined;
    this.springs = spec ? new Springs(copy, spec) : null;
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
      const face = !hair && /eye|brow|lash/i.test(nameOf(mesh));
      return look?.map && (hair || look.alpha !== 'opaque') ? { map: look.map, color: hair ? ink.uniforms.color : this.surface, face } : undefined;
    });
    this.scalp = this.meshes.map((mesh) => /scalp/i.test((mesh.material as THREE.Material).name ?? ''));
    // Only the skin's and the face's are inked (a hood, a helmet or a hat over the head is drawn as
    // the clothes are: its dark cloth would ink solid): what is named so (or its material), or a character in one
    // piece; where its eyes and brows are meshes of their own, only they (the skin's texture,
    // shaded round the eyes, the nose and the mouth, would blot).
    const own = this.meshes.some((mesh) => /brow/i.test(nameOf(mesh)));
    const face = (name: string) => (own ? /eye|brow|lash/i : /body|head|face|eye|brow|lash/i).test(name) || this.meshes.length === 1;
    this.features = this.meshes.map((mesh, i) => (face(nameOf(mesh)) ? this.featuresOf(mesh, i) : undefined));
    this.glazes = this.meshes.flatMap((mesh, i) => (this.cut[i] ? [] : [this.glazeOf(mesh)]));
    // (Forward, +z, as its head has it at rest.)
    const rest = this.fitted.bones.get('head');
    if (rest) {
      this.object.updateMatrixWorld(true);
      this.headFront = new THREE.Vector3(0, 0, 1).applyQuaternion(rest.getWorldQuaternion(new THREE.Quaternion()).invert());
    }
    // Its face's shape keys (a VRM avatar's expressions: lib/vrm.ts), and what is drawn with each such mesh (its outline, its tint).
    this.faces = this.meshes.filter((mesh) => mesh.userData.faces && mesh.morphTargetInfluences).map((mesh) => {
      const with_: THREE.Mesh[] = [];
      this.object.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m !== mesh && m.geometry === mesh.geometry && m.morphTargetInfluences) with_.push(m); });
      return { mesh, keys: mesh.userData.faces as Partial<Record<Expression, [number, number][]>>, with: with_ };
    });
  }

  /** Where its head faces (world), for its face's shading; and that way in its head's own frame. */
  private faceFront = new THREE.Vector3(0, 0, 1);
  private headFront: THREE.Vector3 | null = null;

  /** Whether a mesh is its face's skin (not an eye, a brow, a lash or the mouth). */
  private faceSkin(i: number) {
    const mesh = this.meshes[i];
    const material = (mesh.material as THREE.Material).name ?? '';
    return /face/i.test(`${mesh.name} ${material}`) && /skin/i.test(material) && !/eye|brow|lash|mouth/i.test(material);
  }

  /** Its spring bones: its hair, its skirt, swinging as it moves. */
  private springs: Springs | null;

  /** The meshes with expressions, the shape keys each expression sets on them, and what is drawn with them. */
  private faces: { mesh: THREE.Mesh; keys: Partial<Record<Expression, [number, number][]>>; with: THREE.Mesh[] }[] = [];

  /** Show a face (a blink, the mouth talking, a feeling: lib/face.ts), or none: as made. */
  setFace(face: Face | undefined) {
    for (const { mesh, keys, with: others } of this.faces) {
      const inf = mesh.morphTargetInfluences!;
      for (const list of Object.values(keys)) for (const [i] of list!) inf[i] = 0;
      if (face) {
        for (const [name, list] of Object.entries(keys) as [Expression, [number, number][]][]) {
          const w = face[name];
          if (w) for (const [i, k] of list) inf[i] = Math.min(1, inf[i] + w * k);
        }
      }
      for (const o of others) o.morphTargetInfluences!.splice(0, inf.length, ...inf);
    }
  }

  /** A mesh's tint (hidden while nothing is tinted). */
  private glazeOf(mesh: THREE.Mesh): Glaze {
    // (Each of the rig's bones as its joint: a bone found, or the one above it; the hips' for those above them.)
    const joint = new Map<THREE.Object3D, JointName>();
    for (const [b, o] of this.fitted.bones) {
      let j: Bone = b;
      while (!(JOINTS as readonly Bone[]).includes(j)) j = PARENT[j as Exclude<Bone, 'hips'>];
      joint.set(o, j as JointName);
    }
    const jointOf = (o: THREE.Object3D | null) => {
      for (; o; o = o.parent) if (joint.has(o)) return joint.get(o)!;
      return 'hips';
    };
    const skinned = mesh as THREE.SkinnedMesh;
    const joints = skinned.isSkinnedMesh ? skinned.skeleton.bones.map(jointOf) : [jointOf(mesh)];
    const data = new Uint8Array(joints.length * 4);
    const mask = new THREE.DataTexture(data, joints.length, 1);
    const whole = { value: new THREE.Vector3() };
    const material = glazeMaterial(mask, whole);
    let g: THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      const sk = new THREE.SkinnedMesh(mesh.geometry, material);
      sk.bindMode = skinned.bindMode;
      sk.bind(skinned.skeleton, skinned.bindMatrix);
      g = sk;
    } else {
      g = new THREE.Mesh(mesh.geometry, material);
    }
    g.frustumCulled = false;
    g.renderOrder = 1;
    g.layers.set(LINES_LAYER);
    g.raycast = () => {};
    g.visible = false;
    mesh.add(g);
    return { mesh: g, joints, data, mask, whole, skinned: !!skinned.isSkinnedMesh };
  }

  /** Tint one joint's parts, or the whole figure (`all`), as selected. */
  setSelected(joint: JointName | null, all = false) {
    const next = all ? 'all' : joint;
    if (next === this.selected) return;
    this.selected = next;
    this.glaze();
  }

  /** Tint the parts a drag would move: these joints' parts, or the whole figure. */
  setHover(joints: readonly JointName[] | 'all' | null) {
    const next = joints === 'all' || joints === null ? joints : new Set(joints);
    const same = next instanceof Set && this.hover instanceof Set ? next.size === this.hover.size && [...next].every((j) => (this.hover as ReadonlySet<JointName>).has(j)) : next === this.hover;
    if (same) return;
    this.hover = next;
    this.glaze();
  }

  private glaze() {
    const { selected, hover } = this;
    const shown = (selected !== null || hover !== null) && !this.ink.ghost;
    for (const g of this.glazes) {
      g.mesh.visible = shown;
      if (!shown) continue;
      g.joints.forEach((j, k) => {
        // (A part picked: a clear tint; the whole figure: a faint one, its own.)
        g.data[k * 4] = selected === j ? 255 : 0;
        g.data[k * 4 + 1] = hover === 'all' || !!hover?.has(j) ? 255 : 0;
        g.data[k * 4 + 2] = selected === 'all' ? 255 : 0;
      });
      if (g.skinned) g.mask.needsUpdate = true;
      else g.whole.value.set(g.data[0] / 255, g.data[1] / 255, g.data[2] / 255);
    }
  }

  /** A mesh's face features, if it has a texture and is of the head. */
  private featuresOf(mesh: THREE.Mesh, i: number): THREE.Mesh | undefined {
    const map = this.looks[i]?.map;
    const head = this.fitted.bones.get('head');
    if (!map || !head) return undefined;
    const ofHead = new Set<THREE.Object3D>();
    head.traverse((o) => { ofHead.add(o); });
    const skinned = mesh as THREE.SkinnedMesh;
    let under = false;
    for (let o: THREE.Object3D | null = mesh.parent; o; o = o.parent) under ||= ofHead.has(o);
    const indices = new Set(skinned.isSkinnedMesh ? skinned.skeleton.bones.flatMap((b, k) => (ofHead.has(b) ? [k] : [])) : []);
    if (!weighHead(mesh.geometry, indices, !skinned.isSkinnedMesh && under)) return undefined;
    // (An eye: a mesh, or a part of the face drawn in a material, called so.)
    const named = `${mesh.name} ${(mesh.material as THREE.Material).name ?? ''}`;
    const material = featureMaterial(map, this.ink.uniforms.color, /eyes?\b|eyes?_|eyeiris/i.test(named) && !/brow|lash/i.test(named));
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

  /** Draw it in a style, its body tinted as the figure's colour (in Anime and 3D, in its own looks where it has them). */
  setLook(style: Style, tint: string | null) {
    this.style = style;
    const m = this.ink.materialsFor(style, tint ?? undefined);
    this.flat = !!m.skin;
    const body = m.body as THREE.Material & { color?: THREE.Color; uniforms?: { base?: { value: THREE.Color } } };
    this.surface.value.copy(body.uniforms?.base?.value ?? body.color ?? new THREE.Color('#ffffff'));
    this.meshes.forEach((mesh, i) => { mesh.material = this.own(i) ?? this.cutOf(i) ?? m.skin ?? m.body; });
    // (Its face from its textures in the styles drawn with lines; in its own look, the look has it.)
    this.features.forEach((f, i) => { if (f) f.visible = !this.own(i) && !this.ink.ghost && this.inked(); });
    this.setLinked(this.linked);
  }

  /** A mesh's cut-out material, where it is drawn in one colour, cut out (made once). */
  private cutOf(i: number): THREE.ShaderMaterial | undefined {
    const cut = this.cut[i];
    if (!cut || this.ink.ghost || !(this.flat || (cut.face && this.inked()))) return undefined;
    return (this.cuts[i] ??= cutoutMaterial(cut.map, cut.color));
  }

  /** Whether its face is inked: in the styles drawn with lines (not Clay's value study, nor 3D; Anime and Pixel in the character's own look). */
  private inked() {
    return !styleDef(this.style).toon && !!styleDef(this.style).outline;
  }

  /** A mesh's own look's material: toon-shaded in Anime and Pixel, as a 3D tool draws it in 3D (made once). */
  private own(i: number): THREE.Material | undefined {
    const look = this.looks[i];
    if (!look || this.ink.ghost) return undefined;
    if (styleDef(this.style).toon) {
      if (!this.toons[i]) {
        const m = toonMaterial(look, this.ink.uniforms);
        // (Its face's skin shaded as anime faces are: by where the head faces, a clean shadow across it.)
        if (this.faceSkin(i)) {
          m.uniforms.faceSmooth.value = 0.6;
          m.uniforms.faceFront.value = this.faceFront;
        }
        this.toons[i] = m;
      }
      return this.toons[i];
    }
    if (this.style === 'render') return (this.renders[i] ??= standardOf(look));
    return undefined;
  }

  /** Outline it in the accent (linked to the pointer elsewhere), whatever the style. */
  setLinked(on: boolean) {
    this.linked = on;
    const outlined = !!styleDef(this.style).outline;
    this.hulls.forEach((h, i) => {
      // (In its own look: its own outline, or none; none where it is cut out or see-through.)
      const own = styleDef(this.style).toon && this.own(i) ? this.looks[i]! : null;
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
    // (Its hair and skirt on from where they were, as it moves.)
    this.springs?.update(fig.t);
    // (Where its head faces now, for its face's shading.)
    const head = this.fitted.bones.get('head');
    if (head && this.headFront) this.faceFront.copy(this.headFront).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())).normalize();
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
    for (const m of [...this.toons, ...this.renders]) m?.dispose();
    for (const f of this.features) (f?.material as THREE.Material | undefined)?.dispose();
    for (const m of this.cuts) m?.dispose();
    for (const g of this.glazes) { (g.mesh.material as THREE.Material).dispose(); g.mask.dispose(); }
    this.object.clear();
  }
}

/** A look as a 3D tool draws it (the 3D style): its colour and texture, its see-through parts, lit and shadowed by the scene's lights. */
/** A mesh's tint and what it is tinted by: each bone's joint and its marks (the part picked, under the pointer, the whole figure picked), or the mesh's own (`whole`) where it is not skinned. */
type Glaze = { mesh: THREE.Mesh; joints: JointName[]; data: Uint8Array; mask: THREE.DataTexture; whole: { value: THREE.Vector3 }; skinned: boolean };

const SELECTED = new THREE.Color('#3b78ff');
const HOVERED = new THREE.Color('#7ba4ff');

/** The tint over a character's mesh: by how much each vertex goes with the marked bones, selected over under the pointer. */
function glazeMaterial(mask: THREE.Texture, whole: { value: THREE.Vector3 }) {
  return new THREE.ShaderMaterial({
    uniforms: { mask: { value: mask }, whole, selected: { value: SELECTED }, hovered: { value: HOVERED } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    vertexShader: /* glsl */ `
      #include <morphtarget_pars_vertex>
      #include <skinning_pars_vertex>
      uniform sampler2D mask;
      uniform vec3 whole;
      varying vec3 vOn;
      vec3 marks(float bone) { return texelFetch(mask, ivec2(int(bone + 0.5), 0), 0).rgb; }
      void main() {
        #ifdef USE_SKINNING
          vOn = skinWeight.x * marks(skinIndex.x) + skinWeight.y * marks(skinIndex.y) + skinWeight.z * marks(skinIndex.z) + skinWeight.w * marks(skinIndex.w);
        #else
          vOn = whole;
        #endif
        #include <begin_vertex>
        #include <morphtarget_vertex>
        #include <skinbase_vertex>
        #include <skinning_vertex>
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 selected;
      uniform vec3 hovered;
      varying vec3 vOn;
      void main() {
        float s = max(smoothstep(0.2, 0.6, vOn.x) * 0.45, vOn.z * 0.14);
        float h = smoothstep(0.2, 0.6, vOn.y) * 0.32;
        if (max(s, h) < 0.01) discard;
        gl_FragColor = s >= h ? vec4(selected, s) : vec4(hovered, h);
        #include <colorspace_fragment>
      }`,
  });
}

function standardOf(look: ToonLook) {
  return new THREE.MeshStandardMaterial({
    color: look.color, map: look.map, opacity: look.opacity, transparent: look.alpha === 'blend', alphaTest: look.alpha === 'mask' ? look.cutoff : 0,
    side: look.doubleSided ? THREE.DoubleSide : THREE.FrontSide, emissive: look.emissive, emissiveMap: look.emissiveMap, roughness: 0.75, metalness: 0,
  });
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

/** A model's file is here now (synced): asked for at once, whatever failed before. */
export function modelArrived(id: string) {
  failedAt.delete(id);
  unreachable.delete(id);
  return modelTemplate(id);
}

/** A model, as read from its file (null until it has been: reading starts now). */
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

/** A character painted with textures (not a VRM avatar) drawn in its own colours in the Anime and 3D styles: every mesh, textured or not. */
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
 * Of its textures, only those the Anime and 3D styles draw (its colour and glow: not
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
