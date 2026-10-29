'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import { TransformControls as TransformControlsImpl } from 'three-stdlib';
import { Line } from './Line';
import { useSettled } from './useSettled';
import { addCameraPoint, editLight, moveCameraLook, moveCameraPoint, setCameraPoint, toggleSelected } from '@/lib/actions';
import { angle } from '@/lib/pose';
import { sceneAt } from '@/lib/evaluate';
import { moments } from '@/lib/track';
import { LightRig, keyLight, lampAt, lightDome, lightFrom, lightingOf } from '@/lib/lighting';
import { LineArtPass } from '@/lib/lineart';
import { fitCamera, viewFromCamera } from '@/lib/render';
import { onModels } from '@/lib/model';
import { awake, setDrawer, wake } from './frames';
import { LINES_LAYER } from '@/lib/ink';
import { SceneView } from '@/lib/sceneview';
import { angleAt, cameraAt, cameraById, trailTimes, fovLens, frameAspect, liveCamera, placeCamera, viewOf, type CameraView } from '@/lib/cameras';
import { styleDef } from '@/lib/styles';
import type { Settings, Store, Through } from '@/lib/store';
import type { Figure, JointName, Lighting, Scene, Selection, Style, Vec3, View } from '@/lib/types';
import type { Clock } from './clock';
import { FigureMarkers, HoldPins, PropRing, RouteOverlay, SceneObjects, SeeThrough, nearestContact, nearestText, partUnder } from './Manipulators';
import type { Contact } from '@/lib/relations';
import TurnButtons from './TurnButtons';
import JointCard from './JointCard';
import CameraHandles, { stepRig } from './CameraHandles';
import LightHandles from './LightHandles';
import { STEPS, snapping } from './modifiers';
import { useProjectSettings, useStudio } from './store-context';
import { dragged, endDrag } from './dragdrop';
import { cameraHint, metres, movedText, setCanvasPointer, setPointerHint, setReadout, useHoverGhost, useReadout } from './hints';
import type { Placing } from './placing';

export interface ViewportApi {
  /** Current editor camera as a View (for "use current view"). */
  getView(): View;
  /** The editor camera as it stands, to make a scene camera from. */
  editorCamera(): CameraView;
  /** Where a figure's pelvis currently is (including auto-grounding). */
  rootPosition(figure: string): Vec3 | null;
  /** Screen (client) coordinates of a joint (null: not drawn, or behind the view), for the joint's card, tests and tooling. */
  project(figure: string, joint: JointName): { x: number; y: number } | null;
  /** Screen (client) coordinates of a world point. */
  projectPoint(p: Vec3): { x: number; y: number };
  /** The camera of the current view (looking through the shot camera: as the shot frames it). */
  captureShot(): CameraView | null;
  /** What is under a screen point: a figure or prop, and the floor point there. */
  pick(x: number, y: number): CanvasHit;
  /** Where on screen to label what is selected: just above it (a joint: above its figure, clear of its gizmo). Null if it is not drawn. */
  labelPoint(sel: NonNullable<Selection>): { x: number; y: number } | null;
  /** What turns the selection on screen: a figure's or prop's floor ring (its middle and half its width, px), a camera or the lamp (no width). */
  ringOnScreen(sel: NonNullable<Selection>): { x: number; y: number; r: number } | null;
}

/** What is under a point of the canvas: a figure, a prop, a camera (and which of its path points), the floor. */
/** What is under a point of the canvas: a figure (and the point of its body a hand would hold), a prop, a camera (and its path's point), the floor there. */
export type CanvasHit = { figure?: string; contact?: Contact; prop?: string; camera?: string; point?: number; floor?: Vec3; light?: string };

export interface FrameRequest {
  view: Pick<View, 'yaw' | 'pitch'> & { fov?: number };
  n: number;
  /** Only these figures or props (the selection), or 'light' (the scene and its lamp), not everything. */
  only?: string | string[];
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
  /** Looking through the cut or one camera (the editor's own view: null). */
  through: Through;
  onion: boolean;
  /** Right-click on the canvas (not after a drag). */
  onMenu(e: { clientX: number; clientY: number }, hit: CanvasHit): void;
  /** A pick mode: the next click (not a drag) on the canvas goes here, whatever is under it. */
  onPick?: ((hit: CanvasHit) => void) | null;
  /** Placing something new: its ghost follows the pointer. */
  placing?: Placing | null;
}

type Controls = { target: THREE.Vector3; enabled: boolean; update(): void } | null;

/** The floor is solid: the view can look up from near it, never from under it. */
function keepCameraAboveFloor(e?: { target: { object: THREE.Camera } }) {
  const camera = e?.target.object;
  if (camera && camera.position.y < 0.03) camera.position.setY(0.03);
}

export default function Viewport({
  store, scene, selection, activeFigure, settings, frameRequest, apiRef, clock, time, through, onion, onMenu, onPick, placing,
}: Props) {
  const captureRef = useRef<(() => CameraView | null) | null>(null);
  const look = useProjectSettings();
  const shotMode = !!through;
  const rigRef = useRef<THREE.Group>(null);
  const sv = useMemo(() => new SceneView(), []);
  // Re-render when sync() replaces three.js objects, so the gizmo/handles get the new joints.
  const version = useSyncExternalStore(sv.subscribe, sv.getVersion, sv.getVersion);
  const gizmoBusy = useRef(0);
  const gizmo = useRef<TransformControlsImpl>(null);
  const gizmoFrom = useRef<THREE.Vector3 | null>(null);
  // Ctrl (Cmd) held: the gizmo snaps.
  const [snapKey, setSnapKey] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => setSnapKey(snapping(e));
    const blur = () => setSnapKey(false);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur); };
  }, []);
  const downAt = useRef<[number, number]>([0, 0]);
  const pickedAt = useRef(0);
  const lastTap = useRef<{ figure?: string; t: number }>({ t: 0 });
  // (The pointer the last press was made with: a click event does not say in every browser.)
  const downType = useRef('mouse');
  const longPress = useRef(0);

  // Characters' files are read after the first frame: drawn as them once they are.
  const [models, setModels] = useState(0);
  useEffect(() => onModels(() => setModels((n) => n + 1)), []);
  useLayoutEffect(() => {
    sv.sync(scene);
  }, [sv, scene, models]);
  // Through the shot camera the picture is shown as filmed: no selection, no handles.
  useLayoutEffect(() => sv.setSelection(shotMode ? null : selection), [sv, selection, scene, shotMode]);
  // The figure or prop whose outline row the pointer rests on: outlined as a whole.
  const linked = useStudio((st) => st.linked);
  useLayoutEffect(() => sv.setLinked(shotMode ? null : linked), [sv, linked, scene, shotMode]);
  useLayoutEffect(() => sv.setStyle(look.style), [sv, look.style]);
  useEffect(() => () => sv.dispose(), [sv]);

  const figureDoc = (id: string) => scene.figures.find((f) => f.id === id);
  // What ⟲ ⟳ turn: a figure, a prop not in a hand, a rig camera, the light.
  const turnable = !!selection && (selection.kind === 'figure' || selection.kind === 'light'
    || (selection.kind === 'prop' && !scene.props.find((p) => p.id === selection.prop)?.hold)
    || (selection.kind === 'camera' && scene.cameras.find((c) => c.id === selection.camera)?.kind === 'rig'));
  const ringOnScreen = useCallback(() => (selection ? apiRef.current?.ringOnScreen(selection) ?? null : null), [selection, apiRef]);
  // The joint on screen, and the side away from the body's middle (where its card goes, clear of the body).
  const jointOnScreen = useCallback(() => {
    if (selection?.kind !== 'joint') return null;
    const at = apiRef.current?.project(selection.figure, selection.joint);
    const middle = apiRef.current?.project(selection.figure, 'chest');
    // (A joint on the body's middle: the card goes clear of the arms too.)
    const gap = at && middle && Math.abs(at.x - middle.x) < 30 ? 110 : 28;
    return at ? { ...at, side: middle && at.x < middle.x - 1 ? -1 : 1, gap } : null;
  }, [selection, apiRef]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // that was an orbit drag, not a click
    // (The light's lamp, drawn over the body, takes the click.)
    if (e.intersections.some((i) => i.object.userData.lamp)) return;
    // (The click that picked something: what was selected stays so.)
    if (performance.now() - pickedAt.current < 300) { e.stopPropagation(); return; }
    // Alt-click: light that point from where the view is.
    if (e.nativeEvent.altKey) {
      e.stopPropagation();
      // (The light selected, or the key light.)
      const lighting = lightingOf(scene);
      const l = (selection?.kind === 'light' && lighting.lights.find((x) => x.id === selection.light)) || keyLight(lighting)!;
      editLight(store, l.id, lightFrom(l, e.camera.position.clone().sub(e.point)));
      return;
    }
    // (A see-through prop, in front of the figure being edited, lets the click through.)
    const o = partUnder(e.intersections, (x) => !(x.userData.prop && sv.props.get(x.userData.prop as string)?.parts.faded));
    if (!o) return;
    e.stopPropagation();
    // A second tap on the same figure soon after (touch has no double-click on the canvas): all of it.
    const now = performance.now();
    const touch = downType.current === 'touch';
    const twice = touch && o.userData.figure && lastTap.current.figure === o.userData.figure && now - lastTap.current.t < 350;
    lastTap.current = { figure: o.userData.figure as string | undefined, t: twice ? 0 : now };
    if (twice && !e.nativeEvent.shiftKey) {
      store.select({ kind: 'figure', figure: o.userData.figure as string, whole: true });
      return;
    }
    // Shift-click: add it to what is selected (a figure as a whole), or take it away.
    if (e.nativeEvent.shiftKey) {
      toggleSelected(store, o.userData.prop ? { prop: o.userData.prop as string } : { figure: o.userData.figure as string });
      return;
    }
    if (o.userData.prop) store.select({ kind: 'prop', prop: o.userData.prop as string });
    else if (figureDoc(o.userData.figure as string)?.proxy) {
      // Stand-ins are placed, not posed: a click picks the whole figure.
      store.select({ kind: 'figure', figure: o.userData.figure as string });
    } else store.select({ kind: 'joint', figure: o.userData.figure as string, joint: o.userData.joint as JointName });
  };
  /** A double-click on a figure: all of it (it moves when dragged; Y, X or Z with ← → turn and lean it). */
  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || e.nativeEvent.shiftKey || e.nativeEvent.altKey) return;
    // (The lamp drawn over the body, and a click that picked something, keep their selection.)
    if (e.intersections.some((i) => i.object.userData.lamp) || performance.now() - pickedAt.current < 600) return;
    let o: THREE.Object3D | null = e.object;
    while (o && !o.userData.joint && !o.userData.prop) o = o.parent;
    if (!o?.userData.figure) return;
    e.stopPropagation();
    store.select({ kind: 'figure', figure: o.userData.figure as string, whole: true });
  };

  // The gizmo: a selected prop's, or a figure's picked as a whole (a double-click), moves it (also up
  // and down; R scales a prop). Joints are posed by dragging the body (Ctrl: 5° steps; Shift-drag
  // twists), by the selected joint's card and the inspector's sliders; figures and props turn by
  // their floor ring.
  const handles = settings.showHandles && !shotMode;
  // (A finger needs a bigger gizmo.)
  const [coarse] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
  // A scene is first shown from where its camera films it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const openAngle = useMemo(() => angleAt(scene, 0), [scene.id]);
  let target: THREE.Object3D | null = null;
  let mode: 'translate' | 'scale' = 'translate';
  // The gizmo's size in the world (metres: a move arrow's length).
  let gizmoWorld = 0.45;
  let showY = true;
  let onGizmoChange = () => {};
  // The readout of a gizmo drag, from where its object was when the drag began.
  let readout: (from: THREE.Vector3) => void = () => {};
  // A figure picked as a whole (a double-click), or a stand-in: its Move gizmo (also up and down).
  const gizmoFigure = selection?.kind === 'figure' && (selection.whole || figureDoc(selection.figure)?.proxy) ? selection.figure : null;
  if (gizmoFigure) {
    const m = sv.figures.get(gizmoFigure);
    const doc = figureDoc(gizmoFigure);
    if (m && doc) {
      target = m.joints.hips;
      gizmoWorld = 0.45 * (doc.body.height / 1.8);
      showY = !doc.grounded;
      onGizmoChange = () => store.updateFigure(doc.id, (f) => ({ ...f, ...m.read() }), `gizmo:${doc.id}`);
      readout = (p) => {
        const r = m.joints.hips.position;
        setReadout(movedText(r.x - p.x, r.z - p.z, r.x, r.z) + nearestText(sv, scene, doc.id, r) + (doc.grounded ? '' : ` · ${metres(r.y)} m high`));
      };
    }
  } else if (selection?.kind === 'prop') {
    const p = sv.props.get(selection.prop);
    if (p) {
      target = p.object;
      mode = settings.gizmo;
      const box = new THREE.Box3().setFromObject(p.object).getSize(new THREE.Vector3());
      gizmoWorld = Math.max(0.25, Math.max(box.x, box.z) * 0.6 + 0.1);
      const id = selection.prop;
      onGizmoChange = () => store.updateProp(id, (doc) => ({ ...doc, ...p.read() }), `gizmo:${id}`);
      readout = (from) => {
        const o = p.object;
        if (mode === 'scale') setReadout(`Size ${[o.scale.x, o.scale.y, o.scale.z].map(metres).join(' × ')}`);
        else {
          const high = o.position.y > 0.005;
          setReadout(movedText(o.position.x - from.x, o.position.z - from.z, o.position.x, o.position.z) + (high ? ` · ${metres(o.position.y)} m high` : ''), high ? [o.position.x, o.position.y, o.position.z] : undefined);
        }
      };
    }
  }


  return (
    <div
      className={`canvas-wrap${onPick ? ' picking' : ''}`}
      onPointerEnter={() => setCanvasPointer(true)}
      onPointerLeave={() => { setCanvasPointer(false); setPointerHint(null); }}
      onPointerDown={(e) => {
        downAt.current = [e.clientX, e.clientY];
        downType.current = e.pointerType;
        // A long press on touch: what is under the finger, selected, and its menu (touch has no right-click).
        window.clearTimeout(longPress.current);
        if (e.pointerType !== 'touch') return;
        const [x, y] = [e.clientX, e.clientY];
        longPress.current = window.setTimeout(() => {
          const [x1, y1] = downAt.current;
          if (Math.hypot(x1 - x, y1 - y) > 8) return;
          const hit = apiRef.current?.pick(x, y) ?? {};
          if (hit.camera) store.select({ kind: 'camera', camera: hit.camera });
          else if (hit.prop) store.select({ kind: 'prop', prop: hit.prop });
          else if (hit.figure) store.select({ kind: 'figure', figure: hit.figure });
          onMenu({ clientX: x, clientY: y }, hit);
        }, 550);
      }}
      onPointerMove={(e) => { if (e.pointerType === 'touch' && Math.hypot(e.clientX - downAt.current[0], e.clientY - downAt.current[1]) > 8) window.clearTimeout(longPress.current); }}
      onPointerCancel={() => window.clearTimeout(longPress.current)}
      onPointerUpCapture={(e) => {
        // Picking: a click (dragging still orbits) is the pick. (The release goes on to the view's
        // controls; the click that follows selects nothing.)
        const [x, y] = downAt.current;
        if (!onPick || e.button !== 0 || Math.hypot(e.clientX - x, e.clientY - y) > 4 || !(e.target instanceof HTMLCanvasElement)) return;
        pickedAt.current = performance.now();
        onPick(apiRef.current?.pick(e.clientX, e.clientY) ?? {});
      }}
      onPointerUp={(e) => {
        window.clearTimeout(longPress.current);
        // Open on release so a right-drag (pan) does not open it; the browser's own menu is off.
        const [x, y] = downAt.current;
        if (e.button !== 2 || Math.hypot(e.clientX - x, e.clientY - y) > 4 || !(e.target instanceof HTMLCanvasElement)) return;
        onMenu(e, apiRef.current?.pick(e.clientX, e.clientY) ?? {});
      }}
      onContextMenu={(e) => e.preventDefault()}
      // Something dragged in (a Library item, a prop): onto the figure under the pointer, or the floor there.
      onDragOver={(e) => {
        const d = dragged();
        if (!d || (!d.figure && !d.floor)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        const d = dragged();
        if (!d) return;
        e.preventDefault();
        endDrag();
        const hit = apiRef.current?.pick(e.clientX, e.clientY) ?? {};
        if (hit.figure && d.figure) d.figure(hit.figure);
        else if (hit.floor && d.floor && !hit.figure) d.floor(hit.floor);
      }}
    >
      <Canvas
        // (Drawn on demand: see components/frames.ts.)
        frameloop="demand"
        flat
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ fov: 35, position: [0, 1, 5], near: 0.01, far: 200 }}
        gl={{ antialias: true }}
        onPointerMissed={(e) => {
          const [x, y] = downAt.current;
          const moved = Math.hypot(e.clientX - x, e.clientY - y) > 4;
          // (Not the click that picked a spot: the pick mode has just ended.)
          if (!moved && !onPick && performance.now() - pickedAt.current > 300 && performance.now() - gizmoBusy.current > 250) store.select(null);
        }}
      >
        <color attach="background" args={[styleDef(look.style).background]} />
        <Waker store={store} clock={clock} sv={sv} />
        <Lights sv={sv} style={look.style} scene={scene} />
        <DropLine />
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
        <SceneObjects sv={sv} store={store} scene={scene} limits={settings.limits} handles={settings.showHandles || shotMode} gizmoActive={() => gizmoBusy.current === Infinity} onClick={handleClick} onDoubleClick={handleDoubleClick} />
        <GizmoWarmup />
        {target && !shotMode && <GizmoScale controls={gizmo} size={gizmoWorld * (coarse ? 1.3 : 1)} />}
        {target && !shotMode && (
          <TransformControls
            ref={gizmo}
            object={target}
            mode={mode}
            space={mode === 'translate' ? 'world' : 'local'}
            // (Sized in the world by GizmoScale, as the floor rings are: it shrinks as the view draws back.)
            size={1}
            showY={showY}
            // (Ctrl: the 25 cm grid, 10 % of the size.)
            translationSnap={snapKey ? STEPS.move : null}
            scaleSnap={snapKey ? STEPS.scale : null}
            onMouseDown={() => {
              gizmoBusy.current = Infinity;
              gizmoFrom.current = target!.position.clone();
            }}
            onMouseUp={() => { gizmoBusy.current = performance.now(); gizmoFrom.current = null; setReadout(null); }}
            onObjectChange={() => {
              onGizmoChange();
              if (gizmoFrom.current) readout(gizmoFrom.current);
            }}
          />
        )}
        {handles && (
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
        {handles && scene.animation && activeFigure && scene.figures.some((f) => f.id === activeFigure && !f.hidden) && (
          <RouteOverlay store={store} scene={scene} figureId={activeFigure} time={time} />
        )}
        {handles && scene.animation?.constraints && <HoldPins sv={sv} scene={scene} time={time} />}
        {handles && selection?.kind === 'prop' && !scene.props.find((p) => p.id === selection.prop)?.hold && (
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
        {placing && <PlaceGhost key={placing.hint} placing={placing} apiRef={apiRef} />}
        {!shotMode && <HoverGhost />}
        {handles && (styleDef(look.style).lit || selection?.kind === 'light') && (
          <LightHandles store={store} scene={scene} sv={sv} selected={selection?.kind === 'light' ? selection.light : null} lit={styleDef(look.style).lit} />
        )}
        <ShotDriver store={store} scene={scene} clock={clock} time={time} through={through} captureRef={captureRef} />
        {handles && (
          <CameraRig store={store} scene={scene} clock={clock} time={time} selection={selection} groupRef={rigRef} />
        )}
        <Bridge
          sv={sv}
          apiRef={apiRef}
          frameRequest={frameRequest}
          sceneId={scene.id}
          sceneView={openAngle}
          shotMode={shotMode}
          capture={() => captureRef.current?.() ?? null}
          rigRef={rigRef}
          figures={scene.figures}
          lighting={lightingOf(scene)}
        />
        <LineArtRenderer sv={sv} lineWidth={settings.editorLine} style={look.style} />
      </Canvas>
      <DragReadout />
      {handles && turnable && !through && <TurnButtons key={JSON.stringify(selection)} onScreen={ringOnScreen} />}
      {handles && !through && selection?.kind === 'joint' && figureDoc(selection.figure) && !figureDoc(selection.figure)!.proxy && (
        <JointCard
          key={`${selection.figure}:${selection.joint}`}
          store={store}
          figure={selection.figure}
          joint={selection.joint}
          value={angle(figureDoc(selection.figure)!.bones, selection.joint)}
          limits={settings.limits}
          onScreen={jointOnScreen}
        />
      )}
    </div>
  );
}

/** What GizmoScale reads and sets of three-stdlib's gizmo (private there, public in fact). */
type Sizable = THREE.Object3D & { object?: THREE.Object3D; size: number };
const setGizmoSize = (c: Sizable, size: number) => { c.size = size; };

/** The gizmo's widths of line (its units: a ring's radius, an arrow's length is 1): the rings are on a smaller gizmo. */
const GIZMO_LINE = { straight: 0.04, ring: 0.1 };

/**
 * Thick lines for the gizmo: three draws its rings and arrows' shafts as 1 px lines (WebGL draws no
 * wider), so each gets a thin tube along it, in the same material (its highlight under the pointer
 * goes with it). Done once per gizmo.
 */
function thicken(c: Sizable) {
  if (c.userData.thick) return;
  c.userData.thick = true;
  const lines: THREE.Line[] = [];
  c.traverse((o) => { if ((o as THREE.Line).isLine && (o as { tag?: string }).tag !== 'helper') lines.push(o as THREE.Line); });
  for (const line of lines) {
    const pos = line.geometry.getAttribute('position');
    if (!pos || pos.count < 2) continue;
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < pos.count; i++) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i - 1);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i);
      if (a.distanceTo(b) > 1e-6) path.add(new THREE.LineCurve3(a, b));
    }
    if (!path.curves.length) continue;
    const width = path.curves.length > 2 ? GIZMO_LINE.ring : GIZMO_LINE.straight;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(1, path.curves.length), width / 2, 6, false), line.material);
    tube.raycast = () => {};
    line.add(tube);
  }
}

/**
 * The Move, Rotate and Scale gizmo sized in the world (`size`: its unit in metres), as the model,
 * its floor rings and joint handles are, not one size on screen as three's is: it shrinks as the
 * view draws back.
 */
function GizmoScale({ controls, size }: { controls: RefObject<TransformControlsImpl | null>; size: number }) {
  const at = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const c = controls.current as unknown as Sizable | null;
    const o = c?.object;
    if (!c || !o || !(camera instanceof THREE.PerspectiveCamera)) return;
    thicken(c);
    // (three-stdlib's gizmo is scaled by this factor × its size / 7.)
    const factor = o.getWorldPosition(at).distanceTo(camera.position) * Math.min((1.9 * Math.tan((Math.PI * camera.fov) / 360)) / camera.zoom, 7);
    setGizmoSize(c, factor > 1e-6 ? (7 * size) / factor : 1);
  });
  return null;
}

/**
 * The gizmo's shaders compiled when the canvas starts, not when one first shows (a pause on the
 * first click of a joint and the first drag): a gizmo of each mode, too small to see, with its drag
 * guide on, drawn in the first frames through the real pipeline and then taken away. Its materials
 * are kept, so their programs stay for the real gizmo's, which match them.
 */
class Warmup {
  private readonly at = new THREE.Object3D();
  private gizmos: TransformControlsImpl[] = [];
  private scene: THREE.Scene | null = null;
  private frames = 0;
  private done = false;
  tick(scene: THREE.Scene, camera: THREE.Camera) {
    if (this.done) return;
    if (!this.scene) {
      this.scene = scene;
      for (const mode of ['translate', 'scale'] as const) {
        // (On an element of its own: it never takes the pointer.)
        const g = new TransformControlsImpl(camera, document.createElement('div'));
        g.setMode(mode);
        g.attach(this.at);
        const sized = g as unknown as Sizable & { axis: string | null };
        sized.axis = 'X';
        setGizmoSize(sized, 1e-4);
        thicken(sized);
        this.gizmos.push(g);
      }
      scene.add(this.at, ...this.gizmos);
    }
    if (++this.frames < 3) return;
    this.done = true;
    this.release();
  }
  /**
   * The gizmos taken away and let go, without disposing their materials (that would free the
   * programs they were made to compile); only the listener three put on the document goes. (Let go
   * before they were drawn, as React's development double mount does, it starts again.)
   */
  release() {
    this.scene?.remove(this.at, ...this.gizmos);
    for (const g of this.gizmos) document.removeEventListener('pointerup', (g as unknown as { onPointerUp: EventListener }).onPointerUp);
    this.gizmos = [];
    this.scene = null;
    this.frames = 0;
  }
}

function GizmoWarmup() {
  const [warmup] = useState(() => new Warmup());
  useFrame(({ scene, camera }) => warmup.tick(scene, camera));
  useEffect(() => () => warmup.release(), [warmup]);
  return null;
}

type Trail = { id: string; rig: boolean; times: number[]; points: THREE.Vector3[] };

/**
 * The cameras' trails (where each is every tenth of a second; a rig's only while it is selected), worked out once a drag rests and a
 * little at a time between frames (a camera on someone poses them at each sample: a long block of
 * work at once would hold up the drop). The trails before stay shown until the new ones are done;
 * each keeps to its own camera.
 */
function useTrails(scene: Scene, rig: string | null): Trail[] {
  const [trails, setTrails] = useState<Trail[]>([]);
  const { cameras, animation } = scene;
  useEffect(() => {
    const aspect = frameAspect();
    // (A rig's only while it is selected: each of its points poses whom it films, again after every edit.)
    const jobs = cameras.filter((c) => c.kind !== 'rig' || c.id === rig).map((c) => ({ cam: c, trail: { id: c.id, rig: c.kind === 'rig', times: trailTimes(scene, c), points: [] as THREE.Vector3[] } }));
    let job = 0;
    let timer = 0;
    const work = () => {
      const until = performance.now() + 8;
      while (job < jobs.length && performance.now() < until) {
        const { cam, trail } = jobs[job];
        if (trail.points.length < trail.times.length) trail.points.push(viewOf(scene, cam, trail.times[trail.points.length], aspect).position);
        else job++;
      }
      if (job < jobs.length) timer = window.setTimeout(work, 0);
      else setTrails(jobs.map((j) => j.trail));
    };
    timer = window.setTimeout(work, 0);
    return () => window.clearTimeout(timer);
    // (The cameras and the motion, not the figures as the playhead poses them.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras, animation, rig]);
  return trails;
}

/** While something above the floor is dragged: a dashed line from it down to the floor. */
function DropLine() {
  const at = useReadout()?.drop;
  if (!at) return null;
  return <Line points={[at, [at[0], 0, at[2]]]} color="#3b6cff" lineWidth={1} dashed dashSize={0.04} gapSize={0.03} depthTest={false} renderOrder={6} />;
}

/** The readout beside the pointer while something is dragged. */
function DragReadout() {
  const r = useReadout();
  if (!r) return null;
  return <div className={`drag-readout${r.axis === undefined ? '' : ` axis-${'xyz'[r.axis]}`}`} role="status" style={{ transform: `translate(${r.x + 16}px, ${r.y + 20}px)` }}>{r.text}</div>;
}

/** The scene's lights + shadow floor, re-aimed when the scene or its lighting changes. */
function Lights({ sv, style, scene }: { sv: SceneView; style: Style; scene: Scene }) {
  const rig = useMemo(() => new LightRig(), []);
  const stale = useRef(true);
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => { stale.current = true; }, [scene, scene.lighting, style]);
  // Aim at render time, after the scene has been synced.
  useFrame(() => {
    if (!stale.current) return;
    stale.current = false;
    sv.ink.setLight(rig.update(lightingOf(scene), style, sv.bounds()), rig.tint);
  });
  return <primitive object={rig.object} />;
}

/** While playing, pose the figures for the clock's time on every frame (without touching the document). */
function Playback({ sv, scene, clock }: { sv: SceneView; scene: Scene; clock: Clock }) {
  useFrame(() => {
    // (Playing: as the film plays, idle life in the gaps.)
    if (clock.playing) sv.sync(sceneAt(scene, clock.time, true));
  }, -2);
  return null;
}

/** What the Library item under the pointer would make of the selected figure, as a ghost on it. */
function HoverGhost() {
  const scene = useHoverGhost();
  const ghost = useMemo(() => new Ghost(), []);
  const size = useThree((s) => s.size);
  useEffect(() => () => ghost.dispose(), [ghost]);
  useEffect(() => ghost.resize(size.width, size.height), [ghost, size]);
  useLayoutEffect(() => ghost.show(scene), [ghost, scene]);
  return <primitive object={ghost.root} />;
}

/**
 * Placing something new: a ghost of it where it would go under the pointer (the hint says how it
 * relates to the figure nearest), turned by the wheel or R.
 */
function PlaceGhost({ placing, apiRef }: { placing: Placing; apiRef: Props['apiRef'] }) {
  const ghost = useMemo(() => new Ghost(), []);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  useEffect(() => () => ghost.dispose(), [ghost]);
  useEffect(() => ghost.resize(size.width, size.height), [ghost, size]);
  useEffect(() => ghost.follow(placing, apiRef, gl.domElement.parentElement!), [ghost, placing, apiRef, gl]);
  return <primitive object={ghost.root} />;
}

/** A ghost: a see-through view of what would be added (kept up with the pointer), or of what a Library item would do. */
class Ghost {
  private view = new SceneView({ color: '#3b6cff', opacity: 0.35 });
  readonly root = this.view.root;

  resize(w: number, h: number) {
    this.view.ink.setResolution(w, h);
    this.view.ink.setThickness(1.3);
  }

  dispose() {
    this.view.dispose();
  }

  /** Show a scene (nothing: hide); the canvas woken to draw it (it may change off the canvas: from the Library, the wheel, a key). */
  show(scene: Scene | null) {
    this.root.visible = !!scene;
    if (scene) this.view.sync(scene);
    wake();
  }

  /** Follow the pointer over `el` for `placing`; the wheel and R turn it. Returns the stop. */
  follow(placing: Placing, apiRef: Props['apiRef'], el: HTMLElement) {
    let last: { x: number; y: number; alt: boolean } | null = null;
    const show = () => {
      if (!last) return;
      const hit = apiRef.current?.pick(last.x, last.y) ?? {};
      this.show(placing.ghost(hit.floor, last.alt, hit));
      setPointerHint(placing.at || placing.text
        ? `${placing.text ? `${placing.text[0].toUpperCase()}${placing.text.slice(1)} · ` : ''}Click: put it there · Wheel or R: turn · Esc: cancel`
        : placing.hint);
    };
    const move = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY, alt: e.altKey }; show(); };
    const turn = (by: number) => { placing.turn(by); show(); };
    const wheel = (e: WheelEvent) => { e.preventDefault(); e.stopPropagation(); turn(e.deltaY > 0 ? 15 : -15); };
    const key = (e: KeyboardEvent) => {
      // (Not typed into a field, nor with a modifier: Ctrl R still reloads.)
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || el.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); e.stopPropagation(); turn(15); }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('wheel', wheel, { capture: true, passive: false });
    window.addEventListener('keydown', key, true);
    this.root.visible = false;
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('wheel', wheel, { capture: true });
      window.removeEventListener('keydown', key, true);
      setPointerHint(null);
    };
  }
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
function ShotDriver({ store, scene, clock, time, through, captureRef }: {
  store: Store;
  scene: Scene;
  clock: Clock;
  time: number;
  through: Through;
  captureRef: RefObject<(() => CameraView | null) | null>;
}) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const dirty = useRef(true);
  const enabled = !!through;
  const lookId = through?.camera;
  useEffect(() => { dirty.current = true; }, [time, scene, through, size]);

  const stageAspect = size.width / Math.max(1, size.height);
  const aspect = frameAspect();
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

  // Through the lens: a change of view, once let go of, is the camera's point at the playhead
  // (the camera looked through, or the one filming then).
  useEffect(() => {
    const controls = get().controls as unknown as { addEventListener(type: 'end', f: () => void): void; removeEventListener(type: 'end', f: () => void): void } | null;
    if (!enabled || !controls) return;
    const end = () => {
      if (clock.playing) return;
      const v = captureRef.current?.();
      if (v) setCameraPoint(store, v.position, v.target, v.fov, '', lookId);
    };
    controls.addEventListener('end', end);
    return () => controls.removeEventListener('end', end);
  }, [enabled, lookId, get, store, clock, captureRef]);

  useFrame((state) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const controls = state.controls as unknown as Controls;
    if (!enabled || !controls) return;
    if (!clock.playing && !dirty.current) return;
    dirty.current = false;
    const t = clock.playing ? clock.time : time;
    const one = lookId ? cameraById(scene, lookId) : null;
    const view = one ? viewOf(scene, one, scene.animation ? t : 0) : cameraAt(scene, t);
    placeCamera(camera, { ...view, fov: displayFov(view.fov) }, stageAspect);
    controls.target.copy(view.target);
    controls.update();
  }, -1);
  return null;
}

/**
 * Wakes the canvas (drawn on demand) when what it shows may change: the document or the selection,
 * the scene view, the pointer on it or a key, a model come in; and draws on while it is awake (a
 * moment after) and while playing.
 */
function Waker({ store, clock, sv }: { store: Store; clock: Clock; sv: SceneView }) {
  const invalidate = useThree((s) => s.invalidate);
  const el = useThree((s) => s.gl.domElement);
  useEffect(() => {
    setDrawer(invalidate);
    const up = () => wake();
    // (The pointer on the canvas; or anywhere while a button is held: a drag begun on it goes on
    // past its edge, following the pointer on the window.)
    const pointer = (e: PointerEvent) => { if (e.buttons || e.type !== 'pointermove' || e.target === el) wake(); };
    const offs = [store.subscribe(up), clock.subscribe(up), sv.subscribe(up), onModels(up)];
    const events = ['pointermove', 'pointerdown', 'pointerup'] as const;
    for (const e of events) window.addEventListener(e, pointer, { passive: true, capture: true });
    el.addEventListener('wheel', up, { passive: true });
    window.addEventListener('keydown', up, true);
    window.addEventListener('keyup', up, true);
    wake();
    return () => {
      setDrawer(null);
      offs.forEach((off) => off());
      for (const e of events) window.removeEventListener(e, pointer, { capture: true });
      el.removeEventListener('wheel', up);
      window.removeEventListener('keydown', up, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [invalidate, el, store, clock, sv]);
  useFrame(() => {
    if (clock.playing || awake()) invalidate();
  }, -100);
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
    // (Its outlines and lines are on a layer of their own: seen too.)
    camera.layers.enable(LINES_LAYER);
    pass.prepare(gl, sv, camera, lineWidth * 0.8);
    gl.render(scene, camera);
    pass.overlay(gl);
  }, 1);
  return null;
}

function Bridge({ sv, apiRef, frameRequest, sceneId, sceneView, shotMode, capture, rigRef, figures: docs, lighting }: {
  sv: SceneView;
  apiRef: Props['apiRef'];
  frameRequest: FrameRequest;
  sceneId: string;
  sceneView: View;
  shotMode: boolean;
  capture(): CameraView | null;
  /** The cameras drawn on the canvas, to pick them. */
  rigRef: RefObject<THREE.Group | null>;
  /** The figures as drawn (for the points of their bodies to hold on to). */
  figures: Figure[];
  /** The scene's lights (their lamps, to label and frame). */
  lighting: Lighting;
}) {
  const lightingRef = useRef(lighting);
  useEffect(() => { lightingRef.current = lighting; }, [lighting]);
  /** Where a light's lamp is (null: no such light). */
  const lampOf = useCallback((id: string) => { const l = lightingRef.current.lights.find((x) => x.id === id); return l ? lampAt(lightDome(sv.bounds()), l) : null; }, [sv]);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const figures = useRef(docs);
  useEffect(() => { figures.current = docs; }, [docs]);
  const controls = useThree((s) => s.controls) as unknown as Controls;
  const gl = useThree((s) => s.gl);
  const r3fScene = useThree((s) => s.scene);
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
      editorCamera: () => ({ position: camera.position.clone(), target: (controls?.target ?? new THREE.Vector3(0, 1, 0)).clone(), fov: camera.fov, lens: fovLens(camera.fov), roll: 0 }),
      rootPosition: (id) => sv.figures.get(id)?.read().position ?? null,
      project: (id, joint) => {
        const m = sv.figures.get(id);
        const p = m?.joints[joint].getWorldPosition(new THREE.Vector3());
        // (Behind the view: not on screen.)
        return p && p.clone().project(camera).z <= 1 ? toScreen(p) : null;
      },
      projectPoint: (p) => toScreen(new THREE.Vector3(...p)),
      captureShot: () => captureRef.current(),
      labelPoint: (sel) => {
        if (sel.kind === 'light') {
          // (Behind the view: not on screen.)
          const lamp = lampOf(sel.light);
          return !lamp || lamp.clone().project(camera).z > 1 ? null : toScreen(lamp);
        }
        if (sel.kind === 'figure' || sel.kind === 'joint') {
          // (A joint's too: clear of its gizmo.)
          // Above the head (cheap enough to follow every frame).
          const m = sv.figures.get(sel.figure);
          if (!m || !m.object.visible && !sv.models.get(sel.figure)) return null;
          const head = m.joints.head.getWorldPosition(new THREE.Vector3());
          return toScreen(head.setY(head.y + 0.22 * m.object.scale.y));
        }
        let o: THREE.Object3D | undefined;
        if (sel.kind === 'prop') o = sv.props.get(sel.prop)?.object;
        else if (sel.kind === 'camera') rigRef.current?.traverse((x) => { if (!o && x.visible && x.userData.camera === sel.camera && x.userData.point === undefined) o = x; });
        if (!o) return null;
        let shown = true;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) shown &&= p.visible;
        if (!shown) return null;
        const box = new THREE.Box3().setFromObject(o);
        if (box.isEmpty()) return null;
        const c = box.getCenter(new THREE.Vector3());
        return toScreen(new THREE.Vector3(c.x, box.max.y, c.z));
      },
      ringOnScreen: (sel) => {
        const across = (c: THREE.Vector3, radius: number) => {
          if (c.clone().project(camera).z > 1) return null;
          const at = toScreen(c.clone());
          const side = toScreen(c.clone().add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(radius)));
          return { ...at, r: Math.hypot(side.x - at.x, side.y - at.y) };
        };
        if (sel.kind === 'figure') {
          const m = sv.figures.get(sel.figure);
          if (!m || (!m.object.visible && !sv.models.get(sel.figure))) return null;
          return across(m.joints.hips.getWorldPosition(new THREE.Vector3()).setY(0), 0.275 * m.object.scale.y);
        }
        if (sel.kind === 'prop') {
          const o = sv.props.get(sel.prop)?.object;
          if (!o?.visible) return null;
          const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
          return across(o.position.clone().setY(0), Math.max(size.x, size.z) / 2 + 0.08);
        }
        if (sel.kind === 'light') { const lamp = lampOf(sel.light); return lamp && across(lamp, 0); }
        const point = apiRef.current?.labelPoint(sel);
        return point ? { ...point, r: 0 } : null;
      },
      pick: (x, y) => {
        const r = gl.domElement.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
        // (A light's lamp under it too: said as well, not instead, for the right-click menu.)
        const lamps: THREE.Object3D[] = [];
        r3fScene.traverse((o) => { if (o.visible && o.name.startsWith('light-lamp:')) lamps.push(o); });
        const lamp = lamps.find((o) => ray.intersectObject(o, true).length);
        const hit: CanvasHit = lamp ? { light: lamp.name.slice('light-lamp:'.length) } : {};
        const floor = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
        if (floor) hit.floor = [floor.x, 0, floor.z];
        // A camera (or one of its points) in front of everything: it is drawn over the scene.
        for (const { object } of rigRef.current ? ray.intersectObject(rigRef.current, true) : []) {
          let o: THREE.Object3D | null = object;
          while (o && !o.userData.camera) o = o.parent;
          if (o?.visible) return { ...hit, camera: o.userData.camera as string, ...(o.userData.point !== undefined ? { point: o.userData.point as number } : {}) };
        }
        for (const { object, point } of ray.intersectObject(sv.root, true)) {
          let o: THREE.Object3D | null = object;
          let shown = true;
          for (let p: THREE.Object3D | null = o; p; p = p.parent) shown &&= p.visible;
          if (!shown) continue;
          while (o && !o.userData.figure && !o.userData.prop) o = o.parent;
          if (o?.userData.prop && sv.props.get(o.userData.prop as string)?.parts.faded) continue;
          if (o?.userData.prop) return { ...hit, prop: o.userData.prop as string };
          if (o?.userData.figure) {
            const id = o.userData.figure as string;
            const m = sv.figures.get(id);
            const f = figures.current.find((x) => x.id === id);
            return { ...hit, figure: id, ...(m && f && !f.proxy ? { contact: nearestContact(m, f, point).contact } : {}) };
          }
        }
        return hit;
      },
    };
  }, [apiRef, camera, controls, sv, gl, rigRef, r3fScene, lampOf]);

  const frame = (view: FrameRequest['view'], only?: string | string[]) => {
    if (!controls) return 0;
    // Wait a frame so the scene has been synced.
    return requestAnimationFrame(() => {
      const light = typeof only === 'string' && only.startsWith('light:') ? only.slice('light:'.length) : null;
      const ids = typeof only === 'string' ? (light ? [] : [only]) : only ?? [];
      const things = ids.flatMap((id) => { const t = sv.figures.get(id) ?? sv.props.get(id); return t ? [t] : []; });
      const one = things.length ? { forEachPoint: (cb: (p: THREE.Vector3) => void) => things.forEach((t) => t.forEachPoint(cb)) } : undefined;
      // (A light: the scene and its lamp.)
      const lamp = light ? lampOf(light) : null;
      const source = one ? one : lamp ? { forEachPoint: (cb: (p: THREE.Vector3) => void) => { sv.forEachPoint(cb); cb(lamp); } } : sv;
      controls.target.copy(fitCamera(camera, source, { yaw: view.yaw, pitch: view.pitch, fov: view.fov ?? 35 }, one ? 0.45 : 0.2));
      camera.near = 0.01; // fitCamera tightens these for export; keep room for zooming
      camera.far = 200;
      camera.updateProjectionMatrix();
      controls.update();
      wake();
    });
  };

  // The free view while the shot camera has the editor's camera (looking through, playing the
  // film): it comes back after; null when another scene was opened meanwhile (its own angle then).
  const freeView = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  // Switching to another scene shows it from its camera's angle (the shot camera takes over in shot mode).
  const shotRef = useRef(shotMode);
  useEffect(() => { shotRef.current = shotMode; }, [shotMode]);
  useEffect(() => {
    if (shotRef.current) {
      freeView.current = null;
      return;
    }
    const id = frame({ ...latestView.current, fov: 35 });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, controls]);

  // Leaving shot mode returns to the free view as it was, with the normal editor lens.
  const get = useThree((s) => s.get);
  const entered = useRef(false);
  useEffect(() => {
    const cam = get().camera as THREE.PerspectiveCamera;
    const orbit = get().controls as unknown as Controls | null;
    if (shotMode) {
      entered.current = true;
      freeView.current = { position: cam.position.clone(), target: (orbit?.target ?? new THREE.Vector3(0, 1, 0)).clone() };
      return;
    }
    cam.fov = 35;
    cam.near = 0.01;
    cam.far = 200;
    cam.up.set(0, 1, 0);
    cam.updateProjectionMatrix();
    if (!entered.current) return;
    entered.current = false;
    const was = freeView.current;
    freeView.current = null;
    if (!was) {
      const id = frame({ ...latestView.current, fov: 35 });
      return () => cancelAnimationFrame(id);
    }
    cam.position.copy(was.position);
    orbit?.target.copy(was.target);
    orbit?.update();
    wake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotMode, get]);

  useEffect(() => {
    if (frameRequest.n === 0) return;
    const id = frame(frameRequest.view, frameRequest.only);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest]);

  return null;
}

/**
 * The cameras' paths through the set (one line each), a camera at each point of them and, for a
 * camera looking at a point, that point. Drag a camera to move it across the floor (Shift: up and
 * down), a look point to aim the camera; double-click a path to add a point there; right-click a
 * camera to delete the point. A camera placing itself from its subject (a rig) shows where it goes,
 * dashed. The red dot is the camera filming at the playhead.
 */
/** Each drag of a camera is one undo step. */
let drags = 0;

function CameraRig({ store, scene, clock, time, selection, groupRef }: { store: Store; scene: Scene; clock: Clock; time: number; selection: Selection; groupRef: RefObject<THREE.Group | null> }) {
  const a = scene.animation;
  const fps = a?.fps ?? 24;
  const get = useThree((s) => s.get);
  const dot = useRef<THREE.Mesh>(null);
  const [three] = useState(() => new THREE.PerspectiveCamera(30, frameAspect()));
  // The paths and cameras only depend on the cameras, the shots and the motion, not on the playhead.
  const cameras = scene.cameras;
  // (Worked out again when the cameras or the animation change, not as the playhead moves the figures.)
  // (A rig's trail while it, or a shot it films, is selected.)
  const chosen = selection?.kind === 'camera' ? selection.camera : selection?.kind === 'shot' ? a?.shots.find((x) => x.id === selection.shot)?.camera : undefined;
  const shown = chosen && cameras.find((c) => c.id === chosen)?.kind === 'rig' ? chosen : null;
  const trails = useTrails(useSettled(scene), shown);
  const markers = useMemo(() => cameras.flatMap((c) => (c.kind === 'path' ? c.points : []).map((p) => {
    const view = viewOf(scene, c, p.t);
    placeCamera(three, view, frameAspect());
    return { t: p.t, cam: c, position: three.position.clone(), quaternion: three.quaternion.clone(), target: view.target.clone(), aimed: c.kind === 'path' && c.aim === 'point' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [cameras, three]);
  const lastDot = useRef(NaN);
  useEffect(() => { lastDot.current = NaN; }, [trails]);
  // Every camera where it is at the playhead (a path camera's points have their own glyphs).
  const nowGlyphs = useRef<(THREE.Object3D | null)[]>([]);
  // Those at one of their path's points now (hidden there: the point's glyph is the one to drag).
  const onPoint = useRef<boolean[]>([]);

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
      cameras.forEach((c, i) => {
        const g = nowGlyphs.current[i];
        if (!g) return;
        placeCamera(three, viewOf(scene, c, a ? t : 0), frameAspect());
        g.position.copy(three.position);
        g.quaternion.copy(three.quaternion);
        onPoint.current[i] = c.kind === 'path' && c.points.some((p) => Math.abs(p.t - t) < 0.5 / fps);
      });
    }
    scale(dot.current);
    // (The camera whose outline row the pointer rests on, larger.)
    nowGlyphs.current.forEach((g, i) => { if (g) { scale(g, cameras[i]?.id === store.getState().linked ? 0.17 : 0.12); g.visible &&= !onPoint.current[i]; } });
  });

  /** Follow the pointer across a plane through `from` (level, or upright facing the view with Shift). */
  const dragOn = (e: ThreeEvent<PointerEvent>, from: THREE.Vector3, t: number, camera: string, apply: (p: THREE.Vector3, key: string) => void) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    clock.pause();
    store.setTime(t);
    store.select({ kind: 'camera', camera });
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
      setReadout(`${upright ? '' : `${movedText(to.x - from.x, to.z - from.z, to.x, to.z)} · `}${metres(to.y)} m high`, [to.x, to.y, to.z]);
    };
    const up = () => {
      setReadout(null);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      if (controls) controls.enabled = true;
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  };

  /** A double-click on a camera's path: a point there, the camera as it is then. */
  const addPoint = (camera: string, times: number[]) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const i = Math.min(times.length - 2, Math.max(0, Math.floor(((e as unknown as { faceIndex?: number }).faceIndex ?? 0))));
    const t = Math.round(((times[i] + times[i + 1]) / 2) * fps) / fps;
    store.setTime(t);
    store.select({ kind: 'camera', camera });
    addCameraPoint(store, camera, t);
  };

  const now = clock.playing ? clock.time : time;
  const picked = selection?.kind === 'camera' ? selection.camera : selection?.kind === 'shot' ? a?.shots.find((x) => x.id === selection.shot)?.camera : null;
  // The camera whose outline row the pointer rests on (larger, in the accent); resting on one here marks its row.
  const linked = useStudio((st) => st.linked);
  // Over a rig camera the wheel steps its shot size, not the view's zoom. (One removed, or made a
  // path camera, while the pointer rests on it: the zoom comes back then, or when these go.)
  const zoomOff = useRef<string | null>(null);
  const wheelAt = useRef(0);
  const setZoom = useCallback((on: boolean) => { const controls = get().controls as unknown as { enableZoom: boolean } | null; if (controls) controls.enableZoom = on; }, [get]);
  useEffect(() => {
    if (zoomOff.current && !cameras.some((c) => c.id === zoomOff.current && c.kind === 'rig')) { zoomOff.current = null; setZoom(true); }
  }, [cameras, setZoom]);
  useEffect(() => () => setZoom(true), [setZoom]);
  const link = (id: string) => {
    const cam = cameras.find((c) => c.id === id);
    const zoom = (on: boolean) => {
      // (Off over a rig camera; back on when the pointer leaves the one it was turned off for, whatever it is now.)
      if (on ? zoomOff.current !== id : cam?.kind !== 'rig') return;
      zoomOff.current = on ? null : id;
      setZoom(on);
    };
    return {
      onPointerOver: () => { store.setLinked(id); zoom(false); setPointerHint(cameraHint(cam?.name ?? 'the camera', cam?.kind === 'rig')); },
      onPointerOut: () => { store.setLinked(null); zoom(true); setPointerHint(null); },
    };
  };
  let n = 0;
  return (
    <group ref={groupRef}>
      {cameras.map((c, i) => {
        const color = c.id === picked || c.id === linked ? '#3b6cff' : '#60616a';
        return (
          <group
            key={`now:${c.id}`}
            ref={(g) => { nowGlyphs.current[i] = g; }}
            userData={{ camera: c.id }}
            onPointerDown={(e) => { if (e.button !== 0 || !e.eventObject.visible) return; e.stopPropagation(); store.select({ kind: 'camera', camera: c.id }); }}
            onWheel={c.kind === 'rig' ? (e) => {
              e.stopPropagation();
              // (Shift turns the wheel sideways in most browsers, so either way counts; a step comes at the
              // first event after a pause, so a trackpad's swipe and its momentum are one step.)
              const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
              const now = performance.now();
              const quiet = now - wheelAt.current > 180;
              wheelAt.current = now;
              if (d && quiet) setPointerHint(`${stepRig(store, c, d < 0 ? 1 : -1, e.nativeEvent.shiftKey)} · ${e.nativeEvent.shiftKey ? 'Wheel: shot size' : 'Shift-wheel: lens'}`);
            } : undefined}
            {...link(c.id)}
          >
            <mesh>
              <boxGeometry args={[0.14, 0.1, 0.12]} />
              <meshBasicMaterial color={color} transparent opacity={0.55} />
            </mesh>
            <mesh position={[0, 0, -0.1]} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.06, 0.09, 12, 1, true]} />
              <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
      {trails.filter((trail) => trail.points.length > 1 && cameras.some((c) => c.id === trail.id)).map((trail) => (
        <Line key={trail.id} points={trail.points} color="#3b6cff" lineWidth={trail.id === picked || trail.id === linked ? 3 : 1.5} transparent opacity={0.7} dashed={trail.rig} dashSize={0.15} gapSize={0.1} onDoubleClick={trail.rig ? undefined : addPoint(trail.id, trail.times)} />
      ))}
      {markers.map((m) => {
        const on = Math.abs(m.t - now) < 0.5 / fps && liveCamera(scene, now).id === m.cam.id;
        const color = on || m.cam.id === linked ? '#3b6cff' : '#27272a';
        const k = n++;
        const l = m.aimed ? n++ : -1;
        return (
          <group key={`${m.cam.id}:${m.t}`}>
            <group
              ref={(g) => { glyphs.current[k] = g; }}
              position={m.position}
              quaternion={m.quaternion}
              userData={{ camera: m.cam.id, point: m.t }}
              onPointerDown={(e) => dragOn(e, m.position, m.t, m.cam.id, (p, key) => moveCameraPoint(store, m.cam.id, m.t, p, key))}
              {...link(m.cam.id)}
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
                  onPointerDown={(e) => dragOn(e, m.target, m.t, m.cam.id, (p, key) => moveCameraLook(store, m.cam.id, m.t, p, key))}
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
      {!clock.playing && <CameraHandles store={store} scene={scene} time={time} picked={picked ?? null} hovered={linked && cameras.some((c) => c.id === linked) ? linked : null} />}
    </group>
  );
}
