'use client';

import { useEffect, useRef, useState } from 'react';
import { setJoint } from '@/lib/actions';
import { jointLimits, wrapDeg } from '@/lib/joints';
import type { Store } from '@/lib/store';
import type { JointName, Vec3 } from '@/lib/types';
import { arcHint, limitText, setPointerHint, setReadout, sliderName, sliderText } from './hints';

/** The selected joint on screen: where it is, the way away from the parts next to it, and the way its part goes on screen as each slider grows. */
export type JointOnScreen = { x: number; y: number; away: number; turns: [number, number][] };

/** The arcs' radii (px), one per slider; each is 100° long, centred on the way away from the body. */
const RADII = [48, 68, 88];
const HALF = (50 * Math.PI) / 180;
const DEG = Math.PI / 180;
let drags = 0;

/** A point at angle `a` (screen radians, y down) and radius `r` from (0, 0). */
const at = (a: number, r: number) => [r * Math.cos(a), r * Math.sin(a)] as const;

/**
 * The selected joint's sliders as three short arcs beside it on screen, each in its axis's colour
 * with an arrowhead at its + end (the way the part then goes). Thin to look at, wide to grab, above
 * the body; travel along an arc is degrees, and a rough straight drag works (the travel along the
 * arc where it was grabbed counts). Shift: 5° steps; Ctrl: a fifth of the speed. With the limits
 * on, a drag stops at them and the arc flashes. A double-click types the value.
 */
export default function JointArcs({ store, figure, joint, value, limits, onScreen, onLimit }: {
  store: Store;
  figure: string;
  joint: JointName;
  /** The joint's slider values now. */
  value: Vec3;
  limits: boolean;
  onScreen(): JointOnScreen | null;
  /** Held at a limit (or no longer): the part flashes with the arc. */
  onLimit(on: boolean): void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [place, setPlace] = useState<{ x: number; y: number; away: number; signs: number[] } | null>(null);
  const [active, setActive] = useState<{ axis: number; limit: boolean; drag: boolean } | null>(null);
  const [typing, setTyping] = useState<{ axis: number; x: number; y: number } | null>(null);
  const live = useRef(value);
  useEffect(() => { live.current = value; }, [value]);

  // Follow the joint on screen (as the view turns, as it moves).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = onScreen();
      const box = svg.current?.getBoundingClientRect();
      if (!s || !box) setPlace(null);
      else {
        const x = s.x - box.left;
        const y = s.y - box.top;
        // + is the way the part goes as the value grows: anticlockwise on screen, or clockwise.
        const signs = s.turns.map(([dx, dy]) => (-Math.sin(s.away) * dx + Math.cos(s.away) * dy < 0 ? -1 : 1));
        setPlace((p) => (p && Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5 && Math.abs(p.away - s.away) < 0.01 && p.signs.every((v, i) => v === signs[i]) ? p : { x, y, away: s.away, signs }));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onScreen]);

  if (!place) return <svg ref={svg} className="joint-arcs" aria-hidden />;

  const down = (axis: number) => (e: React.PointerEvent<SVGPathElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const box = svg.current!.getBoundingClientRect();
    // The way + goes along the arc where it was grabbed.
    const a = Math.atan2(e.clientY - box.top - place.y, e.clientX - box.left - place.x);
    const sign = place.signs[axis];
    const way = [-Math.sin(a) * sign, Math.cos(a) * sign];
    const perDegree = RADII[axis] * DEG;
    const start = live.current;
    const [x0, y0] = [e.clientX, e.clientY];
    const key = `arc:${figure}:${joint}:${drags++}`;
    let moved = false;
    setActive({ axis, limit: false, drag: true });
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true;
      let v = start[axis] + (((ev.clientX - x0) * way[0] + (ev.clientY - y0) * way[1]) / perDegree) * (ev.ctrlKey || ev.metaKey ? 0.2 : 1);
      if (ev.shiftKey) v = Math.round(v / 5) * 5;
      const [lo, hi] = jointLimits(joint)[axis];
      const value = limits ? Math.min(hi, Math.max(lo, v)) : wrapDeg(v);
      const limit = limits && value !== v;
      const next: Vec3 = [...start];
      next[axis] = Math.round(value * 10) / 10;
      setJoint(store, figure, joint, next, key);
      setActive({ axis, limit, drag: true });
      onLimit(limit);
      setReadout(limit ? limitText(joint, value) : sliderText(joint, axis, next[axis]), undefined, axis);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setActive(null);
      onLimit(false);
      setReadout(null);
      setPointerHint(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const commit = (text: string) => {
    const n = Number(text);
    if (typing && text.trim() !== '' && Number.isFinite(n)) {
      const [lo, hi] = limits ? jointLimits(joint)[typing.axis] : [-180, 180];
      const next: Vec3 = [...value];
      next[typing.axis] = Math.min(hi, Math.max(lo, n));
      setJoint(store, figure, joint, next, '');
    }
    setTyping(null);
  };

  return (
    <>
      <svg ref={svg} className="joint-arcs" aria-hidden>
        <g transform={`translate(${place.x} ${place.y})`}>
          {RADII.map((r, i) => {
            const [a0, a1] = [place.away - HALF, place.away + HALF];
            const [x0, y0] = at(a0, r);
            const [x1, y1] = at(a1, r);
            const d = `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
            // The arrowhead at the + end, along the arc.
            const end = place.signs[i] > 0 ? a1 : a0;
            const [ex, ey] = at(end, r);
            const turn = (end / DEG) + (place.signs[i] > 0 ? 90 : -90);
            const on = active?.axis === i || (!active && typing?.axis === i);
            const faded = active && active.axis !== i;
            return (
              <g key={i} className={`joint-arc ${'xyz'[i]}${on ? ' on' : ''}${faded ? ' faded' : ''}${active?.axis === i && active.limit ? ' limit' : ''}`}>
                <path d={d} className="joint-arc-edge" />
                <path d={d} className="joint-arc-line" />
                <path d="M -5 -5.5 L 6 0 L -5 5.5 Z" className="joint-arc-head" transform={`translate(${ex} ${ey}) rotate(${turn})`} />
                <path
                  d={d}
                  className="joint-arc-hit"
                  data-axis={i}
                  onPointerDown={down(i)}
                  onPointerEnter={() => {
                    if (active?.drag) return;
                    setActive({ axis: i, limit: false, drag: false });
                    setPointerHint(arcHint(joint, i));
                    setReadout(sliderText(joint, i, live.current[i]), undefined, i);
                  }}
                  onPointerLeave={() => {
                    if (active?.drag) return;
                    setActive(null);
                    setPointerHint(null);
                    setReadout(null);
                  }}
                  onDoubleClick={(e) => {
                    const box = svg.current!.getBoundingClientRect();
                    setTyping({ axis: i, x: e.clientX - box.left, y: e.clientY - box.top });
                  }}
                />
              </g>
            );
          })}
        </g>
      </svg>
      {typing && (
        <input
          className="arc-value"
          type="number"
          autoFocus
          aria-label={`${sliderName(joint, typing.axis)} value`}
          defaultValue={Math.round(value[typing.axis] * 10) / 10}
          style={{ left: typing.x + 12, top: typing.y - 14 }}
          onFocus={(e) => e.target.select()}
          onBlur={() => setTyping(null)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit(e.currentTarget.value);
            else if (e.key === 'Escape') setTyping(null);
          }}
        />
      )}
    </>
  );
}
