'use client';

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { setJoint, stepJoint } from '@/lib/actions';
import { JOINT_LABELS, jointLimits } from '@/lib/joints';
import type { Store } from '@/lib/store';
import type { JointName, Vec3 } from '@/lib/types';
import { sliderName } from './hints';
import { STEPS } from './modifiers';

/**
 * The selected joint's card beside it on the canvas: a row per slider (Bend, Twist, Side, in the
 * axes' colours), each with − and + (5°, Shift 15°, again and again while held) and its value
 * (click to type it). Turning by dragging is on the part itself.
 */
export default function JointCard({ store, figure, joint, value, limits, onScreen }: {
  store: Store;
  figure: string;
  joint: JointName;
  /** The joint's slider values now. */
  value: Vec3;
  limits: boolean;
  /** The joint on screen (client coordinates), or null when it is not drawn. */
  onScreen(): { x: number; y: number } | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ x: number; y: number; left: boolean } | null>(null);
  const [typing, setTyping] = useState<number | null>(null);

  // Follow the joint on screen (as the view turns, as it moves); beside it, on the side with room.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = onScreen();
      const box = root.current?.getBoundingClientRect();
      const w = card.current?.offsetWidth ?? 200;
      let next: { x: number; y: number; left: boolean } | null = null;
      if (s && box) {
        const x = s.x - box.left;
        const left = x + 28 + w > box.width - 8;
        next = { x: left ? x - 28 - w : x + 28, y: Math.max(8, s.y - box.top - 44), left };
      }
      setPlace((p) => (p && next && Math.abs(p.x - next.x) < 0.5 && Math.abs(p.y - next.y) < 0.5 ? p : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onScreen]);

  /** From the keyboard (Enter or Space on − or +): one step (Shift: three). */
  const keyStep = (axis: number, by: number) => (e: React.MouseEvent) => {
    if (e.detail !== 0) return;
    stepJoint(store, figure, joint, axis, by * STEPS.joint * (e.shiftKey ? 3 : 1));
  };

  /** A − or + held down: a step at once, then more while it is held. */
  const stepper = (axis: number, by: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const n = e.shiftKey ? 3 : 1;
    const once = () => stepJoint(store, figure, joint, axis, by * STEPS.joint * n);
    once();
    let timer = window.setTimeout(function again() { once(); timer = window.setTimeout(again, 90); }, 400);
    const stop = () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const commit = (axis: number, text: string) => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) {
      const [lo, hi] = limits ? jointLimits(joint)[axis] : [-180, 180];
      const next: Vec3 = [...value];
      next[axis] = Math.min(hi, Math.max(lo, n));
      setJoint(store, figure, joint, next, '');
    }
    setTyping(null);
  };

  return (
    <div ref={root} className="joint-card-layer">
      <div
        ref={card}
        className="joint-card"
        role="group"
        aria-label={`${JOINT_LABELS[joint]} sliders`}
        style={place ? { left: place.x, top: place.y } : { visibility: 'hidden' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {[0, 1, 2].map((axis) => {
          const [lo, hi] = jointLimits(joint)[axis];
          // (A slider the joint does not have, with the limits on.)
          if (limits && lo === hi) return null;
          const name = sliderName(joint, axis);
          return (
            <div key={axis} className={`joint-card-row axis-${'xyz'[axis]}`}>
              <span className="joint-card-name">{name}</span>
              <button type="button" className="joint-card-step" aria-label={`${name} −5°`} data-tip="−5° (Shift: 15°; hold for more)" onPointerDown={stepper(axis, -1)} onClick={keyStep(axis, -1)}>
                <Minus size={12} aria-hidden />
              </button>
              {typing === axis ? (
                <input
                  className="joint-card-input"
                  type="number"
                  autoFocus
                  aria-label={`${name} value`}
                  defaultValue={Math.round(value[axis] * 10) / 10}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => commit(axis, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                    else if (e.key === 'Escape') setTyping(null);
                  }}
                />
              ) : (
                <button type="button" className="joint-card-value" aria-label={`${name}: ${Math.round(value[axis])}°, click to type`} onClick={() => setTyping(axis)}>
                  {Math.round(value[axis])}°
                </button>
              )}
              <button type="button" className="joint-card-step" aria-label={`${name} +5°`} data-tip="+5° (Shift: 15°; hold for more)" onPointerDown={stepper(axis, 1)} onClick={keyStep(axis, 1)}>
                <Plus size={12} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
