import * as THREE from 'three';
import { egg, ellipsoid, Ink, InkedParts, latitude, limb, meridian } from './ink';
import { clampRotation, jointLimits, wrapDeg } from './joints';
import {
  JOINTS, type BodyParams, type Figure, type Hand, type JointName, type Side, type Style, type Vec3,
} from './types';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type Chain = [JointName, JointName, JointName];

export const IK_CHAINS: Record<'wristL' | 'wristR' | 'ankleL' | 'ankleR', Chain> = {
  wristL: ['shoulderL', 'elbowL', 'wristL'],
  wristR: ['shoulderR', 'elbowR', 'wristR'],
  ankleL: ['hipL', 'kneeL', 'ankleL'],
  ankleR: ['hipR', 'kneeR', 'ankleR'],
};

export const POLE_CHAINS: Record<'elbowL' | 'elbowR' | 'kneeL' | 'kneeR', Chain> = {
  elbowL: IK_CHAINS.wristL,
  elbowR: IK_CHAINS.wristR,
  kneeL: IK_CHAINS.ankleL,
  kneeR: IK_CHAINS.ankleR,
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
  const fix = (v: Vec3) => v.map((x) => Math.round(wrapDeg(x) * 10) / 10) as Vec3;
  const dist = (v: Vec3) => v.reduce((s, x, i) => s + Math.abs(wrapDeg(x - prev[i])), 0);
  const ca = fix(a);
  const cb = fix(b);
  return dist(cb) < dist(ca) ? cb : ca;
}

/* ---------- body proportions ---------- */

function proportions(b: BodyParams) {
  const k = b.height / 1.8;
  const mix = (male: number, female: number) => male + (female - male) * b.sex;
  const torso = (0.9 + 0.3 * b.build) * k;
  return {
    k,
    torso,
    limbR: (0.82 + 0.42 * b.build) * mix(1.08, 0.94) * k,
    legs: b.legs * k,
    head: b.head * k,
    pelvis: { rx: mix(0.152, 0.172) * torso, ry: 0.13 * k, rz: mix(0.108, 0.118) * torso, taper: mix(-0.14, -0.3) },
    waist: { rx: mix(0.14, 0.118) * torso, ry: 0.13 * k, rz: mix(0.1, 0.088) * torso, taper: 0.1 },
    chest: { rx: mix(0.182, 0.152) * torso, ry: mix(0.19, 0.18) * k, rz: mix(0.118, 0.1) * torso, taper: mix(0.3, 0.2) },
    shoulderX: mix(0.192, 0.163) * (0.92 + 0.16 * b.build) * k,
    hipX: mix(0.084, 0.094) * torso,
    bust: b.sex * b.bust,
  };
}

/* ---------- fingers ---------- */

const FINGER_LAYOUT = [
  { z: 0.027, len: [0.04, 0.025, 0.02], r: 0.0085, spread: -0.28 },
  { z: 0.009, len: [0.044, 0.028, 0.022], r: 0.009, spread: -0.08 },
  { z: -0.009, len: [0.041, 0.026, 0.02], r: 0.0085, spread: 0.1 },
  { z: -0.026, len: [0.032, 0.02, 0.017], r: 0.0075, spread: 0.28 },
];
const CURL_ANGLES = [75, 95, 65].map((a) => a * D2R);

interface FingerRig {
  /** [thumb, index, middle, ring, pinky] × 3 segment groups */
  segments: THREE.Group[][];
  side: 1 | -1;
}

/** A jointed art mannequin built from primitives, rendered as line art. */
export class Mannequin {
  readonly object = new THREE.Group();
  joints = {} as Record<JointName, THREE.Group>;
  parts: InkedParts;
  /** When set, the vertical root position is not re-grounded (used while dragging). */
  groundLock = false;
  grounded = true;

  private hands = {} as Record<Side, FingerRig>;
  private bodyKey = '';
  private last: Figure['joints'] = {};
  private style: Style = 'line';
  private selected: JointName | null = null;
  private highlight = false;

  constructor(private ink: Ink, body: BodyParams, readonly id = '') {
    this.parts = new InkedParts(ink, 'figure');
    this.setBody(body);
  }

  /** Rebuild the geometry if the proportions changed. Returns true if rebuilt. */
  setBody(body: BodyParams) {
    const key = JSON.stringify(body);
    if (key === this.bodyKey) return false;
    this.bodyKey = key;
    this.parts.dispose();
    this.object.clear();
    this.joints = {} as Record<JointName, THREE.Group>;
    this.parts = new InkedParts(this.ink, 'figure');
    this.build(proportions(body));
    this.refresh();
    return true;
  }

  private build(P: ReturnType<typeof proportions>) {
    const { k } = P;
    const joint = (name: JointName, parent: THREE.Object3D, x: number, y: number) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, 0);
      g.rotation.order = name === 'root' ? 'YXZ' : 'XZY';
      parent.add(g);
      this.joints[name] = g;
      return g;
    };
    const part = (j: JointName, geo: THREE.BufferGeometry, pos?: Vec3, rings: THREE.BufferGeometry[] = []) =>
      this.parts.add(this.joints[j], geo, { joint: j, figure: this.id }, pos, rings);
    const ball = (r: number) => new THREE.SphereGeometry(r, 24, 16);

    const root = joint('root', this.object, 0, 1);
    const pv = P.pelvis;
    part('root', egg(pv.rx, pv.ry, pv.rz, pv.taper), [0, -0.04 * k, 0], [meridian(pv.ry, pv.rz, pv.taper)]);

    const spine = joint('spine', root, 0, 0.07 * k);
    const w = P.waist;
    part('spine', egg(w.rx, w.ry, w.rz, w.taper), [0, 0.09 * k, 0], [meridian(w.ry, w.rz, w.taper)]);

    const chest = joint('chest', spine, 0, 0.17 * k);
    const c = P.chest;
    part('chest', egg(c.rx, c.ry, c.rz, c.taper), [0, 0.12 * k, 0], [meridian(c.ry, c.rz, c.taper)]);
    if (P.bust > 0.02) {
      const r = (0.04 + 0.03 * P.bust) * P.torso;
      for (const s of [1, -1]) {
        part('chest', ellipsoid(r, r * 0.9, r * 0.8, 28, 20), [s * 0.062 * P.torso, 0.105 * k, c.rz * 0.62 + r * 0.3]);
      }
    }

    const neck = joint('neck', chest, 0, 0.29 * k);
    part('neck', limb(0.1 * k, 0.042 * P.limbR, 0.046 * P.limbR).geometry.rotateZ(Math.PI), [0, -0.02 * k, 0]);

    joint('head', neck, 0, 0.08 * k);
    const h = P.head;
    const [hx, hy, hz, ht] = [0.085 * h, 0.115 * h, 0.1 * h, 0.1];
    part('head', egg(hx, hy, hz, ht), [0, 0.1 * h, 0.01 * h], [meridian(hy, hz, ht), latitude(hx, hy, hz, -0.012 * h, ht)]);

    const R = P.limbR;
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 1 : -1;
      const n = (base: string) => `${base}${side}` as JointName;

      const shoulder = joint(n('shoulder'), chest, P.shoulderX * s, 0.235 * k);
      part(n('shoulder'), ball(0.056 * R));
      const upper = limb(0.27 * k, 0.047 * R, 0.036 * R, 0.006 * R, 0.3);
      part(n('shoulder'), upper.geometry, undefined, [upper.ring(0.5)]);

      const elbow = joint(n('elbow'), shoulder, 0, -0.28 * k);
      part(n('elbow'), ball(0.042 * R));
      const fore = limb(0.23 * k, 0.038 * R, 0.027 * R, 0.007 * R, 0.25);
      part(n('elbow'), fore.geometry, undefined, [fore.ring(0.5)]);

      const wrist = joint(n('wrist'), elbow, 0, -0.245 * k);
      part(n('wrist'), ball(0.029 * R));
      this.hands[side] = this.buildHand(wrist, n('wrist'), s, k);

      const hip = joint(n('hip'), root, P.hipX * s, -0.07 * k);
      part(n('hip'), ball(0.08 * R));
      const thigh = limb(0.4 * P.legs, 0.085 * R, 0.05 * R, 0.01 * R, 0.3);
      part(n('hip'), thigh.geometry, undefined, [thigh.ring(0.45)]);

      const knee = joint(n('knee'), hip, 0, -0.43 * P.legs);
      part(n('knee'), ball(0.057 * R));
      const shin = limb(0.37 * P.legs, 0.05 * R, 0.032 * R, 0.012 * R, 0.3);
      part(n('knee'), shin.geometry, undefined, [shin.ring(0.4)]);

      joint(n('ankle'), knee, 0, -0.4 * P.legs);
      part(n('ankle'), ball(0.036 * R));
      part(n('ankle'), ellipsoid(0.045 * R, 0.035 * k, 0.115 * k), [0, -0.05 * k, 0.055 * k]);
    }
  }

  /** Palm + thumb + four three-segment fingers. The palm faces the body (−X for the left hand). */
  private buildHand(wrist: THREE.Group, j: JointName, s: 1 | -1, k: number): FingerRig {
    const tag = { joint: j, figure: this.id };
    this.parts.add(wrist, ellipsoid(0.017 * k, 0.05 * k, 0.041 * k, 24, 16), tag, [0, -0.055 * k, 0]);

    const chain = (base: THREE.Group, lens: number[], r: number) => {
      const groups: THREE.Group[] = [base];
      let parent = base;
      lens.forEach((len, i) => {
        if (i > 0) {
          const g = new THREE.Group();
          g.position.y = -lens[i - 1] * k;
          parent.add(g);
          groups.push(g);
          parent = g;
        }
        const radius = r * k * (1 - i * 0.1);
        this.parts.add(parent, limb(len * k, radius, radius * 0.9, 0, 0.35, 12).geometry, tag);
      });
      return groups;
    };

    const segments: THREE.Group[][] = [];
    const thumbBase = new THREE.Group();
    thumbBase.position.set(-s * 0.008 * k, -0.022 * k, 0.03 * k);
    wrist.add(thumbBase);
    segments.push(chain(thumbBase, [0.036, 0.028, 0.022], 0.0105));

    for (const f of FINGER_LAYOUT) {
      const base = new THREE.Group();
      base.position.set(0, -0.098 * k, f.z * k);
      wrist.add(base);
      segments.push(chain(base, f.len, f.r));
    }
    return { segments, side: s };
  }

  setHand(side: Side, hand: Hand) {
    const rig = this.hands[side];
    const s = rig.side;
    rig.segments.forEach((segs, fi) => {
      const c = hand.curl[fi];
      if (fi === 0) {
        // Thumb: rests pointing down/forward, curls across the palm towards the pinky.
        segs[0].rotation.set(-0.6 + 0.55 * c - 0.3 * hand.spread, 0, -s * (0.35 + 0.55 * c + 0.25 * hand.spread));
        segs[1].rotation.set(0.15 * c, 0, -s * 0.7 * c);
        segs[2].rotation.set(0.1 * c, 0, -s * 0.8 * c);
        return;
      }
      const f = FINGER_LAYOUT[fi - 1];
      segs.forEach((g, si) => g.rotation.set(si === 0 ? f.spread * hand.spread : 0, 0, -s * CURL_ANGLES[si] * c));
    });
  }

  /** Pose the figure from document state. */
  apply(fig: Figure) {
    this.setBody(fig.body);
    for (const name of JOINTS) {
      const r = fig.joints[name] ?? [0, 0, 0];
      this.joints[name].rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
    }
    this.last = fig.joints;
    this.setHand('L', fig.hands.L);
    this.setHand('R', fig.hands.R);
    this.grounded = fig.grounded;
    this.joints.root.position.set(...fig.position);
    this.ground();
  }

  /** Read joint rotations and root position back out (degrees, 0.1° precision). */
  read(): Pick<Figure, 'joints' | 'position'> {
    const joints: Figure['joints'] = {};
    for (const name of JOINTS) {
      const v = stableEuler(this.joints[name].rotation, this.last[name] ?? [0, 0, 0]);
      if (v.some((a) => a !== 0)) joints[name] = v;
    }
    const p = this.joints.root.position;
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return { joints, position: [r(p.x), r(p.y), r(p.z)] };
  }

  /** Clamp the given joints to their anatomical ranges. */
  constrain(names: readonly JointName[]) {
    for (const name of names) {
      if (name === 'root') continue;
      const obj = this.joints[name];
      const cur = stableEuler(obj.rotation, this.last[name] ?? [0, 0, 0]);
      const lim = jointLimits(name);
      if (cur.every((v, i) => v >= lim[i][0] && v <= lim[i][1])) continue;
      const c = clampRotation(name, cur);
      obj.rotation.set(c[0] * D2R, c[1] * D2R, c[2] * D2R);
    }
    this.object.updateMatrixWorld(true);
  }

  /** Move the figure vertically so its lowest point rests on y = 0. */
  ground() {
    if (this.groundLock || !this.grounded) {
      this.object.updateMatrixWorld(true);
      return;
    }
    const root = this.joints.root;
    root.position.y = 1;
    this.object.updateMatrixWorld(true);
    let min = Infinity;
    this.parts.forEachPoint((p) => { if (p.y < min) min = p.y; });
    root.position.y -= min;
    this.object.updateMatrixWorld(true);
  }

  forEachPoint(cb: (p: THREE.Vector3) => void) {
    this.parts.forEachPoint(cb);
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
    const isLeg = chain[0].startsWith('hip');
    const natural = new THREE.Vector3(0, 0, isLeg ? 1 : -1).applyQuaternion(u.getWorldQuaternion(new THREE.Quaternion()));
    const pole = B.clone().sub(A).addScaledVector(natural, 0.02 * a);
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-10) pole.copy(natural).addScaledVector(dir, -natural.dot(dir));
    pole.normalize();

    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const newB = A.clone().addScaledVector(dir, a * cosA).addScaledVector(pole, a * sinA);
    const newC = A.clone().addScaledVector(dir, d);

    rotateToward(u, B.clone().sub(A), newB.clone().sub(A));
    const B2 = worldPos(m);
    rotateToward(m, worldPos(e).sub(B2), newC.sub(B2));
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
    return this.parts.setIdMode(on, firstId, this.style, this.isSelected);
  }

  private isSelected = (mesh: THREE.Mesh) => this.highlight || (this.selected !== null && mesh.userData.joint === this.selected);

  private refresh() {
    this.parts.refresh(this.style, this.isSelected);
  }

  dispose() {
    this.parts.dispose();
    this.object.clear();
  }
}
