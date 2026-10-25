'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import { LightRig } from '@/lib/lighting';
import { LineArtPass } from '@/lib/lineart';
import { IK_CHAINS, POLE_CHAINS, type Mannequin } from '@/lib/mannequin';
import { fitCamera, viewFromCamera } from '@/lib/render';
import { SceneView } from '@/lib/sceneview';
import { styleDef } from '@/lib/styles';
import type { Settings, Store } from '@/lib/store';
import type { Figure, JointName, Scene, Selection, Style, Vec3, View } from '@/lib/types';

export interface ViewportApi {
  /** Current editor camera as a View (for "use current view"). */
  getView(): View;
  /** Where a figure's pelvis currently is (including auto-grounding). */
  rootPosition(figure: string): Vec3 | null;
  /** Screen (client) coordinates of a joint, for tests and tooling. */
  project(figure: string, joint: JointName): { x: number; y: number } | null;
}

export interface FrameRequest {
  view: Pick<View, 'yaw' | 'pitch'> & { fov?: number };
  n: number;
}

interface Props {
  store: Store;
  scene: Scene;
  selection: Selection;
  activeFigure: string | null;
  settings: Settings;
  /** Explicit camera requests (view buttons, shortcuts). The view also re-frames when `scene.id` changes. */
  frameRequest: FrameRequest;
  apiRef: RefObject<ViewportApi | null>;
}

type Controls = { target: THREE.Vector3; enabled: boolean; update(): void } | null;

export default function Viewport({ store, scene, selection, activeFigure, settings, frameRequest, apiRef }: Props) {
  const sv = useMemo(() => new SceneView(), []);
  // Re-render when sync() replaces three.js objects, so the gizmo/handles get the new joints.
  const version = useSyncExternalStore(sv.subscribe, sv.getVersion, sv.getVersion);
  const gizmoBusy = useRef(0);
  const downAt = useRef<[number, number]>([0, 0]);

  useLayoutEffect(() => {
    sv.sync(scene);
  }, [sv, scene]);
  useLayoutEffect(() => sv.setSelection(selection), [sv, selection, scene]);
  useLayoutEffect(() => sv.setStyle(settings.style), [sv, settings.style]);
  useEffect(() => () => sv.dispose(), [sv]);

  const figureDoc = (id: string) => scene.figures.find((f) => f.id === id);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // that was an orbit drag, not a click
    e.stopPropagation();
    let o: THREE.Object3D | null = e.object;
    while (o && !o.userData.joint && !o.userData.prop) o = o.parent;
    if (!o) return;
    if (o.userData.prop) store.select({ kind: 'prop', prop: o.userData.prop as string });
    else store.select({ kind: 'joint', figure: o.userData.figure as string, joint: o.userData.joint as JointName });
  };

  // Gizmo target for the current selection.
  let target: THREE.Object3D | null = null;
  let mode: 'rotate' | 'translate' | 'scale' = 'rotate';
  let showY = true;
  let onGizmoChange = () => {};
  if (selection?.kind === 'joint') {
    const m = sv.figures.get(selection.figure);
    const doc = figureDoc(selection.figure);
    if (m && doc) {
      const joint = selection.joint;
      target = m.joints[joint];
      mode = joint === 'root' && settings.gizmo === 'translate' ? 'translate' : 'rotate';
      showY = !(mode === 'translate' && doc.grounded);
      onGizmoChange = () => {
        if (settings.limits && mode === 'rotate') m.constrain([joint]);
        store.updateFigure(doc.id, (f) => ({ ...f, ...m.read() }), `gizmo:${doc.id}:${joint}`);
      };
    }
  } else if (selection?.kind === 'prop') {
    const p = sv.props.get(selection.prop);
    if (p) {
      target = p.object;
      mode = settings.gizmo;
      const id = selection.prop;
      onGizmoChange = () => store.updateProp(id, (doc) => ({ ...doc, ...p.read() }), `gizmo:${id}`);
    }
  }

  const active = activeFigure ? sv.figures.get(activeFigure) : undefined;
  const activeDoc = activeFigure ? figureDoc(activeFigure) : undefined;

  return (
    <div className="canvas-wrap" onPointerDown={(e) => { downAt.current = [e.clientX, e.clientY]; }}>
      <Canvas
        flat
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ fov: 35, position: [0, 1, 5], near: 0.01, far: 200 }}
        gl={{ antialias: true }}
        onPointerMissed={(e) => {
          const [x, y] = downAt.current;
          const moved = Math.hypot(e.clientX - x, e.clientY - y) > 4;
          if (!moved && performance.now() - gizmoBusy.current > 250) store.select(null);
        }}
      >
        <color attach="background" args={[styleDef(settings.style).background]} />
        <Lights sv={sv} settings={settings} scene={scene} />
        {settings.showGrid && <gridHelper args={[10, 40, '#d4d4d8', '#ededf0']} />}
        <primitive object={sv.root} onClick={handleClick} />
        {target && (
          <TransformControls
            object={target}
            mode={mode}
            space={mode === 'translate' ? 'world' : 'local'}
            size={0.6}
            showY={showY}
            onMouseDown={() => { gizmoBusy.current = Infinity; }}
            onMouseUp={() => { gizmoBusy.current = performance.now(); }}
            onObjectChange={onGizmoChange}
          />
        )}
        {settings.showHandles && active && activeDoc && (
          <IKHandles
            key={`${activeDoc.id}:${version}`}
            m={active}
            figure={activeDoc}
            limits={settings.limits}
            onCommit={(read) => store.updateFigure(activeDoc.id, (f) => ({ ...f, ...read }), 'ik')}
          />
        )}
        <OrbitControls makeDefault />
        <Bridge sv={sv} apiRef={apiRef} frameRequest={frameRequest} sceneId={scene.id} sceneView={scene.view} />
        <LineArtRenderer sv={sv} lineWidth={settings.editorLine} style={settings.style} />
      </Canvas>
    </div>
  );
}

type HandleId = 'wristL' | 'wristR' | 'ankleL' | 'ankleR' | 'root' | 'elbowL' | 'elbowR' | 'kneeL' | 'kneeR';

const HANDLES: { id: HandleId; color: string; r: number }[] = [
  { id: 'wristL', color: '#f97316', r: 0.034 },
  { id: 'wristR', color: '#f97316', r: 0.034 },
  { id: 'ankleL', color: '#10b981', r: 0.038 },
  { id: 'ankleR', color: '#10b981', r: 0.038 },
  { id: 'root', color: '#8b5cf6', r: 0.045 },
  { id: 'elbowL', color: '#fdba74', r: 0.024 },
  { id: 'elbowR', color: '#fdba74', r: 0.024 },
  { id: 'kneeL', color: '#6ee7b7', r: 0.026 },
  { id: 'kneeR', color: '#6ee7b7', r: 0.026 },
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
 * stay planted, and the small elbow/knee dots swing the limb around its own axis.
 */
function IKHandles({ m, figure, limits, onCommit }: {
  m: Mannequin;
  figure: Figure;
  limits: boolean;
  onCommit(read: Pick<Figure, 'joints' | 'position'>): void;
}) {
  const refs = useRef<Partial<Record<HandleId, THREE.Mesh | null>>>({});
  const drag = useRef<Drag | null>(null);
  const camera = useThree((s) => s.camera);
  const get = useThree((s) => s.get);
  const setOrbit = (enabled: boolean) => {
    const controls = get().controls as unknown as Controls;
    if (controls) controls.enabled = enabled;
  };
  const scale = figure.body.height / 1.8;

  useFrame(() => {
    for (const h of HANDLES) {
      const mesh = refs.current[h.id];
      if (mesh) m.joints[h.id].getWorldPosition(mesh.position);
    }
  });

  const down = (id: HandleId) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
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
    setOrbit(false);
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
    setOrbit(true);
    onCommit(m.read());
  };

  return (
    <>
      {HANDLES.map((h) => (
        <mesh
          key={h.id}
          name={`handle:${h.id}`}
          ref={(el) => { refs.current[h.id] = el; }}
          renderOrder={10}
          onPointerDown={down(h.id)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerOver={() => { document.body.style.cursor = 'grab'; }}
          onPointerOut={() => { document.body.style.cursor = ''; }}
        >
          <sphereGeometry args={[h.r * scale, 20, 14]} />
          <meshBasicMaterial color={h.color} transparent opacity={0.88} depthTest={false} />
        </mesh>
      ))}
    </>
  );
}

/** The shared key light + shadow floor, re-aimed when the scene or light changes. */
function Lights({ sv, settings, scene }: { sv: SceneView; settings: Settings; scene: Scene }) {
  const rig = useMemo(() => new LightRig(), []);
  const stale = useRef(true);
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => { stale.current = true; }, [scene, settings.light, settings.style]);
  // Aim at render time, after the scene has been synced.
  useFrame(() => {
    if (!stale.current) return;
    stale.current = false;
    sv.ink.setLightDirection(rig.update(settings.light, settings.style, sv.bounds()));
  });
  return <primitive object={rig.object} />;
}

/** Takes over R3F's render loop to add the interior line-art pass. */
function LineArtRenderer({ sv, lineWidth, style }: { sv: SceneView; lineWidth: number; style: Style }) {
  const pass = useMemo(() => new LineArtPass(), []);
  useEffect(() => pass.setStyle(style), [pass, style]);
  const size = useThree((s) => s.size);
  useEffect(() => {
    sv.ink.setResolution(size.width, size.height);
    sv.ink.setThickness(lineWidth);
  }, [sv, size, lineWidth]);
  useFrame(({ gl, scene, camera }) => {
    pass.prepare(gl, sv, camera, lineWidth * 0.8);
    gl.render(scene, camera);
    pass.overlay(gl);
  }, 1);
  return null;
}

function Bridge({ sv, apiRef, frameRequest, sceneId, sceneView }: {
  sv: SceneView;
  apiRef: Props['apiRef'];
  frameRequest: FrameRequest;
  sceneId: string;
  sceneView: View;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as Controls;
  const gl = useThree((s) => s.gl);
  const latestView = useRef(sceneView);
  useEffect(() => { latestView.current = sceneView; }, [sceneView]);

  useEffect(() => {
    apiRef.current = {
      getView: () => viewFromCamera(camera, controls?.target ?? new THREE.Vector3(0, 1, 0)),
      rootPosition: (id) => sv.figures.get(id)?.read().position ?? null,
      project: (id, joint) => {
        const m = sv.figures.get(id);
        if (!m) return null;
        const p = m.joints[joint].getWorldPosition(new THREE.Vector3()).project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
      },
    };
  }, [apiRef, camera, controls, sv, gl]);

  const frame = (view: FrameRequest['view']) => {
    if (!controls) return 0;
    // Wait a frame so the scene has been synced.
    return requestAnimationFrame(() => {
      controls.target.copy(fitCamera(camera, sv, { yaw: view.yaw, pitch: view.pitch, fov: view.fov ?? 35 }, 0.2));
      camera.near = 0.01; // fitCamera tightens these for export; keep room for zooming
      camera.far = 200;
      camera.updateProjectionMatrix();
      controls.update();
    });
  };

  // Switching to another pose shows it from its export angle.
  useEffect(() => {
    const id = frame({ ...latestView.current, fov: 35 });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, controls]);

  useEffect(() => {
    if (frameRequest.n === 0) return;
    const id = frame(frameRequest.view);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest]);

  return null;
}
