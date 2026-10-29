'use client';

/*
 * When the canvas draws: on demand, not every frame (it draws four passes each time: the shadow
 * map, the parts' IDs for the inner lines, the scene, its lines). Something that changes what it
 * shows wakes it (a change to the document or the selection, the pointer, a key, a model come in);
 * it draws on for a moment after (what settles, eases or follows), and all the time while playing.
 */

let draw: (() => void) | null = null;
let until = 0;

/** The canvas's own way to ask for a frame (R3F's invalidate), while it is there. */
export function setDrawer(f: (() => void) | null) {
  draw = f;
}

/** Draw the canvas, and go on drawing for `ms` (what moves after a change, settles). */
export function wake(ms = 600) {
  until = Math.max(until, performance.now() + ms);
  draw?.();
}

/** Whether the canvas is still to go on drawing after it was woken. */
export const awake = () => performance.now() < until;
