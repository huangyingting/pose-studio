import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEFAULT_FPS, poseOf } from './animation';
import { DEFAULT_BODY } from './body';
import { newFigure, newScene, uid } from './doc';
import { legsOf } from './locomotion';
import { Rig } from './relations';
import { LM, retarget, type Landmark3D } from './retarget';
import type { Keyframe, MotionAsset, PoseKey, Vec3 } from './types';

/*
 * Importing a motion from another tool: BVH (motion capture), FBX (e.g. Mixamo) or glTF/GLB with
 * an animation. As in game engines' humanoid retargeting: the skeleton's bones are matched to
 * ours by their names, each frame becomes landmarks (shoulders, elbows, wrists, hips, knees,
 * ankles, toes, head) that the photo retargeting already turns into joint angles, and the travel
 * of the hips is scaled to the mannequin's size. Bone axes differ from tool to tool, so turns of
 * the head, hands and feet are measured against the skeleton's rest pose rather than read raw.
 */

/** Frames kept per second of motion. */
const RATE = 15;
const MAX_SECONDS = 30;

type Side = 'L' | 'R';
type Part = 'hips' | 'neck' | 'head' | 'upperArm' | 'foreArm' | 'hand' | 'upperLeg' | 'lowerLeg' | 'foot' | 'toe';

/** Names each part goes by in common rigs (Mixamo, CMU/BVH, Unreal, 3ds Max Biped, VRM, generic), most specific first. */
const NAMES: Record<Part, string[]> = {
  hips: ['hips', 'hip', 'pelvis', 'root'],
  neck: ['neck'],
  head: ['head'],
  upperArm: ['upperarm', 'arm', 'uparm', 'humerus', 'shoulder'],
  foreArm: ['forearm', 'lowerarm', 'elbow', 'lowarm'],
  hand: ['hand', 'wrist'],
  upperLeg: ['upleg', 'upperleg', 'thigh', 'femur', 'hip'],
  lowerLeg: ['leg', 'lowerleg', 'knee', 'shin', 'calf', 'lowleg'],
  foot: ['foot', 'ankle'],
  toe: ['toebase', 'toes', 'toe', 'toe0', 'ball'],
};
const SIDED: Part[] = ['upperArm', 'foreArm', 'hand', 'upperLeg', 'lowerLeg', 'foot', 'toe'];

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
    // The first of numbered bones: "neck_01", "upperleg01", "Neck1".
    .replace(/(?<=[a-z])0*1$/, '');
}

/** The bones of a rig, matched to the parts we need. */
function matchBones(root: THREE.Object3D) {
  const found: Partial<Record<string, THREE.Object3D>> = {};
  const all: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.name && ((o as THREE.Bone).isBone || o.type === 'Object3D' || o.type === 'Group')) all.push(o); });
  for (const part of Object.keys(NAMES) as Part[]) {
    for (const side of SIDED.includes(part) ? (['L', 'R'] as const) : [null]) {
      for (const name of NAMES[part]) {
        const hit = all.find((o) => baseOf(o.name) === name && sideOf(o.name) === side);
        if (hit) {
          found[side ? `${part}${side}` : part] = hit;
          break;
        }
      }
    }
  }
  const missing = ['hips', 'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR', 'footL', 'footR', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR']
    .filter((k) => !found[k]);
  if (missing.length > 2) throw new Error(`Could not find the skeleton's ${missing.slice(0, 4).join(', ')} bones (names not recognised)`);
  return found;
}

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

const v3 = () => new THREE.Vector3();

/** Turn a motion into one of ours: a figure's keys at RATE per second. */
export function retargetMotion(src: MotionSource): MotionAsset {
  const bones = matchBones(src.root);
  const at = (k: string) => (bones[k] ? bones[k]!.getWorldPosition(v3()) : null);
  const turn = (k: string) => (bones[k] ? bones[k]!.getWorldQuaternion(new THREE.Quaternion()) : null);

  // Stood upright: some tools are Z-up (or worse); turn the axis nearest the spine's to +Y.
  const upright = new THREE.Group();
  upright.add(src.root);
  upright.updateMatrixWorld(true);
  const spine = (at('neck') ?? at('head'))?.sub(at('hips')!);
  if (spine) {
    const k = (['x', 'y', 'z'] as const).reduce((a, b) => (Math.abs(spine[b]) > Math.abs(spine[a]) ? b : a));
    const axis = new THREE.Vector3().setComponent('xyz'.indexOf(k), Math.sign(spine[k]));
    upright.quaternion.setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0));
  }

  // The rest pose (before the clip plays): the body's own axes, and where hands and feet point.
  upright.updateMatrixWorld(true);
  const restQ: Record<string, THREE.Quaternion | null> = {};
  for (const k of ['head', 'handL', 'handR', 'footL', 'footR']) restQ[k] = turn(k);
  const restLeft = at('upperLegL')!.clone().sub(at('upperLegR')!).normalize();
  const restUp = (at('neck') ?? at('head') ?? at('upperArmL')!.clone().add(at('upperArmR')!).multiplyScalar(0.5)).sub(at('hips')!).normalize();
  const restForward = new THREE.Vector3().crossVectors(restLeft, restUp).normalize();
  const restHand = (s: Side) => at(`hand${s}`)!.clone().sub(at(`foreArm${s}`)!).normalize();
  const restDir = { head: restForward, handL: restHand('L'), handR: restHand('R'), footL: restForward, footR: restForward } as Record<string, THREE.Vector3>;
  const restFloor = Math.min(at('footL')!.y, at('footR')!.y);
  const hipHeight = Math.max(1e-3, at('hips')!.y - restFloor);

  // The mannequin's size, to scale the hips' travel.
  const legs = legsOf(DEFAULT_BODY);
  const scale = (legs.rootY - legs.ankleY) / hipHeight;

  const mixer = new THREE.AnimationMixer(src.root);
  // Played once and held at the end, so the last frame is not the first again.
  const action = mixer.clipAction(src.clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const duration = Math.min(MAX_SECONDS, src.clip.duration || 1 / RATE);
  const count = Math.max(2, Math.round(duration * RATE) + 1);
  const rig = new Rig();
  const figure = newFigure({ name: src.name, body: { ...DEFAULT_BODY } });
  const m = rig.model(figure);
  const keys: Keyframe[] = [];
  let start: THREE.Vector3 | null = null;
  let floor = Infinity;
  const frames: { lm: Landmark3D[]; hips: THREE.Vector3 }[] = [];
  try {
    for (let i = 0; i < count; i++) {
      mixer.setTime((duration * i) / (count - 1));
      upright.updateMatrixWorld(true);
      const lm: Landmark3D[] = Array.from({ length: 33 }, () => ({ p: v3(), visibility: 0 }));
      const put = (index: number, p: THREE.Vector3 | null) => { if (p) lm[index] = { p, visibility: 1 }; };
      // Where a part points now: its rest direction, turned as its bone turned since the rest pose.
      const pointing = (k: string) => {
        const now = turn(k);
        const rest = restQ[k];
        return now && rest ? restDir[k].clone().applyQuaternion(now.multiply(rest.clone().invert())) : null;
      };
      const hips = at('hips')!;
      for (const s of ['L', 'R'] as const) {
        put(LM[`shoulder${s}`], at(`upperArm${s}`));
        put(LM[`elbow${s}`], at(`foreArm${s}`));
        const wrist = at(`hand${s}`);
        put(LM[`wrist${s}`], wrist);
        const hand = pointing(`hand${s}`);
        if (wrist && hand) {
          // Index and little finger knuckles, either side of where the hand points.
          put(LM[`index${s}`], wrist.clone().addScaledVector(hand, 0.08 / scale));
          put(LM[`pinky${s}`], wrist.clone().addScaledVector(hand, 0.07 / scale));
        }
        put(LM[`hip${s}`], at(`upperLeg${s}`));
        put(LM[`knee${s}`], at(`lowerLeg${s}`));
        const ankle = at(`foot${s}`);
        put(LM[`ankle${s}`], ankle);
        const foot = pointing(`foot${s}`);
        const toe = at(`toe${s}`) ?? (ankle && foot ? ankle.clone().addScaledVector(foot, 0.14 / scale) : null);
        if (ankle && toe) {
          put(LM[`toe${s}`], toe);
          // The heel: under the ankle, level with the toes, so a flat foot stays flat.
          put(LM[`heel${s}`], new THREE.Vector3(ankle.x, toe.y, ankle.z));
        }
        if (ankle) floor = Math.min(floor, ankle.y);
      }
      // The head: ears either side, nose ahead, facing as its bone turned since the rest pose.
      const head = at('head');
      if (head) {
        const ahead = pointing('head') ?? restForward.clone();
        const up = restUp.clone().applyQuaternion(turn('head')!.multiply(restQ.head!.clone().invert()));
        const left = new THREE.Vector3().crossVectors(up, ahead).normalize();
        const unit = 0.08 / scale;
        head.addScaledVector(up, unit * 0.6);
        put(LM.earL, head.clone().addScaledVector(left, unit));
        put(LM.earR, head.clone().addScaledVector(left, -unit));
        put(LM.nose, head.clone().addScaledVector(ahead, unit * 1.3));
      }
      frames.push({ lm, hips });
    }
    // Feet on the floor: the lowest the ankles go over the clip is ankle height.
    const ground = floor;
    const poses: PoseKey[] = frames.map(({ lm, hips }) => {
      start ??= hips.clone();
      const { joints } = retarget(m, lm);
      const position: Vec3 = [
        Math.round((hips.x - start.x) * scale * 1000) / 1000,
        Math.round(((hips.y - ground) * scale + legs.ankleY) * 1000) / 1000,
        Math.round((hips.z - start.z) * scale * 1000) / 1000,
      ];
      return { ...poseOf(figure), joints, position, grounded: false };
    });
    poses.forEach((pose, i) => keys.push({ t: Math.round(((duration * i) / (count - 1)) * 1000) / 1000, poses: { [figure.id]: pose } }));
  } finally {
    upright.remove(src.root);
    mixer.stopAllAction();
    rig.dispose();
  }
  const first = keys[0].poses[figure.id];
  const scene = {
    ...newScene(src.name, [{ ...figure, joints: first.joints, position: first.position, grounded: false }]),
    animation: { duration: Math.max(0.2, Math.round(duration * 1000) / 1000), fps: DEFAULT_FPS, loop: false, keys },
  };
  return { id: uid('motion'), name: src.name.slice(0, 80), scene };
}

/** Read and retarget a motion file in one go. */
export async function importMotion(name: string, data: ArrayBuffer) {
  return retargetMotion(await readMotionFile(name, data));
}
