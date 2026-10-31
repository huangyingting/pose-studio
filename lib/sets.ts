import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import SET_INDEX from '../public/sets/index.json';
import { CUTAWAY_LAYER, InkedParts, LINES_LAYER, type Ink } from './ink';
import { MAX_LIGHTS, clampLight, newLight, skyOf } from './lighting';
import { withBase } from './paths';
import type { ModelId, SetIndex, Sky, SurfaceId } from './setassets';
import { uid } from './uid';
import type { Light, LightKind, Lighting, Style, Vec3 } from './types';

/*
 * Sets: places a scene is played in (a living room, a city street, a Chinese courtyard, a Greek
 * temple…), built in, one at a time behind a scene's people and props: their architecture made of
 * shapes, furnished with models (#25: CC0 models and textures, lib/setassets.ts). Drawn in the
 * scene's style as props are, and in 3D in their own materials (textured), but nothing to pick or
 * move: the floor of the set is the stage's floor (its top at 0), what is in front of the camera
 * (+z) left open, the acting area round the stage origin. A set is the scene's by its id (Scene.set).
 */

export const SET_GROUPS = ['Indoor', 'Outdoor'] as const;

/** A piece: its shape and size, its middle, and its turn (degrees about x, y, z; y last). */
type Shape =
  | ['box', number, number, number]
  /** Radius at the top and bottom, height, sides. */
  | ['cyl', number, number, number, number?]
  | ['sphere', number]
  /** Radius of the ring, of its tube, how much of a circle (degrees). */
  | ['ring', number, number, number?]
  /** A model (its middle at the bottom where it is put), scaled. */
  | ['model', ModelId, number?];
/**
 * What a piece is made of in 3D (#25): a surface (textured, its texture at its real size), a
 * colour over it or alone, how rough and metal it is; or glass.
 */
type Look = SurfaceId | { surface?: SurfaceId; color?: string; rough?: number; metal?: number; glass?: true };
interface Piece { shape: Shape; at: Vec3; rot?: Vec3; look?: Look }

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
/** A model standing at (x, y, z), turned `yaw` degrees, scaled. */
const M = (id: ModelId, x: number, z: number, yaw = 0, y = 0, scale?: number): Piece => ({ shape: scale ? ['model', id, scale] : ['model', id], at: [x, y, z], rot: yaw ? [0, yaw, 0] : undefined });
/** Pieces made of a look. */
const made = (look: Look, pieces: Piece[]): Piece[] => pieces.map((p) => ({ ...p, look }));

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

/** Paint: white woodwork (frames, skirting); a door's wood; brushed metal; black glass (a screen). */
const WHITE: Look = { color: '#f2f0ec', rough: 0.45 };
const METAL: Look = { color: '#8d8f93', rough: 0.35, metal: 1 };
const SCREEN: Look = { color: '#0d0f12', rough: 0.15 };
/** A window in a wall along x at z (an opening from a to b, sill to top): its frame (a bar across the middle) and its glass. */
function windowIn(a: number, b: number, sill: number, top: number, z: number, t = 0.2): Piece[] {
  const f = 0.06;
  return [
    ...made(WHITE, [B(b - a, f, t + 0.04, (a + b) / 2, sill, z), B(b - a, f, t + 0.04, (a + b) / 2, top - f, z), B(f, top - sill, t + 0.04, a + f / 2, sill, z), B(f, top - sill, t + 0.04, b - f / 2, sill, z), B(0.04, top - sill, 0.08, (a + b) / 2, sill, z)]),
    { ...B(b - a - 2 * f, top - sill - 2 * f, 0.012, (a + b) / 2, sill + f, z), look: { glass: true } },
  ];
}
/** A door in a wall along x at z (an opening from a to b, `h` high): its frame and its leaf. */
function doorIn(a: number, b: number, h: number, z: number, t = 0.2, wood: Look = { color: '#e9e4dc', rough: 0.5 }): Piece[] {
  const f = 0.07;
  return [
    ...made(WHITE, [B(f, h, t + 0.05, a + f / 2, 0, z), B(f, h, t + 0.05, b - f / 2, 0, z), B(b - a, f, t + 0.05, (a + b) / 2, h - f, z)]),
    { ...B(b - a - 2 * f, h - f, 0.045, (a + b) / 2, 0, z), look: wood },
    { ...B(0.12, 0.025, 0.06, b - f - 0.12, 1.02, z + 0.04), look: METAL },
  ];
}
/** Skirting along a wall's inner face (x from x0 to x1 at z). */
const skirting = (x0: number, x1: number, z: number): Piece => ({ ...B(x1 - x0, 0.1, 0.02, (x0 + x1) / 2, 0, z), look: WHITE });

/** A monitor on a desk top at y, its screen facing +z. */
const monitor = (x: number, z: number, y: number): Piece[] => [
  { ...B(0.62, 0.37, 0.025, x, y + 0.14, z), look: SCREEN },
  ...made({ color: '#2a2c30', rough: 0.4 }, [B(0.04, 0.16, 0.04, x, y, z - 0.03), B(0.22, 0.015, 0.16, x, y, z - 0.03)]),
];
/** An office chair facing +z: a padded seat and back on a gas column and five castors. */
const officeChair = (x: number, z: number, yaw = 0): Piece[] => place([
  ...made({ color: '#2d3136', rough: 0.9 }, [B(0.5, 0.08, 0.48, 0, 0.44, 0), B(0.46, 0.55, 0.07, 0, 0.58, -0.24, [-8, 0, 0])]),
  ...made({ color: '#1d1f22', rough: 0.4 }, [C(0.025, 0.36, 0, 0.08, 0, 0.025, 12), B(0.05, 0.25, 0.03, 0, 0.36, -0.22)]),
  ...made({ color: '#1d1f22', rough: 0.4 }, [0, 72, 144, 216, 288].flatMap((a) => place([B(0.03, 0.03, 0.3, 0, 0.06, 0.15), C(0.03, 0.05, 0, 0.01, 0.3, 0.03, 10)], 0, 0, 0, a))),
], x, 0, z, yaw);
/** A water cooler: its cabinet and the blue bottle upside down on it. */
const waterCooler = (x: number, z: number): Piece[] => [
  { ...B(0.32, 0.95, 0.32, x, 0, z), look: { color: '#e8e8e6', rough: 0.5 } },
  { ...C(0.14, 0.45, x, 0.95, z, 0.14, 20), look: { color: '#7fb3d6', rough: 0.1, glass: true } },
];

/**
 * A city block `w` wide and `h` high, its front on the pavement (z = -3): its walls of `look`, a
 * window in each bay of each floor (framed, dark glass), and shops below: a glazed front, a
 * shutter half down, an awning.
 */
function cityBlock(x: number, w: number, h: number, look: Look): Piece[] {
  const front = -3;
  const out: Piece[] = [{ ...B(w, h, 8, x, 0, front - 4), look }];
  const bays = Math.max(2, Math.round(w / 2.4));
  const bay = w / bays;
  for (let f = 1; f < Math.floor(h / 3); f++) {
    for (let i = 0; i < bays; i++) {
      const cx = x - w / 2 + bay * (i + 0.5);
      out.push(...made(WHITE, [B(1.3, 1.65, 0.08, cx, f * 3 + 0.65, front + 0.02)]));
      out.push({ ...B(1.16, 1.5, 0.1, cx, f * 3 + 0.72, front + 0.03), look: { color: '#26303a', rough: 0.08, metal: 0.4 } });
      out.push(...made({ color: '#b9b5ae', rough: 0.7 }, [B(1.45, 0.08, 0.2, cx, f * 3 + 0.6, front + 0.08)]));
    }
  }
  // (The shops: a glazed front, its frame dark, a shutter half down over one half; an awning.)
  out.push({ ...B(w - 0.6, 2.6, 0.1, x, 0.3, front + 0.04), look: { color: '#1e2328', rough: 0.1, metal: 0.5 } });
  out.push(...made({ color: '#2a2d31', rough: 0.4, metal: 0.8 }, [B(w - 0.4, 0.12, 0.14, x, 2.9, front + 0.06), B(0.12, 2.9, 0.14, x - w / 2 + 0.25, 0, front + 0.06), B(0.12, 2.9, 0.14, x + w / 2 - 0.25, 0, front + 0.06)]));
  out.push({ ...B(w + 0.2, 0.06, 1.2, x, 3.2, front + 0.6, [-12, 0, 0]), look: { color: ['#7a2a24', '#2f4f6b', '#3d5a3a'][Math.abs(Math.round(x)) % 3], rough: 0.85 } });
  out.push(M('shutter', x + w / 4, front + 0.2, 0, 0.6, Math.min(1, (w / 2 - 0.4) / 3.08)));
  return out;
}

/** Red lacquer (Chinese columns), stone, painted beams. */
const LACQUER: Look = { color: '#8a1d16', rough: 0.35 };
const STONE: Look = { surface: 'stone-blocks', color: '#c9c5bd' };
const TEAL: Look = { color: '#2f5c58', rough: 0.6 };
/** A red silk lantern hanging with its bottom at y: its cord, gold caps and tassel. */
const lantern = (x: number, y: number, z: number): Piece[] => [
  { ...C(0.21, 0.42, x, y, z, 0.17, 16), look: { color: '#c0261c', rough: 0.75 } },
  ...made({ color: '#b8902f', rough: 0.4, metal: 1 }, [C(0.12, 0.04, x, y + 0.42, z, 0.12, 12), C(0.12, 0.04, x, y - 0.03, z, 0.12, 12)]),
  ...made({ color: '#3a2a1c', rough: 0.8 }, [C(0.008, 0.5, x, y + 0.46, z, 0.008, 6)]),
  { ...C(0.03, 0.22, x, y - 0.25, z, 0.01, 8), look: { color: '#c0261c', rough: 0.9 } },
];
/** A Chinese hall: a stone plinth with steps, red columns, walls behind them, a lattice front, a painted beam and a tiled roof. */
function hall(w: number, d: number, h: number, plinth = 0.6, cols = 6): Piece[] {
  const out: Piece[] = made(STONE, [B(w + 1.2, plinth, d + 1.2, 0, 0, 0), ...steps(3, plinth, 3, 0.35, 0, d / 2 + 0.6 + 1.05)]);
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + (w * i) / (cols - 1);
    out.push({ ...C(0.17, h, x, plinth, d / 2, 0.16), look: LACQUER }, { ...C(0.26, 0.12, x, plinth, d / 2, 0.24, 16), look: STONE });
  }
  out.push(...made({ surface: 'red-plaster' }, wall(-w / 2, w / 2, -d / 2, h, 0.25).map((p) => ({ ...p, at: [p.at[0], p.at[1] + plinth, p.at[2]] as Vec3 }))));
  // (Its front: lattice doors of dark red wood across it, set back under the eaves.)
  out.push({ ...B(w - 0.6, h * 0.75, 0.12, 0, plinth, d / 2 - 0.6), look: { surface: 'planks', color: '#7a2a1e' } });
  out.push({ ...B(w + 0.4, 0.35, d + 0.4, 0, plinth + h, 0), look: TEAL });
  out.push(...made({ surface: 'grey-roof', color: '#9a9a96' }, place(roof(d, w, plinth + h + 0.35, 28, 0.9, 0.22), 0, 0, 0, 90)));
  return out;
}
/** A round fountain: its stone basin and water, a column and a bowl, the water falling from it. */
function fountain(x: number, z: number): Piece[] {
  const water: Look = { color: '#5d8ea8', rough: 0.05, glass: true };
  return [
    ...made({ surface: 'sandstone', color: '#d8d2c4' }, [C(2.4, 0.5, x, 0, z, 2.4, 40), C(0.25, 1.4, x, 0, z, 0.2, 20), C(0.8, 0.12, x, 1.4, z, 0.6, 32)]),
    { ...C(2.2, 0.03, x, 0.42, z, 2.2, 40), look: water },
    { ...C(0.75, 0.02, x, 1.5, z, 0.75, 32), look: water },
    { ...C(0.6, 0.6, x, 0.85, z, 0.05, 24), look: water },
  ];
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
      { ...floor(9, 7, -1), look: 'oak-floor' },
      ...made({ surface: 'plaster', color: '#f6f1ea' }, [
        ...wall(-4.5, 4.5, -4.5, 2.8, 0.2, [[-1.4, 1.4, 0.8, 2.3]]),
        ...sideWall(-4.5, 2.5, -4.5, 2.8, 0.2, [[-2.5, -1.5, 0, 2.1]]),
        ...sideWall(-4.5, 1, 4.5, 2.8),
      ]),
      ...windowIn(-1.4, 1.4, 0.8, 2.3, -4.5),
      ...place(doorIn(-2.5, -1.5, 2.1, 0), -4.5, 0, 0, 90),
      skirting(-4.4, -1.4, -4.39), skirting(1.4, 4.4, -4.39),
      ...place([skirting(-4.4, -2.5, 0), skirting(-1.5, 2.5, 0)], -4.39, 0, 0, 90),
      ...place([skirting(-4.4, 1, 0)], 4.39, 0, 0, -90),
      { ...B(3.2, 0.012, 2.3, 0, 0, -2.4), look: 'rug' },
      // The sofa, its back to the window; an armchair turned to the table; the TV on the right wall.
      M('sofa', 0, -3.75), M('armchair', -2.4, -2.1, 60), M('ottoman', -1.6, -0.9, 20),
      M('coffee-table', 0, -2.35, 90),
      M('tv-unit', 4.12, -2.2, -90), { ...B(0.05, 0.72, 1.28, 4.35, 1.05, -2.2), look: SCREEN },
      M('bookshelf', -4.1, -3.5, 90),
      M('side-table', 1.85, -3.8), M('potted-plant', 3.7, -3.95),
      M('picture', -2.8, -4.39, 0, 1.25), M('wall-clock', 4.39, -3.9, -90, 1.8),
      // A floor lamp by the sofa.
      ...made(METAL, [C(0.015, 1.55, 2, 0, -3.9), C(0.16, 0.025, 2, 0, -3.9)]), { ...C(0.21, 0.3, 2, 1.55, -3.9, 0.13, 24), look: { color: '#efe6d2', rough: 0.9 } },
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
      // A desk (its chair side +z), its monitor and an office chair at it; turned `yaw`.
      const desk = (x: number, z: number, yaw: number, extra: Piece[] = []): Piece[] => place([
        // (Its drawers on the side it is sat at.)
        M('office-desk', 0, 0, 180), ...monitor(0, -0.25, 0.787), ...officeChair(0.1, 0.75, 180), ...extra,
      ], x, 0, z, yaw);
      return [
        { ...floor(14, 10, -1.5), look: { surface: 'concrete', color: '#d8d8d6' } },
        ...made({ surface: 'plaster', color: '#ffffff' }, [
          ...wall(-7, 7, -6.5, 3, 0.2, [[-6, -3, 0.9, 2.6], [-2.5, 0.5, 0.9, 2.6], [1, 4, 0.9, 2.6], [4.5, 6.5, 0.9, 2.6]]),
          ...sideWall(-6.5, 3.5, -7, 3),
          ...sideWall(-6.5, 3.5, 7, 3, 0.2, [[0, 1, 0, 2.2]]),
        ]),
        ...[[-6, -3], [-2.5, 0.5], [1, 4], [4.5, 6.5]].flatMap(([a, b]) => windowIn(a, b, 0.9, 2.6, -6.5)),
        ...place(doorIn(0, 1, 2.2, 0), 7, 0, 0, -90),
        skirting(-6.9, 6.9, -6.39), ...place([skirting(-6.4, 3.5, 0)], -6.89, 0, 0, 90), ...place([skirting(-6.4, 0, 0), skirting(1, 3.5, 0)], 6.89, 0, 0, -90),
        // Three pairs of desks back to back, a low partition between each pair.
        ...[-4.6, -2.2, 0.2].flatMap((x, i) => [
          ...desk(x, -4.75, 0, i === 1 ? [M('laptop', 0.55, -0.1, 0, 0.787, 0.6)] : [M('stationery', -0.7, -0.25, 0, 0.787)]),
          ...desk(x, -2.65, 180, i === 0 ? [M('small-plant', 0.8, -0.3, 0, 0.787)] : [M('notepads', 0.55, -0.05, 0, 0.787, 0.5)]),
          { ...B(2.1, 1.25, 0.05, x, 0, -3.7), look: { color: '#5f6b75', rough: 0.95 } },
          { ...B(2.12, 0.03, 0.07, x, 1.25, -3.7), look: METAL },
        ]),
        // The meeting corner.
        M('meeting-table', 4.4, -3.6, 90),
        M('dining-chair', 3.8, -2.3, 180), M('dining-chair', 5, -2.3, 180), M('dining-chair', 3.8, -4.9), M('dining-chair', 5, -4.9),
        M('projector-screen', 4.4, -6.05), M('chalkboard', 6.3, -2.2, -60),
        // Storage, plants and the water cooler.
        M('drawer-cabinet', -6.6, -5.6, 90), M('drawer-cabinet', -6.6, -4.4, 90), M('steel-shelves', -6.65, -0.8, 90),
        M('tall-plant', -6.4, -6.1), M('tall-plant', 6.5, -6.1), M('potted-plant', -1, 1.6),
        ...waterCooler(6.5, -0.6),
        M('wall-clock', -6.89, -2.6, 90, 2.1),
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
    build: () => {
      const tables: [number, number][] = [[-3.6, -2.6], [-3.6, -0.4], [-1, -1.4], [1.6, -1.6]];
      return [
        { ...floor(12, 9, -1.5), look: 'cafe-floor' },
        ...made({ surface: 'brick', color: '#d9c9bd' }, wall(-6, 6, -6, 3.2)),
        ...made({ surface: 'plaster', color: '#efe4d2' }, [...sideWall(-6, 3, -6, 3.2, 0.2, [[-4.5, 1.5, 0.5, 2.6]]), ...sideWall(-6, 3, 6, 3.2, 0.2, [[0.5, 1.6, 0, 2.2]])]),
        ...place(windowIn(-4.5, 1.5, 0.5, 2.6, 0), -6, 0, 0, 90),
        ...place(doorIn(0.5, 1.6, 2.2, 0, 0.2, { color: '#2f3a33', rough: 0.5 }), 6, 0, 0, -90),
        // The counter: wood below, a stone top; the till and the coffee machine on it.
        { ...B(4.5, 1.05, 0.7, 1.5, 0, -4.4), look: { surface: 'dark-wood', color: '#c9b7a5' } },
        { ...B(4.7, 0.05, 0.85, 1.5, 1.05, -4.4), look: { color: '#e6e2db', rough: 0.25 } },
        M('cash-register', 2.9, -4.45, 0, 1.1, 0.7),
        ...made(METAL, [B(0.6, 0.45, 0.45, 0.3, 1.1, -4.55)]), { ...B(0.5, 0.06, 0.05, 0.3, 1.38, -4.32), look: SCREEN },
        // Shelves behind it, bottles on them.
        M('display-shelves', 0.4, -5.75), M('display-shelves', 2.6, -5.75), M('wine-bottles', 0.4, -5.8, 0, 1.56), M('vase', 2.4, -5.8, 0, 1.56),
        ...[-0.3, 0.8, 1.9, 3].map((x) => M('bar-stool', x, -3.6)),
        // Round tables, a chair either side; a lamp hanging over each.
        ...tables.flatMap(([x, z]) => [M('cafe-table', x, z), M('cafe-chair', x - 0.7, z, 90), M('cafe-chair', x + 0.7, z, -90), M('pendant-lamp', x, z, 0, 1.84)]),
        M('tea-set', -1, -1.4, 0, 0.75, 0.45), M('vase', 1.6, -1.6, 0, 0.75, 0.6),
        M('small-plant', -5.8, -3.6, 0, 0.5), M('small-plant', -5.8, 0.6, 0, 0.5),
        M('tall-plant', 5.5, -5.5), M('chalkboard', 5.2, 2.2, -120),
      ];
    },
  },
  {
    id: 'street',
    name: 'City street',
    group: 'Outdoor',
    place: 'Downtown, today',
    description: 'A city street: a pavement in front of shops and tall blocks, street lamps, a bench and a bin, a road with a zebra crossing and parked cars.',
    lights: [bulb('Street lamp', [-4.5, 4.4, 1.6], { color: '#ffd09e', kelvin: undefined, spot: 80, aim: { point: [-4.5, 0, 0.6] }, intensity: 0.9, range: 12 })],
    build: () => [
      { ...floor(40, 30, -2), look: 'asphalt' },
      // (The pavement flush with the road: people stand on the stage's floor.)
      { ...B(52, 0.02, 7, 0, 0, -1.5), look: 'paving' },
      { ...B(52, 0.03, 0.3, 0, 0, 2), look: 'concrete' },
      // The blocks behind it: brick or tiled, a window to each bay of each floor, shops below.
      ...cityBlock(-14, 7, 14, { surface: 'red-brick' }), ...cityBlock(-6.5, 8, 9, { surface: 'facade-tiles', color: '#d8d4cc' }), ...cityBlock(1.5, 8, 18, { surface: 'brick', color: '#cbb8a8' }),
      ...cityBlock(9.5, 8, 7, { surface: 'facade-tiles', color: '#c9cfd4' }), ...cityBlock(17, 7, 12, { surface: 'red-brick', color: '#c8b0a0' }),
      ...[-10, -4.5, 6, 12].map((x) => M('street-lamp', x, 1.6, 180)),
      M('bench', -2.5, -2.2, 0, 0, 1.3), M('trash-can', 2.6, -2.6), M('hydrant', 8.2, 1.4), M('utility-box', -7.5, -4.7),
      M('planter', -14.5, -1.2), M('planter', 16.5, -1.2), M('aspen', -18, -0.6), M('aspen', 19, -0.6),
      // The road: a dashed middle line, a zebra crossing, a manhole; cars parked by the kerb.
      ...made({ color: '#f1f0ea', rough: 0.7 }, [
        ...Array.from({ length: 7 }, (_, i) => B(0.5, 0.012, 4, -2.7 + i * 0.9, 0, 5.5)),
        ...Array.from({ length: 8 }, (_, i) => B(2.5, 0.012, 0.14, -18 + i * 5, 0, 8.2)).filter((p) => Math.abs(p.at[0]) > 4),
      ]),
      M('manhole', 3.5, 9.5), M('covered-car', -9, 3.6, 90), M('covered-car', 7, 3.6, 90),
      ...made(METAL, [C(0.04, 3, 4.6, 0, 2.4)]), { ...B(0.6, 0.6, 0.03, 4.6, 2.5, 2.4), look: { color: '#1f5fa8', rough: 0.5 } },
    ],
  },
  {
    id: 'park',
    name: 'Park',
    group: 'Outdoor',
    place: 'City park, today',
    description: 'A park: a gravel path through the grass, trees and bushes, benches, a round fountain and lamp posts.',
    lights: [bulb('Lamp post', [-8, 4.4, 0], { color: '#ffd09e', kelvin: undefined, intensity: 0.6, range: 10 })],
    build: () => [
      { ...floor(40, 34, -4), look: { surface: 'grass', rough: 1, metal: 0 } },
      { ...B(40, 0.02, 3, 0, 0, 1.2), look: 'gravel' },
      M('ash', -6, -4), M('oak', -10, -9, 40), M('aspen', 5, -8, 120), M('ash', 10.5, -3.5, 200), M('oak', -3, -13, 300), M('aspen', 13, -11, 60),
      M('bush', -4.4, -1.4), M('bush', 7.6, -1.6, 90), M('bush', -13, -2, 30), M('fern', -6.8, -2.4), M('fern', 11.8, -1.5, 70),
      M('bench', -1.8, -0.55, 0, 0, 1.25), M('bench', 4.2, -0.55, 0, 0, 1.25), M('trash-can', 1.2, -0.7, 0, 0, 0.6),
      ...fountain(2, -5.5),
      M('street-lamp', -8, 0, 180), M('street-lamp', 9, 0, 180),
      M('rocks', 15, -16), M('rocks', -16, -15, 120),
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
      { ...floor(24, 24, -3), look: 'courtyard-paving' },
      ...place(hall(9, 5, 3.2), 0, 0, -10),
      ...place(hall(6, 4, 2.8, 0.45, 4), -8, 0, -3, 90),
      ...place(hall(6, 4, 2.8, 0.45, 4), 8, 0, -3, -90),
      ...made({ surface: 'courtyard-paving', color: '#b8b6b0' }, [...wall(-11, -3, 6, 2.6, 0.4), ...wall(3, 11, 6, 2.6, 0.4), ...wall(-3, 3, 6, 2.6, 0.4, [[-1.2, 1.2, 0, 2.4]])]),
      { shape: ['ring', 1.2, 0.14, 180], at: [0, 1.2, 6], look: STONE },
      ...made({ surface: 'grey-roof', color: '#9a9a96' }, place(roof(0.6, 22, 2.6, 25, 0.15, 0.12), 0, 0, 6, 90)),
      // Under the main hall's eaves: two armchairs and a tea table; vases by the steps.
      M('chinese-armchair', -1.2, -7.2, 0, 0.6), M('chinese-armchair', 1.2, -7.2, 0, 0.6), M('chinese-tea-table', 0, -7.3, 0, 0.6),
      M('antique-vase', -2.3, -6.1, 0, 0, 1.6), M('antique-vase', 2.3, -6.1, 0, 0, 1.6),
      // The stone table and its drum stools.
      ...made(STONE, [C(0.5, 0.75, -3.5, 0, -2.5, 0.45, 28), ...[0, 1, 2, 3].map((i) => { const a = (i * Math.PI) / 2 + 0.6; return C(0.2, 0.42, -3.5 + Math.cos(a) * 0.9, 0, -2.5 + Math.sin(a) * 0.9, 0.17, 20); })]),
      M('oak', 4.5, -4.5, 0, 0, 0.7), M('clay-pot', 6, -6.5), M('clay-pot', -6, 1.5, 40),
      ...lantern(-3, 3.2, -7.2), ...lantern(3, 3.2, -7.2),
    ],
  },
  {
    id: 'palace',
    name: 'Palace hall',
    group: 'Indoor',
    place: 'Imperial China',
    description: 'A throne hall of the Forbidden City: two rows of tall red-lacquer columns, a stepped dais with the throne and a screen behind it, bronze incense burners, chandeliers, a long open floor of dark brick.',
    lights: [bulb('Candles', [-3, 2.2, -11], { kelvin: 2000, intensity: 0.6, range: 7 }), bulb('Candles 2', [3, 2.2, -11], { kelvin: 2000, intensity: 0.6, range: 7 })],
    build: () => [
      { ...floor(22, 26, -6), look: 'palace-floor' },
      ...made({ surface: 'red-plaster' }, [...wall(-11, 11, -18, 8, 0.6), ...sideWall(-18, 6, -11, 8, 0.6), ...sideWall(-18, 6, 11, 8, 0.6)]),
      ...made(TEAL, [B(22, 0.5, 0.65, 0, 7.5, -17.98), ...place([B(24, 0.5, 0.65, 0, 7.5, 0)], -10.98, 0, -6, 90), ...place([B(24, 0.5, 0.65, 0, 7.5, 0)], 10.98, 0, -6, -90)]),
      ...[-4.5, 4.5].flatMap((x) => [-14, -10, -6, -2, 2].flatMap((z) => [{ ...C(0.38, 8, x, 0, z, 0.36), look: LACQUER }, { ...C(0.55, 0.25, x, 0, z, 0.5, 24), look: { surface: 'marble', color: '#e2dccf' } as Look }])),
      ...made({ surface: 'marble', color: '#e8e2d4' }, [B(9, 0.4, 5, 0, 0, -14.5), B(7, 0.4, 4, 0, 0.4, -14.8), B(5, 0.4, 3, 0, 0.8, -15), ...steps(2.4, 1.2, 6, 0.32, 0, -10.2)]),
      M('chinese-armchair', 0, -15.1, 0, 1.2, 1.3),
      ...[-1.3, 0, 1.3].map((x) => M('chinese-screen', x, -16.3, 0, 1.2, 1.5)),
      ...[-3, 3].flatMap((x) => [M('brass-vase', x, -9, 0, 0, 2), M('antique-vase', x * 2.6, -16.8, 0, 0, 2.4)]),
      ...[-6.5, 6.5].flatMap((x) => [M('chinese-cabinet', x * 1.5, -12, x < 0 ? 90 : -90), M('chinese-console', x * 1.5, -4, x < 0 ? 90 : -90)]),
      ...[-10, -2].flatMap((z) => [M('chinese-chandelier', -2, z, 0, 5.2, 1.4), M('chinese-chandelier', 2, z, 0, 5.2, 1.4)]),
    ],
  },
  {
    id: 'old-street',
    name: 'Old Chinese street',
    group: 'Outdoor',
    place: 'Market town, Ming–Qing China',
    description: 'An old market street: two-storey wooden shopfronts with tiled eaves on both sides, hanging lanterns and shop signs, goods out front, a stone-paved road and a memorial archway at its end.',
    lights: [bulb('Lantern', [-3.1, 2.6, -1.6], { kelvin: 1900, intensity: 0.5, range: 5 }), bulb('Lantern 2', [3.1, 2.6, -6.6], { kelvin: 1900, intensity: 0.5, range: 5 })],
    build: () => {
      const wood: Look = { surface: 'planks', color: '#8a6142' };
      // A shop on one side (-1 left, 1 right), its open front to the street: wooden below, plastered above, a tiled roof and eave, a sign; its goods out front.
      const shop = (z: number, side: number, i: number): Piece[] => [
        ...place([
          { ...B(5, 3, 4, 0, 0, 0), look: wood },
          { ...B(5, 3, 4, 0, 3, 0), look: { surface: 'rough-plaster', color: '#e9e4da' } },
          ...made(wood, [B(0.2, 3, 3.6, -side * 2.6, 0, 0), B(0.25, 0.25, 4.1, -side * 2.6, 3, 0)]),
          { ...B(0.9, 0.12, 4.2, -side * 2.8, 3, 0, [0, 0, side * 18]), look: { surface: 'grey-roof', color: '#9a9a96' } },
          ...made({ surface: 'grey-roof', color: '#9a9a96' }, place(roof(5, 4, 6, 30, 0.6), 0, 0, 0, 0)),
          { ...B(0.08, 1.4, 0.5, -side * 2.75, 1.6, 1.2), look: { color: '#2b1d14', rough: 0.4 } },
        ], side * 6, 0, z),
        ...(i % 2 ? [M('barrel', side * 3.2, z - 1.1), M('basket', side * 3.3, z + 0.2, 0, 0.88)] : [M('crate', side * 3.2, z - 0.8, 90), M('bucket', side * 3.3, z + 0.6)]),
      ];
      const gate: Piece[] = [
        ...made(STONE, [C(0.3, 6, -3, 0, -22, 0.28, 16), C(0.3, 6, 3, 0, -22, 0.28, 16), B(7, 0.6, 0.6, 0, 4.4, -22), B(7.6, 0.5, 0.7, 0, 5.6, -22), B(1, 0.5, 1, -3, 0, -22), B(1, 0.5, 1, 3, 0, -22)]),
        ...made({ surface: 'grey-roof', color: '#9a9a96' }, place(roof(1, 8.4, 6.1, 30, 0.3, 0.14), 0, 0, -22, 90)),
      ];
      return [
        { ...floor(26, 40, -10), look: STONE },
        { ...B(6, 0.02, 40, 0, 0, -10), look: 'cobblestones' },
        ...[2, -3, -8, -13, -18].flatMap((z, i) => [...shop(z, -1, i), ...shop(z, 1, i + 1)]),
        ...[2, -3, -8, -13].flatMap((z) => [...lantern(-3.1, 2.4, z + 1.4), ...lantern(3.1, 2.4, z + 1.4)]),
        M('wooden-lantern', -3.3, -5.4, 0, 0), M('chinese-stool', 3.4, -4.6, 30),
        ...gate,
      ];
    },
  },
  {
    id: 'temple',
    name: 'Greek temple',
    group: 'Outdoor',
    place: 'Ancient Greece',
    description: 'A Doric temple on a three-stepped base: a colonnade of fluted columns, the entablature and a triangular pediment, a paved forecourt with an altar, fallen column drums, olive trees and a statue.',
    build: () => {
      const [w, d] = [13, 20];
      const marble: Look = { surface: 'sandstone', color: '#efe9dc' };
      const cols: Piece[] = [];
      for (let i = 0; i < 6; i++) for (const z of [-7, -7 - d + 4]) cols.push(C(0.55, 6.5, -w / 2 + 1.5 + (i * (w - 3)) / 5, 1.2, z, 0.45, 20));
      for (let j = 1; j < 5; j++) for (const x of [-w / 2 + 1.5, w / 2 - 1.5]) cols.push(C(0.55, 6.5, x, 1.2, -7 - j * ((d - 4) / 5), 0.45, 20));
      return [
        { ...floor(34, 40, -8), look: 'dry-ground' },
        { ...B(20, 0.02, 9, 0, 0, -1.5), look: 'temple-paving' },
        ...made(marble, [B(w + 2.4, 0.4, d + 2.4, 0, 0, -15), B(w + 1.2, 0.4, d + 1.2, 0, 0.4, -15), B(w, 0.4, d, 0, 0.8, -15)]),
        ...made(marble, [...cols, ...cols.map((c) => ({ ...B(1.25, 0.25, 1.25, c.at[0], 7.45, c.at[2]) }))]),
        ...made(marble, [B(w - 1.6, 1.4, d - 2.6, 0, 7.7, -15), { shape: ['cyl', w / 2 - 0.5, w / 2 - 0.5, 1.2, 3], at: [0, 9.6, -6.4], rot: [-90, 0, 0] }]),
        ...made({ color: '#a8603f', rough: 0.8 }, place(roof(w - 1.6, d - 2.6, 9.1, 15, 0.3, 0.25), 0, 0, -15, 0)),
        // (The altar behind the acting area, before the steps: the front is left open.)
        { ...B(2, 1, 1.2, 0, 0, -2.6), look: { surface: 'marble', color: '#ece6da' } },
        ...made(marble, [{ shape: ['cyl', 0.5, 0.5, 1.4, 20], at: [-5, 0.5, 1], rot: [0, 30, 90] }, C(0.5, 0.8, 5.5, 0, 0, 0.5, 20)]),
        { ...B(0.6, 1.2, 0.6, 7, 0, -3), look: marble }, M('marble-bust', 7, -3, -30, 1.2, 1.4),
        M('clay-pot', -2.2, -2.2, 20), M('clay-pot', 2.4, -2.4, 160),
        M('oak', -11, -6, 0, 0, 0.55), M('oak', 12, -9, 120, 0, 0.6),
      ];
    },
  },
  {
    id: 'castle-hall',
    name: 'Castle hall',
    group: 'Indoor',
    place: 'Medieval Europe',
    description: 'The great hall of a medieval castle: thick stone walls with arched windows, a long feasting table with benches, a throne on a dais, a big fireplace, banners, a chandelier and a heavy door.',
    lights: [bulb('Fireplace', [6.6, 0.8, -7], { kelvin: 1900, intensity: 1, range: 8 }), bulb('Chandelier', [0, 5.2, -7], { kelvin: 2000, intensity: 0.8, range: 10 }), pane('Window', [-7.4, 5, -7], { kelvin: 7500, intensity: 0.8 })],
    build: () => {
      const stone: Look = { surface: 'stone-blocks', color: '#bdb6aa' };
      const oak: Look = { surface: 'old-planks', color: '#a88e74' };
      return [
        { ...floor(16, 24, -6), look: 'flagstones' },
        ...made(stone, [
          ...wall(-8, 8, -18, 9, 1, [[-1.2, 1.2, 4, 7.5]]), { shape: ['ring', 1.2, 0.25, 180], at: [0, 7.5, -18] },
          ...sideWall(-18, 6, -8, 9, 1, [[-14, -12, 3.5, 6.5], [-8, -6, 3.5, 6.5], [-2, 0, 3.5, 6.5]]),
          ...sideWall(-18, 6, 8, 9, 1, [[-3, -1, 0, 2.96]]),
          ...[-13, -7, -1].map((z) => ({ shape: ['ring', 1, 0.3, 180] as Shape, at: [-8, 6.5, z] as Vec3, rot: [0, 90, 0] as Vec3 })),
        ]),
        ...[-13, -7, -1].map((z) => ({ ...B(0.02, 3, 2, -7.55, 3.5, z), look: { glass: true, color: '#c9d6dc' } as Look })),
        M('castle-door', 7.55, -2, -90),
        // The feasting table down the middle, benches either side, what is on it.
        ...made(oak, [B(1.3, 0.08, 9, 0, 0.72, -7), ...[-10.8, -7, -3.2].flatMap((z) => [B(0.12, 0.72, 0.12, -0.5, 0, z), B(0.12, 0.72, 0.12, 0.5, 0, z)])]),
        ...made(oak, [-1.15, 1.15].flatMap((x) => [B(0.4, 0.06, 8.6, x, 0.42, -7), B(0.3, 0.42, 0.08, x, 0, -10.5), B(0.3, 0.42, 0.08, x, 0, -3.5)])),
        M('candleholders', 0, -7, 90, 0.8, 0.8), M('goblets', -0.2, -9.3, 30, 0.8), M('jug', 0.3, -4.8, 0, 0.8), M('wooden-bowl', -0.25, -5.6, 0, 0.8), M('wooden-bowl', 0.2, -8.4, 0, 0.8),
        // The throne on its dais.
        ...made(stone, [B(6, 0.5, 3.5, 0, 0, -15.8)]), M('throne', 0, -16.2, 0, 0.5, 1.05),
        // The fireplace, its fire glowing.
        ...made(stone, [B(0.8, 3.2, 3.2, 7.2, 0, -7), B(1.4, 0.3, 3.8, 7.1, 3.2, -7)]),
        { ...B(0.62, 1.7, 1.8, 6.8, 0, -7), look: { color: '#1b1612', rough: 0.95 } },
        { ...B(0.3, 0.35, 1.2, 6.85, 0, -7), look: { color: '#ff8a3a', rough: 1 } },
        M('wine-barrel', 6.5, -10.5), M('wine-barrel', 6.3, -11.4, 40), M('gothic-cabinet', -7, -16.5, 90), M('gothic-commode', -7.2, -10, 90),
        // Banners on the end wall, and the chandelier over the table.
        ...[-5, -1.5, 1.5, 5].flatMap((x) => [{ ...B(1.2, 3, 0.05, x, 4.5, -17.45), look: { color: '#7d1a1a', rough: 0.9 } as Look }, { ...B(1.3, 0.08, 0.08, x, 7.5, -17.42), look: { color: '#b8902f', rough: 0.4, metal: 1 } as Look }]),
        M('chandelier', 0, -7, 0, 4.4, 2), ...made({ color: '#2b2b2b', rough: 0.6, metal: 1 }, [C(0.015, 3, 0, 6, -7, 0.015, 6)]),
      ];
    },
  },
];

/** A set's own lights for a scene (new ids each time). */
export const setLights = (id: string): Light[] => (setById(id)?.lights ?? []).map((l) => clampLight({ ...newLight(l.kind, l), id: uid('light'), role: 'practical', ofSet: true }));

/**
 * A lighting for a set (none: null): the last set's own lights given way to this one's, and lit
 * indoors in an indoor set (#17: its walls cast none of the key's shadows), outdoors in another.
 */
export function lightingForSet(l: Lighting, id: string | null): Lighting {
  const indoors = setById(id ?? undefined)?.group === 'Indoor';
  const { environment, ...rest } = l;
  const { indoors: _, ...env } = environment ?? {};
  void _;
  const e = indoors ? { ...env, indoors: true as const } : env;
  return { ...rest, lights: [...l.lights.filter((x) => !x.ofSet), ...(id ? setLights(id) : [])].slice(0, MAX_LIGHTS), ...(Object.keys(e).length ? { environment: e } : {}) };
}

/** A set by its id. */
export const setById = (id: string | undefined) => SETS.find((s) => s.id === id);

const geometries = new Map<string, THREE.BufferGeometry>();
function geometryOf(shape: Exclude<Shape, ['model', ...unknown[]]>): THREE.BufferGeometry {
  const key = JSON.stringify(shape);
  let g = geometries.get(key);
  if (!g) {
    switch (shape[0]) {
      case 'box': g = new THREE.BoxGeometry(shape[1], shape[2], shape[3]); break;
      case 'cyl': g = new THREE.CylinderGeometry(shape[1], shape[2], shape[3], shape[4] ?? 20); break;
      case 'sphere': g = new THREE.SphereGeometry(shape[1], 20, 14); break;
      case 'ring': g = new THREE.TorusGeometry(shape[1], shape[2], 10, 32, ((shape[3] ?? 360) * Math.PI) / 180); break;
    }
    metricUVs(g, shape);
    geometries.set(key, g);
  }
  return g;
}

/**
 * Its texture coordinates in metres (#25), so a surface's texture is its real size on any piece: a
 * box's faces by where they are (across and up), a column round and up, a ball and a ring by their
 * own, stretched to their size.
 */
function metricUVs(g: THREE.BufferGeometry, shape: Exclude<Shape, ['model', ...unknown[]]>) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const [nx, ny, nz] = [Math.abs(nor.getX(i)), Math.abs(nor.getY(i)), Math.abs(nor.getZ(i))];
    if (shape[0] === 'box' || ((shape[0] === 'cyl') && ny > 0.9)) {
      if (ny >= nx && ny >= nz) uv.setXY(i, x, z);
      else if (nx >= nz) uv.setXY(i, z, y);
      else uv.setXY(i, x, y);
    } else if (shape[0] === 'cyl') uv.setXY(i, uv.getX(i) * Math.PI * (shape[1] + shape[2]), y);
    else if (shape[0] === 'sphere') uv.setXY(i, uv.getX(i) * 2 * Math.PI * shape[1], uv.getY(i) * Math.PI * shape[1]);
    else uv.setXY(i, uv.getX(i) * 2 * Math.PI * shape[1], uv.getY(i) * 2 * Math.PI * shape[2]);
  }
}

/* ---------- its models and surfaces (#25): fetched when a set is first shown ---------- */

const INDEX = SET_INDEX as unknown as SetIndex;
const RETRY_MS = 30_000;
/** Each model as read, its bottom's middle at its origin. */
const models = new Map<ModelId, THREE.Object3D>();
const fetching = new Set<string>();
const listeners = new Set<() => void>();
const arrived = () => listeners.forEach((f) => f());

/** Call `f` whenever a set's model or texture has come (what shows it to draw again). Returns a function that stops it. */
export function onSetAssets(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

let gltf: GLTFLoader | null = null;
/** A model, as read (null until it has been: fetching starts now; not got, asked for again later). */
function modelOf(id: ModelId): THREE.Object3D | null {
  const hit = models.get(id);
  const file = INDEX.models[id]?.file;
  // (Not where nothing is drawn: in Node, the tests'.)
  if (hit || !file || fetching.has(id) || typeof document === 'undefined') return hit ?? null;
  fetching.add(id);
  (gltf ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)).loadAsync(withBase(`/sets/${file}`)).then((g) => {
    const root = g.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    root.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
    root.updateMatrixWorld(true);
    models.set(id, root);
    arrived();
  }, (err) => {
    console.warn(`Could not get the set's ${id}:`, err);
    setTimeout(() => { fetching.delete(id); arrived(); }, RETRY_MS);
  });
  return null;
}

const textures = new THREE.TextureLoader();
const maps = new Map<SurfaceId, { color: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture }>();
/** A surface's maps, repeating at its real size (they fill in as they come). */
function mapsOf(id: SurfaceId) {
  let m = maps.get(id);
  const s = INDEX.surfaces[id];
  if (!m && s) {
    const load = (file: string, color = false) => {
      const t = textures.load(withBase(`/sets/${file}`), arrived);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / s.tile, 1 / s.tile);
      t.anisotropy = 8;
      if (color) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    m = { color: load(s.color, true), normal: load(s.normal), orm: load(s.orm) };
    maps.set(id, m);
  }
  return m ?? null;
}

const looks = new Map<string, THREE.Material>();
/** A look's material in 3D (one for each look). */
function materialOf(look: Look): THREE.Material {
  const key = JSON.stringify(look);
  let mat = looks.get(key);
  if (mat) return mat;
  const o = typeof look === 'string' ? { surface: look } : look;
  if (o.glass) {
    mat = new THREE.MeshStandardMaterial({ color: o.color ?? '#dde6ea', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false });
  } else {
    const m = o.surface ? mapsOf(o.surface) : null;
    mat = new THREE.MeshStandardMaterial({
      color: o.color ?? '#ffffff',
      roughness: o.rough ?? (m ? 1 : 0.8),
      metalness: o.metal ?? (m ? 1 : 0),
      // (Its own roughness and metal, if given: not its texture's.)
      ...(m ? { map: m.color, normalMap: m.normal, aoMap: m.orm, ...(o.rough === undefined ? { roughnessMap: m.orm } : {}), ...(o.metal === undefined ? { metalnessMap: m.orm } : {}) } : {}),
    });
  }
  looks.set(key, mat);
  return mat;
}

/* ---------- what is round a set in 3D (#25): its sky outdoors, a room's light indoors ---------- */

const skies = new Map<Sky, THREE.DataTexture | null>();
/** A sky as read (null until it has been: fetching starts now). */
function skyTexture(sky: Sky): THREE.DataTexture | null {
  const file = INDEX.skies?.[sky]?.file;
  if (skies.has(sky) || !file || typeof document === 'undefined') return skies.get(sky) ?? null;
  skies.set(sky, null);
  new HDRLoader().loadAsync(withBase(`/sets/${file}`)).then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    skies.set(sky, t);
    arrived();
  }, (err) => {
    console.warn(`Could not get the ${sky} sky:`, err);
    setTimeout(() => { skies.delete(sky); arrived(); }, RETRY_MS);
  });
  return null;
}

/** Each renderer's prefiltered lights from all round (a sky's, a room's), made once. */
const prefiltered = new WeakMap<THREE.WebGLRenderer, { pmrem: THREE.PMREMGenerator; made: Map<string, THREE.Texture> }>();
function prefilter(renderer: THREE.WebGLRenderer, key: string, make: (pmrem: THREE.PMREMGenerator) => THREE.Texture) {
  let p = prefiltered.get(renderer);
  if (!p) prefiltered.set(renderer, (p = { pmrem: new THREE.PMREMGenerator(renderer), made: new Map() }));
  let t = p.made.get(key);
  if (!t) p.made.set(key, (t = make(p.pmrem)));
  return t;
}

/** How bright each sky's light is: a night's dim. */
const SKY_LIGHT: Record<Sky, number> = { day: 0.55, overcast: 0.5, dusk: 0.4, night: 0.15 };

/**
 * What is round a set in 3D: outdoors its sky (seen behind it, and the light from all round), by
 * its lighting's time of day; indoors, a room's light from all round. Null without a set, or
 * until its sky has come.
 */
export function surroundings(id: string | undefined, lighting: Lighting, renderer: THREE.WebGLRenderer): { background: THREE.Texture | null; environment: THREE.Texture; intensity: number } | null {
  const set = setById(id);
  if (!set) return null;
  if (set.group === 'Indoor') return { background: null, environment: prefilter(renderer, 'room', (pmrem) => pmrem.fromScene(new RoomEnvironment(), 0.04).texture), intensity: 0.35 };
  const sky = skyOf(lighting);
  const t = skyTexture(sky);
  if (!t) return null;
  return { background: t, environment: prefilter(renderer, sky, (pmrem) => pmrem.fromEquirectangular(t).texture), intensity: SKY_LIGHT[sky] };
}

/** The models a set is furnished with. */
export const setModels = (id: string) => [...new Set((setById(id)?.build() ?? []).flatMap((p) => (p.shape[0] === 'model' ? [p.shape[1]] : [])))];

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
      // (A model: the box round it, as it came out of `npm run sets`, scaled; its bottom where it stands.)
      const fit = p.shape[0] === 'model' ? INDEX.models[p.shape[1]]?.size.map((v) => v * ((p.shape as ['model', ModelId, number?])[2] ?? 1)) : null;
      const size = kind === 'box' ? [p.shape[1], p.shape[2], p.shape[3]] as number[] : kind === 'cyl' ? [2 * Math.max(p.shape[1], p.shape[2]), p.shape[3], 2 * Math.max(p.shape[1], p.shape[2])] : fit;
      if (!size) continue;
      const half = new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2);
      const at = new THREE.Vector3(...p.at).add(new THREE.Vector3(0, fit ? half.y : 0, 0));
      // (A floor: what lies on the ground, flat.)
      if (at.y + half.y <= 0.05) continue;
      const turn = p.rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot.map((a) => (a * Math.PI) / 180) as Vec3), 'YXZ')) : new THREE.Quaternion();
      boxes.push({ at, half, turn });
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
  /** Its models not yet here (put in as they come). */
  private waiting: Piece[] = [];
  private style: Style = 'line';
  private off: () => void;
  private shadows = false;

  constructor(ink: Ink, readonly id: string) {
    this.parts = new InkedParts(ink, 'prop');
    for (const p of setById(id)?.build() ?? []) {
      if (p.shape[0] === 'model') { this.waiting.push(p); continue; }
      const mesh = this.parts.add(this.object, geometryOf(p.shape), { set: id }, p.at);
      this.pieces.push(mesh);
      if (p.rot) mesh.rotation.set(...(p.rot.map((a) => (a * Math.PI) / 180) as Vec3), 'YXZ');
      // (A floor casts no shadow, only takes them: nothing is under it, and a broad surface that
      // shades itself shows stripes of shadow that crawl as the view turns.)
      if (p.shape[0] === 'box' && p.at[1] + p.shape[2] / 2 <= 0.001) { mesh.castShadow = false; mesh.userData.floor = true; }
      if (p.look) {
        // (Its material made, and its textures fetched, when it is first drawn in 3D.)
        mesh.userData.look = p.look;
        // (Glass casts no shadow.)
        if (typeof p.look === 'object' && p.look.glass) mesh.userData.floor = true;
      }
    }
    // (A set stands still: its parts placed once, not worked out again every frame.)
    this.object.traverse((o) => { o.raycast = () => {}; o.updateMatrix(); o.matrixAutoUpdate = false; });
    this.furnish();
    this.off = onSetAssets(() => this.furnish());
  }

  /** Its models that have come put in, each of its meshes a part (outlined in the styles with lines; in 3D in its own materials). */
  private furnish() {
    if (!this.waiting.length) return;
    const was = this.waiting;
    this.waiting = [];
    for (const p of was) {
      const [, id, scale = 1] = p.shape as ['model', ModelId, number?];
      const model = modelOf(id);
      if (!model) { this.waiting.push(p); continue; }
      const place = new THREE.Matrix4().compose(
        new THREE.Vector3(...p.at),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...((p.rot ?? [0, 0, 0]).map((a) => (a * Math.PI) / 180) as Vec3), 'YXZ')),
        new THREE.Vector3(scale, scale, scale),
      );
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mesh = this.parts.add(this.object, m.geometry, { set: this.id });
        mesh.matrixAutoUpdate = false;
        mesh.matrix.multiplyMatrices(place, m.matrixWorld);
        mesh.raycast = () => {};
        for (const child of mesh.children) { child.raycast = () => {}; child.matrixAutoUpdate = false; child.updateMatrix(); }
        mesh.userData.own = m.material;
        mesh.castShadow = this.shadows;
        this.pieces.push(mesh);
      });
    }
    if (this.waiting.length < was.length) {
      this.box = null;
      this.setStyle(this.style);
    }
  }

  setStyle(style: Style) {
    this.style = style;
    this.parts.refresh(style, () => false);
    // (In 3D, in its own materials: textured.)
    if (style === 'render') {
      for (const mesh of this.pieces) {
        const own = mesh.userData.own ?? (mesh.userData.look ? materialOf(mesh.userData.look) : null);
        if (own) mesh.material = own;
      }
    }
  }

  /**
   * Whether its parts cast the key's shadows (#17): outdoors (the sun: its walls, roofs and trees
   * shade the people), not indoors (a studio key: its walls would leave the room in the dark). Its
   * floors cast none either way.
   */
  castShadows(on: boolean) {
    this.shadows = on;
    for (const mesh of this.pieces) mesh.castShadow = on && !mesh.userData.floor;
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
    this.off();
    this.object.clear();
  }
}
