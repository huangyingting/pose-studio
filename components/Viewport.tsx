'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Line, OrbitControls, TransformControls } from '@react-three/drei';
import { editCameraKey } from '@/lib/actions';
import { sceneAt } from '@/lib/evaluate';
import { moments } from '@/lib/track';
import { DEFAULT_LIGHT, LightRig } from '@/lib/lighting';
import { LineArtPass } from '@/lib/lineart';
import { fitCamera, viewFromCamera } from '@/lib/render';
import { SceneView } from '@/lib/sceneview';
import { SHOT_ASPECT, captureShot, figuresCenter, placeShot, shotAt, shotFramer, subjectAt, type Framing } from '@/lib/shot';

/** The framing for whatever shot plays at a time (lib/shot.ts shotFramer). */
type Framer = (t: number) => Framing;
import { shotSpans } from '@/lib/shots';
import { styleDef } from '@/lib/styles';
import type { Settings, Store } from '@/lib/store';
import type { CameraKey, JointName, Scene, Selection, Style, Vec3, View } from '@/lib/types';
import type { Clock } from './clock';
import { FigureMarkers, IKHandles, PropRing, RouteOverlay, SceneObjects, SeeThrough } from './Manipulators';

export interface ViewportApi {
  /** Current editor camera as a View (for "use current view"). */
  getView(): View;
  /** Where a figure's pelvis currently is (including auto-grounding). */
  rootPosition(figure: string): Vec3 | null;
  /** Screen (client) coordinates of a joint, for tests and tooling. */
  project(figure: string, joint: JointName): { x: number; y: number } | null;
  /** Screen (client) coordinates of a world point. */
  projectPoint(p: Vec3): { x: number; y: number };
  /** The shot (camera key) that reproduces the current view. */
  captureShot(): Omit<CameraKey, 't'> | null;
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
  const captureRef = useRef<(() => Omit<CameraKey, 't'> | null) | null>(null);
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
  useLayoutEffect(() => sv.setFaces(settings.faces), [sv, settings.faces]);
  useEffect(() => () => sv.dispose(), [sv]);

  const figureDoc = (id: string) => scene.figures.find((f) => f.id === id);
  // What the shot camera frames: the figures over the animation (camera keys do not change it).
  // Only needed to look through the shot camera or to show its path; computed after edits settle.
  const anim = scene.animation;
  const needFrame = shotMode || (settings.showHandles && !!anim?.camera?.keys.length);
  const [framed, setFramed] = useState<{ id: string; frame: Framer } | null>(null);
  const frame = framed?.id === scene.id ? framed.frame : null;
  const sceneRef = useRef(scene);
  useLayoutEffect(() => { sceneRef.current = scene; });
  const hasFrame = !!frame;
  useEffect(() => {
    if (!needFrame) return;
    const id = setTimeout(() => setFramed({ id: sceneRef.current.id, frame: shotFramer(sceneRef.current) }), hasFrame ? 250 : 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim?.actions, anim?.duration, anim?.loop, scene.figures, scene.id, needFrame]);

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
        <ShotDriver sv={sv} scene={scene} frame={needFrame ? frame : null} clock={clock} time={time} enabled={shotMode} captureRef={captureRef} />
        {frame && settings.showHandles && !shotMode && !!scene.animation?.camera?.keys.length && (
          <CameraRig store={store} scene={scene} frame={frame} clock={clock} time={time} />
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
 * Look through the shot camera: follow the camera track while playing or scrubbing. In between,
 * the view can be orbited freely to compose the next camera key.
 */
function ShotDriver({ sv, scene, frame, clock, time, enabled, captureRef }: {
  sv: SceneView;
  scene: Scene;
  frame: Framer | null;
  clock: Clock;
  time: number;
  enabled: boolean;
  captureRef: RefObject<(() => Omit<CameraKey, 't'> | null) | null>;
}) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const dirty = useRef(true);
  useEffect(() => { dirty.current = true; }, [time, scene, enabled, size, frame]);

  const stageAspect = size.width / Math.max(1, size.height);
  /** Vertical lens for the editor so the 16:9 letterbox shows exactly the shot. */
  const displayFov = (fov: number) =>
    stageAspect < SHOT_ASPECT ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * (SHOT_ASPECT / stageAspect))) : fov;

  useEffect(() => {
    captureRef.current = () => {
      const { camera, controls } = get() as unknown as { camera: THREE.PerspectiveCamera; controls: Controls };
      if (!controls) return null;
      const cam = camera.clone();
      if (enabled && stageAspect < SHOT_ASPECT) {
        cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (stageAspect / SHOT_ASPECT)));
      }
      const follow = scene.animation?.camera?.follow ? figuresCenter(sv, subjectAt(scene, time)) : null;
      return captureShot(cam, controls.target, (frame ?? shotFramer(scene))(time), SHOT_ASPECT, follow);
    };
  });

  useFrame((state) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const controls = state.controls as unknown as Controls;
    if (!enabled || !controls || !frame) return;
    if (!clock.playing && !dirty.current) return;
    dirty.current = false;
    const t = clock.playing ? clock.time : time;
    const shot = shotAt(scene, t);
    const track = scene.animation?.camera;
    const target = placeShot(camera, frame(t), shot, SHOT_ASPECT, { follow: track?.follow ? figuresCenter(sv, subjectAt(scene, t)) : null, shake: track?.shake, t });
    camera.aspect = stageAspect;
    camera.fov = displayFov(shot.fov);
    camera.updateProjectionMatrix();
    controls.target.copy(target);
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
  capture(): Omit<CameraKey, 't'> | null;
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
 * The shot camera's path through the set (one line per shot) and a camera at each key. Drag a
 * camera around the figures to change that key: its direction sets the angle, its distance the zoom.
 */
function CameraRig({ store, scene, frame, clock, time }: { store: Store; scene: Scene; frame: Framer; clock: Clock; time: number }) {
  const a = scene.animation!;
  const keys = a.camera!.keys;
  const get = useThree((s) => s.get);
  const dot = useRef<THREE.Mesh>(null);
  const [cam] = useState(() => new THREE.PerspectiveCamera(30, SHOT_ASPECT));
  // The path only depends on the camera track (not on the playhead or the poses).
  const track = a.camera;
  const paths = useMemo(() => {
    const s = { ...scene, animation: a };
    return shotSpans(a).map((span) => {
      const n = Math.max(2, Math.ceil((span.end - span.start) * 10));
      return Array.from({ length: n + 1 }, (_, i) => {
        const at = Math.min(span.end - 1e-3, span.start + ((span.end - span.start) * i) / n);
        placeShot(cam, frame(at), shotAt(s, at), SHOT_ASPECT);
        return cam.position.clone();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, a.shots, a.duration, a.loop, frame, cam]);
  const lastDot = useRef(NaN);
  useEffect(() => { lastDot.current = NaN; }, [paths]);
  const markers = useMemo(() => keys.map((k) => {
    const target = placeShot(cam, frame(k.t), k, SHOT_ASPECT);
    return { key: k, position: cam.position.clone(), quaternion: cam.quaternion.clone(), target };
  }), [keys, frame, cam]);

  const glyphs = useRef<(THREE.Group | null)[]>([]);
  useFrame((state) => {
    // Keep the cameras a constant size on screen, however far they are.
    const scale = (o: THREE.Object3D) => {
      const d = state.camera.position.distanceTo(o.position);
      // Proportional to the distance: the same size on screen however near or far.
      o.visible = d > 0.3;
      o.scale.setScalar(d * 0.12);
    };
    for (const g of glyphs.current) if (g) scale(g);
    // The playhead's camera position (placed again only when the time changes).
    if (!dot.current) return;
    const t = clock.playing ? clock.time : time;
    if (t !== lastDot.current) {
      lastDot.current = t;
      placeShot(cam, frame(t), shotAt(scene, t), SHOT_ASPECT);
      dot.current.position.copy(cam.position);
    }
    scale(dot.current);
  });

  const drag = (m: (typeof markers)[number]) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    clock.pause();
    store.setTime(m.key.t);
    const controls = get().controls as unknown as Controls;
    if (controls) controls.enabled = false;
    const canvas = get().gl.domElement;
    canvas.setPointerCapture(e.pointerId);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -m.position.y);
    const hit = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    const pitch = THREE.MathUtils.degToRad(m.key.pitch);
    const id = `camdrag:${m.key.t}:${performance.now()}`;
    const move = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), get().camera);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      const d = hit.clone().sub(m.target);
      const flat = Math.hypot(d.x, d.z);
      if (flat < 0.2) return;
      const yaw = Math.round(THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z)) * 10) / 10;
      // Distance at zoom 1 for this angle, then the zoom that puts the camera under the pointer.
      const t1 = placeShot(cam, frame(m.key.t), { ...m.key, yaw, zoom: 1 }, SHOT_ASPECT);
      const fit = cam.position.distanceTo(t1);
      const zoom = Math.round(THREE.MathUtils.clamp(fit / (flat / Math.max(0.2, Math.cos(pitch))), 0.2, 6) * 100) / 100;
      editCameraKey(store, m.key.t, { yaw, zoom }, id);
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      if (controls) controls.enabled = true;
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  };

  const now = clock.playing ? clock.time : time;
  return (
    <group>
      {paths.map((pts, i) => <Line key={i} points={pts} color="#3b6cff" lineWidth={1.5} transparent opacity={0.7} />)}
      {markers.map((m, i) => {
        const on = Math.abs(m.key.t - now) < 0.5 / a.fps;
        return (
          <group key={m.key.t} ref={(g) => { glyphs.current[i] = g; }} position={m.position} quaternion={m.quaternion} onPointerDown={drag(m)}>
            {/* A small camera: body and lens, looking down its −Z axis. */}
            <mesh>
              <boxGeometry args={[0.14, 0.1, 0.12]} />
              <meshBasicMaterial color={on ? '#3b6cff' : '#27272a'} />
            </mesh>
            <mesh position={[0, 0, -0.1]} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.06, 0.09, 12, 1, true]} />
              <meshBasicMaterial color={on ? '#3b6cff' : '#27272a'} side={THREE.DoubleSide} />
            </mesh>
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
