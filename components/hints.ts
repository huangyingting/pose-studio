'use client';

import { useSyncExternalStore } from 'react';
import { JOINT_LABELS, axisLabels } from '@/lib/joints';
import type { JointName, Scene, Vec3 } from '@/lib/types';

/*
 * What the header bar's hint says about the pointer: what each gesture does on what is under it
 * (set by the canvas's objects as the pointer comes and goes). Kept apart from the store: it
 * changes as the pointer moves, and only the hint shows it.
 */

let current: string | null = null;
const listeners = new Set<() => void>();

export function setPointerHint(text: string | null) {
  if (text === current) return;
  current = text;
  listeners.forEach((l) => l());
}

export function usePointerHint() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => null);
}

/** Whether the pointer is over the canvas (on the empty floor when no hint is set). */
let over = false;
export function setCanvasPointer(on: boolean) {
  if (on === over) return;
  over = on;
  listeners.forEach((l) => l());
}

export function useCanvasPointer() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => over, () => false);
}

const part = (j: JointName) => JOINT_LABELS[j].toLowerCase();

/**
 * On a figure's body: what a click picks (the figure first, then, it picked, the part there) and
 * what a drag of the part under the pointer does (a stand-in's, or several figures': they move).
 */
export function bodyHint(name: string, kind: 'body' | 'pelvis' | 'end' | 'swing', joint?: JointName, picked = true, follows = false) {
  if (kind === 'body') return `${picked ? 'Click: a part · ' : ''}Drag: move ${name} · Shift-drag: turn · Right-click: more`;
  const p = kind === 'pelvis' ? 'hips' : part(joint!);
  const click = picked ? `Click: the ${p}` : `Click: pick ${name}`;
  if (kind === 'pelvis') return `${click} · Drag: squat or shift, feet stay · Shift-drag: turn`;
  if (kind === 'end') return `${click} · Drag: move the ${p}, the ${/hand/i.test(joint!) ? (follows ? 'arm and the body follow' : 'arm follows') : 'leg follows'} · Shift-drag: roll`;
  return `${click} · Drag: turn the ${p} (Ctrl: 5° steps) · Shift-drag: twist · Hold X / Y / Z: one way`;
}

export const propHint = (name: string, held: boolean) => (held
  ? `Drag: move ${name} and the hand holding it · Shift-drag: turn the hand · Right-click: more`
  : `Drag: move ${name} · Shift-drag: turn it · Right-click: more`);

export const ringHint = (name: string) => `Drag the ring: turn ${name} · Ctrl: 15° steps`;
export const cameraHint = (name: string, rig = false) => (rig
  ? `${name} places itself on its subject · Wheel: shot size · Shift-wheel: lens · Click: its angle and height handles`
  : `Drag: move ${name} across the floor · Shift-drag: up and down · Double-click its path: add a point`);
export const FLOOR_HINT = 'Drag: orbit · Right-click: walk here, add something here';

/** Whether the last input was the pointer's (a click), not the keyboard's: what was asked for with a click is placed with the pointer. */
let pointerLast = true;
let pointerAt = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { pointerLast = true; }, true);
  window.addEventListener('pointermove', (e) => { pointerAt = { x: e.clientX, y: e.clientY }; }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') pointerLast = false; }, true);
}
export const viaPointer = () => pointerLast;

/*
 * The readout beside the pointer while something is dragged: how far it has moved, how far it has
 * turned, a joint's value, a prop's height (with `drop`, the point a dashed line goes down from).
 */
interface Readout { text: string; x: number; y: number; drop?: Vec3; axis?: number }
let readout: Readout | null = null;
const readers = new Set<() => void>();

/** (`axis`: a joint's slider, marked in its axis's colour.) */
export function setReadout(text: string | null, drop?: Vec3, axis?: number) {
  if (!text && !readout) return;
  readout = text ? { text, ...pointerAt, drop, axis } : null;
  readers.forEach((l) => l());
}

export function useReadout() {
  return useSyncExternalStore((l) => { readers.add(l); return () => readers.delete(l); }, () => readout, () => null);
}

/** A readout for a moment (after a step from the keyboard: no drag ends it). */
let flashTimer = 0;
export function flashReadout(text: string) {
  setReadout(text);
  if (typeof window === 'undefined') return;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => setReadout(null), 1400);
}

/** A length or coordinate in metres, as read out (a true minus sign). */
export const metres = (v: number) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2).replace('-', '−'));
const degrees = (v: number) => `${Math.round(v) === 0 ? 0 : Math.round(v)}°`.replace('-', '−');

export const movedText = (dx: number, dz: number, x: number, z: number) => `Moved ${metres(Math.hypot(dx, dz))} m · X ${metres(x)}  Z ${metres(z)}`;
/** How far something has turned (and, where Shift snaps, whether it does). */
export const turnedText = (by: number, steps?: boolean) => `Turned ${degrees(((by % 360) + 540) % 360 - 180)}${steps === undefined ? '' : steps ? ' · 15° steps' : ' · Ctrl: 15° steps'}`;

/** A joint's slider by its short name ("Bend"). */
export const sliderName = (joint: JointName, axis: number) => axisLabels(joint)[axis].split(' (')[0];
/** A joint's slider and its value ("Left forearm · Bend −42°"). */
export const sliderText = (joint: JointName, axis: number, value: number) => `${JOINT_LABELS[joint]} · ${sliderName(joint, axis)} ${degrees(value)}`;
/** A drag held at a joint's limit (with the limits lock on). */
export const limitText = (joint: JointName, value: number) => `${JOINT_LABELS[joint]}: limit ${degrees(value)}`;

/** A joint's slider that a drag has changed most, and its value. */
export function jointText(joint: JointName, before: Vec3, now: Vec3) {
  const axis = [0, 1, 2].reduce((b, a) => (Math.abs(now[a] - before[a]) > Math.abs(now[b] - before[b]) ? a : b));
  return sliderText(joint, axis, now[axis]);
}

/** What the Library item under the pointer would make of the selected figure: a ghost on the canvas. */
let ghost: Scene | null = null;
const ghostReaders = new Set<() => void>();

export function setHoverGhost(scene: Scene | null) {
  if (scene === ghost) return;
  ghost = scene;
  ghostReaders.forEach((l) => l());
}

export function useHoverGhost() {
  return useSyncExternalStore((l) => { ghostReaders.add(l); return () => ghostReaders.delete(l); }, () => ghost, () => null);
}
