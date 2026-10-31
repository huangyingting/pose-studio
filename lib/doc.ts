import { DEFAULT_BODY, clampBody } from './body';
import { RELAXED_HAND, cloneHand } from './hands';
import { DEFAULT_FPS, MAX_DURATION, normalize, parseCameras, parseShots, remapAnimation, remapCameras } from './animation';
import { clipInfo } from './clip';
import { parseProjectSettings } from './project';
import { uid } from './uid';
import * as THREE from 'three';
import { mirrorJointName, sideOf, wrapDeg } from './joints';
import { anglesOf, bonesOf, facingOf, mirrorBones, toQuat, type Angles, type Bones, type Quat } from './pose';
import { parseLighting } from './lighting';
import { setById } from './sets';
import {
  BONES, FINGERS, HOLDERS, JOINTS, MARKER_COLORS, POSTURES, PROP_KINDS, PROP_LABELS, TRAVELS,
  type Action, type Animation, type Bone, type Camera, type Clip, type ClipInfo, type ClipPart, type ClipTrack, type Constraint, type ConstraintTarget, type Figure, type Holder, type Hand, type JointName, type Library, type Mark, type MarkerColor, type ModelInfo, type PoseAsset,
  type Posture, type Prop, type PropKind, type PropKey, type PropTarget, type Scene, type Side, type Travel, type Vec3, type View,
} from './types';

export { uid };

export const DEFAULT_VIEW: View = { yaw: 0, pitch: 4, fov: 20 };

/** A relaxed standing pose (joint angles). */
export const NEUTRAL_ANGLES: Angles = {
  leftUpperArm: [0, 0, 10], rightUpperArm: [0, 0, -10], leftLowerArm: [-8, 0, 0], rightLowerArm: [-8, 0, 0], leftUpperLeg: [0, 0, 3], rightUpperLeg: [0, 0, -3],
};

export function newFigure(partial: Partial<Figure> = {}): Figure {
  return {
    id: uid('f'),
    name: 'Figure',
    body: { ...DEFAULT_BODY },
    bones: bonesOf(NEUTRAL_ANGLES),
    hands: { L: cloneHand(RELAXED_HAND), R: cloneHand(RELAXED_HAND) },
    position: [0, 0, 0],
    grounded: true,
    ...partial,
  };
}

/** Joint angles of each stand-in posture (the hips' turn is kept). */
export const POSTURE_ANGLES: Record<Posture, Angles> = {
  stand: { leftUpperArm: [0, 0, 8], rightUpperArm: [0, 0, -8] },
  sit: {
    leftUpperLeg: [-88, 0, 4], rightUpperLeg: [-88, 0, -4], leftLowerLeg: [88, 0, 0], rightLowerLeg: [88, 0, 0],
    leftUpperArm: [-22, 0, 8], rightUpperArm: [-22, 0, -8], leftLowerArm: [-45, 0, 0], rightLowerArm: [-45, 0, 0],
  },
  lie: { hips: [-90, 0, 0], leftUpperArm: [0, 0, 8], rightUpperArm: [0, 0, -8] },
};

/** A stand-in for blocking, in a posture. */
export function withPosture(f: Figure, posture: Posture): Figure {
  const p = POSTURE_ANGLES[posture];
  const root = p.hips ?? [0, 0, 0];
  return { ...f, proxy: posture, bones: bonesOf({ ...p, hips: [root[0], facingOf(f.bones), root[2]] }) };
}

/**
 * A scene's first camera: everyone in a full shot from the front, a little above eye level,
 * kept in frame as they move.
 */
export function defaultCamera(name = 'Camera 1'): Camera {
  return { id: uid('cam'), name, kind: 'rig', rig: { yaw: 0, pitch: 4, size: 'fs', lens: 50 } };
}

/** A first camera seeing a scene from an angle (as a still is drawn from): everyone in a full shot. */
export function cameraFrom(view: View, name = 'Camera 1'): Camera {
  // The lens with that field of view on a 16:9 full-frame sensor (20.25 mm high).
  const lens = Math.round(10.125 / Math.tan((Math.min(170, Math.max(1, view.fov)) * Math.PI) / 360));
  return { ...defaultCamera(name), kind: 'rig', rig: { yaw: wrapDeg(view.yaw), pitch: view.pitch, size: 'fs', lens } };
}

export function newScene(name = 'New scene', figures: Figure[] = [newFigure()]): Scene {
  return { id: uid('s'), name, figures, props: [], cameras: [defaultCamera()] };
}

/** A scene with a camera, if it has none (a saved template opened): its shots filmed by it. */
export function ensureCamera(scene: Scene): Scene {
  if (scene.cameras.length) return scene;
  const cam = defaultCamera();
  const animation = scene.animation && { ...scene.animation, shots: [{ id: 'main', start: 0, name: 'Shot 1', camera: cam.id }] };
  return { ...scene, cameras: [cam], ...(animation ? { animation } : {}) };
}

const PROP_DEFAULT_SCALE: Record<PropKind, Vec3> = {
  box: [0.5, 0.5, 0.5],
  sphere: [0.4, 0.4, 0.4],
  cylinder: [0.4, 0.6, 0.4],
  chair: [1, 1, 1],
  stool: [1, 1, 1],
  step: [1, 1, 1],
  wall: [2, 2.4, 1],
  mat: [1, 1, 1],
  hoop: [1, 1, 1],
  bar: [1, 1.2, 1],
  ring: [1, 1, 1],
  ribbon: [1, 1, 1],
  stick: [1, 0.9, 1],
  phone: [1, 1, 1],
  cup: [1, 1, 1],
  book: [1, 1, 1],
};

export function newProp(kind: PropKind, position: Vec3 = [0.9, 0, 0], name: string = PROP_LABELS[kind]): Prop {
  return { id: uid('p'), name, kind, position, rotation: [0, 0, 0], scale: [...PROP_DEFAULT_SCALE[kind]] };
}

/** A name not used yet: "Chair", then "Chair 2", "Chair 3", … */
export function nextName(base: string, taken: string[]) {
  const stem = base.replace(/\s+\d+$/, '').trim() || base;
  const used = new Set(taken);
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n++) if (!used.has(`${stem} ${n}`)) return `${stem} ${n}`;
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
  Object.assign(copy, remapCameras(s, ids));
  if (s.animation) copy.animation = remapAnimation(s.animation, ids, propIds);
  return copy;
}

const mirrorVec = (r: Vec3): Vec3 => [r[0], r[1] === 0 ? 0 : -r[1], r[2] === 0 ? 0 : -r[2]];

/** Mirror a figure's pose left↔right (and its position across the centre line). */
export function mirrorFigure(f: Figure): Figure {
  return {
    ...f,
    bones: mirrorBones(f.bones),
    hands: { L: cloneHand(f.hands.R), R: cloneHand(f.hands.L) },
    position: [-f.position[0], f.position[1], f.position[2]],
  };
}

/** Copy one side of the body onto the other. */
export function symmetrize(f: Figure, from: Side): Figure {
  const was = anglesOf(f.bones);
  const joints = { ...was };
  for (const j of JOINTS) {
    if (sideOf(j) !== from) continue;
    const r = was[j];
    const other = mirrorJointName(j);
    if (r) joints[other] = mirrorVec(r);
    else delete joints[other];
  }
  // Centre joints become symmetric too.
  for (const j of ['spine', 'chest', 'neck', 'head'] as const) {
    const r = was[j];
    if (r) joints[j] = [r[0], 0, 0];
  }
  // The hips keep their turn (the way the figure faces).
  const h = was.hips;
  if (h) joints.hips = [h[0], h[1], 0];
  const to: Side = from === 'L' ? 'R' : 'L';
  return { ...f, bones: bonesOf(joints), hands: { ...f.hands, [to]: cloneHand(f.hands[from]) } };
}

/* ------------------------------------------------------------------ */
/* Parsing / validation (for localStorage, JSON import and share links) */

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const vec3 = (v: unknown, fallback: Vec3): Vec3 =>
  Array.isArray(v) && v.length === 3 ? [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2])] : [...fallback];
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.length <= 200 ? v : fallback);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Bone rotations: unit quaternions. */
function parseBones(o: Record<string, unknown>): Bones {
  if (!isObj(o.bones)) return {};
  const out: Bones = {};
  for (const j of BONES) {
    const q = o.bones[j];
    if (!Array.isArray(q) || q.length !== 4 || !q.every((x) => typeof x === 'number' && Number.isFinite(x))) continue;
    // Stored quaternions are rounded, so only a real error is normalised (saved poses read back unchanged).
    const len = Math.hypot(...(q as number[]));
    if (Math.abs(len - 1) < 1e-4) out[j] = toQuat(new THREE.Quaternion(...(q as Quat)));
    else if (len > 1e-6) out[j] = toQuat(new THREE.Quaternion(q[0] / len, q[1] / len, q[2] / len, q[3] / len));
  }
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
    bones: parseBones(o),
    hands: { L: parseHand(hands.L), R: parseHand(hands.R) },
    position: vec3(o.position, [0, 0, 0]),
    grounded: o.grounded !== false,
    ...(o.hidden === true ? { hidden: true } : {}),
    ...(o.still === true ? { still: true } : {}),
    ...(o.locked === true ? { locked: true } : {}),
    ...(o.muted === true ? { muted: true } : {}),
    ...(POSTURES.includes(o.proxy as Posture) ? { proxy: o.proxy as Posture } : {}),
    ...(isObj(o.gaze) && typeof o.gaze.figure === 'string' ? { gaze: { figure: o.gaze.figure } }
      : isObj(o.gaze) && typeof o.gaze.prop === 'string' ? { gaze: { prop: o.gaze.prop } } : {}),
    ...(typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? { color: o.color.toLowerCase() } : {}),
    ...(typeof o.model === 'string' && o.model ? { model: o.model.slice(0, 80) } : {}),
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
    ...(Array.isArray(v.handles) && v.handles.length ? { handles: v.handles.slice(0, 8).map((h) => vec3(h, [0, 0, 0])) } : {}),
    ...(isObj(v.physics) ? { physics: { bounce: Math.min(1, Math.max(0, num(v.physics.bounce, 0.3))), friction: Math.min(1, Math.max(0, num(v.physics.friction, 0.6))) } } : {}),
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
    cameras: parseCameras(v.cameras),
    ...(parseLighting(v.lighting) ? { lighting: parseLighting(v.lighting)! } : {}),
    ...(typeof v.set === 'string' && setById(v.set) ? { set: v.set } : {}),
    ...(typeof v.caption === 'string' && v.caption ? { caption: v.caption.slice(0, 500) } : {}),
    ...(v.offStory === true ? { offStory: true } : {}),
    ...(typeof v.hold === 'number' && Number.isFinite(v.hold) ? { hold: Math.min(60, Math.max(0.2, v.hold)) } : {}),
  };
  if (!scene.cameras.length) scene.cameras = [defaultCamera()];
  if (isObj(v.coverage) && typeof v.coverage.id === 'string' && isObj(v.coverage.roles)) {
    const roles = Object.entries(v.coverage.roles).filter((e): e is [string, string] => typeof e[1] === 'string' && ids.has(e[1])).slice(0, 8);
    scene.coverage = { id: v.coverage.id.slice(0, 40), roles: Object.fromEntries(roles), ...(v.coverage.live === true ? { live: true } : {}) };
  }
  const animation = parseAnimation(v.animation, ids, new Set(scene.props.map((p) => p.id)), scene.cameras.map((c) => c.id));
  if (animation) scene.animation = normalize(animation, figures);
  return scene;
}

/** Saved poses from storage or a file. */
export function parsePoses(v: unknown): PoseAsset[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const poses = v.slice(0, 500).filter(isObj).map((o, i) => ({
    id: str(o.id, uid('pose')),
    name: str(o.name, `Pose ${i + 1}`).slice(0, 80),
    bones: parseBones(o),
    hands: { L: parseHand(isObj(o.hands) ? o.hands.L : undefined), R: parseHand(isObj(o.hands) ? o.hands.R : undefined) },
    view: parseView(o.view),
  }));
  return poses.length ? poses : undefined;
}

function parsePropKey(v: unknown, t: number): PropKey | null {
  if (!isObj(v)) return null;
  const hold = isObj(v.hold) && typeof v.hold.figure === 'string' && (v.hold.hand === 'L' || v.hold.hand === 'R')
    ? { figure: v.hold.figure, hand: v.hold.hand as Side }
    : undefined;
  return {
    t,
    position: vec3(v.position, [0, 0, 0]),
    rotation: vec3(v.rotation, [0, 0, 0]),
    ...(hold ? { hold } : {}),
    ...(v.release === true ? { release: true } : {}),
  };
}

const turns = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x !== 0 ? Math.max(-4, Math.min(4, Math.round(x * 4) / 4)) : undefined);

function parseMark(v: unknown): Mark | undefined {
  if (!isObj(v) || !Array.isArray(v.at)) return undefined;
  return { at: [num(v.at[0], 0), num(v.at[1], 0)], facing: wrapDeg(num(v.facing, 0)) };
}

/** Values per time of a clip track (0: not a track we know). */
function trackSize(name: string) {
  if (name === 'hips.position') return 3;
  if (name === 'grounded') return 1;
  if (name === 'hands.L' || name === 'hands.R') return 6;
  const bone = name.endsWith('.quaternion') ? name.slice(0, -'.quaternion'.length) : '';
  return BONES.includes(bone as Bone) ? 4 : 0;
}

function parseTrack(v: unknown): ClipTrack | null {
  if (!isObj(v) || typeof v.name !== 'string' || !Array.isArray(v.times) || !Array.isArray(v.values)) return null;
  const size = trackSize(v.name);
  const times = v.times.slice(0, 20000);
  if (!size || !times.length || v.values.length !== times.length * size) return null;
  if (![...times, ...v.values].every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  if (times.some((t, i) => i > 0 && t < times[i - 1])) return null;
  let values = v.values as number[];
  if (size === 4) {
    values = values.slice();
    for (let i = 0; i < values.length; i += 4) {
      const len = Math.hypot(values[i], values[i + 1], values[i + 2], values[i + 3]);
      if (len < 1e-6) values.splice(i, 4, 0, 0, 0, 1);
      else if (Math.abs(len - 1) > 1e-4) for (let c = 0; c < 4; c++) values[i + c] /= len;
    }
  }
  const interpolation = v.interpolation === 'linear' || v.interpolation === 'step' ? v.interpolation : 'smooth';
  return { name: v.name, times: times as number[], values, interpolation: v.name === 'grounded' ? 'step' : interpolation };
}

/** A clip from storage or a file (anything unusable in it is dropped; null if nothing is left). */
export function parseClip(v: unknown): Clip | null {
  if (!isObj(v) || !Array.isArray(v.parts)) return null;
  const parts: ClipPart[] = v.parts.slice(0, 8).filter(isObj).map((p, i) => ({
    name: str(p.name, `Part ${i + 1}`).slice(0, 80),
    ...(isObj(p.body) ? { body: clampBody(p.body as Partial<Figure['body']>) } : {}),
    tracks: (Array.isArray(p.tracks) ? p.tracks.slice(0, 64) : []).map(parseTrack).filter((t): t is ClipTrack => t !== null),
    ...(Array.isArray(p.eases) ? { eases: p.eases.slice(0, 20000).map((e) => (e === 'linear' || e === 'step' ? e : 'smooth') as ClipTrack['interpolation']) } : {}),
    ...(typeof p.facing === 'number' && Number.isFinite(p.facing) ? { facing: Math.round(wrapDeg(p.facing) * 10) / 10 } : {}),
  })).filter((p) => p.tracks.some((t) => t.name === 'hips.position'));
  if (!parts.length) return null;
  const n = parts.length;
  return {
    id: str(v.id, uid('clip')).slice(0, 80),
    name: str(v.name, 'Motion').slice(0, 80),
    duration: Math.min(600, Math.max(0, num(v.duration, 0))),
    loop: v.loop === true,
    parts,
    events: (Array.isArray(v.events) ? v.events.slice(0, 500) : []).filter(isObj).flatMap((e) => {
      const part = Math.round(num(e.part, 0));
      if (part < 0 || part >= n || (e.kind !== 'release' && e.kind !== 'grab') || (e.hand !== 'L' && e.hand !== 'R')) return [];
      return [{ t: num(e.t, 0), part, kind: e.kind as 'release' | 'grab', hand: e.hand as Side }];
    }),
    contacts: (Array.isArray(v.contacts) ? v.contacts.slice(0, 2000) : []).filter(isObj).flatMap((c) => {
      const part = Math.round(num(c.part, 0));
      if (part < 0 || part >= n || !JOINTS.includes(c.bone as JointName)) return [];
      const on = isObj(c.on) && JOINTS.includes(c.on.bone as JointName) ? { part: Math.round(num(c.on.part, -1)), bone: c.on.bone as JointName } : null;
      if (on && (on.part < 0 || on.part >= n || on.part === part)) return [];
      return [{ part, bone: c.bone as JointName, start: num(c.start, 0), end: num(c.end, 0), ...(on ? { on } : {}) }];
    }),
  };
}

function parseTarget(v: unknown, figures: Set<string>, props: Set<string>): PropTarget | null {
  if (!isObj(v)) return null;
  if (Array.isArray(v.at)) return { at: [num(v.at[0], 0), num(v.at[1], 0)] };
  if (typeof v.figure === 'string' && figures.has(v.figure) && (v.hand === 'L' || v.hand === 'R')) return { figure: v.figure, hand: v.hand, ...(typeof v.rise === 'number' && Number.isFinite(v.rise) ? { rise: Math.min(10, Math.max(0, v.rise)) } : {}) };
  if (typeof v.hoop === 'string' && props.has(v.hoop)) return { hoop: v.hoop, ...(v.miss === true ? { miss: true } : {}) };
  if (v.bounce === true) return { bounce: true };
  return null;
}

/** The part of a motion an action plays (#22), seconds of it: `from` before `to`, both at 0 or more. */
function range(from: unknown, to: unknown): { from?: number; to?: number } {
  const a = typeof from === 'number' && Number.isFinite(from) && from > 0 ? Math.min(MAX_DURATION, from) : undefined;
  const b = typeof to === 'number' && Number.isFinite(to) && to > (a ?? 0) ? Math.min(MAX_DURATION, to) : undefined;
  return { ...(a !== undefined ? { from: Math.round(a * 1000) / 1000 } : {}), ...(b !== undefined ? { to: Math.round(b * 1000) / 1000 } : {}) };
}

function parseAction(v: unknown, figures: Set<string>, duration: number, props: Set<string>): Action | null {
  if (!isObj(v) || !Array.isArray(v.roles) || !isObj(v.source)) return null;
  const roles = v.roles.slice(0, 8).filter(isObj).map((r) => {
    const end = parseMark(r.end);
    return { figure: str(r.figure, ''), ...(end ? { end } : {}) };
  });
  if (!roles.length || roles.some((r) => !figures.has(r.figure)) || new Set(roles.map((r) => r.figure)).size < roles.length) return null;
  const o = v.source;
  let source: Action['source'];
  if (o.kind === 'clip' && typeof o.clip === 'string') {
    const speed = num(o.speed, 1);
    source = { kind: 'clip', clip: o.clip.slice(0, 80), ...(speed !== 1 ? { speed: Math.min(20, Math.max(0.05, speed)) } : {}), ...(o.mirror === true ? { mirror: true } : {}), ...(typeof o.repeat === 'number' && o.repeat >= 2 ? { repeat: Math.min(50, Math.round(o.repeat)) } : {}), ...range(o.from, o.to), ...(typeof o.seam === 'number' && Number.isFinite(o.seam) ? { seam: Math.min(2, Math.max(0, Math.round(o.seam * 100) / 100)) } : {}), ...(o.alternate === true ? { alternate: true } : {}), ...(o.inPlace === true ? { inPlace: true } : {}), ...(typeof o.loops === 'boolean' ? { loops: o.loops } : {}), ...(typeof o.lead === 'number' && o.lead > 0 ? { lead: Math.min(MAX_DURATION, Math.round(o.lead * 1000) / 1000) } : {}) };
  } else if (o.kind === 'keys') {
    const clip = parseClip(o.clip);
    if (!clip) return null;
    source = { kind: 'keys', clip: { ...clip, parts: clip.parts.slice(0, 1) } };
  } else if (o.kind === 'travel' && TRAVELS.includes(o.mode as Travel)) {
    const via = Array.isArray(o.via) ? o.via.slice(0, 50).map(parseMark).filter((m): m is Mark => !!m) : [];
    const [spin, flip] = [turns(o.spin), turns(o.flip)];
    source = { kind: 'travel', mode: o.mode as Travel, ...(o.strafe === true ? { strafe: true } : {}), ...(spin ? { spin } : {}), ...(flip ? { flip } : {}), ...(via.length ? { via } : {}), ...(o.mode !== 'jump' && typeof o.gait === 'string' && o.gait ? { gait: o.gait.slice(0, 80) } : {}) };
  } else return null;
  if (source.kind !== 'keys' && roles.length > 1 && source.kind === 'travel') return null;
  const start = Math.min(duration, Math.max(0, num(v.start, 0)));
  const blendIn = num(v.blendIn, 0);
  const target = parseTarget(v.target, figures, props);
  return {
    id: str(v.id, uid('act')).slice(0, 40),
    start,
    duration: Math.min(MAX_DURATION - start, Math.max(0, num(v.duration, 0))),
    ...(blendIn > 0 ? { blendIn: Math.min(10, blendIn) } : {}),
    ...(v.blendCurve === 'linear' || v.blendCurve === 'in' || v.blendCurve === 'out' ? { blendCurve: v.blendCurve } : {}),
    ...(typeof v.strength === 'number' && v.strength >= 0 && v.strength < 1 ? { strength: Math.round(v.strength * 100) / 100 } : {}),
    ...(v.mask === 'arms' || v.mask === 'head' || v.mask === 'legs' ? { mask: v.mask } : {}),
    ...(typeof v.reactsTo === 'string' && v.reactsTo ? { reactsTo: v.reactsTo.slice(0, 40) } : {}),
    ...(v.layer === 'correction' || v.layer === 'upper' ? { layer: v.layer } : {}),
    roles,
    source,
    ...(typeof v.prop === 'string' && props.has(v.prop) ? { prop: v.prop } : {}),
    ...(target ? { target } : {}),
  };
}

function parseConstraint(v: unknown, figures: Set<string>, props: Set<string>, duration: number): Constraint | null {
  if (!isObj(v) || !figures.has(v.figure as string) || !HOLDERS.includes(v.bone as Holder) || !isObj(v.target)) return null;
  const o = v.target;
  const target: ConstraintTarget | null = typeof o.figure === 'string' ? (figures.has(o.figure) && JOINTS.includes(o.bone as JointName) ? { figure: o.figure, bone: o.bone as JointName, at: vec3(o.at, [0, 0, 0]) } : null)
    : typeof o.prop === 'string' ? (props.has(o.prop) ? { prop: o.prop, at: vec3(o.at, [0, 0, 0]) } : null)
    : Array.isArray(o.point) ? { point: vec3(o.point, [0, 0, 0]) } : null;
  if (!target) return null;
  const start = Math.min(duration, Math.max(0, num(v.start, 0)));
  return { id: str(v.id, uid('hold')).slice(0, 40), figure: v.figure as string, bone: v.bone as Holder, target, start, end: Math.min(MAX_DURATION, Math.max(start, num(v.end, start))) };
}

export function parseAnimation(v: unknown, figures: Set<string>, propIds: Set<string>, cameras: string[]): Animation | undefined {
  if (!isObj(v)) return undefined;
  const duration = Math.min(MAX_DURATION, Math.max(0.2, num(v.duration, 2)));
  const fps = Math.round(Math.min(60, Math.max(4, num(v.fps, DEFAULT_FPS))));
  const loop = v.loop !== false;
  const actions = (Array.isArray(v.actions) ? v.actions.slice(0, 2000) : []).map((x) => parseAction(x, figures, duration, propIds)).filter((x): x is Action => x !== null);
  const props: Record<string, PropKey[]> = {};
  if (isObj(v.props)) {
    for (const [id, keys] of Object.entries(v.props)) {
      if (!propIds.has(id) || !Array.isArray(keys)) continue;
      const list = keys.slice(0, 2000).filter(isObj).map((k) => parsePropKey(k, Math.min(duration, Math.max(0, num(k.t, 0))))).filter((k): k is PropKey => k !== null);
      if (list.length) props[id] = list;
    }
  }
  for (const list of Object.values(props)) list.sort((p, q) => p.t - q.t);
  if (!actions.length && !Object.keys(props).length) return undefined;
  const holds = (Array.isArray(v.constraints) ? v.constraints.slice(0, 500) : []).map((c) => parseConstraint(c, figures, propIds, duration)).filter((c): c is Constraint => c !== null);
  const anim: Animation = {
    duration, fps, loop, actions, ...(Object.keys(props).length ? { props } : {}), ...(holds.length ? { constraints: holds } : {}),
    shots: parseShots(v.shots, duration, cameras),
  };
  // (Beats on the ruler, #22: within it, each its own id.)
  const ids = new Set<string>();
  const markers = (Array.isArray(v.markers) ? v.markers.slice(0, 200) : []).filter(isObj).flatMap((m) => {
    let id = str(m.id, '').slice(0, 40) || uid('mark');
    if (ids.has(id)) id = uid('mark');
    ids.add(id);
    return typeof m.t === 'number' && Number.isFinite(m.t) ? [{ id, t: Math.round(Math.min(duration, Math.max(0, m.t)) * 1000) / 1000, name: str(m.name, '').slice(0, 60), ...((MARKER_COLORS as readonly unknown[]).includes(m.color) ? { color: m.color as MarkerColor } : {}) }] : [];
  }).sort((p, q) => p.t - q.t);
  if (markers.length) anim.markers = markers;
  const r = isObj(v.range) ? v.range : null;
  if (r && typeof r.from === 'number' && typeof r.to === 'number' && Number.isFinite(r.from) && Number.isFinite(r.to) && r.to - r.from >= 0.1) {
    anim.range = { from: Math.max(0, Math.min(duration, r.from)), to: Math.max(0, Math.min(duration, r.to)) };
    if (anim.range.to - anim.range.from < 0.1) delete anim.range;
  }
  return anim;
}


/** A template's scene keeps no cameras, coverage or cuts. */
function bareTemplate(scene: Scene): Scene {
  const { coverage: _c, ...rest } = scene;
  void _c;
  return { ...rest, cameras: [], ...(scene.animation ? { animation: { ...scene.animation, shots: [] } } : {}) };
}

/** Accepts a library, or throws on unusable input. */
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
  const settings = parseProjectSettings(data.settings);
  const poses = parsePoses(data.poses);
  // What the imported clips are (a file has their frames too: clipsIn).
  const clips = (Array.isArray(data.clips) ? data.clips : []).slice(0, 500).flatMap((c) => parseClipInfo(c) ?? []);
  const models = (Array.isArray(data.models) ? data.models : []).slice(0, 200).flatMap((m) => parseModelInfo(m) ?? []);
  const templates = (Array.isArray(data.templates) ? data.templates : []).slice(0, 200).filter(isObj).map((t, i) => ({
    id: typeof t.id === 'string' && t.id ? t.id.slice(0, 40) : uid('tpl'),
    name: typeof t.name === 'string' && t.name ? t.name.slice(0, 80) : `Template ${i + 1}`,
    scene: bareTemplate(parseScene(t.scene, i)),
  }));
  // Shoot presets: a template and a coverage, by id (lib/templates.ts shootsOf leaves out those missing).
  const shoots = (Array.isArray(data.shoots) ? data.shoots : []).slice(0, 200).filter(isObj)
    .filter((p) => typeof p.template === 'string' && typeof p.coverage === 'string')
    .map((p, i) => ({
      id: typeof p.id === 'string' && p.id ? p.id.slice(0, 40) : uid('shoot'),
      name: typeof p.name === 'string' && p.name ? p.name.slice(0, 80) : `Shoot ${i + 1}`,
      template: (p.template as string).slice(0, 40),
      coverage: (p.coverage as string).slice(0, 40),
      ...(typeof p.duration === 'number' && Number.isFinite(p.duration) ? { duration: Math.min(60, Math.max(1, p.duration)) } : {}),
    }));
  return {
    version: 3, scenes, ...(settings ? { settings } : {}), ...(poses ? { poses } : {}), ...(clips.length ? { clips } : {}), ...(models.length ? { models } : {}),
    ...(templates.length ? { templates } : {}), ...(shoots.length ? { shoots } : {}),
  };
}

function parseModelInfo(v: unknown): ModelInfo | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id || !isObj(v.bones)) return null;
  const bones: ModelInfo['bones'] = {};
  for (const b of BONES) if (typeof v.bones[b] === 'string') bones[b] = (v.bones[b] as string).slice(0, 200);
  // A thumbnail is a small PNG drawn on import.
  const thumb = typeof v.thumb === 'string' && v.thumb.startsWith('data:image/png;base64,') && v.thumb.length < 200_000 ? v.thumb : null;
  const credit = typeof v.credit === 'string' && v.credit ? v.credit.slice(0, 160) : null;
  return { id: v.id.slice(0, 80), name: str(v.name, 'Character').slice(0, 80), format: v.format === 'fbx' ? 'fbx' : 'glb', bones, ...(thumb ? { thumb } : {}), ...(credit ? { credit } : {}) };
}

function parseClipInfo(v: unknown): ClipInfo | null {
  if (!isObj(v)) return null;
  if (Array.isArray(v.parts)) {
    const c = parseClip(v);
    return c && clipInfo(c);
  }
  if (typeof v.id !== 'string' || !v.id) return null;
  const people = (Array.isArray(v.people) ? v.people : []).slice(0, 8).map((p, i) => str(p, `Part ${i + 1}`).slice(0, 80));
  return { id: v.id.slice(0, 80), name: str(v.name, 'Motion').slice(0, 80), duration: Math.min(600, Math.max(0, num(v.duration, 0))), loop: v.loop === true, people: people.length ? people : ['Part 1'] };
}

/** The imported clips whose frames a saved library file carries. */
export function clipsIn(data: unknown): Clip[] {
  if (!isObj(data)) return [];
  return Array.isArray(data.clips) ? data.clips.slice(0, 500).map(parseClip).filter((c): c is Clip => c !== null) : [];
}
