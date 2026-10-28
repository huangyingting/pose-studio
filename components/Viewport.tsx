'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Line, OrbitControls, TransformControls } from '@react-three/drei';
import { addCameraPoint, moveCameraLook, moveCameraPoint, setCameraPoint, setSceneLight, toggleSelected } from '@/lib/actions';
import { angle } from '@/lib/pose';
import { sceneAt } from '@/lib/evaluate';
import { moments } from '@/lib/track';
import { DEFAULT_LIGHT, LightRig, lightFrom } from '@/lib/lighting';
import { LineArtPass } from '@/lib/lineart';
import { fitCamera, viewFromCamera } from '@/lib/render';
import { onModels } from '@/lib/model';
import { SceneView } from '@/lib/sceneview';
import { angleAt, cameraAt, cameraById, cameraTrail, fovLens, frameAspect, liveCamera, placeCamera, viewOf, type CameraView } from '@/lib/cameras';
import { styleDef } from '@/lib/styles';
import type { Settings, Store, Through } from '@/lib/store';
import type { Figure, JointName, Scene, Selection, Style, Vec3, View } from '@/lib/types';
import type { Clock } from './clock';
import { FigureMarkers, HoldPins, IKHandles, PropRing, RouteOverlay, SceneObjects, SeeThrough, nearestContact, nearestText, sliderAxis, valuesOf } from './Manipulators';
import type { Contact } from '@/lib/relations';
import JointArcs, { type JointOnScreen } from './JointArcs';
import CameraHandles, { stepRig } from './CameraHandles';
import LightHandles from './LightHandles';
import { useFilm, useStudio } from './store-context';
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
  /** Screen (client) coordinates of a joint, for tests and tooling. */
  project(figure: string, joint: JointName): { x: number; y: number } | null;
  /** Screen (client) coordinates of a world point. */
  projectPoint(p: Vec3): { x: number; y: number };
  /** A joint on screen, for its arcs (null if it is not drawn). */
  jointOnScreen(figure: string, joint: JointName): JointOnScreen | null;
  /** The camera of the current view (looking through the shot camera: as the shot frames it). */
  captureShot(): CameraView | null;
  /** What is under a screen point: a figure or prop, and the floor point there. */
  pick(x: number, y: number): CanvasHit;
  /** Where on screen to label what is selected: just above it (a joint: at it). Null if it is not drawn. */
  labelPoint(sel: NonNullable<Selection>): { x: number; y: number } | null;
}

/** What is under a point of the canvas: a figure, a prop, a camera (and which of its path points), the floor. */
/** What is under a point of the canvas: a figure (and the point of its body a hand would hold), a prop, a camera (and its path's point), the floor there. */
export type CanvasHit = { figure?: string; contact?: Contact; prop?: string; camera?: string; point?: number; floor?: Vec3 };

export interface FrameRequest {
  view: Pick<View, 'yaw' | 'pitch'> & { fov?: number };
  n: number;
  /** Only this figure or prop (the selection), not everything. */
  only?: string;
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
  const film = useFilm();
  const shotMode = !!through;
  const rigRef = useRef<THREE.Group>(null);
  const sv = useMemo(() => new SceneView(), []);
  // Re-render when sync() replaces three.js objects, so the gizmo/handles get the new joints.
  const version = useSyncExternalStore(sv.subscribe, sv.getVersion, sv.getVersion);
  const gizmoBusy = useRef(0);
  const gizmoFrom = useRef<THREE.Vector3 | null>(null);
  const downAt = useRef<[number, number]>([0, 0]);
  const pickedAt = useRef(0);
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
  useLayoutEffect(() => sv.setStyle(film.style), [sv, film.style]);
  useLayoutEffect(() => sv.setFaces(film.faces), [sv, film.faces]);
  useEffect(() => () => sv.dispose(), [sv]);

  const figureDoc = (id: string) => scene.figures.find((f) => f.id === id);
  const jointOnScreen = useCallback(
    () => (selection?.kind === 'joint' ? apiRef.current?.jointOnScreen(selection.figure, selection.joint) ?? null : null),
    [selection, apiRef],
  );

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // that was an orbit drag, not a click
    // (The click that picked something: what was selected stays so.)
    if (performance.now() - pickedAt.current < 300) { e.stopPropagation(); return; }
    // Alt-click: light that point from where the view is.
    if (e.nativeEvent.altKey) {
      e.stopPropagation();
      setSceneLight(store, lightFrom(scene.light ?? DEFAULT_LIGHT, e.camera.position.clone().sub(e.point)), '');
      return;
    }
    let o: THREE.Object3D | null = e.object;
    while (o && !o.userData.joint && !o.userData.prop) o = o.parent;
    if (!o) return;
    // A see-through prop (in front of the figure being edited) lets the click through.
    if (o.userData.prop && sv.props.get(o.userData.prop as string)?.parts.faded) return;
    e.stopPropagation();
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

  // The gizmo is for the explicit tools: Move (W: a whole figure or a prop, also up and down) and
  // Scale (R: props). Joints are posed by dragging the body (Shift-drag twists), by the selected
  // joint's arcs (one per slider, outside the body: rings around a joint crossed the parts next to
  // it and caught the drags meant for them) and the inspector's sliders; figures and props turn by
  // their floor ring.
  const handles = settings.showHandles && !shotMode;
  // A scene is first shown from where its camera films it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const openAngle = useMemo(() => angleAt(scene, 0), [scene.id]);
  let target: THREE.Object3D | null = null;
  let mode: 'translate' | 'scale' = 'translate';
  let showY = true;
  let onGizmoChange = () => {};
  // The readout of a gizmo drag, from where its object was when the drag began.
  let readout: (from: THREE.Vector3) => void = () => {};
  const moving = settings.gizmo === 'translate';
  const gizmoFigure = moving && selection?.kind !== 'prop' && selection?.kind !== 'shot' ? (selection?.kind === 'joint' || selection?.kind === 'figure' ? selection.figure : activeFigure) : null;
  if (gizmoFigure) {
    const m = sv.figures.get(gizmoFigure);
    const doc = figureDoc(gizmoFigure);
    if (m && doc) {
      target = m.joints.hips;
      showY = !doc.grounded;
      onGizmoChange = () => store.updateFigure(doc.id, (f) => ({ ...f, ...m.read() }), `gizmo:${doc.id}`);
      readout = (p) => {
        const r = m.joints.hips.position;
        setReadout(movedText(r.x - p.x, r.z - p.z, r.x, r.z) + nearestText(sv, scene, doc.id, r) + (doc.grounded ? '' : ` · ${metres(r.y)} m high`));
      };
    }
  } else if (selection?.kind === 'prop' && settings.gizmo !== 'rotate') {
    const p = sv.props.get(selection.prop);
    if (p) {
      target = p.object;
      mode = settings.gizmo;
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

  const active = activeFigure ? sv.figures.get(activeFigure) : undefined;
  const activeDoc = activeFigure ? figureDoc(activeFigure) : undefined;

  return (
    <div
      className={`canvas-wrap${onPick ? ' picking' : ''}`}
      onPointerEnter={() => setCanvasPointer(true)}
      onPointerLeave={() => { setCanvasPointer(false); setPointerHint(null); }}
      onPointerDown={(e) => {
        downAt.current = [e.clientX, e.clientY];
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
        <color attach="background" args={[styleDef(film.style).background]} />
        <Lights sv={sv} style={film.style} scene={scene} />
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
        <SceneObjects sv={sv} store={store} scene={scene} limits={settings.limits} gizmoActive={() => gizmoBusy.current === Infinity} onClick={handleClick} />
        {target && !shotMode && (
          <TransformControls
            object={target}
            mode={mode}
            space={mode === 'translate' ? 'world' : 'local'}
            size={0.8}
            showY={showY}
            onMouseDown={() => { gizmoBusy.current = Infinity; gizmoFrom.current = target!.position.clone(); }}
            onMouseUp={() => { gizmoBusy.current = performance.now(); gizmoFrom.current = null; setReadout(null); }}
            onObjectChange={() => {
              onGizmoChange();
              if (gizmoFrom.current) readout(gizmoFrom.current);
            }}
          />
        )}
        {/* (Not while a prop or a camera is what is selected: one target at a time.) */}
        {handles && active && activeDoc && !activeDoc.proxy && selection?.kind !== 'prop' && selection?.kind !== 'camera' && selection?.kind !== 'light' && selection?.kind !== 'many' && (
          <IKHandles
            key={`${activeDoc.id}:${version}`}
            m={active}
            figure={activeDoc}
            limits={settings.limits}
            onCommit={(read) => store.updateFigure(activeDoc.id, (f) => ({ ...f, ...read }), 'ik')}
            sv={sv}
            scene={scene}
            store={store}
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
        {handles && (styleDef(film.style).lit || selection?.kind === 'light') && (
          <LightHandles store={store} scene={scene} sv={sv} selected={selection?.kind === 'light'} lit={styleDef(film.style).lit} />
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
        />
        <LineArtRenderer sv={sv} lineWidth={settings.editorLine} style={film.style} />
      </Canvas>
      <DragReadout />
      {handles && selection?.kind === 'joint' && figureDoc(selection.figure) && !figureDoc(selection.figure)!.proxy && (
        <JointArcs
          key={`${selection.figure}:${selection.joint}`}
          store={store}
          figure={selection.figure}
          joint={selection.joint}
          value={angle(figureDoc(selection.figure)!.bones, selection.joint)}
          limits={settings.limits}
          onScreen={jointOnScreen}
          onLimit={(on) => sv.setHover(on ? { figure: selection.figure, joints: [selection.joint] } : null)}
        />
      )}
    </div>
  );
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

/** The shared key light + shadow floor, re-aimed when the scene or light changes. */
function Lights({ sv, style, scene }: { sv: SceneView; style: Style; scene: Scene }) {
  const rig = useMemo(() => new LightRig(), []);
  const stale = useRef(true);
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => { stale.current = true; }, [scene, scene.light, style]);
  // Aim at render time, after the scene has been synced.
  useFrame(() => {
    if (!stale.current) return;
    stale.current = false;
    sv.ink.setLightDirection(rig.update(scene.light ?? DEFAULT_LIGHT, style, sv.bounds()));
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

  /** Show a scene (nothing: hide). */
  show(scene: Scene | null) {
    this.root.visible = !!scene;
    if (scene) this.view.sync(scene);
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
    const key = (e: KeyboardEvent) => { if (e.key === 'r' || e.key === 'R') { e.preventDefault(); e.stopPropagation(); turn(15); } };
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

function Bridge({ sv, apiRef, frameRequest, sceneId, sceneView, shotMode, capture, rigRef, figures: docs }: {
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
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const figures = useRef(docs);
  useEffect(() => { figures.current = docs; }, [docs]);
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
      editorCamera: () => ({ position: camera.position.clone(), target: (controls?.target ?? new THREE.Vector3(0, 1, 0)).clone(), fov: camera.fov, lens: fovLens(camera.fov), roll: 0 }),
      rootPosition: (id) => sv.figures.get(id)?.read().position ?? null,
      project: (id, joint) => {
        const m = sv.figures.get(id);
        return m ? toScreen(m.joints[joint].getWorldPosition(new THREE.Vector3())) : null;
      },
      projectPoint: (p) => toScreen(new THREE.Vector3(...p)),
      jointOnScreen: (id, joint) => {
        const m = sv.figures.get(id);
        if (!m || !m.object.visible) return null;
        const obj = m.joints[joint];
        const pivot = obj.getWorldPosition(new THREE.Vector3());
        const at = toScreen(pivot.clone());
        const child = m.jointsUnder(joint)[1];
        const end = child ? m.joints[child].getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, joint === 'head' ? 0.1 : -0.1, 0).applyQuaternion(obj.getWorldQuaternion(new THREE.Quaternion())).add(pivot);
        // Away from the parts next to it on screen, and from the body (a limb's arcs go outside it).
        const away = { x: 0, y: 0 };
        const from = (p: THREE.Vector3, weight = 1) => {
          const q = toScreen(p.clone());
          const l = Math.hypot(q.x - at.x, q.y - at.y);
          if (l > 1) { away.x -= ((q.x - at.x) / l) * weight; away.y -= ((q.y - at.y) / l) * weight; }
          return q;
        };
        if (joint !== 'hips') from(obj.parent!.getWorldPosition(new THREE.Vector3()));
        const e = from(end);
        if (joint !== 'hips' && joint !== 'spine' && joint !== 'chest') from(m.joints.chest.getWorldPosition(new THREE.Vector3()), 1.5);
        const angle = Math.hypot(away.x, away.y) > 0.3 ? Math.atan2(away.y, away.x) : Math.atan2(e.y - at.y, e.x - at.x) + Math.PI / 2;
        // Which way a point of the part (in front of its end) goes on screen as each slider grows.
        const probe = end.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()), -0.06);
        const p0 = toScreen(probe.clone());
        const v = valuesOf(obj, joint);
        const turns = [0, 1, 2].map((i): [number, number] => {
          const p = toScreen(probe.clone().sub(pivot).applyAxisAngle(sliderAxis(obj, v, i), 0.1).add(pivot));
          return [p.x - p0.x, p.y - p0.y];
        });
        return { x: at.x, y: at.y, away: angle, turns };
      },
      captureShot: () => captureRef.current(),
      labelPoint: (sel) => {
        if (sel.kind === 'joint') {
          const m = sv.figures.get(sel.figure);
          return m ? toScreen(m.joints[sel.joint].getWorldPosition(new THREE.Vector3())) : null;
        }
        if (sel.kind === 'figure') {
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
      pick: (x, y) => {
        const r = gl.domElement.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
        const hit: CanvasHit = {};
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
  }, [apiRef, camera, controls, sv, gl, rigRef]);

  const frame = (view: FrameRequest['view'], only?: string) => {
    if (!controls) return 0;
    // Wait a frame so the scene has been synced.
    return requestAnimationFrame(() => {
      const one = only ? (sv.figures.get(only) ?? sv.props.get(only)) : undefined;
      const source = one ? { forEachPoint: (cb: (p: THREE.Vector3) => void) => one.forEachPoint(cb) } : sv;
      controls.target.copy(fitCamera(camera, source, { yaw: view.yaw, pitch: view.pitch, fov: view.fov ?? 35 }, one ? 0.45 : 0.2));
      camera.near = 0.01; // fitCamera tightens these for export; keep room for zooming
      camera.far = 200;
      camera.updateProjectionMatrix();
      controls.update();
    });
  };

  // Switching to another scene shows it from its camera's angle (the shot camera takes over in shot mode).
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trails = useMemo(() => cameras.map((c) => cameraTrail(scene, c)), [cameras, a]);
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
  const link = (id: string) => {
    const cam = cameras.find((c) => c.id === id);
    // (Over a rig camera the wheel steps its shot size, not the view's zoom.)
    const zoom = (on: boolean) => { const controls = get().controls as unknown as { enableZoom: boolean } | null; if (controls && cam?.kind === 'rig') controls.enableZoom = on; };
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
            onWheel={c.kind === 'rig' ? (e) => { e.stopPropagation(); stepRig(store, c, e.deltaY < 0 ? 1 : -1, e.nativeEvent.shiftKey); } : undefined}
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
      {trails.map((trail, i) => trail.points.length > 1 && (
        <Line key={cameras[i].id} points={trail.points} color="#3b6cff" lineWidth={cameras[i].id === picked || cameras[i].id === linked ? 3 : 1.5} transparent opacity={0.7} dashed={cameras[i].kind === 'rig'} dashSize={0.15} gapSize={0.1} onDoubleClick={cameras[i].kind === 'rig' ? undefined : addPoint(cameras[i].id, trail.times)} />
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
