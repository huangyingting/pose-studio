import * as THREE from 'three';
import { BOTS, BOT_TARGETS } from './bots';
import { Ink, InkedParts, type Highlight } from './ink';
import { clampRotation, jointLimits, sided, wrapDeg, type LimbPart } from './joints';
import { boneToRig, fromQuat, rigToBone, toQuat } from './pose';
import {
  JOINTS, type BodyParams, type Figure, type Hand, type JointName, type Side, type Style, type Vec3,
} from './types';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type Chain = [JointName, JointName, JointName];

export const IK_CHAINS: Record<'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot', Chain> = {
  leftHand: ['leftUpperArm', 'leftLowerArm', 'leftHand'],
  rightHand: ['rightUpperArm', 'rightLowerArm', 'rightHand'],
  leftFoot: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'],
  rightFoot: ['rightUpperLeg', 'rightLowerLeg', 'rightFoot'],
};

export const POLE_CHAINS: Record<'leftLowerArm' | 'rightLowerArm' | 'leftLowerLeg' | 'rightLowerLeg', Chain> = {
  leftLowerArm: IK_CHAINS.leftHand,
  rightLowerArm: IK_CHAINS.rightHand,
  leftLowerLeg: IK_CHAINS.leftFoot,
  rightLowerLeg: IK_CHAINS.rightFoot,
};

/* ---------- world-space rotation helpers (also used by photo retargeting) ---------- */

export function setWorldQuaternion(obj: THREE.Object3D, q: THREE.Quaternion) {
  const parent = obj.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
  obj.quaternion.copy(parent.multiply(q));
  obj.updateMatrixWorld(true);
}

/** Rotate a joint (in world space) by `delta`. */
export function rotateWorld(obj: THREE.Object3D, delta: THREE.Quaternion) {
  setWorldQuaternion(obj, delta.clone().multiply(obj.getWorldQuaternion(new THREE.Quaternion())));
}

/** Rotate a joint so that world direction `from` points along `to`. */
export function rotateToward(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  rotateWorld(obj, new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize()));
}

export function worldPos(obj: THREE.Object3D) {
  return obj.getWorldPosition(new THREE.Vector3());
}

/**
 * Euler angles are ambiguous: (x, y, z) and its "flipped" twin describe the same rotation.
 * three.js always returns the twin with the middle angle in [-90°, 90°], which makes values
 * jump (e.g. a raised arm at Z=150°). Pick whichever twin is closest to the previous value.
 */
export function stableEuler(e: THREE.Euler, prev: Vec3): Vec3 {
  const a: Vec3 = [e.x * R2D, e.y * R2D, e.z * R2D];
  const b: Vec3 = [...a];
  const mid = e.order === 'YXZ' ? 0 : 2; // middle axis of the rotation order
  for (let i = 0; i < 3; i++) b[i] = i === mid ? 180 - a[i] : a[i] + 180;
  const fix = (v: Vec3) => v.map((x) => Math.round(wrapDeg(x) * 10) / 10 || 0) as Vec3;
  const dist = (v: Vec3) => v.reduce((s, x, i) => s + Math.abs(wrapDeg(x - prev[i])), 0);
  const ca = fix(a);
  const cb = fix(b);
  return dist(cb) < dist(ca) ? cb : ca;
}

/* ---------- the body: Mixamo's X Bot (a man) or Y Bot (a woman), at the figure's height ---------- */

/** A bot as the mannequin uses it: its rest shape (arms at its sides), weights and joints (lib/bots.ts). */
interface Bot {
  height: number;
  positions: Float32Array;
  normals: Float32Array;
  index: Uint16Array;
  /** Per vertex, four of BOT_TARGETS and their weights (0–255). */
  skinIndex: Uint8Array;
  skinWeight: Uint8Array;
  /** 1 on its joint bands, 0 on its surface. */
  ring: Uint8Array;
  joints: Record<string, Vec3>;
  hipHalfWidth: number;
}

const decoded = new Map<string, Bot>();

/** The bot a body is drawn as (decoded from lib/bots.ts once). */
function botOf(body: BodyParams): Bot {
  const which = body.sex >= 0.5 ? 'female' : 'male';
  let bot = decoded.get(which);
  if (bot) return bot;
  const d = BOTS[which];
  const raw = Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0));
  const V = d.vertices;
  const T = d.triangles;
  const q = new Uint16Array(raw.buffer, 0, V * 3);
  const positions = new Float32Array(V * 3);
  for (let i = 0; i < V * 3; i++) positions[i] = d.min[i % 3] + (q[i] / 65535) * d.size[i % 3];
  const index = new Uint16Array(raw.buffer, V * 6, T * 3);
  let at = V * 6 + T * 6;
  const skin = raw.subarray(at, at + V * 8);
  at += V * 8;
  const skinIndex = new Uint8Array(V * 4);
  const skinWeight = new Uint8Array(V * 4);
  for (let v = 0; v < V; v++) {
    skinIndex.set(skin.subarray(v * 8, v * 8 + 4), v * 4);
    skinWeight.set(skin.subarray(v * 8 + 4, v * 8 + 8), v * 4);
  }
  const ring = raw.slice(at, at + V);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  const normals = g.attributes.normal.array as Float32Array;
  g.dispose();
  bot = { height: d.height, positions, normals, index, skinIndex, skinWeight, ring, joints: d.joints as Record<string, Vec3>, hipHalfWidth: d.hipHalfWidth };
  decoded.set(which, bot);
  return bot;
}

/** A body's scale: the bot's sizes times this make it as tall as its height. */
export const scaleOf = (b: BodyParams) => b.height / botOf(b).height;

/** How far the hips reach to either side (where a hand rests on a hip). */
export const hipHalfWidth = (b: BodyParams) => botOf(b).hipHalfWidth * scaleOf(b);

/* ---------- fingers ---------- */

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;
/** How far each finger turns out as the hand spreads (index → little). */
const SPREAD = [-0.28, -0.08, 0.1, 0.28];
const CURL_ANGLES = [75, 95, 65].map((a) => a * D2R);

interface FingerRig {
  /** [thumb, index, middle, ring, little] × 3 segment groups */
  segments: THREE.Group[][];
  side: 1 | -1;
}

/** Each joint's parent (the hips: the root). */
const PARENT: Record<Exclude<JointName, 'hips'>, JointName> = {
  spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  leftUpperArm: 'chest', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightUpperArm: 'chest', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg',
};

/** The joint a part of the bot belongs to (a finger's segment: its hand's). */
const partOf = (target: string): JointName => (/^(left|right)(Thumb|Index|Middle|Ring|Little)/.test(target) ? (`${target.startsWith('left') ? 'left' : 'right'}Hand` as JointName) : (target as JointName));


/** A bone and its outermost points (at rest): where they are is where the bone takes them. */
interface Sample { bone: THREE.Bone; inverse: THREE.Matrix4; points: Float32Array }

/** The directions a bone's outermost points are found in (from the middle of a cube to the points on its surface, five to a side). */
const STEPS = [-2, -1, 0, 1, 2];
const DIRECTIONS = STEPS.flatMap((x) => STEPS.flatMap((y) => STEPS.map((z) => new THREE.Vector3(x, y, z))))
  .filter((d) => Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)) === 2)
  .map((d) => d.normalize());

/**
 * Each bone's outermost points (of those it moves most), in 98 directions: as it is posed, the
 * figure is bound by them (its lowest point, how far it reaches) to a few millimetres, without
 * working out every vertex.
 */
function outline(bot: Bot, k: number, bones: THREE.Bone[], inverses: THREE.Matrix4[]): Sample[] {
  const n = bot.positions.length / 3;
  const best = bones.map(() => DIRECTIONS.map(() => ({ v: -1, d: -Infinity })));
  const p = new THREE.Vector3();
  for (let v = 0; v < n; v++) {
    const b = bot.skinIndex[v * 4];
    p.fromArray(bot.positions, v * 3);
    DIRECTIONS.forEach((dir, i) => {
      const d = p.dot(dir);
      if (d > best[b][i].d) best[b][i] = { v, d };
    });
  }
  return bones.flatMap((bone, b) => {
    const ids = [...new Set(best[b].map((x) => x.v).filter((v) => v >= 0))];
    if (!ids.length) return [];
    const points = new Float32Array(ids.length * 3);
    ids.forEach((v, i) => { for (let c = 0; c < 3; c++) points[i * 3 + c] = bot.positions[v * 3 + c] * k; });
    return [{ bone, inverse: inverses[b], points }];
  });
}

/** The mannequin: Mixamo's X Bot or Y Bot on the app's skeleton, drawn in the app's styles. */
export class Mannequin {
  readonly object = new THREE.Group();
  joints = {} as Record<JointName, THREE.Group>;
  parts: InkedParts;
  /** When set, the vertical root position is not re-grounded (used while dragging). */
  groundLock = false;
  grounded = true;

  private hands = {} as Record<Side, FingerRig>;
  /** What bounds it, cheaply: a few of each bone's points (outline). */
  private samples: Sample[] = [];
  private faces = true;
  private bodyKey = '';
  private style: Style = 'line';
  private selected: JointName | null = null;
  private highlight = false;
  /** `bare`: only to work things out with (its joints and parts), never drawn: no outlines or lines. */
  constructor(private ink: Ink, body: BodyParams, public id = '', private readonly bare = false) {
    this.parts = new InkedParts(ink, 'figure', bare);
    this.setBody(body);
  }

  /** Rebuild the geometry if the body (its bot or its height) changed. Returns true if rebuilt. */
  setBody(body: BodyParams) {
    const key = `${body.sex >= 0.5 ? 'female' : 'male'}:${body.height}`;
    if (key === this.bodyKey) return false;
    this.bodyKey = key;
    this.parts.dispose();
    this.object.clear();
    this.joints = {} as Record<JointName, THREE.Group>;
    this.parts = new InkedParts(this.ink, 'figure', this.bare);
    this.build(body);
    this.refresh();
    this.parts.setFeatures(this.faces);
    return true;
  }

  private build(body: BodyParams) {
    const bot = botOf(body);
    const k = scaleOf(body);
    // (A leg's joints straight under its hip, the hips beside the pelvis's: a leg bends in one
    // plane, as walking works it out.)
    const J = (name: string) => {
      const p = new THREE.Vector3(...bot.joints[name]).multiplyScalar(k);
      const leg = /^(left|right)(UpperLeg|LowerLeg|Foot)$/.exec(name);
      if (leg) {
        p.x = bot.joints[`${leg[1]}UpperLeg`][0] * k;
        p.z = bot.joints.hips[2] * k;
      }
      return p;
    };
    // The skeleton where the bot has its joints (each joint's frame as the world's at rest: limbs
    // along their −y).
    const joint = (name: JointName) => {
      const g = new THREE.Group();
      g.name = name;
      g.rotation.order = name === 'hips' ? 'YXZ' : 'XZY';
      if (name === 'hips') {
        g.position.copy(J('hips'));
        this.object.add(g);
      } else {
        g.position.copy(J(name).sub(J(PARENT[name])));
        this.joints[PARENT[name]].add(g);
      }
      this.joints[name] = g;
    };
    for (const name of JOINTS) joint(name);
    // Each finger: three segments from its knuckle, on the hand.
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 'left' : 'right';
      const hand = this.joints[sided('Hand', side)];
      const segments = FINGERS.map((f) => {
        let parent: THREE.Object3D = hand;
        let from = J(`${s}Hand`);
        return [0, 1, 2].map((i) => {
          const g = new THREE.Group();
          g.name = `${s}${f}${i}`;
          const at = J(`${s}${f}${i}`);
          g.position.copy(at.clone().sub(from));
          parent.add(g);
          [parent, from] = [g, at];
          return g;
        });
      });
      this.hands[side] = { segments, side: side === 'L' ? 1 : -1 };
    }
    this.object.updateMatrixWorld(true);

    // A bone on each of the bot's targets (a joint or a finger's segment), at rest now.
    const holders = BOT_TARGETS.map((t) => (t in this.joints ? this.joints[t as JointName] : this.object.getObjectByName(t)!));
    const bones = holders.map((h) => {
      const b = new THREE.Bone();
      h.add(b);
      b.updateMatrixWorld();
      return b;
    });
    const skeleton = new THREE.Skeleton(bones);

    this.samples = outline(bot, k, bones, skeleton.boneInverses);
    // (One only worked out with is never drawn: its bones and the points that bound it are enough.)
    if (this.bare) return;
    // Its body cut by the joint each triangle mostly follows (each part picked and lit on its own),
    // the joint bands apart from the surface (and in a hand, each finger) for the lines between them.
    const tris = bot.index.length / 3;
    const byPart = new Map<JointName, number[]>();
    const top = (v: number) => bot.skinIndex[v * 4];
    for (let t = 0; t < tris; t++) {
      const vs = [bot.index[t * 3], bot.index[t * 3 + 1], bot.index[t * 3 + 2]].map(top);
      const main = vs[0] === vs[1] || vs[0] === vs[2] ? vs[0] : vs[1] === vs[2] ? vs[1] : vs[0];
      const part = partOf(BOT_TARGETS[main]);
      (byPart.get(part) ?? byPart.set(part, []).get(part)!).push(t);
    }
    const parts: THREE.Mesh[] = [];
    for (const [part, list] of byPart) {
      const remap = new Map<number, number>();
      const index: number[] = [];
      for (const t of list) for (let c = 0; c < 3; c++) {
        const v = bot.index[t * 3 + c];
        if (!remap.has(v)) remap.set(v, remap.size);
        index.push(remap.get(v)!);
      }
      const n = remap.size;
      const pos = new Float32Array(n * 3);
      const nrm = new Float32Array(n * 3);
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      const piece = new Float32Array(n);
      const hand = part.endsWith('Hand');
      for (const [v, i] of remap) {
        for (let c = 0; c < 3; c++) {
          pos[i * 3 + c] = bot.positions[v * 3 + c] * k;
          nrm[i * 3 + c] = bot.normals[v * 3 + c];
        }
        for (let c = 0; c < 4; c++) {
          si[i * 4 + c] = bot.skinIndex[v * 4 + c];
          sw[i * 4 + c] = bot.skinWeight[v * 4 + c] / 255;
        }
        // (In a hand, each finger its own piece; elsewhere the bands apart from the surface.)
        const finger = FINGERS.findIndex((f) => BOT_TARGETS[top(v)].includes(f));
        piece[i] = (hand ? finger + 1 : 0) * 2 + bot.ring[v];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      geo.setAttribute('piece', new THREE.BufferAttribute(piece, 1));
      geo.setIndex(index);
      geo.userData.pieces = hand ? 12 : 2;
      // (The trunk one form: its parts share their IDs, no line where one joint takes over from the next.)
      const form = part === 'hips' || part === 'spine' || part === 'chest' ? { form: 'trunk' } : {};
      parts.push(this.parts.add(this.object, geo, { joint: part, figure: this.id, ...form }));
    }
    this.object.updateMatrixWorld(true);
    this.parts.bindSkins(skeleton, parts);
  }

  /** Show or hide the face details (the bots have none: nothing to show). */
  setFaceFeatures(on: boolean) {
    this.faces = on;
    this.parts.setFeatures(on);
  }

  setHand(side: Side, hand: Hand) {
    const rig = this.hands[side];
    const s = rig.side;
    rig.segments.forEach((segs, fi) => {
      const c = hand.curl[fi];
      if (fi === 0) {
        // Thumb: at rest it points forward and down by the palm (which faces the body); it folds
        // in across the palm (about the vertical), out from it as the hand spreads.
        segs[0].rotation.set(0, -s * (0.5 * c - 0.3 * hand.spread), 0);
        segs[1].rotation.set(0, -s * 0.6 * c, 0);
        segs[2].rotation.set(0, -s * 0.7 * c, 0);
        return;
      }
      segs.forEach((g, si) => g.rotation.set(si === 0 ? SPREAD[fi - 1] * hand.spread : 0, 0, -s * CURL_ANGLES[si] * c));
    });
  }

  /** Pose the figure from document state. */
  apply(fig: Figure) {
    this.setBody(fig.body);
    for (const name of JOINTS) this.joints[name].quaternion.copy(boneToRig(name, fromQuat(fig.bones[name])));
    this.setHand('L', fig.hands.L);
    this.setHand('R', fig.hands.R);
    this.grounded = fig.grounded;
    this.joints.hips.position.set(...fig.position);
    this.ground();
  }

  /** Read the bone rotations and the hips' position back out. */
  read(): Pick<Figure, 'bones' | 'position'> {
    const bones: Figure['bones'] = {};
    for (const name of JOINTS) bones[name] = toQuat(rigToBone(name, this.joints[name].quaternion));
    const p = this.joints.hips.position;
    const r = (x: number) => Math.round(x * 1000) / 1000 || 0;
    return { bones, position: [r(p.x), r(p.y), r(p.z)] };
  }

  /** Clamp the given joints to their anatomical ranges. */
  constrain(names: readonly JointName[]) {
    for (const name of names) {
      if (name === 'hips') continue;
      const obj = this.joints[name];
      const cur = stableEuler(obj.rotation, [0, 0, 0]);
      const lim = jointLimits(name);
      if (cur.every((v, i) => v >= lim[i][0] && v <= lim[i][1])) continue;
      const c = clampRotation(name, cur);
      obj.rotation.set(c[0] * D2R, c[1] * D2R, c[2] * D2R);
    }
    this.object.updateMatrixWorld(true);
  }

  /** The height of the figure's lowest point (below 0: it goes through the floor). */
  lowest() {
    this.object.updateMatrixWorld(true);
    let min = Infinity;
    this.forEachPoint((p) => { min = Math.min(min, p.y); });
    return min;
  }

  /** Raise the figure if any part is below the floor (it never goes through it). */
  liftAboveFloor() {
    const min = this.lowest();
    if (min >= 0) return;
    this.joints.hips.position.y -= min;
    this.object.updateMatrixWorld(true);
  }

  private surface: ((x: number, z: number) => number) | null = null;

  /** What it stands on besides the floor: the height of the props under a floor point. */
  /** Its parts tagged as another figure's (a mannequin worked out with, passed on to the next). */
  retag(id: string) {
    if (id === this.id) return;
    this.id = id;
    for (const m of this.parts.bodies) m.userData.figure = id;
  }

  setGround(surface: ((x: number, z: number) => number) | null) {
    this.surface = surface;
  }

  /**
   * Move the figure vertically so its lowest point rests on the floor, or on the highest prop
   * top under its feet (if not grounded: at least above the floor).
   */
  ground() {
    if (this.groundLock || !this.grounded) {
      if (this.groundLock) this.object.updateMatrixWorld(true);
      else this.liftAboveFloor();
      return;
    }
    const root = this.joints.hips;
    root.position.y = 1;
    this.object.updateMatrixWorld(true);
    root.position.y -= this.lowest();
    if (this.surface) {
      // Standing on a box or a step: up onto the highest top under either foot.
      const on = Math.max(...(['leftFoot', 'rightFoot'] as const).map((j) => {
        const p = this.joints[j].getWorldPosition(new THREE.Vector3());
        return this.surface!(p.x, p.z);
      }));
      root.position.y += on;
    }
    this.object.updateMatrixWorld(true);
  }

  /** The points that bound it (each bone's outermost ones, where its bone has them now). */
  forEachPoint(cb: (p: THREE.Vector3) => void) {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const { bone, inverse, points } of this.samples) {
      m.multiplyMatrices(bone.matrixWorld, inverse);
      for (let i = 0; i < points.length; i += 3) cb(p.set(points[i], points[i + 1], points[i + 2]).applyMatrix4(m));
    }
  }

  /**
   * Analytic two-bone IK: move the end joint of `chain` to `target`, bending the middle
   * joint within its current bend plane. `endWorldQ` keeps the hand/foot orientation fixed.
   */
  solveIK(chain: Chain, target: THREE.Vector3, endWorldQ?: THREE.Quaternion, limits = false) {
    const [u, m, e] = chain.map((n) => this.joints[n]);
    this.object.updateMatrixWorld(true);
    const endQ = endWorldQ ? endWorldQ.clone() : e.getWorldQuaternion(new THREE.Quaternion());
    const A = worldPos(u);
    const B = worldPos(m);
    const C = worldPos(e);
    const a = A.distanceTo(B);
    const b = B.distanceTo(C);

    const toT = target.clone().sub(A);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const dir = toT.lengthSq() > 1e-12 ? toT.normalize() : C.clone().sub(A).normalize();

    // Bend direction: where the elbow/knee currently points, biased by its natural direction
    // (elbows go back, knees go forward) so a straight limb still bends the right way.
    const isLeg = chain[0].endsWith('UpperLeg');
    const natural = new THREE.Vector3(0, 0, isLeg ? 1 : -1).applyQuaternion(u.getWorldQuaternion(new THREE.Quaternion()));
    const pole = B.clone().sub(A).addScaledVector(natural, 0.02 * a);
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-10) pole.copy(natural).addScaledVector(dir, -natural.dot(dir));
    pole.normalize();

    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const newB = A.clone().addScaledVector(dir, a * cosA).addScaledVector(pole, a * sinA);
    const newC = A.clone().addScaledVector(dir, d);

    // Orient the upper bone so the middle joint is a true hinge: the bone hangs along its
    // local −Y, and the lower bone bends towards local +Z (elbow) or −Z (knee).
    const y = A.clone().sub(newB).normalize();
    const bendDir = newC.clone().sub(newB);
    bendDir.addScaledVector(y, -bendDir.dot(y));
    if (bendDir.lengthSq() < 1e-10) {
      // Straight limb: keep the current twist.
      bendDir.set(0, 0, isLeg ? -1 : 1).applyQuaternion(u.getWorldQuaternion(new THREE.Quaternion()));
      bendDir.addScaledVector(y, -bendDir.dot(y));
    }
    const z = bendDir.normalize().multiplyScalar(isLeg ? -1 : 1);
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    setWorldQuaternion(u, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)));
    const bend = y.clone().negate().angleTo(newC.clone().sub(newB));
    m.rotation.set(isLeg ? bend : -bend, 0, 0);
    this.object.updateMatrixWorld(true);
    if (limits) this.constrain([chain[0], chain[1]]);
    setWorldQuaternion(e, endQ);
    if (limits) this.constrain([chain[2]]);
  }

  /** Swing the elbow/knee around the shoulder→wrist (hip→ankle) line towards `poleTarget`. */
  swivel(chain: Chain, poleTarget: THREE.Vector3, endWorldQ?: THREE.Quaternion, limits = false) {
    const [u, m, e] = chain.map((n) => this.joints[n]);
    this.object.updateMatrixWorld(true);
    const endQ = endWorldQ ? endWorldQ.clone() : e.getWorldQuaternion(new THREE.Quaternion());
    const A = worldPos(u);
    const axis = worldPos(e).sub(A).normalize();
    const project = (p: THREE.Vector3) => {
      const v = p.clone().sub(A);
      return v.addScaledVector(axis, -v.dot(axis));
    };
    const cur = project(worldPos(m));
    const want = project(poleTarget);
    if (cur.lengthSq() < 1e-8 || want.lengthSq() < 1e-8) return;
    const angle = Math.atan2(axis.dot(cur.clone().cross(want)), cur.dot(want));
    rotateWorld(u, new THREE.Quaternion().setFromAxisAngle(axis, angle));
    if (limits) this.constrain([chain[0]]);
    setWorldQuaternion(e, endQ);
    if (limits) this.constrain([chain[2]]);
  }

  setGroundLock(on: boolean) {
    this.groundLock = on;
  }

  setStyle(style: Style) {
    this.style = style;
    this.refresh();
  }

  /** Highlight one joint's parts, or the whole figure (`all`). */
  setSelected(joint: JointName | null, all = false) {
    this.selected = joint;
    this.highlight = all;
    this.refresh();
  }

  setIdMode(on: boolean, firstId: number) {
    return this.parts.setIdMode(on, firstId);
  }

  /** A colour mixed into the body, to tell figures apart (null: none). */
  setTint(color: string | null) {
    if (this.parts.tint === color) return;
    this.parts.tint = color;
    this.refresh();
  }

  /**
   * Turn the neck and head (on top of the pose) to look at a world point, within natural limits:
   * the neck takes a part of the turn, the head the rest.
   */
  lookAt(point: THREE.Vector3) {
    this.object.updateMatrixWorld(true);
    const neck = this.joints.neck;
    const chestQ = this.joints.chest.getWorldQuaternion(new THREE.Quaternion());
    const eyes = this.joints.head.getWorldPosition(new THREE.Vector3());
    const d = point.clone().sub(eyes).applyQuaternion(chestQ.invert());
    if (d.lengthSq() < 1e-6) return;
    const yaw = Math.max(-80, Math.min(80, Math.atan2(d.x, d.z) * R2D));
    const pitch = Math.max(-40, Math.min(45, -Math.atan2(d.y, Math.hypot(d.x, d.z)) * R2D));
    const n = neck.rotation;
    const h = this.joints.head.rotation;
    neck.rotation.set(pitch * 0.4 * D2R, yaw * 0.4 * D2R, n.z, n.order);
    this.joints.head.rotation.set(pitch * 0.6 * D2R, yaw * 0.6 * D2R, h.z, h.order);
    this.object.updateMatrixWorld(true);
  }

  /** Outline the whole figure (it is linked to the pointer elsewhere). */
  setLinked(on: boolean) {
    this.parts.setLinked(on);
  }

  /** Tint the parts a drag would move: these joints' parts, or the whole figure. */
  setHover(joints: readonly JointName[] | 'all' | null) {
    const next = joints === 'all' || joints === null ? joints : new Set(joints);
    if (next === this.hover || (next instanceof Set && this.hover instanceof Set && next.size === this.hover.size && [...next].every((j) => (this.hover as Set<JointName>).has(j)))) return;
    this.hover = next;
    this.refresh();
  }

  /** A joint and every joint below it: what moves when it turns. */
  jointsUnder(joint: JointName): JointName[] {
    const out: JointName[] = [];
    this.joints[joint].traverse((o) => { if ((JOINTS as readonly string[]).includes(o.name)) out.push(o.name as JointName); });
    return out;
  }

  private hover: Set<JointName> | 'all' | null = null;

  private isSelected = (mesh: THREE.Mesh): Highlight => {
    if (this.highlight || (this.selected !== null && mesh.userData.joint === this.selected)) return true;
    return this.hover === 'all' || !!this.hover?.has(mesh.userData.joint as JointName) ? 'hover' : false;
  };

  private refresh() {
    this.parts.refresh(this.style, this.isSelected);
  }

  dispose() {
    this.parts.dispose();
    this.object.clear();
  }
}
