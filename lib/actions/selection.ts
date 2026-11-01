import * as THREE from 'three';
import { wrapDeg, jointLimits } from '../joints';
import { normalize } from '../animation';
import { actionLabel, partnersOf, restage } from '../track';
import { withPosition, withFacing, facing } from '../relations';
import { cameraById, viewOf, withCamera, capturePoint } from '../cameras';
import { angle } from '../pose';
import { setPointAt } from '../shots';
import type { Store } from '../store';
import { released } from '../hold';
import type { Selection, Vec3, JointName } from '../types';
import { deleteCamera, duplicateCamera, pathCamera, placeFixed, removeShotCut } from './cameras';
import { deleteFigure, duplicateFigure, setJoint } from './figures';
import { deleteProp, duplicateProp } from './props';
import { copyOf, deleteAction, here } from './timeline';

/* Several things at once (a selection of many), and steps from the keyboard (#13). */

/** Delete what is selected (a figure, a prop or a shot's cut). Returns its name for the toast, or null. */
export function deleteSelection(store: Store): string | null {
  const sel = store.getState().selection;
  const scene = store.scene;
  if (sel?.kind === 'prop') {
    const p = scene.props.find((x) => x.id === sel.prop);
    deleteProp(store, sel.prop);
    return p?.name ?? 'Prop';
  }
  if (sel?.kind === 'figure') {
    const f = scene.figures.find((x) => x.id === sel.figure);
    return f && deleteFigure(store, f.id) ? f.name : null;
  }
  if (sel?.kind === 'action') {
    const act = scene.animation?.actions.find((x) => x.id === sel.action);
    if (!act) return null;
    deleteAction(store, act.id);
    return actionLabel(act);
  }
  if (sel?.kind === 'shot' && scene.animation?.shots?.[0]?.id !== sel.shot && scene.animation?.shots?.some((x) => x.id === sel.shot)) {
    const name = scene.animation.shots.find((x) => x.id === sel.shot)!.name;
    removeShotCut(store, sel.shot);
    return `the cut before ${name}`;
  }
  const cam = sel?.kind === 'camera' ? cameraById(scene, sel.camera) : null;
  if (cam && scene.cameras.length > 1) {
    deleteCamera(store, cam.id);
    return cam.name;
  }
  return null;
}

/** Duplicate the selected prop, figure (also when one of its joints is selected) or camera. False when there is none. */
export function duplicateSelection(store: Store) {
  const sel = store.getState().selection;
  if (sel?.kind === 'prop') duplicateProp(store, sel.prop);
  else if (sel?.kind === 'camera') duplicateCamera(store, sel.camera);
  else if (sel?.kind === 'figure' || sel?.kind === 'joint') duplicateFigure(store, sel.figure);
  else return false;
  return true;
}
/** What is selected, as lists of whole figures and props (a joint: its figure). */
function selectedThings(sel: Selection): { figures: string[]; props: string[] } {
  if (sel?.kind === 'many') return { figures: sel.figures, props: sel.props };
  if (sel?.kind === 'figure' || sel?.kind === 'joint') return { figures: [sel.figure], props: [] };
  if (sel?.kind === 'prop') return { figures: [], props: [sel.prop] };
  return { figures: [], props: [] };
}

/** Add a figure or a prop to what is selected, or take it away (Shift-click): one left is selected alone. */
export function toggleSelected(store: Store, thing: { figure: string } | { prop: string }) {
  const { figures, props } = selectedThings(store.getState().selection);
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const f = 'figure' in thing ? flip(figures, thing.figure) : figures;
  const p = 'prop' in thing ? flip(props, thing.prop) : props;
  if (f.length + p.length > 1) store.select({ kind: 'many', figures: f, props: p });
  else if (f.length) store.select({ kind: 'figure', figure: f[0] });
  else if (p.length) store.select({ kind: 'prop', prop: p[0] });
  else store.select(null);
}

/** Delete several figures and props (one undo step); the scene keeps at least one figure. How many went. */
export function deleteMany(store: Store, figures: string[], props: string[]) {
  const keep = store.scene.figures.filter((f) => !figures.includes(f.id));
  const gone = keep.length ? figures : figures.slice(1);
  store.updateScene((s) => ({
    ...s,
    figures: s.figures.filter((f) => !gone.includes(f.id)),
    props: s.props.filter((p) => !props.includes(p.id)).map((p) => (p.hold && gone.includes(p.hold.figure) ? released(p, s) : p)),
  }));
  store.select(null);
  return gone.length + props.length;
}

/** Copies of several figures and props, beside them (one undo step), selected together. */
export function duplicateMany(store: Store, figures: string[], props: string[]) {
  const before = { figures: new Set(store.scene.figures.map((f) => f.id)), props: new Set(store.scene.props.map((p) => p.id)) };
  /** The id a duplicate added to a list (none if nothing was added). */
  const added = <T extends { id: string }>(list: () => T[], copy: () => void) => {
    const n = list().length;
    copy();
    return list().length > n ? list()[list().length - 1].id : null;
  };
  store.group(() => {
    // Copies beside the originals, all moved alike (as a figure's copy is), so the group keeps its layout.
    const copyOf = new Map<string, string>();
    for (const id of figures) {
      const copy = added(() => store.scene.figures, () => duplicateFigure(store, id));
      if (copy) copyOf.set(id, copy);
    }
    for (const id of props) {
      const src = store.scene.props.find((p) => p.id === id);
      const copy = src && added(() => store.scene.props, () => duplicateProp(store, id));
      if (!src || !copy) continue;
      const holder = src.hold && copyOf.get(src.hold.figure);
      store.updateScene((s) => {
        // In the copy of the hand that held it, held as the original is (not a second one in the original's hand).
        if (holder && src.hold) {
          return { ...s, props: s.props.map((x) => (x.id === copy ? { ...x, position: src.position, rotation: src.rotation, scale: src.scale, hold: { ...src.hold!, figure: holder } } : x)) };
        }
        // (Held by someone not copied: as a single copy of it is.)
        if (src.hold) return s;
        return { ...s, props: s.props.map((x) => (x.id === copy ? { ...x, position: [src.position[0] + 0.8, src.position[1], src.position[2]] as Vec3 } : x)) };
      });
    }
  });
  store.select({ kind: 'many', figures: store.scene.figures.filter((f) => !before.figures.has(f.id)).map((f) => f.id), props: store.scene.props.filter((p) => !before.props.has(p.id)).map((p) => p.id) });
}
/** Move a figure across the floor (and, off the floor, up or down) by a step; keyed at the playhead in an animated scene. */
export function stepFigure(store: Store, id: string, dx: number, dz: number, dy = 0) {
  store.updateFigure(id, (f) => {
    const moved = withPosition(f, f.position[0] + dx, f.position[2] + dz);
    return dy && !f.grounded ? { ...moved, position: [moved.position[0], Math.max(0, moved.position[1] + dy), moved.position[2]] } : moved;
  }, `step:${id}`);
}

/** Turn a figure about itself by a step (degrees, + to its left). */
export function turnFigure(store: Store, id: string, by: number) {
  store.updateFigure(id, (f) => withFacing(f, facing(f) + by), `step:${id}`);
}

/** Move a prop by a step (one in a hand goes with the hand: not moved). */
export function stepProp(store: Store, id: string, dx: number, dz: number, dy = 0) {
  store.updateProp(id, (p) => (p.hold ? p : { ...p, position: [p.position[0] + dx, Math.max(0, p.position[1] + dy), p.position[2] + dz] }), `step:${id}`);
}

/** Turn a prop about its own up axis by a step (degrees). */
export function turnProp(store: Store, id: string, by: number) {
  store.updateProp(id, (p) => (p.hold ? p : { ...p, rotation: [p.rotation[0], wrapDeg(p.rotation[1] + by), p.rotation[2]] }), `step:${id}`);
}

/** Move several figures and props together by a step, or turn them about their middle (one undo step). */
export function stepMany(store: Store, figures: string[], props: string[], move: { dx: number; dz: number } | { turn: number }) {
  const s = store.scene;
  const spots = [
    ...s.figures.filter((f) => figures.includes(f.id)).map((f) => f.position),
    ...s.props.filter((p) => props.includes(p.id) && !p.hold).map((p) => p.position),
  ];
  if (!spots.length) return;
  const [cx, cz] = [spots.reduce((a, p) => a + p[0], 0) / spots.length, spots.reduce((a, p) => a + p[2], 0) / spots.length];
  const place = (x: number, z: number): [number, number] => {
    if ('dx' in move) return [x + move.dx, z + move.dz];
    const r = (move.turn * Math.PI) / 180;
    const [ox, oz] = [x - cx, z - cz];
    return [cx + ox * Math.cos(r) + oz * Math.sin(r), cz - ox * Math.sin(r) + oz * Math.cos(r)];
  };
  store.group(() => {
    for (const id of figures) {
      store.updateFigure(id, (f) => {
        const [x, z] = place(f.position[0], f.position[2]);
        const moved = withPosition(f, x, z);
        return 'turn' in move ? withFacing(moved, facing(moved) + move.turn) : moved;
      });
    }
    for (const id of props) {
      store.updateProp(id, (p) => {
        if (p.hold) return p;
        const [x, z] = place(p.position[0], p.position[2]);
        return { ...p, position: [x, p.position[1], z], rotation: 'turn' in move ? [p.rotation[0], wrapDeg(p.rotation[1] + move.turn), p.rotation[2]] : p.rotation };
      });
    }
  });
}

/**
 * Move whole performances across the floor (#13: a track offset, without a key): everything
 * `figures` do, and those they share an action with, moved by (dx, dz) and turned by `turn`
 * degrees about where they are at the playhead (or `about`). In a still scene: the figures themselves. Returns
 * the figures moved.
 */
export function offsetPerformance(store: Store, figures: string[], move: { dx?: number; dz?: number; turn?: number; about?: [number, number] }, key = ''): string[] {
  const s = store.scene;
  const a = s.animation;
  const ids = a ? partnersOf(a, figures) : figures;
  const spots = s.figures.filter((f) => ids.includes(f.id)).map((f) => f.position);
  if (!spots.length) return [];
  const { dx = 0, dz = 0, turn = 0 } = move;
  if (!a) {
    store.group(() => {
      if (dx || dz) stepMany(store, ids, [], { dx, dz });
      if (turn) stepMany(store, ids, [], { turn });
    });
    return ids;
  }
  const about = move.about ?? [spots.reduce((t, p) => t + p[0], 0) / spots.length, spots.reduce((t, p) => t + p[2], 0) / spots.length];
  // The track only: the figures are posed from it again (an edit to them would key them here). (One
  // added since it was animated holds its pose on a track of its own first.)
  store.updateScene((x) => (x.animation ? { ...x, animation: restage(normalize(x.animation, x.figures), ids, { dx, dz, turn, about }) } : x), key);
  store.setTime(store.getState().time);
  return ids;
}

/** Turn one of a joint's sliders by a step (degrees), kept to its limits when they are on. */
export function stepJoint(store: Store, figure: string, joint: JointName, axis: number, by: number) {
  const f = store.scene.figures.find((x) => x.id === figure);
  if (!f) return null;
  const v = angle(f.bones, joint);
  const next: Vec3 = [...v];
  // Within the joint's limits; without them it goes round (as a drag does).
  if (store.getState().settings.limits) {
    const [lo, hi] = jointLimits(joint)[axis];
    next[axis] = Math.min(hi, Math.max(lo, v[axis] + by));
  } else next[axis] = wrapDeg(v[axis] + by);
  setJoint(store, figure, joint, next, `step:${figure}:${joint}:${axis}`);
  return next[axis];
}

/**
 * Move or turn a path camera by a step at the playhead (a point there, made if there is none):
 * across, in and out, up and down (metres, as it looks), and panned or tilted (degrees).
 */
export function stepCamera(store: Store, id: string, step: { right?: number; forward?: number; up?: number; pan?: number; tilt?: number }) {
  const cam = cameraById(store.scene, id);
  if (!cam || (cam.kind !== 'path' && !cam.rig.fixed)) return;
  const view = viewOf(store.scene, cam, store.scene.animation ? store.getState().time : 0);
  const dir = view.target.clone().sub(view.position);
  const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
  const right = new THREE.Vector3().crossVectors(flat, new THREE.Vector3(0, 1, 0)).normalize();
  const shift = right.multiplyScalar(step.right ?? 0).add(flat.clone().multiplyScalar(step.forward ?? 0)).add(new THREE.Vector3(0, step.up ?? 0, 0));
  const position = view.position.clone().add(shift);
  let look = dir.clone();
  if (step.pan) look.applyAxisAngle(new THREE.Vector3(0, 1, 0), (-step.pan * Math.PI) / 180);
  if (step.tilt) look.applyAxisAngle(new THREE.Vector3().crossVectors(look, new THREE.Vector3(0, 1, 0)).normalize(), (step.tilt * Math.PI) / 180);
  look = position.clone().add(look);
  const { t, fps } = here(store);
  // Its roll stays.
  store.updateScene((s) => {
    const fixed = cameraById(s, id);
    if (fixed?.kind === 'rig' && fixed.rig.fixed) return withCamera(s, placeFixed(s, fixed, t, position, look, fixed.rig.lens));
    const c = pathCamera(s, id);
    return c ? withCamera(s, setPointAt(c, fps, t, { ...capturePoint(s, c, t, position, look, view.fov), ...(view.roll ? { roll: view.roll } : {}) })) : s;
  }, `step:${id}`);
}
