/*
 * Dragging's modifiers, as Blender and Unity have them: Ctrl (Cmd on macOS) snaps to steps, Shift
 * drags finely. One place, so every drag (joint arcs, slider drags, floor rings, the gizmo, the
 * camera and light handles, floor moves) reads them the same way.
 */

type Keys = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

/** Snap to steps (Ctrl, or Cmd on macOS). */
export const snapping = (e: Keys) => e.ctrlKey || e.metaKey;
/** Drag finely: a fifth of the speed (Shift). */
export const fine = (e: Keys) => e.shiftKey;

/** The steps a snapping drag keeps to. */
export const STEPS = {
  /** A joint's slider (degrees). */
  joint: 5,
  /** A turn on the floor: a figure, a prop, a rig camera's angle, the light's direction (degrees). */
  turn: 15,
  /** A height: a rig camera's, the light's (degrees). */
  height: 5,
  /** Moving across the floor (metres): the placing grid. */
  move: 0.25,
  /** Scaling (a fraction of the size). */
  scale: 0.1,
};

/** A value kept to a step. */
export const snap = (v: number, step: number) => Math.round(v / step) * step;
