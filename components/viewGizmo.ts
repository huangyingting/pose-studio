import * as THREE from 'three';

/** The view gizmo's square at the canvas's top right (px), and its margin from the corner (as `.view-ball`'s). */
export const GIZMO_SIZE = 96;
const GIZMO_MARGIN = 10;
/** Where an axis's end is drawn: a share of half the square (the rest is room for its ball). */
export const GIZMO_REACH = 0.66;

/** The axes' colours, as the CSS tokens `--axis-x/y/z` (light theme) and the floor's axes. */
const COLOURS = ['#e5484d', '#30a46c', '#3d7bff'];
const LETTERS = ['X', 'Y', 'Z'];

/** An axis's end: its axis and which way (`x+`, `z-`). */
export type GizmoEnd = `${'x' | 'y' | 'z'}${'+' | '-'}`;

/** The end the pointer rests on (ViewBall says), drawn larger; who to tell to draw again. */
let hovered: GizmoEnd | null = null;
let redraw: (() => void) | null = null;
export function hoverGizmo(end: GizmoEnd | null) {
  if (end === hovered) return;
  hovered = end;
  redraw?.();
}
export function onGizmoHover(f: (() => void) | null) {
  redraw = f;
}

/** A letter on a ball: white, facing the view, drawn over it. */
function letter(text: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.font = `700 40px ${getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'}`;
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 35);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false, transparent: true }));
  s.scale.setScalar(0.5);
  s.renderOrder = 1;
  return s;
}

/**
 * The view gizmo drawn in 3D (#38): the world's axes as the view sees them, lit rods with a ball at
 * each end (the far ends paler, the near ones lettered), the end the pointer rests on larger; nothing
 * else, over the canvas. In a square of its own in the canvas's corner, through a camera of its own,
 * so it stays the same size however near or far the view is. What is clicked and dragged on it is the
 * DOM's (ViewBall: unseen, at the same places).
 */
export class ViewGizmo {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly ends = new Map<GizmoEnd, THREE.Object3D>();
  private readonly size = new THREE.Vector2();
  private readonly viewport = new THREE.Vector4();

  constructor() {
    const f = 1 / GIZMO_REACH;
    this.camera = new THREE.OrthographicCamera(-f, f, f, -f, 0.1, 10);
    this.camera.add(new THREE.DirectionalLight('#ffffff', 2.2).translateX(-1).translateY(1.5).translateZ(2));
    this.scene.add(this.camera, new THREE.AmbientLight('#ffffff', 1.2));
    const rod = new THREE.CylinderGeometry(0.06, 0.06, 1, 12).translate(0, 0.5, 0);
    const ball = new THREE.SphereGeometry(0.3, 24, 16);
    const far = new THREE.SphereGeometry(0.18, 16, 12);
    const turns = [new THREE.Euler(0, 0, -Math.PI / 2), new THREE.Euler(), new THREE.Euler(Math.PI / 2, 0, 0)];
    COLOURS.forEach((c, axis) => {
      const near = new THREE.MeshLambertMaterial({ color: c });
      const pale = new THREE.MeshLambertMaterial({ color: new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.55) });
      const r = new THREE.Mesh(rod, near);
      r.rotation.copy(turns[axis]);
      const at = new THREE.Vector3().setComponent(axis, 1);
      const plus = new THREE.Group().add(new THREE.Mesh(ball, near));
      if (typeof document !== 'undefined') plus.add(letter(LETTERS[axis]));
      plus.position.copy(at);
      const minus = new THREE.Mesh(far, pale);
      minus.position.copy(at).negate();
      const name = 'xyz'[axis] as 'x' | 'y' | 'z';
      this.ends.set(`${name}+`, plus).set(`${name}-`, minus);
      this.scene.add(r, plus, minus);
    });
  }

  /** Drawn over what is drawn already, in its square, as `view` sees the world (round what it looks at). */
  draw(gl: THREE.WebGLRenderer, view: THREE.Camera) {
    this.camera.quaternion.copy(view.quaternion);
    this.camera.position.set(0, 0, 4).applyQuaternion(view.quaternion);
    for (const [end, o] of this.ends) o.scale.setScalar(end === hovered ? 1.3 : 1);
    gl.getSize(this.size);
    gl.getViewport(this.viewport);
    const [x, y] = [this.size.x - GIZMO_MARGIN - GIZMO_SIZE, this.size.y - GIZMO_MARGIN - GIZMO_SIZE];
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    gl.setScissorTest(true);
    gl.setScissor(x, y, GIZMO_SIZE, GIZMO_SIZE);
    gl.setViewport(x, y, GIZMO_SIZE, GIZMO_SIZE);
    gl.clearDepth();
    gl.render(this.scene, this.camera);
    gl.setScissorTest(false);
    gl.setViewport(this.viewport);
    gl.autoClear = autoClear;
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh | THREE.Sprite;
      if (!(m as THREE.Mesh).isMesh && !(m as THREE.Sprite).isSprite) return;
      const material = m.material as THREE.Material & { map?: THREE.Texture | null };
      material.map?.dispose();
      material.dispose();
      if ((m as THREE.Mesh).isMesh) m.geometry.dispose();
    });
  }
}
