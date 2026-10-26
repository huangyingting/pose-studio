import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { IK_CHAINS, POLE_CHAINS, setWorldQuaternion, type Mannequin } from '@/lib/mannequin';
import type { SceneView } from '@/lib/sceneview';
import type { Store } from '@/lib/store';
import type { Figure, JointName, Scene } from '@/lib/types';

/*
 * Direct manipulation on the canvas. The things themselves are the handles:
 *   drag a prop, a stand-in or a figure's torso   → move it on the floor
 *   drag a hand or a foot                         → move it, the limb follows (IK)
 *   drag any other body part (limbs, neck, head)  → swing it from its joint
 *   drag the ring on the floor                    → turn the figure or prop (Shift: 15° steps)
 * A click (no drag) still selects, for the gizmo and the inspector. Alt-drag always orbits.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const DRAG_PX = 4;
const TORSO: readonly JointName[] = ['root', 'spine', 'chest'];
const ENDS: Partial<Record<JointName, keyof typeof IK_CHAINS>> = { wristL: 'wristL', wristR: 'wristR', ankleL: 'ankleL', ankleR: 'ankleR' };

type Controls = { enabled: boolean } | null;

/** World units per screen pixel at a point (for handles that keep their size on screen). */
function worldPerPixel(camera: THREE.Camera, at: THREE.Vector3, height: number) {
  const cam = camera as THREE.PerspectiveCamera;
  if (!cam.isPerspectiveCamera) return 0.002;
  return (2 * cam.position.distanceTo(at) * Math.tan((cam.fov * D2R) / 2)) / height;
}

/** Pointer helpers bound to the canvas: rays from client coordinates and the orbit switch. */
function usePointer() {
  const get = useThree((s) => s.get);
  return useMemo(() => {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    return {
      ray(x: number, y: number) {
        const { camera, gl } = get();
        const r = gl.domElement.getBoundingClientRect();
        raycaster.setFromCamera(ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
        return raycaster.ray;
      },
      orbit(enabled: boolean) {
        const controls = get().controls as unknown as Controls;
        if (controls) controls.enabled = enabled;
      },
      camera: () => get().camera,
    };
  }, [get]);
}

/** Follow the pointer until it is released (window listeners: the pointer may leave the object). */
function follow(onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) {
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onUp(e);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

const tagged = (o: THREE.Object3D | null) => {
  while (o && !o.userData.joint && !o.userData.prop) o = o.parent;
  return o;
};

type Plan = { begin(): void; move(ray: THREE.Ray): void; end(): void; cursor: string };

/**
 * The scene's figures and props, draggable. Pressing on one starts nothing until the pointer
 * moves a few pixels, so a click still selects (and the gizmo keeps its own drags).
 */
export function SceneObjects({ sv, store, scene, limits, gizmoActive, onClick }: {
  sv: SceneView;
  store: Store;
  scene: Scene;
  limits: boolean;
  /** Whether the gizmo is being dragged (a press on it also lands on the objects behind). */
  gizmoActive(): boolean;
  onClick(e: ThreeEvent<MouseEvent>): void;
}) {
  const pointer = usePointer();

  const plan = (o: THREE.Object3D, point: THREE.Vector3): Plan | null => {
    const camera = pointer.camera();
    const facingPlane = () => new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), point);
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y);
    const hit = (ray: THREE.Ray, plane: THREE.Plane) => ray.intersectPlane(plane, new THREE.Vector3());

    if (o.userData.prop) {
      const id = o.userData.prop as string;
      const p = sv.props.get(id);
      if (!p) return null;
      const start = p.object.position.clone();
      return {
        cursor: 'move',
        begin: () => store.select({ kind: 'prop', prop: id }),
        move: (ray) => {
          const h = hit(ray, floorPlane);
          if (!h) return;
          p.object.position.set(start.x + h.x - point.x, start.y, start.z + h.z - point.z);
          p.object.updateMatrixWorld(true);
        },
        end: () => store.updateProp(id, (doc) => ({ ...doc, ...p.read() })),
      };
    }

    const id = o.userData.figure as string;
    const joint = o.userData.joint as JointName;
    const m = sv.figures.get(id);
    const doc = scene.figures.find((f) => f.id === id);
    if (!m || !doc) return null;
    const commit = () => {
      m.setGroundLock(false);
      store.updateFigure(id, (f) => ({ ...f, ...m.read() }));
    };

    if (doc.proxy || TORSO.includes(joint)) {
      const root = m.joints.root;
      const start = root.position.clone();
      return {
        cursor: 'move',
        begin: () => store.select({ kind: 'figure', figure: id }),
        move: (ray) => {
          const h = hit(ray, floorPlane);
          if (!h) return;
          root.position.set(start.x + h.x - point.x, start.y, start.z + h.z - point.z);
          m.object.updateMatrixWorld(true);
        },
        end: commit,
      };
    }

    const plane = facingPlane();
    const end = ENDS[joint];
    if (end) {
      // A hand or a foot: it follows the pointer and keeps its orientation; the limb bends.
      const grab = m.joints[joint].getWorldPosition(new THREE.Vector3()).sub(point);
      const endQ = m.joints[joint].getWorldQuaternion(new THREE.Quaternion());
      return {
        cursor: 'grab',
        begin: () => { m.setGroundLock(true); store.select({ kind: 'joint', figure: id, joint }); },
        move: (ray) => {
          const h = hit(ray, plane);
          if (h) m.solveIK(IK_CHAINS[end], h.add(grab), endQ, limits);
        },
        end: commit,
      };
    }

    // Any other part swings from its joint so that the grabbed point follows the pointer.
    const obj = m.joints[joint];
    const pivot = obj.getWorldPosition(new THREE.Vector3());
    const from = point.clone().sub(pivot).normalize();
    const startQ = obj.getWorldQuaternion(new THREE.Quaternion());
    const swing = new THREE.Quaternion();
    return {
      cursor: 'grab',
      begin: () => { m.setGroundLock(true); store.select({ kind: 'joint', figure: id, joint }); },
      move: (ray) => {
        const h = hit(ray, plane);
        if (!h) return;
        const to = h.sub(pivot);
        if (to.lengthSq() < 1e-8) return;
        setWorldQuaternion(obj, swing.setFromUnitVectors(from, to.normalize()).multiply(startQ));
        if (limits) m.constrain([joint]);
      },
      end: commit,
    };
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || e.altKey) return;
    // Handles drawn over the body (the IK dots) take precedence.
    if (e.intersections.some((i) => i.object.userData.handle)) return;
    const o = tagged(e.object);
    if (!o) return;
    e.stopPropagation();
    const p = plan(o, e.point.clone());
    if (!p) return;
    const [x0, y0] = [e.nativeEvent.clientX, e.nativeEvent.clientY];
    let started = false;
    let cancelled = false;
    pointer.orbit(false);
    follow(
      (ev) => {
        if (cancelled) return;
        if (!started) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return;
          // The press was on the gizmo: it does the dragging (and owns the orbit switch).
          if (gizmoActive()) { cancelled = true; return; }
          started = true;
          document.body.style.cursor = p.cursor === 'grab' ? 'grabbing' : p.cursor;
          p.begin();
        }
        p.move(pointer.ray(ev.clientX, ev.clientY));
      },
      () => {
        if (!cancelled) pointer.orbit(true);
        if (started) {
          document.body.style.cursor = '';
          p.end();
        }
      },
    );
  };

  /** Show what a drag would do. */
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.buttons) return;
    const o = tagged(e.object);
    if (!o) return;
    const proxy = scene.figures.find((f) => f.id === o.userData.figure)?.proxy;
    document.body.style.cursor = o.userData.prop || proxy || TORSO.includes(o.userData.joint) ? 'move' : 'grab';
  };

  return (
    <primitive
      object={sv.root}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerOut={() => { document.body.style.cursor = ''; }}
    />
  );
}

/** Drag around a point on the floor to turn something; Shift snaps to 15° steps. */
function useTurn() {
  const pointer = usePointer();
  return (e: ThreeEvent<PointerEvent>, center: THREE.Vector3, startYaw: number, apply: (yaw: number) => void, commit: () => void) => {
    if (e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const angle = (x: number, y: number) => {
      const h = pointer.ray(x, y).intersectPlane(floor, new THREE.Vector3());
      return h ? Math.atan2(h.x - center.x, h.z - center.z) * R2D : null;
    };
    const a0 = angle(e.nativeEvent.clientX, e.nativeEvent.clientY);
    if (a0 === null) return;
    pointer.orbit(false);
    document.body.style.cursor = 'grabbing';
    let turned = false;
    follow(
      (ev) => {
        const a = angle(ev.clientX, ev.clientY);
        if (a === null) return;
        let yaw = startYaw + a - a0;
        if (ev.shiftKey) yaw = Math.round(yaw / 15) * 15;
        yaw = ((((yaw + 180) % 360) + 360) % 360) - 180;
        turned = true;
        apply(yaw);
      },
      () => {
        pointer.orbit(true);
        document.body.style.cursor = '';
        if (turned) commit();
      },
    );
  };
}

/** A ring on the floor with an arrow for the way it faces; `hit` adds a wide band to grab. */
function FloorRing({ radius, color, hit, onDown }: { radius: number; color: string; hit?: boolean; onDown?(e: ThreeEvent<PointerEvent>): void }) {
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} renderOrder={5}>
        <ringGeometry args={[radius * 0.945, radius, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[0, 0, radius * 1.2]} renderOrder={5}>
        <circleGeometry args={[radius * 0.2, 3]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      {hit && (
        <mesh
          rotation-x={-Math.PI / 2}
          visible={false}
          onPointerDown={onDown}
          onPointerOver={() => { document.body.style.cursor = 'ew-resize'; }}
          onPointerOut={() => { document.body.style.cursor = ''; }}
        >
          <ringGeometry args={[radius * 0.72, radius * 1.45, 48]} />
        </mesh>
      )}
    </>
  );
}

/**
 * Rings under the figures, so the layout of a group reads from any angle. The active figure's
 * ring turns it; another's ring picks that figure.
 */
export function FigureMarkers({ sv, scene, version, active, onPick, onTurn }: {
  sv: SceneView;
  scene: Scene;
  version: number;
  active: string | null;
  onPick(id: string): void;
  onTurn(id: string, read: Pick<Figure, 'joints' | 'position'>): void;
}) {
  const groups = useRef<Record<string, THREE.Group | null>>({});
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), f: new THREE.Vector3() }), []);
  const turn = useTurn();
  useFrame(() => {
    for (const f of scene.figures) {
      const g = groups.current[f.id];
      const m = sv.figures.get(f.id);
      if (!g || !m) continue;
      const root = m.joints.root;
      root.getWorldPosition(tmp.p);
      g.position.set(tmp.p.x, 0.004, tmp.p.z);
      tmp.f.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(tmp.q));
      g.rotation.y = Math.atan2(tmp.f.x, tmp.f.z);
    }
  });
  void version;
  return (
    <>
      {scene.figures.filter((f) => !f.hidden).map((f) => {
        const on = f.id === active;
        const m = sv.figures.get(f.id);
        return (
          <group
            key={f.id}
            ref={(el) => { groups.current[f.id] = el; }}
            onClick={on ? undefined : (e) => { if (e.delta > 4) return; e.stopPropagation(); onPick(f.id); }}
            onPointerOver={on ? undefined : () => { document.body.style.cursor = 'pointer'; }}
            onPointerOut={on ? undefined : () => { document.body.style.cursor = ''; }}
          >
            <FloorRing
              radius={0.275 * (f.body.height / 1.8)}
              color={on ? '#3b6cff' : '#a1a1a6'}
              hit={on && !!m}
              onDown={(e) => {
                if (!m) return;
                const root = m.joints.root;
                turn(e, root.getWorldPosition(new THREE.Vector3()), root.rotation.y * R2D, (yaw) => {
                  root.rotation.y = yaw * D2R;
                  m.object.updateMatrixWorld(true);
                }, () => onTurn(f.id, m.read()));
              }}
            />
          </group>
        );
      })}
    </>
  );
}

/** The selected prop's ring (around its footprint): drag it to turn the prop. */
export function PropRing({ sv, id, version, onTurn }: { sv: SceneView; id: string; version: number; onTurn(): void }) {
  const group = useRef<THREE.Group>(null);
  const p = sv.props.get(id);
  const turn = useTurn();
  const tmp = useMemo(() => ({ box: new THREE.Box3(), size: new THREE.Vector3() }), []);
  useFrame(() => {
    const g = group.current;
    if (!g || !p) return;
    tmp.box.setFromObject(p.object).getSize(tmp.size);
    g.scale.setScalar(Math.max(tmp.size.x, tmp.size.z) / 2 + 0.08);
    g.position.set(p.object.position.x, 0.004, p.object.position.z);
    g.rotation.y = p.object.rotation.y;
  });
  void version;
  if (!p) return null;
  return (
    <group ref={group}>
      <FloorRing
        radius={1}
        color="#3b6cff"
        hit
        onDown={(e) => turn(e, p.object.position.clone().setY(0), p.object.rotation.y * R2D, (yaw) => {
          p.object.rotation.y = yaw * D2R;
          p.object.updateMatrixWorld(true);
        }, onTurn)}
      />
    </group>
  );
}

type HandleId = 'wristL' | 'wristR' | 'ankleL' | 'ankleR' | 'root' | 'elbowL' | 'elbowR' | 'kneeL' | 'kneeR';

/** Size on the body (r, metres for a 1.8 m figure), and at least this many pixels on screen (px), easier to hit (hit). */
const HANDLES: { id: HandleId; color: string; r: number; px: number; hit: number }[] = [
  { id: 'wristL', color: '#f97316', r: 0.034, px: 7, hit: 15 },
  { id: 'wristR', color: '#f97316', r: 0.034, px: 7, hit: 15 },
  { id: 'ankleL', color: '#10b981', r: 0.038, px: 7, hit: 15 },
  { id: 'ankleR', color: '#10b981', r: 0.038, px: 7, hit: 15 },
  { id: 'root', color: '#8b5cf6', r: 0.045, px: 8, hit: 16 },
  { id: 'elbowL', color: '#fdba74', r: 0.024, px: 5, hit: 11 },
  { id: 'elbowR', color: '#fdba74', r: 0.024, px: 5, hit: 11 },
  { id: 'kneeL', color: '#6ee7b7', r: 0.026, px: 5, hit: 11 },
  { id: 'kneeR', color: '#6ee7b7', r: 0.026, px: 5, hit: 11 },
];

const isPole = (id: HandleId): id is keyof typeof POLE_CHAINS => id in POLE_CHAINS;

interface Drag {
  id: HandleId;
  plane: THREE.Plane;
  grab: THREE.Vector3;
  start: THREE.Vector3;
  rootStart: THREE.Vector3;
  endQ: THREE.Quaternion;
  feet: { id: 'ankleL' | 'ankleR'; pos: THREE.Vector3; q: THREE.Quaternion }[];
}

/**
 * Draggable dots: hands/feet move with two-bone IK, the hips move the body while the feet
 * stay planted, and the small elbow/knee dots swing the limb around its own axis. They keep a
 * minimum size on screen, and each has a larger invisible area to grab.
 */
export function IKHandles({ m, figure, limits, onCommit }: {
  m: Mannequin;
  figure: Figure;
  limits: boolean;
  onCommit(read: Pick<Figure, 'joints' | 'position'>): void;
}) {
  const refs = useRef<Partial<Record<HandleId, THREE.Group | null>>>({});
  const hovered = useRef<HandleId | null>(null);
  const drag = useRef<Drag | null>(null);
  const camera = useThree((s) => s.camera);
  const pointer = usePointer();
  const scale = figure.body.height / 1.8;

  useFrame(({ camera: cam, size }) => {
    for (const h of HANDLES) {
      const g = refs.current[h.id];
      if (!g) continue;
      m.joints[h.id].getWorldPosition(g.position);
      const wpp = worldPerPixel(cam, g.position, size.height);
      const base = h.r * scale;
      const r = Math.min(base * 2.5, Math.max(base, h.px * wpp)) * (hovered.current === h.id || drag.current?.id === h.id ? 1.3 : 1);
      g.children[0].scale.setScalar(r);
      g.children[1].scale.setScalar(Math.min(base * 5, Math.max(r, h.hit * wpp)));
    }
  });

  const down = (id: HandleId) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    const start = m.joints[id].getWorldPosition(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), start);
    const hit = e.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const endJoint: JointName = isPole(id) ? POLE_CHAINS[id][2] : id;
    drag.current = {
      id,
      plane,
      start,
      grab: start.clone().sub(hit),
      rootStart: m.joints.root.position.clone(),
      endQ: m.joints[endJoint].getWorldQuaternion(new THREE.Quaternion()),
      feet: (['ankleL', 'ankleR'] as const).map((f) => ({
        id: f,
        pos: m.joints[f].getWorldPosition(new THREE.Vector3()),
        q: m.joints[f].getWorldQuaternion(new THREE.Quaternion()),
      })),
    };
    m.setGroundLock(true);
    pointer.orbit(false);
  };

  const move = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const hit = e.ray.intersectPlane(d.plane, new THREE.Vector3());
    if (!hit) return;
    const target = hit.add(d.grab);
    if (d.id === 'root') {
      m.joints.root.position.copy(d.rootStart).add(target.sub(d.start));
      m.object.updateMatrixWorld(true);
      for (const f of d.feet) m.solveIK(IK_CHAINS[f.id], f.pos, f.q, limits);
    } else if (isPole(d.id)) {
      m.swivel(POLE_CHAINS[d.id], target, d.endQ, limits);
    } else {
      m.solveIK(IK_CHAINS[d.id], target, d.endQ, limits);
    }
  };

  const up = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    drag.current = null;
    m.setGroundLock(false);
    pointer.orbit(true);
    onCommit(m.read());
  };

  return (
    <>
      {HANDLES.map((h) => (
        <group
          key={h.id}
          name={`handle:${h.id}`}
          ref={(el) => { refs.current[h.id] = el; }}
          onPointerDown={down(h.id)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerOver={() => { hovered.current = h.id; document.body.style.cursor = 'grab'; }}
          onPointerOut={() => { hovered.current = null; document.body.style.cursor = ''; }}
        >
          <mesh renderOrder={10} userData={{ handle: true }}>
            <sphereGeometry args={[1, 20, 14]} />
            <meshBasicMaterial color={h.color} transparent opacity={0.88} depthTest={false} />
          </mesh>
          <mesh visible={false} userData={{ handle: true }}>
            <sphereGeometry args={[1, 12, 8]} />
          </mesh>
        </group>
      ))}
    </>
  );
}
