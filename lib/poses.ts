import { DEFAULT_VIEW, newFigure, newScene } from './doc';
import { cloneHand } from './hands';
import { BUILT_IN_POSES } from './presets';
import { withFacing } from './relations';
import type { Figure, Library, PoseAsset, Scene, View } from './types';
import { uid } from './uid';

/*
 * The pose library: the built-in reference poses (from the drawing reference sheet) and poses the
 * user saved. A pose applies to a figure's joints and hands, wherever it stands and faces.
 */

/** The 20 built-in poses (never stored in the library), each in a group (standing, sitting, …). */
export function builtInPoses() {
  return BUILT_IN_POSES;
}

export function allPoses(lib: Library): PoseAsset[] {
  return [...builtInPoses(), ...(lib.poses ?? [])];
}

export const isBuiltIn = (id: string) => builtInPoses().some((p) => p.id === id);

/** A pose as a one-figure scene: for thumbnails, sheets and gesture practice. */
export function poseScene(p: PoseAsset, body?: Figure['body']): Scene {
  const figure = newFigure({ id: `${p.id}-f`, name: 'Figure', bones: { ...p.bones }, hands: { L: cloneHand(p.hands.L), R: cloneHand(p.hands.R) }, ...(body ? { body: { ...body } } : {}) });
  return { ...newScene(p.name, [figure]), id: p.id, view: { ...p.view } };
}

/** A figure's pose (facing forward), to save in the library. */
export function poseFromFigure(f: Figure, name: string, view: View = DEFAULT_VIEW): PoseAsset {
  return {
    id: uid('pose'),
    name: name.trim().slice(0, 80) || 'My pose',
    bones: withFacing(f, 0).bones,
    hands: { L: cloneHand(f.hands.L), R: cloneHand(f.hands.R) },
    view: { ...view },
  };
}
