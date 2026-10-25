import { cloneHand } from './hands';
import {
  NEUTRAL_JOINTS, duplicateScene, mirrorFigure, mirrorScene, newFigure, newProp, newScene, symmetrize, uid,
} from './doc';
import { presetScenes } from './presets';
import type { Store } from './store';
import type { Figure, Hand, JointName, Prop, PropKind, Scene, Side, Vec3, View } from './types';

/* Scenes (library entries) */

export function addScene(store: Store, scene: Scene = newScene()) {
  const at = store.getState().sceneIndex + 1;
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes.slice(0, at), scene, ...lib.scenes.slice(at)] }), '', {
    sceneIndex: at, selection: null, activeFigure: null,
  });
}

export function appendScenes(store: Store, scenes: Scene[]) {
  const at = store.getState().library.scenes.length;
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes, ...scenes] }), '', { sceneIndex: at, selection: null, activeFigure: null });
}

export function duplicateCurrentScene(store: Store) {
  addScene(store, duplicateScene(store.scene));
}

export function deleteScene(store: Store, index = store.getState().sceneIndex) {
  const { library, sceneIndex } = store.getState();
  if (library.scenes.length <= 1) return false;
  store.commit((lib) => ({ ...lib, scenes: lib.scenes.filter((_, i) => i !== index) }), '', {
    sceneIndex: index <= sceneIndex ? Math.max(0, sceneIndex - 1) : sceneIndex, selection: null,
  });
  return true;
}

export function moveScene(store: Store, from: number, to: number) {
  const n = store.getState().library.scenes.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return;
  const scenes = [...store.getState().library.scenes];
  const [s] = scenes.splice(from, 1);
  scenes.splice(to, 0, s);
  // Keep the open pose selected, wherever it ends up.
  const current = store.scene.id;
  store.commit((lib) => ({ ...lib, scenes }), '', { sceneIndex: scenes.findIndex((x) => x.id === current) });
}

export function resetLibrary(store: Store) {
  store.commit(() => ({ version: 2, scenes: presetScenes() }), '', { sceneIndex: 0, selection: null, activeFigure: null });
}

export function replaceLibrary(store: Store, scenes: Scene[]) {
  store.commit(() => ({ version: 2, scenes }), '', { sceneIndex: 0, selection: null, activeFigure: null });
}

export function renameScene(store: Store, name: string) {
  store.updateScene((s) => ({ ...s, name }), 'rename');
}

export function setSceneView(store: Store, view: View) {
  store.updateScene((s) => ({ ...s, view }), 'view');
}

export function mirrorCurrentScene(store: Store) {
  store.updateScene(mirrorScene);
}

/* Figures */

export function addFigure(store: Store) {
  const scene = store.scene;
  const base = store.figure;
  // Place the new figure beside the existing ones, with the same proportions as the active one.
  const xs = scene.figures.map((f) => f.position[0]);
  const fig = newFigure({
    name: `Figure ${scene.figures.length + 1}`,
    position: [xs.length ? Math.max(...xs) + 0.8 : 0, 0, 0],
    ...(base ? { body: { ...base.body } } : {}),
  });
  addFigures(store, [fig]);
}

export function addFigures(store: Store, figures: Figure[]) {
  const i = store.getState().sceneIndex;
  store.commit(
    (lib) => ({ ...lib, scenes: lib.scenes.map((s, j) => (j === i ? { ...s, figures: [...s.figures, ...figures] } : s)) }),
    '',
    { activeFigure: figures[0].id, selection: null },
  );
}

export function duplicateFigure(store: Store, id: string) {
  const src = store.scene.figures.find((f) => f.id === id);
  if (!src) return;
  const copy: Figure = { ...structuredClone(src), id: uid('f'), name: `${src.name} copy`, position: [src.position[0] + 0.8, src.position[1], src.position[2]] };
  addFigures(store, [copy]);
}

export function deleteFigure(store: Store, id: string) {
  if (store.scene.figures.length <= 1) return false;
  store.updateScene((s) => ({ ...s, figures: s.figures.filter((f) => f.id !== id) }));
  return true;
}

export function setFigureHidden(store: Store, id: string, hidden: boolean) {
  store.updateFigure(id, (f) => {
    const next = { ...f, hidden: true };
    if (!hidden) delete (next as Partial<Figure>).hidden;
    return next;
  });
  if (hidden && store.getState().selection?.kind === 'joint') store.select(null);
}

export function renameFigure(store: Store, id: string, name: string) {
  store.updateFigure(id, (f) => ({ ...f, name }), `rename:${id}`);
}

export function resetPose(store: Store) {
  store.updateActiveFigure((f) => ({ ...f, joints: structuredClone(NEUTRAL_JOINTS) }));
}

export function mirrorPose(store: Store) {
  store.updateActiveFigure((f) => ({ ...mirrorFigure(f), position: f.position }));
}

export function symmetrizePose(store: Store, from: Side) {
  store.updateActiveFigure((f) => symmetrize(f, from));
}

export function setJoint(store: Store, figure: string, joint: JointName, value: Vec3, key: string) {
  store.updateFigure(figure, (f) => ({ ...f, joints: { ...f.joints, [joint]: value } }), key);
}

export function setGrounded(store: Store, figure: string, grounded: boolean, currentPosition?: Vec3) {
  store.updateFigure(figure, (f) => ({ ...f, grounded, position: currentPosition ?? f.position }));
}

export function setHand(store: Store, side: Side, hand: Hand, key = '') {
  store.updateActiveFigure((f) => ({ ...f, hands: { ...f.hands, [side]: cloneHand(hand) } }), key);
}

export function copyPose(store: Store) {
  const f = store.figure;
  if (!f) return false;
  store.clipboard = { joints: structuredClone(f.joints), hands: structuredClone(f.hands) };
  return true;
}

export function pastePose(store: Store) {
  const clip = store.clipboard;
  if (!clip || !store.figure) return false;
  store.updateActiveFigure((f) => ({ ...f, joints: structuredClone(clip.joints), hands: structuredClone(clip.hands) }));
  return true;
}

/* Props */

export function addProp(store: Store, kind: PropKind) {
  const scene = store.scene;
  const xs = scene.figures.map((f) => f.position[0]);
  const prop = newProp(kind, [(xs.length ? Math.max(...xs) : 0) + 0.9, 0, 0]);
  store.updateScene((s) => ({ ...s, props: [...s.props, prop] }));
  store.select({ kind: 'prop', prop: prop.id });
}

export function duplicateProp(store: Store, id: string) {
  const src = store.scene.props.find((p) => p.id === id);
  if (!src) return;
  const copy: Prop = { ...structuredClone(src), id: uid('p'), position: [src.position[0] + 0.3, src.position[1], src.position[2] + 0.3] };
  store.updateScene((s) => ({ ...s, props: [...s.props, copy] }));
  store.select({ kind: 'prop', prop: copy.id });
}

export function deleteProp(store: Store, id: string) {
  store.updateScene((s) => ({ ...s, props: s.props.filter((p) => p.id !== id) }));
}

export function deleteSelection(store: Store) {
  const sel = store.getState().selection;
  if (sel?.kind === 'prop') {
    deleteProp(store, sel.prop);
    return true;
  }
  return false;
}
