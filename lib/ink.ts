import * as THREE from 'three';
import { NOISE_GLSL, styleMaterial } from './shaders';
import { styleDef } from './styles';
import type { Style, Vec3 } from './types';

/**
 * Inverted-hull outline with a constant on-screen thickness (in CSS pixels). `jitter` modulates
 * the width with noise over the surface, which reads as a brush or pencil stroke.
 */
function createOutlineMaterial(uniforms: Ink['uniforms']) {
  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      uniform float thickness;
      uniform float jitter;
      uniform vec2 resolution;
      #include <skinning_pars_vertex>
      ${NOISE_GLSL}
      void main() {
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        vec3 n = normalize(normalMatrix * objectNormal);
        vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy * resolution;
        float len = length(dir);
        if (len > 1e-6) dir /= len;
        float w = thickness;
        if (jitter > 0.0) w *= max(0.15, 1.0 + jitter * (noise3(position * 32.0) * 2.0 - 1.0) * 1.2);
        clip.xy += dir * w * 2.0 / resolution * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float opacity;
      void main() {
        gl_FragColor = vec4(color, opacity);
        #include <colorspace_fragment>
      }`,
  });
}

/** Translucent single-colour look for onion-skin ghosts. */
export interface Ghost {
  color: string;
  opacity: number;
}

/** Encode a part id as a colour with 16 levels per channel (robust to 8-bit precision). */
export function encodeId(id: number) {
  const n = id + 1;
  return new THREE.Vector3((n % 16) / 15, (Math.floor(n / 16) % 16) / 15, (Math.floor(n / 256) % 16) / 15);
}

const ID_VERT = /* glsl */ `
  #include <skinning_pars_vertex>
  void main() {
    #include <skinbase_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }`;
const ID_FRAG = 'uniform vec3 id; void main() { gl_FragColor = vec4(id, 1.0); }';

interface StyleMaterials {
  body: THREE.Material;
  bodySel: THREE.Material;
  /** Under the pointer: what a drag would move (lighter than the selection). */
  hover: THREE.Material;
  prop: THREE.Material;
  propSel: THREE.Material;
}

/** Shared materials and uniforms for one rendering context (the editor or the exporter). */
export class Ink {
  readonly uniforms = {
    thickness: { value: 1.6 },
    jitter: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
    color: { value: new THREE.Color('#0b0b0b') },
    opacity: { value: 1 },
    /** World-space direction towards the key light (painterly shaders). */
    lightDir: { value: new THREE.Vector3(0.5, 0.7, 0.5).normalize() },
  };
  readonly outline = createOutlineMaterial(this.uniforms);
  /** See-through, for props that block the view of the figure being edited. */
  readonly faded = new THREE.MeshBasicMaterial({ color: '#c9ccd6', transparent: true, opacity: 0.2, depthWrite: false });
  readonly ring = new THREE.MeshBasicMaterial({ color: '#8f8f8f' });
  readonly face = new THREE.MeshBasicMaterial({ color: '#4a4a4a' });
  private baseThickness = 1.6;
  private style: Style = 'line';
  private materials = new Map<string, StyleMaterials>();
  private idMats = new Map<number, THREE.ShaderMaterial>();

  constructor(readonly ghost: Ghost | null = null) {
    if (ghost) {
      this.outline.transparent = true;
      this.outline.depthWrite = false;
      this.uniforms.opacity.value = Math.min(1, ghost.opacity * 2);
    }
  }

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

  /** Outline width in pixels, before the style's own scale. */
  setThickness(px: number) {
    this.baseThickness = px;
    this.applyThickness();
  }

  setLightDirection(dir: THREE.Vector3) {
    this.uniforms.lightDir.value.copy(dir).normalize();
  }

  /** Outline colour, brush jitter and ring colour for a style. */
  setStyle(style: Style) {
    this.style = style;
    const def = styleDef(style);
    if (this.ghost) {
      this.uniforms.color.value.set(this.ghost.color);
      this.uniforms.jitter.value = 0;
      this.applyThickness();
      return;
    }
    if (def.outline) {
      this.uniforms.color.value.set(def.outline.color);
      this.uniforms.jitter.value = def.outline.jitter;
    }
    if (def.rings) this.ring.color.set(def.rings);
    if (def.face) this.face.color.set(def.face);
    this.applyThickness();
  }

  private applyThickness() {
    const o = styleDef(this.style).outline;
    this.uniforms.thickness.value = this.baseThickness * (this.ghost ? 0.8 : o ? o.scale : 0);
  }

  /** Surface materials for a style, created on first use. */
  materialsFor(style: Style, tint?: string): StyleMaterials {
    const key = tint ? `${style}|${tint}` : style;
    let m = this.materials.get(key);
    if (!m) {
      m = this.createMaterials(style, tint);
      this.materials.set(key, m);
    }
    return m;
  }

  /** Materials for a style; `tint` mixes a figure's colour into its body (selection looks the same). */
  private createMaterials(style: Style, tint?: string): StyleMaterials {
    const body = (c: string) => (tint ? `#${new THREE.Color(c).lerp(new THREE.Color(tint), style === 'silhouette' ? 0.6 : 0.42).getHexString()}` : c);
    if (this.ghost) {
      const m = new THREE.MeshBasicMaterial({ color: this.ghost.color, transparent: true, opacity: this.ghost.opacity, depthWrite: false });
      return { body: m, bodySel: m, hover: m, prop: m, propSel: m };
    }
    const basic = (color: string) => new THREE.MeshBasicMaterial({ color });
    const lambert = (color: string) => new THREE.MeshLambertMaterial({ color });
    const shader = (s: 'ink' | 'sketch' | 'anime', base: string, shade: string) => styleMaterial(s, this.uniforms, base, shade);
    switch (style) {
      case 'shaded':
        return { body: lambert(body('#f2f0ec')), bodySel: lambert('#a8c6ff'), hover: lambert('#d3e1fb'), prop: lambert('#d9d6cf'), propSel: lambert('#a8c6ff') };
      case 'sketch':
        return {
          body: shader('sketch', body('#fbfaf6'), '#33312e'),
          bodySel: shader('sketch', '#e3ebff', '#33312e'),
          hover: shader('sketch', '#eff2fb', '#33312e'),
          prop: shader('sketch', '#f3f1eb', '#33312e'),
          propSel: shader('sketch', '#e3ebff', '#33312e'),
        };
      case 'ink':
        return {
          body: shader('ink', body('#f1ebdd'), '#1d1b18'),
          bodySel: shader('ink', '#dde4f2', '#1d1b18'),
          hover: shader('ink', '#e8e8e8', '#1d1b18'),
          prop: shader('ink', '#e8e1d0', '#1d1b18'),
          propSel: shader('ink', '#dde4f2', '#1d1b18'),
        };
      case 'anime':
        return {
          body: shader('anime', body('#fcf2ec'), '#d7bccb'),
          bodySel: shader('anime', '#dce7ff', '#a6b9e6'),
          hover: shader('anime', '#ecedf8', '#bfc3dc'),
          prop: shader('anime', '#eef1f6', '#c2c9d8'),
          propSel: shader('anime', '#dce7ff', '#a6b9e6'),
        };
      case 'minimal':
        return { body: basic(body('#ffffff')), bodySel: basic('#e2e9ff'), hover: basic('#f0f4ff'), prop: basic('#f7f6f2'), propSel: basic('#e2e9ff') };
      case 'silhouette':
        // Same colour as the outline, so part boundaries disappear.
        return { body: basic(body('#111111')), bodySel: basic('#3366ff'), hover: basic('#2b3550'), prop: basic('#b4b4bb'), propSel: basic('#3366ff') };
      default:
        return { body: basic(body('#ffffff')), bodySel: basic('#d5e5ff'), hover: basic('#ebf2ff'), prop: basic('#fbfbfb'), propSel: basic('#d5e5ff') };
    }
  }

  dispose() {
    for (const m of this.materials.values()) for (const mat of Object.values(m)) mat.dispose();
    this.materials.clear();
    this.faded.dispose();
    for (const m of this.idMats.values()) m.dispose();
    this.idMats.clear();
    this.outline.dispose();
    this.ring.dispose();
    this.face.dispose();
  }
}

/** How a part is drawn: selected, under the pointer, or plain. */
export type Highlight = boolean | 'hover';

/** Something drawn in the ink styles: solid parts with outline hulls and contour rings. */
export class InkedParts {
  readonly bodies: THREE.Mesh[] = [];
  private decorations: THREE.Mesh[] = [];
  /** Contour rings (a subset of decorations); hidden in styles without rings. */
  private rings: THREE.Mesh[] = [];
  /** Optional face details: nose and ear parts, and eye / brow / mouth lines. */
  private features = new Set<THREE.Mesh>();
  private faceLines: THREE.Mesh[] = [];
  /** Shown instead of the features when they are off (e.g. the plain construction head). */
  private plain = new Set<THREE.Mesh>();
  private featuresOn = true;
  private style: Style = 'line';
  private geometries = new Set<THREE.BufferGeometry>();

  /** A colour mixed into the body (to tell figures apart). */
  tint: string | null = null;
  /** Drawn see-through, without lines (it stands between the camera and what is edited). */
  faded = false;

  constructor(private ink: Ink, private kind: 'figure' | 'prop') {}

  add(parent: THREE.Object3D, geo: THREE.BufferGeometry, tag: Record<string, unknown>, pos?: Vec3, rings: THREE.BufferGeometry[] = []) {
    const mesh = new THREE.Mesh(geo, this.ink.materialsFor('line').body);
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

  /** Mark a part as an optional face detail (see setFeatures). */
  markFeature(mesh: THREE.Mesh) {
    this.features.add(mesh);
    mesh.visible = this.featuresOn;
  }

  /** Mark a part as the plain stand-in shown while face features are off. */
  markPlain(mesh: THREE.Mesh) {
    this.plain.add(mesh);
    mesh.visible = !this.featuresOn;
  }

  /** Thin lines drawn on a part's surface (eyes, brows, mouth), in the style's face colour. */
  addFaceLines(mesh: THREE.Mesh, geos: THREE.BufferGeometry[]) {
    for (const g of geos) {
      const line = new THREE.Mesh(g, this.ink.face);
      line.raycast = () => {};
      mesh.add(line);
      this.decorations.push(line);
      this.faceLines.push(line);
      this.geometries.add(g);
    }
  }

  setFeatures(on: boolean) {
    this.featuresOn = on;
    for (const m of this.features) m.visible = on;
    for (const m of this.plain) m.visible = !on;
    const face = styleDef(this.style).face !== null;
    for (const l of this.faceLines) l.visible = on && face;
  }

  /** Swap to flat per-part colours for the ID pass; returns the next free id. */
  setIdMode(on: boolean, firstId: number, style: Style, isSelected: (m: THREE.Mesh) => Highlight) {
    if (on) {
      for (const d of this.decorations) d.visible = false;
      this.bodies.forEach((mesh, i) => { mesh.material = this.ink.idMaterial(firstId + i); });
    } else {
      this.refresh(style, isSelected);
    }
    return firstId + this.bodies.length;
  }

  refresh(style: Style, isSelected: (m: THREE.Mesh) => Highlight) {
    const m = this.ink.materialsFor(style, this.tint ?? undefined);
    const prop = this.kind === 'prop';
    for (const mesh of this.bodies) {
      const state = isSelected(mesh);
      mesh.material = this.faded ? this.ink.faded : state === 'hover' ? m.hover : prop ? (state ? m.propSel : m.prop) : state ? m.bodySel : m.body;
    }
    const def = styleDef(style);
    this.style = style;
    for (const d of this.decorations) d.visible = !this.faded;
    if (this.faded) return;
    for (const r of this.rings) r.visible = def.rings !== null;
    if (!def.outline) for (const d of this.decorations) if (!this.rings.includes(d)) d.visible = false;
    this.setFeatures(this.featuresOn);
  }

  forEachPoint(cb: (p: THREE.Vector3) => void) {
    const p = new THREE.Vector3();
    for (const mesh of this.bodies) {
      if (!mesh.visible) continue;
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

/**
 * Push the surface outwards in a smooth ellipsoidal patch (muscles, glutes) instead of adding a
 * separate part, so the form reads in shading and silhouette without extra outlines.
 * `radius` is the patch size per axis; `amount` the peak displacement along the normal.
 */
export function bulge(geo: THREE.BufferGeometry, center: Vec3, radius: Vec3, amount: number) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dx = (v.x - center[0]) / radius[0];
    const dy = (v.y - center[1]) / radius[1];
    const dz = (v.z - center[2]) / radius[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= 1) continue;
    const w = (1 - d2) * (1 - d2);
    n.fromBufferAttribute(nrm, i);
    v.addScaledVector(n, amount * w);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  return geo;
}

/**
 * Recompute normals and average them across seam vertices that share a position (lathe seams),
 * which keeps the outline hull from cracking open along the seam.
 */
export function smoothNormals(geo: THREE.BufferGeometry) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  }
  const sum = new THREE.Vector3();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    sum.set(0, 0, 0);
    for (const i of g) sum.add(new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)));
    sum.normalize();
    for (const i of g) nrm.setXYZ(i, sum.x, sum.y, sum.z);
  }
  nrm.needsUpdate = true;
  return geo;
}

/** An open curve drawn as a thin contour line (e.g. the lower edge of the pectorals). */
export function contour(points: THREE.Vector3[], radius = 0.0022) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false), points.length * 4, radius, 5, false);
}

export function ellipsoid(rx: number, ry: number, rz: number, w = 36, h = 24) {
  return new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
}

/** Egg-like body segment centred on the origin; taper > 0 widens the top, < 0 the bottom. */
export function egg(rx: number, ry: number, rz: number, taper: number, n = 32, segments = 40) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const phi = Math.PI * (1 - i / n);
    pts.push(new THREE.Vector2(rx * Math.sin(phi) * (1 + taper * Math.cos(phi)), ry * Math.cos(phi)));
  }
  return new THREE.LatheGeometry(pts, segments).scale(1, 1, rz / rx);
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
