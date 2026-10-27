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

type Piece = [THREE.BufferGeometry, Vec3];

/** A gymnastics ribbon: the stick (its tip this far along it), the ribbon's length and its cross-section, in segments. */
export const RIBBON = { stick: 0.6, length: 4, width: 0.05, thickness: 0.004, segments: 20 };

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
    case 'chair': {
      const legs: Piece[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => [cylinder(0.02, 0.44, 0.006), [x * 0.19, 0.22, z * 0.19]]);
      return [
        [box(0.46, 0.05, 0.46), [0, 0.465, 0]],
        [box(0.46, 0.42, 0.04), [0, 0.72, -0.21]],
        ...legs,
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

  constructor(ink: Ink, readonly kind: PropKind, readonly id: string) {
    this.parts = new InkedParts(ink, 'prop');
    for (const [geo, pos] of pieces(kind)) this.parts.add(this.object, geo, { prop: id }, pos);
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
    return this.parts.bodies.filter((m) => m !== this.ribbon);
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

  /** Tint it: a drag would move it. */
  setHover(on: boolean) {
    if (on === this.hovered) return;
    this.hovered = on;
    this.refresh();
  }

  setIdMode(on: boolean, firstId: number) {
    // A see-through prop draws no lines over what is behind it: hidden for the line pass.
    if (this.parts.faded && on) {
      this.shown = this.object.visible;
      this.object.visible = false;
    } else if (!on && this.shown !== null) {
      this.object.visible = this.shown;
      this.shown = null;
    }
    return this.parts.setIdMode(on, firstId, this.style, () => this.selected);
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
