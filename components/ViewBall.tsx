'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { VIEW_PRESETS } from '@/lib/views';
import { command, type Ctx } from './commands';
import { GIZMO_REACH, GIZMO_SIZE, hoverGizmo, type GizmoEnd } from './viewGizmo';

/** The axes' ends: the views of the keys 1–5 (from +X is from the figures' left; +Z is the way they face). Below is not a view. */
const ENDS: { axis: 0 | 1 | 2; sign: 1 | -1; key?: string }[] = [
  { axis: 0, sign: 1, key: '3' },
  { axis: 0, sign: -1, key: '4' },
  { axis: 1, sign: 1, key: '5' },
  { axis: 1, sign: -1 },
  { axis: 2, sign: 1, key: '1' },
  { axis: 2, sign: -1, key: '2' },
];
const NAMES = ['x', 'y', 'z'] as const;
/** Its size (px), the 3D gizmo's square, and how far from its middle the axes' ends are drawn there. */
const SIZE = GIZMO_SIZE;
const R = (GIZMO_SIZE / 2) * GIZMO_REACH;
/** Degrees the view turns for each pixel the widget is dragged (as the canvas, but a small thing to drag). */
const TURN = 1.2;

/** The view preset nearest a view (its yaw and pitch), if it is near one. */
function nearest(v: { yaw: number; pitch: number }) {
  const gap = (p: (typeof VIEW_PRESETS)[number]) => {
    const dyaw = Math.abs((((v.yaw - p.yaw) % 360) + 540) % 360 - 180);
    return (p.pitch > 60 && v.pitch > 60 ? 0 : dyaw) + Math.abs(v.pitch - p.pitch);
  };
  const best = VIEW_PRESETS.reduce((b, p) => (gap(p) < gap(b) ? p : b));
  return gap(best) < 12 ? best.key : null;
}

/** Where an axis's end is drawn for a view: across and down the widget, and how near (+: towards the viewer). */
function project(axis: number, sign: number, { yaw, pitch }: { yaw: number; pitch: number }) {
  const [y, p] = [(yaw * Math.PI) / 180, (Math.min(89, Math.max(-89, pitch)) * Math.PI) / 180];
  // The view's right, up and towards-the-viewer directions (as fitCamera has them).
  const right = [Math.cos(y), 0, -Math.sin(y)];
  const back = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  const up = [-Math.sin(p) * Math.sin(y), Math.cos(p), -Math.sin(p) * Math.cos(y)];
  return { x: sign * right[axis] * R, y: -sign * up[axis] * R, depth: sign * back[axis] };
}

/**
 * The view gizmo's hands (#38), unseen: over the 3D gizmo drawn in the canvas's top-right corner
 * (viewGizmo.ts: the world's axes as the view sees them, X red, Y green, Z blue, as everywhere), its
 * axes' ends as buttons at the same places. Dragging it turns the view round what it looks at; a click
 * on an end turns the view to look from there, as the keys 1–5 do (¾ is the key 6).
 */
export default function ViewBall({ ctx, view, turn }: { ctx: Ctx; view(): { yaw: number; pitch: number } | null; turn(yaw: number, pitch: number): void }) {
  const [v, setV] = useState({ yaw: 0, pitch: 4 });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = view();
      if (now) setV((was) => (Math.round(was.yaw) === Math.round(now.yaw) && Math.round(was.pitch) === Math.round(now.pitch) ? was : { yaw: now.yaw, pitch: now.pitch }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view]);
  const at = nearest(v);
  // A drag anywhere on it (its ends too) turns the view; a press that does not move is a click.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    dragged.current = false;
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    // (Held from here on, wherever the pointer goes; a press that did not move stays a click on an end.)
    if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
    d.moved = true;
    dragged.current = true;
    turn(dx * TURN, dy * TURN);
    [d.x, d.y] = [e.clientX, e.clientY];
  };
  const up = () => { drag.current = null; };
  // Far ends first: the near ones are drawn (and clicked) over them.
  const ends = ENDS.map((e) => ({ ...e, ...project(e.axis, e.sign, v) })).sort((a, b) => a.depth - b.depth);
  // (Unseen: the 3D gizmo under it is what shows, the end the pointer rests on drawn larger there.)
  const end = (e: (typeof ends)[number]) => {
    const name = `${NAMES[e.axis]}${e.sign > 0 ? '+' : '-'}` as GizmoEnd;
    const style: CSSProperties = { transform: `translate(${SIZE / 2 + e.x}px, ${SIZE / 2 + e.y}px) translate(-50%, -50%)`, zIndex: Math.round(e.depth * 10) + 10 };
    const className = `view-end${e.sign > 0 ? '' : ' minus'}`;
    if (!e.key) return <span key={name} className={className} style={style} aria-hidden />;
    const cmd = command(`view.${e.key}`);
    return (
      <button
        key={name}
        type="button"
        className={className}
        style={style}
        aria-label={typeof cmd.title === 'string' ? cmd.title : e.key}
        aria-pressed={at === e.key}
        onPointerEnter={() => hoverGizmo(name)}
        onPointerLeave={() => hoverGizmo(null)}
        onClick={() => { if (!dragged.current) cmd.run!(ctx); dragged.current = false; }}
      />
    );
  };
  return (
    <div className="view-ball" role="group" aria-label="View" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {ends.map(end)}
    </div>
  );
}
