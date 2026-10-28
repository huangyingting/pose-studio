import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEFAULT_BODY } from './body';
import { partFromPoses } from './clip';
import { parseClip } from './doc';
import { detectContacts } from './constraints';
import { RELAXED_HAND, cloneHand } from './hands';
import { legsOf } from './locomotion';
import { Fitted, MissingBones, mapBones, missingBones, rigBones, type BoneMap } from './model';
import { toQuat, type Bones } from './pose';
import { PARENT } from './skeleton';
import { uid } from './uid';
import { BONES, type Bone, type Clip, type Pose, type Vec3 } from './types';
import { refineClip } from './motionfix';

/*
 * Importing a motion from another tool: BVH (motion capture), FBX (e.g. Mixamo) or glTF/GLB with
 * an animation. Its skeleton is fitted to ours (lib/model.ts: which bone is which, how it stands,
 * its T-pose), and each frame's bones are read straight into the skeleton's, fingers and toes
 * too; the hips' travel is scaled to the mannequin's size. A file with several people (skeletons)
 * becomes a clip of several parts, placed as they are in it. Where the feet stay on the floor is
 * found afterwards (contacts), so they stay planted when it plays.
 */

/** Frames kept per second of motion. */
const RATE = 30;
const MAX_SECONDS = 30;

export interface MotionSource {
  name: string;
  root: THREE.Object3D;
  clip: THREE.AnimationClip;
}

/** Read a motion file: BVH, FBX or glTF/GLB (its first animation). */
export async function readMotionFile(name: string, data: ArrayBuffer): Promise<MotionSource> {
  const ext = name.toLowerCase().split('.').pop();
  const title = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Motion';
  if (ext === 'bvh') {
    const r = new BVHLoader().parse(new TextDecoder().decode(data));
    const root = new THREE.Group();
    root.add(r.skeleton.bones[0]);
    return { name: title, root, clip: r.clip };
  }
  if (ext === 'fbx') {
    const root = new FBXLoader().parse(data, '');
    if (!root.animations[0]) throw new Error('The file has no animation');
    return { name: title, root, clip: root.animations[0] };
  }
  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await new GLTFLoader().parseAsync(data, '');
    if (!gltf.animations[0]) throw new Error('The file has no animation');
    return { name: title, root: gltf.scene, clip: gltf.animations[0] };
  }
  throw new Error('Use a BVH, FBX, glTF or GLB file');
}

/** The skeletons in a file: the top bone above each pair of hands. */
function skeletons(root: THREE.Object3D): THREE.Object3D[] {
  const tops: THREE.Object3D[] = [];
  for (const o of rigBones(root)) {
    if (!/hand|wrist/i.test(o.name) || !/left|(^|[^a-z])l([^a-z]|$)|^L[A-Z]/i.test(o.name)) continue;
    let top = o;
    while (top.parent && (top.parent as THREE.Bone).isBone) top = top.parent;
    if (!tops.includes(top) && !tops.some((t) => t.getObjectById(o.id))) tops.push(top);
  }
  return tops.length > 1 ? tops : [root];
}

/** Turn a motion into one of ours: a clip of one part per person in it, at RATE frames a second. `map`: the bones, mapped by hand. */
export function retargetMotion(src: MotionSource, map?: BoneMap): Clip {
  const roots = map ? [src.root] : skeletons(src.root);
  const maps = roots.map((r) => {
    const m = map ?? mapBones(r);
    const missing = missingBones(m);
    if (missing.length) throw new MissingBones(rigBones(src.root).map((o) => o.name), m, missing);
    return m;
  });
  // The first person stands the file up; everyone else keeps their place and facing in it.
  const first = new Fitted(src.root, maps[0]);
  const people = [first, ...maps.slice(1).map((m) => new Fitted(src.root, m, first.frame))];
  const legs = legsOf(DEFAULT_BODY);
  const scale = (legs.rootY - legs.ankleY) / first.hipHeight;

  const mixer = new THREE.AnimationMixer(src.root);
  // Played once and held at the end, so the last frame is not the first again.
  const action = mixer.clipAction(src.clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const duration = Math.min(MAX_SECONDS, src.clip.duration || 1 / RATE);
  const count = Math.max(2, Math.round(duration * RATE) + 1);
  const frames: { bones: Bones; hips: THREE.Vector3; ankle: number }[][] = [];
  try {
    for (let i = 0; i < count; i++) {
      mixer.setTime((duration * i) / (count - 1));
      frames.push(people.map((p) => {
        const world = p.read();
        const bones: Bones = {};
        for (const b of BONES) {
          if (b !== 'hips' && !p.bones.has(b)) continue;
          const local = b === 'hips' ? world.get(b)! : world.get(PARENT[b as Exclude<Bone, 'hips'>])!.clone().invert().multiply(world.get(b)!);
          bones[b] = toQuat(local);
        }
        return { bones, hips: p.at('hips')!, ankle: Math.min(p.at('leftFoot')!.y, p.at('rightFoot')!.y) };
      }));
    }
  } finally {
    mixer.stopAllAction();
    first.frame.remove(src.root);
  }
  // Feet on the floor: the lowest the ankles go over the clip is ankle height.
  const ground = Math.min(...frames.flat().map((f) => f.ankle));
  const start = frames[0][0].hips.clone();
  const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
  const name = src.name.slice(0, 80);
  const parts = people.map((_, n) => {
    const keys = frames.map((frame, i): { t: number; pose: Pose } => {
      const { bones, hips } = frame[n];
      const position: Vec3 = [r3((hips.x - start.x) * scale), r3((hips.y - ground) * scale + legs.ankleY), r3((hips.z - start.z) * scale)];
      return { t: r3((duration * i) / (count - 1)), pose: { bones, position, hands: { L: cloneHand(RELAXED_HAND), R: cloneHand(RELAXED_HAND) }, grounded: false } };
    });
    return partFromPoses(people.length > 1 ? `${name} ${n + 1}` : name, keys, 'linear', DEFAULT_BODY);
  });
  // (Each person facing where they look, the wrists' roll the forearms': lib/motionfix.ts.)
  const clip = refineClip({ id: uid('clip'), name, duration: r3(duration), loop: false, parts, events: [], contacts: [] });
  return { ...clip, contacts: parts.flatMap((_, n) => detectContacts(clip, n, RATE)) };
}

/** Read and retarget a motion file in one go. */
export async function importMotion(name: string, data: ArrayBuffer, map?: BoneMap): Promise<Clip> {
  if (name.toLowerCase().endsWith('.json')) return nativeMotion(data);
  return retargetMotion(await readMotionFile(name, data), map);
}

/** A motion saved in our own format (a clip's JSON), under a new id so that it is listed as its own. */
function nativeMotion(data: ArrayBuffer): Clip {
  let clip: Clip | null = null;
  try {
    clip = parseClip(JSON.parse(new TextDecoder().decode(data)));
  } catch {
    clip = null;
  }
  if (!clip) throw new Error('Not a Pose Studio motion file');
  return { ...clip, id: uid('clip') };
}
