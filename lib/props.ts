import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Ink, InkedParts } from './ink';
import type { Prop, PropKind, Style, Vec3 } from './types';

const D2R = Math.PI / 180;

export const PROP_LABELS: Record<PropKind, string> = {
  box: 'Box', sphere: 'Ball', cylinder: 'Cylinder', chair: 'Chair', stool: 'Stool', step: 'Step', wall: 'Wall',
};

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

  constructor(ink: Ink, readonly kind: PropKind, readonly id: string) {
    this.parts = new InkedParts(ink, 'prop');
    for (const [geo, pos] of pieces(kind)) this.parts.add(this.object, geo, { prop: id }, pos);
    this.object.rotation.order = 'XYZ';
    this.refresh();
  }

  apply(p: Prop) {
    this.object.position.set(...p.position);
    this.object.rotation.set(p.rotation[0] * D2R, p.rotation[1] * D2R, p.rotation[2] * D2R);
    this.object.scale.set(...p.scale);
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

  setIdMode(on: boolean, firstId: number) {
    return this.parts.setIdMode(on, firstId, this.style, () => this.selected);
  }

  forEachPoint(cb: (p: THREE.Vector3) => void) {
    this.parts.forEachPoint(cb);
  }

  private refresh() {
    this.parts.refresh(this.style, () => this.selected);
  }

  dispose() {
    this.parts.dispose();
    this.object.clear();
  }
}
