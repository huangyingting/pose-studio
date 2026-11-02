'use client';

import type { KeyboardEvent } from 'react';
import { JOINT_LABELS } from '@/lib/joints';
import type { JointName } from '@/lib/types';

/*
 * The figure from the front for picking its parts, drawn as the mannequin is: a head, a neck, the
 * shoulders' caps, the upper chest, the ribcage, the waist and the pelvis, and tapered limbs with
 * hands and feet, each part a shape of its own with a hairline between them, as a jointed artist's
 * mannequin. The figure's left is on the viewer's right, as in the 3D front view. Its left side is
 * its right side mirrored, so the two are always alike.
 */

const W = 120;

/** A limb tapering from (x1, y1), r1 wide, to (x2, y2), r2 wide, round at both ends. */
function limb(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number) {
  const [dx, dy] = [x2 - x1, y2 - y1];
  const len = Math.hypot(dx, dy);
  const [nx, ny] = [-dy / len, dx / len];
  const p = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  return `M${p(x1 + nx * r1, y1 + ny * r1)} L${p(x2 + nx * r2, y2 + ny * r2)} A${r2} ${r2} 0 0 0 ${p(x2 - nx * r2, y2 - ny * r2)} L${p(x1 - nx * r1, y1 - ny * r1)} A${r1} ${r1} 0 0 0 ${p(x1 + nx * r1, y1 + ny * r1)}Z`;
}

/** A shape symmetric about the middle: its right half's outline (top to bottom, x from the middle out), closed through its mirror. */
function torso(half: [number, number][]) {
  const right = half.map(([x, y]) => `${(W / 2 - x).toFixed(2)} ${y}`);
  const left = [...half].reverse().map(([x, y]) => `${(W / 2 + x).toFixed(2)} ${y}`);
  return `M${right.join(' L')} L${left.join(' L')}Z`;
}

/** The limbs of one side (the figure's right, on the viewer's left): from, its half width, to, its half width. */
type Limb = [number, number, number, number, number, number];
const SIDE: Record<'Shoulder' | 'UpperArm' | 'LowerArm' | 'Hand' | 'UpperLeg' | 'LowerLeg' | 'Foot' | 'Toes', Limb> = {
  Shoulder: [47, 41, 5, 39, 45, 6],
  UpperArm: [37.5, 51, 5.2, 34, 77, 4.2],
  LowerArm: [33.2, 82, 4, 29.6, 106, 3],
  Hand: [29.2, 111, 3.6, 28.2, 120, 3.2],
  UpperLeg: [52, 109, 7, 50.5, 149, 5],
  LowerLeg: [50.3, 154, 4.8, 49.6, 191, 3.4],
  Foot: [49.4, 196, 4.4, 48.4, 200, 4.6],
  Toes: [48.2, 206, 3.6, 48, 207.5, 3.6],
};

const PARTS: [JointName, string][] = [
  ['head', limb(60, 12, 9.5, 60, 21, 9.5)],
  ['neck', limb(60, 31, 4.2, 60, 36, 4.6)],
  ['upperChest', torso([[7, 37.5], [13, 41.5], [14.5, 47], [14, 50]])],
  ['chest', torso([[14, 50], [14.2, 57], [12.8, 65], [11, 70]])],
  ['spine', torso([[11, 70], [9.8, 77], [11, 84]])],
  ['hips', torso([[11, 84], [14, 91], [15, 100], [11.5, 106.5], [4, 110]])],
  ...(Object.entries(SIDE) as [keyof typeof SIDE, Limb][]).flatMap(([part, [x1, y1, r1, x2, y2, r2]]): [JointName, string][] => [
    [`right${part}` as JointName, limb(x1, y1, r1, x2, y2, r2)],
    // (The left the right mirrored: the two always alike.)
    [`left${part}` as JointName, limb(W - x1, y1, r1, W - x2, y2, r2)],
  ]),
];

export default function BodyMap({ selected, onSelect }: { selected: JointName | null; onSelect(j: JointName): void }) {
  const key = (j: JointName) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(j); }
  };
  return (
    <svg className="bodymap" viewBox={`0 0 ${W} 214`} role="group" aria-label="Body parts">
      {/* The figure's own sides, as seen from the front. */}
      <text x="8" y="30" className="bodymap-side"><title>{"The figure's right"}</title>R</text>
      <text x="104" y="30" className="bodymap-side"><title>{"The figure's left"}</title>L</text>
      {PARTS.map(([j, d]) => (
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
          <path d={d} />
        </g>
      ))}
    </svg>
  );
}
