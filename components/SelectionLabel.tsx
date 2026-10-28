'use client';

import { useEffect, useRef } from 'react';
import { JOINT_LABELS } from '@/lib/joints';
import type { Selection } from '@/lib/types';
import { useScene, useStudio } from './store-context';

/** What is selected, named on the canvas just above it (beside a joint), following it as the view turns and it moves. */
export default function SelectionLabel({ labelPoint, hidden }: { labelPoint(sel: NonNullable<Selection>): { x: number; y: number } | null; hidden: boolean }) {
  const scene = useScene();
  const selection = useStudio((s) => s.selection);
  const time = useStudio((s) => s.time);
  const label = useRef<HTMLDivElement>(null);
  const shown = !!selection && selection.kind !== 'shot' && selection.kind !== 'action' && !hidden;

  useEffect(() => {
    if (!selection || !shown) return;
    let raf = 0;
    const tick = () => {
      const el = label.current;
      const box = el?.parentElement?.getBoundingClientRect();
      const at = labelPoint(selection);
      if (el && box) {
        if (!at) el.style.visibility = 'hidden';
        else {
          el.style.visibility = '';
          // Kept inside the canvas.
          const x = Math.min(box.width - 8, Math.max(8, at.x - box.left));
          const y = Math.min(box.height - 30, Math.max(8, at.y - box.top - (selection.kind === 'joint' ? 12 : 22)));
          el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selection, shown, labelPoint]);

  if (!selection || !shown) return null;
  const name = selection.kind === 'joint' || selection.kind === 'figure'
    ? scene.figures.find((f) => f.id === selection.figure)?.name
    : selection.kind === 'prop' ? scene.props.find((p) => p.id === selection.prop)?.name
      : selection.kind === 'camera' ? scene.cameras.find((x) => x.id === selection.camera)?.name : undefined;
  if (!name) return null;
  const text = selection.kind === 'joint' ? `${name} · ${JOINT_LABELS[selection.joint]}` : selection.kind === 'camera' && scene.animation ? `${name} · ${time.toFixed(1)} s` : name;
  return (
    <div className="sel-layer">
      <div ref={label} className="sel-label" style={{ visibility: 'hidden' }}>{text}</div>
    </div>
  );
}
