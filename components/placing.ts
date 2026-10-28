import { addFigure, addProp, addStandIn, placeTemplate } from '@/lib/actions';
import { sceneAt } from '@/lib/evaluate';
import { newFigure, newProp, newScene, withPosture } from '@/lib/doc';
import { facing, forward, withFacing } from '@/lib/relations';
import type { Store } from '@/lib/store';
import { placeScene, templatesOf } from '@/lib/templates';
import { HANDHELD, PROP_LABELS, type Figure, type PropKind, type Scene, type Vec3 } from '@/lib/types';
import type { CanvasHit } from './Viewport';

/*
 * Adding is placing: a ghost of the new thing follows the pointer on the floor, snapping to the
 * 25 cm grid (Alt: free) and to beside or facing the nearest figure (said in the hint); the wheel
 * or R turns it in 15° steps; a click drops it, Esc cancels. A hand prop goes into the hand of the
 * figure under the pointer; a template's first role onto a figure under it.
 */

export interface Placing {
  /** What the hint says before the pointer is on the floor. */
  hint: string;
  /** The way it faces (degrees), turned by the wheel or R. */
  yaw: number;
  turn(by: number): void;
  /** Where it would go now, and how that is said ("beside Kai"). */
  at: Vec3 | null;
  text: string;
  /** Work out where it goes for the pointer (the floor under it, Alt, what is under it): the ghost to draw. */
  ghost(floor: Vec3 | undefined, alt: boolean, hit: CanvasHit): Scene | null;
  /** Whether Alt (off the grid) was down for the last ghost. */
  alt: boolean;
  drop(hit: CanvasHit): void;
}

const GRID = 0.25;
const NEAR = 0.35;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A spot for a new figure: beside or facing the nearest figure if near one, else on the grid. */
function figureSpot(store: Store, p: Vec3, alt: boolean, yaw: number): { at: Vec3; yaw: number; text: string } {
  // (Where they are drawn: at the playhead.)
  const others = (store.scene.animation ? sceneAt(store.scene, store.getState().time) : store.scene).figures.filter((f) => !f.hidden);
  const near = others.map((f) => ({ f, d: Math.hypot(f.position[0] - p[0], f.position[2] - p[2]) })).sort((a, b) => a.d - b.d)[0]?.f;
  if (near && !alt) {
    const [fx, fz] = forward(near);
    const spots: { at: Vec3; yaw: number; text: string }[] = [
      { at: [near.position[0] - fz * 0.6, 0, near.position[2] + fx * 0.6], yaw: facing(near), text: `beside ${near.name}` },
      { at: [near.position[0] + fz * 0.6, 0, near.position[2] - fx * 0.6], yaw: facing(near), text: `beside ${near.name}` },
      { at: [near.position[0] + fx * 1.1, 0, near.position[2] + fz * 1.1], yaw: facing(near) + 180, text: `facing ${near.name}` },
    ];
    const hit = spots.find((s) => Math.hypot(s.at[0] - p[0], s.at[2] - p[2]) < NEAR);
    if (hit) return { at: [r2(hit.at[0]), 0, r2(hit.at[2])], yaw: hit.yaw, text: hit.text };
  }
  return { at: alt ? [r2(p[0]), 0, r2(p[2])] : [Math.round(p[0] / GRID) * GRID, 0, Math.round(p[2] / GRID) * GRID], yaw, text: '' };
}

const turnedHint = (what: string) => `Click the floor to put ${what} there · Wheel or R: turn · Alt: off the grid · Esc: cancel`;

/** A new figure (or stand-in) to place. */
export function placingFigure(store: Store, standIn = false): Placing {
  const p: Placing = {
    hint: turnedHint(standIn ? 'the stand-in' : 'the figure'),
    yaw: 0,
    turn: (by) => { p.yaw = (p.yaw + by + 360) % 360; },
    at: null,
    text: '',
    alt: false,
    ghost: (floor, alt) => {
      p.alt = alt;
      if (!floor) return (p.at = null);
      const s = figureSpot(store, floor, alt, p.yaw);
      p.at = s.at;
      p.text = s.text;
      if (s.text) p.yaw = s.yaw;
      const f: Figure = withFacing(newFigure({ id: 'ghost', position: s.at, body: { ...(store.figure?.body ?? newFigure().body) } }), p.yaw);
      return newScene('Ghost', [standIn ? withPosture(f, 'stand') : f]);
    },
    drop: () => {
      if (!p.at) return;
      if (standIn) addStandIn(store, p.at, p.yaw);
      else addFigure(store, p.at, p.yaw);
    },
  };
  return p;
}

/** A new prop to place (a hand prop: into the hand of the figure under the pointer, or onto the floor). */
export function placingProp(store: Store, kind: PropKind): Placing {
  const hand = HANDHELD.includes(kind);
  const p: Placing = {
    hint: hand ? `Click a figure to put the ${PROP_LABELS[kind].toLowerCase()} in its hand · Esc: cancel` : turnedHint(`the ${PROP_LABELS[kind].toLowerCase()}`),
    yaw: 0,
    turn: (by) => { p.yaw = (p.yaw + by + 360) % 360; },
    at: null,
    text: '',
    alt: false,
    ghost: (floor, alt, hit) => {
      p.alt = alt;
      const into = hand && hit.figure ? store.scene.figures.find((f) => f.id === hit.figure && !f.proxy) : undefined;
      if (into) {
        // In its right hand (the figure as it is at the playhead, drawn with it).
        p.at = null;
        p.text = `into ${into.name}'s hand`;
        const now = (store.scene.animation ? sceneAt(store.scene, store.getState().time) : store.scene).figures.find((f) => f.id === into.id)!;
        return { ...newScene('Ghost', [now]), props: [{ ...newProp(kind), id: 'ghost', hold: { figure: into.id, hand: 'R' } }] };
      }
      if (!floor) return (p.at = null);
      p.at = alt ? [r2(floor[0]), 0, r2(floor[2])] : [Math.round(floor[0] / GRID) * GRID, 0, Math.round(floor[2] / GRID) * GRID];
      p.text = '';
      return { ...newScene('Ghost', []), figures: [], props: [{ ...newProp(kind, p.at), id: 'ghost', rotation: [0, p.yaw, 0] }] };
    },
    drop: (hit) => {
      const into = hand && hit.figure ? store.scene.figures.find((f) => f.id === hit.figure && !f.proxy) : undefined;
      if (into) {
        store.select({ kind: 'figure', figure: into.id });
        addProp(store, kind);
      } else if (p.at) {
        addProp(store, kind, p.at, p.yaw);
      }
    },
  };
  return p;
}

/** A template to put into the scene: its first role on the figure under the pointer, or new figures where it is dropped. */
export function placingTemplate(store: Store, id: string): Placing {
  const t = templatesOf(store.getState().library).find((x) => x.id === id)!;
  let built: Scene | null = null;
  const p: Placing = {
    hint: `Click a figure to give it ${t.name}'s first role, or the floor to bring its people in there · Wheel or R: turn · Esc: cancel`,
    yaw: 0,
    turn: (by) => { p.yaw = (p.yaw + by + 360) % 360; },
    at: null,
    text: '',
    alt: false,
    ghost: (floor, alt, hit) => {
      p.alt = alt;
      const lead = hit.figure ? store.scene.figures.find((f) => f.id === hit.figure) : undefined;
      if (lead) {
        p.at = null;
        p.text = `${lead.name} takes the first role`;
        return null;
      }
      if (!floor) return (p.at = null);
      p.at = alt ? [r2(floor[0]), 0, r2(floor[2])] : [Math.round(floor[0] / GRID) * GRID, 0, Math.round(floor[2] / GRID) * GRID];
      p.text = '';
      built ??= t.build();
      const still = built.animation ? sceneAt(built, 0) : built;
      const first = still.figures[0];
      return first ? placeScene(placeScene(still, 0, -first.position[0], -first.position[2]), p.yaw, p.at[0], p.at[2]) : null;
    },
    drop: (hit) => {
      const lead = hit.figure && store.scene.figures.some((f) => f.id === hit.figure) ? hit.figure : null;
      if (lead) placeTemplate(store, t.id, lead);
      else if (p.at) placeTemplate(store, t.id, null, p.at, p.yaw);
    },
  };
  return p;
}
