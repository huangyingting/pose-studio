'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { VIEW_PRESETS } from '@/lib/views';
import { command, type Ctx } from './commands';

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
const R = 32;
/** Its size (px); the axes' ends round its middle at R. */
const SIZE = 84;
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
 * The view widget in the canvas's top-right corner: the world's axes as the view sees them (X red,
 * Y green, Z blue, as everywhere). Dragging it turns the view round what it looks at; a click on an
 * end turns the view to look from there, as the keys 1–5 do; ¾ (6) is beside it; the end the view
 * looks from is marked.
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
  const button = (key: string, className: string, style: CSSProperties | undefined, text: string) => {
    const cmd = command(`view.${key}`);
    const label = typeof cmd.title === 'string' ? cmd.title : key;
    return (
      <button
        key={key}
        type="button"
        className={`${className}${at === key ? ' on' : ''}`}
        style={style}
        aria-label={label}
        aria-pressed={at === key}
        data-tip={`${label}  ${key}`}
        data-tip-side="left"
        onClick={() => { if (!dragged.current) cmd.run!(ctx); dragged.current = false; }}
      >
        {text}
      </button>
    );
  };
  return (
    <div className="view-ball" role="group" aria-label="View" data-tip="Drag to turn the view; click an axis to look from there" data-tip-side="left" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <svg viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden>
        {ends.filter((e) => e.sign > 0).map((e) => (
          <line key={e.axis} x1={0} y1={0} x2={e.x} y2={e.y} className={`view-axis ${NAMES[e.axis]}`} />
        ))}
      </svg>
      {ends.map((e) => {
        const style = { transform: `translate(${SIZE / 2 + e.x}px, ${SIZE / 2 + e.y}px) translate(-50%, -50%)`, zIndex: Math.round(e.depth * 10) + 10 };
        const className = `view-end ${NAMES[e.axis]}${e.sign > 0 ? '' : ' minus'}`;
        return e.key ? button(e.key, className, style, e.sign > 0 ? NAMES[e.axis].toUpperCase() : '') : <span key="below" className={className} style={style} aria-hidden />;
      })}
      {button('6', 'view-quarter', undefined, '¾')}
    </div>
  );
}
