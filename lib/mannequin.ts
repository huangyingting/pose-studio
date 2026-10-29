import * as THREE from 'three';
import { bulge, contour, egg, ellipsoid, Ink, InkedParts, limb, meridian, smoothNormals, type Highlight } from './ink';
import { headForms } from './head';
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

/* ---------- body proportions ---------- */

const mix = (m: number, f: number, female: number) => m + (f - m) * female;

/**
 * An artist's proportions (8 heads tall, the crotch at half the height, long legs): the parts'
 * sizes below are for a figure 1.8 / STATURE m tall, scaled so a figure is as tall as its height.
 */
const STATURE = 0.932;
/** The legs' and arms' segments (units of a 1.8 m figure; the legs' × the body's leg length). */
const THIGH = 0.47, SHIN = 0.47, UPPER_ARM = 0.33, FOREARM = 0.29;
/** The shares of a figure's height that its legs and its head are (at leg length and head size 1). */
const LEGS_SHARE = 0.487, HEAD_SHARE = 0.118;

/**
 * A body's scale (its parts' sizes below times this): its height is kept as its legs or head are
 * made longer or shorter (the rest of it scaled to make up the difference).
 */
export const scaleOf = (b: BodyParams) => ((b.height / 1.8) * STATURE) / (1 + LEGS_SHARE * (b.legs - 1) + HEAD_SHARE * (b.head - 1));

/*
 * Sex blends the secondary sex characteristics an artist looks for in a figure:
 *   male    broad shoulders and rib cage tapering to narrow hips (V shape), pectorals, trapezius
 *           slope, thicker neck, squarer jaw, more muscular arms and calves, larger hands and feet
 *   female  shoulders narrower than the hips, defined waist (hourglass), breasts, fuller hips,
 *           glutes and upper thighs, slender neck and limbs, rounder head with a narrower chin
 */
function proportions(b: BodyParams) {
  const k = scaleOf(b);
  const female = b.sex;
  const male = 1 - b.sex;
  const mix = (m: number, f: number) => m + (f - m) * female;
  const torso = (0.9 + 0.3 * b.build) * k;
  const curve = (key: keyof typeof TORSO.male) => smoothThrough(TORSO_Y.map((y) => y * k), TORSO.male[key].map((m, i) => mix(m, TORSO.female[key][i]) * torso));
  const [w, front, back] = [curve('w'), curve('front'), curve('back')];
  return {
    k,
    torso,
    limbR: (0.82 + 0.42 * b.build) * mix(1.1, 0.92) * k,
    legs: b.legs * k,
    head: b.head * mix(1.1, 1.09) * k,
    headTaper: mix(0.03, 0.17),
    neckR: mix(0.05, 0.038) * (0.9 + 0.25 * b.build) * k,
    /** The torso's section at a height from the hips joint (its build widens and deepens it). */
    section: (y: number): Section => ({ w: w(y), front: front(y), back: back(y) }),
    shoulderX: mix(0.196, 0.158) * (0.92 + 0.16 * b.build) * k,
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

/*
 * The torso, as one form from the crotch to the base of the neck (an artist's figure, not eggs):
 * at each height (from the hips joint, for a 1.8 m figure) its half-width, and its depth in front
 * of and behind the spine. Read upwards: the crotch; the buttocks, fullest just below the hip
 * joints; the hips at the great trochanters (wider on a woman); the iliac crests; the belly; the
 * waist, narrowest (narrower on a woman); the bottom of the rib cage; the chest, deepest at the
 * nipples, widest under the arms; the shoulders' slope to the neck.
 */
const TORSO_Y = [-0.115, -0.085, -0.04, 0, 0.06, 0.12, 0.17, 0.23, 0.3, 0.38, 0.44, 0.49, 0.53];
const TORSO = {
  male: {
    w: [0.055, 0.125, 0.156, 0.155, 0.146, 0.134, 0.128, 0.142, 0.158, 0.168, 0.17, 0.152, 0.072],
    front: [0.04, 0.074, 0.084, 0.088, 0.092, 0.092, 0.088, 0.098, 0.114, 0.122, 0.11, 0.082, 0.045],
    back: [0.06, 0.106, 0.116, 0.104, 0.088, 0.076, 0.07, 0.078, 0.094, 0.104, 0.106, 0.09, 0.05],
  },
  female: {
    w: [0.06, 0.14, 0.178, 0.178, 0.155, 0.128, 0.114, 0.124, 0.138, 0.145, 0.145, 0.128, 0.06],
    front: [0.042, 0.076, 0.082, 0.086, 0.088, 0.086, 0.08, 0.086, 0.094, 0.098, 0.094, 0.074, 0.04],
    back: [0.066, 0.122, 0.134, 0.122, 0.1, 0.08, 0.07, 0.074, 0.084, 0.09, 0.09, 0.08, 0.042],
  },
};
/** The seams: where the pelvis ends and the abdomen begins (the spine joint), and the chest (its joint). */
const SEAMS = [0.07, 0.24];

/** A smooth curve through points (monotone: no bulge between them that is not in them). */
function smoothThrough(xs: number[], ys: number[]) {
  const n = xs.length;
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])));
  return (x: number) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = THREE.MathUtils.clamp((x - xs[i]) / h, 0, 1);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

type Section = { w: number; front: number; back: number };
/** How square the torso's cross-sections are (2: an ellipse). */
const SQUARE = 2.6;

/** Where the front of the torso is at (x, y). */
function torsoFront(at: (y: number) => Section, x: number, y: number) {
  const s = at(y);
  const c = Math.min(1, Math.abs(x) / s.w) ** (SQUARE / 2);
  return s.front * Math.sqrt(Math.max(0, 1 - c * c)) ** (2 / SQUARE);
}

/**
 * A piece of the torso, from y0 to y1, its ends rounded inwards (`caps`: how far), so a bent joint
 * shows a rounded end, not a hole. Made in the hips' frame.
 */
function torsoPiece(at: (y: number) => Section, y0: number, y1: number, caps: [number, number], step: number, n = 48, square = SQUARE) {
  const rings: { y: number; scale: number; s: Section }[] = [];
  const capRings = 6;
  for (let i = capRings; i > 0; i--) {
    const a = (i / capRings) * (Math.PI / 2);
    rings.push({ y: y0 - caps[0] * Math.sin(a), scale: Math.cos(a), s: at(y0) });
  }
  const count = Math.max(2, Math.ceil((y1 - y0) / step));
  for (let i = 0; i <= count; i++) {
    const y = y0 + ((y1 - y0) * i) / count;
    rings.push({ y, scale: 1, s: at(y) });
  }
  for (let i = 1; i <= capRings; i++) {
    const a = (i / capRings) * (Math.PI / 2);
    rings.push({ y: y1 + caps[1] * Math.sin(a), scale: Math.cos(a), s: at(y1) });
  }
  const pos: number[] = [];
  const index: number[] = [];
  const e = 2 / square;
  for (const r of rings) {
    for (let j = 0; j < n; j++) {
      const t = (j / n) * Math.PI * 2;
      const c = Math.cos(t), sn = Math.sin(t);
      const x = Math.sign(c) * Math.abs(c) ** e * r.s.w * r.scale;
      const z = Math.sign(sn) * Math.abs(sn) ** e * (sn > 0 ? r.s.front : r.s.back) * r.scale;
      pos.push(x, r.y, z);
    }
  }
  // (The poles: one point at each end.)
  const bottom = pos.length / 3;
  pos.push(0, y0 - caps[0], 0);
  const top = bottom + 1;
  pos.push(0, y1 + caps[1], 0);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + ((j + 1) % n), c = a + n, d = b + n;
      index.push(a, c, b, b, c, d);
    }
  }
  const last = (rings.length - 1) * n;
  for (let j = 0; j < n; j++) {
    index.push(bottom, j, (j + 1) % n);
    index.push(top, last + ((j + 1) % n), last + j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Its centre line, down the front and up the back (where it faces, in line drawings; at the back, from `backFrom`). */
function torsoMidline(at: (y: number) => Section, y0: number, y1: number, backFrom = y0) {
  const along = (from: number) => Array.from({ length: 25 }, (_, i) => from + ((y1 - from) * i) / 24);
  return [
    contour(along(y0).map((y) => new THREE.Vector3(0, y, at(y).front + 0.001))),
    contour(along(backFrom).map((y) => new THREE.Vector3(0, y, -at(y).back - 0.001))),
  ];
}

/** How far the torso reaches to either side at a height from the hips joint (contacts on its surface). */
export const torsoHalfWidth = (body: BodyParams, y: number) => proportions(body).section(y).w;
/** How big a body's torso is across and through (its scale, widened by its build). */
export const torsoScale = (body: BodyParams) => proportions(body).torso;

type Egg = { rx: number; ry: number; rz: number; taper: number };

/** Raise a surface along a line (a muscle's ridge): by `amount` on it, falling off to nothing `radius` from it. */
function ridge(geo: THREE.BufferGeometry, line: THREE.Vector3[], radius: number, amount: number) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const v = new THREE.Vector3();
  const seg = new THREE.Line3();
  const near = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let d = Infinity;
    for (let j = 1; j < line.length; j++) d = Math.min(d, seg.set(line[j - 1], line[j]).closestPointToPoint(v, true, near).distanceTo(v));
    if (d >= radius) continue;
    const w = (1 - (d / radius) ** 2) ** 2;
    pos.setXYZ(i, v.x + nrm.getX(i) * amount * w, v.y + nrm.getY(i) * amount * w, v.z + nrm.getZ(i) * amount * w);
  }
  pos.needsUpdate = true;
}

/**
 * Skin weights for the torso's pieces (made in the hips' frame): each vertex on the hips, spine
 * or chest (bones 0, 1, 2), blended across the seams between them, so the pieces' edges move
 * together and the waist bends and twists as one form.
 */
function torsoSkin(geo: THREE.BufferGeometry, seams: [number, number], blend: number) {
  const pos = geo.attributes.position;
  const index = new Uint16Array(pos.count * 4);
  const weight = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const a = THREE.MathUtils.smoothstep(y, seams[0] - blend, seams[0] + blend);
    const b = THREE.MathUtils.smoothstep(y, seams[1] - blend, seams[1] + blend);
    index.set([0, 1, 2, 0], i * 4);
    weight.set([1 - a, a * (1 - b), b, 0], i * 4);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
  return geo;
}

/** A part's mirror image across the body's middle (its triangles turned to face out again). */
function mirrored(geo: THREE.BufferGeometry) {
  const out = geo.clone().scale(-1, 1, 1);
  const index = out.index!.array;
  for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  out.index!.needsUpdate = true;
  return smoothNormals(out);
}

/** The curved lower edge of one pectoral, from the sternum out towards the armpit. */
function pectoralLine(at: (y: number) => Section, s: number, pecY: number, torso: number, k: number, pm: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = s * (0.012 + 0.11 * t) * torso;
    // Low and flat near the sternum, sweeping up to the armpit.
    const y = pecY - 0.05 * k + 0.07 * k * t * t;
    const lift = 0.012 * pm * torso * Math.sin(Math.PI * Math.min(1, t * 1.15));
    pts.push(new THREE.Vector3(x, y, torsoFront(at, x, y) + lift + 0.001));
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
  private style: Style = 'line';
  private selected: JointName | null = null;
  private highlight = false;
  /** Built as a capsule stand-in (same skeleton, simple shapes, no hands or face). */
  private standIn = false;

  /** `bare`: only to work things out with (its joints and parts), never drawn: no outlines or lines. */
  constructor(private ink: Ink, body: BodyParams, public id = '', standIn = false, private readonly bare = false) {
    this.parts = new InkedParts(ink, 'figure', bare);
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
    this.parts = new InkedParts(this.ink, 'figure', this.bare);
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
    const at = P.section;
    const [waistY, chestY] = SEAMS.map((y) => y * k);
    const [bottom, top] = [TORSO_Y[0] * k, TORSO_Y[TORSO_Y.length - 1] * k];
    const step = 0.009 * k;
    // (Each piece's ends rounded into the next, hidden until the joint between them bends.)
    const cap = 0.035 * k;
    const pelvis = torsoPiece(at, bottom, waistY, [0.02 * k, cap], step);
    // Glutes: two round masses, high and full (rounder and fuller on female figures), the cleft
    // between them, and the fold under each.
    for (const s of [1, -1]) {
      bulge(pelvis, [s * 0.064 * P.torso, -0.045 * k, -at(-0.045 * k).back], [0.07 * P.torso, 0.07 * k, 0.075 * P.torso], 0.016 * P.hips * P.torso);
    }
    bulge(pelvis, [0, -0.045 * k, -at(-0.045 * k).back], [0.012 * P.torso, 0.065 * k, 0.045 * P.torso], -0.008 * P.torso);
    // Under them, each rounds off on its own: the lower edge rises where they meet.
    const pp = pelvis.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const [x, y, z] = [pp.getX(i), pp.getY(i), pp.getZ(i)];
      if (z >= 0 || y > -0.055 * k) continue;
      const low = THREE.MathUtils.smoothstep(-y, 0.055 * k, 0.115 * k);
      pp.setY(i, y + 0.03 * k * low * Math.exp(-((x / (0.03 * P.torso)) ** 2)) * Math.min(1, -z / (0.05 * P.torso)));
    }
    // (Its back line stops above the cleft between the glutes.)
    const skin = (g: THREE.BufferGeometry) => torsoSkin(g, [waistY, chestY], 0.045 * k);
    part('hips', skin(smoothNormals(pelvis)), undefined, torsoMidline(at, bottom, waistY, 0).map(skin));

    const spine = joint('spine', root, 0, waistY);
    part('spine', skin(torsoPiece(at, waistY, chestY, [cap, cap], step)), [0, -waistY, 0], torsoMidline(at, waistY, chestY).map(skin));

    const chest = joint('chest', spine, 0, chestY - waistY);
    const ribs = torsoPiece(at, chestY, top, [cap, 0.02 * k], step);
    const chestLines = torsoMidline(at, chestY, top);
    if (P.muscle > 0.2) {
      // Pectorals: sculpted into the rib cage, with a contour line along their lower edge.
      const pm = Math.min(1.2, P.muscle);
      const pecY = 0.4 * k;
      for (const s of [1, -1]) {
        bulge(ribs, [s * 0.072 * P.torso, pecY, torsoFront(at, 0.072 * P.torso, pecY)], [0.08 * P.torso, 0.058 * k, 0.07 * P.torso], 0.014 * pm * P.torso);
      }
      chestLines.push(...[1, -1].map((s) => pectoralLine(at, s, pecY, P.torso, k, pm)));
    }
    if (P.bust > 0.02) {
      // Breasts: shaped into the chest, low and apart, their fullness below their middle.
      const by = 0.355 * k;
      for (const s of [1, -1]) {
        const bx = s * 0.078 * P.torso;
        bulge(ribs, [bx, by, torsoFront(at, bx, by)], [0.07 * P.torso, 0.072 * k, 0.09 * P.torso], (0.012 + 0.04 * P.bust) * P.torso);
      }
    }
    part('chest', skin(smoothNormals(ribs)), [0, -chestY, 0], chestLines.map(skin));

    const neck = joint('neck', chest, 0, top - chestY);
    // The neck: from the trapezius' slope at its base up under the skull, leaning forward a little;
    // the sternocleidomastoids from behind the ears down to the top of the breastbone.
    const nk = P.neckR / 0.05;
    const neckAt = smoothThrough([-0.03 * k, 0.02 * k, 0.07 * k, 0.13 * k], [1.5, 1.08, 0.98, 0.96]);
    const neckSection = (y: number): Section => ({ w: 0.05 * nk * neckAt(y), front: 0.046 * nk * Math.min(1.2, neckAt(y)), back: 0.044 * nk * Math.min(1.25, neckAt(y)) });
    const lean = (y: number) => -0.012 * k + 0.016 * k * THREE.MathUtils.clamp((y + 0.03 * k) / (0.16 * k), 0, 1);
    const neckGeo = torsoPiece(neckSection, -0.03 * k, 0.13 * k, [0.01 * k, 0.01 * k], 0.006 * k, 48, 2.2);
    const np = neckGeo.attributes.position;
    for (let i = 0; i < np.count; i++) np.setZ(i, np.getZ(i) + lean(np.getY(i)));
    neckGeo.computeVertexNormals();
    const muscles = [1, -1].map((s) => {
      // (On the neck's section, round from its side at the top to its front at its foot; raised.)
      const pts = Array.from({ length: 13 }, (_, i) => {
        const t = i / 12;
        const y = 0.11 * k - 0.13 * k * t;
        const sec = neckSection(y);
        const a = (0.15 + 0.3 * t) * Math.PI;
        return new THREE.Vector3(s * sec.w * Math.abs(Math.cos(a)) ** (2 / 2.2), y, sec.front * Math.sin(a) ** (2 / 2.2) + lean(y));
      });
      const lift = 0.0025 * nk * k;
      ridge(neckGeo, pts, 0.012 * k, lift);
      return contour(pts.map((p) => {
        const n = new THREE.Vector3(p.x / neckSection(p.y).w ** 2, 0, (p.z - lean(p.y)) / neckSection(p.y).front ** 2).normalize();
        return p.clone().addScaledVector(n, lift + 0.0015);
      }));
    });
    neckGeo.computeVertexNormals();
    part('neck', neckGeo, undefined, muscles);

    joint('head', neck, 0, 0.08 * k);
    const h = P.head;
    // A smaller taper gives a squarer jaw (male); a larger one a rounder skull and narrower chin.
    const [hx, hy, hz, ht] = [0.085 * h, 0.115 * h, 0.1 * h, P.headTaper];
    if (!this.standIn) this.buildHead(h, P.female);

    const R = P.limbR;
    const mus = P.muscle;
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 1 : -1;
      const n = (part: LimbPart) => sided(part, side);

      const shoulder = joint(n('UpperArm'), chest, P.shoulderX * s, 0.235 * k);
      part(n('UpperArm'), ball((0.054 + 0.01 * mus) * R)); // deltoid
      const upper = limb((UPPER_ARM - 0.01) * k, 0.047 * R, 0.036 * R, (0.004 + 0.007 * mus) * R, 0.35);
      part(n('UpperArm'), upper.geometry, undefined, [upper.ring(0.5)]);

      const elbow = joint(n('LowerArm'), shoulder, 0, -UPPER_ARM * k);
      part(n('LowerArm'), ball(0.042 * R));
      const fore = limb((FOREARM - 0.015) * k, 0.038 * R, 0.026 * R, (0.005 + 0.006 * mus) * R, 0.22);
      part(n('LowerArm'), fore.geometry, undefined, [fore.ring(0.5)]);

      const wrist = joint(n('Hand'), elbow, 0, -FOREARM * k);
      part(n('Hand'), ball(0.029 * R));
      this.hands[side] = this.standIn ? { segments: [], side: s } : this.buildHand(wrist, n('Hand'), s, k * P.extremity);

      const hip = joint(n('UpperLeg'), root, P.hipX * s, -0.07 * k);
      part(n('UpperLeg'), ball(0.08 * R * (1 + 0.16 * P.female)));
      // Fuller upper thighs on female figures, more taper on male ones.
      // (As full at the top as the hips round it: fuller on a woman, whose limbs are slenderer.)
      const thigh = limb((THIGH - 0.03) * P.legs, 0.085 * R * (0.92 + 0.12 * P.hips) * (1 + 0.16 * P.female), 0.05 * R, (0.006 + 0.008 * P.hips) * R, 0.28);
      part(n('UpperLeg'), thigh.geometry, undefined, [thigh.ring(0.45)]);

      const knee = joint(n('LowerLeg'), hip, 0, -THIGH * P.legs);
      part(n('LowerLeg'), ball(0.057 * R));
      const shin = limb((SHIN - 0.03) * P.legs, 0.05 * R, 0.031 * R, (0.01 + 0.007 * mus) * R, 0.3); // calf
      part(n('LowerLeg'), shin.geometry, undefined, [shin.ring(0.4)]);

      joint(n('Foot'), knee, 0, -SHIN * P.legs);
      part(n('Foot'), ball(0.036 * R));
      const fk = k * P.extremity;
      part(n('Foot'), ellipsoid(0.045 * R, 0.035 * fk, 0.115 * fk), [0, -0.05 * k, 0.055 * fk]);
    }
    if (this.standIn) this.buildStandIn(P, { rx: hx, ry: hy, rz: hz, taper: ht });
    else {
      // The torso's pieces bound to the hips, spine and chest as they stand now (at rest).
      const bones = (['hips', 'spine', 'chest'] as const).map((j) => {
        const b = new THREE.Bone();
        this.joints[j].add(b);
        return b;
      });
      this.object.updateMatrixWorld(true);
      this.parts.bindSkins(new THREE.Skeleton(bones));
    }
  }

  /** Capsules on the same skeleton: a torso, a plain head (its centre line shows where it faces) and limbs. */
  private buildStandIn(P: ReturnType<typeof proportions>, head: Egg) {
    const { k } = P;
    const R = P.limbR;
    const add = (j: JointName, geo: THREE.BufferGeometry, pos?: Vec3, rings: THREE.BufferGeometry[] = []) =>
      this.parts.add(this.joints[j], geo, { joint: j, figure: this.id }, pos, rings);
    // (Capsules: coarser than the mannequin's parts, a stand-in is the lighter of the two.)
    const capsule = (len: number, r1: number, r2: number) => limb(len, r1, r2, 0, 0.35, 16, 8, 5).geometry;
    const up = (len: number, r1: number, r2: number) => capsule(len, r1, r2).rotateZ(Math.PI);
    const torso = up(0.6 * k, 0.15 * P.torso, mix(0.17, 0.14, P.female) * P.torso).scale(1, 1, 0.68);
    add('hips', torso, [0, -0.12 * k, 0]);
    add('head', egg(head.rx, head.ry, head.rz, head.taper), [0, 0.1 * P.head, 0.01 * P.head], [meridian(head.ry, head.rz, head.taper)]);
    for (const side of ['L', 'R'] as const) {
      add(sided('UpperArm', side), capsule(UPPER_ARM * k, 0.05 * R, 0.038 * R));
      add(sided('LowerArm', side), capsule((FOREARM + 0.095) * k, 0.038 * R, 0.032 * R));
      add(sided('UpperLeg', side), capsule(THIGH * P.legs, 0.08 * R, 0.05 * R));
      add(sided('LowerLeg', side), capsule(SHIN * P.legs, 0.05 * R, 0.04 * R));
      // Round joints keep bent limbs smooth where the capsules meet.
      add(sided('LowerArm', side), new THREE.SphereGeometry(0.044 * R, 16, 10));
      add(sided('LowerLeg', side), new THREE.SphereGeometry(0.058 * R, 16, 10));
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
  /** The head (lib/head.ts): its form, its face (shown with face features) or a plain one, ears. */
  private buildHead(h: number, female: number) {
    const pos: Vec3 = [0, 0.1 * h, 0.01 * h];
    const at = (p: Vec3): Vec3 => [pos[0] + p[0], pos[1] + p[1], pos[2] + p[2]];
    const tag = { joint: 'head' as JointName, figure: this.id };
    const forms = headForms(h, female);
    this.parts.markPlain(this.parts.add(this.joints.head, forms.plain, tag, pos));
    const face = this.parts.add(this.joints.head, forms.face, tag, pos);
    this.parts.markFeature(face);
    this.parts.addFaceLines(face, forms.lines);
    this.parts.add(this.joints.head, forms.ear, tag, at(forms.earAt));
    const [x, y, z] = forms.earAt;
    this.parts.add(this.joints.head, mirrored(forms.ear), tag, at([-x, y, z]));
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
        // (A finger's segment: a few centimetres, a coarse capsule is as round.)
        this.parts.add(parent, limb(len * k, radius, radius * 0.9, 0, 0.35, 10, 3, 4).geometry, tag);
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
    return this.parts.lowest();
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
    root.position.y -= this.parts.lowest();
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
