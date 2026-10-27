import * as THREE from 'three';
import { frameTimes } from './animation';
import { sceneAt } from './evaluate';
import { wrapDeg } from './joints';
import { DEFAULT_LIGHT, LightRig } from './lighting';
import { LineArtPass } from './lineart';
import { SceneView } from './sceneview';
import { styleDef } from './styles';
import { placeCamera, type CameraView } from './shot';
import { STYLES, type Scene, type Style, type View } from './types';

const D2R = Math.PI / 180;

/** Unit vector from the subject towards the camera for a given view. */
export function viewDirection(view: Pick<View, 'yaw' | 'pitch'>) {
  const yaw = view.yaw * D2R;
  const pitch = THREE.MathUtils.clamp(view.pitch, -89, 89) * D2R;
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

export function viewFromCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3): View {
  const d = camera.position.clone().sub(target).normalize();
  const r = (a: number) => Math.round(a * 10) / 10;
  return { yaw: r(Math.atan2(d.x, d.z) / D2R), pitch: r(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / D2R), fov: r(camera.fov) };
}

type PointSource = { forEachPoint(cb: (p: THREE.Vector3) => void): void };

/**
 * Place a perspective camera so everything in `source` fits the frame from the given view.
 * `minDistance` lets several cells share one camera distance (same scale everywhere).
 * Returns the point the camera looks at and the distance used.
 */
export function fitCamera(camera: THREE.PerspectiveCamera, source: PointSource, view: View, margin = 0.08, minDistance = 0) {
  camera.fov = view.fov;
  const dir = viewDirection(view);
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right);

  const pts: number[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  source.forEachPoint((p) => {
    const x = p.dot(right), y = p.dot(up), z = p.dot(dir);
    pts.push(x, y, z);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  });
  if (!pts.length) {
    minX = minY = minZ = -1;
    maxX = maxY = maxZ = 1;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const tanV = Math.tan((camera.fov * D2R) / 2) * (1 - margin);
  const tanH = tanV * camera.aspect;
  let dist = 0.5;
  for (let i = 0; i < pts.length; i += 3) {
    dist = Math.max(dist, pts[i + 2] + Math.max(Math.abs(pts[i] - cx) / tanH, Math.abs(pts[i + 1] - cy) / tanV));
  }
  // Measured from the subject's centre, so cells with different depths still match in scale.
  const midZ = (minZ + maxZ) / 2;
  dist = Math.max(dist, midZ + minDistance);

  const center = right.multiplyScalar(cx).add(up.multiplyScalar(cy));
  const target = center.clone().addScaledVector(dir, midZ);
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(0.01, (dist - maxZ) * 0.5);
  camera.far = dist - minZ + 10;
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return Object.assign(target, { distance: dist - midZ });
}

export interface ExportOptions {
  /**
   * All poses, the current pose, the current pose from several angles, or (animations) a
   * sheet of frames or a video.
   */
  /** all: every scene; poses: the pose library (built-in and saved). */
  scope: 'all' | 'poses' | 'current' | 'turnaround' | 'frames' | 'video' | 'pack';
  /** The styled picture, or a depth / normal pass (for AI image and video tools). */
  pass: Pass;
  /** Keyframe packs: add a clay-shaded clip of each shot. */
  greybox: boolean;
  /** Number of angles in a turnaround (every 360/n degrees). */
  angles: 4 | 8;
  /** Number of frames in a frame sheet. */
  frames: number;
  /** Video frame size and how many times to play the animation. */
  videoSize: VideoSize;
  videoLoops: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
  /** Outline width in pixels at the exported size. */
  lineWidth: number;
  format: 'jpeg' | 'png';
  style: Style;
  /** PNG only. */
  transparent: boolean;
  labels: boolean;
  /** Draw every cell at the same scale instead of filling each cell. */
  sameScale: boolean;
  /** Fraction of the cell left empty around the subject. */
  margin: number;
}

/** Matches the layout of the original Pose.jpg: 4 × 5 cells of 600 × 640. */
export type VideoSize = '720p' | '1080p' | 'square' | 'vertical';

export const VIDEO_SIZES: Record<VideoSize, { label: string; width: number; height: number }> = {
  '720p': { label: '1280 × 720 (16:9)', width: 1280, height: 720 },
  '1080p': { label: '1920 × 1080 (16:9)', width: 1920, height: 1080 },
  square: { label: '1080 × 1080 (1:1)', width: 1080, height: 1080 },
  vertical: { label: '1080 × 1920 (9:16)', width: 1080, height: 1920 },
};

export const DEFAULT_EXPORT: ExportOptions = {
  scope: 'current', pass: 'beauty', greybox: true, angles: 4, frames: 8, videoSize: '720p', videoLoops: 1, columns: 4, cellWidth: 600, cellHeight: 640, lineWidth: 2.2, format: 'jpeg', style: 'line',
  transparent: false, labels: false, sameScale: false, margin: 0.07,
};

/** Validate export options from storage (older versions or hand-edited values). */
export function parseExportOptions(raw: unknown): ExportOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_EXPORT;
  const int = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    scope: ['all', 'poses', 'turnaround', 'frames', 'video', 'pack'].includes(o.scope as string) ? (o.scope as ExportOptions['scope']) : 'current',
    pass: o.pass === 'depth' || o.pass === 'normal' ? o.pass : 'beauty',
    greybox: o.greybox !== false,
    angles: o.angles === 8 ? 8 : 4,
    frames: int(o.frames, d.frames, 2, 48),
    videoSize: typeof o.videoSize === 'string' && o.videoSize in VIDEO_SIZES ? (o.videoSize as VideoSize) : d.videoSize,
    videoLoops: int(o.videoLoops, d.videoLoops, 1, 5),
    columns: int(o.columns, d.columns, 1, 12),
    cellWidth: int(o.cellWidth, d.cellWidth, 100, 4000),
    cellHeight: int(o.cellHeight, d.cellHeight, 100, 4000),
    lineWidth: num(o.lineWidth, d.lineWidth, 0.5, 8),
    format: o.format === 'png' ? 'png' : 'jpeg',
    style: STYLES.includes(o.style as Style) ? (o.style as Style) : d.style,
    transparent: o.transparent === true,
    labels: o.labels === true,
    sameScale: o.sameScale === true,
    margin: num(o.margin, d.margin, 0, 0.4),
  };
}

const TURNAROUND_NAMES: Record<4 | 8, string[]> = {
  4: ['Front', 'Left side', 'Back', 'Right side'],
  8: ['Front', 'Front-left ¾', 'Left side', 'Back-left ¾', 'Back', 'Back-right ¾', 'Right side', 'Front-right ¾'],
};

export interface Cell {
  scene: Scene;
  caption: string;
}

/**
 * The cells of an export sheet. A turnaround shows `current` from evenly spaced angles around
 * the figure; a frame sheet shows evenly spaced moments of its animation.
 */
export function exportCells(scenes: Scene[], current: Scene, o: Pick<ExportOptions, 'scope' | 'angles' | 'frames'>): Cell[] {
  if (o.scope === 'all' || o.scope === 'poses') return scenes.map((scene, i) => ({ scene, caption: `${i + 1}. ${scene.name}` }));
  if ((o.scope === 'frames' || o.scope === 'video') && current.animation) {
    return frameTimes(current.animation, o.frames).map((t) => ({ scene: sceneAt(current, t), caption: `${t.toFixed(2)} s` }));
  }
  if (o.scope !== 'turnaround') return [{ scene: current, caption: current.name }];
  return TURNAROUND_NAMES[o.angles].map((name, i) => ({
    scene: { ...current, view: { ...current.view, yaw: wrapDeg((360 / o.angles) * i) } },
    caption: name,
  }));
}

const LABEL_HEIGHT = 40;

export function sheetSize(cells: number, o: Pick<ExportOptions, 'columns' | 'cellWidth' | 'cellHeight' | 'labels'>) {
  const cols = Math.max(1, Math.min(o.columns, cells));
  const rows = Math.ceil(cells / cols);
  return { cols, rows, width: cols * o.cellWidth, height: rows * (o.cellHeight + (o.labels ? LABEL_HEIGHT : 0)) };
}

export interface RenderOptions {
  transparent?: boolean;
  margin?: number;
  style?: Style;
  /** Minimum camera distance from the subject's centre (see fitCamera). */
  minDistance?: number;
  /** Simple face details (default on). */
  faces?: boolean;
  /** The styled picture, or a depth / normal pass. */
  pass?: Pass;
}

export type Pass = 'beauty' | 'depth' | 'normal';

/** Off-screen renderer used for thumbnails and image export. */
export class SceneRenderer {
  private renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(20, 1, 0.05, 100);
  private view = new SceneView();
  private lights = new LightRig();
  private lines = new LineArtPass();
  private depth = new THREE.ShaderMaterial({
    uniforms: { near: { value: 1 }, far: { value: 10 } },
    vertexShader: 'varying float vDepth; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float near; uniform float far; varying float vDepth; void main() { float d = clamp((far - vDepth) / (far - near), 0.0, 1.0); gl_FragColor = vec4(vec3(d), 1.0); }',
  });
  private normals = new THREE.MeshNormalMaterial();
  private background = new THREE.Color('#ffffff');

  constructor() {
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.scene.add(this.view.root, this.lights.object);
  }

  /** Camera distance that fits `doc` into a w × h cell (no rendering). */
  measure(doc: Scene, w: number, h: number, margin = 0.07) {
    this.view.sync(doc);
    this.camera.aspect = w / h;
    return fitCamera(this.camera, this.view, doc.view, margin).distance;
  }

  /** Size the output and pose the view for a frame (everything but the camera). */
  private setup(doc: Scene, w: number, h: number, line: number, opts: RenderOptions) {
    const style = opts.style ?? 'line';
    this.renderer.setSize(w, h, false);
    this.background.set(styleDef(style).background);
    this.scene.background = opts.transparent ? null : this.background;
    this.renderer.setClearColor(this.background, opts.transparent ? 0 : 1);
    this.view.setFaces(opts.faces ?? true);
    this.view.sync(doc);
    this.view.setStyle(style);
    this.lines.setStyle(style);
    this.view.ink.setResolution(w, h);
    this.view.ink.setThickness(line);
    // Each scene is lit by its own light.
    this.view.ink.setLightDirection(this.lights.update(doc.light ?? DEFAULT_LIGHT, style, this.view.bounds()));
  }

  /** Draw the frame: the styled picture, or a depth / normal pass for AI image and video tools. */
  private draw(line: number, opts: RenderOptions) {
    const pass = opts.pass ?? 'beauty';
    if (pass === 'beauty') {
      this.lines.prepare(this.renderer, this.view, this.camera, line * 0.8);
      this.renderer.render(this.scene, this.camera);
      this.lines.overlay(this.renderer);
      return this.renderer.domElement;
    }
    // Plain shapes only: no outlines, contour lines, floor or lights.
    const bg = new THREE.Color(pass === 'depth' ? '#000000' : '#8080ff');
    this.scene.background = opts.transparent ? null : bg;
    this.renderer.setClearColor(bg, opts.transparent ? 0 : 1);
    this.lights.object.visible = false;
    this.view.setIdMode(true);
    if (pass === 'depth') {
      // Near is white and far is black, spread over the subject's depth range.
      const box = this.view.bounds();
      const view = this.camera.matrixWorldInverse;
      let near = Infinity;
      let far = 0;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const d = -new THREE.Vector3(x, y, z).applyMatrix4(view).z;
        near = Math.min(near, d);
        far = Math.max(far, d);
      }
      const pad = (far - near) * 0.05 + 0.01;
      this.depth.uniforms.near.value = Math.max(0.01, near - pad);
      this.depth.uniforms.far.value = far + pad;
    }
    this.scene.overrideMaterial = pass === 'depth' ? this.depth : this.normals;
    this.renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    this.view.setIdMode(false);
    this.lights.object.visible = true;
    return this.renderer.domElement;
  }

  render(doc: Scene, w: number, h: number, line = 2, opts: RenderOptions = {}): HTMLCanvasElement {
    this.setup(doc, w, h, line, opts);
    this.camera.aspect = w / h;
    fitCamera(this.camera, this.view, doc.view, opts.margin ?? 0.07, opts.minDistance ?? 0);
    return this.draw(line, opts);
  }

  /** One frame of a shot: the scene filmed by its camera (see lib/shot.ts cameraAt). */
  renderShot(doc: Scene, w: number, h: number, line: number, opts: RenderOptions & { camera: CameraView }) {
    this.setup(doc, w, h, line, opts);
    placeCamera(this.camera, opts.camera, w / h);
    return this.draw(line, opts);
  }

  /** Camera pose of the last rendered frame (for camera.json in keyframe packs). */
  cameraState() {
    const c = this.camera;
    const dir = new THREE.Vector3();
    c.getWorldDirection(dir);
    const r = (v: number) => Math.round(v * 10000) / 10000;
    return { position: c.position.toArray().map(r), direction: dir.toArray().map(r), up: c.up.toArray().map(r), fov: r(c.fov), aspect: r(c.aspect) };
  }

  thumbnail(doc: Scene): string {
    return this.render(doc, 180, 192, 1.1).toDataURL('image/png');
  }

  /** Lay cells out in a grid, optionally captioned. */
  sheet(cells: Cell[], o: ExportOptions, faces = true): HTMLCanvasElement {
    const { cols, width, height } = sheetSize(cells.length, o);
    const labelH = o.labels ? LABEL_HEIGHT : 0;
    const transparent = o.transparent && o.format === 'png';
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d')!;
    if (!transparent) {
      ctx.fillStyle = o.pass === 'depth' ? '#000000' : o.pass === 'normal' ? '#8080ff' : styleDef(o.style).background;
      ctx.fillRect(0, 0, out.width, out.height);
    }
    // Same scale: the apparent size depends on distance × tan(fov / 2), so match that product.
    const tan = (s: Scene) => Math.tan((s.view.fov * D2R) / 2);
    // Turnarounds and frame sheets are only useful if every cell has the same scale.
    const size = o.sameScale || o.scope === 'turnaround' || o.scope === 'frames' ? Math.max(...cells.map((c) => this.measure(c.scene, o.cellWidth, o.cellHeight, o.margin) * tan(c.scene))) : 0;
    cells.forEach(({ scene, caption }, i) => {
      const x = (i % cols) * o.cellWidth;
      const y = Math.floor(i / cols) * (o.cellHeight + labelH);
      const canvas = this.render(scene, o.cellWidth, o.cellHeight, o.lineWidth, {
        transparent, margin: o.margin, style: o.style, faces, pass: o.pass, minDistance: size / tan(scene),
      });
      ctx.drawImage(canvas, x, y);
      if (o.labels) {
        ctx.fillStyle = '#3a3a40';
        ctx.font = `500 ${Math.round(labelH * 0.45)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(caption, x + o.cellWidth / 2, y + o.cellHeight + labelH / 2, o.cellWidth - 20);
      }
    });
    return out;
  }

  dispose() {
    this.view.dispose();
    this.lights.dispose();
    this.depth.dispose();
    this.normals.dispose();
    this.renderer.dispose();
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: 'jpeg' | 'png' = 'jpeg', quality = 0.92) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), `image/${format}`, quality));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string, fallback = 'pose') {
  return name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 80) || fallback;
}
