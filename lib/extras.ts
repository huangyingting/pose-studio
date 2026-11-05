import * as THREE from 'three';
import INDEX from '../public/motions/index.json';
import { newAnimation } from './animation';
import { BODY_PRESETS, DEFAULT_BODY } from './body';
import { cameraAt } from './cameras';
import { newFigure, nextName } from './doc';
import { legsOf } from './locomotion';
import { withFacing } from './relations';
import { setBlocks } from './sets';
import { uid } from './uid';
import type { Action, Figure, Scene } from './types';

/*
 * Extras (#57): people passing by behind the action, to and fro along lanes of their own across
 * what the scene's camera sees, further back than the cast, each in its own build and walk,
 * pausing at either end. Lanes stop short of a set's walls, and one with a wall between it and the
 * cast is not used. Extras are never filmed as a coverage's subject (lib/coverage.ts), and their
 * own steps are not the cast's to fix (lib/qa.ts); walking into someone still is.
 */

/** How far behind the cast the first lane is, and the next ones (m). */
const FIRST = 3;
const GAP = 1.3;
/** How far a lane goes either side of the middle (m), and the least it may be left with. */
const HALF = 7;
const SHORTEST = 3;
/** How far short of a wall a lane stops (m). */
const CLEAR = 0.6;
/** How long an extra waits at either end before turning back (s), at least and at most. */
const PAUSE: [number, number] = [0.6, 2.2];
/** Their walks and builds, in turn. */
const GAITS = ['library:walk', 'library:walk-forward', 'library:happy-walk'];
const BUILDS = ['Woman', 'Man', 'Tall woman', 'Big man', 'Tall man', 'Woman', 'Man', 'Child'];
const TINTS = ['#8a9bb0', '#b08a8a', '#8ab09a', '#a89a7c', '#9a8ab0', '#7ca6a8', '#b0a08a', '#8aa0b0'];

type Lane = { a: [number, number]; b: [number, number] };

/** A number 0–1 from n, the same each time (where on its lane an extra starts, how long it waits). */
const spread = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** The lanes behind the cast, as the scene's camera sees them, nearest first. */
function lanes(scene: Scene, count: number): Lane[] {
  const cast = scene.figures.filter((f) => !f.extra && !f.hidden);
  const mid = cast.length ? cast.reduce((m, f) => [m[0] + f.position[0] / cast.length, m[1] + f.position[2] / cast.length], [0, 0]) : [0, 0];
  const view = cameraAt(scene, 0, 16 / 9);
  const look = new THREE.Vector3().subVectors(view.target, view.position).setY(0);
  if (look.lengthSq() < 1e-6) look.set(0, 0, -1);
  look.normalize();
  const right = new THREE.Vector3(-look.z, 0, look.x);
  const at = (x: number, z: number) => new THREE.Vector3(x, 0.5, z);
  const from = at(mid[0], mid[1]);
  const out: Lane[] = [];
  for (let k = 0; out.length < count && k < count * 3; k++) {
    const c = from.clone().addScaledVector(look, FIRST + GAP * k);
    // (Beyond a wall from the cast: none further back either.)
    if (setBlocks(scene.set, from, c) !== null) break;
    const reach = (dir: number) => {
      const d = setBlocks(scene.set, c, c.clone().addScaledVector(right, dir * HALF));
      return d === null ? HALF : Math.max(0, d - CLEAR);
    };
    const [l, r] = [reach(-1), reach(1)];
    if (l + r < SHORTEST) continue;
    const end = (d: number): [number, number] => [Math.round((c.x + right.x * d) * 1000) / 1000, Math.round((c.z + right.z * d) * 1000) / 1000];
    out.push({ a: end(-l), b: end(r) });
  }
  return out;
}

/**
 * The scene with `count` extras passing by (animated for 12 s if it was still): to and fro along
 * the lanes behind the cast, a lane each (taken in turn where there are fewer), for as long as it
 * plays. Fewer where the set leaves no room for more.
 */
export function withExtras(scene: Scene, count: number): Scene {
  const a = scene.animation ?? { ...newAnimation(scene, 12), loop: false };
  const ways = lanes(scene, count);
  if (!ways.length) return scene;
  const already = scene.figures.filter((f) => f.extra).length;
  const figures: Figure[] = [];
  const actions: Action[] = [];
  const names = scene.figures.map((f) => f.name);
  for (let i = 0; i < count; i++) {
    const n = already + i;
    const lane = ways[i % ways.length];
    const body = { ...(BODY_PRESETS.find((p) => p.name === BUILDS[n % BUILDS.length])?.body ?? DEFAULT_BODY) };
    const gait = GAITS[n % GAITS.length];
    const m = (INDEX as unknown as { id: string; duration: number; move: [number, number] }[]).find((x) => x.id === gait)!;
    const speed = (Math.hypot(...m.move) / m.duration) * (legsOf(body).rootY / legsOf(DEFAULT_BODY).rootY);
    // Somewhere along its lane, going one way or the other.
    const u = spread(n + 1);
    const start: [number, number] = [lane.a[0] + (lane.b[0] - lane.a[0]) * u, lane.a[1] + (lane.b[1] - lane.a[1]) * u];
    let toB = n % 2 === 0;
    const name = nextName('Extra', [...names, ...figures.map((f) => f.name)]);
    const yaw = (p: [number, number], q: [number, number]) => (Math.atan2(q[0] - p[0], q[1] - p[1]) * 180) / Math.PI;
    const first = toB ? lane.b : lane.a;
    const f: Figure = { ...withFacing(newFigure({ name, body, position: [start[0], 0, start[1]] }), yaw(start, first)), extra: true, color: TINTS[n % TINTS.length] };
    figures.push(f);
    let t = Math.round(spread(n + 7) * 1.5 * a.fps) / a.fps;
    let here = start;
    for (let leg = 0; leg < 40; leg++) {
      const to = toB ? lane.b : lane.a;
      const d = Math.hypot(to[0] - here[0], to[1] - here[1]);
      const duration = Math.max(1 / a.fps, Math.round((d / speed) * a.fps) / a.fps);
      // (Within the scene as long as it is: not made longer by them.)
      if (t + duration > a.duration) break;
      actions.push({ id: uid('act'), start: t, duration, roles: [{ figure: f.id, end: { at: to, facing: Math.round(yaw(here, to) * 10) / 10 || 0 } }], source: { kind: 'travel', mode: 'walk', gait } });
      t += duration + Math.round((PAUSE[0] + spread(n * 31 + leg) * (PAUSE[1] - PAUSE[0])) * a.fps) / a.fps;
      here = to;
      toB = !toB;
    }
  }
  return { ...scene, figures: [...scene.figures, ...figures], animation: { ...a, actions: [...a.actions, ...actions].sort((p, q) => p.start - q.start) } };
}
