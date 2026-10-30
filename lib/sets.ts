import * as THREE from 'three';
import { CUTAWAY_LAYER, InkedParts, LINES_LAYER, type Ink } from './ink';
import { clampLight, newLight } from './lighting';
import { uid } from './uid';
import type { Light, LightKind, Style, Vec3 } from './types';

/*
 * Sets: grey boxes of places a scene is played in (a living room, a city street, a Chinese
 * courtyard, a Greek temple…), built in, one at a time behind a scene's people and props. Drawn in
 * the scene's style as props are, but nothing to pick or move: the floor of the set is the stage's
 * floor (its top at 0), what is in front of the camera (+z) left open, the acting area round the
 * stage origin. A set is the scene's by its id (Scene.set).
 */

export const SET_GROUPS = ['Indoor', 'Outdoor'] as const;

/** A piece: its shape and size, its middle, and its turn (degrees about x, y, z; y last). */
type Shape =
  | ['box', number, number, number]
  /** Radius at the top and bottom, height, sides. */
  | ['cyl', number, number, number, number?]
  | ['sphere', number]
  /** Radius of the ring, of its tube, how much of a circle (degrees). */
  | ['ring', number, number, number?];
interface Piece { shape: Shape; at: Vec3; rot?: Vec3 }

export interface SetDef {
  id: string;
  name: string;
  group: (typeof SET_GROUPS)[number];
  /** Where and when, in a word or two. */
  place: string;
  description: string;
  build(): Piece[];
  /** Its own lights (its lamps, its windows: practicals), which come with it into a scene. */
  lights?: (Partial<Omit<Light, 'id' | 'kind'>> & { kind: LightKind; name: string })[];
}

/** A lamp of the set: warm, reaching a few metres. */
const bulb = (name: string, position: Vec3, o: Partial<Light> = {}) => ({ kind: 'lamp' as const, name, position, kelvin: 2700, intensity: 0.7, range: 6, ...o });
/** A window of the set: daylight from it, towards the people. */
const pane = (name: string, position: Vec3, o: Partial<Light> = {}) => ({ kind: 'window' as const, name, position, kelvin: 7000, intensity: 1, range: 10, ...o });

/* ---------- building blocks ---------- */

/** A box `w` wide (x), `h` high, `d` deep (z), its bottom at y. */
const B = (w: number, h: number, d: number, x: number, y: number, z: number, rot?: Vec3): Piece => ({ shape: ['box', w, h, d], at: [x, y + h / 2, z], rot });
/** A column, its bottom at y. */
const C = (r: number, h: number, x: number, y: number, z: number, top = r, sides = 20): Piece => ({ shape: ['cyl', top, r, h, sides], at: [x, y + h / 2, z] });
const S = (r: number, x: number, y: number, z: number): Piece => ({ shape: ['sphere', r], at: [x, y, z] });

/** Pieces moved by (x, y, z) and turned `yaw` degrees about their origin. */
function place(pieces: Piece[], x: number, y: number, z: number, yaw = 0): Piece[] {
  const r = (yaw * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return pieces.map((p) => ({
    ...p,
    at: [p.at[0] * c + p.at[2] * s + x, p.at[1] + y, -p.at[0] * s + p.at[2] * c + z],
    rot: [p.rot?.[0] ?? 0, (p.rot?.[1] ?? 0) + yaw, p.rot?.[2] ?? 0],
  }));
}

/** The floor: its top at the stage's floor. */
const floor = (w: number, d: number, z = 0, x = 0): Piece => B(w, 0.1, d, x, -0.102, z);

/** A gable roof over a `w` × `d` plan (ridge along z), its eaves at y, rising `pitch` degrees, overhanging. */
function roof(w: number, d: number, y: number, pitch: number, over = 0.4, thick = 0.18): Piece[] {
  const half = w / 2 + over;
  const slope = half / Math.cos((pitch * Math.PI) / 180);
  const rise = half * Math.tan((pitch * Math.PI) / 180);
  const sides = [-1, 1].map((side): Piece => ({ shape: ['box', slope, thick, d + 2 * over], at: [side * half / 2, y + rise / 2, 0], rot: [0, 0, -side * pitch] }));
  return [...sides, B(0.3, 0.3, d + 2 * over + 0.2, 0, y + rise - 0.05, 0)];
}

/** Steps up to `h`, `n` of them, `w` wide, climbing towards -z from z. */
function steps(w: number, h: number, n: number, run: number, x: number, z: number): Piece[] {
  return Array.from({ length: n }, (_, i) => B(w, (h * (i + 1)) / n, run, x, 0, z - run * i - run / 2));
}

/** A wall along x from x0 to x1 at z, `h` high, with openings (from, to, sill, top) cut out. */
function wall(x0: number, x1: number, z: number, h: number, t = 0.2, openings: [number, number, number, number][] = []): Piece[] {
  const out: Piece[] = [];
  let at = x0;
  for (const [a, b, sill, top] of [...openings].sort((p, q) => p[0] - q[0])) {
    if (a > at) out.push(B(a - at, h, t, (at + a) / 2, 0, z));
    if (sill > 0) out.push(B(b - a, sill, t, (a + b) / 2, 0, z));
    if (top < h) out.push(B(b - a, h - top, t, (a + b) / 2, top, z));
    at = b;
  }
  if (x1 > at) out.push(B(x1 - at, h, t, (at + x1) / 2, 0, z));
  return out;
}
/** The same along z (at x), from z0 to z1. */
const sideWall = (z0: number, z1: number, x: number, h: number, t = 0.2, openings: [number, number, number, number][] = []) =>
  place(wall(z0, z1, 0, h, t, openings), x, 0, 0, 90);

/** A chair facing +z (yaw turns it). */
const chair = (x: number, z: number, yaw = 0): Piece[] => place([
  B(0.45, 0.06, 0.45, 0, 0.42, 0), B(0.45, 0.5, 0.06, 0, 0.48, -0.2),
  ...[[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].map(([a, b]) => B(0.04, 0.42, 0.04, a, 0, b)),
], x, 0, z, yaw);
/** A table, its top at `h`. */
const table = (w: number, d: number, h: number, x: number, z: number): Piece[] => [
  B(w, 0.05, d, x, h - 0.05, z),
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => B(0.06, h - 0.05, 0.06, x + a * (w / 2 - 0.08), 0, z + b * (d / 2 - 0.08))),
];
const roundTable = (r: number, h: number, x: number, z: number): Piece[] => [C(r, 0.04, x, h - 0.04, z), C(0.04, h - 0.04, x, 0, z), C(0.25, 0.03, x, 0, z)];
const tree = (x: number, z: number, h = 4, crown = 1.5): Piece[] => [C(0.16, h * 0.7, x, 0, z, 0.12), S(crown, x, h * 0.72 + crown * 0.5, z), S(crown * 0.7, x + crown * 0.5, h * 0.62, z + 0.3)];
const bench = (x: number, z: number, yaw = 0): Piece[] => place([B(1.6, 0.06, 0.45, 0, 0.42, 0), B(1.6, 0.4, 0.06, 0, 0.5, -0.2), B(0.08, 0.42, 0.4, -0.7, 0, 0), B(0.08, 0.42, 0.4, 0.7, 0, 0)], x, 0, z, yaw);
const lamp = (x: number, z: number, h = 4.5): Piece[] => [C(0.07, h, x, 0, z, 0.05), B(0.5, 0.12, 0.25, x, h, z), C(0.2, 0.15, x, 0, z)];
const lantern = (x: number, y: number, z: number): Piece[] => [C(0.012, 0.4, x, y + 0.42, z), C(0.2, 0.42, x, y, z, 0.16, 12)];
/** A Chinese hall: a plinth, columns, walls behind them and a hipped roof with upturned eaves. */
function hall(w: number, d: number, h: number, plinth = 0.6, cols = 6): Piece[] {
  const out: Piece[] = [B(w + 1.2, plinth, d + 1.2, 0, 0, 0), ...steps(3, plinth, 3, 0.35, 0, d / 2 + 0.6 + 1.05)];
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + (w * i) / (cols - 1);
    out.push(C(0.17, h, x, plinth, d / 2, 0.16));
  }
  out.push(...wall(-w / 2, w / 2, -d / 2, h, 0.25).map((p) => ({ ...p, at: [p.at[0], p.at[1] + plinth, p.at[2]] as Vec3 })));
  out.push(B(w - 0.6, h * 0.7, 0.12, 0, plinth, d / 2 - 0.6));
  out.push(B(w + 0.4, 0.35, d + 0.4, 0, plinth + h, 0));
  out.push(...place(roof(d, w, plinth + h + 0.35, 28, 0.9, 0.22), 0, 0, 0, 90));
  return out;
}

/* ---------- the sets ---------- */

export const SETS: SetDef[] = [
  {
    id: 'living-room',
    name: 'Living room',
    group: 'Indoor',
    place: 'Home, today',
    description: 'A modern living room: a sofa and armchair round a coffee table, a TV unit, a bookshelf, a floor lamp, a window and a door.',
    lights: [bulb('Floor lamp', [2, 1.75, -3.9]), pane('Window', [0, 1.55, -4.3])],
    build: () => [
      floor(9, 7, -1),
      ...wall(-4.5, 4.5, -4.5, 2.8, 0.2, [[-1.4, 1.4, 0.8, 2.3]]),
      ...sideWall(-4.5, 2.5, -4.5, 2.8, 0.2, [[-2.5, -1.5, 0, 2.1]]),
      ...sideWall(-4.5, 1, 4.5, 2.8),
      B(3, 0.01, 2.2, 0, 0, -2.3),
      // The sofa, its back to the window.
      B(2.3, 0.42, 0.9, 0, 0, -3.6), B(2.3, 0.45, 0.22, 0, 0.42, -3.95), B(0.22, 0.62, 0.9, -1.25, 0, -3.6), B(0.22, 0.62, 0.9, 1.25, 0, -3.6),
      ...place([B(0.9, 0.42, 0.85, 0, 0, 0), B(0.9, 0.45, 0.2, 0, 0.42, -0.35), B(0.18, 0.62, 0.85, -0.45, 0, 0), B(0.18, 0.62, 0.85, 0.45, 0, 0)], -2.3, 0, -2.2, 60),
      B(1.2, 0.42, 0.65, 0, 0, -2.3),
      B(0.45, 0.5, 2, 4.15, 0, -2.2), B(0.08, 0.75, 1.3, 4.3, 0.75, -2.2),
      B(0.4, 2.1, 1.4, -4.15, 0, -3.4),
      C(0.02, 1.6, 2, 0, -3.9), C(0.22, 0.3, 2, 1.6, -3.9, 0.12, 16), C(0.18, 0.03, 2, 0, -3.9),
    ],
  },
  {
    id: 'office',
    name: 'Office',
    group: 'Indoor',
    place: 'Open-plan office, today',
    description: 'An open-plan office: rows of desks with monitors and chairs between low partitions, a glass wall of windows, a meeting table and a water cooler.',
    lights: [pane('Windows', [-1, 1.7, -6.3], { kelvin: 6500, intensity: 1.1 })],
    build: () => {
      const desk = (x: number, z: number): Piece[] => [...table(1.4, 0.7, 0.74, x, z), B(0.55, 0.34, 0.03, x, 0.86, z - 0.2), B(0.06, 0.12, 0.06, x, 0.74, z - 0.2), ...chair(x, z + 0.6, 180)];
      return [
        floor(14, 10, -1.5),
        ...wall(-7, 7, -6.5, 3, 0.2, [[-6, -3, 0.9, 2.6], [-2.5, 0.5, 0.9, 2.6], [1, 4, 0.9, 2.6], [4.5, 6.5, 0.9, 2.6]]),
        ...sideWall(-6.5, 3.5, -7, 3),
        ...sideWall(-6.5, 3.5, 7, 3, 0.2, [[0, 1, 0, 2.2]]),
        ...[-4, -1.6, 0.8].flatMap((x) => [...desk(x, -4.6), ...desk(x, -2.8), B(0.05, 1.2, 0.05, x - 0.72, 0, -3.7)]),
        ...[-4, -1.6, 0.8].map((x) => B(2.3, 1.15, 0.05, x + 0.45, 0, -3.7)),
        ...table(2.4, 1.1, 0.75, 4.3, -3.5), ...chair(3.6, -2.7, 180), ...chair(5, -2.7, 180), ...chair(3.6, -4.3), ...chair(5, -4.3),
        C(0.16, 1.1, 6.4, 0, -6), C(0.14, 0.4, 6.4, 1.1, -6),
      ];
    },
  },
  {
    id: 'cafe',
    name: 'Café',
    group: 'Indoor',
    place: 'Coffee shop, today',
    description: 'A small café: a counter with stools and shelves behind it, round tables with chairs, pendant lamps and a big shop window.',
    lights: [bulb('Pendant lamp', [-3.6, 1.9, -2.6], { intensity: 0.5, range: 4 }), bulb('Pendant lamp 2', [1.6, 1.9, -1.6], { intensity: 0.5, range: 4 }), pane('Shop window', [-5.8, 1.6, -1.5], { kelvin: 6500 })],
    build: () => [
      floor(12, 9, -1.5),
      ...wall(-6, 6, -6, 3.2),
      ...sideWall(-6, 3, -6, 3.2, 0.2, [[-4.5, 1.5, 0.5, 2.6]]),
      ...sideWall(-6, 3, 6, 3.2, 0.2, [[0.5, 1.6, 0, 2.2]]),
      B(4.5, 1.05, 0.7, 1.5, 0, -4.4), B(4.7, 0.05, 0.85, 1.5, 1.05, -4.4),
      B(4.5, 0.04, 0.35, 1.5, 1.6, -5.8), B(4.5, 0.04, 0.35, 1.5, 2.1, -5.8), B(0.9, 0.5, 0.5, 2.8, 1.05, -4.5),
      ...[0, 1, 2, 3].flatMap((i) => [C(0.17, 0.04, -0.3 + i * 1.1, 0.72, -3.7), C(0.03, 0.72, -0.3 + i * 1.1, 0, -3.7)]),
      ...[[-3.6, -2.6], [-3.6, -0.4], [-1, -1.4], [1.6, -1.6]].flatMap(([x, z]) => [...roundTable(0.4, 0.74, x, z), ...chair(x - 0.6, z, 90), ...chair(x + 0.6, z, -90)]),
      ...[[-3.6, -2.6], [-3.6, -0.4], [-1, -1.4], [1.6, -1.6]].flatMap(([x, z]) => [C(0.008, 1.1, x, 2.1, z), C(0.22, 0.22, x, 1.88, z, 0.05, 16)]),
    ],
  },
  {
    id: 'street',
    name: 'City street',
    group: 'Outdoor',
    place: 'Downtown, today',
    description: 'A city street: a pavement in front of shops and tall blocks, street lamps, a bench and a bin, a road with a zebra crossing and parked cars.',
    lights: [bulb('Street lamp', [-4.5, 4.4, 1.6], { color: '#ffd09e', kelvin: undefined, spot: 80, aim: { point: [-4.5, 0, 0.6] }, intensity: 0.9, range: 12 })],
    build: () => {
      const car = (x: number, z: number): Piece[] => [B(4.2, 0.75, 1.8, x, 0.3, z), B(2.3, 0.6, 1.6, x - 0.2, 1.05, z), ...[-1.4, 1.4].flatMap((a) => [-0.85, 0.85].map((b) => ({ shape: ['cyl', 0.32, 0.32, 0.22, 16] as Shape, at: [x + a, 0.32, z + b] as Vec3, rot: [90, 0, 0] as Vec3 })))];
      const block = (x: number, w: number, h: number): Piece[] => [B(w, h, 8, x, 0, -7), B(w - 0.6, 2.6, 0.1, x, 0.4, -2.96), B(w + 0.2, 0.3, 0.6, x, 3.4, -2.7)];
      return [
        floor(40, 30, -2),
        // (The pavement flush with the road: people stand on the stage's floor.)
        B(40, 0.02, 5, 0, 0, -0.5),
        ...block(-14, 7, 14), ...block(-6.5, 8, 9), ...block(1.5, 8, 18), ...block(9.5, 8, 7), ...block(17, 7, 12),
        ...[-10, -4.5, 6, 12].flatMap((x) => lamp(x, 1.6)),
        ...bench(-3, -1.8), B(0.5, 0.9, 0.5, 2.5, 0, -1.8),
        ...Array.from({ length: 7 }, (_, i) => B(0.5, 0.01, 4, -1.5 + i * 0.9 - 2.7 + 2.7, 0, 5.5)),
        ...car(-9, 3.4), ...car(7, 3.4),
        C(0.08, 3.2, 4.6, 0, 2.4), B(0.3, 0.9, 0.3, 4.6, 3.2, 2.4),
      ];
    },
  },
  {
    id: 'park',
    name: 'Park',
    group: 'Outdoor',
    place: 'City park, today',
    description: 'A park: a path through grass, trees and bushes, benches, a round fountain and lamp posts.',
    lights: [bulb('Lamp post', [-8, 4.4, 0], { color: '#ffd09e', kelvin: undefined, intensity: 0.6, range: 10 })],
    build: () => [
      floor(40, 34, -4),
      B(40, 0.02, 3, 0, 0, 1.2),
      ...tree(-6, -4), ...tree(-10, -9, 5, 2), ...tree(5, -7, 4.5, 1.8), ...tree(10, -3), ...tree(-3, -12, 5.5, 2.2), ...tree(13, -11, 5, 2),
      S(0.7, -4, 0.3, -1.2), S(0.6, -3.2, 0.25, -1.4), S(0.7, 7.5, 0.3, -1.4),
      ...bench(-1.8, -0.6), ...bench(4.2, -0.6),
      C(2.4, 0.5, 2, 0, -5.5), C(2.1, 0.12, 2, 0.4, -5.5), C(0.25, 1.4, 2, 0, -5.5), C(0.8, 0.12, 2, 1.4, -5.5), C(0.12, 0.6, 2, 1.5, -5.5),
      ...lamp(-8, 0), ...lamp(9, 0),
    ],
  },
  {
    id: 'courtyard',
    name: 'Chinese courtyard',
    group: 'Outdoor',
    place: 'Siheyuan, old Beijing',
    description: 'A siheyuan courtyard: a main hall on a raised plinth with columns and a tiled roof, side halls, grey walls with a round moon gate, a stone table with drum stools, a tree and lanterns.',
    lights: [bulb('Lantern', [-3, 3.4, -7.2], { kelvin: 1900, intensity: 0.5, range: 5 }), bulb('Lantern 2', [3, 3.4, -7.2], { kelvin: 1900, intensity: 0.5, range: 5 })],
    build: () => [
      floor(24, 24, -3),
      ...place(hall(9, 5, 3.2), 0, 0, -10),
      ...place(hall(6, 4, 2.8, 0.45, 4), -8, 0, -3, 90),
      ...place(hall(6, 4, 2.8, 0.45, 4), 8, 0, -3, -90),
      ...wall(-11, -3, 6, 2.6, 0.4), ...wall(3, 11, 6, 2.6, 0.4),
      ...wall(-3, 3, 6, 2.6, 0.4, [[-1.2, 1.2, 0, 2.4]]), { shape: ['ring', 1.2, 0.14, 180], at: [0, 1.2, 6] },
      ...place(roof(0.6, 22, 2.6, 25, 0.15, 0.12), 0, 0, 6, 90),
      C(0.5, 0.75, -3.5, 0, -2.5), ...[0, 1, 2, 3].map((i) => { const a = (i * Math.PI) / 2 + 0.6; return C(0.2, 0.42, -3.5 + Math.cos(a) * 0.9, 0, -2.5 + Math.sin(a) * 0.9, 0.17); }),
      ...tree(4, -5, 5, 1.8),
      ...lantern(-3, 3.2, -7.2), ...lantern(3, 3.2, -7.2),
    ],
  },
  {
    id: 'palace',
    name: 'Palace hall',
    group: 'Indoor',
    place: 'Imperial China',
    description: 'A throne hall of the Forbidden City: two rows of tall red-lacquer columns, a stepped dais with the throne and a folding screen behind it, bronze incense burners, a long open floor.',
    lights: [bulb('Candles', [-3, 2.2, -11], { kelvin: 2000, intensity: 0.6, range: 7 }), bulb('Candles 2', [3, 2.2, -11], { kelvin: 2000, intensity: 0.6, range: 7 })],
    build: () => [
      floor(22, 26, -6),
      ...wall(-11, 11, -18, 8, 0.6), ...sideWall(-18, 6, -11, 8, 0.6), ...sideWall(-18, 6, 11, 8, 0.6),
      ...[-4.5, 4.5].flatMap((x) => [-14, -10, -6, -2, 2].map((z) => C(0.38, 8, x, 0, z, 0.36))),
      B(9, 0.4, 5, 0, 0, -14.5), B(7, 0.4, 4, 0, 0.4, -14.8), B(5, 0.4, 3, 0, 0.8, -15),
      ...steps(2.4, 1.2, 6, 0.32, 0, -10.2),
      B(1.6, 0.55, 1, 0, 1.2, -15.1), B(1.6, 1.3, 0.2, 0, 1.75, -15.55), B(0.2, 0.75, 1, -0.8, 1.75, -15.1), B(0.2, 0.75, 1, 0.8, 1.75, -15.1),
      B(4.4, 3.4, 0.15, 0, 1.2, -16.4),
      ...[-3, 3].flatMap((x) => [C(0.45, 0.8, x, 0, -9, 0.35), S(0.5, x, 1.25, -9), C(0.08, 0.5, x, 1.6, -9)]),
    ],
  },
  {
    id: 'old-street',
    name: 'Old Chinese street',
    group: 'Outdoor',
    place: 'Market town, Ming–Qing China',
    description: 'An old market street: two-storey wooden shopfronts with tiled eaves on both sides, hanging lanterns and shop signs, a stone-paved road and a carved memorial archway at its end.',
    lights: [bulb('Lantern', [-3.1, 2.6, -1.6], { kelvin: 1900, intensity: 0.5, range: 5 }), bulb('Lantern 2', [3.1, 2.6, -6.6], { kelvin: 1900, intensity: 0.5, range: 5 })],
    build: () => {
      const shop = (z: number, side: number): Piece[] => place([
        B(5, 6, 4, 0, 0, 0), B(0.2, 3, 3.6, -side * 2.6, 0, 0), B(0.9, 0.12, 4.2, -side * 2.8, 3, 0, [0, 0, side * 18]),
        ...place(roof(5, 4, 6, 30, 0.6), 0, 0, 0, 0), B(0.08, 1.4, 0.5, -side * 2.75, 1.6, 1.2),
      ], side * 6, 0, z);
      const gate = [C(0.3, 6, -3, 0, -22), C(0.3, 6, 3, 0, -22), B(7, 0.6, 0.6, 0, 4.4, -22), B(7.6, 0.5, 0.7, 0, 5.6, -22), ...place(roof(1, 8.4, 6.1, 30, 0.3, 0.14), 0, 0, -22, 90)];
      return [
        floor(26, 40, -10),
        B(6, 0.02, 40, 0, 0, -10),
        ...[2, -3, -8, -13, -18].flatMap((z) => [...shop(z, -1), ...shop(z, 1)]),
        ...[2, -3, -8, -13].flatMap((z) => [...lantern(-3.1, 2.4, z + 1.4), ...lantern(3.1, 2.4, z + 1.4)]),
        ...gate,
      ];
    },
  },
  {
    id: 'temple',
    name: 'Greek temple',
    group: 'Outdoor',
    place: 'Ancient Greece',
    description: 'A Doric temple on a three-stepped base: a colonnade of fluted columns, the entablature and a triangular pediment, a paved forecourt with an altar and fallen column drums.',
    build: () => {
      const [w, d] = [13, 20];
      const cols: Piece[] = [];
      for (let i = 0; i < 6; i++) for (const z of [-7, -7 - d + 4]) cols.push(C(0.55, 6.5, -w / 2 + 1.5 + (i * (w - 3)) / 5, 1.2, z, 0.45, 16));
      for (let j = 1; j < 5; j++) for (const x of [-w / 2 + 1.5, w / 2 - 1.5]) cols.push(C(0.55, 6.5, x, 1.2, -7 - j * ((d - 4) / 5), 0.45, 16));
      return [
        floor(34, 40, -8),
        B(w + 2.4, 0.4, d + 2.4, 0, 0, -15), B(w + 1.2, 0.4, d + 1.2, 0, 0.4, -15), B(w, 0.4, d, 0, 0.8, -15),
        ...cols,
        B(w - 1.6, 1.4, d - 2.6, 0, 7.7, -15),
        { shape: ['cyl', w / 2 - 0.5, w / 2 - 0.5, 1.2, 3], at: [0, 9.6, -6.4], rot: [-90, 0, 0] },
        ...place(roof(w - 1.6, d - 2.6, 9.1, 15, 0.3, 0.25), 0, 0, -15, 0),
        // (The altar behind the acting area, before the steps: the front is left open.)
        B(2, 1, 1.2, 0, 0, -2.6),
        { shape: ['cyl', 0.5, 0.5, 1.4, 16], at: [-5, 0.5, 1], rot: [0, 30, 90] }, C(0.5, 0.8, 5.5, 0, 0, 0.5, 16),
      ];
    },
  },
  {
    id: 'castle-hall',
    name: 'Castle hall',
    group: 'Indoor',
    place: 'Medieval Europe',
    description: 'The great hall of a medieval castle: thick stone walls with arched windows, a long feasting table with benches, a throne on a dais, a big fireplace, banners and a ring chandelier.',
    lights: [bulb('Fireplace', [6.6, 0.8, -7], { kelvin: 1900, intensity: 1, range: 8 }), bulb('Chandelier', [0, 5.2, -7], { kelvin: 2000, intensity: 0.8, range: 10 }), pane('Window', [-7.4, 5, -7], { kelvin: 7500, intensity: 0.8 })],
    build: () => [
      floor(16, 24, -6),
      ...wall(-8, 8, -18, 9, 1, [[-1.2, 1.2, 4, 7.5]]), { shape: ['ring', 1.2, 0.25, 180], at: [0, 7.5, -18] },
      ...sideWall(-18, 6, -8, 9, 1, [[-14, -12, 3.5, 6.5], [-8, -6, 3.5, 6.5], [-2, 0, 3.5, 6.5]]),
      ...sideWall(-18, 6, 8, 9, 1),
      ...[-13, -7, -1].map((z) => ({ shape: ['ring', 1, 0.3, 180] as Shape, at: [-8, 6.5, z] as Vec3, rot: [0, 90, 0] as Vec3 })),
      ...table(1.4, 9, 0.78, 0, -7), B(0.4, 0.45, 9, -1.2, 0, -7), B(0.4, 0.45, 9, 1.2, 0, -7),
      B(6, 0.5, 3.5, 0, 0, -15.8), B(1.4, 0.6, 1, 0, 0.5, -16), B(1.4, 2.2, 0.25, 0, 0.5, -16.5), B(0.2, 0.9, 1, -0.7, 0.5, -16), B(0.2, 0.9, 1, 0.7, 0.5, -16),
      B(0.8, 3.2, 3.2, 7.2, 0, -7), B(0.6, 1.7, 1.8, 6.8, 0, -7), B(1.4, 0.3, 3.8, 7.1, 3.2, -7),
      ...[-5, -1.5, 1.5, 5].map((x) => B(1.2, 3, 0.05, x, 4.5, -17.4)),
      { shape: ['ring', 1.4, 0.06], at: [0, 5.5, -7], rot: [90, 0, 0] }, C(0.015, 3.5, 0, 5.5, -7),
    ],
  },
];

/** A set's own lights for a scene (new ids each time). */
export const setLights = (id: string): Light[] => (setById(id)?.lights ?? []).map((l) => clampLight({ ...newLight(l.kind, l), id: uid('light'), practical: true }));

/** A set by its id. */
export const setById = (id: string | undefined) => SETS.find((s) => s.id === id);

const geometries = new Map<string, THREE.BufferGeometry>();
function geometryOf(shape: Shape): THREE.BufferGeometry {
  const key = JSON.stringify(shape);
  let g = geometries.get(key);
  if (!g) {
    switch (shape[0]) {
      case 'box': g = new THREE.BoxGeometry(shape[1], shape[2], shape[3]); break;
      case 'cyl': g = new THREE.CylinderGeometry(shape[1], shape[2], shape[3], shape[4] ?? 20); break;
      case 'sphere': g = new THREE.SphereGeometry(shape[1], 20, 14); break;
      case 'ring': g = new THREE.TorusGeometry(shape[1], shape[2], 10, 32, ((shape[3] ?? 360) * Math.PI) / 180); break;
    }
    geometries.set(key, g);
  }
  return g;
}

/**
 * A set as drawn: its pieces in the style's prop look, outlined, under nothing that picks (a
 * click goes through to the floor), not part of what the camera frames.
 */
// Each set's solid parts as boxes (a pillar as the box round it; not its floors), once worked out.
const solids = new Map<string, { at: THREE.Vector3; half: THREE.Vector3; turn: THREE.Quaternion }[]>();

/**
 * How far from `from` towards `to` a set's first solid part is (a wall, a roof, a pillar; not its
 * floor), or null if nothing of it is in between (#16: a camera stops at a wall).
 */
export function setBlocks(id: string | undefined, from: THREE.Vector3, to: THREE.Vector3): number | null {
  if (!id) return null;
  let boxes = solids.get(id);
  if (!boxes) {
    boxes = [];
    for (const p of setById(id)?.build() ?? []) {
      const [kind] = p.shape;
      const size = kind === 'box' ? [p.shape[1], p.shape[2], p.shape[3]] as number[] : kind === 'cyl' ? [2 * Math.max(p.shape[1], p.shape[2]), p.shape[3], 2 * Math.max(p.shape[1], p.shape[2])] : null;
      if (!size) continue;
      const half = new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2);
      // (A floor: what lies on the ground, flat.)
      if (p.at[1] + half.y <= 0.05) continue;
      const turn = p.rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot.map((a) => (a * Math.PI) / 180) as Vec3), 'YXZ')) : new THREE.Quaternion();
      boxes.push({ at: new THREE.Vector3(...p.at), half, turn });
    }
    solids.set(id, boxes);
  }
  const dir = to.clone().sub(from);
  const length = dir.length();
  if (length < 1e-6) return null;
  dir.divideScalar(length);
  let nearest: number | null = null;
  for (const b of boxes) {
    // In the box's own axes: where the ray enters and leaves each pair of its faces.
    const back = b.turn.clone().invert();
    const o = from.clone().sub(b.at).applyQuaternion(back);
    const d = dir.clone().applyQuaternion(back);
    let [enter, leave] = [-Infinity, Infinity];
    for (const k of ['x', 'y', 'z'] as const) {
      if (Math.abs(d[k]) < 1e-9) {
        if (Math.abs(o[k]) > b.half[k]) { enter = Infinity; break; }
        continue;
      }
      const [a, c] = [(-b.half[k] - o[k]) / d[k], (b.half[k] - o[k]) / d[k]];
      enter = Math.max(enter, Math.min(a, c));
      leave = Math.min(leave, Math.max(a, c));
    }
    if (enter <= leave && enter > 0 && enter < length && (nearest === null || enter < nearest)) nearest = enter;
  }
  return nearest;
}

export class SetObject {
  readonly object = new THREE.Group();
  readonly parts: InkedParts;

  /** Its parts (each with its outline), to cut away those in the view's way. */
  private pieces: THREE.Mesh[] = [];

  constructor(ink: Ink, readonly id: string) {
    this.parts = new InkedParts(ink, 'prop');
    for (const p of setById(id)?.build() ?? []) {
      const mesh = this.parts.add(this.object, geometryOf(p.shape), { set: id }, p.at);
      this.pieces.push(mesh);
      if (p.rot) mesh.rotation.set(...(p.rot.map((a) => (a * Math.PI) / 180) as Vec3), 'YXZ');
      // (A floor casts no shadow, only takes them: nothing is under it, and a broad surface that
      // shades itself shows stripes of shadow that crawl as the view turns.)
      if (p.shape[0] === 'box' && p.at[1] + p.shape[2] / 2 <= 0.001) mesh.castShadow = false;
    }
    // (A set stands still: its parts placed once, not worked out again every frame.)
    this.object.traverse((o) => { o.raycast = () => {}; o.updateMatrix(); o.matrixAutoUpdate = false; });
  }

  setStyle(style: Style) {
    this.parts.refresh(style, () => false);
  }

  /**
   * Cut away what stands in the view's way: a part the eye is inside, or one between the eye and
   * what it looks at, is not drawn (its shadow still cast), so the view never shows the inside of
   * a wall and looks into a room past the wall in front. The rest drawn again.
   */
  cutaway(eye: THREE.Vector3, target: THREE.Vector3) {
    const dir = target.clone().sub(eye);
    const ray = new THREE.Raycaster(eye, dir.clone().normalize(), 0, Math.max(0, dir.length() - 0.3));
    const local = new THREE.Vector3();
    for (const mesh of this.pieces) {
      const geo = mesh.geometry;
      const box = (geo.boundingBox ??= (geo.computeBoundingBox(), geo.boundingBox!));
      const inside = box.containsPoint(mesh.worldToLocal(local.copy(eye)));
      const hits: THREE.Intersection[] = [];
      if (!inside) THREE.Mesh.prototype.raycast.call(mesh, ray, hits);
      const cut = inside || hits.length > 0;
      if (cut === (mesh.layers.mask === 1 << CUTAWAY_LAYER)) continue;
      mesh.layers.set(cut ? CUTAWAY_LAYER : 0);
      // (Its outline too: on no layer while cut away.)
      for (const child of mesh.children) child.layers.set(cut ? 31 : LINES_LAYER);
    }
  }

  private box: THREE.Box3 | null = null;
  /** What it takes up (it never moves). */
  bounds() {
    return (this.box ??= new THREE.Box3().setFromObject(this.object)).clone();
  }

  /** Every corner of it (a thumbnail of the set frames it all). */
  forEachPoint(cb: (p: THREE.Vector3) => void) {
    const box = new THREE.Box3().setFromObject(this.object);
    if (box.isEmpty()) return;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) cb(new THREE.Vector3(x, y, z));
  }

  dispose() {
    // (Its geometries are shared by every view of the set: kept.)
    this.object.clear();
  }
}
