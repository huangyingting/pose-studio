import { propStretchesOf } from './evaluate';
import { newCamera } from './cameras';
import { newShot, shotSpans } from './shots';
import type { Camera, CameraRig, RigCamera, Scene, Shot } from './types';

/*
 * Coverage: how to film a scene, as a set of cameras on roles (A, B) and rules for cutting
 * between them, the way a director plans coverage: a master, singles and over-the-shoulder shots,
 * a tracking camera. The cameras place themselves from the figures playing the roles (rigs,
 * lib/cameras.ts), their angles from the line between A and B, all on one side of it (the line of
 * action), so the coverage works in any scene. The cuts fall on what happens: someone setting off
 * or starting a motion, a prop let go of or caught, or on a beat when nothing does.
 */

export type CoverageRole = 'A' | 'B';

/** A camera of a coverage: on a role (with the other in frame, for a two-shot), placed by a rig. */
interface CoverageCamera {
  key: string;
  /** Its name, with {A} and {B} for the figures playing them. */
  name: string;
  subject: CoverageRole;
  also?: CoverageRole;
  /** Hand-held shake, 0–1. */
  shake?: number;
  rig: Omit<CameraRig, 'toward' | 'clear'> & { toward?: CoverageRole; clear?: CoverageRole };
}

/** When to cut to a camera: at the start, when a role sets off or starts a motion, lets go of or catches a prop, or on a beat. */
type CutRule =
  | { on: 'start'; camera: string }
  | { on: 'action'; role: CoverageRole; kind?: 'travel' | 'motion'; camera: string }
  | { on: 'release' | 'catch'; role: CoverageRole; camera: string }
  | { on: 'beat'; every: number; cameras: string[] };

export interface Coverage {
  id: string;
  name: string;
  description: string;
  roles: CoverageRole[];
  cameras: CoverageCamera[];
  cuts: CutRule[];
}

/** No shot shorter than this (s). */
const MIN_SHOT = 1;

export const COVERAGES: Coverage[] = [
  {
    id: 'dialogue',
    name: 'Conversation',
    description: 'A master two-shot, over-the-shoulder shots and singles, all on one side of the line between them',
    roles: ['A', 'B'],
    cameras: [
      { key: 'master', name: 'Master', subject: 'A', also: 'B', rig: { yaw: 90, pitch: 5, toward: 'B', size: 'fs', lens: 35, smooth: 1 } },
      { key: 'ots-a', name: '{A} over {B}’s shoulder', subject: 'A', rig: { yaw: 18, pitch: 3, toward: 'B', size: 'ms', place: 'right', lens: 50, smooth: 0.8 } },
      { key: 'ots-b', name: '{B} over {A}’s shoulder', subject: 'B', rig: { yaw: -18, pitch: 3, toward: 'A', size: 'ms', place: 'left', lens: 50, smooth: 0.8 } },
      { key: 'single-a', name: '{A} single', subject: 'A', rig: { yaw: 30, pitch: 2, toward: 'B', clear: 'B', size: 'mcu', place: 'right', lens: 85, smooth: 0.8 } },
      { key: 'single-b', name: '{B} single', subject: 'B', rig: { yaw: -30, pitch: 2, toward: 'A', clear: 'A', size: 'mcu', place: 'left', lens: 85, smooth: 0.8 } },
    ],
    cuts: [
      { on: 'start', camera: 'master' },
      { on: 'action', role: 'A', camera: 'ots-a' },
      { on: 'action', role: 'B', camera: 'ots-b' },
      { on: 'beat', every: 3, cameras: ['single-a', 'single-b', 'master'] },
    ],
  },
  {
    id: 'follow',
    name: 'Follow the action',
    description: 'A wide shot, a tracking camera when they set off, a close one for what they do on the spot',
    roles: ['A'],
    cameras: [
      { key: 'wide', name: 'Wide on {A}', subject: 'A', rig: { yaw: 35, pitch: 8, size: 'ws', lens: 28, smooth: 1.2 } },
      { key: 'tracking', name: 'Tracking {A}', subject: 'A', rig: { yaw: 90, pitch: 3, turn: true, size: 'mws', lens: 50, smooth: 1 } },
      { key: 'behind', name: 'Behind {A}', subject: 'A', rig: { yaw: 160, pitch: 10, turn: true, size: 'fs', lens: 35, smooth: 1 } },
      { key: 'close', name: 'Close on {A}', subject: 'A', rig: { yaw: 25, pitch: 2, turn: true, size: 'mcu', place: 'right', lens: 85, smooth: 1 } },
    ],
    cuts: [
      { on: 'start', camera: 'wide' },
      { on: 'action', role: 'A', kind: 'travel', camera: 'tracking' },
      { on: 'action', role: 'A', kind: 'motion', camera: 'close' },
      { on: 'beat', every: 4, cameras: ['behind', 'wide'] },
    ],
  },
  {
    id: 'sports',
    name: 'Sports',
    description: 'A wide shot of both, cutting to the one who gets the ball as it is let go, tracking a run',
    roles: ['A', 'B'],
    cameras: [
      { key: 'wide', name: 'Wide', subject: 'A', also: 'B', rig: { yaw: 90, pitch: 12, toward: 'B', size: 'ws', lens: 28, smooth: 1 } },
      { key: 'single-a', name: '{A}', subject: 'A', rig: { yaw: 25, pitch: 3, toward: 'B', clear: 'B', size: 'ms', place: 'right', lens: 70, smooth: 0.6 } },
      { key: 'single-b', name: '{B}', subject: 'B', rig: { yaw: -25, pitch: 3, toward: 'A', clear: 'A', size: 'ms', place: 'left', lens: 70, smooth: 0.6 } },
      { key: 'track-a', name: 'Tracking {A}', subject: 'A', rig: { yaw: 90, pitch: 3, turn: true, size: 'mws', lens: 50, smooth: 1 } },
    ],
    cuts: [
      { on: 'start', camera: 'wide' },
      { on: 'release', role: 'A', camera: 'single-b' },
      { on: 'release', role: 'B', camera: 'single-a' },
      { on: 'action', role: 'A', kind: 'travel', camera: 'track-a' },
      { on: 'beat', every: 4, cameras: ['wide'] },
    ],
  },
  {
    id: 'fight',
    name: 'Fight',
    description: 'A wide shot of both, a low angle on each fighter and close ones, a little hand-held, cutting to whoever strikes',
    roles: ['A', 'B'],
    cameras: [
      { key: 'wide', name: 'Wide on the fight', subject: 'A', also: 'B', shake: 0.15, rig: { yaw: 90, pitch: 4, toward: 'B', size: 'fs', lens: 28, smooth: 0.7 } },
      { key: 'low-a', name: 'Low on {A}', subject: 'A', shake: 0.2, rig: { yaw: 40, pitch: -12, toward: 'B', clear: 'B', size: 'ms', place: 'right', lens: 50, smooth: 0.5 } },
      { key: 'low-b', name: 'Low on {B}', subject: 'B', shake: 0.2, rig: { yaw: -40, pitch: -12, toward: 'A', clear: 'A', size: 'ms', place: 'left', lens: 50, smooth: 0.5 } },
      { key: 'close-a', name: '{A} close', subject: 'A', shake: 0.25, rig: { yaw: 25, pitch: 2, toward: 'B', clear: 'B', size: 'mcu', place: 'right', lens: 70, smooth: 0.5 } },
      { key: 'close-b', name: '{B} close', subject: 'B', shake: 0.25, rig: { yaw: -25, pitch: 2, toward: 'A', clear: 'A', size: 'mcu', place: 'left', lens: 70, smooth: 0.5 } },
    ],
    cuts: [
      { on: 'start', camera: 'wide' },
      { on: 'action', role: 'A', kind: 'travel', camera: 'wide' },
      { on: 'action', role: 'A', kind: 'motion', camera: 'low-a' },
      { on: 'action', role: 'B', kind: 'motion', camera: 'low-b' },
      { on: 'beat', every: 2, cameras: ['close-a', 'close-b', 'wide'] },
    ],
  },
  {
    id: 'one-take',
    name: 'One take',
    description: 'A single camera that goes with them, turning as they turn: no cuts',
    roles: ['A'],
    cameras: [
      { key: 'take', name: 'One take on {A}', subject: 'A', rig: { yaw: 50, pitch: 5, turn: true, size: 'mws', lens: 35, smooth: 1.5 } },
    ],
    cuts: [{ on: 'start', camera: 'take' }],
  },
  {
    id: 'documentary',
    name: 'Documentary',
    description: 'Hand-held cameras and longer shots: a wide one, a close one, one from behind, cutting when they set off',
    roles: ['A'],
    cameras: [
      { key: 'wide', name: 'Hand-held wide on {A}', subject: 'A', shake: 0.35, rig: { yaw: 40, pitch: 6, size: 'ws', lens: 28, smooth: 1.4 } },
      { key: 'close', name: 'Hand-held close on {A}', subject: 'A', shake: 0.5, rig: { yaw: 20, pitch: 2, turn: true, size: 'mcu', place: 'right', lens: 70, smooth: 1.2 } },
      { key: 'behind', name: 'Hand-held behind {A}', subject: 'A', shake: 0.45, rig: { yaw: 150, pitch: 8, turn: true, size: 'mws', lens: 35, smooth: 1.2 } },
    ],
    cuts: [
      { on: 'start', camera: 'wide' },
      { on: 'action', role: 'A', kind: 'travel', camera: 'behind' },
      { on: 'beat', every: 6, cameras: ['close', 'wide'] },
    ],
  },
];

export const coverageById = (id: string) => COVERAGES.find((c) => c.id === id) ?? null;

/** The director's styles (#14): a coverage each, cast and kept up to date as what they do changes. */
export const DIRECTOR_STYLES: { id: string; label: string }[] = ['dialogue', 'follow', 'one-take', 'documentary', 'sports', 'fight']
  .map((id) => ({ id, label: coverageById(id)!.name }));

/** The camera a coverage makes for one of its cameras, with these figures in its roles. */
function made(c: Coverage, cc: CoverageCamera, roles: Record<string, string>): Omit<RigCamera, 'id'> {
  const name = cc.name.replace(/\{(A|B)\}/g, (_, r: string) => roles[`name:${r}`] ?? r);
  const { toward, clear, ...rig } = cc.rig;
  return {
    name, subject: roles[cc.subject], ...(cc.also ? { also: [roles[cc.also]] } : {}), ...(cc.shake ? { shake: cc.shake } : {}), made: `${c.id}:${cc.key}`,
    kind: 'rig', rig: { ...rig, ...(toward ? { toward: roles[toward] } : {}), ...(clear ? { clear: roles[clear] } : {}) },
  };
}

/** What the camera is apart from its id and name, in any key order (to tell whether it was edited by hand). */
const rule = (cam: Omit<Camera, 'id'> | Camera) => {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([p], [q]) => (p < q ? -1 : 1)).map(([k, x]) => [k, canon(x)]))
    : v);
  return JSON.stringify(canon({ ...cam, id: undefined, name: undefined }));
};

/** The moments a coverage cuts on, in time order: when, and to which of its cameras. */
function cutsFor(scene: Scene, c: Coverage, roles: Record<string, string>): { t: number; camera: string }[] {
  const a = scene.animation!;
  const events: { t: number; camera: string }[] = [];
  for (const r of c.cuts) {
    if (r.on === 'action') {
      const figure = roles[r.role];
      for (const x of a.actions) {
        if (x.layer || x.start <= 1e-6 || !x.roles.some((p) => p.figure === figure)) continue;
        const kind = x.source.kind === 'travel' ? 'travel' : x.source.kind === 'clip' ? 'motion' : null;
        if (kind && (!r.kind || r.kind === kind)) events.push({ t: x.start, camera: r.camera });
      }
    } else if (r.on === 'release' || r.on === 'catch') {
      for (const p of scene.props) {
        const stretches = propStretchesOf(scene, p.id);
        // Who holds it next, or held it last, leaving out dribbles (back to the same hand).
        const held = (i: number, step: number) => {
          for (let k = i; k >= 0 && k < stretches.length; k += step) if (stretches[k].kind === 'held') return stretches[k].figure;
          return undefined;
        };
        stretches.forEach((s, i) => {
          const next = stretches[i + 1];
          if (r.on === 'release' && s.kind === 'held' && s.figure === roles[r.role] && next?.kind === 'free' && held(i + 1, 1) !== s.figure) events.push({ t: s.t1, camera: r.camera });
          if (r.on === 'catch' && s.kind === 'free' && next?.kind === 'held' && next.figure === roles[r.role] && held(i, -1) !== next.figure) events.push({ t: s.t1, camera: r.camera });
        });
      }
    }
  }
  events.sort((p, q) => p.t - q.t);
  const start = c.cuts.find((r) => r.on === 'start')?.camera ?? c.cameras[0].key;
  const beat = c.cuts.find((r): r is Extract<CutRule, { on: 'beat' }> => r.on === 'beat');
  const out = [{ t: 0, camera: start }];
  let b = 0;
  const cutTo = (t: number, camera: string) => {
    const last = out[out.length - 1];
    if (camera === last.camera || t - last.t < MIN_SHOT || a.duration - t < MIN_SHOT) return false;
    out.push({ t, camera });
    return true;
  };
  for (const e of [...events, { t: a.duration, camera: '' }]) {
    // Between what happens, a cut on each beat.
    while (beat && e.t - out[out.length - 1].t > beat.every * 1.5) {
      const last = out[out.length - 1];
      const k = beat.cameras.map((_, i) => (b + i) % beat.cameras.length).find((i) => beat.cameras[i] !== last.camera);
      if (k === undefined || !cutTo(last.t + beat.every, beat.cameras[k])) break;
      b = (k + 1) % beat.cameras.length;
    }
    if (e.camera) cutTo(Math.round(e.t * a.fps) / a.fps, e.camera);
  }
  return out;
}

/**
 * ProjectSettings a scene with a coverage, with these figures in its roles: its cameras and its cuts over
 * the whole animation. Applied again, it cuts anew and puts back the cameras it made, except
 * those edited by hand since (they are left as they are, and still cut to). Applied over another
 * coverage, that one's cameras go, except those edited by hand; cameras made otherwise are left
 * alone. Captions stay with shots that still start where they did.
 */
export function applyCoverage(scene: Scene, id: string, roles: Record<CoverageRole, string> | Record<'A', string>, director = false): Scene {
  const c = coverageById(id);
  const a = scene.animation;
  if (!c || !a || c.roles.some((r) => !(r in roles))) return scene;
  const named = (rs: Record<string, string>) => ({ ...rs, ...Object.fromEntries(Object.entries(rs).map(([r, f]) => [`name:${r}`, scene.figures.find((x) => x.id === f)?.name ?? r])) });
  const before = scene.coverage?.id === id ? named(scene.coverage.roles) : null;
  let cameras = [...scene.cameras];
  // Over another coverage: its cameras go, except those edited by hand since (and the last camera).
  const last = scene.coverage && scene.coverage.id !== id ? coverageById(scene.coverage.id) : null;
  if (last) {
    const was = named(scene.coverage!.roles);
    const untouched = new Set(last.cameras.map((cc) => made(last, cc, was)).map(rule));
    cameras = cameras.filter((x) => !x.made?.startsWith(`${last.id}:`) || !untouched.has(rule(x)));
  }
  const ids = new Map<string, string>();
  for (const cc of c.cameras) {
    const want = made(c, cc, named(roles));
    const old = cameras.find((x) => x.made === want.made);
    if (old && !(before && rule(old) === rule(made(c, cc, before)))) {
      // Edited by hand since it was made.
      ids.set(cc.key, old.id);
      continue;
    }
    const cam: Camera = { ...want, id: old?.id ?? newCamera({ cameras }).id };
    cameras = old ? cameras.map((x) => (x === old ? cam : x)) : [...cameras, cam];
    ids.set(cc.key, cam.id);
  }
  const captions = new Map(shotSpans(a).filter((s) => s.shot.caption).map((s) => [Math.round(s.start * a.fps), s.shot.caption!]));
  // Shots taken over by hand stay as they are, as long as they were: the cuts fall round them, and
  // after one the coverage's camera of the time comes back.
  // (Only the director, keeping its coverage live, keeps them: a coverage applied anew cuts it all
  // anew. A pinned shot whose camera has just gone is cut anew too.)
  const keep = director && !!scene.coverage?.live && scene.coverage.id === id;
  const pins = shotSpans(a).filter((s) => keep && s.shot.pinned && cameras.some((x) => x.id === s.shot.camera)).map((s) => ({ shot: s.shot, start: s.start, end: Math.min(a.duration, s.start + s.shot.pinned!) }));
  const inPin = (t: number) => pins.some((p) => t >= p.start - 1e-6 && t < p.end - 1e-6);
  const cuts = cutsFor(scene, c, roles);
  const cameraAt = (t: number) => [...cuts].reverse().find((x) => x.t <= t + 1e-6)?.camera ?? cuts[0].camera;
  const fresh: Shot[] = [
    ...cuts.filter((cut) => !inPin(cut.t)).map((cut) => ({ ...newShot(cut.t, '', ids.get(cut.camera) ?? cameras[0].id) })),
    ...pins.filter((p) => p.end < a.duration - 1e-6 && !inPin(p.end) && !cuts.some((x) => Math.abs(x.t - p.end) < 1e-6)).map((p) => newShot(p.end, '', ids.get(cameraAt(p.end)) ?? cameras[0].id)),
  ];
  // The coverage's own shots round the pins: none shorter than a second, none cutting to the camera
  // already filming (a pinned shot stays whatever its length).
  let merged = [...pins.map((p) => p.shot), ...fresh].sort((p, q) => p.start - q.start);
  merged = merged.filter((s, i) => s.pinned || i === 0 || s.camera !== merged[i - 1].camera);
  merged = merged.filter((s, i) => s.pinned || i === 0 || (merged[i + 1]?.start ?? a.duration) - s.start >= MIN_SHOT);
  // A shot that still starts where one did keeps what was given it: its id (what was selected stays
  // so), a name of its own, its blend.
  const was = new Map(a.shots.filter((s) => !s.pinned).map((s) => [Math.round(s.start * a.fps), s]));
  const own = (name: string) => (name && !/^Shot \d+$/.test(name) ? name : '');
  const shots: Shot[] = merged.map((s0, i) => {
    // (Cut anew: no longer taken over.)
    const { pinned: _was, ...bare } = s0;
    void _was;
    const s: Shot = keep ? s0 : bare;
    const before = s.pinned ? s : was.get(Math.round(s.start * a.fps));
    const caption = s.caption ?? captions.get(Math.round(s.start * a.fps));
    const id = s.pinned ? s.id : i === 0 ? 'main' : (before?.id ?? s.id);
    const blend = i > 0 ? before?.blend : undefined;
    return { ...s, id, ...(i === 0 ? { start: 0 } : {}), name: own(before?.name ?? '') || `Shot ${i + 1}`, ...(caption ? { caption } : {}), ...(blend ? { blend } : {}) };
  });
  // (The director keeps its coverage live; applied from the Library, it is cut once, by hand after.)
  return { ...scene, cameras, coverage: { id, roles: { ...roles }, ...(keep || (director && scene.coverage?.live) ? { live: true } : {}) }, animation: { ...a, shots } };
}

/**
 * The director (#14): a live coverage cut again for the scene as it is now (after what they do
 * changed), its cast found again if one of them is gone; shots taken over by hand stay.
 */
export function directed(scene: Scene): Scene {
  const cv = scene.coverage;
  const c = cv?.live && scene.animation ? coverageById(cv.id) : null;
  if (!c) return scene;
  const cast = c.roles.every((r) => scene.figures.some((f) => f.id === cv!.roles[r] && !f.hidden)) ? cv!.roles : castCoverage(scene, c);
  return cast ? applyCoverage(scene, c.id, cast as Record<'A', string>, true) : scene;
}

/** Who plays a coverage's roles: A the given figure (else the first), B the one nearest A. */
export function castCoverage(scene: Scene, c: Coverage, first?: string): Record<string, string> | null {
  const shown = scene.figures.filter((f) => !f.hidden);
  const a = shown.find((f) => f.id === first) ?? shown[0];
  if (!a) return null;
  if (c.roles.length < 2) return { A: a.id };
  const near = (f: (typeof shown)[number]) => Math.hypot(f.position[0] - a.position[0], f.position[2] - a.position[2]);
  const b = shown.filter((f) => f !== a).sort((p, q) => near(p) - near(q))[0];
  return b ? { A: a.id, B: b.id } : null;
}
