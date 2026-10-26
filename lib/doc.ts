import { DEFAULT_BODY, clampBody } from './body';
import { RELAXED_HAND, cloneHand } from './hands';
import { mapPoses, parseAnimation, remapAnimation } from './animation';
import { parseBoard } from './board';
import { uid } from './uid';
import { mirrorJointName, wrapDeg } from './joints';
import { clampLight } from './lighting';
import {
  FINGERS, JOINTS, POSTURES, PROP_KINDS, PROP_LABELS, TRAVELS,
  type Figure, type Hand, type JointName, type Library, type Light, type MotionAsset, type PoseAsset, type PoseKey, type Posture, type Prop, type PropKind, type PropKey, type Scene, type Side, type Travel, type Vec3, type View,
} from './types';

export { uid };

export const DEFAULT_VIEW: View = { yaw: 0, pitch: 4, fov: 20 };

export const NEUTRAL_JOINTS: Figure['joints'] = {
  shoulderL: [0, 0, 10], shoulderR: [0, 0, -10], elbowL: [-8, 0, 0], elbowR: [-8, 0, 0], hipL: [0, 0, 3], hipR: [0, 0, -3],
};

export function newFigure(partial: Partial<Figure> = {}): Figure {
  return {
    id: uid('f'),
    name: 'Figure',
    body: { ...DEFAULT_BODY },
    joints: structuredClone(NEUTRAL_JOINTS),
    hands: { L: cloneHand(RELAXED_HAND), R: cloneHand(RELAXED_HAND) },
    position: [0, 0, 0],
    grounded: true,
    ...partial,
  };
}

/** Joint angles of each stand-in posture (the root's turn is kept). */
export const POSTURE_JOINTS: Record<Posture, Figure['joints']> = {
  stand: { shoulderL: [0, 0, 8], shoulderR: [0, 0, -8] },
  sit: {
    hipL: [-88, 0, 4], hipR: [-88, 0, -4], kneeL: [88, 0, 0], kneeR: [88, 0, 0],
    shoulderL: [-22, 0, 8], shoulderR: [-22, 0, -8], elbowL: [-45, 0, 0], elbowR: [-45, 0, 0],
  },
  lie: { root: [-90, 0, 0], shoulderL: [0, 0, 8], shoulderR: [0, 0, -8] },
};

/** A capsule stand-in for blocking, in a posture. */
export function withPosture(f: Figure, posture: Posture): Figure {
  const p = POSTURE_JOINTS[posture];
  const yaw = f.joints.root?.[1] ?? 0;
  const root = p.root ?? [0, 0, 0];
  return { ...f, proxy: posture, joints: { ...structuredClone(p), ...(root[0] || yaw ? { root: [root[0], yaw, root[2]] } : {}) } };
}

export function newScene(name = 'New scene', figures: Figure[] = [newFigure()]): Scene {
  return { id: uid('s'), name, figures, props: [], view: { ...DEFAULT_VIEW } };
}

const PROP_DEFAULT_SCALE: Record<PropKind, Vec3> = {
  box: [0.5, 0.5, 0.5],
  sphere: [0.4, 0.4, 0.4],
  cylinder: [0.4, 0.6, 0.4],
  chair: [1, 1, 1],
  stool: [1, 1, 1],
  step: [1, 1, 1],
  wall: [2, 2.4, 1],
  stick: [1, 0.9, 1],
  phone: [1, 1, 1],
  cup: [1, 1, 1],
  book: [1, 1, 1],
};

export function newProp(kind: PropKind, position: Vec3 = [0.9, 0, 0], name: string = PROP_LABELS[kind]): Prop {
  return { id: uid('p'), name, kind, position, rotation: [0, 0, 0], scale: [...PROP_DEFAULT_SCALE[kind]] };
}

export function duplicateScene(s: Scene): Scene {
  const ids = new Map(s.figures.map((f) => [f.id, uid('f')]));
  const propIds = new Map(s.props.map((p) => [p.id, uid('p')]));
  const copy: Scene = {
    ...structuredClone(s),
    id: uid('s'),
    name: `${s.name} copy`,
    // Eyes stay on the copied figures and props.
    figures: s.figures.map((f) => {
      const copy = { ...structuredClone(f), id: ids.get(f.id)! };
      if (f.gaze) copy.gaze = 'figure' in f.gaze ? { figure: ids.get(f.gaze.figure) ?? f.gaze.figure } : { prop: propIds.get(f.gaze.prop) ?? f.gaze.prop };
      return copy;
    }),
    // Held props stay in the copied figures' hands.
    props: s.props.map((p) => ({
      ...structuredClone(p),
      id: propIds.get(p.id)!,
      ...(p.hold ? { hold: { ...p.hold, figure: ids.get(p.hold.figure) ?? p.hold.figure } } : {}),
    })),
  };
  if (s.animation) copy.animation = remapAnimation(s.animation, ids, propIds);
  return copy;
}

const mirrorVec = (r: Vec3): Vec3 => [r[0], r[1] === 0 ? 0 : -r[1], r[2] === 0 ? 0 : -r[2]];

/** Mirror a figure's pose left↔right (and its position across the centre line). */
export function mirrorFigure(f: Figure): Figure {
  const joints: Figure['joints'] = {};
  for (const [name, r] of Object.entries(f.joints) as [JointName, Vec3][]) joints[mirrorJointName(name)] = mirrorVec(r);
  return {
    ...f,
    joints,
    hands: { L: cloneHand(f.hands.R), R: cloneHand(f.hands.L) },
    position: [-f.position[0], f.position[1], f.position[2]],
  };
}

export function mirrorScene(s: Scene): Scene {
  const mirrorPose = (p: PoseKey): PoseKey => {
    const m = mirrorFigure({ ...newFigure(), ...p });
    return { joints: m.joints, position: m.position, hands: m.hands, grounded: p.grounded };
  };
  const mirrored: Scene = {
    ...s,
    figures: s.figures.map(mirrorFigure),
    props: s.props.map((p) => ({ ...p, position: [-p.position[0], p.position[1], p.position[2]], rotation: mirrorVec(p.rotation) })),
    view: { ...s.view, yaw: -s.view.yaw },
  };
  if (s.animation) {
    const a = mapPoses(s.animation, mirrorPose);
    if (a.camera) a.camera = { ...a.camera, keys: a.camera.keys.map((k) => ({ ...k, yaw: -k.yaw, pan: [-k.pan[0], k.pan[1]] })) };
    mirrored.animation = a;
  }
  return mirrored;
}

/** Copy one side of the body onto the other. */
export function symmetrize(f: Figure, from: Side): Figure {
  const joints = { ...f.joints };
  for (const j of JOINTS) {
    if (!j.endsWith(from)) continue;
    const r = f.joints[j];
    const other = mirrorJointName(j);
    if (r) joints[other] = mirrorVec(r);
    else delete joints[other];
  }
  // Centre joints become symmetric too.
  for (const j of ['root', 'spine', 'chest', 'neck', 'head'] as const) {
    const r = f.joints[j];
    if (r) joints[j] = [r[0], 0, 0];
  }
  const to: Side = from === 'L' ? 'R' : 'L';
  return { ...f, joints, hands: { ...f.hands, [to]: cloneHand(f.hands[from]) } };
}

/* ------------------------------------------------------------------ */
/* Parsing / validation (for localStorage, JSON import and share links) */

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const vec3 = (v: unknown, fallback: Vec3): Vec3 =>
  Array.isArray(v) && v.length === 3 ? [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2])] : [...fallback];
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.length <= 200 ? v : fallback);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJoints(v: unknown): Figure['joints'] {
  const out: Figure['joints'] = {};
  if (!isObj(v)) return out;
  for (const j of JOINTS) if (v[j] !== undefined) out[j] = vec3(v[j], [0, 0, 0]).map(wrapDeg) as Vec3;
  return out;
}

function parseHand(v: unknown): Hand {
  if (!isObj(v) || !Array.isArray(v.curl)) return cloneHand(RELAXED_HAND);
  const curl = FINGERS.map((_, i) => Math.min(1, Math.max(0, num((v.curl as unknown[])[i], RELAXED_HAND.curl[i])))) as Hand['curl'];
  return { curl, spread: Math.min(1, Math.max(0, num(v.spread, RELAXED_HAND.spread))) };
}

function parseView(v: unknown): View {
  if (!isObj(v)) return { ...DEFAULT_VIEW };
  return {
    yaw: wrapDeg(num(v.yaw, 0)),
    pitch: Math.min(89, Math.max(-89, num(v.pitch, DEFAULT_VIEW.pitch))),
    fov: Math.min(90, Math.max(5, num(v.fov, DEFAULT_VIEW.fov))),
  };
}

function parseFigure(v: unknown, i: number): Figure {
  const o = isObj(v) ? v : {};
  const hands = isObj(o.hands) ? o.hands : {};
  return {
    id: str(o.id, uid('f')),
    name: str(o.name, `Figure ${i + 1}`),
    body: clampBody(isObj(o.body) ? (o.body as Partial<Figure['body']>) : DEFAULT_BODY),
    joints: parseJoints(o.joints),
    hands: { L: parseHand(hands.L), R: parseHand(hands.R) },
    position: vec3(o.position, [0, 0, 0]),
    grounded: o.grounded !== false,
    ...(o.hidden === true ? { hidden: true } : {}),
    ...(POSTURES.includes(o.proxy as Posture) ? { proxy: o.proxy as Posture } : {}),
    ...(isObj(o.gaze) && typeof o.gaze.figure === 'string' ? { gaze: { figure: o.gaze.figure } }
      : isObj(o.gaze) && typeof o.gaze.prop === 'string' ? { gaze: { prop: o.gaze.prop } } : {}),
    ...(typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? { color: o.color.toLowerCase() } : {}),
  };
}

function parseProp(v: unknown): Prop | null {
  if (!isObj(v) || !PROP_KINDS.includes(v.kind as PropKind)) return null;
  const base = newProp(v.kind as PropKind);
  return {
    id: str(v.id, base.id),
    name: str(v.name, base.name).slice(0, 60),
    kind: base.kind,
    position: vec3(v.position, base.position),
    rotation: vec3(v.rotation, base.rotation),
    scale: vec3(v.scale, base.scale).map((s) => Math.min(20, Math.max(0.02, Math.abs(s)))) as Vec3,
    ...(isObj(v.hold) && typeof v.hold.figure === 'string' && (v.hold.hand === 'L' || v.hold.hand === 'R')
      ? { hold: { figure: v.hold.figure, hand: v.hold.hand } }
      : {}),
  };
}

export function parseScene(v: unknown, i = 0): Scene {
  if (!isObj(v) || !Array.isArray(v.figures)) throw new Error('Invalid scene');
  const figures = v.figures.slice(0, 12).map(parseFigure);
  if (!figures.length) figures.push(newFigure());
  const ids = new Set<string>();
  for (const f of figures) {
    if (ids.has(f.id)) f.id = uid('f');
    ids.add(f.id);
  }
  const scene: Scene = {
    id: str(v.id, uid('s')),
    name: str(v.name, `Scene ${i + 1}`),
    figures,
    props: (Array.isArray(v.props) ? v.props.slice(0, 100) : []).map(parseProp).filter((p): p is Prop => p !== null)
      .map((p) => (p.hold && !ids.has(p.hold.figure) ? { ...p, hold: undefined } : p)),
    view: parseView(v.view),
    ...(isObj(v.light) ? { light: clampLight(v.light as Partial<Light>) } : {}),
  };
  const animation = parseAnimation(v.animation, ids, parsePoseKey, new Set(scene.props.map((p) => p.id)), parsePropKey);
  if (animation) scene.animation = animation;
  return scene;
}

/** Saved poses from storage or a file. */
export function parsePoses(v: unknown): PoseAsset[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const poses = v.slice(0, 500).filter(isObj).map((o, i) => ({
    id: str(o.id, uid('pose')),
    name: str(o.name, `Pose ${i + 1}`).slice(0, 80),
    joints: parseJoints(o.joints),
    hands: { L: parseHand(isObj(o.hands) ? o.hands.L : undefined), R: parseHand(isObj(o.hands) ? o.hands.R : undefined) },
    view: parseView(o.view),
  }));
  return poses.length ? poses : undefined;
}

function parsePoseKey(v: unknown): PoseKey | null {
  if (!isObj(v)) return null;
  const hands = isObj(v.hands) ? v.hands : {};
  const turns = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x !== 0 ? Math.max(-4, Math.min(4, Math.round(x * 4) / 4)) : undefined);
  const spin = turns(v.spin);
  const flip = turns(v.flip);
  return {
    joints: parseJoints(v.joints),
    position: vec3(v.position, [0, 0, 0]),
    hands: { L: parseHand(hands.L), R: parseHand(hands.R) },
    grounded: v.grounded !== false,
    ...(TRAVELS.includes(v.travel as Travel) ? { travel: v.travel as Travel } : {}),
    ...(v.strafe === true ? { strafe: true } : {}),
    ...(spin ? { spin } : {}),
    ...(flip ? { flip } : {}),
  };
}

function parsePropKey(v: unknown): PropKey | null {
  if (!isObj(v)) return null;
  const hold = isObj(v.hold) && typeof v.hold.figure === 'string' && (v.hold.hand === 'L' || v.hold.hand === 'R')
    ? { figure: v.hold.figure, hand: v.hold.hand as Side }
    : undefined;
  return {
    position: vec3(v.position, [0, 0, 0]),
    rotation: vec3(v.rotation, [0, 0, 0]),
    ...(hold ? { hold } : {}),
    ...(v.release === true ? { release: true } : {}),
    ...(v.throw === true ? { throw: true } : {}),
  };
}

/** Accepts a v2 library, a v1 array of poses, or a single scene. Throws on unusable input. */
export function parseLibrary(data: unknown): Library {
  if (!isObj(data) || !Array.isArray(data.scenes)) throw new Error('Not a Pose Studio library');
  const entries: unknown[] = data.scenes;
  if (!entries.length) throw new Error('The file contains no scenes');
  const scenes = entries.slice(0, 500).map(parseScene);
  const ids = new Set<string>();
  for (const s of scenes) {
    if (ids.has(s.id)) s.id = uid('s');
    ids.add(s.id);
  }
  const board = parseBoard(data.board, ids);
  const poses = parsePoses(data.poses);
  const motions = parseMotions(data.motions);
  return { version: 2, scenes, ...(board ? { board } : {}), ...(poses ? { poses } : {}), ...(motions ? { motions } : {}) };
}

/** Imported motions: each a one-figure animated scene (anything unusable is dropped). */
export function parseMotions(v: unknown): MotionAsset[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const motions = v.slice(0, 100).filter(isObj).flatMap((o, i) => {
    try {
      const scene = parseScene(o.scene, i);
      if (!scene.animation || !scene.figures.length) return [];
      return [{ id: str(o.id, uid('motion')), name: str(o.name, `Motion ${i + 1}`).slice(0, 80), scene: { ...scene, figures: scene.figures.slice(0, 1), props: [] } }];
    } catch {
      return [];
    }
  });
  return motions.length ? motions : undefined;
}
