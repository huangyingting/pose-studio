'use client';

import { useSyncExternalStore } from 'react';
import { JOINT_LABELS } from '@/lib/joints';
import type { JointName } from '@/lib/types';

/*
 * What the canvas's hint chip says about the pointer: what each gesture does on what is under it
 * (set by the canvas's objects as the pointer comes and goes). Kept apart from the store: it
 * changes as the pointer moves, and only the chip shows it.
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

/** On a figure's body: what a drag of the torso, a hand or foot, or another part does. */
export function bodyHint(name: string, kind: 'body' | 'end' | 'swing', joint?: JointName) {
  if (kind === 'body') return `Drag: move ${name} · Shift-drag: turn ${name} · Right-click: more`;
  const p = part(joint!);
  if (kind === 'end') return `Drag: move the ${p}, the ${/hand/i.test(joint!) ? 'arm' : 'leg'} follows · Shift-drag: roll it · Click: fine-tune`;
  return `Drag: swing the ${p} · Shift-drag: twist it · Click: fine-tune`;
}

export const propHint = (name: string, held: boolean) => (held
  ? `Drag: move ${name} and the hand holding it · Shift-drag: turn the hand · Right-click: more`
  : `Drag: move ${name} · Shift-drag: turn it · Right-click: more`);

/** The coloured dots: hands and feet (IK), the hips, and the elbows and knees. */
export function dotHint(id: string) {
  if (id === 'hips') return 'Purple dot: drag to raise, lower or shift the hips; the feet stay planted';
  if (/Hand$/.test(id)) return `Orange dot: drag to put the ${id.startsWith('left') ? 'left' : 'right'} hand there, the arm follows`;
  if (/Foot$/.test(id)) return `Green dot: drag to put the ${id.startsWith('left') ? 'left' : 'right'} foot there, the leg follows`;
  return `Pale dot: drag to point the ${/Arm$/.test(id) ? 'elbow' : 'knee'}, the limb turns about its own line`;
}

export const ringHint = (name: string) => `Drag the ring: turn ${name} · Shift: 15° steps`;
export const cameraHint = (name: string) => `Drag: move ${name} across the floor · Shift-drag: up and down · Double-click its path: add a point`;
export const FLOOR_HINT = 'Drag: orbit · Right-click: walk here, add something here';

/** Whether the last input was the pointer's (a click), not the keyboard's: what was asked for with a click is placed with the pointer. */
let pointerLast = true;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { pointerLast = true; }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') pointerLast = false; }, true);
}
export const viaPointer = () => pointerLast;
