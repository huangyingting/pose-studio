import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Check, Footprints, Undo2 } from 'lucide-react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from './Line';
import { useSettled } from './useSettled';
import { fitWarp, moveMark, offsetPerformance } from '@/lib/actions';
import { actionsOf, figureRootAt, footprints, marksOf, overWarp } from '@/lib/evaluate';
import { angle, facingOf, nearer } from '@/lib/pose';
import { CONTACT_LABELS, contactPoint, type Contact } from '@/lib/relations';
import { holdOn, holdProp } from '@/lib/actions';
import { HOLDABLE } from '@/lib/hold';
import { partKeys } from '@/lib/clip';
import { legsOf } from '@/lib/locomotion';
import { groundOf } from '@/lib/surfaces';
import { IK_CHAINS, bodyFollows, setWorldQuaternion, type Chain, type Mannequin } from '@/lib/mannequin';
import type { Hover, SceneView } from '@/lib/sceneview';
import type { Store } from '@/lib/store';
import { JOINTS, type Figure, type JointName, type Scene, type Vec3 } from '@/lib/types';
import { jointLimits, wrapDeg } from '@/lib/joints';
import { openContextMenu } from './ContextMenu';
import { bodyHint, jointText, limitText, metres, movedText, propHint, ringHint, setPointerHint, setReadout, sliderText, turnedText } from './hints';
import { STEPS, fine, heldAxis, lockOf, snap, snapping } from './modifiers';

/*
 * Direct manipulation on the canvas. The things themselves are the handles:
 *   drag a prop, a stand-in or a figure's torso   → move it on the floor
 *   drag a hand or a foot                         → move it, the limb follows (IK)
 *   drag any other body part (limbs, neck, head)  → swing it from its joint
 *   drag the ring on the floor                    → turn the figure or prop (Ctrl: 15° steps)
 * A click (no drag) still selects, for the gizmo and the inspector. Alt-drag always orbits.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const DRAG_PX = 4;
const ENDS: Partial<Record<JointName, keyof typeof IK_CHAINS>> = { leftHand: 'leftHand', rightHand: 'rightHand', leftFoot: 'leftFoot', rightFoot: 'rightFoot' };

type Controls = { enabled: boolean } | null;

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
      /** Where a point is on screen (client coordinates). */
      screen(p: THREE.Vector3) {
        const { camera, gl } = get();
        const r = gl.domElement.getBoundingClientRect();
        const v = p.clone().project(camera);
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      camera: () => get().camera,
      size: () => get().size,
    };
  }, [get]);
}

/** Move an IK chain's end toward `target`, but no part of the figure below the floor; a hand bringing the body along if asked. */
function reachAboveFloor(m: Mannequin, chain: Chain, target: THREE.Vector3, endQ: THREE.Quaternion, limits: boolean, follow = false) {
  if (follow && chain[2].endsWith('Hand')) bodyFollows(m, chain, target, limits);
  m.solveIK(chain, target, endQ, limits);
  const below = m.lowest();
  if (below < 0) m.solveIK(chain, target.setY(target.y - below), endQ, limits);
}

/** Apply a rotation unless it would put part of the figure through the floor (then the step is undone). */
function keepAboveFloor(m: Mannequin, obj: THREE.Object3D, rotate: () => void, chain?: Chain) {
  const joints = (chain ?? []).map((j) => m.joints[j]);
  const before = [obj, ...joints].map((o) => o.quaternion.clone());
  const was = m.lowest();
  rotate();
  // Already below (e.g. a figure placed that way) allows any move that does not make it worse.
  if (m.lowest() >= Math.min(0, was) - 0.002) return;
  [obj, ...joints].forEach((o, i) => o.quaternion.copy(before[i]));
  m.object.updateMatrixWorld(true);
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

/** The parts a hand or foot rests on (a palm on a hip, on a knee, on a shoulder, on the head). */
const RESTED_ON = new Set<JointName>(['hips', 'spine', 'chest', 'upperChest', 'leftShoulder', 'rightShoulder', 'head', 'leftUpperLeg', 'rightUpperLeg']);

/**
 * The part a press or click under the pointer takes (`usable`: not one to reach past, a
 * see-through prop): the nearest; but a hand or foot of the same figure just behind it, resting on
 * the body (up to 8 cm in, as a palm on a hip is), that, as it is what one reaches for there.
 */
export function partUnder(intersections: THREE.Intersection[], usable: (o: THREE.Object3D) => boolean) {
  const hits = intersections.map((i) => ({ o: tagged(i.object), d: i.distance })).filter((h) => h.o && usable(h.o));
  const first = hits[0];
  if (!first) return null;
  // (Only on what a hand or foot rests on: not a forearm or shin in front of the other one.)
  const restsOn = RESTED_ON.has(first.o!.userData.joint as JointName);
  const end = !restsOn ? undefined : hits.find((h) => h.d - first.d < 0.08 && h.o!.userData.figure === first.o!.userData.figure && ENDS[h.o!.userData.joint as JointName]);
  return (end ?? first).o!;
}

/** " · 0.80 m from Kai": how far a figure stands from the nearest other one. */
export function nearestText(sv: SceneView, scene: Scene, id: string, at: THREE.Vector3) {
  let best: { name: string; d: number } | null = null;
  for (const f of scene.figures) {
    const m = f.id !== id && !f.hidden ? sv.figures.get(f.id) : undefined;
    if (!m) continue;
    const p = m.joints.hips.position;
    const d = Math.hypot(p.x - at.x, p.z - at.z);
    if (!best || d < best.d) best = { name: f.name, d };
  }
  return best ? ` · ${metres(best.d)} m from ${best.name}` : '';
}

/** The points of a body a hand can hold on to, as Reach knows them. */
const HOLDS: Contact[] = ['head', 'leftUpperArm', 'rightUpperArm', 'chest', 'back', 'waist', 'leftHand', 'rightHand'];

/** The point of a figure's body a hand would hold on to, nearest a point on it. */
export function nearestContact(m: Mannequin, f: Figure, p: THREE.Vector3) {
  return HOLDS.map((contact) => ({ contact, at: contactPoint(m, f, contact) })).reduce((b, x) => (x.at.distanceTo(p) < b.at.distanceTo(p) ? x : b));
}

/**
 * A hand dragged over someone else's body: the point it would hold on to there (within reach of
 * the pointer), the hint offering it. Let go there, it holds on (a hold from the playhead).
 */
function holdTarget(sv: SceneView, scene: Scene, figure: string, ray: THREE.Ray): { prop: string; at: THREE.Vector3 } | { figure: string; contact: Contact; at: THREE.Vector3 } | null {
  setPointerHint(null);
  const hits = new THREE.Raycaster(ray.origin, ray.direction).intersectObject(sv.root, true);
  for (const h of hits) {
    const o = tagged(h.object);
    if (!o) continue;
    // A prop that can be held, free: picked up (a prop in front hides who is behind it).
    if (o.userData.prop) {
      const p = scene.props.find((x) => x.id === o.userData.prop);
      if (!p || p.hold || !HOLDABLE.includes(p.kind)) return null;
      setPointerHint(`Let go: pick up ${p.name}`);
      return { prop: p.id, at: h.point.clone() };
    }
    const id = o.userData.figure as string;
    if (id === figure) continue;
    const f = scene.figures.find((x) => x.id === id);
    const m = sv.figures.get(id);
    if (!f || !m || f.proxy) return null;
    const near = nearestContact(m, f, h.point);
    if (near.at.distanceTo(h.point) > 0.25 * (f.body.height / 1.8)) return null;
    setPointerHint(`Let go: hold on to ${f.name}'s ${CONTACT_LABELS[near.contact].toLowerCase()}`);
    return { figure: id, ...near };
  }
  return null;
}

/** A hand let go on what `holdTarget` found: it holds on to someone there, or picks the prop up (from the playhead). */
function letGoOn(store: Store, scene: Scene, figure: string, hand: JointName, on: NonNullable<ReturnType<typeof holdTarget>>) {
  const side = hand === 'leftHand' ? 'L' : 'R';
  if ('prop' in on) holdProp(store, on.prop, { figure, hand: side });
  else if (!holdOn(store, figure, side, on.figure, on.contact)) setPointerHint(`${scene.figures.find((f) => f.id === on.figure)?.name} is out of reach`);
}

/** A readout of a joint's value as it is dragged, from its value when the drag began. */
function jointReadout(m: Mannequin, joint: JointName) {
  const before = angle(m.read().bones, joint);
  let last = before;
  return () => {
    last = angle(m.read().bones, joint, last);
    setReadout(jointText(joint, before, last));
  };
}

/** A prop's readout as it is moved: how far, and its height (with a line down to the floor) when it is off the floor. */
function propReadout(start: THREE.Vector3, now: THREE.Vector3) {
  const high = now.y > 0.005;
  setReadout(movedText(now.x - start.x, now.z - start.z, now.x, now.z) + (high ? ` · ${metres(now.y)} m high` : ''), high ? [now.x, now.y, now.z] : undefined);
}

/** A joint's slider values as its rig holds them now (the angles nearest `near`). */
const valuesOf = (obj: THREE.Object3D, joint: JointName, near: Vec3 = [0, 0, 0]) => nearer(joint, [obj.rotation.x * R2D, obj.rotation.y * R2D, obj.rotation.z * R2D], near);

/** The world axis a joint's slider turns it about, with the joint at `v`. */
function sliderAxis(obj: THREE.Object3D, v: Vec3, axis: number) {
  const e = new THREE.Euler(v[0] * D2R, v[1] * D2R, v[2] * D2R, obj.rotation.order);
  const q0 = new THREE.Quaternion().setFromEuler(e);
  e[(['x', 'y', 'z'] as const)[axis]] += 1e-3;
  const dq = new THREE.Quaternion().setFromEuler(e).multiply(q0.invert());
  return new THREE.Vector3(dq.x, dq.y, dq.z).normalize().applyQuaternion(obj.parent!.getWorldQuaternion(new THREE.Quaternion()));
}

/**
 * One of a joint's sliders turned by a drag: the value follows the pointer's travel along the way
 * the grabbed point goes on screen as the value grows, so a rough straight drag works. Ctrl: 5°
 * steps; Shift: a fifth of the speed. With the limits on, it stops at them (`limit` says where).
 */
function sliderDrag(m: Mannequin, joint: JointName, axis: number, grab: THREE.Vector3, camera: THREE.Camera, size: { width: number; height: number }, limits: boolean) {
  const obj = m.joints[joint];
  const start = valuesOf(obj, joint);
  const pivot = obj.getWorldPosition(new THREE.Vector3());
  const screen = (p: THREE.Vector3) => {
    const v = p.clone().project(camera);
    return new THREE.Vector2(((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height);
  };
  // Where the grabbed point goes on screen for 1° more.
  const way = screen(grab.clone().sub(pivot).applyAxisAngle(sliderAxis(obj, start, axis), D2R).add(pivot)).sub(screen(grab));
  const perDegree = Math.max(way.length(), 0.5);
  way.normalize();
  let last = start;
  return (dx: number, dy: number, steps: boolean, slow: boolean) => {
    let v = start[axis] + ((dx * way.x + dy * way.y) / perDegree) * (slow ? 0.2 : 1);
    if (steps) v = snap(v, STEPS.joint);
    const [lo, hi] = limits ? jointLimits(joint)[axis] : [-Infinity, Infinity];
    const value = limits ? Math.min(hi, Math.max(lo, v)) : wrapDeg(v);
    const next: Vec3 = [...start];
    next[axis] = value;
    keepAboveFloor(m, obj, () => {
      obj.rotation.set(next[0] * D2R, next[1] * D2R, next[2] * D2R);
      obj.updateMatrixWorld(true);
    });
    last = valuesOf(obj, joint, last);
    return { value: last[axis], limit: limits && value !== v ? value : null };
  };
}


type Plan = { begin(): void; move(ray: THREE.Ray, dx: number, dy: number, e: PointerEvent): void; end(): void; cursor: string };

/** What a press on a part would move. */
type Target =
  | { kind: 'prop'; prop: string }
  | { kind: 'held'; prop: string; figure: string; wrist: 'leftHand' | 'rightHand' }
  | { kind: 'body'; figure: string }
  | { kind: 'pelvis'; figure: string }
  | { kind: 'end' | 'swing'; figure: string; joint: JointName };

/** Degrees per pixel when Shift-dragging to twist or turn. */
const TWIST = 0.5;

/**
 * The scene's figures and props, draggable (Shift-drag twists a part around itself, or turns a
 * figure or prop). What a drag would move is tinted under the pointer. Pressing starts nothing
 * until the pointer moves a few pixels, so a click still selects and the gizmo keeps its drags.
 */
export function SceneObjects({ sv, store, scene, limits, handles, gizmoActive, playing, onClick }: {
  sv: SceneView;
  store: Store;
  scene: Scene;
  limits: boolean;
  /** Whether the handles (a joint's rotate gizmo, the floor rings) are on: the hint says how to show them if not (not through the shot camera, which never shows them). */
  handles: boolean;
  /** Whether the gizmo is being dragged (a press on it also lands on the objects behind). */
  gizmoActive(): boolean;
  /** Whether the scene is playing: nothing under the pointer is tinted or hinted at then. */
  playing(): boolean;
  onClick(e: ThreeEvent<MouseEvent>): void;
}) {
  const pointer = usePointer();

  const target = (o: THREE.Object3D): Target | null => {
    if (o.userData.prop) {
      const prop = o.userData.prop as string;
      // See-through (it blocks the view of the figure being edited): reach past it.
      if (sv.props.get(prop)?.parts.faded) return null;
      const hold = scene.props.find((p) => p.id === prop)?.hold;
      return hold && sv.figures.has(hold.figure)
        ? { kind: 'held', prop, figure: hold.figure, wrist: hold.hand === 'L' ? 'leftHand' : 'rightHand' }
        : { kind: 'prop', prop };
    }
    const figure = o.userData.figure as string;
    const joint = o.userData.joint as JointName;
    // The whole figure (a stand-in, or among several): it moves. (One picked moves by its gizmo; a
    // drag on it poses the part under the pointer, picked or not.)
    const sel = store.getState().selection;
    if (scene.figures.find((f) => f.id === figure)?.proxy || (sel?.kind === 'many' && sel.figures.includes(figure))) return { kind: 'body', figure };
    // The tool (#38): Move places the whole figure, Rotate turns any part at its joint; Pose: the
    // hips sink or shift on the planted feet, a hand or foot reaches, any other part swings.
    const tool = store.getState().tool;
    if (tool === 'move') return { kind: 'body', figure };
    if (tool === 'rotate') return { kind: 'swing', figure, joint };
    if (joint === 'hips') return { kind: 'pelvis', figure };
    return { kind: ENDS[joint] ? 'end' : 'swing', figure, joint };
  };

  /** The parts a drag would move, for the hover tint. */
  const hover = (t: Target, twist: boolean): Hover => {
    if (t.kind === 'prop') return { prop: t.prop };
    const m = sv.figures.get(t.figure);
    if (!m) return null;
    if (t.kind === 'held') return { prop: t.prop, figure: t.figure, joints: m.jointsUnder(twist ? t.wrist : IK_CHAINS[t.wrist][0]) };
    if (t.kind === 'body' || t.kind === 'pelvis') return { figure: t.figure };
    return { figure: t.figure, joints: m.jointsUnder(t.kind === 'end' && !twist ? IK_CHAINS[ENDS[t.joint]!][0] : t.joint) };
  };

  const plan = (t: Target, point: THREE.Vector3, twist: boolean, axis?: number): Plan | null => {
    const camera = pointer.camera();
    const facingPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), point);
    const hit = (ray: THREE.Ray, plane: THREE.Plane) => ray.intersectPlane(plane, new THREE.Vector3());
    // Across the floor (#38): the spot it stands on goes where the floor is under the pointer, kept
    // as far from it on screen as at the press. The spot is on the floor, below the horizon from
    // any view above it: a plane at the grabbed point's height ran away as the view came level with
    // it (a few pixels were hundreds of metres), and pushed away from a view below it. Not followed
    // near the horizon.
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const across = (spot: THREE.Vector3) => {
      const at = pointer.screen(spot);
      const level = new THREE.Plane(new THREE.Vector3(0, 1, 0), -spot.y);
      const far = 6 * Math.max(1, eye.distanceTo(spot));
      return (dx: number, dy: number): { x: number; z: number } | null => {
        const h = hit(pointer.ray(at.x + dx, at.y + dy), level);
        return h && h.distanceTo(eye) <= far ? { x: h.x - spot.x, z: h.z - spot.z } : null;
      };
    };

    // One of several selected: they all move (or, Shift-dragged, turn about their middle) together.
    const sel = store.getState().selection;
    if (sel?.kind === 'many' && (t.kind === 'prop' ? sel.props.includes(t.prop) : t.kind === 'body' && sel.figures.includes(t.figure))) {
      const things = [
        ...sel.figures.flatMap((id) => { const m = sv.figures.get(id); return m ? [{ obj: m.joints.hips, top: m.object, commit: () => store.updateFigure(id, (f) => ({ ...f, ...m.read() })) }] : []; }),
        // (A prop in a hand goes with the hand: not moved again.)
        ...sel.props.filter((id) => !scene.props.find((x) => x.id === id)?.hold).flatMap((id) => { const p = sv.props.get(id); return p ? [{ obj: p.object, top: p.object, commit: () => store.updateProp(id, (doc) => ({ ...doc, ...p.read() })) }] : []; }),
      ].map((x) => ({ ...x, p: x.obj.position.clone(), q: x.obj.quaternion.clone() }));
      const middle = things.reduce((m, x) => m.add(x.p), new THREE.Vector3()).divideScalar(Math.max(1, things.length));
      const slide = across(new THREE.Vector3(middle.x, 0, middle.z));
      const up = new THREE.Vector3(0, 1, 0);
      return {
        cursor: twist ? 'ew-resize' : 'move',
        begin: () => {},
        move: (_ray, dx, dy, e) => {
          if (twist) {
            const turn = new THREE.Quaternion().setFromAxisAngle(up, dx * TWIST * D2R);
            for (const x of things) {
              const off = x.p.clone().sub(middle).applyQuaternion(turn);
              x.obj.position.set(middle.x + off.x, x.p.y, middle.z + off.z);
              x.obj.quaternion.copy(turn).multiply(x.q);
            }
            setReadout(turnedText(dx * TWIST));
          } else {
            const d = slide(dx, dy);
            if (!d) return;
            // (Ctrl: by the 25 cm grid.)
            const [mx, mz] = snapping(e) ? [snap(d.x, STEPS.move), snap(d.z, STEPS.move)] : [d.x, d.z];
            for (const x of things) x.obj.position.set(x.p.x + mx, x.p.y, x.p.z + mz);
            setReadout(movedText(mx, mz, middle.x + mx, middle.z + mz));
          }
          for (const x of things) x.top.updateMatrixWorld(true);
        },
        // (One undo step.)
        end: () => store.group(() => things.forEach((x) => x.commit())),
      };
    }

    if (t.kind === 'prop') {
      const p = sv.props.get(t.prop);
      if (!p) return null;
      const start = p.object.position.clone();
      const yaw = p.object.rotation.y;
      // (Its base, where it stands.)
      const slide = across(p.object.getWorldPosition(new THREE.Vector3()));
      return {
        cursor: twist ? 'ew-resize' : 'move',
        begin: () => store.select({ kind: 'prop', prop: t.prop }),
        move: (_ray, dx, dy, e) => {
          if (twist) {
            p.object.rotation.y = yaw + dx * TWIST * D2R;
            setReadout(turnedText(dx * TWIST));
          } else {
            const d = slide(dx, dy);
            if (!d) return;
            const [x, z] = [start.x + d.x, start.z + d.z];
            // (Ctrl: on the 25 cm grid.)
            p.object.position.set(snapping(e) ? snap(x, STEPS.move) : x, start.y, snapping(e) ? snap(z, STEPS.move) : z);
            propReadout(start, p.object.position);
          }
          p.object.updateMatrixWorld(true);
        },
        end: () => store.updateProp(t.prop, (doc) => ({ ...doc, ...p.read() })),
      };
    }

    const m = sv.figures.get(t.figure);
    if (!m) return null;
    const commit = () => {
      m.setGroundLock(false);
      store.updateFigure(t.figure, (f) => ({ ...f, ...m.read() }));
    };

    if (t.kind === 'body') {
      const root = m.joints.hips;
      const start = root.position.clone();
      const yaw = root.rotation.y;
      // (The spot under its hips, at its feet.)
      const hips = root.getWorldPosition(new THREE.Vector3());
      const slide = across(new THREE.Vector3(hips.x, Math.max(0, m.lowest()), hips.z));
      return {
        cursor: twist ? 'ew-resize' : 'move',
        begin: () => {
          // (Among several: they stay picked, and move together.)
          const sel = store.getState().selection;
          if (!(sel?.kind === 'many' && sel.figures.includes(t.figure))) store.select({ kind: 'figure', figure: t.figure });
        },
        move: (_ray, dx, dy, e) => {
          if (twist) {
            root.rotation.y = yaw + dx * TWIST * D2R;
            setReadout(turnedText(dx * TWIST));
          } else {
            const d = slide(dx, dy);
            if (!d) return;
            const [x, z] = [start.x + d.x, start.z + d.z];
            // (Ctrl: on the 25 cm grid.)
            root.position.set(snapping(e) ? snap(x, STEPS.move) : x, start.y, snapping(e) ? snap(z, STEPS.move) : z);
            const r = root.position;
            setReadout(movedText(r.x - start.x, r.z - start.z, r.x, r.z) + nearestText(sv, scene, t.figure, r));
          }
          m.object.updateMatrixWorld(true);
        },
        // (The Move tool in an animated scene places the whole performance, as Starts at does,
        // its partners in a shared motion with it; a key or a correction is Pose's.)
        end: () => {
          if (!store.scene.animation || store.getState().tool !== 'move') return commit();
          m.setGroundLock(false);
          const r = root.position;
          offsetPerformance(store, [t.figure], { dx: r.x - start.x, dz: r.z - start.z, turn: (root.rotation.y - yaw) * R2D, about: [start.x, start.z] });
        },
      };
    }

    if (t.kind === 'pelvis' && !twist && axis === undefined) {
      // The hips moved (lowered into a squat, shifted, raised): the feet stay where they are.
      const root = m.joints.hips;
      const plane = facingPlane;
      const rootStart = root.position.clone();
      const feet = (['leftFoot', 'rightFoot'] as const).map((f) => ({ id: f, pos: m.joints[f].getWorldPosition(new THREE.Vector3()), q: m.joints[f].getWorldQuaternion(new THREE.Quaternion()) }));
      const plant = () => {
        m.object.updateMatrixWorld(true);
        for (const f of feet) m.solveIK(IK_CHAINS[f.id], f.pos, f.q, limits);
      };
      return {
        cursor: 'grabbing',
        begin: () => { m.setGroundLock(true); store.select({ kind: 'joint', figure: t.figure, joint: 'hips' }); },
        move: (ray) => {
          const h = hit(ray, plane);
          if (!h) return;
          root.position.copy(rootStart).add(h.sub(point));
          plant();
          // The hips go down only until the body meets the floor.
          const below = m.lowest();
          if (below < 0) {
            root.position.setY(root.position.y - below);
            plant();
          }
          setReadout(`Pelvis ${metres(root.getWorldPosition(new THREE.Vector3()).y)} m high`);
        },
        end: commit,
      };
    }

    const joint = t.kind === 'held' ? t.wrist : t.kind === 'pelvis' ? 'hips' : t.joint;
    const select = () => store.select(t.kind === 'held' ? { kind: 'prop', prop: t.prop } : { kind: 'joint', figure: t.figure, joint });

    if (axis !== undefined && t.kind !== 'held') {
      // One slider of the part's joint.
      const drag = sliderDrag(m, joint, axis, point, camera, pointer.size(), limits);
      return {
        cursor: 'grabbing',
        begin: () => { m.setGroundLock(true); select(); },
        move: (_, dx, dy, e) => {
          const r = drag(dx, dy, snapping(e), fine(e));
          setReadout(r.limit !== null ? limitText(joint, r.limit) : sliderText(joint, axis, r.value), undefined, axis);
        },
        end: commit,
      };
    }
    const obj = m.joints[joint];
    const startQ = obj.getWorldQuaternion(new THREE.Quaternion());
    const q = new THREE.Quaternion();

    if (twist) {
      // Around the part's own length: towards its child joint, or along the hand / foot / head.
      const pivot = obj.getWorldPosition(new THREE.Vector3());
      const child = m.jointsUnder(joint)[1];
      const axis = child
        ? m.joints[child].getWorldPosition(new THREE.Vector3()).sub(pivot).normalize()
        : new THREE.Vector3(0, joint === 'head' ? 1 : -1, 0).applyQuaternion(startQ);
      const readout = jointReadout(m, joint);
      return {
        cursor: 'ew-resize',
        begin: () => { m.setGroundLock(true); select(); },
        move: (_, dx) => {
          keepAboveFloor(m, obj, () => {
            setWorldQuaternion(obj, q.setFromAxisAngle(axis, dx * TWIST * D2R).multiply(startQ));
            if (limits) m.constrain([joint]);
          });
          readout();
        },
        end: commit,
      };
    }

    if (t.kind === 'held' || t.kind === 'end') {
      // A hand or a foot (or what a hand holds): it follows the pointer and keeps its orientation.
      const chain = IK_CHAINS[t.kind === 'held' ? t.wrist : ENDS[t.joint]!];
      const grab = obj.getWorldPosition(new THREE.Vector3()).sub(point);
      // (The elbow or knee is what the reach bends.)
      const readout = jointReadout(m, chain[1]);
      // A bare hand let go on someone: it holds on there.
      const hand = t.kind === 'end' && (t.joint === 'leftHand' || t.joint === 'rightHand') ? t.joint : null;
      let onto: ReturnType<typeof holdTarget> = null;
      return {
        cursor: 'grab',
        begin: () => { m.setGroundLock(true); select(); },
        move: (ray) => {
          onto = hand ? holdTarget(sv, scene, t.figure, ray) : null;
          const h = onto ? onto.at.clone() : hit(ray, facingPlane)?.add(grab);
          if (!h) return;
          reachAboveFloor(m, chain, h, startQ, limits, store.getState().settings.bodyFollows);
          if (!onto) readout();
        },
        // (The pose and the hold: one undo step.)
        end: () => store.group(() => {
          commit();
          if (hand && onto) letGoOn(store, scene, t.figure, hand, onto);
        }),
      };
    }

    // Any other part swings from its joint so that the grabbed point follows the pointer.
    const pivot = obj.getWorldPosition(new THREE.Vector3());
    const from = point.clone().sub(pivot).normalize();
    const readout = jointReadout(m, joint);
    return {
      cursor: 'grab',
      begin: () => { m.setGroundLock(true); select(); },
      move: (ray, _dx, _dy, e) => {
        const h = hit(ray, facingPlane);
        if (!h) return;
        const to = h.sub(pivot);
        if (to.lengthSq() < 1e-8) return;
        q.setFromUnitVectors(from, to.normalize());
        // Ctrl: the swing in 5° steps (about the way it swings).
        if (snapping(e)) {
          const turn = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
          if (turn > 1e-6) {
            const axis = new THREE.Vector3(q.x, q.y, q.z).multiplyScalar(Math.sign(q.w) || 1).normalize();
            q.setFromAxisAngle(axis, snap(turn * R2D, STEPS.joint) * D2R);
          }
        }
        keepAboveFloor(m, obj, () => {
          setWorldQuaternion(obj, q.clone().multiply(startQ));
          if (limits) m.constrain([joint]);
        });
        readout();
      },
      end: commit,
    };
  };

  /** The part this call of a pointer event is for: the part under the pointer (null: another object's turn, the event goes on to it). */
  const pressed = (e: ThreeEvent<PointerEvent>) => {
    const chosen = partUnder(e.intersections, (o) => target(o) !== null);
    return chosen && tagged(e.object) === chosen ? chosen : null;
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || e.altKey) return;
    // Handles drawn over the body (the light's lamp) take precedence.
    if (e.intersections.some((i) => i.object.userData.handle)) return;
    const o = pressed(e);
    const t = o && target(o);
    if (!t) return;
    e.stopPropagation();
    const twist = e.shiftKey;
    const point = e.point.clone();
    const first = plan(t, point, twist, heldAxis());
    if (!first) return;
    let p: Plan = first;
    const [x0, y0] = [e.nativeEvent.clientX, e.nativeEvent.clientY];
    let started = false;
    let cancelled = false;
    pointer.orbit(false);
    // 1, 2 or 3 (or X, Y, Z) pressed during a part's drag: from where it began, on that slider only.
    const m = t.kind === 'end' || t.kind === 'swing' ? sv.figures.get(t.figure) : undefined;
    const pose = m ? JOINTS.map((j) => m.joints[j].quaternion.clone()) : [];
    const lockKey = (ev: KeyboardEvent) => {
      const axis = lockOf(ev.key);
      if (!m || axis === undefined || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.repeat) return;
      pose.forEach((q, i) => m.joints[JOINTS[i]].quaternion.copy(q));
      m.object.updateMatrixWorld(true);
      p = plan(t, point, false, axis) ?? p;
      if (started) p.begin();
    };
    window.addEventListener('keydown', lockKey, true);
    // Its pinned hands and feet (#38) held where they are as the rest is posed (not the one dragged;
    // not when the figure is moved whole).
    const fm = t.kind === 'prop' || t.kind === 'body' ? undefined : sv.figures.get(t.figure);
    const draggedEnd = t.kind === 'held' ? t.wrist : t.kind === 'end' ? ENDS[t.joint] : undefined;
    let pinned: { end: keyof typeof IK_CHAINS; at: THREE.Vector3; q: THREE.Quaternion }[] = [];
    const holdPins = () => { for (const x of pinned) fm!.solveIK(IK_CHAINS[x.end], x.at.clone(), x.q, limits); };
    follow(
      (ev) => {
        if (cancelled) return;
        if (!started) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return;
          // The press was on the gizmo: it does the dragging (and owns the orbit switch).
          if (gizmoActive()) { cancelled = true; return; }
          started = true;
          document.body.style.cursor = p.cursor === 'grab' ? 'grabbing' : p.cursor;
          sv.setHover(hover(t, twist));
          if (fm && t.kind !== 'prop' && t.kind !== 'body') {
            pinned = (store.getState().pins[t.figure] ?? []).filter((e) => e !== draggedEnd).map((end) => ({
              end, at: fm.joints[end].getWorldPosition(new THREE.Vector3()), q: fm.joints[end].getWorldQuaternion(new THREE.Quaternion()),
            }));
          }
          p.begin();
        }
        p.move(pointer.ray(ev.clientX, ev.clientY), ev.clientX - x0, ev.clientY - y0, ev);
        if (pinned.length) holdPins();
        sv.followMannequins();
      },
      () => {
        window.removeEventListener('keydown', lockKey, true);
        if (!cancelled) pointer.orbit(true);
        if (started) {
          document.body.style.cursor = '';
          setReadout(null);
          sv.setHover(null);
          store.setLinked(null);
          p.end();
        }
      },
    );
  };

  /** Show what a drag would move (and how): tint it, set the cursor. */
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.buttons || playing()) return;
    if (e.intersections.some((i) => i.object.userData.handle)) { sv.setHover(null); return; }
    const o = pressed(e);
    const t = o && target(o);
    if (!t) return;
    sv.setHover(hover(t, e.shiftKey));
    // Its row in the outline shows it too; the header's hint says what each gesture on it does.
    store.setLinked(t.kind === 'prop' || t.kind === 'held' ? t.prop : t.figure);
    const name = (id: string) => scene.figures.find((f) => f.id === id)?.name ?? scene.props.find((p) => p.id === id)?.name ?? '';
    if (t.kind === 'prop' || t.kind === 'held') setPointerHint(propHint(name(t.prop), t.kind === 'held'));
    else {
      const sel = store.getState().selection;
      const picked = (sel?.kind === 'figure' || sel?.kind === 'joint') && sel.figure === t.figure;
      const proxy = !!scene.figures.find((f) => f.id === t.figure)?.proxy;
      const body = bodyHint(name(t.figure), t.kind, t.kind === 'body' || t.kind === 'pelvis' ? undefined : t.joint, picked && !proxy, store.getState().settings.bodyFollows, !!scene.animation && store.getState().tool === 'move');
      setPointerHint(handles || t.kind === 'body' ? body : `${body} · Handles hidden: H shows the gizmo`);
    }
    document.body.style.cursor = e.shiftKey ? 'ew-resize' : t.kind === 'prop' || t.kind === 'body' ? 'move' : 'grab';
  };

  return (
    <primitive
      object={sv.root}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerOut={(e: ThreeEvent<PointerEvent>) => {
        if (e.buttons) return;
        sv.setHover(null);
        store.setLinked(null);
        setPointerHint(null);
        document.body.style.cursor = '';
      }}
    />
  );
}

/** Drag around a point on the floor to turn something; Ctrl snaps to 15° steps. */
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
        if (snapping(ev)) yaw = snap(yaw, STEPS.turn);
        yaw = ((((yaw + 180) % 360) + 360) % 360) - 180;
        turned = true;
        apply(yaw);
        setReadout(turnedText(yaw - startYaw, snapping(ev)));
      },
      () => {
        pointer.orbit(true);
        document.body.style.cursor = '';
        setReadout(null);
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
export function FigureMarkers({ sv, scene, version, active, onPick, onTurn, gizmoHot }: {
  sv: SceneView;
  scene: Scene;
  version: number;
  active: string | null;
  onPick(id: string): void;
  onTurn(id: string, read: Pick<Figure, 'bones' | 'position'>): void;
  /** Whether the pointer is on a handle of the move gizmo (on the floor too): a press there is the gizmo's. */
  gizmoHot(): boolean;
}) {
  const groups = useRef<Record<string, THREE.Group | null>>({});
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), f: new THREE.Vector3() }), []);
  const turn = useTurn();
  useFrame(() => {
    for (const f of scene.figures) {
      const g = groups.current[f.id];
      const m = sv.figures.get(f.id);
      if (!g || !m) continue;
      const root = m.joints.hips;
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
            onPointerOver={() => { if (!on) document.body.style.cursor = 'pointer'; setPointerHint(on ? ringHint(f.name) : `Click the ring: select ${f.name}`); }}
            onPointerOut={() => { if (!on) document.body.style.cursor = ''; setPointerHint(null); }}
          >
            <FloorRing
              radius={0.275 * (f.body.height / 1.8)}
              color={on ? '#3b6cff' : '#a1a1a6'}
              hit={on && !!m}
              onDown={(e) => {
                if (!m || gizmoHot()) return;
                const root = m.joints.hips;
                turn(e, root.getWorldPosition(new THREE.Vector3()), root.rotation.y * R2D, (yaw) => {
                  root.rotation.y = yaw * D2R;
                  m.object.updateMatrixWorld(true);
                  sv.followMannequins();
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


/** A mark's facing arrow: a small triangle just beyond its ring (pointing along the floor's -y before it is laid down, i.e. +z). */
const ARROW = new THREE.Shape([new THREE.Vector2(-0.06, -0.14), new THREE.Vector2(0.06, -0.14), new THREE.Vector2(0, -0.21)]);

/** A mark's number, drawn once per number. */
const numbers = new Map<number, THREE.CanvasTexture>();
function numberTexture(n: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  let tex = numbers.get(n);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#30313a';
    g.font = `600 ${n > 9 ? 30 : 38}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 32, 35);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    numbers.set(n, tex);
  }
  return tex;
}

/**
 * A figure's route while animating: its marks (where its keys put it; drag one to move it, click
 * to go to that moment), the path its body takes (in the air for a jump) and the footprints of
 * its walks and runs.
 */
export function RouteOverlay({ store, scene, figureId, time }: { store: Store; scene: Scene; figureId: string; time: number }) {
  const pointer = usePointer();
  const a = scene.animation!;
  const ground = useMemo(() => groundOf(scene.props, undefined, scene.set), [scene.props, scene.set]);
  // The path and footprints are sampled over the whole animation: worked out once a drag rests
  // (the marks, which are dragged, follow at once).
  const settled = useSettled(scene);
  const path = useMemo(() => {
    const sa = settled.animation;
    const f0 = settled.figures.find((x) => x.id === figureId);
    if (!sa || !f0) return { points: [] as [number, number, number][], prints: [] as ReturnType<typeof footprints> };
    const legs = legsOf(f0.body);
    const points: [number, number, number][] = [];
    const steps = Math.max(2, Math.ceil(sa.duration * 15));
    for (let i = 0; i <= steps; i++) {
      // (Only where this figure is: not its whole pose, nor the others' and the props'.)
      const [x, y, z] = figureRootAt(settled, figureId, (sa.duration * i) / steps)!;
      const lift = Math.max(0, y - ground(x, z) - legs.rootY);
      points.push([x, ground(x, z) + 0.012 + lift, z]);
    }
    return { points, prints: footprints(settled, figureId) };
  }, [settled, figureId, ground]);
  const route = useMemo(() => {
    // A mark where the figure gets to somewhere new: where a walk, run, jump or clip ends, or a key
    // puts it (a run of keys in one place, as in a dance, is one mark).
    const marks: { t: number; x: number; z: number; facing: number; act?: string; over: boolean }[] = [];
    for (const act of actionsOf(a, figureId)) {
      const stops = act.source.kind === 'keys'
        ? partKeys(act.source.clip.parts[0]).map((k) => ({ t: act.start + k.t, at: [k.pose.position[0], k.pose.position[2]], facing: facingOf(k.pose.bones), moved: false, act: undefined, over: false }))
        : [{ t: act.start + act.duration, ...marksOf(scene, act, figureId)!.end, moved: true, act: act.id, over: overWarp(scene, act, figureId) }];
      for (const m of stops) {
        const last = marks[marks.length - 1];
        if (!last || m.moved || Math.hypot(m.at[0] - last.x, m.at[1] - last.z) > 0.15) marks.push({ t: m.t, x: m.at[0], z: m.at[1], facing: m.facing, act: m.act, over: m.over });
      }
    }
    return { ...path, marks };
  }, [a, figureId, scene, path]);

  /** Drag a mark on the floor; a click goes there (and picks the action ending there). Dragged past where a motion can stretch, it asks what to do. */
  const drag = (m: (typeof route.marks)[number]) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const [x0, y0] = [e.nativeEvent.clientX, e.nativeEvent.clientY];
    let moved = false;
    let last = { clientX: x0, clientY: y0 };
    pointer.orbit(false);
    follow(
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return;
        moved = true;
        last = ev;
        document.body.style.cursor = 'grabbing';
        const h = pointer.ray(ev.clientX, ev.clientY).intersectPlane(floor, new THREE.Vector3());
        if (h) moveMark(store, figureId, m.t, [h.x, h.z], `mark:${figureId}:${m.t}`);
      },
      () => {
        pointer.orbit(true);
        document.body.style.cursor = '';
        if (!moved) {
          store.setTime(m.t);
          if (m.act) store.select({ kind: 'action', action: m.act, figure: figureId });
          return;
        }
        const act = m.act ? store.scene.animation?.actions.find((x) => x.id === m.act) : undefined;
        if (act && overWarp(store.scene, act, figureId)) {
          openContextMenu(last, [
            { label: 'Move it back', icon: Undo2, onSelect: () => fitWarp(store, act.id, figureId, 'back') },
            { label: 'Walk the rest', icon: Footprints, onSelect: () => fitWarp(store, act.id, figureId, 'walk') },
            { label: 'Leave it', icon: Check, onSelect: () => {} },
          ], 'Too far for this motion');
        }
      },
    );
  };

  return (
    <group>
      {route.points.length > 1 && <Line points={route.points} color="#3b6cff" lineWidth={1.5} transparent opacity={0.55} />}
      {route.prints.map((p, i) => (
        <mesh key={i} position={[p.x, ground(p.x, p.z) + 0.006, p.z]} rotation={[-Math.PI / 2, 0, p.yaw * (Math.PI / 180)]} renderOrder={4}>
          <circleGeometry args={[0.045, 16]} />
          <meshBasicMaterial color={p.side === 'L' ? '#30a46c' : '#f59e0b'} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
      {route.marks.map((m, n) => {
        const on = Math.abs(m.t - time) < 0.5 / a.fps;
        const y = ground(m.x, m.z) + 0.008;
        const color = m.over ? '#e5484d' : on ? '#3b6cff' : '#60616a';
        return (
          <group key={`${n}:${m.t}`} position={[m.x, y, m.z]}>
            <mesh rotation-x={-Math.PI / 2} renderOrder={6}>
              <ringGeometry args={[0.1, 0.135, 32]} />
              <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} renderOrder={6}>
              <circleGeometry args={[0.1, 32]} />
              <meshBasicMaterial map={numberTexture(n + 1)} color={m.over ? '#ffe4e4' : '#ffffff'} transparent opacity={on ? 0.95 : 0.75} depthWrite={false} />
            </mesh>
            {/* Which way the figure faces there. */}
            <mesh rotation={[-Math.PI / 2, 0, m.facing * D2R]} renderOrder={6}>
              <shapeGeometry args={[ARROW]} />
              <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh
              rotation-x={-Math.PI / 2}
              visible={false}
              onPointerDown={drag(m)}
              onPointerOver={() => { document.body.style.cursor = 'grab'; }}
              onPointerOut={() => { document.body.style.cursor = ''; }}
            >
              <circleGeometry args={[0.2, 16]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/**
 * Props standing between the camera and the figure being edited go see-through (without lines),
 * and let clicks through to it. Checked a few times a second.
 */
export function SeeThrough({ sv, figureId }: { sv: SceneView; figureId: string | null }) {
  const camera = useThree((s) => s.camera);
  const tick = useRef(0);
  useFrame(() => {
    if (tick.current++ % 6) return;
    const ray = new THREE.Raycaster();
    const m = figureId ? sv.figures.get(figureId) : undefined;
    const blocking = new Set<string>();
    if (m) {
      // Props standing in the scene (not ones carried in a hand).
      const standing = [...sv.props.entries()].filter(([, p]) => p.object.parent === sv.root);
      const meshes = standing.flatMap(([id, p]) => p.parts.bodies.map((mesh) => ({ mesh, id })));
      for (const j of ['head', 'chest', 'hips'] as const) {
        const point = m.joints[j].getWorldPosition(new THREE.Vector3());
        const d = point.sub(camera.position);
        const dist = d.length();
        ray.set(camera.position, d.normalize());
        ray.far = dist - 0.05;
        for (const hit of ray.intersectObjects(meshes.map((x) => x.mesh), false)) blocking.add(meshes.find((x) => x.mesh === hit.object)!.id);
      }
    }
    for (const [id, p] of sv.props) p.setFade(blocking.has(id));
  });
  useEffect(() => () => { for (const p of sv.props.values()) p.setFade(false); }, [sv]);
  return null;
}

/** Pins on the hands, feet or hips held on something ("hold on to …"), while the hold lasts. */
export function HoldPins({ sv, scene, time }: { sv: SceneView; scene: Scene; time: number }) {
  const holds = (scene.animation?.constraints ?? []).filter((c) => time >= c.start - 1e-6 && time <= c.end + 1e-6);
  const pins = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    holds.forEach((c, i) => {
      const pin = pins.current[i];
      const m = sv.figures.get(c.figure);
      if (pin && m) m.joints[c.bone].getWorldPosition(pin.position);
    });
  });
  return (
    <>
      {holds.map((c, i) => (
        <group key={c.id} ref={(el) => { pins.current[i] = el; }}>
          <mesh renderOrder={7}>
            <sphereGeometry args={[0.028, 12, 8]} />
            <meshBasicMaterial color="#e5484d" transparent opacity={0.85} depthTest={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** The hands and feet pinned while posing (#38): a blue pin on each, where it is held. */
export function PosePins({ sv, store }: { sv: SceneView; store: Store }) {
  // (The canvas's own renderer: the store read directly, not through the app's context.)
  const pins = useSyncExternalStore((f) => store.subscribe(f), () => store.getState().pins);
  const list = Object.entries(pins).flatMap(([figure, ends]) => ends.map((end) => ({ figure, end })));
  const marks = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    list.forEach((x, i) => {
      const m = sv.figures.get(x.figure);
      const g = marks.current[i];
      if (g && m) { m.joints[x.end].getWorldPosition(g.position); g.visible = m.object.visible; }
    });
  });
  return (
    <>
      {list.map((x, i) => (
        <group key={`${x.figure}:${x.end}`} ref={(el) => { marks.current[i] = el; }}>
          <mesh renderOrder={7}>
            <sphereGeometry args={[0.03, 12, 8]} />
            <meshBasicMaterial color="#3b6cff" transparent opacity={0.85} depthTest={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

