import * as THREE from 'three';
import { bulge, contour, egg, ellipsoid, Ink, InkedParts, latitude, limb, meridian, smoothNormals, type Highlight } from './ink';
import { clampRotation, jointLimits, sided, wrapDeg, type LimbPart } from './joints';
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

/* ---------- body proportions ---------- */

const mix = (m: number, f: number, female: number) => m + (f - m) * female;

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
    female,
  };
}

type Egg = { rx: number; ry: number; rz: number; taper: number };

/** Point on the front of an egg() surface at (x, y), in the egg's local coordinates. */
function eggFront(e: Egg, x: number, y: number) {
  const cy = THREE.MathUtils.clamp(y / e.ry, -1, 1);
  const r = e.rx * Math.sqrt(1 - cy * cy) * (1 + e.taper * cy);
  return (e.rz / e.rx) * Math.sqrt(Math.max(0, r * r - x * x));
}

interface Sculpt {
  c: Vec3;
  r: Vec3;
  a: number;
}

/** Facial forms in head-egg coordinates (front is +Z, y = 0 is the egg's middle, units of head size). */
function faceSculpts(e: Egg, h: number, female: number): Sculpt[] {
  const male = 1 - female;
  const front = (x: number, y: number): Vec3 => [x * h, y * h, eggFront(e, x * h, y * h)];
  const cy = -0.022 * h / e.ry;
  const side = e.rx * Math.sqrt(1 - cy * cy) * (1 + e.taper * cy);
  const s = (c: Vec3, r: Vec3, a: number): Sculpt => ({ c, r: r.map((v) => v * h) as Vec3, a: a * h });
  const out: Sculpt[] = [
    s(front(0, 0.007), [0.056, 0.014, 0.03], 0.0032 + 0.003 * male), // brow ridge
    s(front(0, -0.032), [0.0085, 0.03, 0.03], 0.0065 + 0.002 * male), // nose bridge
    s(front(0, -0.052), [0.012, 0.011, 0.03], 0.0105 + 0.003 * male), // nose tip
    s(front(0, -0.0712), [0.02, 0.0068, 0.025], 0.0032 + 0.0015 * female), // upper lip
    s(front(0, -0.082), [0.017, 0.0072, 0.025], 0.0038 + 0.0022 * female), // lower lip
    s(front(0, -0.103), [0.02 + 0.009 * male, 0.016, 0.035], 0.0045 + 0.004 * male), // chin
  ];
  for (const k of [1, -1]) {
    out.push(
      s(front(k * 0.031, -0.0145), [0.019, 0.012, 0.03], -0.0042), // eye socket
      s(front(k * 0.011, -0.055), [0.0075, 0.0068, 0.02], 0.0038), // nostril wing
      s(front(k * 0.046, -0.033), [0.026, 0.02, 0.04], 0.0032 + 0.001 * female), // cheekbone
      { c: [k * side, -0.022 * h, -0.008 * h], r: [0.02 * h, 0.031 * h, 0.022 * h], a: 0.0075 * h }, // ear
    );
  }
  return out;
}

/** Point on the sculpted face surface at (x, y), lifted slightly so lines sit on top. */
function onFace(e: Egg, sculpts: Sculpt[], x: number, y: number, lift: number) {
  const p = new THREE.Vector3(x, y, eggFront(e, x, y));
  const n = new THREE.Vector3(p.x / (e.rx * e.rx), p.y / (e.ry * e.ry), p.z / (e.rz * e.rz)).normalize();
  let d = lift;
  for (const c of sculpts) {
    const dx = (p.x - c.c[0]) / c.r[0];
    const dy = (p.y - c.c[1]) / c.r[1];
    const dz = (p.z - c.c[2]) / c.r[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 1) d += c.a * (1 - d2) * (1 - d2);
  }
  return p.addScaledVector(n, d);
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
  /** Built as a capsule stand-in (same skeleton, simple shapes, no hands or face). */
  private standIn = false;

  constructor(private ink: Ink, body: BodyParams, readonly id = '', standIn = false) {
    this.parts = new InkedParts(ink, 'figure');
    this.setBody(body, standIn);
  }

  /** Rebuild the geometry if the proportions (or stand-in-ness) changed. Returns true if rebuilt. */
  setBody(body: BodyParams, standIn = this.standIn) {
    const key = JSON.stringify(body) + (standIn ? ':stand-in' : '');
    if (key === this.bodyKey) return false;
    this.bodyKey = key;
    this.standIn = standIn;
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
      g.rotation.order = name === 'hips' ? 'YXZ' : 'XZY';
      parent.add(g);
      this.joints[name] = g;
      return g;
    };
    const part = (j: JointName, geo: THREE.BufferGeometry, pos?: Vec3, rings: THREE.BufferGeometry[] = []) => {
      if (this.standIn) geo.dispose();
      else this.parts.add(this.joints[j], geo, { joint: j, figure: this.id }, pos, rings);
    };
    const ball = (r: number) => new THREE.SphereGeometry(r, 24, 16);

    const root = joint('hips', this.object, 0, 1);
    const pv = P.pelvis;
    const pelvis = egg(pv.rx, pv.ry, pv.rz, pv.taper);
    // Glutes: rounder and fuller on female figures.
    for (const s of [1, -1]) {
      bulge(pelvis, [s * 0.056 * P.torso, -0.035 * k, -pv.rz * 0.85], [0.07 * P.torso, 0.08 * k, 0.09 * P.torso], 0.026 * P.hips * P.torso);
    }
    part('hips', smoothNormals(pelvis), [0, -0.04 * k, 0], [meridian(pv.ry, pv.rz, pv.taper)]);

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
    if (!this.standIn) this.buildHead({ rx: hx, ry: hy, rz: hz, taper: ht }, h, P.female);

    const R = P.limbR;
    const mus = P.muscle;
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 1 : -1;
      const n = (part: LimbPart) => sided(part, side);

      const shoulder = joint(n('UpperArm'), chest, P.shoulderX * s, 0.235 * k);
      part(n('UpperArm'), ball((0.054 + 0.01 * mus) * R)); // deltoid
      const upper = limb(0.27 * k, 0.047 * R, 0.036 * R, (0.004 + 0.007 * mus) * R, 0.35);
      part(n('UpperArm'), upper.geometry, undefined, [upper.ring(0.5)]);

      const elbow = joint(n('LowerArm'), shoulder, 0, -0.28 * k);
      part(n('LowerArm'), ball(0.042 * R));
      const fore = limb(0.23 * k, 0.038 * R, 0.026 * R, (0.005 + 0.006 * mus) * R, 0.22);
      part(n('LowerArm'), fore.geometry, undefined, [fore.ring(0.5)]);

      const wrist = joint(n('Hand'), elbow, 0, -0.245 * k);
      part(n('Hand'), ball(0.029 * R));
      this.hands[side] = this.standIn ? { segments: [], side: s } : this.buildHand(wrist, n('Hand'), s, k * P.extremity);

      const hip = joint(n('UpperLeg'), root, P.hipX * s, -0.07 * k);
      part(n('UpperLeg'), ball(0.08 * R));
      // Fuller upper thighs on female figures, more taper on male ones.
      const thigh = limb(0.4 * P.legs, 0.085 * R * (0.92 + 0.12 * P.hips), 0.05 * R, (0.006 + 0.008 * P.hips) * R, 0.28);
      part(n('UpperLeg'), thigh.geometry, undefined, [thigh.ring(0.45)]);

      const knee = joint(n('LowerLeg'), hip, 0, -0.43 * P.legs);
      part(n('LowerLeg'), ball(0.057 * R));
      const shin = limb(0.37 * P.legs, 0.05 * R, 0.031 * R, (0.01 + 0.007 * mus) * R, 0.3); // calf
      part(n('LowerLeg'), shin.geometry, undefined, [shin.ring(0.4)]);

      joint(n('Foot'), knee, 0, -0.4 * P.legs);
      part(n('Foot'), ball(0.036 * R));
      const fk = k * P.extremity;
      part(n('Foot'), ellipsoid(0.045 * R, 0.035 * fk, 0.115 * fk), [0, -0.05 * k, 0.055 * fk]);
    }
    if (this.standIn) this.buildStandIn(P, { rx: hx, ry: hy, rz: hz, taper: ht });
  }

  /** Capsules on the same skeleton: a torso, a plain head (its centre line shows where it faces) and limbs. */
  private buildStandIn(P: ReturnType<typeof proportions>, head: Egg) {
    const { k } = P;
    const R = P.limbR;
    const add = (j: JointName, geo: THREE.BufferGeometry, pos?: Vec3, rings: THREE.BufferGeometry[] = []) =>
      this.parts.add(this.joints[j], geo, { joint: j, figure: this.id }, pos, rings);
    const up = (len: number, r1: number, r2: number) => limb(len, r1, r2, 0, 0.35, 24).geometry.rotateZ(Math.PI);
    const torso = up(0.6 * k, 0.15 * P.torso, mix(0.17, 0.14, P.female) * P.torso).scale(1, 1, 0.68);
    add('hips', torso, [0, -0.12 * k, 0]);
    add('head', egg(head.rx, head.ry, head.rz, head.taper), [0, 0.1 * P.head, 0.01 * P.head], [meridian(head.ry, head.rz, head.taper)]);
    for (const side of ['L', 'R'] as const) {
      add(sided('UpperArm', side), limb(0.28 * k, 0.05 * R, 0.038 * R, 0, 0.35, 24).geometry);
      add(sided('LowerArm', side), limb(0.34 * k, 0.038 * R, 0.032 * R, 0, 0.35, 24).geometry);
      add(sided('UpperLeg', side), limb(0.43 * P.legs, 0.08 * R, 0.05 * R, 0, 0.35, 24).geometry);
      add(sided('LowerLeg', side), limb(0.4 * P.legs, 0.05 * R, 0.04 * R, 0, 0.35, 24).geometry);
      // Round joints keep bent limbs smooth where the capsules meet.
      add(sided('LowerArm', side), new THREE.SphereGeometry(0.044 * R, 20, 14));
      add(sided('LowerLeg', side), new THREE.SphereGeometry(0.058 * R, 20, 14));
      const fk = k * P.extremity;
      add(sided('Foot', side), ellipsoid(0.045 * R, 0.035 * fk, 0.11 * fk), [0, -0.04 * k, 0.05 * fk]);
    }
  }

  /**
   * The face, sculpted into the head rather than assembled from parts: brow ridge, eye
   * sockets, nose, cheekbones, lips, chin and ears are smooth swellings and hollows of one
   * surface, finished with a few quiet lines (upper eyelids, the line between the lips and
   * under the nose). A plain construction head stands in when face features are off.
   */
  private buildHead(e: Egg, h: number, female: number) {
    const pos: Vec3 = [0, 0.1 * h, 0.01 * h];
    const tag = { joint: 'head' as JointName, figure: this.id };
    const plain = this.parts.add(this.joints.head, egg(e.rx, e.ry, e.rz, e.taper), tag, pos, [
      meridian(e.ry, e.rz, e.taper), latitude(e.rx, e.ry, e.rz, -0.012 * h, e.taper),
    ]);
    this.parts.markPlain(plain);

    const sculpts = faceSculpts(e, h, female);
    // Fine mesh for the small forms; the lathe seam is turned to the back of the head.
    const geo = egg(e.rx, e.ry, e.rz, e.taper, 112, 120).rotateY(Math.PI);
    for (const c of sculpts) bulge(geo, c.c, c.r, c.a);
    const face = this.parts.add(this.joints.head, smoothNormals(geo), tag, pos);
    this.parts.markFeature(face);

    const at = (x: number, y: number) => onFace(e, sculpts, x * h, y * h, 0.0009 * h);
    const curve = (n: number, f: (u: number) => [number, number]) => Array.from({ length: n + 1 }, (_, i) => at(...f(i / n)));
    const r = 0.0013 * h;
    const lines: THREE.BufferGeometry[] = [];
    for (const s of [1, -1]) {
      // Open almond eyes: a firmer upper lid arching up, a finer lower lid; they meet at the
      // corners, the outer corner a touch higher than the inner one.
      const eyeX = (u: number) => s * (0.017 + 0.029 * u);
      const corner = (u: number) => -0.0152 + 0.0014 * u;
      lines.push(contour(curve(16, (u) => [eyeX(u), corner(u) + 0.0058 * Math.sin(Math.PI * u) ** 0.75]), r * 1.15));
      lines.push(contour(curve(12, (u) => [eyeX(0.08 + 0.84 * u), corner(0.08 + 0.84 * u) - 0.0028 * Math.sin(Math.PI * u)]), r * 0.6));
      // A slender brow following the brow ridge.
      lines.push(contour(curve(12, (u) => [s * (0.013 + 0.038 * u), 0.0035 + 0.0055 * Math.sin(Math.PI * (0.2 + 0.8 * u)) - 0.002 * u]), r * 0.75));
    }
    // Between the lips, with a gentle dip in the middle.
    lines.push(contour(curve(16, (u) => {
      const x = (u * 2 - 1) * (0.019 - 0.002 * female);
      return [x, -0.0765 + 0.0016 * (x / 0.019) ** 2 - 0.0009 * Math.cos(Math.PI * u * 2) * (1 - Math.abs(u * 2 - 1))];
    }), r * 0.9));
    // Under the nose.
    lines.push(contour(curve(10, (u) => [(u * 2 - 1) * 0.0085, -0.0605 - 0.0018 * Math.sin(Math.PI * u)]), r * 0.8));
    this.parts.addFaceLines(face, lines);
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
    this.setBody(fig.body, !!fig.proxy);
    for (const name of JOINTS) {
      const r = fig.joints[name] ?? [0, 0, 0];
      this.joints[name].rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
    }
    this.last = fig.joints;
    this.setHand('L', fig.hands.L);
    this.setHand('R', fig.hands.R);
    this.grounded = fig.grounded;
    this.joints.hips.position.set(...fig.position);
    this.ground();
  }

  /** Read joint rotations and root position back out (degrees, 0.1° precision). */
  read(): Pick<Figure, 'joints' | 'position'> {
    const joints: Figure['joints'] = {};
    for (const name of JOINTS) {
      const v = stableEuler(this.joints[name].rotation, this.last[name] ?? [0, 0, 0]);
      if (v.some((a) => a !== 0)) joints[name] = v;
    }
    const p = this.joints.hips.position;
    const r = (x: number) => Math.round(x * 1000) / 1000 || 0;
    return { joints, position: [r(p.x), r(p.y), r(p.z)] };
  }

  /** Clamp the given joints to their anatomical ranges. */
  constrain(names: readonly JointName[]) {
    for (const name of names) {
      if (name === 'hips') continue;
      const obj = this.joints[name];
      const cur = stableEuler(obj.rotation, this.last[name] ?? [0, 0, 0]);
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
    this.parts.forEachPoint((p) => { if (p.y < min) min = p.y; });
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
    let min = Infinity;
    this.parts.forEachPoint((p) => { if (p.y < min) min = p.y; });
    root.position.y -= min;
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
    return this.parts.setIdMode(on, firstId, this.style, this.isSelected);
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
