import * as THREE from 'three';
import { bulge, contour, smoothNormals } from './ink';
import type { Vec3 } from './types';

/*
 * The mannequin's head (an artist's maquette, after a design sheet drawn for it): a cranium larger
 * than the face, its back rounded and tucked in above the neck; the face narrowing past the
 * cheekbones to the jaw and chin (a squarer jaw on a man); the face's forms sculpted into it (brow,
 * eye sockets, nose, lips, chin, cheekbones); ears, between the brow and the base of the nose,
 * behind the jaw; and hair as one sculpted mass (a buzz cut on a man; a short bob on a woman). In units of the head's size `h` (a 1.8 m figure's is 1), the eyes at y = 0, the
 * face towards +z.
 */

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** A point of the unit sphere (a direction) → the head's surface there (before its face is sculpted). */
function headPoint(dir: THREE.Vector3, female: number): THREE.Vector3 {
  const male = 1 - female;
  const below = Math.max(0, -dir.y);
  // Below the eyes, squarer than a sphere (it would come to a point at the chin): the jaw.
  const round = Math.hypot(dir.x, dir.z);
  const square = below > 0 ? (1 - below ** (3 + 0.6 * male)) ** (1 / (3 + 0.6 * male)) : round;
  const d = new THREE.Vector3(round > 1e-6 ? (dir.x / round) * square : 0, dir.y, round > 1e-6 ? (dir.z / round) * square : 0);
  // The cranium: up, and towards the back.
  let x = d.x * 0.075;
  const y = d.y >= 0 ? d.y * 0.104 : d.y * (0.112 - 0.004 * female);
  let z = d.z * 0.097 - 0.008;
  // The face below the cheekbones narrows to the chin; a man's jaw keeps its width further down.
  x *= 1 - male * (0.14 * smooth(0.3, 0.8, below) + 0.32 * smooth(0.8, 1, below)) - female * (0.2 * smooth(0.25, 0.8, below) + 0.3 * smooth(0.8, 1, below));
  // The temples, a little in from the forehead's sides.
  x *= 1 - 0.07 * Math.max(0, d.z) * Math.exp(-(((d.y - 0.3) / 0.25) ** 2));
  // Under the back of the skull, it tucks in to the neck.
  if (d.z < 0) z = -0.008 + d.z * 0.097 * (1 - 0.62 * smooth(0.05, 0.85, below));
  // The forehead and face: flatter than the skull's curve; the chin forward of the throat.
  else z = -0.008 + d.z * (0.097 + 0.008 * smooth(0.6, 1, below) - 0.006 * Math.max(0, d.y));
  return new THREE.Vector3(x, y + 0.004, z);
}

/** The head's form as a mesh. */
function headMesh(female: number, h: number) {
  const geo = new THREE.SphereGeometry(1, 96, 72);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const p = headPoint(v, female).multiplyScalar(h);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  // (Its seam, at one side, and its poles, the crown and under the chin: one normal at each.)
  return smoothNormals(geo);
}

/** The head's surface at an azimuth (round from the face) and height on the unit sphere. */
function surfaceAt(female: number, az: number, el: number) {
  const c = Math.cos(el);
  return headPoint(new THREE.Vector3(Math.sin(az) * c, Math.sin(el), Math.cos(az) * c), female);
}

/**
 * Where the head's surface is with two of its coordinates given (`axes`: which two; e.g. x and y,
 * on its front), and its outward normal there: found from a guess by Newton's method (not by
 * casting rays at its mesh: the mannequin is rebuilt as its body is changed).
 */
function solveSurface(female: number, target: [number, number], axes: [0 | 1 | 2, 0 | 1 | 2], guess: [number, number]) {
  let [az, el] = guess;
  const f = (a: number, e: number) => {
    const p = surfaceAt(female, a, e).toArray();
    return [p[axes[0]] - target[0], p[axes[1]] - target[1]];
  };
  const eps = 1e-4;
  for (let i = 0; i < 12; i++) {
    const [r0, r1] = f(az, el);
    if (Math.abs(r0) + Math.abs(r1) < 1e-7) break;
    const [a0, a1] = f(az + eps, el);
    const [e0, e1] = f(az, el + eps);
    const j = [[(a0 - r0) / eps, (e0 - r0) / eps], [(a1 - r1) / eps, (e1 - r1) / eps]];
    const det = j[0][0] * j[1][1] - j[0][1] * j[1][0];
    if (Math.abs(det) < 1e-12) break;
    az -= (j[1][1] * r0 - j[0][1] * r1) / det;
    el -= (-j[1][0] * r0 + j[0][0] * r1) / det;
    el = THREE.MathUtils.clamp(el, -1.5, 1.5);
  }
  const p = surfaceAt(female, az, el);
  const n = surfaceAt(female, az + eps, el).sub(p).cross(surfaceAt(female, az, el + eps).sub(p)).normalize();
  // (Outwards: away from the head's middle.)
  if (n.dot(p.clone().sub(new THREE.Vector3(0, 0.004, -0.008))) < 0) n.negate();
  return { p, n };
}

/** The front of the head at (x, y) (in units of h), and its normal there. */
const frontAt = (female: number) => (x: number, y: number) => solveSurface(female, [x, y], [0, 1], [Math.asin(THREE.MathUtils.clamp(x / 0.08, -0.9, 0.9)), Math.asin(THREE.MathUtils.clamp(y / 0.11, -0.95, 0.95))]);

interface Sculpt { c: Vec3; r: Vec3; a: number }

/** The face's forms, each a soft push in or out of the surface (head units: × h). */
function faceSculpts(front: (x: number, y: number) => { p: THREE.Vector3 }, h: number, female: number): Sculpt[] {
  const male = 1 - female;
  const at = (x: number, y: number): Vec3 => front(x, y).p.multiplyScalar(h).toArray() as Vec3;
  const s = (c: Vec3, r: Vec3, a: number): Sculpt => ({ c, r: r.map((v) => v * h) as Vec3, a: a * h });
  const out: Sculpt[] = [
    s(at(0, 0.012), [0.06, 0.015, 0.03], 0.0035 + 0.003 * male), // brow ridge
    s(at(0, -0.022), [0.009, 0.026, 0.03], 0.007 + 0.002 * male), // nose bridge
    s(at(0, -0.043), [0.012, 0.016, 0.03], 0.012 + 0.003 * male), // nose: its lower half
    s(at(0, -0.054), [0.012, 0.01, 0.03], 0.009 + 0.002 * male), // nose tip
    s(at(0, -0.069), [0.018, 0.0055, 0.025], 0.0035 + 0.0015 * female), // upper lip
    s(at(0, -0.08), [0.016, 0.0065, 0.025], 0.004 + 0.0022 * female), // lower lip
    s(at(0, -0.088), [0.012, 0.004, 0.02], -0.0025), // under the lower lip
    s(at(0, -0.1), [0.02 + 0.01 * male, 0.013, 0.035], 0.004 + 0.003 * male), // chin
  ];
  for (const k of [1, -1]) {
    out.push(
      s(at(k * 0.03, -0.012), [0.02, 0.013, 0.03], -0.005), // eye socket
      s(at(k * 0.03, -0.012), [0.011, 0.0065, 0.02], 0.0028), // the eye in it
      s(at(k * 0.011, -0.055), [0.0075, 0.007, 0.02], 0.0045), // nostril wing
      s(at(k * 0.045, -0.034), [0.024, 0.018, 0.04], 0.0035 + 0.001 * female), // cheekbone
      s(at(k * 0.03, -0.068), [0.012, 0.016, 0.03], -0.002), // beside the mouth
    );
  }
  return out;
}

/** An ear: an oval shell, its rim round its hollow; on the left side (x > 0), its face outwards. */
function earGeometry(h: number) {
  const geo = new THREE.SphereGeometry(1, 28, 20).scale(0.0065 * h, 0.031 * h, 0.0155 * h);
  // Its hollow (the concha), on its outer face, low and forward.
  bulge(geo, [0.007 * h, -0.004 * h, 0.002 * h], [0.006 * h, 0.014 * h, 0.011 * h], -0.0045 * h);
  // Its top (the helix) wider than its lobe.
  bulge(geo, [0, 0.016 * h, -0.004 * h], [0.01 * h, 0.014 * h, 0.016 * h], 0.002 * h);
  // Leaning back; its back edge standing out from the head more than its front.
  return smoothNormals(geo).rotateX(-0.22).rotateY(-0.32);
}

/** Where a man's hair starts all round (unit-sphere height, by the angle round from the face): forehead, temples, over the ears, the nape. */
function hairline(angle: number) {
  const a = Math.abs(angle);
  return a < 0.9 ? 0.5 - 0.22 * smooth(0, 0.9, a)
    : a < 1.75 ? 0.28 - 0.26 * smooth(0.9, 1.75, a)
      : 0.02 - 0.6 * smooth(1.75, 2.7, a);
}

/** Where a woman's bob ends all round: its fringe above her brows, down to her jaw at the sides and back (her face left open between). */
function bobEdge(angle: number) {
  const a = Math.abs(angle);
  return 0.24 - 0.1 * smooth(0.2, 0.7, a) - 0.82 * smooth(0.7, 1.35, a);
}

/** The head's middle (unit), which hair stands out from. */
const MIDDLE = new THREE.Vector3(0, 0.004, -0.008);

/**
 * The hair: a man's a buzz cut (a thin, even cap from his hairline up); a woman's a short bob,
 * from the crown down: a fringe over her forehead, and at the sides and back falling straight
 * from where her head is widest to her jaw (clear of her ears), its ends turned in a little.
 */
function hairGeometry(female: number, h: number) {
  const bob = female >= 0.5;
  const columns = 96;
  const rows = 40;
  // (How far out the bob hangs at each angle: the head at its widest there, and its thickness.)
  const widest = (angle: number) => {
    const d = new THREE.Vector3(Math.sin(angle) * 0.995, 0.1, Math.cos(angle) * 0.995).normalize();
    const p = headPoint(d, female).sub(MIDDLE);
    return Math.hypot(p.x, p.z) + 0.009 + 0.011 * Math.abs(Math.sin(angle));
  };
  const pos: number[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < columns; c++) {
      const angle = (c / columns) * Math.PI * 2 - Math.PI;
      const start = bob ? bobEdge(angle) : hairline(angle);
      const v = r / rows;
      const y = start + (1 - start) * (1 - (1 - v) ** 1.5);
      const round = Math.sqrt(Math.max(0, 1 - y * y));
      const d = new THREE.Vector3(Math.sin(angle) * round, y, Math.cos(angle) * round);
      const p = headPoint(d, female);
      const n = p.clone().sub(MIDDLE).normalize();
      if (!bob) {
        // (Close-cropped: as thick at the hairline as over the crown.)
        p.addScaledVector(n, 0.0032 + 0.0012 * Math.max(0, y) * smooth(0, 0.2, v));
      } else {
        p.addScaledVector(n, 0.006 + 0.008 * Math.max(0, y) + 0.003 * Math.max(0, d.z) * smooth(0.1, 0.6, y));
        // Below its widest, at the sides and back, it falls (gradually: out to where it hangs);
        // at the back closer in, to the nape; its ends turned in.
        const side = smooth(0.6, 1.1, Math.abs(angle));
        const fall = smooth(0.15, -0.3, y);
        if (side > 0 && fall > 0) {
          const q = p.clone().sub(MIDDLE);
          const r0 = Math.hypot(q.x, q.z);
          const back = smooth(1.9, 2.8, Math.abs(angle));
          const r1 = (widest(angle) - 0.012 * back) * (1 - 0.05 * smooth(-0.45, bobEdge(angle), y));
          if (r1 > r0) {
            const k = 1 + (r1 / r0 - 1) * side * fall;
            p.set(MIDDLE.x + q.x * k, p.y, MIDDLE.z + q.z * k);
          }
        }
      }
      p.multiplyScalar(h);
      pos.push(p.x, p.y, p.z);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const a = r * columns + c, b = r * columns + ((c + 1) % columns), d = a + columns, e = b + columns;
      index.push(a, b, d, b, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  // (Its top row all one point, the crown: one normal there.)
  return smoothNormals(geo);
}

export interface HeadForms {
  /** The head without its face (while faces are off). */
  plain: THREE.BufferGeometry;
  /** With its face sculpted, and the lines drawn on it (eyes, brows, lips, under the nose). */
  face: THREE.BufferGeometry;
  lines: THREE.BufferGeometry[];
  /** The left ear and where it goes (the right: its mirror). */
  ear: THREE.BufferGeometry;
  earAt: Vec3;
  hair: THREE.BufferGeometry;
}

// The last few heads made (a body's other settings change more often than its head and sex).
const made = new Map<string, HeadForms>();

/** The head for a size and sex: its geometry the caller's own (to dispose of). */
export function headForms(h: number, female: number): HeadForms {
  const key = `${h.toFixed(5)}:${female.toFixed(3)}`;
  let forms = made.get(key);
  if (!forms) {
    forms = makeHead(h, female);
    made.set(key, forms);
    if (made.size > 6) made.delete(made.keys().next().value!);
  }
  const f = forms;
  return { ...f, plain: f.plain.clone(), face: f.face.clone(), lines: f.lines.map((l) => l.clone()), ear: f.ear.clone(), hair: f.hair.clone() };
}

function makeHead(h: number, female: number): HeadForms {
  const plain = headMesh(female, h);
  const face = plain.clone();
  const front = frontAt(female);
  const sculpts = faceSculpts(front, h, female);
  for (const c of sculpts) bulge(face, c.c, c.r, c.a);
  smoothNormals(face);

  // Lines on the sculpted face, a hair's breadth out from it (its forms added to the head's front).
  const on = (x: number, y: number) => {
    const { p, n } = front(x, y);
    p.multiplyScalar(h);
    let lift = 0.0009 * h;
    for (const c of sculpts) {
      const d2 = ((p.x - c.c[0]) / c.r[0]) ** 2 + ((p.y - c.c[1]) / c.r[1]) ** 2 + ((p.z - c.c[2]) / c.r[2]) ** 2;
      if (d2 < 1) lift += c.a * (1 - d2) * (1 - d2);
    }
    return p.addScaledVector(n, lift);
  };
  const curve = (n: number, f: (u: number) => [number, number]) => Array.from({ length: n + 1 }, (_, i) => on(...f(i / n)));
  const r = 0.0013 * h;
  const lines: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    // Almond eyes: a firmer upper lid arching up, a finer lower lid; the outer corner a touch higher.
    const eyeX = (u: number) => s * (0.017 + 0.027 * u);
    const corner = (u: number) => -0.0135 + 0.0016 * u;
    lines.push(contour(curve(16, (u) => [eyeX(u), corner(u) + 0.0056 * Math.sin(Math.PI * u) ** 0.75]), r * 1.15));
    lines.push(contour(curve(12, (u) => [eyeX(0.08 + 0.84 * u), corner(0.08 + 0.84 * u) - 0.0026 * Math.sin(Math.PI * u)]), r * 0.6));
    // A brow along the brow ridge.
    lines.push(contour(curve(12, (u) => [s * (0.013 + 0.037 * u), 0.006 + 0.005 * Math.sin(Math.PI * (0.2 + 0.8 * u)) - 0.002 * u]), r * (0.75 + 0.25 * (1 - female))));
  }
  // Between the lips, a gentle dip in the middle.
  lines.push(contour(curve(16, (u) => {
    const x = (u * 2 - 1) * (0.019 - 0.002 * female);
    return [x, -0.0745 + 0.0016 * (x / 0.019) ** 2 - 0.0008 * Math.cos(Math.PI * u * 2) * (1 - Math.abs(u * 2 - 1))];
  }), r * 0.9));
  // Under the nose.
  lines.push(contour(curve(10, (u) => [(u * 2 - 1) * 0.009, -0.0605 - 0.0016 * Math.sin(Math.PI * u)]), r * 0.8));

  // The ear: against the side of the head between the brow and the base of the nose, behind the jaw.
  const earY = -0.026;
  const side = solveSurface(female, [earY, -0.012], [1, 2], [Math.PI / 2, Math.asin(earY / 0.11)]).p.x * h;
  return {
    plain, face, lines,
    ear: earGeometry(h), earAt: [side + 0.004 * h, earY * h, -0.012 * h],
    hair: hairGeometry(female, h),
  };
}
