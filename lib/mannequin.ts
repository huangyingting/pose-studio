import * as THREE from 'three';
import { bulge, contour, egg, ellipsoid, Ink, InkedParts, latitude, limb, meridian, smoothNormals, tube } from './ink';
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
  const fix = (v: Vec3) => v.map((x) => Math.round(wrapDeg(x) * 10) / 10 || 0) as Vec3;
  const dist = (v: Vec3) => v.reduce((s, x, i) => s + Math.abs(wrapDeg(x - prev[i])), 0);
  const ca = fix(a);
  const cb = fix(b);
  return dist(cb) < dist(ca) ? cb : ca;
}

/* ---------- body proportions ---------- */

/*
 * Sex blends the secondary sex characteristics an artist looks for in a figure:
 *   male    broad shoulders and rib cage tapering to narrow hips (V shape), pectorals, trapezius
 *           slope, thicker neck, squarer jaw, more muscular arms and calves, larger hands and feet
 *   female  shoulders narrower than the hips, defined waist (hourglass), breasts, fuller hips,
 *           glutes and upper thighs, slender neck and limbs, rounder head with a narrower chin
 */
function proportions(b: BodyParams) {
  const k = b.height / 1.8;
  const female = b.sex;
  const male = 1 - b.sex;
  const mix = (m: number, f: number) => m + (f - m) * female;
  const torso = (0.9 + 0.3 * b.build) * k;
  return {
    k,
    torso,
    limbR: (0.82 + 0.42 * b.build) * mix(1.1, 0.92) * k,
    legs: b.legs * k,
    head: b.head * mix(1.02, 0.97) * k,
    headTaper: mix(0.03, 0.17),
    neckR: mix(0.05, 0.038) * (0.9 + 0.25 * b.build) * k,
    pelvis: { rx: mix(0.142, 0.186) * torso, ry: mix(0.122, 0.135) * k, rz: mix(0.104, 0.122) * torso, taper: mix(-0.08, -0.34) },
    waist: { rx: mix(0.14, 0.106) * torso, ry: 0.13 * k, rz: mix(0.1, 0.084) * torso, taper: mix(0.16, 0.05) },
    chest: { rx: mix(0.194, 0.146) * torso, ry: mix(0.196, 0.172) * k, rz: mix(0.122, 0.096) * torso, taper: mix(0.38, 0.16) },
    shoulderX: mix(0.206, 0.158) * (0.92 + 0.16 * b.build) * k,
    hipX: mix(0.08, 0.102) * torso,
    /** Breast size (female). */
    bust: female * b.bust,
    /** Pectoral / trapezius / muscle definition (male). */
    muscle: male * (0.65 + 0.7 * b.build),
    /** Glute and upper-thigh fullness. */
    hips: mix(0.75, 1.15) * (0.85 + 0.3 * b.build),
    /** Hand and foot size. */
    extremity: mix(1.06, 0.92),
  };
}

type Egg = { rx: number; ry: number; rz: number; taper: number };

/** Point on the front of an egg() surface at (x, y), in the egg's local coordinates. */
function eggFront(e: Egg, x: number, y: number) {
  const cy = THREE.MathUtils.clamp(y / e.ry, -1, 1);
  const r = e.rx * Math.sqrt(1 - cy * cy) * (1 + e.taper * cy);
  return (e.rz / e.rx) * Math.sqrt(Math.max(0, r * r - x * x));
}

/** The curved lower edge of one pectoral, from the sternum out towards the armpit. */
function pectoralLine(c: Egg, s: number, pecY: number, torso: number, k: number, pm: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = s * (0.012 + 0.11 * t) * torso;
    // Low and flat near the sternum, sweeping up to the armpit.
    const y = pecY - 0.05 * k + 0.07 * k * t * t;
    const lift = 0.012 * pm * torso * Math.sin(Math.PI * Math.min(1, t * 1.15));
    pts.push(new THREE.Vector3(x, y, eggFront(c, x, y) + lift + 0.001));
  }
  return contour(pts);
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
  private faces = true;
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
    this.parts.setFeatures(this.faces);
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
    const pelvis = egg(pv.rx, pv.ry, pv.rz, pv.taper);
    // Glutes: rounder and fuller on female figures.
    for (const s of [1, -1]) {
      bulge(pelvis, [s * 0.056 * P.torso, -0.035 * k, -pv.rz * 0.85], [0.07 * P.torso, 0.08 * k, 0.09 * P.torso], 0.026 * P.hips * P.torso);
    }
    part('root', smoothNormals(pelvis), [0, -0.04 * k, 0], [meridian(pv.ry, pv.rz, pv.taper)]);

    const spine = joint('spine', root, 0, 0.07 * k);
    const w = P.waist;
    part('spine', egg(w.rx, w.ry, w.rz, w.taper), [0, 0.09 * k, 0], [meridian(w.ry, w.rz, w.taper)]);

    const chest = joint('chest', spine, 0, 0.17 * k);
    const c = P.chest;
    const ribs = egg(c.rx, c.ry, c.rz, c.taper);
    const chestLines = [meridian(c.ry, c.rz, c.taper)];
    if (P.muscle > 0.2) {
      // Pectorals: sculpted into the rib cage, with a contour line along their lower edge.
      const pm = Math.min(1.2, P.muscle);
      const pecY = 0.04 * k;
      for (const s of [1, -1]) {
        bulge(ribs, [s * 0.072 * P.torso, pecY, c.rz * 0.9], [0.08 * P.torso, 0.058 * k, 0.07 * P.torso], 0.016 * pm * P.torso);
      }
      chestLines.push(...[1, -1].map((s) => pectoralLine(c, s, pecY, P.torso, k, pm)));
    }
    part('chest', smoothNormals(ribs), [0, 0.12 * k, 0], chestLines);
    if (P.bust > 0.02) {
      // Breasts: set low and apart, angled outwards and down.
      const r = (0.04 + 0.034 * P.bust) * P.torso;
      for (const s of [1, -1]) {
        const breast = ellipsoid(r, r * 1.04, r * 0.84, 28, 20).rotateX(0.16).rotateY(s * 0.28);
        part('chest', breast, [s * (0.03 * P.torso + r * 0.85), 0.092 * k, c.rz * 0.6 + r * 0.3]);
      }
    }

    const neck = joint('neck', chest, 0, 0.29 * k);
    part('neck', limb(0.1 * k, P.neckR * 0.92, P.neckR).geometry.rotateZ(Math.PI), [0, -0.02 * k, 0]);

    joint('head', neck, 0, 0.08 * k);
    const h = P.head;
    // A smaller taper gives a squarer jaw (male); a larger one a rounder skull and narrower chin.
    const [hx, hy, hz, ht] = [0.085 * h, 0.115 * h, 0.1 * h, P.headTaper];
    const headMesh = part('head', egg(hx, hy, hz, ht), [0, 0.1 * h, 0.01 * h], [meridian(hy, hz, ht), latitude(hx, hy, hz, -0.012 * h, ht)]);
    this.buildFace(headMesh, { rx: hx, ry: hy, rz: hz, taper: ht }, h);

    const R = P.limbR;
    const mus = P.muscle;
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 1 : -1;
      const n = (base: string) => `${base}${side}` as JointName;

      const shoulder = joint(n('shoulder'), chest, P.shoulderX * s, 0.235 * k);
      part(n('shoulder'), ball((0.054 + 0.01 * mus) * R)); // deltoid
      const upper = limb(0.27 * k, 0.047 * R, 0.036 * R, (0.004 + 0.007 * mus) * R, 0.35);
      part(n('shoulder'), upper.geometry, undefined, [upper.ring(0.5)]);

      const elbow = joint(n('elbow'), shoulder, 0, -0.28 * k);
      part(n('elbow'), ball(0.042 * R));
      const fore = limb(0.23 * k, 0.038 * R, 0.026 * R, (0.005 + 0.006 * mus) * R, 0.22);
      part(n('elbow'), fore.geometry, undefined, [fore.ring(0.5)]);

      const wrist = joint(n('wrist'), elbow, 0, -0.245 * k);
      part(n('wrist'), ball(0.029 * R));
      this.hands[side] = this.buildHand(wrist, n('wrist'), s, k * P.extremity);

      const hip = joint(n('hip'), root, P.hipX * s, -0.07 * k);
      part(n('hip'), ball(0.08 * R));
      // Fuller upper thighs on female figures, more taper on male ones.
      const thigh = limb(0.4 * P.legs, 0.085 * R * (0.92 + 0.12 * P.hips), 0.05 * R, (0.006 + 0.008 * P.hips) * R, 0.28);
      part(n('hip'), thigh.geometry, undefined, [thigh.ring(0.45)]);

      const knee = joint(n('knee'), hip, 0, -0.43 * P.legs);
      part(n('knee'), ball(0.057 * R));
      const shin = limb(0.37 * P.legs, 0.05 * R, 0.031 * R, (0.01 + 0.007 * mus) * R, 0.3); // calf
      part(n('knee'), shin.geometry, undefined, [shin.ring(0.4)]);

      joint(n('ankle'), knee, 0, -0.4 * P.legs);
      part(n('ankle'), ball(0.036 * R));
      const fk = k * P.extremity;
      part(n('ankle'), ellipsoid(0.045 * R, 0.035 * fk, 0.115 * fk), [0, -0.05 * k, 0.055 * fk]);
    }
  }

  /**
   * Simple, construction-style face details on the head egg, so figures read which way they
   * face and look: nose and ears as small forms, eyes / brows / mouth as surface lines.
   * They can be switched off (setFaceFeatures).
   */
  private buildFace(head: THREE.Mesh, e: Egg, h: number) {
    const [ox, oy, oz] = [head.position.x, head.position.y, head.position.z];
    const tag = { joint: 'head' as JointName, figure: this.id };
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
      const mesh = this.parts.add(this.joints.head, geo, tag, [ox + x, oy + y, oz + z]);
      this.parts.markFeature(mesh);
    };
    const noseY = -0.05 * h;
    add(ellipsoid(0.0095 * h, 0.024 * h, 0.012 * h, 20, 14).rotateX(-0.3), 0, noseY, eggFront(e, 0, noseY) - 0.004 * h);
    const earY = -0.024 * h;
    const cy = earY / e.ry;
    const earX = e.rx * Math.sqrt(1 - cy * cy) * (1 + e.taper * cy) * 0.96;
    for (const s of [1, -1]) add(ellipsoid(0.011 * h, 0.027 * h, 0.018 * h, 20, 14), s * earX, earY, -0.01 * h);

    const on = (x: number, y: number) => new THREE.Vector3(x, y, eggFront(e, x, y) + 0.0012);
    const r = 0.0015 * h;
    const lines: THREE.BufferGeometry[] = [];
    for (const s of [1, -1]) {
      // Almond-shaped eye on the eye line, and a brow arching above it.
      const eye = Array.from({ length: 24 }, (_, i) => {
        const t = (i / 24) * Math.PI * 2;
        const lid = Math.sin(t) > 0 ? 0.0068 : 0.0048;
        return on(s * 0.031 * h + 0.015 * h * Math.cos(t), -0.017 * h + lid * h * Math.sin(t));
      });
      lines.push(tube(eye, r));
      const brow = Array.from({ length: 9 }, (_, i) => {
        const t = i / 8;
        return on(s * (0.015 + 0.036 * t) * h, (0.004 + 0.006 * Math.sin(Math.PI * (0.25 + 0.75 * t))) * h);
      });
      lines.push(contour(brow, r * 1.1));
    }
    const mouth = Array.from({ length: 9 }, (_, i) => {
      const t = (i / 8) * 2 - 1;
      return on(t * 0.021 * h, (-0.079 + 0.004 * t * t) * h);
    });
    lines.push(contour(mouth, r));
    this.parts.addFaceLines(head, lines);
  }

  /** Show or hide the face details. */
  setFaceFeatures(on: boolean) {
    this.faces = on;
    this.parts.setFeatures(on);
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
    const r = (x: number) => Math.round(x * 1000) / 1000 || 0;
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
