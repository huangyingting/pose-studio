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

/**
 * Keys held now: X, Y or Z held picks a joint's slider (Bend, Twist, Side) for a drag of the part
 * and for ← → (1, 2 or 3 pressed during a drag, too); with the whole figure selected, which way
 * ← → turn or lean it.
 */
const held = new Set<string>();
if (typeof window !== 'undefined') {
  // (On macOS a key let go while Cmd is down sends no keyup: a key pressed with Cmd is not counted
  // (Cmd+Z), and Cmd coming up forgets what was held. Ctrl lets keys go normally: Ctrl then X locks X.)
  window.addEventListener('keydown', (e) => { if (!e.metaKey) held.add(e.key.toLowerCase()); });
  window.addEventListener('keyup', (e) => { if (e.key === 'Meta') held.clear(); else held.delete(e.key.toLowerCase()); });
  window.addEventListener('blur', () => held.clear());
}
const LOCKS: Record<string, number> = { x: 0, y: 1, z: 2, '1': 0, '2': 1, '3': 2 };
/** The slider X, Y or Z held picks (0, 1, 2), if any. */
export const heldAxis = (): number | undefined => ['x', 'y', 'z'].filter((k) => held.has(k)).map((k) => LOCKS[k])[0];
/** The slider a key pressed during a drag picks (1, 2, 3, or X, Y, Z), if any. */
export const lockOf = (key: string): number | undefined => LOCKS[key.toLowerCase()];

