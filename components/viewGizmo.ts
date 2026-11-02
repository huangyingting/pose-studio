import * as THREE from 'three';

/** The view gizmo's square at the canvas's top right (px), and its margin from the corner (as `.view-ball`'s). */
export const GIZMO_SIZE = 96;
const GIZMO_MARGIN = 10;
/** Where an axis's end is drawn: a share of half the square (the rest is room for its ball and the ring). */
export const GIZMO_REACH = 0.66;

/** The axes' colours, as the CSS tokens `--axis-x/y/z` (light theme) and the floor's axes. */
const COLOURS = ['#e5484d', '#30a46c', '#3d7bff'];

/**
 * The view gizmo drawn in 3D (#38): the world's axes as the view sees them, lit rods with a ball at
 * each end (the far ends paler) and a faint ring round them, the way the joint gizmo is drawn: but
 * in a square of its own in the canvas's corner, through a camera of its own, so it stays the same
 * size however near or far the view is. What is clicked and dragged on it is the DOM's (ViewBall),
 * laid over it at the same places.
 */
export class ViewGizmo {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  /** What is turned with the view (faces it): the ring and the disc behind the axes. */
  private readonly facing = new THREE.Group();
  private readonly size = new THREE.Vector2();
  private readonly viewport = new THREE.Vector4();

  constructor() {
    const f = 1 / GIZMO_REACH;
    this.camera = new THREE.OrthographicCamera(-f, f, f, -f, 0.1, 10);
    this.camera.add(new THREE.DirectionalLight('#ffffff', 2.2).translateX(-1).translateY(1.5).translateZ(2));
    this.scene.add(this.camera, new THREE.AmbientLight('#ffffff', 1.2), this.facing);
    const rod = new THREE.CylinderGeometry(0.06, 0.06, 1, 12).translate(0, 0.5, 0);
    const ball = new THREE.SphereGeometry(0.3, 24, 16);
    const far = new THREE.SphereGeometry(0.18, 16, 12);
    const turns = [new THREE.Euler(0, 0, -Math.PI / 2), new THREE.Euler(), new THREE.Euler(Math.PI / 2, 0, 0)];
    COLOURS.forEach((c, axis) => {
      const near = new THREE.MeshLambertMaterial({ color: c });
      const pale = new THREE.MeshLambertMaterial({ color: new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.55) });
      const r = new THREE.Mesh(rod, near);
      r.rotation.copy(turns[axis]);
      const end = new THREE.Vector3().setComponent(axis, 1);
      const b = new THREE.Mesh(ball, near);
      b.position.copy(end);
      const back = new THREE.Mesh(far, pale);
      back.position.copy(end).negate();
      this.scene.add(r, b, back);
    });
    // (Behind the axes, facing the view: a faint disc to stand out on any scene, and its rim, a ring to grab as the joint gizmo's.)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(f * 0.97, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(f * 0.93, f * 0.97, 64), new THREE.MeshBasicMaterial({ color: '#8b8d98', transparent: true, opacity: 0.55, depthWrite: false }));
    disc.position.z = ring.position.z = -1.5;
    disc.renderOrder = ring.renderOrder = -1;
    this.facing.add(disc, ring);
  }

  /** Drawn over what is drawn already, in its square, as `view` sees the world (round what it looks at). */
  draw(gl: THREE.WebGLRenderer, view: THREE.Camera) {
    this.camera.quaternion.copy(view.quaternion);
    this.camera.position.set(0, 0, 4).applyQuaternion(view.quaternion);
    this.facing.quaternion.copy(view.quaternion);
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
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
  }
}
