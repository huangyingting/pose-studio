'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CircleDot, Ellipsis } from 'lucide-react';
import { JOINT_LABELS } from '@/lib/joints';
import type { Selection } from '@/lib/types';
import { openContextMenu } from './ContextMenu';
import { PIES, applies, command, enabled, iconOf, keyLabel, menu, selectionCtx, setApp, titleOf, type Choice, type Ctx } from './commands';
import { setPointerHint } from './hints';
import { LIBRARY_CATEGORIES } from './side/libraryItems';
import { Thumbnail } from './side/LibrarySection';
import { useScene, useStore, useStudio } from './store-context';

/*
 * What is selected, named on the canvas, with a hub: the radial menu of its main operations opens
 * from it (or with Q at the pointer, or a long press on touch). Its sectors are commands in fixed
 * places (PIES in commands.ts); a click, a press-and-flick towards one, or its number chooses it;
 * the middle opens the full menu. Sectors that take a choice open it beside them.
 */

type Kind = keyof typeof PIES;
const kindOf = (sel: Selection): Kind | null => (!sel ? null : sel.kind === 'joint' ? 'joint' : sel.kind === 'figure' || sel.kind === 'prop' || sel.kind === 'camera' ? sel.kind : null);

const R_IN = 26;
const R_OUT = 76;

/** A sector's path, centred on (0, 0): from angle a0 to a1 (radians, 0 = up, clockwise). */
function sector(a0: number, a1: number) {
  const p = (r: number, a: number) => `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(R_IN, a0)} L ${p(R_OUT, a0)} A ${R_OUT} ${R_OUT} 0 ${large} 1 ${p(R_OUT, a1)} L ${p(R_IN, a1)} A ${R_IN} ${R_IN} 0 ${large} 0 ${p(R_IN, a0)} Z`;
}

export default function SelectionPie({ labelPoint, hidden }: { labelPoint(sel: NonNullable<Selection>): { x: number; y: number } | null; hidden: boolean }) {
  const store = useStore();
  const scene = useScene();
  const selection = useStudio((s) => s.selection);
  const time = useStudio((s) => s.time);
  const kind = kindOf(selection);
  const label = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // `flick`: opened by a press that is still down (where it went down): its release chooses, after a move.
  const [pie, setPie] = useState<{ x: number; y: number; w: number; h: number; flick: { x: number; y: number } | null } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [choice, setChoice] = useState<{ index: number; x: number; y: number } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });

  // The label follows its thing on screen (as the view turns, as it moves).
  useEffect(() => {
    if (!selection || !kind || hidden) return;
    let raf = 0;
    const tick = () => {
      const el = label.current;
      const box = root.current?.parentElement?.getBoundingClientRect();
      const at = labelPoint(selection);
      if (el && box) {
        if (!at) el.style.visibility = 'hidden';
        else {
          el.style.visibility = '';
          // Above the thing (beside a joint), kept inside the canvas.
          const x = Math.min(box.width - 8, Math.max(8, at.x - box.left));
          const y = Math.min(box.height - 30, Math.max(8, at.y - box.top - (selection.kind === 'joint' ? 12 : 22)));
          el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selection, kind, hidden, labelPoint]);

  const c: Ctx = selectionCtx(store);
  const entries = kind ? PIES[kind] : [];
  const close = useCallback(() => { setPie(null); setHover(null); setChoice(null); setPointerHint(null); }, []);

  /** Open the pie centred on a point of the page (kept inside the canvas). */
  const open = useCallback((x: number, y: number, flick: { x: number; y: number } | null = null) => {
    const box = root.current?.parentElement?.getBoundingClientRect();
    if (!box) return;
    const r = R_OUT + 8;
    setPie({ x: Math.min(box.width - r, Math.max(r, x - box.left)), y: Math.min(box.height - r, Math.max(r, y - box.top)), w: box.width, h: box.height, flick });
    setHover(null);
    setChoice(null);
  }, []);

  // Q (a command) opens it at the pointer; the canvas's long press opens it there.
  useEffect(() => {
    const move = (e: PointerEvent) => { pointer.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('pointermove', move);
    setApp({ openPie: (at) => { const p = at ?? pointer.current; open(p.x, p.y); } });
    return () => window.removeEventListener('pointermove', move);
  }, [open]);
  // Gone when what it was for is: another selection, another scene.
  const [was, setWas] = useState({ selection, scene: scene.id });
  if (was.selection !== selection || was.scene !== scene.id) {
    setWas({ selection, scene: scene.id });
    setPie(null);
    setChoice(null);
    setHover(null);
  }

  /** The sector under a point of the page, or -1 for the middle, null outside. */
  const at = (x: number, y: number) => {
    const box = root.current?.parentElement?.getBoundingClientRect();
    if (!pie || !box) return null;
    const dx = x - box.left - pie.x;
    const dy = y - box.top - pie.y;
    const d = Math.hypot(dx, dy);
    if (d < R_IN) return -1;
    if (d > R_OUT + 40) return null;
    const a = (Math.atan2(dx, -dy) + 2 * Math.PI + Math.PI / entries.length) % (2 * Math.PI);
    return Math.floor(a / ((2 * Math.PI) / entries.length));
  };

  const choose = (i: number) => {
    const e = entries[i];
    if (!e) return;
    const cmd = command(e.id);
    if (!applies(cmd, c) || !enabled(cmd, c)) return;
    if (cmd.items || e.id === 'figure.pose' || e.id === 'figure.motion') {
      // Beside the pie, on the sector's side, kept inside the canvas.
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / entries.length;
      const right = Math.cos(a) >= 0;
      const w = e.id === 'figure.pose' ? 252 : 200;
      const x = right ? Math.min(pie!.w - w - 8, pie!.x + R_OUT + 8) : Math.max(8, pie!.x - R_OUT - 8 - w);
      setChoice({ index: i, x, y: Math.min(pie!.h - 268, Math.max(8, pie!.y + Math.sin(a) * R_OUT - 40)) });
      return;
    }
    close();
    cmd.run!(c);
  };
  const full = () => {
    const box = root.current?.parentElement?.getBoundingClientRect();
    if (!pie || !box) return;
    const items = kind === 'joint' ? menu('figure', { store, figure: c.figure }) : kind ? menu(kind, c) : [];
    close();
    openContextMenu({ clientX: box.left + pie.x, clientY: box.top + pie.y }, items);
  };

  // While it is open: the pointer picks a sector; a release after a flick chooses it; keys 1–8 too.
  useEffect(() => {
    if (!pie) return;
    const move = (e: PointerEvent) => {
      const i = at(e.clientX, e.clientY);
      const next = i !== null && i >= 0 ? i : null;
      setHover(next);
      const entry = next !== null ? entries[next] : null;
      setPointerHint(entry ? `${entry.label ?? titleOf(command(entry.id), c)}${command(entry.id).keys ? `  (${keyLabel(command(entry.id).keys![0])})` : ''}` : i === -1 ? 'All that can be done with it' : null);
    };
    const up = (e: PointerEvent) => {
      const from = pie.flick;
      if (!from) return;
      setPie((p) => p && { ...p, flick: null });
      // A press and release on the spot is a click: the pie stays open.
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < 12) return;
      const i = at(e.clientX, e.clientY);
      if (i !== null && i >= 0) choose(i);
    };
    const down = (e: PointerEvent) => {
      // A press outside it (and outside a choice it opened) closes it.
      if ((e.target as Element).closest('.pie, .pie-choice')) return;
      if (at(e.clientX, e.clientY) === null) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= entries.length && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); choose(n - 1); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  });

  if (!selection || !kind || hidden) return <div ref={root} className="pie-layer" />;
  const name = selection.kind === 'joint' || selection.kind === 'figure'
    ? scene.figures.find((f) => f.id === selection.figure)?.name
    : selection.kind === 'prop' ? scene.props.find((p) => p.id === selection.prop)?.name
      : selection.kind === 'camera' ? scene.cameras.find((x) => x.id === selection.camera)?.name : undefined;
  const text = selection.kind === 'joint' ? `${name} · ${JOINT_LABELS[selection.joint]}` : selection.kind === 'camera' && scene.animation ? `${name} · ${time.toFixed(1)} s` : name;
  const choices: Choice[] | null = choice ? (() => {
    const e = entries[choice.index];
    if (e.id === 'figure.pose' || e.id === 'figure.motion') {
      const cat = LIBRARY_CATEGORIES.find((x) => x.id === (e.id === 'figure.pose' ? 'poses' : 'motions'))!;
      return cat.items(store, { notify: () => {}, notifyUndo: () => {} }).filter((it) => it.drop?.figure).map((it) => ({ title: it.name, icon: it.icon, run: () => it.drop!.figure!(c.figure!), thumb: it.thumb }) as Choice);
    }
    return command(e.id).items!(c);
  })() : null;
  const grid = choice && entries[choice.index].id === 'figure.pose';

  return (
    <div ref={root} className="pie-layer">
      <div ref={label} className="sel-label" style={{ visibility: 'hidden' }}>
        <span>{text}</span>
        <button
          type="button"
          className="sel-hub"
          aria-label={`Actions for ${name}`}
          data-tip={`Actions  ${keyLabel('q')}`}
          aria-expanded={!!pie}
          onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); open(r.left + r.width / 2, r.top + r.height / 2, { x: e.clientX, y: e.clientY }); } }}
        >
          <CircleDot size={13} aria-hidden />
        </button>
      </div>
      {pie && (
        <div className="pie" role="menu" aria-label={`Actions for ${name}`} style={{ left: pie.x, top: pie.y } as CSSProperties}>
          <svg width={2 * R_OUT + 4} height={2 * R_OUT + 4} viewBox={`${-R_OUT - 2} ${-R_OUT - 2} ${2 * R_OUT + 4} ${2 * R_OUT + 4}`} aria-hidden>
            {entries.map((e, i) => {
              const w = (2 * Math.PI) / entries.length;
              return <path key={e.id} d={sector(i * w - w / 2, i * w + w / 2)} className={`pie-sector${hover === i ? ' on' : ''}`} />;
            })}
          </svg>
          {entries.map((e, i) => {
            const cmd = command(e.id);
            const ok = applies(cmd, c) && enabled(cmd, c);
            const Icon = iconOf(cmd, c) ?? Ellipsis;
            const a = -Math.PI / 2 + (i * 2 * Math.PI) / entries.length;
            const r = (R_IN + R_OUT) / 2;
            const title = e.label ?? titleOf(cmd, c);
            return (
              <button
                key={e.id}
                type="button"
                role="menuitem"
                className={`pie-item${hover === i ? ' on' : ''}`}
                aria-label={title}
                aria-disabled={!ok || undefined}
                style={{ left: Math.cos(a) * r, top: Math.sin(a) * r } as CSSProperties}
                onClick={() => choose(i)}
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden />
              </button>
            );
          })}
          <button type="button" className="pie-hub" aria-label="All that can be done with it" onClick={full}>
            {hover !== null ? <span className="pie-name">{entries[hover].label ?? titleOf(command(entries[hover].id), c)}<em>{hover + 1}</em></span> : <Ellipsis size={16} aria-hidden />}
          </button>
        </div>
      )}
      {choice && choices && (
        <div
          className={`pie-choice${grid ? ' grid' : ''}`}
          role="menu"
          aria-label={entries[choice.index].label ?? titleOf(command(entries[choice.index].id), c)}
          style={{ left: choice.x, top: choice.y } as CSSProperties}
        >
          {choices.map((ch, i) => (
            <button
              key={`${ch.title}:${i}`}
              type="button"
              role={ch.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={ch.checked}
              aria-label={grid ? ch.title : undefined}
              data-tip={grid ? ch.title : undefined}
              disabled={ch.disabled}
              onClick={() => { close(); ch.run(); }}
            >
              {grid ? <Thumbnail thumb={(ch as Choice & { thumb?: Parameters<typeof Thumbnail>[0]['thumb'] }).thumb} fallback={null} /> : <span>{ch.title}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
