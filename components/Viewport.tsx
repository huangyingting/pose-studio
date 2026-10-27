'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Line, OrbitControls, TransformControls } from '@react-three/drei';
import { Trash2 } from 'lucide-react';
import { deleteCameraPoint, moveCameraLook, moveCameraPoint, setCameraPoint } from '@/lib/actions';
import { sceneAt } from '@/lib/evaluate';
import { moments } from '@/lib/track';
import { DEFAULT_LIGHT, LightRig } from '@/lib/lighting';
import { LineArtPass } from '@/lib/lineart';
import { fitCamera, viewFromCamera } from '@/lib/render';
import { onModels } from '@/lib/model';
import { SceneView } from '@/lib/sceneview';
import { cameraAt, fovLens, frameAspect, placeCamera, shotPath, type CameraView } from '@/lib/shot';
import { shotSpans, type ShotSpan } from '@/lib/shots';
import { styleDef } from '@/lib/styles';
import type { Settings, Store } from '@/lib/store';
import type { JointName, Scene, Selection, Style, Vec3, View } from '@/lib/types';
import { openContextMenu } from './ContextMenu';
import type { Clock } from './clock';
import { FigureMarkers, HoldPins, IKHandles, PropRing, RouteOverlay, SceneObjects, SeeThrough } from './Manipulators';

export interface ViewportApi {
  /** Current editor camera as a View (for "use current view"). */
  getView(): View;
  /** Where a figure's pelvis currently is (including auto-grounding). */
  rootPosition(figure: string): Vec3 | null;
  /** Screen (client) coordinates of a joint, for tests and tooling. */
  project(figure: string, joint: JointName): { x: number; y: number } | null;
  /** Screen (client) coordinates of a world point. */
  projectPoint(p: Vec3): { x: number; y: number };
  /** The camera of the current view (looking through the shot camera: as the shot frames it). */
  captureShot(): CameraView | null;
  /** What is under a screen point: a figure or prop, and the floor point there. */
  pick(x: number, y: number): CanvasHit;
}

export type CanvasHit = { figure?: string; prop?: string; floor?: Vec3 };

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
  /** Animation playback clock, playhead time, and director tools. */
  clock: Clock;
  time: number;
  shotMode: boolean;
  onion: boolean;
  /** Right-click on the canvas (not after a drag). */
  onMenu(e: { clientX: number; clientY: number }, hit: CanvasHit): void;
}

type Controls = { target: THREE.Vector3; enabled: boolean; update(): void } | null;

/** The floor is solid: the view can look up from near it, never from under it. */
function keepCameraAboveFloor(e?: { target: { object: THREE.Camera } }) {
  const camera = e?.target.object;
  if (camera && camera.position.y < 0.03) camera.position.setY(0.03);
}

export default function Viewport({
  store, scene, selection, activeFigure, settings, frameRequest, apiRef, clock, time, shotMode, onion, onMenu,
}: Props) {
  const captureRef = useRef<(() => CameraView | null) | null>(null);
  const sv = useMemo(() => new SceneView(), []);
  // Re-render when sync() replaces three.js objects, so the gizmo/handles get the new joints.
  const version = useSyncExternalStore(sv.subscribe, sv.getVersion, sv.getVersion);
  const gizmoBusy = useRef(0);
  const downAt = useRef<[number, number]>([0, 0]);

  // Characters' files are read after the first frame: drawn as them once they are.
  const [models, setModels] = useState(0);
  useEffect(() => onModels(() => setModels((n) => n + 1)), []);
  useLayoutEffect(() => {
    sv.sync(scene);
  }, [sv, scene, models]);
  useLayoutEffect(() => sv.setSelection(selection), [sv, selection, scene]);
  useLayoutEffect(() => sv.setStyle(settings.style), [sv, settings.style]);
  useLayoutEffect(() => sv.setFaces(settings.faces), [sv, settings.faces]);
  useEffect(() => () => sv.dispose(), [sv]);

  const figureDoc = (id: string) => scene.figures.find((f) => f.id === id);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // that was an orbit drag, not a click
    let o: THREE.Object3D | null = e.object;
    while (o && !o.userData.joint && !o.userData.prop) o = o.parent;
    if (!o) return;
    // A see-through prop (in front of the figure being edited) lets the click through.
    if (o.userData.prop && sv.props.get(o.userData.prop as string)?.parts.faded) return;
    e.stopPropagation();
    if (o.userData.prop) store.select({ kind: 'prop', prop: o.userData.prop as string });
    else if (figureDoc(o.userData.figure as string)?.proxy) {
      // Stand-ins are placed, not posed: a click picks the whole figure.
      store.select({ kind: 'figure', figure: o.userData.figure as string });
    } else store.select({ kind: 'joint', figure: o.userData.figure as string, joint: o.userData.joint as JointName });
  };

  // The gizmo is for the explicit tools: Move (W: a whole figure or a prop, also up and down) and
  // Scale (R: props). Joints are posed by dragging the body (Shift-drag twists) and the inspector's
  // sliders; figures and props turn by their floor ring. (Rotation rings around a joint crossed
  // the parts next to it and caught the drags meant for them.)
  let target: THREE.Object3D | null = null;
  let mode: 'translate' | 'scale' = 'translate';
  let showY = true;
  let onGizmoChange = () => {};
  const moving = settings.gizmo === 'translate';
  const gizmoFigure = moving && selection?.kind !== 'prop' && selection?.kind !== 'shot' ? (selection?.kind === 'joint' || selection?.kind === 'figure' ? selection.figure : activeFigure) : null;
  if (gizmoFigure) {
    const m = sv.figures.get(gizmoFigure);
    const doc = figureDoc(gizmoFigure);
    if (m && doc) {
      target = m.joints.hips;
      showY = !doc.grounded;
      onGizmoChange = () => store.updateFigure(doc.id, (f) => ({ ...f, ...m.read() }), `gizmo:${doc.id}`);
    }
  } else if (selection?.kind === 'prop' && settings.gizmo !== 'rotate') {
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
    <div
      className="canvas-wrap"
      onPointerDown={(e) => { downAt.current = [e.clientX, e.clientY]; }}
      onPointerUp={(e) => {
        // Open on release so a right-drag (pan) does not open it; the browser's own menu is off.
        const [x, y] = downAt.current;
        if (e.button !== 2 || Math.hypot(e.clientX - x, e.clientY - y) > 4 || !(e.target instanceof HTMLCanvasElement)) return;
        onMenu(e, apiRef.current?.pick(e.clientX, e.clientY) ?? {});
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
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
        {settings.showGrid && (
          // The floor goes on forever; the grid covers all of it, fading toward the horizon.
          <Grid
            infiniteGrid
            cellSize={0.25}
            cellThickness={0.5}
            cellColor="#ececf0"
            sectionSize={1}
            sectionThickness={0.9}
            sectionColor="#d9d9e0"
            fadeDistance={34}
            fadeStrength={2}
            position={[0, 0.0005, 0]}
          />
        )}
        <SceneObjects sv={sv} store={store} scene={scene} limits={settings.limits} gizmoActive={() => gizmoBusy.current === Infinity} onClick={handleClick} />
        {target && (
          <TransformControls
            object={target}
            mode={mode}
            space={mode === 'translate' ? 'world' : 'local'}
            size={0.8}
            showY={showY}
            onMouseDown={() => { gizmoBusy.current = Infinity; }}
            onMouseUp={() => { gizmoBusy.current = performance.now(); }}
            onObjectChange={onGizmoChange}
          />
        )}
        {settings.showHandles && active && activeDoc && !activeDoc.proxy && (
          <IKHandles
            key={`${activeDoc.id}:${version}`}
            m={active}
            figure={activeDoc}
            limits={settings.limits}
            onCommit={(read) => store.updateFigure(activeDoc.id, (f) => ({ ...f, ...read }), 'ik')}
          />
        )}
        {settings.showHandles && (
          <FigureMarkers
            sv={sv}
            scene={scene}
            version={version}
            active={selection?.kind === 'prop' || selection?.kind === 'shot' ? null : activeFigure}
            onPick={(id) => store.select({ kind: 'figure', figure: id })}
            onTurn={(id, read) => { store.select({ kind: 'figure', figure: id }); store.updateFigure(id, (f) => ({ ...f, ...read })); }}
          />
        )}
        {!shotMode && <SeeThrough sv={sv} figureId={selection?.kind === 'joint' || selection?.kind === 'figure' ? selection.figure : activeFigure} />}
        {settings.showHandles && !shotMode && scene.animation && activeFigure && scene.figures.some((f) => f.id === activeFigure && !f.hidden) && (
          <RouteOverlay store={store} scene={scene} figureId={activeFigure} time={time} />
        )}
        {settings.showHandles && !shotMode && scene.animation?.constraints && <HoldPins sv={sv} scene={scene} time={time} />}
        {settings.showHandles && selection?.kind === 'prop' && !scene.props.find((p) => p.id === selection.prop)?.hold && (
          <PropRing
            sv={sv}
            id={selection.prop}
            version={version}
            onTurn={() => {
              const p = sv.props.get(selection.prop);
              if (p) store.updateProp(selection.prop, (doc) => ({ ...doc, ...p.read() }));
            }}
          />
        )}
        <OrbitControls makeDefault onChange={keepCameraAboveFloor} />
        {scene.animation && <Playback sv={sv} scene={scene} clock={clock} />}
        {scene.animation && onion && <OnionSkin scene={scene} time={time} clock={clock} />}
        <ShotDriver store={store} scene={scene} clock={clock} time={time} enabled={shotMode} captureRef={captureRef} />
        {settings.showHandles && !shotMode && !!scene.animation?.shots?.some((x) => x.points.length) && (
          <CameraRig store={store} scene={scene} clock={clock} time={time} selection={selection} />
        )}
        <Bridge
          sv={sv}
          apiRef={apiRef}
          frameRequest={frameRequest}
          sceneId={scene.id}
          sceneView={scene.view}
          shotMode={shotMode}
          capture={() => captureRef.current?.() ?? null}
        />
        <LineArtRenderer sv={sv} lineWidth={settings.editorLine} style={settings.style} />
      </Canvas>
    </div>
  );
}

/** The shared key light + shadow floor, re-aimed when the scene or light changes. */
function Lights({ sv, settings, scene }: { sv: SceneView; settings: Settings; scene: Scene }) {
  const rig = useMemo(() => new LightRig(), []);
  const stale = useRef(true);
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => { stale.current = true; }, [scene, scene.light, settings.style]);
  // Aim at render time, after the scene has been synced.
  useFrame(() => {
    if (!stale.current) return;
    stale.current = false;
    sv.ink.setLightDirection(rig.update(scene.light ?? DEFAULT_LIGHT, settings.style, sv.bounds()));
  });
  return <primitive object={rig.object} />;
}

/** While playing, pose the figures for the clock's time on every frame (without touching the document). */
function Playback({ sv, scene, clock }: { sv: SceneView; scene: Scene; clock: Clock }) {
  useFrame(() => {
    if (clock.playing) sv.sync(sceneAt(scene, clock.time));
  }, -2);
  return null;
}

/** Translucent ghosts of the previous (blue) and next (orange) keyframes. */
function OnionSkin({ scene, time, clock }: { scene: Scene; time: number; clock: Clock }) {
  const views = useMemo(() => [
    new SceneView({ color: '#3b6cff', opacity: 0.1 }),
    new SceneView({ color: '#f97316', opacity: 0.1 }),
  ], []);
  const size = useThree((s) => s.size);
  const has = useRef([false, false]);
  useEffect(() => () => views.forEach((v) => v.dispose()), [views]);
  useEffect(() => {
    for (const v of views) {
      v.ink.setResolution(size.width, size.height);
      v.ink.setThickness(1.3);
    }
  }, [views, size]);
  useLayoutEffect(() => {
    const a = scene.animation!;
    const tol = 0.5 / a.fps;
    const keys = moments(a);
    let prev = [...keys].reverse().find((t) => t < time - tol);
    let next = keys.find((t) => t > time + tol);
    if (a.loop && keys.length > 1) {
      prev ??= keys[keys.length - 1];
      next ??= keys[0];
    }
    [prev, next].forEach((t, i) => {
      has.current[i] = t !== undefined && Math.abs(t - time) >= tol;
      if (t !== undefined) views[i].sync({ ...sceneAt(scene, t), props: [] });
    });
  }, [scene, time, views]);
  useFrame(() => {
    views.forEach((v, i) => { v.root.visible = has.current[i] && !clock.playing; });
  });
  return <>{views.map((v, i) => <primitive key={i} object={v.root} />)}</>;
}

/**
 * Look through the shot camera: follow it while playing or scrubbing. In between, the view can be
 * orbited, panned and dollied freely: letting go sets the shot's camera point at the playhead
 * (through the lens, as posing sets a figure's key).
 */
function ShotDriver({ store, scene, clock, time, enabled, captureRef }: {
  store: Store;
  scene: Scene;
  clock: Clock;
  time: number;
  enabled: boolean;
  captureRef: RefObject<(() => CameraView | null) | null>;
}) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const dirty = useRef(true);
  useEffect(() => { dirty.current = true; }, [time, scene, enabled, size]);

  const stageAspect = size.width / Math.max(1, size.height);
  const aspect = frameAspect(scene);
  /** Vertical lens for the editor so the letterbox (the shot's frame) shows exactly the shot (and back). */
  const widen = (fov: number, k: number) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * k));
  const displayFov = (fov: number) => (stageAspect < aspect ? widen(fov, aspect / stageAspect) : fov);

  useEffect(() => {
    captureRef.current = () => {
      const { camera, controls } = get() as unknown as { camera: THREE.PerspectiveCamera; controls: Controls };
      if (!controls) return null;
      const fov = enabled && stageAspect < aspect ? widen(camera.fov, stageAspect / aspect) : camera.fov;
      return { position: camera.position.clone(), target: controls.target.clone(), fov, lens: fovLens(fov, aspect), roll: 0 };
    };
  });

  // Through the lens: a change of view, once let go of, is the camera point at the playhead.
  useEffect(() => {
    const controls = get().controls as unknown as { addEventListener(type: 'end', f: () => void): void; removeEventListener(type: 'end', f: () => void): void } | null;
    if (!enabled || !controls || !scene.animation) return;
    const end = () => {
      if (clock.playing) return;
      const v = captureRef.current?.();
      if (v) setCameraPoint(store, v.position, v.target, v.fov);
    };
    controls.addEventListener('end', end);
    return () => controls.removeEventListener('end', end);
  }, [enabled, get, store, clock, captureRef, scene.animation]);

  useFrame((state) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const controls = state.controls as unknown as Controls;
    if (!enabled || !controls) return;
    if (!clock.playing && !dirty.current) return;
    dirty.current = false;
    const view = cameraAt(scene, clock.playing ? clock.time : time);
    placeCamera(camera, { ...view, fov: displayFov(view.fov) }, stageAspect);
    controls.target.copy(view.target);
    controls.update();
  }, -1);
  return null;
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

function Bridge({ sv, apiRef, frameRequest, sceneId, sceneView, shotMode, capture }: {
  sv: SceneView;
  apiRef: Props['apiRef'];
  frameRequest: FrameRequest;
  sceneId: string;
  sceneView: View;
  shotMode: boolean;
  capture(): CameraView | null;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as Controls;
  const gl = useThree((s) => s.gl);
  const latestView = useRef(sceneView);
  useEffect(() => { latestView.current = sceneView; }, [sceneView]);

  const captureRef = useRef(capture);
  useEffect(() => { captureRef.current = capture; });

  useEffect(() => {
    const toScreen = (v: THREE.Vector3) => {
      const p = v.project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    };
    apiRef.current = {
      getView: () => viewFromCamera(camera, controls?.target ?? new THREE.Vector3(0, 1, 0)),
      rootPosition: (id) => sv.figures.get(id)?.read().position ?? null,
      project: (id, joint) => {
        const m = sv.figures.get(id);
        return m ? toScreen(m.joints[joint].getWorldPosition(new THREE.Vector3())) : null;
      },
      projectPoint: (p) => toScreen(new THREE.Vector3(...p)),
      captureShot: () => captureRef.current(),
      pick: (x, y) => {
        const r = gl.domElement.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
        const hit: CanvasHit = {};
        const floor = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
        if (floor) hit.floor = [floor.x, 0, floor.z];
        for (const { object } of ray.intersectObject(sv.root, true)) {
          let o: THREE.Object3D | null = object;
          let shown = true;
          for (let p: THREE.Object3D | null = o; p; p = p.parent) shown &&= p.visible;
          if (!shown) continue;
          while (o && !o.userData.figure && !o.userData.prop) o = o.parent;
          if (o?.userData.prop && sv.props.get(o.userData.prop as string)?.parts.faded) continue;
          if (o?.userData.prop) return { ...hit, prop: o.userData.prop as string };
          if (o?.userData.figure) return { ...hit, figure: o.userData.figure as string };
        }
        return hit;
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

  // Switching to another pose shows it from its export angle (the shot camera takes over in shot mode).
  const shotRef = useRef(shotMode);
  useEffect(() => { shotRef.current = shotMode; }, [shotMode]);
  useEffect(() => {
    if (shotRef.current) return;
    const id = frame({ ...latestView.current, fov: 35 });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, controls]);

  // Leaving shot mode returns to the normal editor lens.
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (shotMode) return;
    const cam = get().camera as THREE.PerspectiveCamera;
    cam.fov = 35;
    cam.updateProjectionMatrix();
  }, [shotMode, get]);

  useEffect(() => {
    if (frameRequest.n === 0) return;
    const id = frame(frameRequest.view);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest]);

  return null;
}

/**
 * The shot cameras' paths through the set (one line per shot), a camera at each point of them and,
 * for a shot looking at a point, that point. Drag a camera to move it across the floor (Shift: up
 * and down), a look point to aim the camera; double-click a path to add a point there; right-click
 * a camera to delete it.
 */
/** Each drag of a camera is one undo step. */
let drags = 0;

function CameraRig({ store, scene, clock, time, selection }: { store: Store; scene: Scene; clock: Clock; time: number; selection: Selection }) {
  const a = scene.animation!;
  const get = useThree((s) => s.get);
  const dot = useRef<THREE.Mesh>(null);
  const [cam] = useState(() => new THREE.PerspectiveCamera(30, frameAspect(scene)));
  // The paths and cameras only depend on the shots and the motion, not on the playhead.
  const spans = useMemo(() => shotSpans(a), [a]);
  // (Worked out again when the animation changes, not as the playhead moves the figures.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const paths = useMemo(() => spans.map((span) => (span.shot.points.length ? shotPath(scene, span) : [])), [spans]);
  const markers = useMemo(() => spans.flatMap((span) => span.shot.points.map((p) => {
    const t = span.start + p.t;
    const view = cameraAt(scene, t);
    placeCamera(cam, view, frameAspect(scene));
    return { t, span, position: cam.position.clone(), quaternion: cam.quaternion.clone(), target: view.target.clone(), aimed: span.shot.aim === 'point' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [spans, cam]);
  const lastDot = useRef(NaN);
  useEffect(() => { lastDot.current = NaN; }, [paths]);

  const glyphs = useRef<(THREE.Object3D | null)[]>([]);
  useFrame((state) => {
    // Keep the cameras a constant size on screen, however far they are.
    const scale = (o: THREE.Object3D, k = 0.12) => {
      const d = state.camera.position.distanceTo(o.position);
      o.visible = d > 0.3;
      o.scale.setScalar(d * k);
    };
    for (const g of glyphs.current) if (g) scale(g, g.userData.look ? 0.03 : 0.12);
    // The playhead's camera position (placed again only when the time changes).
    if (!dot.current) return;
    const t = clock.playing ? clock.time : time;
    if (t !== lastDot.current) {
      lastDot.current = t;
      dot.current.position.copy(cameraAt(scene, t).position);
    }
    scale(dot.current);
  });

  /** Follow the pointer across a plane through `from` (level, or upright facing the view with Shift). */
  const dragOn = (e: ThreeEvent<PointerEvent>, from: THREE.Vector3, t: number, apply: (p: THREE.Vector3, key: string) => void) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    clock.pause();
    store.setTime(t);
    const controls = get().controls as unknown as Controls;
    if (controls) controls.enabled = false;
    const canvas = get().gl.domElement;
    canvas.setPointerCapture(e.pointerId);
    const view = get().camera;
    const upright = e.nativeEvent.shiftKey;
    const normal = upright ? view.getWorldDirection(new THREE.Vector3()).setY(0).normalize() : new THREE.Vector3(0, 1, 0);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, from);
    const hit = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    const key = `camdrag:${t}:${drags++}`;
    const move = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), view);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      // Level: across the floor at its height; upright: only up and down.
      const to = upright ? new THREE.Vector3(from.x, Math.max(0.05, hit.y), from.z) : new THREE.Vector3(hit.x, from.y, hit.z);
      apply(to, key);
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      if (controls) controls.enabled = true;
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  };

  /** A double-click on a shot's path: a point there, the camera as it is then. */
  const addPoint = (span: ShotSpan) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const n = Math.max(2, Math.ceil((span.end - span.start) * 10));
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e as unknown as { faceIndex?: number }).faceIndex ?? 0))));
    const t = Math.round((span.start + ((span.end - span.start) * (i + 0.5)) / n) * a.fps) / a.fps;
    store.setTime(t);
    const view = cameraAt(store.scene, t);
    setCameraPoint(store, view.position, view.target, view.fov);
  };

  const now = clock.playing ? clock.time : time;
  const picked = selection?.kind === 'shot' ? selection.shot : null;
  let n = 0;
  return (
    <group>
      {paths.map((pts, i) => pts.length > 1 && (
        <Line key={i} points={pts} color="#3b6cff" lineWidth={spans[i].shot.id === picked ? 3 : 1.5} transparent opacity={0.7} onDoubleClick={addPoint(spans[i])} />
      ))}
      {markers.map((m) => {
        const on = Math.abs(m.t - now) < 0.5 / a.fps;
        const color = on ? '#3b6cff' : '#27272a';
        const k = n++;
        const l = m.aimed ? n++ : -1;
        return (
          <group key={`${m.span.shot.id}:${m.t}`}>
            <group
              ref={(g) => { glyphs.current[k] = g; }}
              position={m.position}
              quaternion={m.quaternion}
              onPointerDown={(e) => dragOn(e, m.position, m.t, (p, key) => moveCameraPoint(store, m.t, p, key))}
              onContextMenu={(e) => {
                e.stopPropagation();
                openContextMenu(e.nativeEvent, [{ label: 'Delete camera point', icon: Trash2, danger: true, onSelect: () => deleteCameraPoint(store, m.t) }], `${m.span.shot.name} · ${m.t.toFixed(2)} s`);
              }}
            >
              {/* A small camera: body and lens, looking down its −Z axis. */}
              <mesh>
                <boxGeometry args={[0.14, 0.1, 0.12]} />
                <meshBasicMaterial color={color} />
              </mesh>
              <mesh position={[0, 0, -0.1]} rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.06, 0.09, 12, 1, true]} />
                <meshBasicMaterial color={color} side={THREE.DoubleSide} />
              </mesh>
            </group>
            {m.aimed && (
              <>
                <Line points={[m.position, m.target]} color="#3b6cff" lineWidth={1} dashed dashSize={0.1} gapSize={0.08} transparent opacity={0.5} />
                <mesh
                  ref={(g) => { glyphs.current[l] = g; if (g) g.userData.look = true; }}
                  position={m.target}
                  onPointerDown={(e) => dragOn(e, m.target, m.t, (p, key) => moveCameraLook(store, m.t, p, key))}
                >
                  <sphereGeometry args={[1, 14, 10]} />
                  <meshBasicMaterial color={on ? '#3b6cff' : '#60616a'} />
                </mesh>
              </>
            )}
          </group>
        );
      })}
      <mesh ref={dot}>
        <sphereGeometry args={[0.035, 16, 12]} />
        <meshBasicMaterial color="#e5484d" />
      </mesh>
    </group>
  );
}
