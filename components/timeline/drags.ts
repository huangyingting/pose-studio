import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  editMarker, editShot, giveAction, moveAction, moveKey, moveKeys, moveShotCut, retime, retimeCameraPoint, retimeKeys, rippleKeys, setBlend, setRange, slip, trim,
} from '@/lib/actions';
import { snapTime } from '@/lib/animation';
import { clipById, loopsOf } from '@/lib/assets';
import { cameraById } from '@/lib/cameras';
import { shotSpans, type ShotSpan } from '@/lib/shots';
import type { Store } from '@/lib/store';
import { keyTimesOf, moments } from '@/lib/track';
import type { Action, Animation, Figure } from '@/lib/types';
import type { Notify } from '../ui';

/*
 * What is dragged along the timeline's lanes (#19, #22): the time under the pointer, the window
 * sliding on near an edge of a zoomed view, snapping to what is near, and each thing's drag: a
 * key (or the picked keys, or their span), a box picking keys and blocks, an action's block, its
 * edges and its blend, a camera's point, a cut, a marker, the in and out.
 */

/** How near an edge of a zoomed view a drag slides it on (px), and at most how fast (windows a second). */
const EDGE = 32;
const EDGE_SPEED = 1.5;

/** Keys picked to move together (on one figure's row). */
export type KeyPick = { figure: string; times: number[] };
/** The stretch of time on show (for what runs between renders: a drag, its auto-scroll). */
export type Shown = { v0: number; span: number; zoomed: boolean; total: number };

export interface DragsOf {
  store: Store;
  a: Animation;
  figures: Figure[];
  /** The camera row's camera and its points' times. */
  rowCam: string;
  camTimes: number[];
  /** The lanes, and the timeline (whose people's rows a box is drawn across). */
  track: RefObject<HTMLDivElement | null>;
  root: RefObject<HTMLDivElement | null>;
  view: RefObject<Shown>;
  laneWidth: number;
  snapping: boolean;
  keyPick: KeyPick | null;
  setPicked(p: KeyPick | null): void;
  setBox(b: { figure: string; rows: string[]; t0: number; t1: number } | null): void;
  setSnapAt(t: number | null): void;
  setReadout(r: { t: number; text: string } | null): void;
  setZoom(z: { start: number; span: number } | null): void;
  pause(): void;
  seek(t: number): void;
  notify: Notify;
}

/** The timeline's drags, for its rows (see DragsOf for what they work with). */
export function useDrags(d: DragsOf) {
  const { store, a, figures, camTimes, track, root, view, laneWidth, snapping, keyPick, setPicked, setBox, setSnapAt, setReadout, setZoom, pause, seek, notify } = d;
  const snapper = (skip: (t: number) => boolean = () => false) => {
    const now = store.scene.animation!;
    const targets = snapping ? [
      store.getState().time,
      ...now.actions.flatMap((x) => [x.start, x.start + x.duration]),
      ...figures.flatMap((f) => moments(now, f.id)),
      ...now.shots.map((x) => x.start),
      ...(now.markers ?? []).map((m) => m.t),
      ...camTimes,
    ].filter((t) => !skip(t)) : [];
    /** Where t lands: on a target within reach (null if none: the frame it is on). */
    const near = (t: number) => {
      const reach = (6 / laneWidth) * view.current.span;
      let best: number | null = null;
      for (const x of targets) if (Math.abs(x - t) <= reach && (best === null || Math.abs(x - t) < Math.abs(best - t))) best = x;
      return best;
    };
    return {
      near,
      /** t, snapped (the line shown where). */
      at: (t: number) => { const x = near(t); setSnapAt(x); return x ?? t; },
      done: () => setSnapAt(null),
    };
  };
  // (While dragging, the scale the drag began with: what is dragged past the end lengthens the scene,
  // and the window shown rescales, but the drag keeps to its own; only its auto-scroll moves it on.)
  const dragView = useRef<{ v0: number; span: number } | null>(null);
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const v = dragView.current ?? view.current;
    return v.v0 + ((clientX - r.left) / r.width) * v.span;
  };
  /**
   * While something is dragged along the lanes of a zoomed view: near an edge the window slides on,
   * faster the nearer, and the drag goes on with the time now under the pointer. Returns the stop.
   */
  const follow = (x0: number, move: (ev: { clientX: number }) => void) => {
    let x = x0;
    let last = 0;
    dragView.current = { v0: view.current.v0, span: view.current.span };
    const at = (ev: PointerEvent) => { x = ev.clientX; };
    let raf = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const v = view.current;
      const el = track.current;
      if (v.zoomed && el) {
        const r = el.getBoundingClientRect();
        const d = x < r.left + EDGE ? -(r.left + EDGE - x) : x > r.right - EDGE ? x - (r.right - EDGE) : 0;
        if (d) {
          const by = Math.sign(d) * Math.min(1, Math.abs(d) / EDGE) ** 2 * EDGE_SPEED * v.span * dt;
          const start = Math.min(Math.max(0, v.v0 + by), v.total - v.span);
          if (Math.abs(start - v.v0) > 1e-9) {
            view.current = { ...v, v0: start };
            dragView.current = { v0: start, span: v.span };
            setZoom({ start, span: v.span });
            move({ clientX: x });
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('pointermove', at, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', at, true); dragView.current = null; };
  };
  const scrub = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    seek(timeAt(e.clientX));
    const move = (ev: { clientX: number }) => seek(timeAt(ev.clientX));
    const stop = follow(e.clientX, move);
    const up = () => { stop(); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  /**
   * Drag one figure's key along its track to retime it (the other figures keep their timing).
   * With Shift (or from a walk, run or jump bar) the keys after it come along: a pause put in or
   * taken out. A click without moving just goes there.
   */
  const dragKey = (t: number, figureId: string, rippleAlways = false) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    if (figureId !== store.getState().activeFigure) store.setActiveFigure(figureId);
    // Keys picked together (Shift-click, or a Shift-drag box on the row) move together.
    const group = !e.shiftKey && keyPick?.figure === figureId && keyPick.times.length > 1 && keyPick.times.some((x) => Math.abs(x - t) < 0.5 / a.fps) ? keyPick.times : null;
    if (!group && !e.shiftKey && keyPick) setPicked(null);
    const shift = e.shiftKey && !rippleAlways;
    let dragged = false;
    const ripple = rippleAlways || e.shiftKey;
    // On the window: the key's button is re-created as its time changes during the drag.
    const el = window;
    let from = t;
    store.setTime(t);
    // Keys elsewhere to line up with (other figures', props', the camera's, the cuts): a punch
    // lands as the other flinches.
    const others = [
      ...Object.values(a.props ?? {}).flatMap((keys) => keys.map((k) => k.t)),
    ].filter((x) => Math.abs(x - t) > 1e-6);
    const snap = snapper((x) => Math.abs(x - t) < 1e-6);
    const move = (ev: { clientX: number }) => {
      let to = snapTime(a, timeAt(ev.clientX));
      const near = snap.near(to) ?? (snapping ? others.find((x) => Math.abs(x - to) < (6 / laneWidth) * view.current.span) : undefined);
      setSnapAt(near ?? null);
      if (near !== undefined && near !== null) to = near;
      if (Math.abs(to - from) < 1e-6) return;
      dragged = true;
      if (group) {
        const by = to - from;
        if (moveKeys(store, figureId, group.map((x) => x + (from - t)), by, `keys:${figureId}`)) {
          from = to;
          store.setTime(to);
          setPicked({ figure: figureId, times: group.map((x) => x + (to - t)) });
        }
        return;
      }
      if (ripple) rippleKeys(store, figureId, from, to - from, `ripple:${figureId}`);
      else moveKey(store, from, to, figureId);
      const now = moments(store.scene.animation!, figureId).find((k) => Math.abs(k - to) < 0.5 / a.fps);
      if (now !== undefined) {
        from = now;
        store.setTime(now);
      }
    };
    const stop = follow(e.clientX, move);
    const up = () => {
      stop();
      snap.done();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      // A Shift-click (no drag) adds the key to those picked, or takes it out.
      if (shift && !dragged) {
        const had = keyPick?.figure === figureId ? keyPick.times : [];
        const on = had.some((x) => Math.abs(x - t) < 0.5 / a.fps);
        const times = on ? had.filter((x) => Math.abs(x - t) >= 0.5 / a.fps) : [...had, t];
        setPicked(times.length ? { figure: figureId, times } : null);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  /** Drag the end of the picked keys' span (#22): their timing scaled from the first, as far as no key is passed. */
  const scaleKeys = (figureId: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !keyPick || keyPick.times.length < 2) return;
    e.stopPropagation();
    pause();
    const start = [...keyPick.times].sort((p, q) => p - q);
    const [first, last] = [start[0], start[start.length - 1]];
    let now = start;
    const snap = snapper((x) => start.some((t) => Math.abs(t - x) < 1e-6));
    const move = (ev: { clientX: number }) => {
      const end = Math.max(first + 1 / a.fps, snap.at(timeAt(ev.clientX)));
      const k = (end - first) / Math.max(1e-6, last - first);
      const to = start.map((t) => first + (t - first) * k);
      now = retimeKeys(store, figureId, now, to, `scale:${figureId}`);
      setPicked({ figure: figureId, times: now });
    };
    const stop = follow(e.clientX, move);
    const up = () => { stop(); snap.done(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /**
   * Shift-drag along a row's empty stretch: a box picking the keys in it, and the blocks in it on
   * every row it is drawn across (#22).
   */
  const boxKeys = (figureId: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !e.shiftKey) return;
    e.stopPropagation();
    const t0 = timeAt(e.clientX);
    const y0 = e.clientY;
    let y = y0;
    // (The people's rows between where it started and the pointer, top to bottom.)
    const across = () => [...(root.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
      .filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > Math.min(y0, y) && b.top <= Math.max(y0, y); })
      .map((r) => r.dataset.row!);
    const move = (ev: { clientX: number; clientY?: number }) => {
      if (ev.clientY !== undefined) y = ev.clientY;
      setBox({ figure: figureId, rows: across(), t0, t1: timeAt(ev.clientX) });
    };
    const stop = follow(e.clientX, move);
    const up = (ev: PointerEvent) => {
      stop();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBox(null);
      y = ev.clientY;
      const [lo, hi] = [Math.min(t0, timeAt(ev.clientX)), Math.max(t0, timeAt(ev.clientX))];
      const anim = store.scene.animation!;
      const times = keyTimesOf(anim, figureId).filter((x) => x >= lo - 1e-6 && x <= hi + 1e-6);
      setPicked(times.length ? { figure: figureId, times } : null);
      // The blocks it covers (not corrections: they go with what they correct), picked together.
      const rows = across();
      const blocks = anim.actions.filter((x) => x.layer !== 'correction' && x.source.kind !== 'keys' && x.duration > 1e-6 && x.start < hi - 1e-6 && x.start + x.duration > lo + 1e-6 && x.roles.some((r) => rows.includes(r.figure)));
      if (blocks.length) {
        const [first, ...also] = blocks;
        store.select({ kind: 'action', action: first.id, figure: first.roles.find((r) => rows.includes(r.figure))!.figure, ...(also.length ? { also: also.map((x) => x.id) } : {}) });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** What a drag does to an action, as it goes on (#22): "Trim end · plays 1.20–3.80 s of Jab, cross". */
  const readoutOf = (now: Action, part: 'move' | 'start' | 'end' | 'blend', stretch: boolean, slipping: boolean) => {
    const src = now.source;
    const s2 = (x: number) => `${x.toFixed(2)} s`;
    const t = part === 'start' || part === 'move' ? now.start : part === 'end' ? now.start + now.duration : now.start - (now.blendIn ?? 0);
    if (part === 'blend') return { t, text: `Blend in · ${s2(now.blendIn ?? 0)}` };
    const whole = src.kind === 'clip' ? clipById(src.clip) : null;
    if (src.kind === 'clip' && whole && !loopsOf(src) && (slipping || (part !== 'move' && !stretch && !now.layer))) {
      const verb = slipping ? 'Slip' : part === 'start' ? 'Trim start' : 'Trim end';
      return { t, text: `${verb} · plays ${(src.from ?? 0).toFixed(2)}–${s2(src.to ?? whole.duration)} of ${whole.name}` };
    }
    if (part === 'move') return { t, text: `Starts at ${s2(now.start)}` };
    if (src.kind === 'clip' && stretch) return { t, text: `Stretch · ${(src.speed ?? 1).toFixed(2)}× · ${s2(now.duration)}` };
    return { t, text: `${part === 'start' ? 'Starts at' : 'Length'} ${s2(part === 'start' ? now.start : now.duration)}` };
  };

  /**
   * Drag an action along its row (what everyone in it does after comes along; Ctrl: slip, another
   * part of its motion played there), an edge to trim it (#22; Alt: stretch it, its speed), or the
   * ramp before it to blend into it over longer; a click picks it for the inspector.
   */
  const dragAction = (act: Action, figureId: string, part: 'move' | 'start' | 'end' | 'blend') => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    const [x0, t0] = [e.clientX, timeAt(e.clientX)];
    const [start, duration, blend] = [act.start, act.duration, act.blendIn ?? 0];
    const key = `act:${act.id}:${part}`;
    const [stretch, slipping, adding] = [e.altKey, (e.ctrlKey || e.metaKey) && part === 'move', e.shiftKey];
    // (Picked with others: they move together, each person's first carrying what follows, #22.)
    const sel = store.getState().selection;
    const group = part === 'move' && sel?.kind === 'action' && sel.also?.length && [sel.action, ...sel.also].includes(act.id)
      ? [sel.action, ...sel.also].map((id) => a.actions.find((x) => x.id === id)!).filter(Boolean).sort((p, q) => p.start - q.start)
      : null;
    const leads = group?.filter((x, i) => !group.slice(0, i).some((y) => y.roles.some((r) => x.roles.some((q) => q.figure === r.figure))));
    let moved = false;
    let slipped = 0;
    const back = store.getState().time;
    let y = e.clientY;
    const mine = new Set((group ?? [act]).flatMap((x) => [x.start, x.start + x.duration]));
    const snap = snapper((x) => [...mine].some((m) => Math.abs(m - x) < 1e-6));
    const move = (ev: { clientX: number; clientY?: number }) => {
      if (ev.clientY !== undefined) y = ev.clientY;
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      const said = () => { const now = store.scene.animation?.actions.find((x) => x.id === act.id); if (now) setReadout(readoutOf(now, part, stretch, slipping)); };
      queueMicrotask(said);
      moved = true;
      let dt = timeAt(ev.clientX) - t0;
      // (Its start, or else its end, onto what is near; an edge onto what is near it.)
      if (part === 'move' && !slipping) {
        const s0 = snap.near(start + dt);
        const s1 = s0 === null ? snap.near(start + duration + dt) : null;
        dt = s0 !== null ? s0 - start : s1 !== null ? s1 - start - duration : dt;
        setSnapAt(s0 ?? s1);
      } else if (part === 'end') dt = snap.at(start + duration + dt) - start - duration;
      else if (part === 'start') dt = snap.at(start + dt) - start;
      // (A slip goes on from where the last move left it.)
      if (slipping) { slip(store, act.id, -(dt - slipped), key); slipped = dt; }
      else if (leads) store.group(() => leads.forEach((x) => moveAction(store, x.id, x.start + dt, `${key}:${x.id}`)));
      else if (part === 'move') moveAction(store, act.id, start + dt, key);
      else if (part === 'end' && (stretch || act.layer === 'correction')) retime(store, act.id, duration + dt, key);
      else if (part === 'end') trim(store, act.id, 'end', start + duration + dt, key);
      else if (part === 'start') trim(store, act.id, 'start', start + dt, key);
      else setBlend(store, act.id, blend - dt, key);
      // (What is dragged shows on the canvas meanwhile, #23: the pose at the edge, or at the start of a slipped motion.)
      if (part === 'start' || part === 'end' || slipping) {
        const now = store.scene.animation?.actions.find((x) => x.id === act.id);
        if (now) store.setTime(part === 'end' ? now.start + now.duration - 1e-3 : now.start);
      }
    };
    const stop = follow(e.clientX, move);
    const up = (ev: PointerEvent) => {
      stop();
      snap.done();
      setReadout(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) {
        // (The playhead back where it was, after showing what was dragged.)
        if (part === 'start' || part === 'end' || slipping) store.setTime(back);
        // Let go over another person's row: it is theirs now (Ctrl: a copy for them), #22.
        const row = part === 'move' && !leads ? (document.elementFromPoint(ev.clientX, y) as HTMLElement | null)?.closest<HTMLElement>('[data-row]')?.dataset.row : undefined;
        if (row && row !== figureId && act.roles.length === 1 && !act.layer) {
          const why = giveAction(store, act.id, row, ev.ctrlKey || ev.metaKey);
          if (why) notify(why);
        }
        return;
      }
      const now = store.getState().selection;
      // Shift-click: picked with the others (or let go of), #22.
      if (adding && now?.kind === 'action' && now.action !== act.id) {
        const others = now.also ?? [];
        const next = others.includes(act.id) ? others.filter((id) => id !== act.id) : [...others, act.id];
        store.select({ kind: 'action', action: now.action, figure: now.figure, ...(next.length ? { also: next } : {}) });
        return;
      }
      store.select({ kind: 'action', action: act.id, figure: figureId });
      // (A click on one of its repeats goes to that repeat, #23.)
      const n = act.source.kind === 'clip' ? act.source.repeat ?? 1 : 1;
      seek(act.start + (act.duration / n) * Math.min(n - 1, Math.max(0, Math.floor(((t0 - act.start) / act.duration) * n))));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drag a point of the row's camera to retime it; a click goes to it. */
  const dragPoint = (t: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    seek(t);
    const cam = d.rowCam;
    let from = t;
    const key = `campoint:${t}`;
    const move = (ev: { clientX: number }) => {
      const to = snapTime(a, timeAt(ev.clientX));
      if (Math.abs(to - from) < 1e-6) return;
      retimeCameraPoint(store, from, to, key, cam);
      const moved = cameraById(store.scene, cam);
      const now = moved?.kind === 'path' ? moved.points.map((p) => p.t).find((x) => Math.abs(x - to) < 0.5 / a.fps) : undefined;
      if (now !== undefined) {
        from = now;
        store.setTime(now);
      }
    };
    const stop = follow(e.clientX, move);
    const up = () => { stop(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drag a cut (a shot's start) to move it, or the ramp after it to set how long the shot blends in. */
  const dragCut = (sp: ShotSpan, part: 'cut' | 'blend') => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    const key = `${part}:${sp.shot.id}`;
    const snap = snapper((x) => Math.abs(x - sp.start) < 1e-6);
    const move = (ev: { clientX: number }) => {
      const t = part === 'cut' ? snap.at(timeAt(ev.clientX)) : timeAt(ev.clientX);
      if (part === 'cut') moveShotCut(store, sp.shot.id, t, key);
      else {
        const now = shotSpans(store.scene.animation!).find((x) => x.shot.id === sp.shot.id)!;
        editShot(store, sp.shot.id, { blend: Math.min(now.end - now.start, Math.max(0, snapTime(a, t) - now.start)) });
      }
    };
    const stop = follow(e.clientX, move);
    const up = () => { stop(); snap.done(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drag a marker along the ruler (snapping as any drag); a click goes to it (#22). */
  const dragMarker = (id: string, t: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pause();
    const x0 = e.clientX;
    let moved = false;
    const snap = snapper((x) => Math.abs(x - t) < 1e-6);
    const move = (ev: { clientX: number }) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      editMarker(store, id, { t: snap.at(timeAt(ev.clientX)) }, `marker:${id}`);
    };
    const stop = follow(e.clientX, move);
    const up = () => {
      stop();
      snap.done();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) seek(t);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** Drag an end of the in / out range along the ruler (#22). */
  const dragRange = (end: 'from' | 'to') => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !a.range) return;
    e.stopPropagation();
    pause();
    const snap = snapper();
    const move = (ev: { clientX: number }) => {
      const now = store.scene.animation?.range;
      if (!now) return;
      const t = snap.at(timeAt(ev.clientX));
      setRange(store, end === 'from' ? { from: Math.min(t, now.to - 0.1), to: now.to } : { from: now.from, to: Math.max(t, now.from + 0.1) }, 'range-drag');
    };
    const stop = follow(e.clientX, move);
    const up = () => { stop(); snap.done(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const renameMarker = (id: string, name: string) => {
    const next = window.prompt('Marker name', name)?.trim();
    if (next) editMarker(store, id, { name: next });
  };
  return { timeAt, follow, snapper, scrub, dragKey, scaleKeys, boxKeys, dragAction, dragPoint, dragCut, dragMarker, dragRange, renameMarker };
}

export type Drags = ReturnType<typeof useDrags>;
