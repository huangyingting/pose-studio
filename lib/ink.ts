import * as THREE from 'three';
import type { Style, Vec3 } from './types';

/** Inverted-hull outline with a constant on-screen thickness (in CSS pixels). */
function createOutlineMaterial(uniforms: Ink['uniforms']) {
  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      uniform float thickness;
      uniform vec2 resolution;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy * resolution;
        float len = length(dir);
        if (len > 1e-6) dir /= len;
        clip.xy += dir * thickness * 2.0 / resolution * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      void main() { gl_FragColor = vec4(color, 1.0); }`,
  });
}

/** Encode a part id as a colour with 16 levels per channel (robust to 8-bit precision). */
export function encodeId(id: number) {
  const n = id + 1;
  return new THREE.Vector3((n % 16) / 15, (Math.floor(n / 16) % 16) / 15, (Math.floor(n / 256) % 16) / 15);
}

const ID_VERT = 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const ID_FRAG = 'uniform vec3 id; void main() { gl_FragColor = vec4(id, 1.0); }';

/** Shared materials and uniforms for one rendering context (the editor or the exporter). */
export class Ink {
  readonly uniforms = {
    thickness: { value: 1.6 },
    resolution: { value: new THREE.Vector2(1, 1) },
    color: { value: new THREE.Color('#1c1c1c') },
  };
  readonly outline = createOutlineMaterial(this.uniforms);
  readonly ring = new THREE.MeshBasicMaterial({ color: '#8f8f8f' });
  readonly body = {
    line: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    lineSel: new THREE.MeshBasicMaterial({ color: '#d5e5ff' }),
    shaded: new THREE.MeshLambertMaterial({ color: '#f2f0ec' }),
    shadedSel: new THREE.MeshLambertMaterial({ color: '#a8c6ff' }),
    lineProp: new THREE.MeshBasicMaterial({ color: '#fbfbfb' }),
    shadedProp: new THREE.MeshLambertMaterial({ color: '#d9d6cf' }),
    // The ink shaders skip the sRGB output conversion, so '#1c1c1c' ink shows as ~#030303.
    // Match it so part boundaries disappear inside a silhouette.
    silhouette: new THREE.MeshBasicMaterial({ color: '#030303' }),
    silhouetteSel: new THREE.MeshBasicMaterial({ color: '#4f6bed' }),
    silhouetteProp: new THREE.MeshBasicMaterial({ color: '#b4b4bb' }),
  };
  private idMats = new Map<number, THREE.ShaderMaterial>();

  idMaterial(id: number) {
    let m = this.idMats.get(id);
    if (!m) {
      m = new THREE.ShaderMaterial({ uniforms: { id: { value: encodeId(id) } }, vertexShader: ID_VERT, fragmentShader: ID_FRAG });
      this.idMats.set(id, m);
    }
    return m;
  }

  setResolution(w: number, h: number) {
    this.uniforms.resolution.value.set(w, h);
  }

  setThickness(px: number) {
    this.uniforms.thickness.value = px;
  }
}

/** Something drawn in the line-art style: solid parts with outline hulls and contour rings. */
export class InkedParts {
  readonly bodies: THREE.Mesh[] = [];
  private decorations: THREE.Mesh[] = [];
  /** Contour rings (a subset of decorations); hidden in the silhouette style. */
  private rings: THREE.Mesh[] = [];
  private geometries = new Set<THREE.BufferGeometry>();

  constructor(private ink: Ink, private kind: 'figure' | 'prop') {}

  add(parent: THREE.Object3D, geo: THREE.BufferGeometry, tag: Record<string, unknown>, pos?: Vec3, rings: THREE.BufferGeometry[] = []) {
    const mesh = new THREE.Mesh(geo, this.ink.body.line);
    Object.assign(mesh.userData, tag);
    if (pos) mesh.position.set(...pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const hull = new THREE.Mesh(geo, this.ink.outline);
    hull.raycast = () => {};
    mesh.add(hull);
    this.decorations.push(hull);
    this.geometries.add(geo);
    for (const r of rings) {
      const m = new THREE.Mesh(r, this.ink.ring);
      m.raycast = () => {};
      mesh.add(m);
      this.decorations.push(m);
      this.rings.push(m);
      this.geometries.add(r);
    }
    parent.add(mesh);
    this.bodies.push(mesh);
    return mesh;
  }

  /** Swap to flat per-part colours for the ID pass; returns the next free id. */
  setIdMode(on: boolean, firstId: number, style: Style, isSelected: (m: THREE.Mesh) => boolean) {
    if (on) {
      for (const d of this.decorations) d.visible = false;
      this.bodies.forEach((mesh, i) => { mesh.material = this.ink.idMaterial(firstId + i); });
    } else {
      for (const d of this.decorations) d.visible = true;
      this.refresh(style, isSelected);
    }
    return firstId + this.bodies.length;
  }

  refresh(style: Style, isSelected: (m: THREE.Mesh) => boolean) {
    const b = this.ink.body;
    const prop = this.kind === 'prop';
    for (const mesh of this.bodies) {
      const sel = isSelected(mesh);
      if (style === 'line') mesh.material = sel ? b.lineSel : prop ? b.lineProp : b.line;
      else if (style === 'shaded') mesh.material = sel ? b.shadedSel : prop ? b.shadedProp : b.shaded;
      else mesh.material = sel ? b.silhouetteSel : prop ? b.silhouetteProp : b.silhouette;
    }
    for (const r of this.rings) r.visible = style !== 'silhouette';
  }

  forEachPoint(cb: (p: THREE.Vector3) => void) {
    const p = new THREE.Vector3();
    for (const mesh of this.bodies) {
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) cb(p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    this.geometries.clear();
    this.bodies.length = 0;
    this.decorations.length = 0;
  }
}

/* Geometry helpers shared by the mannequin and props. */

export function ellipsoid(rx: number, ry: number, rz: number, w = 36, h = 24) {
  return new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
}

/** Egg-like body segment centred on the origin; taper > 0 widens the top, < 0 the bottom. */
export function egg(rx: number, ry: number, rz: number, taper: number) {
  const pts: THREE.Vector2[] = [];
  const n = 32;
  for (let i = 0; i <= n; i++) {
    const phi = Math.PI * (1 - i / n);
    pts.push(new THREE.Vector2(rx * Math.sin(phi) * (1 + taper * Math.cos(phi)), ry * Math.cos(phi)));
  }
  return new THREE.LatheGeometry(pts, 40).scale(1, 1, rz / rx);
}

/** Tapered capsule hanging from y=0 down to y=-len, with an optional muscle bulge. */
export function limb(len: number, r1: number, r2: number, bulge = 0, bulgeAt = 0.35, segments = 32) {
  const radius = (t: number) => {
    const s = t < bulgeAt ? (t / bulgeAt) * 0.5 : 0.5 + ((t - bulgeAt) / (1 - bulgeAt)) * 0.5;
    return r1 + (r2 - r1) * t + bulge * Math.sin(Math.PI * s);
  };
  const pts: THREE.Vector2[] = [];
  const cap = 8;
  const shaft = 18;
  for (let i = 0; i <= cap; i++) {
    const a = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r2 * Math.cos(a), -len + r2 * Math.sin(a)));
  }
  for (let i = 1; i < shaft; i++) {
    const t = 1 - i / shaft;
    pts.push(new THREE.Vector2(radius(t), -len * t));
  }
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r1 * Math.cos(a), r1 * Math.sin(a)));
  }
  const geometry = new THREE.LatheGeometry(pts, segments);
  /** Cross-contour ring at fraction t (0 = top, 1 = bottom) of the limb. */
  const ring = (t: number) => tube(circlePoints(radius(t), -len * t));
  return { geometry, ring };
}

function circlePoints(r: number, y: number, n = 48) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a));
  });
}

export function tube(points: THREE.Vector3[], radius = 0.0022) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), points.length * 2, radius, 5, true);
}

/** Vertical centre line (front + back) around an ellipsoid or egg. */
export function meridian(ry: number, rz: number, taper = 0, n = 64) {
  return tube(Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return new THREE.Vector3(0, ry * Math.cos(a), rz * Math.sin(a) * (1 + taper * Math.cos(a)));
  }));
}

/** Horizontal line around an ellipsoid (or egg) at height y. */
export function latitude(rx: number, ry: number, rz: number, y: number, taper = 0, n = 64) {
  const s = Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)) * (1 + taper * (y / ry));
  return tube(Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return new THREE.Vector3(rx * s * Math.cos(a), y, rz * s * Math.sin(a));
  }));
}
