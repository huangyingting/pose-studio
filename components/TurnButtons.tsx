'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { selectionCtx, turnSelection } from './commands';
import { setPointerHint } from './hints';
import { useStore } from './store-context';

/**
 * ⟲ and ⟳ beside what turns the selection on the canvas (a figure's or prop's floor ring, a rig
 * camera, the lamp): a click turns it 15° that way (#13: steps found on the canvas).
 */
export default function TurnButtons({ onScreen }: { onScreen(): { x: number; y: number; r: number } | null }) {
  const store = useStore();
  const root = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ x: number; y: number; r: number } | null>(null);
  // Follow it on screen (as the view turns, as it moves).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = onScreen();
      const box = root.current?.parentElement?.getBoundingClientRect();
      const next = s && box ? { x: s.x - box.left, y: s.y - box.top, r: s.r } : null;
      setPlace((p) => (p && next && Math.abs(p.x - next.x) < 0.5 && Math.abs(p.y - next.y) < 0.5 && Math.abs(p.r - next.r) < 0.5 ? p : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onScreen]);
  const button = (dir: 1 | -1) => {
    const Icon = dir > 0 ? RotateCcw : RotateCw;
    const label = `Turn 15° ${dir > 0 ? 'anticlockwise' : 'clockwise'} (seen from above)`;
    return (
      <button
        type="button"
        className="turn-step"
        aria-label={label}
        style={place ? { left: place.x - dir * (Math.max(place.r, 14) + 16), top: place.y } : undefined}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerEnter={() => setPointerHint(label)}
        onPointerLeave={() => setPointerHint(null)}
        onClick={() => turnSelection(selectionCtx(store), dir)}
      >
        <Icon size={13} aria-hidden />
      </button>
    );
  };
  return <div ref={root} className="turn-steps" hidden={!place}>{place && <>{button(1)}{button(-1)}</>}</div>;
}
