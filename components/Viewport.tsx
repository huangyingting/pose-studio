'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls } from '@react-three/drei';
import { TransformControls as TransformControlsImpl } from 'three-stdlib';
import { Line } from './Line';
import { aimCamera, editLight, moveCameraPoint, setCameraPoint, toggleSelected } from '@/lib/actions';
import { angle } from '@/lib/pose';
import { sceneAt } from '@/lib/evaluate';
import { moments } from '@/lib/track';
import { paperTexture } from '@/lib/shaders';
import { LightRig, handleAt, keyLight, lightDome, lightFrom, lightingOf } from '@/lib/lighting';
import { LineArtPass } from '@/lib/lineart';
import { groundOf } from '@/lib/surfaces';
import { PixelPass } from '@/lib/pixel';
import { RealPass } from '@/lib/realpass';
import { fitCamera, viewFromCamera } from '@/lib/render';
import { onModels } from '@/lib/model';
import { onSetAssets, seatNear, surroundings, topUnder } from '@/lib/sets';
import { awake, setDrawer, wake } from './frames';
import { LINES_LAYER } from '@/lib/ink';
import SelectionTag from './SelectionTag';
import { SceneView } from '@/lib/sceneview';
import { angleAt, cameraAt, cameraById, fovLens, frameAspect, liveCamera, placeCamera, viewOf, type CameraView } from '@/lib/cameras';
import { styleDef, TONE_MAPPING } from '@/lib/styles';
import type { PinEnd, Settings, Store, Through } from '@/lib/store';
import { IK_CHAINS } from '@/lib/mannequin';
import type { Figure, JointName, Lighting, Scene, Selection, Style, Vec3, View } from '@/lib/types';
import type { Clock } from './clock';
import { FigureMarkers, HoldPins, PosePins, PropRing, RouteOverlay, SceneObjects, SeeThrough, nearestContact, nearestText, partUnder } from './Manipulators';
import type { Contact } from '@/lib/relations';
import CameraRig from './CameraRig';
import LightHandles, { LightingCircle } from './LightHandles';
import { STEPS, snapping } from './modifiers';
import { useProjectSettings, useStudio } from './store-context';
import { dragged, endDrag } from './dragdrop';
import { jointText, metres, movedText, setCanvasPointer, setPointerHint, setReadout, useHoverGhost, useReadout } from './hints';
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
  /** Where its label goes, just above what is selected (a joint: above its figure, clear of its gizmo). Null if it is not drawn. */
  labelAt(sel: NonNullable<Selection>): THREE.Vector3 | null;
  /** That on screen (null: behind the view too). */
  labelPoint(sel: NonNullable<Selection>): { x: number; y: number } | null;
}

/**
 * What is under a point of the canvas: a figure (the part there, and the point of its body a hand
 * would hold), a prop, a camera (and its path's point), a light's lamp, the floor there (at the foot
 * of a set's wall or furniture met first) and a set's top (a seat, a dais).
 */
export type CanvasHit = { figure?: string; joint?: JointName; contact?: Contact; prop?: string; camera?: string; point?: number; floor?: Vec3; top?: Vec3; light?: string };

export interface FrameRequest {
  view: Pick<View, 'yaw' | 'pitch'> & { fov?: number };
  n: number;
  /** Only these figures or props (the selection), or close up round one thing ('light:id', 'camera:id', 'joint:figure:joint'), not everything. */
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

/** Whether a set's parts stand between two points (its parts are not picked: their own ray test, not their outlines'). */
function setBetween(set: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  const dir = to.clone().sub(from);
  const ray = new THREE.Raycaster(from, dir.clone().normalize(), 0, Math.max(0, dir.length() - 0.5));
  const hits: THREE.Intersection[] = [];
  set.traverse((o) => {
    const m = o as THREE.Mesh;
    // (Not a light effect, a sunbeam's shaft: nothing solid.)
    if (m.isMesh && m.userData.set !== undefined && !m.userData.effect) THREE.Mesh.prototype.raycast.call(m, ray, hits);
  });
  return hits.length > 0;
}

/** A set's parts in the way of the view, or of the people in it, cut away as they move (SetObject.cutaway). */
function SetCutaway({ sv }: { sv: SceneView }) {
  const get = useThree((s) => s.get);
  const was = useRef({ eye: new THREE.Vector3(NaN, 0, 0), target: new THREE.Vector3(), set: null as unknown, people: [] as THREE.Vector3[] });
  useFrame(() => {
    const { camera, controls } = get() as unknown as { camera: THREE.Camera; controls: { target: THREE.Vector3 } | null };
    const set = sv.set;
    if (!set || !controls) return;
    const w = was.current;
    const people = sv.chests();
    // (Again when the view has moved a millimetre, or someone in it a couple of centimetres.)
    const moved = people.length !== w.people.length || people.some((p, i) => p.distanceToSquared(w.people[i]) > 4e-4);
    if (w.set === set && !moved && w.eye.distanceToSquared(camera.position) < 1e-6 && w.target.distanceToSquared(controls.target) < 1e-6) return;
    w.set = set;
    w.eye.copy(camera.position);
    w.target.copy(controls.target);
    w.people = people;
    set.cutaway(camera.position, controls.target, people);
  });
  return null;
}

/**
 * The view comes to rest. Easing after a drag takes a share of what is left of the move on each
 * frame drawn, never all of it: the view crept on, a hair a frame, whenever anything woke the
 * canvas (the pointer passing over it), and a set's part cut away and back or a shadow flickered
 * as it did. Under half a pixel a frame it eases out faster; under a fiftieth, the little left is
 * taken at once and the view stands still.
 */
const EASE = { factor: 0.05, finish: 0.25 };
function SettleView() {
  const get = useThree((s) => s.get);
  const last = useRef({ eye: new THREE.Vector3(NaN, 0, 0), target: new THREE.Vector3() });
  useFrame(() => {
    const { camera, controls } = get() as unknown as { camera: THREE.Camera; controls: { enableDamping: boolean; dampingFactor: number; target: THREE.Vector3; update(): void } | null };
    if (!controls?.enableDamping) return;
    const w = last.current;
    const step = Math.max(w.eye.distanceTo(camera.position), w.target.distanceTo(controls.target));
    // (A pixel is about a thousandth of the way to what the view looks at.)
    const far = camera.position.distanceTo(controls.target);
    if (step > 0 && step < far * 2e-5) {
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
      controls.dampingFactor = EASE.factor;
    } else if (step > 0) controls.dampingFactor = step < far * 5e-4 ? EASE.finish : EASE.factor;
    w.eye.copy(camera.position);
    w.target.copy(controls.target);
  });
  return null;
}

/**
 * The view's near plane a hundredth of the way to what it looks at (a centimetre at the closest,
 * half a metre at most): close up it keeps room to zoom, from afar the depth it can tell apart is
 * fine enough that a set's floor, the grid and what stands far off do not flicker as it turns.
 */
function DepthRange() {
  const get = useThree((s) => s.get);
  useFrame(() => {
    const { camera, controls } = get() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3 } | null };
    if (!controls) return;
    const near = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.01, 0.01, 0.5);
    if (Math.abs(camera.near - near) <= near * 0.15) return;
    camera.near = near;
    camera.updateProjectionMatrix();
  });
  return null;
}

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
  // What the gizmo holds for a light or a camera (they are drawn elsewhere: it is put where they are).
  const [stand] = useState(() => new THREE.Object3D());
  // A figure's hips and its gizmo's place as a drag of it began.
  const hipsFrom = useRef<{ hips: THREE.Vector3; stand: THREE.Vector3 } | null>(null);
  const gizmoFrom = useRef<THREE.Vector3 | null>(null);
  // A joint's slider values as a rotate-gizmo drag began (for its readout).
  const jointFrom = useRef<Vec3 | null>(null);
  // (A joint's gizmo turning it: the figure's pinned hands and feet where they were, held there, #38.)
  const pinsFrom = useRef<{ end: PinEnd; at: THREE.Vector3; q: THREE.Quaternion }[]>([]);
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

  // What is selected, named in the scene above it (a part: its figure, still picked).
  const tagged = shotMode || onPick || placing || !selection ? undefined
    : selection.kind === 'figure' || selection.kind === 'joint' ? scene.figures.find((f) => f.id === selection.figure)?.name
      : selection.kind === 'prop' ? scene.props.find((p) => p.id === selection.prop)?.name
        : selection.kind === 'camera' ? scene.cameras.find((x) => x.id === selection.camera)?.name
          : selection.kind === 'light' ? lightingOf(scene).lights.find((l) => l.id === selection.light)?.name : undefined;
  const tagText = tagged ? (selection?.kind === 'camera' && scene.animation ? `${tagged} · ${time.toFixed(1)} s` : tagged) : null;
  const labelAt = useCallback((sel: NonNullable<Selection>) => apiRef.current?.labelAt(sel) ?? null, [apiRef]);

  const figureDoc = (id: string) => scene.figures.find((f) => f.id === id);

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
      editLight(store, l.id, lightFrom(l, e.camera.position.clone().sub(e.point), e.point.toArray() as Vec3));
      return;
    }
    // (A see-through prop, in front of the figure being edited, lets the click through.)
    const o = partUnder(e.intersections, (x) => !(x.userData.prop && sv.props.get(x.userData.prop as string)?.parts.faded));
    if (!o) return;
    e.stopPropagation();
    // Shift-click: add it to what is selected (a figure as a whole), or take it away.
    if (e.nativeEvent.shiftKey) {
      toggleSelected(store, o.userData.prop ? { prop: o.userData.prop as string } : { figure: o.userData.figure as string });
      return;
    }
    const figure = o.userData.figure as string | undefined;
    // A figure: the first click picks it, the next (it picked, or a part of it) the part there.
    const picked = !!figure && (selection?.kind === 'figure' || selection?.kind === 'joint') && selection.figure === figure;
    if (o.userData.prop) store.select({ kind: 'prop', prop: o.userData.prop as string });
    else if (!figure) return;
    // (Stand-ins are placed, not posed, and the Move tool places figures: a click picks the whole figure.)
    else if (!picked || figureDoc(figure)?.proxy || store.getState().tool === 'move') store.select({ kind: 'figure', figure });
    else store.select({ kind: 'joint', figure, joint: o.userData.joint as JointName });
  };
  // The gizmo: a selected joint's rotate gizmo (with the drag handles shown: its rings about its own
  // axes, the ring facing the view and the ball between them to turn it freely, as Blender, Maya
  // and posing apps have it); a selected prop's, or a picked figure's,
  // moves it (also up and down; R scales a prop). Joints are also posed by dragging the body (Ctrl:
  // 5° steps; Shift-drag twists) and by the inspector's sliders and − +; figures and props turn by
  // their floor ring.
  const handles = settings.showHandles && !shotMode;
  // (A finger needs a bigger gizmo.)
  const [coarse] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
  // A scene is first shown from where its camera films it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const openAngle = useMemo(() => angleAt(scene, 0), [scene.id]);
  // A figure picked (a stand-in too): its Move gizmo (also up and down).
  const gizmoFigure = selection?.kind === 'figure' ? selection.figure : null;
  // The selected light, if a gizmo moves it (a lamp or a window); the selected camera and its point's
  // time, if one does (a path camera at one of its points now, a still camera at its one).
  const gizmoLight = selection?.kind === 'light' ? lightingOf(scene).lights.find((l) => l.id === selection.light && l.kind !== 'sun') ?? null : null;
  const gizmoCamera = (() => {
    const cam = selection?.kind === 'camera' ? scene.cameras.find((c) => c.id === selection.camera) : undefined;
    if (cam?.kind !== 'path') return null;
    const fps = scene.animation?.fps ?? 24;
    const now = scene.animation ? time : 0;
    const point = cam.points.find((p) => Math.abs(p.t - now) < 0.5 / fps) ?? (cam.points.length === 1 ? cam.points[0] : undefined);
    return point ? { id: cam.id, t: point.t } : null;
  })();
  // (What their gizmo holds: put where the light is, or the camera at that point, as they change.)
  useLayoutEffect(() => {
    if (gizmoBusy.current === Infinity) return;
    const hips = gizmoFigure ? sv.figures.get(gizmoFigure)?.joints.hips.getWorldPosition(new THREE.Vector3()) : undefined;
    // (On what it stands on: the floor, or a table's top, #29.)
    if (hips) stand.position.set(hips.x, groundOf(scene.props, undefined, scene.set)(hips.x, hips.z), hips.z);
    else if (gizmoLight) stand.position.set(...gizmoLight.position);
    else if (gizmoCamera) stand.position.copy(viewOf(scene, scene.cameras.find((c) => c.id === gizmoCamera.id)!, gizmoCamera.t).position);
  }, [stand, sv, scene, gizmoFigure, gizmoLight, gizmoCamera]);
  let target: THREE.Object3D | null = null;
  let mode: 'translate' | 'rotate' | 'scale' = 'translate';
  // The gizmo's size in the world (metres: a move arrow's length, a rotate ring's radius).
  let gizmoWorld = 0.45;
  let showY = true;
  let onGizmoChange = () => {};
  // The readout of a gizmo drag, from where its object was when the drag began.
  let readout: (from: THREE.Vector3) => void = () => {};
  if (gizmoFigure) {
    const m = sv.figures.get(gizmoFigure);
    const doc = figureDoc(gizmoFigure);
    if (m && doc) {
      // (On the floor under it, not at its hips: its arrows there would cover the arms and hands a
      // drag poses. The figure goes as it goes.)
      target = stand;
      gizmoWorld = 0.45 * (doc.body.height / 1.8);
      showY = !doc.grounded;
      onGizmoChange = () => {
        const from = hipsFrom.current;
        if (!from) return;
        const to = new THREE.Vector3(stand.position.x, from.hips.y + (doc.grounded ? 0 : stand.position.y - from.stand.y), stand.position.z);
        m.joints.hips.position.copy(m.joints.hips.parent!.worldToLocal(to));
        m.object.updateMatrixWorld(true);
        store.updateFigure(doc.id, (f) => ({ ...f, ...m.read() }), `gizmo:${doc.id}`);
      };
      readout = (p) => {
        const r = m.joints.hips.position;
        setReadout(movedText(r.x - p.x, r.z - p.z, r.x, r.z) + nearestText(sv, scene, doc.id, r) + (doc.grounded ? '' : ` · ${metres(r.y)} m high`));
      };
    }
  } else if (selection?.kind === 'joint' && handles) {
    const m = sv.figures.get(selection.figure);
    const doc = figureDoc(selection.figure);
    const joint = selection.joint;
    if (m && doc && !doc.proxy) {
      target = m.joints[joint];
      mode = 'rotate';
      gizmoWorld = 0.16 * (doc.body.height / 1.8);
      onGizmoChange = () => {
        if (settings.limits) m.constrain([joint]);
        for (const x of pinsFrom.current) m.solveIK(IK_CHAINS[x.end], x.at.clone(), x.q, settings.limits);
        store.updateFigure(doc.id, (f) => ({ ...f, ...m.read() }), `gizmo:${doc.id}:${joint}`);
      };
      readout = () => setReadout(jointText(joint, jointFrom.current ?? angle(doc.bones, joint), angle(m.read().bones, joint)));
    }
  } else if (selection?.kind === 'light' && handles && gizmoLight) {
    // A lamp or a window: moved (also up and down) by its gizmo (the sun: over its dome, dragged).
    target = stand;
    gizmoWorld = 0.35;
    const id = gizmoLight.id;
    const r = (v: number) => Math.round(v * 100) / 100;
    onGizmoChange = () => editLight(store, id, { position: [r(stand.position.x), r(Math.max(0.05, stand.position.y)), r(stand.position.z)] }, `gizmo:${id}`);
    readout = (from) => {
      const p = stand.position;
      setReadout(`${movedText(p.x - from.x, p.z - from.z, p.x, p.z)} · ${metres(p.y)} m high`, [p.x, p.y, p.z]);
    };
  } else if (selection?.kind === 'camera' && handles && gizmoCamera) {
    // A camera at one of its points now (a still camera's one): moved there by its gizmo, looking where it did.
    target = stand;
    gizmoWorld = 0.35;
    const { id, t } = gizmoCamera;
    onGizmoChange = () => moveCameraPoint(store, id, t, stand.position.clone().setY(Math.max(0.05, stand.position.y)), `gizmo:${id}:${t}`);
    readout = (from) => {
      const p = stand.position;
      setReadout(`${movedText(p.x - from.x, p.z - from.z, p.x, p.z)} · ${metres(p.y)} m high`, [p.x, p.y, p.z]);
    };
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
  // (Only on what is drawn: a figure just replaced (changed elsewhere, its character read) holds
  // the old one's joints for a moment. The stand-in for a light or a camera is always there.)
  if (target && target !== stand) {
    let o: THREE.Object3D | null = target;
    while (o && !(o as THREE.Scene).isScene) o = o.parent;
    if (!o) target = null;
  }

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
        // Looking through a camera: a click (not a drag, which frames the view) aims it there, at
        // the figure under the pointer or the spot (at chest height over the floor) (#16).
        const [x0, y0] = downAt.current;
        if (through && !onPick && e.button === 0 && Math.hypot(e.clientX - x0, e.clientY - y0) <= 4 && e.target instanceof HTMLCanvasElement) {
          const hit = apiRef.current?.pick(e.clientX, e.clientY) ?? {};
          const cam = through.camera ?? liveCamera(store.scene, store.getState().time).id;
          if (hit.figure) aimCamera(store, cam, { figure: hit.figure });
          else if (hit.floor) aimCamera(store, cam, { point: [hit.floor[0], 1, hit.floor[2]] });
          return;
        }
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
        <Backdrop style={look.style} scene={scene} />
        <Waker store={store} clock={clock} sv={sv} />
        <Lights sv={sv} style={look.style} scene={scene} time={time} clock={clock} />
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
        <SceneObjects sv={sv} store={store} scene={scene} limits={settings.limits} handles={settings.showHandles || shotMode} gizmoActive={() => gizmoBusy.current === Infinity} playing={() => clock.playing} onClick={handleClick} />
        <primitive object={stand} />
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
            // (Ctrl: the 25 cm grid, 5° on a joint, 10 % of the size.)
            translationSnap={snapKey ? STEPS.move : null}
            rotationSnap={snapKey ? STEPS.joint * (Math.PI / 180) : null}
            scaleSnap={snapKey ? STEPS.scale : null}
            onMouseDown={() => {
              gizmoBusy.current = Infinity;
              gizmoFrom.current = target!.position.clone();
              const m = gizmoFigure ? sv.figures.get(gizmoFigure) : undefined;
              hipsFrom.current = m ? { hips: m.joints.hips.getWorldPosition(new THREE.Vector3()), stand: stand.position.clone() } : null;
              jointFrom.current = selection?.kind === 'joint' ? angle(figureDoc(selection.figure)!.bones, selection.joint) : null;
              const pm = selection?.kind === 'joint' ? sv.figures.get(selection.figure) : undefined;
              pinsFrom.current = pm && selection?.kind === 'joint'
                ? (store.getState().pins[selection.figure] ?? []).filter((e) => e !== selection.joint).map((end) => ({ end, at: pm.joints[end].getWorldPosition(new THREE.Vector3()), q: pm.joints[end].getWorldQuaternion(new THREE.Quaternion()) }))
                : [];
            }}
            onMouseUp={() => { gizmoBusy.current = performance.now(); gizmoFrom.current = null; jointFrom.current = null; pinsFrom.current = []; setReadout(null); }}
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
            gizmoHot={() => !!(gizmo.current as unknown as { axis: string | null } | null)?.axis}
          />
        )}
        {!shotMode && <SeeThrough sv={sv} figureId={selection?.kind === 'joint' || selection?.kind === 'figure' ? selection.figure : activeFigure} />}
        {handles && scene.animation && activeFigure && scene.figures.some((f) => f.id === activeFigure && !f.hidden) && (
          <RouteOverlay store={store} scene={scene} figureId={activeFigure} time={time} />
        )}
        {handles && scene.animation?.constraints && <HoldPins sv={sv} scene={scene} time={time} />}
        {handles && <PosePins sv={sv} store={store} />}
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
        {/* (Looking through the shot camera, no easing after letting go: the shot's camera is set
            from the view once, and the view then follows it; easing on, the two pulled against each
            other and the view flickered between them.) */}
        <OrbitControls makeDefault onChange={keepCameraAboveFloor} enableDamping={!through} />
        <SettleView />
        <DepthRange />
        <SetCutaway sv={sv} />
        {scene.animation && <Playback sv={sv} scene={scene} clock={clock} />}
        {scene.animation && onion && <OnionSkin scene={scene} time={time} clock={clock} />}
        {placing && <PlaceGhost key={placing.hint} placing={placing} apiRef={apiRef} />}
        {!shotMode && <HoverGhost />}
        {handles && (styleDef(look.style).lit || selection?.kind === 'light') && (
          <LightHandles store={store} scene={scene} sv={sv} selected={selection?.kind === 'light' ? selection.light : null} lit={styleDef(look.style).lit} />
        )}
        {handles && selection?.kind === 'lighting' && (
          <LightingCircle store={store} scene={scene} time={time} />
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
        <SelectionTag selection={selection} text={tagText} at={labelAt} />
        <LineArtRenderer sv={sv} lineWidth={settings.editorLine} style={look.style} />
      </Canvas>
      <DragReadout />
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
      for (const mode of ['translate', 'rotate', 'scale'] as const) {
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

/**
 * Behind everything: the style's background colour, or its paper; round a set, what is round it
 * as the style shows it (lib/sets.ts surroundings: in 3D its sky and the light from all round, #25;
 * a painted sky, #28), as they come.
 */
function Backdrop({ style, scene }: { style: Style; scene: Scene }) {
  const get = useThree((s) => s.get);
  const [came, setCame] = useState(0);
  useEffect(() => onSetAssets(() => setCame((n) => n + 1)), []);
  const lighting = lightingOf(scene);
  useEffect(() => {
    const def = styleDef(style);
    const three = get();
    const round = surroundings(scene.set, lighting, style, three.gl);
    three.scene.background = round?.background ?? ((def.paper && paperTexture()) || new THREE.Color(def.background));
    three.scene.environment = round?.environment ?? null;
    three.scene.environmentIntensity = round?.intensity ?? 1;
    three.scene.backgroundIntensity = round?.backgroundIntensity ?? 1;
    three.gl.toneMapping = def.filmic ? TONE_MAPPING : THREE.NoToneMapping;
    wake();
  }, [get, style, scene.set, lighting, came]);
  return null;
}

/**
 * The scene's lights + shadow floor, re-aimed when the scene or its lighting changes, and (a fill
 * or a rim placed for the shot, #17) as the shot's camera turns: the cut, its move.
 */
function Lights({ sv, style, scene, time, clock }: { sv: SceneView; style: Style; scene: Scene; time: number; clock: Clock }) {
  const rig = useMemo(() => new LightRig(), []);
  const stale = useRef(true);
  const facing = useRef(NaN);
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => { stale.current = true; }, [scene, scene.lighting, style]);
  // Aim at render time, after the scene has been synced.
  useFrame(() => {
    const lighting = lightingOf(scene);
    const shot = lighting.lights.some((l) => l.relative) ? cameraAt(scene, scene.animation ? (clock.playing ? clock.time : time) : 0) : undefined;
    const az = shot ? Math.round(Math.atan2(shot.position.x - shot.target.x, shot.position.z - shot.target.z) * 90 / Math.PI) : NaN;
    if (az !== facing.current && !(Number.isNaN(az) && Number.isNaN(facing.current))) { facing.current = az; stale.current = true; }
    if (!stale.current) return;
    stale.current = false;
    sv.set?.castShadows(!lighting.environment?.indoors);
    sv.ink.setLight(rig.update(lighting, style, sv.bounds(), sv.setBounds(), sv.aimAt, shot), rig.tint, rig.extras);
  });
  return <primitive object={rig.object} />;
}

/** While playing, pose the figures for the clock's time on every frame (without touching the document). */
function Playback({ sv, scene, clock }: { sv: SceneView; scene: Scene; clock: Clock }) {
  useFrame(() => {
    // (Playing: as the scene plays, idle life in the gaps.)
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

/** Translucent ghosts of the previous (blue) and next (orange) keys. */
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
  // (Resized, the canvas is cleared: drawn again at its new size, whenever the resize comes —
  // the panels hidden or shown, the window resized, the timeline opened.)
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  useEffect(() => wake(), [size, dpr]);
  useEffect(() => {
    setDrawer(invalidate);
    const up = () => wake();
    // (The pointer on the canvas; or anywhere while a button is held: a drag begun on it goes on
    // past its edge, following the pointer on the window.)
    const pointer = (e: PointerEvent) => { if (e.buttons || e.type !== 'pointermove' || e.target === el) wake(); };
    const offs = [store.subscribe(up), clock.subscribe(up), sv.subscribe(up), onModels(up), onSetAssets(up)];
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

/**
 * Takes over R3F's render loop to add the interior line-art pass; in Pixel, what is drawn (the
 * scene and its lights) goes through the pixel pass and what is drawn over it (handles, gizmos,
 * tags) stays sharp on top.
 */
const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });

function LineArtRenderer({ sv, lineWidth, style }: { sv: SceneView; lineWidth: number; style: Style }) {
  const pass = useMemo(() => new LineArtPass(), []);
  const pixels = useMemo(() => new PixelPass(), []);
  useEffect(() => () => pixels.dispose(), [pixels]);
  const real = useMemo(() => new RealPass(), []);
  useEffect(() => () => real.dispose(), [real]);
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
    const { pixel, filmic } = styleDef(style);
    if (!pixel && !filmic) {
      gl.render(scene, camera);
      pass.overlay(gl);
      return;
    }
    const drawn = scene.children.filter((o) => o.userData.drawn && o.visible);
    const over = scene.children.filter((o) => !o.userData.drawn && o.visible);
    for (const o of over) o.visible = false;
    if (filmic) real.render(gl, scene, camera);
    else {
      pixels.begin(gl, pixel!);
      gl.render(scene, camera);
      pass.overlay(gl);
      pixels.end(gl);
    }
    const background = scene.background;
    scene.background = null;
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    // What was drawn into the picture leaves its depth behind first (no colour), so what is drawn
    // over it (the grid, the handles) is hidden behind the figures as it is in the other styles.
    gl.clearDepth();
    scene.overrideMaterial = depthOnly;
    gl.render(scene, camera);
    scene.overrideMaterial = null;
    for (const o of over) o.visible = true;
    for (const o of drawn) o.visible = false;
    gl.render(scene, camera);
    gl.autoClear = autoClear;
    scene.background = background;
    for (const o of drawn) o.visible = true;
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
  const lampOf = useCallback((id: string) => { const l = lightingRef.current.lights.find((x) => x.id === id); return l ? handleAt(lightDome(sv.bounds(), sv.setBounds()), l) : null; }, [sv]);
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
      labelAt: (sel) => {
        if (sel.kind === 'light') return lampOf(sel.light);
        if (sel.kind === 'figure' || sel.kind === 'joint') {
          // (A joint's too: clear of its gizmo.)
          // Above the head (cheap enough to follow every frame).
          const m = sv.figures.get(sel.figure);
          if (!m || !m.object.visible && !sv.models.get(sel.figure)) return null;
          const head = m.joints.head.getWorldPosition(new THREE.Vector3());
          return head.setY(head.y + 0.22 * m.object.scale.y);
        }
        let o: THREE.Object3D | undefined;
        if (sel.kind === 'prop') o = sv.props.get(sel.prop)?.object;
        // (A camera where it is now; at one of its path's points, that point's glyph, drawn there instead.)
        else if (sel.kind === 'camera') {
          rigRef.current?.traverse((x) => { if (!o && x.visible && x.userData.camera === sel.camera && x.userData.point === undefined) o = x; });
          rigRef.current?.traverse((x) => { if (!o && x.visible && x.userData.camera === sel.camera) o = x; });
        }
        if (!o) return null;
        let shown = true;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) shown &&= p.visible;
        if (!shown) return null;
        const box = new THREE.Box3().setFromObject(o);
        if (box.isEmpty()) return null;
        const c = box.getCenter(new THREE.Vector3());
        return new THREE.Vector3(c.x, box.max.y, c.z);
      },
      labelPoint: (sel) => {
        const at = apiRef.current?.labelAt(sel);
        // (Behind the view: not on screen.)
        return at && at.clone().project(camera).z <= 1 ? toScreen(at) : null;
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
        // (The floor under the set where it is met first, a wall, a sofa: not the floor beyond it.)
        const met = sv.set?.meet(ray);
        const floor = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
        if (met && (!floor || met.distance < ray.ray.origin.distanceTo(floor))) hit.floor = [met.point.x, 0, met.point.z];
        else if (floor) hit.floor = [floor.x, 0, floor.z];
        // (A set's top under it, a dais, a table, a seat: stood or sat on there. Its furniture met first, as
        // a view from about eye level meets a sofa's back or its cushions' front: the seat nearest there.)
        let top = topUnder(sv.set?.id, ray.ray);
        if (met && met.point.y > 0.05 && (!top || met.distance < ray.ray.origin.distanceTo(new THREE.Vector3(...top)) - 0.05)) top = seatNear(sv.set!.id, met.point.toArray());
        if (top) hit.top = top;
        // A camera (or one of its points) in front of everything: it is drawn over the scene.
        for (const { object } of rigRef.current ? ray.intersectObject(rigRef.current, true) : []) {
          let o: THREE.Object3D | null = object;
          while (o && !o.userData.camera) o = o.parent;
          if (o?.visible) return { ...hit, camera: o.userData.camera as string, ...(o.userData.point !== undefined ? { point: o.userData.point as number } : {}) };
        }
        const under = ray.intersectObject(sv.root, true);
        for (const { object, point } of under) {
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
            // (The part under it, as a click finds it.)
            const part = partUnder(under, (x) => x.userData.figure === id);
            return { ...hit, figure: id, ...(part?.userData.joint ? { joint: part.userData.joint as JointName } : {}), ...(m && f && !f.proxy ? { contact: nearestContact(m, f, point).contact } : {}) };
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
      // (A light, a camera or a part of a figure: close up round it, in the middle.)
      const [kind, id, part] = typeof only === 'string' && /^(light|camera|joint):/.test(only) ? only.split(':') : [];
      let near: THREE.Vector3 | null = null;
      let reach = 0.8;
      if (kind === 'light') near = lampOf(id);
      else if (kind === 'camera') rigRef.current?.traverse((x) => { if (!near && x.visible && x.userData.camera === id) near = x.getWorldPosition(new THREE.Vector3()); });
      else if (kind === 'joint') {
        const m = sv.figures.get(id);
        near = m?.joints[part as JointName]?.getWorldPosition(new THREE.Vector3()) ?? null;
        reach = 0.35 * (m?.object.scale.y ?? 1);
      }
      // (A light with the people it lights: what it does is seen on them, and a sun's lamp is far above them.)
      const around = near && { forEachPoint: (cb: (p: THREE.Vector3) => void) => {
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cb(near!.clone().add(new THREE.Vector3(x, y, z).multiplyScalar(reach)));
        if (kind === 'light') sv.forEachPoint(cb, true);
      } };
      const ids = kind ? [] : typeof only === 'string' ? [only] : only ?? [];
      const things = ids.flatMap((id) => { const t = sv.figures.get(id) ?? sv.props.get(id); return t ? [t] : []; });
      const one = things.length ? { forEachPoint: (cb: (p: THREE.Vector3) => void) => things.forEach((t) => t.forEachPoint(cb)) } : undefined;
      const source = around ?? one ?? sv;
      const fit = (cam: THREE.PerspectiveCamera, yaw: number) => fitCamera(cam, source, { yaw, pitch: view.pitch, fov: view.fov ?? 35 }, around ? 0.1 : one ? 0.45 : 0.2);
      // (In a set, from the angle nearest the one asked for whose view of the people no wall or
      // pillar of the set stands across: the angle a scene is filmed from may look in from outside.)
      let yaw = view.yaw;
      if (sv.set) {
        const trial = (camera as THREE.PerspectiveCamera).clone();
        // (From its front first, which a set leaves open, the side nearest the angle asked for; else round.)
        const from = Math.abs(view.yaw) <= 60 ? view.yaw : Math.sign(view.yaw) * 45;
        const clear = [0, 15, -15, 30, -30, 45, -45, 60, -60, 90, -90, 120, -120, 150, -150, 180].find((turn) => !setBetween(sv.set!.object, trial.position, fit(trial, from + turn)));
        yaw = from + (clear ?? 0);
      }
      controls.target.copy(fit(camera as THREE.PerspectiveCamera, yaw));
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
    // (When another scene opens, or the controls come: not as the view or the scene's contents change.)
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
    // (As looking through begins or ends: the free view kept, and given back, then only.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotMode, get]);

  useEffect(() => {
    if (frameRequest.n === 0) return;
    const id = frame(frameRequest.view, frameRequest.only);
    return () => cancelAnimationFrame(id);
    // (Each new request, framed as the scene is then.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest]);

  return null;
}
