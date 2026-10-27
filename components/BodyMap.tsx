'use client';

import type { KeyboardEvent } from 'react';
import { JOINT_LABELS } from '@/lib/joints';
import type { JointName } from '@/lib/types';

/*
 * Front-view schematic of the figure for picking joints. The figure's left is on the viewer's
 * right, as in the 3D front view. Each body part is a rounded stroke or a circle.
 */

type Shape = { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w: number } | { kind: 'circle'; cx: number; cy: number; r: number };

const line = (x1: number, y1: number, x2: number, y2: number, w: number): Shape => ({ kind: 'line', x1, y1, x2, y2, w });

const PARTS: [JointName, Shape][] = [
  ['head', { kind: 'circle', cx: 60, cy: 17, r: 11 }],
  ['neck', line(60, 31, 60, 35, 9)],
  ['chest', line(60, 47, 60, 56, 30)],
  ['spine', line(60, 70, 60, 75, 22)],
  ['hips', line(60, 87, 60, 92, 28)],
  ['rightUpperArm', line(39, 44, 33, 69, 10)],
  ['rightLowerArm', line(32, 76, 28, 99, 8.5)],
  ['rightHand', { kind: 'circle', cx: 27, cy: 108, r: 5.5 }],
  ['leftUpperArm', line(81, 44, 87, 69, 10)],
  ['leftLowerArm', line(88, 76, 92, 99, 8.5)],
  ['leftHand', { kind: 'circle', cx: 93, cy: 108, r: 5.5 }],
  ['rightUpperLeg', line(52, 106, 49, 140, 12)],
  ['rightLowerLeg', line(48, 148, 47, 180, 10)],
  ['rightFoot', line(46, 190, 40, 193, 8)],
  ['leftUpperLeg', line(68, 106, 71, 140, 12)],
  ['leftLowerLeg', line(72, 148, 73, 180, 10)],
  ['leftFoot', line(74, 190, 80, 193, 8)],
];

export default function BodyMap({ selected, onSelect }: { selected: JointName | null; onSelect(j: JointName): void }) {
  const key = (j: JointName) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(j); }
  };
  return (
    <svg className="bodymap" viewBox="0 0 120 202" role="group" aria-label="Body parts">
      <text x="14" y="200" className="bodymap-side">R</text>
      <text x="100" y="200" className="bodymap-side">L</text>
      {PARTS.map(([j, s]) => (
        <g
          key={j}
          role="button"
          tabIndex={0}
          aria-label={JOINT_LABELS[j]}
          aria-pressed={selected === j}
          className={selected === j ? 'part on' : 'part'}
          onClick={() => onSelect(j)}
          onKeyDown={key(j)}
        >
          <title>{JOINT_LABELS[j]}</title>
          {s.kind === 'line'
            ? <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} strokeWidth={s.w} />
            : <circle cx={s.cx} cy={s.cy} r={s.r} />}
        </g>
      ))}
    </svg>
  );
}
