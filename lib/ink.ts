import * as THREE from 'three';
import { NOISE_GLSL, styleMaterial } from './shaders';
import { styleDef } from './styles';
import { flatLook, toonMaterial } from './toon';
import type { Style, Vec3 } from './types';

/**
 * Inverted-hull outline with a constant on-screen thickness (in CSS pixels). `jitter` modulates
 * the width with noise over the surface, which reads as a brush or pencil stroke. `cutout`: none
 * where the surface's texture is clearer than its cut-off (lace, a frill: what is not there has no
 * outline).
 */
function createOutlineMaterial(uniforms: Ink['uniforms'], cutout?: { map: THREE.Texture; cutoff: number }) {
  return new THREE.ShaderMaterial({
    uniforms: cutout ? { ...uniforms, map: { value: cutout.map }, cutoff: { value: cutout.cutoff } } : uniforms,
    ...(cutout ? { defines: { CUTOUT: '' } } : {}),
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      uniform float thickness;
      uniform float jitter;
      uniform vec2 resolution;
      #include <skinning_pars_vertex>
      #ifdef CUTOUT
        varying vec2 vUv;
      #endif
      ${NOISE_GLSL}
      void main() {
        #ifdef CUTOUT
          vUv = uv;
        #endif
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
      #ifdef CUTOUT
        uniform sampler2D map;
        uniform float cutoff;
        varying vec2 vUv;
      #endif
      void main() {
        #ifdef CUTOUT
          if (texture2D(map, vUv).a < cutoff) discard;
        #endif
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

/**
 * The layer outlines, rings and face lines are drawn on (the parts on the default one): passes
 * that draw the parts alone (their IDs for the inner lines, depth, normals) leave it out.
 */
export const LINES_LAYER = 1;

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

/** A part drawn in an ID material (the one it had kept, to have back: null). */
export function idMaterialOf(mesh: THREE.Mesh, id: THREE.Material | null) {
  if (id) {
    mesh.userData.drawnAs ??= mesh.material;
    mesh.material = id;
  } else if (mesh.userData.drawnAs) {
    mesh.material = mesh.userData.drawnAs as THREE.Material;
    delete mesh.userData.drawnAs;
  }
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
  /** The outline of a whole object linked to the pointer elsewhere (its row in the outline): the accent, thicker. */
  private readonly linkedUniforms = { ...this.uniforms, color: { value: new THREE.Color('#3d63ff') }, thickness: { value: 3 }, opacity: { value: 1 } };
  readonly linked = createOutlineMaterial(this.linkedUniforms);
  /** See-through, for props that block the view of the figure being edited. */
  readonly faded = new THREE.MeshBasicMaterial({ color: '#c9ccd6', transparent: true, opacity: 0.2, depthWrite: false });
  readonly ring = new THREE.MeshBasicMaterial({ color: '#8f8f8f' });
  readonly face = new THREE.MeshBasicMaterial({ color: '#4a4a4a' });
  private baseThickness = 1.6;
  private style: Style = 'line';
  private materials = new Map<string, StyleMaterials>();
  /** Outlines of their own width and colour (a VRM character's materials': outlineAs). */
  private ownOutlines = new Map<string, { material: THREE.ShaderMaterial; width: number; thickness: { value: number } }>();
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
    this.linkedUniforms.thickness.value = Math.max(2.5, this.uniforms.thickness.value + 1.5);
    for (const own of this.ownOutlines.values()) own.thickness.value = this.uniforms.thickness.value * own.width;
  }

  /**
   * An outline `width` times the style's, in its own colour (null: the style's), none where its
   * surface is cut out (`cutout`): a look's (lib/toon.ts).
   */
  outlineAs(width: number, color: THREE.Color | null, cutout?: { map: THREE.Texture; cutoff: number }): THREE.ShaderMaterial {
    if (this.ghost) return this.outline;
    const key = `${width.toFixed(3)}|${color?.getHexString() ?? ''}|${cutout ? `${cutout.map.uuid}@${cutout.cutoff}` : ''}`;
    let own = this.ownOutlines.get(key);
    if (!own) {
      const thickness = { value: this.uniforms.thickness.value * width };
      own = { material: createOutlineMaterial({ ...this.uniforms, thickness, ...(color ? { color: { value: color.clone() } } : {}) }, cutout), width, thickness };
      this.ownOutlines.set(key, own);
    }
    return own.material;
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
      case 'toon': {
        const toon = (base: string, shade: string) => toonMaterial(flatLook(base, shade), this.uniforms.lightDir);
        return {
          body: toon(body('#fdf4ef'), '#dcc0cc'),
          bodySel: toon('#dce7ff', '#a6b9e6'),
          hover: toon('#ecedf8', '#bfc3dc'),
          prop: toon('#f1f3f7', '#c6ccd9'),
          propSel: toon('#dce7ff', '#a6b9e6'),
        };
      }
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
    for (const own of this.ownOutlines.values()) own.material.dispose();
    this.ownOutlines.clear();
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
  private hulls: THREE.Mesh[] = [];
  private linked = false;
  private featuresOn = true;
  private style: Style = 'line';
  private geometries = new Set<THREE.BufferGeometry>();
  private skeletons: THREE.Skeleton[] = [];

  /** A colour mixed into the body (to tell figures apart). */
  tint: string | null = null;
  /** Drawn see-through, without lines (it stands between the camera and what is edited). */
  faded = false;

  /** `bare`: its parts only, without outlines or lines (one only worked out with, never drawn). */
  constructor(private ink: Ink, private kind: 'figure' | 'prop', private bare = false) {}

  /**
   * A part, its outline and lines: skinned (moving with several joints, bound by bindSkins) when its
   * geometry has skin weights.
   */
  add(parent: THREE.Object3D, geo: THREE.BufferGeometry, tag: Record<string, unknown>, pos?: Vec3, rings: THREE.BufferGeometry[] = []) {
    const made = (g: THREE.BufferGeometry, m: THREE.Material) => (g.attributes.skinIndex ? new THREE.SkinnedMesh(g, m) : new THREE.Mesh(g, m));
    const mesh = made(geo, this.ink.materialsFor('line').body);
    Object.assign(mesh.userData, tag);
    if (pos) mesh.position.set(...pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.geometries.add(geo);
    if (this.bare) {
      for (const r of rings) r.dispose();
      parent.add(mesh);
      this.bodies.push(mesh);
      return mesh;
    }
    const hull = made(geo, this.ink.outline);
    hull.raycast = () => {};
    hull.layers.set(LINES_LAYER);
    mesh.add(hull);
    this.decorations.push(hull);
    this.hulls.push(hull);
    for (const r of rings) {
      const m = made(r, this.ink.ring);
      m.raycast = () => {};
      m.layers.set(LINES_LAYER);
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
    if (this.bare) {
      for (const g of geos) g.dispose();
      return;
    }
    for (const g of geos) {
      const line = new THREE.Mesh(g, this.ink.face);
      line.raycast = () => {};
      line.layers.set(LINES_LAYER);
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
  /**
   * Its parts in flat ID colours for the inner-line pass (on), or back as they were (off): only
   * their materials swapped (its lines, on their own layer, are left out by the pass). Returns the
   * next free id.
   */
  setIdMode(on: boolean, firstId: number) {
    this.bodies.forEach((mesh, i) => idMaterialOf(mesh, on ? this.ink.idMaterial(firstId + i) : null));
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
    this.applyLinked();
  }

  /** Outline the whole object in the accent (it is linked to the pointer elsewhere), whatever the style. */
  setLinked(on: boolean) {
    if (on === this.linked) return;
    this.linked = on;
    this.applyLinked();
  }

  private applyLinked() {
    const outline = !!styleDef(this.style).outline;
    for (const h of this.hulls) {
      h.material = this.linked ? this.ink.linked : this.ink.outline;
      if (!this.faded) h.visible = this.linked || outline;
    }
  }

  /**
   * The lowest point of what is drawn (world height), exactly, at a fraction of going through every
   * point: the parts whose bounding spheres reach lowest are looked at first, and a part that cannot
   * reach below the lowest point found so far is skipped (standing, only the feet are looked at).
   */
  lowest(): number {
    const centre = new THREE.Vector3();
    const moved = new THREE.Matrix4();
    const parts: { mesh: THREE.Mesh; low: number }[] = [];
    for (const mesh of this.bodies) {
      if (!mesh.visible) continue;
      const g = mesh.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const s = g.boundingSphere!;
      const skinned = mesh as THREE.SkinnedMesh;
      if (!skinned.isSkinnedMesh) {
        centre.copy(s.center).applyMatrix4(mesh.matrixWorld);
        parts.push({ mesh, low: centre.y - s.radius * mesh.matrixWorld.getMaxScaleOnAxis() });
        continue;
      }
      // (A skinned part: each vertex a weighting of where its bones take it, so no lower than the
      // lowest of its sphere at rest as each of its bones takes it.)
      let low = Infinity;
      skinned.skeleton.bones.forEach((b, i) => {
        moved.multiplyMatrices(b.matrixWorld, skinned.skeleton.boneInverses[i]).multiply(skinned.bindMatrix);
        centre.copy(s.center).applyMatrix4(moved);
        low = Math.min(low, centre.y - s.radius * moved.getMaxScaleOnAxis());
      });
      parts.push({ mesh, low });
    }
    parts.sort((a, b) => a.low - b.low);
    let min = Infinity;
    for (const { mesh, low } of parts) {
      if (low >= min) break;
      // (Only the height: the matrix's second row. A skinned part as posed.)
      const e = mesh.matrixWorld.elements;
      const pos = mesh.geometry.attributes.position;
      const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh;
      for (let i = 0; i < pos.count; i++) {
        const v = skinned ? mesh.getVertexPosition(i, centre) : centre.fromBufferAttribute(pos, i);
        const y = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13];
        if (y < min) min = y;
      }
    }
    return min;
  }

  /** Bind the skinned parts (their joints at rest now, their world matrices up to date) to a skeleton. */
  bindSkins(skeleton: THREE.Skeleton) {
    this.skeletons.push(skeleton);
    for (const m of [...this.bodies, ...this.decorations]) {
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) (m as THREE.SkinnedMesh).bind(skeleton, m.matrixWorld);
    }
  }

  forEachPoint(cb: (p: THREE.Vector3) => void) {
    const p = new THREE.Vector3();
    for (const mesh of this.bodies) {
      if (!mesh.visible) continue;
      const pos = mesh.geometry.attributes.position;
      // (A skinned part as posed.)
      const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh;
      for (let i = 0; i < pos.count; i++) cb((skinned ? mesh.getVertexPosition(i, p) : p.fromBufferAttribute(pos, i)).applyMatrix4(mesh.matrixWorld));
    }
  }

  dispose() {
    for (const s of this.skeletons) s.dispose();
    this.skeletons.length = 0;
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
  // (Vertices that share a position, to 0.01 mm: by a number made of their coordinates, within ±1 m.)
  const key = (i: number) => {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => Math.round(v * 1e5) + 100000);
    return x >= 0 && x < 200000 && y >= 0 && y < 200000 && z >= 0 && z < 200000 ? (x * 200000 + y) * 200000 + z : `${x},${y},${z}`;
  };
  const groups = new Map<number | string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    let x = 0, y = 0, z = 0;
    for (const i of g) {
      x += nrm.getX(i);
      y += nrm.getY(i);
      z += nrm.getZ(i);
    }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of g) nrm.setXYZ(i, x / l, y / l, z / l);
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
export function limb(len: number, r1: number, r2: number, bulge = 0, bulgeAt = 0.35, segments = 24, shaft = 18, cap = 8) {
  const radius = (t: number) => {
    const s = t < bulgeAt ? (t / bulgeAt) * 0.5 : 0.5 + ((t - bulgeAt) / (1 - bulgeAt)) * 0.5;
    return r1 + (r2 - r1) * t + bulge * Math.sin(Math.PI * s);
  };
  const pts: THREE.Vector2[] = [];
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
