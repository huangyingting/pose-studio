import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Ink, InkedParts } from './ink';
import type { Prop, PropKind, Style, Vec3 } from './types';

const D2R = Math.PI / 180;

function box(w: number, h: number, d: number, r = 0.015) {
  return new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
}

/** Cylinder with rounded rims (smooth normals keep the outline hull crack-free). */
function cylinder(radius: number, height: number, bevel = 0.012) {
  const b = Math.min(bevel, radius / 2, height / 2);
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, -height / 2)];
  const arc = (cx: number, cy: number, from: number, to: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = from + ((to - from) * i) / 6;
      pts.push(new THREE.Vector2(cx + b * Math.cos(a), cy + b * Math.sin(a)));
    }
  };
  arc(radius - b, -height / 2 + b, -Math.PI / 2, 0);
  arc(radius - b, height / 2 - b, 0, Math.PI / 2);
  pts.push(new THREE.Vector2(0, height / 2));
  return new THREE.LatheGeometry(pts, 40);
}

/** A part, where it goes, and (false) whether nothing bumps into it: what hands grip, as a car's steering wheel. */
type Piece = [THREE.BufferGeometry, Vec3, solid?: false];

/** A rod from a to b (a car's pillar, a steering column): placed at its middle. */
function strut(a: Vec3, b: Vec3, radius: number): Piece {
  const [p, q] = [new THREE.Vector3(...a), new THREE.Vector3(...b)];
  const along = q.clone().sub(p);
  const geo = cylinder(radius, along.length(), radius / 3).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize()));
  const mid = p.add(q).multiplyScalar(0.5);
  return [geo, [mid.x, mid.y, mid.z]];
}

/**
 * A car's driver, in its own frame (facing +z, x to its left, from its middle on the ground): where
 * the hips are in the driver's seat, as the Library's getting in, driving and getting out have them.
 */
export const CAR_DRIVER = { at: [0.37, -0.1] as [number, number], hips: 0.84 };

/** A gymnastics ribbon: the stick (its tip this far along it), the ribbon's length and its cross-section, in segments. */
export const RIBBON = { stick: 0.6, length: 4, width: 0.05, thickness: 0.004, segments: 20 };

/**
 * Where hands take hold of a prop, in its own frame at its size: its own handles, or a long box's
 * two ends (a stretcher, a bench, a table carried by two). None: it is held as its kind is.
 */
export function handlesOf(p: Pick<Prop, 'kind' | 'scale' | 'handles'>): Vec3[] {
  const own = p.handles ?? (p.kind === 'box' && p.scale[0] >= 1.2 ? [[0.5, 0.5, 0], [-0.5, 0.5, 0]] as Vec3[] : []);
  return own.map((h) => [h[0] * p.scale[0], h[1] * p.scale[1], h[2] * p.scale[2]]);
}

/** A basketball hoop's rim, in the prop's own frame: its centre and radius. */
export const RIM = { at: [0, 3.05, 0.87] as Vec3, radius: 0.23 };

function pieces(kind: PropKind): Piece[] {
  switch (kind) {
    case 'box':
      return [[box(1, 1, 1, 0.03), [0, 0.5, 0]]];
    case 'sphere':
      return [[new THREE.SphereGeometry(0.5, 40, 28), [0, 0.5, 0]]];
    case 'cylinder':
      return [[cylinder(0.5, 1, 0.03), [0, 0.5, 0]]];
    case 'wall':
      return [[box(1, 1, 0.06, 0.01), [0, 0.5, 0]]];
    case 'step':
      return [[box(0.7, 0.2, 0.4, 0.015), [0, 0.1, 0]]];
    case 'stool': {
      const legs: Piece[] = [0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return [cylinder(0.018, 0.47, 0.006), [Math.cos(a) * 0.12, 0.235, Math.sin(a) * 0.12]];
      });
      return [[cylinder(0.18, 0.04, 0.012), [0, 0.49, 0]], ...legs];
    }
    case 'mat': // a landing mat
      return [[box(3, 0.4, 2, 0.08), [0, 0.2, 0]]];
    case 'hoop': // a basketball hoop on its post: the rim at 3.05 m, in front of the board (see RIM)
      return [
        [box(0.6, 0.08, 0.9, 0.02), [0, 0.04, -0.1]],
        [cylinder(0.06, 3.3, 0.01), [0, 1.65, 0]],
        [box(0.08, 0.08, 0.6), [0, 3.25, 0.3]],
        [box(1.8, 1.05, 0.04, 0.01), [0, 3.4, 0.62]],
        [new THREE.TorusGeometry(RIM.radius, 0.012, 8, 40).rotateX(Math.PI / 2), RIM.at],
      ];
    case 'bar': { // high-jump uprights 4 m apart with the bar across their tops: its height is the prop's height
      const post = (x: number): Piece => [cylinder(0.025, 1, 0.006), [x, 0.5, 0]];
      return [post(-2), post(2), [cylinder(0.015, 4, 0.004).rotateZ(Math.PI / 2), [0, 1, 0]]];
    }
    // Handheld: drawn upright from their base, like the rest, so they also stand on the floor.
    case 'ribbon': // the stick; the ribbon itself follows how the tip moves (setTrail)
      return [[cylinder(0.008, RIBBON.stick, 0.004), [0, RIBBON.stick / 2, 0]]];
    case 'ring': // a rhythmic gymnastics hoop, hanging from its top
      return [[new THREE.TorusGeometry(0.4, 0.01, 8, 48), [0, -0.4, 0]]];
    case 'stick':
      return [[cylinder(0.016, 1, 0.006), [0, 0.5, 0]]];
    case 'phone':
      return [[box(0.072, 0.148, 0.009, 0.006), [0, 0.074, 0]]];
    case 'cup':
      return [
        [cylinder(0.04, 0.1, 0.008), [0, 0.05, 0]],
        [new THREE.TorusGeometry(0.024, 0.006, 10, 24, Math.PI).rotateZ(-Math.PI / 2), [0.04, 0.052, 0]],
      ];
    case 'book':
      return [[box(0.15, 0.22, 0.03, 0.004), [0, 0.11, 0]]];
    // (Guns: the grip up from the base, the barrel ahead along +z over it; held, the grip goes
    // through the fist and the barrel along the fingers: lib/hold.ts.)
    case 'pistol':
      return [[box(0.03, 0.11, 0.028, 0.006), [0, 0.055, 0]], [box(0.03, 0.034, 0.19, 0.006), [0, 0.125, 0.05]]];
    case 'rifle':
      return [
        [box(0.03, 0.1, 0.03, 0.006), [0, 0.05, 0]],
        [box(0.05, 0.075, 0.5, 0.01), [0, 0.12, 0.05]],
        [box(0.045, 0.12, 0.26, 0.01), [0, 0.1, -0.32]],
        [cylinder(0.011, 0.42, 0.003).rotateX(Math.PI / 2), [0, 0.135, 0.5]],
      ];
    // (Held at the base: the handle through the fist, the rest on from it.)
    case 'sword':
      return [[cylinder(0.016, 0.2, 0.005), [0, 0.1, 0]], [box(0.2, 0.025, 0.03, 0.005), [0, 0.21, 0]], [box(0.05, 0.75, 0.008, 0.003), [0, 0.6, 0]]];
    case 'knife':
      return [[cylinder(0.014, 0.11, 0.005), [0, 0.055, 0]], [box(0.05, 0.012, 0.022, 0.003), [0, 0.116, 0]], [box(0.028, 0.17, 0.004, 0.0015), [0, 0.207, 0]]];
    case 'bat':
      return [[cylinder(0.015, 0.42, 0.005), [0, 0.21, 0]], [cylinder(0.033, 0.46, 0.014), [0, 0.6, 0]], [cylinder(0.022, 0.02, 0.006), [0, 0.01, 0]]];
    case 'club':
      return [[cylinder(0.012, 0.26, 0.004), [0, 0.13, 0]], [cylinder(0.006, 0.8, 0.002), [0, 0.66, 0]], [box(0.11, 0.035, 0.05, 0.012), [0.04, 1.07, 0]]];
    case 'shield': // standing on its rim, its face ahead (+z): held on the forearm
      return [[cylinder(0.3, 0.03, 0.012).rotateX(Math.PI / 2), [0, 0.3, 0]], [cylinder(0.06, 0.02, 0.008).rotateX(Math.PI / 2), [0, 0.3, 0.025]]];
    case 'bag': // a handbag, its handle over the top
      return [[box(0.32, 0.24, 0.12, 0.03), [0, 0.12, 0]], [new THREE.TorusGeometry(0.09, 0.008, 8, 24, Math.PI), [0, 0.24, 0]]];
    case 'bow': { // standing on its lower tip, its grip 0.7 m up; its back ahead (+z), the string behind
      const [chord, rise] = [1.4, 0.2];
      const r = (chord * chord / 4 + rise * rise) / (2 * rise);
      const half = Math.asin(chord / 2 / r);
      const limbs = new THREE.TorusGeometry(r, 0.012, 8, 40, half * 2).rotateZ(-half).rotateY(-Math.PI / 2).translate(0, 0, -r);
      return [[limbs, [0, 0.7, 0]], [cylinder(0.02, 0.14, 0.006), [0, 0.7, 0]], [cylinder(0.0015, chord, 0.0005), [0, 0.7, -rise]]];
    }
    case 'dumbbell': // on end; its handle between a weight either side
      return [[cylinder(0.015, 0.26, 0.004), [0, 0.13, 0]], [cylinder(0.055, 0.06, 0.01), [0, 0.23, 0]], [cylinder(0.055, 0.06, 0.01), [0, 0.03, 0]]];
    case 'kettlebell': // on its base, its handle over the top
      return [[new THREE.SphereGeometry(0.11, 24, 16), [0, 0.11, 0]], [new THREE.TorusGeometry(0.075, 0.014, 8, 20, Math.PI), [0, 0.19, 0]]];
    case 'barbell': // lying on its plates, along x
      return [[cylinder(0.014, 2, 0.004).rotateZ(Math.PI / 2), [0, 0.22, 0]], [cylinder(0.22, 0.05, 0.01).rotateZ(Math.PI / 2), [0.8, 0.22, 0]], [cylinder(0.22, 0.05, 0.01).rotateZ(Math.PI / 2), [-0.8, 0.22, 0]]];
    case 'water': // a pool's water, its surface 1 m up (scaled): drawn see-through, and not solid
      return [[box(1, 1, 1, 0.002), [0, 0.5, 0], false]];
    case 'chair': {
      const legs: Piece[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => [cylinder(0.02, 0.44, 0.006), [x * 0.19, 0.22, z * 0.19]]);
      return [
        [box(0.46, 0.05, 0.46), [0, 0.465, 0]],
        [box(0.46, 0.42, 0.04), [0, 0.72, -0.21]],
        ...legs,
      ];
    }
    case 'car': { // facing +z, the driver's seat on its left (+x), the driver's door open; room inside for the driver's body (CAR_DRIVER)
      const [dx, dz] = CAR_DRIVER.at;
      const wheel = (x: number, z: number): Piece => [cylinder(0.33, 0.22, 0.04).rotateZ(Math.PI / 2), [x, 0.33, z]];
      const seat = (x: number): Piece[] => [[box(0.48, 0.46, 0.56, 0.05), [x, 0.41, dz]], [box(0.48, 0.72, 0.1, 0.04), [x, 1, dz - 0.38]]];
      const side = (x: number): Piece[] => [
        strut([x * 0.84, 1, 0.75], [x * 0.8, 1.55, 0.45], 0.03),
        strut([x * 0.86, 1, -0.55], [x * 0.82, 1.55, -0.55], 0.03),
        strut([x * 0.86, 1, -1.5], [x * 0.82, 1.55, -1.4], 0.03),
      ];
      const column = strut([dx - 0.04, 1.07, 0.23], [dx - 0.04, 0.98, 0.5], 0.025) as [THREE.BufferGeometry, Vec3];
      // (The driver's door, hinged at its front, swung 70° open.)
      const open = 70 * D2R;
      return [
        wheel(0.78, 1.35), wheel(-0.78, 1.35), wheel(0.78, -1.4), wheel(-0.78, -1.4),
        [box(1.6, 0.06, 2.25, 0.02), [0, 0.15, -0.375]],
        [box(1.8, 0.7, 1.45, 0.08), [0, 0.65, 1.475]],
        [box(1.8, 0.7, 0.7, 0.08), [0, 0.65, -1.85]],
        [box(0.06, 0.82, 2.25, 0.02), [-0.87, 0.61, -0.375]],
        [box(0.06, 0.82, 0.95, 0.02), [0.87, 0.61, -1.025]],
        [box(0.05, 0.82, 1, 0.02).rotateY(-open), [0.9 + 0.5 * Math.sin(open), 0.61, 0.75 - 0.5 * Math.cos(open)]],
        [box(1.7, 0.25, 0.3, 0.04), [0, 0.975, 0.62]],
        [new THREE.TorusGeometry(0.16, 0.018, 8, 32).rotateX(20 * D2R), [dx - 0.04, 1.07, 0.23], false],
        [...column, false],
        ...seat(dx), ...seat(-dx),
        [box(1.5, 0.44, 0.5, 0.05), [0, 0.4, -1.15]], [box(1.5, 0.6, 0.1, 0.04), [0, 0.92, -1.45]],
        [box(1.64, 0.05, 1.9, 0.02), [0, 1.575, -0.5]],
        ...side(1), ...side(-1),
      ];
    }
  }
}

/** A posable scene prop drawn in the same ink style as the figures. */
export class PropObject {
  readonly object = new THREE.Group();
  readonly parts: InkedParts;
  private style: Style = 'line';
  private selected = false;
  private hovered = false;

  /** A ribbon's ribbon (drawn, but not solid: nothing stands on it or bumps into it). */
  private ribbon: THREE.Mesh | null = null;
  /** Its parts that are not solid either (gripped: a car's steering wheel). */
  private loose = new Set<THREE.Mesh>();

  constructor(ink: Ink, readonly kind: PropKind, readonly id: string) {
    this.parts = new InkedParts(ink, 'prop');
    for (const [geo, pos, solid] of pieces(kind)) {
      const mesh = this.parts.add(this.object, geo, { prop: id }, pos);
      if (solid === false) this.loose.add(mesh);
      if (kind === 'water') mesh.castShadow = false;
    }
    this.parts.water = kind === 'water';
    if (kind === 'ribbon') {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RIBBON.segments + 1) * 4 * 3), 3));
      const index: number[] = [];
      for (let i = 0; i < RIBBON.segments; i++) {
        for (let k = 0; k < 4; k++) {
          const [a, b, c, d] = [i * 4 + k, i * 4 + ((k + 1) % 4), (i + 1) * 4 + k, (i + 1) * 4 + ((k + 1) % 4)];
          index.push(a, b, c, b, d, c);
        }
      }
      const e = RIBBON.segments * 4;
      index.push(0, 2, 1, 0, 3, 2, e, e + 1, e + 2, e, e + 2, e + 3);
      geo.setIndex(index);
      this.ribbon = this.parts.add(this.object, geo, { prop: id });
      this.ribbon.castShadow = false;
    }
    this.object.rotation.order = 'XYZ';
    this.refresh();
    this.setTrail(null);
  }

  /** The parts that are solid: what stands on the floor, what is stood on, what bodies bump into. */
  get solids() {
    return this.parts.bodies.filter((m) => m !== this.ribbon && !this.loose.has(m));
  }

  /**
   * Lay a ribbon along its line through the air (world points from the stick's tip, after the
   * prop is placed), or, without one, let it hang from the tip and lie on along the floor.
   */
  setTrail(trail: Vec3[] | null) {
    if (!this.ribbon) return;
    this.object.updateMatrixWorld(true);
    const tip = new THREE.Vector3(0, RIBBON.stick, 0).applyMatrix4(this.object.matrixWorld);
    const seg = RIBBON.length / RIBBON.segments;
    const world = trail ?? Array.from({ length: RIBBON.segments + 1 }, (_, i): Vec3 => {
      const down = Math.min(i * seg, Math.max(0, tip.y - 0.005));
      return [tip.x + (i * seg - down), tip.y - down, tip.z];
    });
    const inverse = this.object.matrixWorld.clone().invert();
    const pts = world.map((p) => new THREE.Vector3(...p).applyMatrix4(inverse));
    const pos = this.ribbon.geometry.attributes.position as THREE.BufferAttribute;
    let side = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < pts.length; i++) {
      const dir = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      // Flat side on, as a ribbon lies (keeping its last side where it goes straight up or down).
      const s = dir.clone().cross(up);
      if (s.lengthSq() > 1e-4) side = s.normalize();
      const normal = side.clone().cross(dir).normalize();
      const w = side.clone().multiplyScalar(RIBBON.width / 2);
      const h = normal.multiplyScalar(RIBBON.thickness / 2);
      [w.clone().add(h), w.clone().sub(h), w.clone().negate().sub(h), w.clone().negate().add(h)].forEach((o, k) => {
        const v = pts[i].clone().add(o);
        pos.setXYZ(i * 4 + k, v.x, v.y, v.z);
      });
    }
    pos.needsUpdate = true;
    this.ribbon.geometry.computeVertexNormals();
    this.ribbon.geometry.computeBoundingSphere();
    this.ribbon.geometry.computeBoundingBox();
  }

  apply(p: Prop) {
    this.object.position.set(...p.position);
    this.object.rotation.set(p.rotation[0] * D2R, p.rotation[1] * D2R, p.rotation[2] * D2R);
    this.object.scale.set(...p.scale);
    this.object.updateMatrixWorld(true);
  }

  /** Raise it if any part is below the floor (for props standing in the scene, not held ones). */
  liftAboveFloor() {
    this.object.updateMatrixWorld(true);
    let min = Infinity;
    const p = new THREE.Vector3();
    for (const mesh of this.solids) {
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) min = Math.min(min, p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).y);
    }
    if (min >= 0 || !Number.isFinite(min)) return;
    this.object.position.y -= min;
    this.object.updateMatrixWorld(true);
  }

  /** Current transform, as stored in the document. */
  read(): Pick<Prop, 'position' | 'rotation' | 'scale'> {
    const o = this.object;
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    const r1 = (x: number) => Math.round((x / D2R) * 10) / 10;
    return {
      position: [r3(o.position.x), r3(o.position.y), r3(o.position.z)],
      rotation: [r1(o.rotation.x), r1(o.rotation.y), r1(o.rotation.z)],
      scale: [r3(Math.max(0.02, Math.abs(o.scale.x))), r3(Math.max(0.02, Math.abs(o.scale.y))), r3(Math.max(0.02, Math.abs(o.scale.z)))],
    };
  }

  setStyle(style: Style) {
    this.style = style;
    this.refresh();
  }

  setSelected(on: boolean) {
    this.selected = on;
    this.refresh();
  }

  /** Outline it (it is linked to the pointer elsewhere). */
  setLinked(on: boolean) {
    this.parts.setLinked(on);
  }

  /** Tint it: a drag would move it. */
  setHover(on: boolean) {
    if (on === this.hovered) return;
    this.hovered = on;
    this.refresh();
  }

  setIdMode(on: boolean, firstId: number) {
    // A see-through prop draws no lines over what is behind it: hidden for the line pass.
    if ((this.parts.faded || this.parts.water) && on) {
      this.shown = this.object.visible;
      this.object.visible = false;
    } else if (!on && this.shown !== null) {
      this.object.visible = this.shown;
      this.shown = null;
    }
    return this.parts.setIdMode(on, firstId);
  }

  /** Whether it was shown before the line pass hid it (null: not hidden by it). */
  private shown: boolean | null = null;

  /** See-through while it blocks the view of the figure being edited (editor only). */
  setFade(on: boolean) {
    if (on === this.parts.faded) return;
    this.parts.faded = on;
    this.refresh();
  }

  forEachPoint(cb: (p: THREE.Vector3) => void) {
    this.parts.forEachPoint(cb);
  }

  private refresh() {
    this.parts.refresh(this.style, () => this.selected || (this.hovered ? 'hover' : false));
  }

  dispose() {
    this.parts.dispose();
    this.object.clear();
  }
}

const bounds = new Map<string, THREE.Box3>();
let boundsInk: Ink | null = null;

/** A kind's extent in its own frame (at scale 1). */
export function localBounds(kind: Prop['kind']) {
  let b = bounds.get(kind);
  if (!b) {
    const o = new PropObject(boundsInk ??= new Ink(), kind, 'bounds');
    o.apply({ id: 'bounds', name: '', kind, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    b = new THREE.Box3();
    for (const m of o.solids) b.expandByObject(m);
    o.dispose();
    bounds.set(kind, b);
  }
  return b;
}
