'use client';

import { Link as LinkIcon, Pencil, Pin, Plus, Repeat, Trash2, Users } from 'lucide-react';
import { correctEveryRepeat, deleteAction, deleteCorrection, editMarker, setBlendCurve, setCorrectionThroughout } from '@/lib/actions';
import { snapTime } from '@/lib/animation';
import { cameraById } from '@/lib/cameras';
import { actionsOf, busySpans, propStretchesOf } from '@/lib/evaluate';
import { propKeyTimes, removePropKey } from '@/lib/propmotion';
import { ISSUE_LABELS, type Issue } from '@/lib/qa';
import type { ShotSpan } from '@/lib/shots';
import type { Store } from '@/lib/store';
import { actionLabel, correctionHeld, correctionTimesOf, keyAtTime, keyEasesOf, keyTimesOf, moments, repeatedUnder, travelInto } from '@/lib/track';
import { MARKER_COLORS, type Animation, type Camera, type Figure, type Marker, type Prop, type Scene } from '@/lib/types';
import { openContextMenu } from '../ContextMenu';
import { menu, menuItems } from '../commands';
import { dragged, endDrag } from '../dragdrop';
import type { Drags, KeyPick } from './drags';

/*
 * The timeline's rows, under its bar: the ruler, the shots, a row per person, one per prop that
 * moves, and the path camera's. They draw the window of time on show (TrackView) and edit through
 * its drags (./drags.ts); the timeline (../Timeline.tsx) holds what they share.
 */

/** What the rows share: the scene and the window of time on show, the timeline's picks and drags. */
export interface TrackView {
  store: Store;
  scene: Scene;
  a: Animation;
  /** The playhead, and the window on show (v0 to v1, span seconds wide, laneWidth px). */
  time: number;
  v0: number;
  v1: number;
  span: number;
  laneWidth: number;
  /** Where t is across the lanes (a CSS left). */
  pct(t: number): string;
  /** A bar's label kept in sight when the bar starts before the window. */
  inSight(t0: number, t1: number): { marginLeft: string } | undefined;
  /** Which of these key times are too close together on screen to draw whole. */
  dense(times: number[]): boolean[];
  /** Whether t is the playhead's frame. */
  near(t: number): boolean;
  pause(): void;
  seek(t: number): void;
  openPicker(figure: string, el: Element): void;
  figures: Figure[];
  multi: boolean;
  active: Figure | undefined;
  /** Who is keyed as they are posed (auto-key). */
  keying: string | null;
  unfolded: Set<string>;
  isPicked(id: string): boolean;
  keyPick: KeyPick | null;
  box: { figure: string; rows: string[]; t0: number; t1: number } | null;
  dropAt: { figure: string; t: number; length?: number } | null;
  setDropAt(d: { figure: string; t: number; length?: number } | null): void;
  /** What happens to the props: let go, caught or taken. */
  events: { t: number; figure: string; kind: 'release' | 'catch'; title: string }[];
  spans: ShotSpan[];
  rowCam: Camera;
  camTimes: number[];
  ticks: number[];
  label(t: number): string | null;
  markers: Marker[];
  issues: Issue[] | null;
  goTo(i: Issue): void;
  drags: Drags;
}

/** The stretches a figure does nothing (idle life fills them as the scene plays), of a third of a second or more. */
function idleGaps(a: Animation, id: string): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const [s, e] of busySpans(a, id)) {
    if (s - at >= 0.3) out.push([at, s]);
    at = Math.max(at, e);
  }
  if (a.duration - at >= 0.3) out.push([at, a.duration]);
  return out;
}

/** The stretches of a prop's time, read-only: in someone's hand, or flying. */
function propBars(scene: Scene, id: string) {
  const name = (fid?: string) => scene.figures.find((f) => f.id === fid)?.name ?? 'a hand';
  return propStretchesOf(scene, id).flatMap((x) => (x.kind === 'held'
    ? [{ t0: x.t0, t1: x.t1, kind: 'held', label: `${name(x.figure)}'s hand` }]
    : x.kind === 'free' ? [{ t0: x.t0, t1: x.t1, kind: 'throw', label: 'Free' }] : []));
}

/** The time ruler: its ticks, the in and out, the markers, and what the motion check found. */
export function Ruler({ tl }: { tl: TrackView }) {
  const { store, a, span, pct, ticks, label, markers, issues, goTo } = tl;
  const { dragMarker, dragRange, renameMarker } = tl.drags;
  return (
    <div className="tl-ruler">
      {ticks.map((t) => {
        const text = label(t);
        return (
          <span key={t} className={text ? 'tick major' : 'tick'} style={{ left: pct(t) }} aria-hidden>
            {text && <em>{text}</em>}
          </span>
        );
      })}
      {a.range && (
        <span className="tl-range" style={{ left: pct(a.range.from), width: `${((a.range.to - a.range.from) / span) * 100}%` }} data-tip="Playback goes round this stretch: drag its ends; X (timeline focused) or the timeline's menu plays all of it">
          <i className="tl-range-end" onPointerDown={(e) => dragRange('from')(e)} />
          <i className="tl-range-end out" onPointerDown={(e) => dragRange('to')(e)} />
        </span>
      )}
      {markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`tl-marker${m.color ? ` ${m.color}` : ''}`}
          style={{ left: pct(m.t) }}
          aria-label={`Marker ${m.name} at ${m.t.toFixed(2)} s`}
          data-tip={`${m.name}: drag to move, double-click (or F2) to rename\nRight-click for more`}
          onPointerDown={dragMarker(m.id, m.t)}
          onDoubleClick={() => renameMarker(m.id, m.name)}
          onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); renameMarker(m.id, m.name); } }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openContextMenu(e, [
              { label: 'Rename…', icon: Pencil, onSelect: () => renameMarker(m.id, m.name) },
              // (Its colour, to tell kinds of beat apart.)
              { group: 'Colour' },
              ...[undefined, ...MARKER_COLORS].map((c) => ({ label: c ? c[0].toUpperCase() + c.slice(1) : 'Blue', radio: true, checked: m.color === c, onSelect: () => editMarker(store, m.id, { color: c ?? null }) })),
              '-',
              { label: 'Delete', icon: Trash2, danger: true, onSelect: () => editMarker(store, m.id, null) },
            ], m.name);
          }}
        >
          <span>{m.name}</span>
        </button>
      ))}
      {issues?.map((i, n) => (
        <button
          key={n}
          type="button"
          className="tl-issue"
          style={{ left: pct(i.start), width: `max(4px, ${(i.end - i.start) / span * 100}%)` }}
          data-tip={i.message}
          aria-label={`${ISSUE_LABELS[i.kind]} at ${i.start.toFixed(2)} s: ${i.message}`}
          onPointerDown={(e) => { e.stopPropagation(); goTo(i); }}
        />
      ))}
    </div>
  );
}

/** The shots: the cuts between cameras, each dragged to move it, its blend after it. */
export function ShotsRow({ tl }: { tl: TrackView }) {
  const { store, scene, time, span, pct, inSight, seek, spans } = tl;
  const { dragCut } = tl.drags;
  return (
    <div className="tl-row shots" aria-label="Shots">
      {spans.map((sp) => {
        const on = time >= sp.start - 1e-6 && (time < sp.end - 1e-6 || sp.index === spans.length - 1);
        return (
          <button
            key={sp.shot.id}
            type="button"
            className={`tl-shot${on ? ' on' : ''}`}
            style={{ left: pct(sp.start), width: `${((sp.end - sp.start) / span) * 100}%` }}
            data-tip={`${sp.shot.name}${sp.shot.caption ? ` — ${sp.shot.caption}` : ''} (click to edit in the inspector)\nRight-click for more`}
            onPointerDown={(e) => { if (e.button) return; e.stopPropagation(); seek(sp.start); store.select({ kind: 'shot', shot: sp.shot.id }); }}
            onContextMenu={(e) => {
              store.select({ kind: 'shot', shot: sp.shot.id });
              openContextMenu(e, menu('shot', { store, shot: sp.shot.id }), sp.shot.name);
            }}
            // A camera move dragged from the Library: onto this shot.
            onDragOver={(e) => { if (dragged()?.shot) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
            onDrop={(e) => { const d = dragged(); if (!d?.shot) return; e.preventDefault(); endDrag(); d.shot(sp.shot.id); }}
          >
            {sp.index > 0 && (
              <>
                <i
                  className={`tl-blend${sp.shot.blend ? '' : ' none'}`}
                  style={sp.shot.blend ? { width: `${Math.min(100, (sp.shot.blend / (sp.end - sp.start)) * 100)}%` } : undefined}
                  data-tip={`Blend in from the shot before${sp.shot.blend ? ` over ${sp.shot.blend.toFixed(2)} s` : ''}: drag right for longer`}
                  onPointerDown={dragCut(sp, 'blend')}
                />
                <i className="tl-cut" data-tip="Drag to move the cut" onPointerDown={dragCut(sp, 'cut')} />
              </>
            )}
            {/* Taken over by hand: the director keeps it as it is. */}
            {sp.shot.pinned && scene.coverage?.live && <Pin size={11} aria-label="Taken over by hand" />}
            <span style={inSight(sp.start, sp.end)}>{sp.shot.name}{cameraById(scene, sp.shot.camera) ? ` · ${cameraById(scene, sp.shot.camera)!.name}` : ''}</span>
            <em>{(sp.end - sp.start).toFixed(1)}s</em>
          </button>
        );
      })}
    </div>
  );
}

/** A person's row: what they do (blocks, their blends and edges), their keys and corrections, the gaps of idle life, what they throw and catch. */
export function FigureRow({ tl, f }: { tl: TrackView; f: Figure }) {
  const { store, scene, a, time, v0, v1, span, laneWidth, pct, inSight, dense, near, pause, seek, openPicker, figures, multi, active, keying, unfolded, isPicked, keyPick, box, dropAt, setDropAt, events } = tl;
  const { timeAt, boxKeys, dragKey, scaleKeys, dragAction } = tl.drags;
  const times = keyTimesOf(a, f.id);
  const eases = keyEasesOf(a, f.id);
  const tight = dense(times);
  // Nothing to do yet: a button where to start (and no idle label under it).
  const empty = !f.proxy && times.length <= 1 && !actionsOf(a, f.id).some((x) => x.source.kind !== 'keys');
  return (
    <div
      data-row={f.id}
      className={`tl-row${multi && f.id === active?.id ? ' active' : ''}${keying === f.id && !f.proxy ? ' autokey' : ''}${f.muted ? ' muted' : ''}${f.locked ? ' locked' : ''}${unfolded.has(f.id) ? ' unfolded' : ''}`}
      aria-label={multi ? `${f.name} keys` : 'Pose keys'}
      onPointerDown={boxKeys(f.id)}
      // A pose or a motion from the Library: onto this figure, at the time it is dropped at.
      onDragOver={(e) => {
        const d = dragged();
        if (!d?.figure || f.proxy) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        const t = snapTime(a, timeAt(e.clientX));
        if (dropAt?.figure !== f.id || dropAt.t !== t) setDropAt({ figure: f.id, t, length: d.length });
      }}
      // (Not when it only passes over a block or a key of the row.)
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null); }}
      onDrop={(e) => {
        const d = dragged();
        setDropAt(null);
        if (!d?.figure || f.proxy) return;
        e.preventDefault();
        endDrag();
        pause();
        store.setTime(snapTime(a, timeAt(e.clientX)));
        d.figure(f.id);
      }}
      onContextMenu={(e) => {
        // How the figure gets from one key (or mark) to the next, for the stretch under the pointer.
        const at = timeAt(e.clientX);
        const next = moments(a, f.id).find((k) => k > at + 1e-6 && (travelInto(a, f.id, k) || keyAtTime(a, f.id, k)));
        if (next === undefined || next === times[0]) { e.preventDefault(); return; }
        store.setActiveFigure(f.id);
        openContextMenu(e, menuItems(['travel.how', 'travel.facing', 'travel.height', 'travel.turns'], { store, figure: f.id, at: next }), `${f.name} · to ${next.toFixed(2)} s`);
      }}
    >
      {/* What it does next, from the playhead (under the blocks: one there takes the click). */}
      {!f.proxy && time >= v0 - 1e-6 && time <= v1 + 1e-6 && (
        <button
          type="button"
          className="tl-add"
          style={{ left: pct(time) }}
          aria-label={`What ${f.name} does next, from ${time.toFixed(2)} s`}
          data-tip={`What ${f.name} does next, from here`}
          data-tip-side="top"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => openPicker(f.id, e.currentTarget)}
        >
          <Plus size={12} aria-hidden />
        </button>
      )}
      {/* What it does next after all it does: the playhead goes there first. */}
      {!f.proxy && (() => {
        const last = Math.max(0, ...[...actionsOf(a, f.id), ...actionsOf(a, f.id, 'upper')].map((x) => x.start + x.duration));
        if (last < v0 - 1e-6 || last > v1 + 1e-6 || Math.abs(last - time) < 0.5 / a.fps) return null;
        return (
          <button
            type="button"
            className="tl-add"
            style={{ left: pct(last) }}
            aria-label={`What ${f.name} does after all it does, from ${last.toFixed(2)} s`}
            data-tip={`What ${f.name} does after all it does`}
            data-tip-side="top"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { pause(); store.setTime(last); openPicker(f.id, e.currentTarget); }}
          >
            <Plus size={12} aria-hidden />
          </button>
        );
      })()}
      {[...actionsOf(a, f.id), ...actionsOf(a, f.id, 'upper')].filter((x) => x.duration > 1e-6).map((x) => {
        const label = actionLabel(x, scene);
        const kind = x.layer === 'upper' ? 'upper' : x.source.kind === 'travel' ? x.source.mode : x.source.kind;
        const group = x.roles.length > 1;
        return (
          <span key={x.id} className="tl-block">
            {!x.layer && x.source.kind !== 'keys' && (
              <span
                className={`tl-ramp ${kind}${x.blendIn ? '' : ' none'}`}
                style={{ left: pct(x.start - (x.blendIn ?? 0)), width: `${((x.blendIn ?? 0) / span) * 100}%` }}
                data-tip={`Blend into ${label}${x.blendIn ? ` over ${x.blendIn.toFixed(2)} s` : ''}: drag left for longer`}
                onPointerDown={dragAction(x, f.id, 'blend')}
                // How the blend goes (#23).
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const now = x.blendCurve ?? 'smooth';
                  openContextMenu(e, ([['smooth', 'Smoothly'], ['linear', 'Evenly'], ['in', 'Easing in'], ['out', 'Easing out']] as const).map(([v, label]) => ({
                    label, checked: now === v, radio: true, onSelect: () => setBlendCurve(store, x.id, v === 'smooth' ? null : v),
                  })), `Blend into ${label}`);
                }}
              />
            )}
            <span
              className={`tl-travel grab ${kind}${group ? ' group' : ''}${isPicked(x.id) ? ' sel' : ''}${(() => { const px = (x.duration / span) * laneWidth; return px < 12 ? ' tiny' : px < 28 ? ' tight' : ''; })()}`}
              style={{ left: pct(x.start), width: `${(x.duration / span) * 100}%` }}
              data-tip={`${label}${x.layer === 'upper' ? ` (upper body, over what ${f.name} is doing)` : ''}${group ? ` with ${x.roles.filter((r) => r.figure !== f.id).map((r) => figures.find((g) => g.id === r.figure)?.name).join(', ')}` : ''}: click or double-click to edit, drag to move it (and what follows)${x.source.kind === 'clip' ? ', Ctrl-drag to play another part of it there' : ''}; ${x.source.kind === 'travel' ? 'its right edge: how long it takes' : 'its edges trim it, Alt-drag one to stretch it'}; Delete removes it\nRight-click for more`}
              onPointerDown={dragAction(x, f.id, 'move')}
              onDoubleClick={() => { pause(); store.select({ kind: 'action', action: x.id, figure: f.id }); }}
              onContextMenu={(e) => {
                e.stopPropagation();
                // (Selected, as the canvas's and a shot's right-click select theirs: the inspector shows it.)
                store.setActiveFigure(f.id);
                store.select({ kind: 'action', action: x.id, figure: f.id });
                openContextMenu(e, menu('action', { store, action: x.id, figure: f.id }), `${f.name} · ${label}`);
              }}
            >
              {group && <Users size={11} aria-hidden />}
              {/* Kept on the blow it reacts to (#23). */}
              {x.reactsTo && <LinkIcon size={11} aria-label="Kept on its blow" />}
              <span style={inSight(x.start, x.start + x.duration)}>{label}{x.layer === 'upper' ? ' · upper body' : ''}</span>
              {/* Its repeats, each a segment (#23). */}
              {(() => {
                const n = x.source.kind === 'clip' ? x.source.repeat ?? 1 : 1;
                return Array.from({ length: n - 1 }, (_, k) => <i key={`lap${k}`} className="tl-lap" style={{ left: `${((k + 1) / n) * 100}%` }} aria-hidden />);
              })()}
              {x.source.kind !== 'travel' && <i className="tl-edge start" aria-hidden onPointerDown={dragAction(x, f.id, 'start')} />}
              <i className="tl-edge" aria-hidden onPointerDown={dragAction(x, f.id, 'end')} />
            </span>
          </span>
        );
      })}
      {unfolded.has(f.id) && <span className="tl-layer-names" aria-hidden><em>Upper body</em><em>Corrections</em></span>}
      {empty && (
        <button type="button" className="tl-empty" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openPicker(f.id, e.currentTarget)}>
          <Plus size={13} aria-hidden /> Add an action
        </button>
      )}
      {keyPick?.figure === f.id && keyPick.times.length > 1 && (() => {
        const [lo, hi] = [Math.min(...keyPick.times), Math.max(...keyPick.times)];
        return (
          <span className="tl-keyspan" style={{ left: pct(lo), width: `${((hi - lo) / span) * 100}%` }} aria-hidden>
            <i className="tl-keyspan-end" data-tip="Drag to stretch or squeeze the picked keys' timing" onPointerDown={(e) => scaleKeys(f.id)(e)} />
          </span>
        );
      })()}
      {box && (box.rows.includes(f.id) || box.figure === f.id) && <span className="tl-box" style={{ left: pct(Math.min(box.t0, box.t1)), width: `${(Math.abs(box.t1 - box.t0) / span) * 100}%` }} aria-hidden />}
      {dropAt?.figure === f.id && (
        <span className="tl-drop" style={{ left: pct(dropAt.t), width: dropAt.length ? `${(dropAt.length / span) * 100}%` : undefined }} aria-hidden />
      )}
      {events.filter((ev) => ev.figure === f.id).map((ev, n) => (
        <span key={`ev${n}`} className={`tl-event ${ev.kind}`} style={{ left: pct(ev.t) }} data-tip={ev.title} aria-hidden />
      ))}
      {/* The gaps where it has idle life as the scene plays (breathing, a look round). */}
      {!f.proxy && !f.still && idleGaps(a, f.id).map(([t0, t1]) => (
        <span key={`idle${t0}`} className="tl-idle" style={{ left: pct(t0), width: `${((t1 - t0) / span) * 100}%` }} aria-hidden>
          {!empty && <span style={inSight(t0, t1)}>idle</span>}
        </span>
      ))}
      {actionsOf(a, f.id, 'correction').filter((x) => x.duration > 1e-6).map((x) => (
        // A correction: its own thin band over what it corrects; its right edge retimes it.
        <span
          key={x.id}
          className={`tl-fixband${isPicked(x.id) ? ' sel' : ''}`}
          style={{ left: pct(x.start), width: `${(x.duration / span) * 100}%` }}
          data-tip="A correction over a motion or a walk: click to edit it, drag its right edge to retime it"
          onPointerDown={(e) => { if (e.button) return; e.stopPropagation(); pause(); store.select({ kind: 'action', action: x.id, figure: f.id }); }}
          // Its menu (#23): held over the whole motion, or only around its edits; deleted.
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            store.select({ kind: 'action', action: x.id, figure: f.id });
            const whole = correctionHeld(x);
            openContextMenu(e, [
              { label: 'Over the whole motion', checked: whole, onSelect: () => setCorrectionThroughout(store, x.id, !whole) },
              ...(repeatedUnder(a, x) ? [{ label: 'On every repeat', icon: Repeat, onSelect: () => correctEveryRepeat(store, x.id) }] : []),
              { label: 'Delete the correction', icon: Trash2, danger: true, onSelect: () => deleteAction(store, x.id) },
            ], `${f.name} · correction`);
          }}
        >
          <i className="tl-edge" aria-hidden onPointerDown={dragAction(x, f.id, 'end')} />
        </span>
      ))}
      {correctionTimesOf(a, f.id).map((t) => (
        <button
          key={`fix${t}`}
          type="button"
          className={`tl-key fix${near(t) ? ' on' : ''}`}
          style={{ left: pct(t) }}
          aria-label={`${multi ? `${f.name} correction` : 'Correction'} at ${t.toFixed(2)} s`}
          data-tip="A correction made over a motion or a walk: click to go to it"
          onPointerDown={(e) => { if (e.button) return; e.stopPropagation(); seek(t); store.setActiveFigure(f.id); }}
          onContextMenu={(e) => {
            e.stopPropagation();
            seek(t);
            store.setActiveFigure(f.id);
            openContextMenu(e, [{ label: 'Delete correction', icon: Trash2, danger: true, onSelect: () => deleteCorrection(store, f.id, t) }], `${f.name} · ${t.toFixed(2)} s`);
          }}
        />
      ))}
      {times.map((t, n) => {
        // How it goes on to the next: a hollow diamond at an even speed, a square held.
        const ease = eases.get(t);
        return (
        <button
          key={t}
          type="button"
          className={`tl-key${near(t) ? ' on' : ''}${tight[n] ? ' dense' : ''}${ease && ease !== 'smooth' ? ` ${ease}` : ''}${keyPick?.figure === f.id && keyPick.times.some((x) => Math.abs(x - t) < 0.5 / a.fps) ? ' picked' : ''}`}
          style={{ left: pct(t) }}
          aria-label={`${multi ? `${f.name} key` : 'Key'} at ${t.toFixed(2)} s`}
          data-tip={`${ease === 'step' ? 'Held until the next key. ' : ease === 'linear' ? 'Goes on at an even speed. ' : ''}Drag to retime; Shift-drag to move the keys after it too; Shift-click to pick several (then drag them together)\nRight-click for more`}
          onPointerDown={dragKey(t, f.id)}
          onContextMenu={(e) => {
            e.stopPropagation();
            seek(t);
            store.setActiveFigure(f.id);
            openContextMenu(e, menu('key', { store, figure: f.id, at: t }), `${f.name} · ${t.toFixed(2)} s`);
          }}
        />
        );
      })}
    </div>
  );
}

/** A moving prop's row: in whose hand and when it flies, read-only; its keys. */
export function PropRow({ tl, p }: { tl: TrackView; p: Prop }) {
  const { store, scene, a, span, pct, inSight, dense, near, seek } = tl;
  const times = propKeyTimes(a, p.id);
  const tight = dense(times);
  return (
    <div className="tl-row" aria-label={`${p.name} keys`}>
      {propBars(scene, p.id).map((b, i) => (
        <span key={`${i}:${b.t0}`} className={`tl-travel ${b.kind}`} style={{ left: pct(b.t0), width: `${((b.t1 - b.t0) / span) * 100}%` }} data-tip={b.label}>
          <span style={inSight(b.t0, b.t1)}>{b.label}</span>
        </span>
      ))}
      {times.map((t, n) => (
        <button
          key={t}
          type="button"
          className={`tl-key prop${near(t) ? ' on' : ''}${tight[n] ? ' dense' : ''}`}
          style={{ left: pct(t) }}
          aria-label={`${p.name} key at ${t.toFixed(2)} s`}
          onPointerDown={(e) => { if (e.button) return; e.stopPropagation(); seek(t); store.select({ kind: 'prop', prop: p.id }); }}
          onContextMenu={(e) => {
            e.stopPropagation();
            seek(t);
            openContextMenu(e, [{
              label: 'Delete key', icon: Trash2, danger: true,
              onSelect: () => store.updateScene((s) => (s.animation ? { ...s, animation: removePropKey(s.animation, t, p.id) } : s)),
            }], `${p.name} · ${t.toFixed(2)} s`);
          }}
        />
      ))}
    </div>
  );
}

/** The path camera's row: its points, to retime; the shots another camera films dimmed. */
export function CameraRow({ tl }: { tl: TrackView }) {
  const { store, span, pct, near, seek, spans, rowCam, camTimes } = tl;
  const { dragPoint } = tl.drags;
  return (
    <div className="tl-row camera" aria-label={`${rowCam.name} track`}>
      {spans.filter((sp) => sp.shot.camera !== rowCam.id).map((sp) => (
        <span key={sp.shot.id} className="tl-dim" style={{ left: pct(sp.start), width: `${((sp.end - sp.start) / span) * 100}%` }} data-tip={`${sp.shot.name} is filmed by another camera`} aria-hidden />
      ))}
      {camTimes.map((t) => (
        <button
          key={t}
          type="button"
          className={`tl-key cam${near(t) ? ' on' : ''}`}
          style={{ left: pct(t) }}
          aria-label={`${rowCam.name} point at ${t.toFixed(2)} s`}
          data-tip={`A point of ${rowCam.name}’s path: drag to retime it`}
          onPointerDown={dragPoint(t)}
          onContextMenu={(e) => {
            seek(t);
            openContextMenu(e, menu('camera', { store, camera: rowCam.id, at: t }), `${rowCam.name} · ${t.toFixed(2)} s`);
          }}
        />
      ))}
    </div>
  );
}
