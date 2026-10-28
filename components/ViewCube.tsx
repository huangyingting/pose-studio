'use client';

import { useEffect, useState } from 'react';
import { VIEW_PRESETS } from '@/lib/views';
import { command, type Ctx } from './commands';

/** The widget's buttons: the views of the keys 1–6, laid out as seen from the front (above on top, the figure's right on the left). */
const CELLS = [
  { key: '5', short: 'T', area: 'top' },
  { key: '4', short: 'R', area: 'left' },
  { key: '1', short: 'F', area: 'front' },
  { key: '3', short: 'L', area: 'right' },
  { key: '2', short: 'B', area: 'back' },
  { key: '6', short: '¾', area: 'quarter' },
];

/** The view preset nearest a view (its yaw and pitch), if it is near one. */
function nearest(v: { yaw: number; pitch: number }) {
  const gap = (p: (typeof VIEW_PRESETS)[number]) => {
    const dyaw = Math.abs((((v.yaw - p.yaw) % 360) + 540) % 360 - 180);
    return (p.pitch > 60 && v.pitch > 60 ? 0 : dyaw) + Math.abs(v.pitch - p.pitch);
  };
  const best = VIEW_PRESETS.reduce((b, p) => (gap(p) < gap(b) ? p : b));
  return gap(best) < 12 ? best.key : null;
}

/**
 * The view widget in the canvas's top-right corner: a click turns the view to the front, back,
 * either side, above or three-quarter, as the keys 1–6 do; the one the view is at is marked.
 */
export default function ViewCube({ ctx, view }: { ctx: Ctx; view(): { yaw: number; pitch: number } | null }) {
  const [at, setAt] = useState<string | null>('1');
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = view();
      if (v) setAt(nearest(v));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view]);
  return (
    <div className="view-cube" role="group" aria-label="View">
      {CELLS.map((c) => {
        const cmd = command(`view.${c.key}`);
        const label = typeof cmd.title === 'string' ? cmd.title : c.short;
        return (
          <button
            key={c.key}
            type="button"
            className={`view-cube-side ${c.area}${at === c.key ? ' on' : ''}`}
            aria-label={label}
            aria-pressed={at === c.key}
            data-tip={`${label}  ${c.key}`}
            data-tip-side="left"
            onClick={() => cmd.run!(ctx)}
          >
            {c.short}
          </button>
        );
      })}
    </div>
  );
}
