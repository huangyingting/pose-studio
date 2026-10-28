import type { CameraView } from '@/lib/cameras';
import { shotSpans, type ShotSpan } from '@/lib/shots';
import type { Store } from '@/lib/store';
import type { Action, Camera, Figure, JointName, Prop, Scene, Vec3 } from '@/lib/types';
import type { Notify } from '../ui';

/** What the inspector reaches outside the store. */
export interface InspectorContext {
  /** The editor camera, to make a scene camera from. */
  editorCamera(): CameraView | null;
  rootPosition(figure: string): Vec3 | null;
  notify: Notify;
  /** Toast with an Undo button. */
  notifyUndo(text: string): void;
  /** Open the project's settings (the film's frame, what it is cut for, face features). */
  projectSettings(): void;
}

/** What the inspector shows: one thing (as it is now), or the scene itself (nothing selected). */
export interface Target {
  store: Store;
  scene: Scene;
  ctx: InspectorContext;
  /** The playhead. */
  time: number;
  figure?: Figure;
  /** A part of the figure is selected. */
  joint?: JointName;
  prop?: Prop;
  span?: ShotSpan;
  camera?: Camera;
  action?: Action;
  /** Whose track the action is on. */
  actionFigure?: string;
}

/** The target of the selection; nothing selected (or what was is gone): the scene. */
export function targetOf(store: Store, ctx: InspectorContext): Target {
  const { selection, time } = store.getState();
  const scene = store.scene;
  const t: Target = { store, scene, ctx, time };
  const a = scene.animation;
  switch (selection?.kind) {
    case 'prop': { const prop = scene.props.find((p) => p.id === selection.prop); return prop ? { ...t, prop } : t; }
    case 'shot': { const span = a && shotSpans(a).find((sp) => sp.shot.id === selection.shot); return span ? { ...t, span } : t; }
    case 'camera': { const camera = scene.cameras.find((c) => c.id === selection.camera); return camera ? { ...t, camera } : t; }
    case 'action': { const action = a?.actions.find((x) => x.id === selection.action); return action ? { ...t, action, actionFigure: selection.figure } : t; }
    case 'figure':
    case 'joint': {
      const figure = scene.figures.find((f) => f.id === store.getState().activeFigure);
      return figure ? { ...t, figure, ...(selection.kind === 'joint' && selection.figure === figure.id ? { joint: selection.joint } : {}) } : t;
    }
    default: return t;
  }
}
