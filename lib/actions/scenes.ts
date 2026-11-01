import { newScene, duplicateScene } from '../doc';
import { projectSettingsOf } from '../project';
import { lightingOf } from '../lighting';
import { lightingForSet } from '../sets';
import { type Store, openingSelection } from '../store';
import type { Scene, ProjectSettings } from '../types';
import { setLighting } from './lights';

/* Scenes: adding, opening, renaming, reordering and deleting them (library entries). */

export function addScene(store: Store, scene: Scene = newScene(`Scene ${store.getState().library.scenes.length + 1}`)) {
  const at = store.getState().sceneIndex + 1;
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes.slice(0, at), scene, ...lib.scenes.slice(at)] }), '', {
    sceneIndex: at, selection: openingSelection(scene), activeFigure: null,
  });
}

export function appendScenes(store: Store, scenes: Scene[]) {
  const at = store.getState().library.scenes.length;
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes, ...scenes] }), '', { sceneIndex: at, selection: openingSelection(scenes[0]), activeFigure: null });
}

/** Duplicate a scene (the open one by default); the copy opens next to it. */
export function duplicateCurrentScene(store: Store, index = store.getState().sceneIndex) {
  const src = store.getState().library.scenes[index];
  if (!src) return;
  if (index !== store.getState().sceneIndex) store.setSceneIndex(index);
  addScene(store, duplicateScene(src));
}

export function deleteScene(store: Store, index = store.getState().sceneIndex) {
  const { library, sceneIndex } = store.getState();
  if (index < 0 || index >= library.scenes.length) return false;
  // (The last one: a new blank scene in its place, as a new project has.)
  const blank = library.scenes.length === 1 ? [newScene('Scene 1')] : [];
  store.commit((lib) => ({ ...lib, scenes: [...lib.scenes.filter((_, i) => i !== index), ...blank] }), '', {
    sceneIndex: index <= sceneIndex ? Math.max(0, sceneIndex - 1) : sceneIndex, selection: null, activeFigure: null,
  });
  store.select(openingSelection(store.scene));
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


export function replaceLibrary(store: Store, scenes: Scene[]) {
  store.commit((lib) => ({ ...lib, scenes }), '', { sceneIndex: 0, selection: openingSelection(scenes[0]), activeFigure: null });
}

export function renameScene(store: Store, name: string) {
  store.updateScene((s) => ({ ...s, name }), 'rename');
}

/**
 * Play the open scene in a set (lib/sets.ts), or in none. The set's own lights (its lamps, its
 * windows) come with it, in place of the last set's; an indoor set makes the scene lit indoors
 * (#17: its walls cast none of the key's shadows), an outdoor one outdoors.
 */
export function setSceneSet(store: Store, id: string | null) {
  const before = lightingOf(store.scene);
  const after = lightingForSet(before, id);
  store.group(() => {
    store.updateScene((s) => {
      const { set: _, ...rest } = s;
      void _;
      return id ? { ...rest, set: id } : rest;
    });
    // (Only if the set changes it: a scene left on its default lighting stays so.)
    const changed = [after, before].some((l) => l.lights.some((x) => x.ofSet)) || !!after.environment?.indoors !== !!before.environment?.indoors;
    if (after.lights.length && changed) setLighting(store, after);
  });
}

/** The project's settings: its frame shape (16:9, 9:16, 1:1, 2.39:1) and its render style. */
export function editProjectSettings(store: Store, patch: Partial<ProjectSettings>) {
  store.commit((lib) => ({ ...lib, settings: { ...projectSettingsOf(lib), ...patch } }));
}
