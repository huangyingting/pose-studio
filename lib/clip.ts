import { jointLimits, mirrorJointName, wrapDeg } from './joints';
import { angleToQuat, fromQuat, mirrorBones, nearer, quatToAngle, toQuat, turnBones } from './pose';
import { uid } from './uid';
import { EXTRA_BONES, JOINTS, type Bone, type Clip, type ClipInfo, type ClipPart, type ClipTrack, type Hand, type JointName, type Pose, type Side, type Vec3 } from './types';

/*
 * Clips: motion on the standard skeleton, stored as three.js AnimationClip / glTF tracks (one
 * set per part, that is per person). This module builds parts from poses, samples them at any
 * time and edits the keys of hand-keyed clips. Placing a clip in the world is lib/evaluate.ts.
 */

export const ROOT = 'hips.position';
export const GROUNDED = 'grounded';
export const boneTrack = (j: Bone) => `${j}.quaternion`;
export const handTrack = (s: Side) => `hands.${s}`;

type Interpolation = ClipTrack['interpolation'];

/** A part keyed with these poses (every track keyed at the same times). */
export function partFromPoses(name: string, keys: { t: number; pose: Pose }[], interpolation: Exclude<Interpolation, 'step'>, body?: ClipPart['body']): ClipPart {
  const times = keys.map((k) => Math.round(k.t * 1e6) / 1e6);
  const track = (n: string, values: (p: Pose) => number[], interp: Interpolation = interpolation): ClipTrack => ({ name: n, times: [...times], values: keys.flatMap((k) => values(k.pose)), interpolation: interp });
  const hand = (s: Side) => (p: Pose) => [...p.hands[s].curl, p.hands[s].spread];
  return {
    name,
    ...(body ? { body: { ...body } } : {}),
    tracks: [
      track(ROOT, (p) => p.position.map((v) => Math.round(v * 1e4) / 1e4 || 0)),
      ...JOINTS.map((j) => track(boneTrack(j), (p) => [...(p.bones[j] ?? [0, 0, 0, 1])])),
      // The bones beyond the mannequin's, where the poses have them (an imported motion's fingers, say).
      ...EXTRA_BONES.filter((b) => keys.some((k) => k.pose.bones[b])).map((b) => track(boneTrack(b), (p) => [...(p.bones[b] ?? [0, 0, 0, 1])], 'linear')),
      track(handTrack('L'), hand('L')),
      track(handTrack('R'), hand('R')),
      track(GROUNDED, (p) => [p.grounded ? 1 : 0], 'step'),
    ],
  };
}

/** A clip of poses keyed by hand (one part, smooth), e.g. the keys of an action. */
export function keysClip(keys: { t: number; pose: Pose }[], loop = false, duration = keys.length ? keys[keys.length - 1].t : 0): Clip {
  return { id: uid('clip'), name: 'Keys', duration, loop, parts: [partFromPoses('Keys', keys, 'smooth')], events: [], contacts: [] };
}

const trackOf = (part: ClipPart, name: string) => part.tracks.find((t) => t.name === name);

/** A part's key times (those of its root track). */
export const keyTimes = (part: ClipPart) => trackOf(part, ROOT)?.times ?? [];

/** The poses a part is keyed with, at its key times. */
export function partKeys(part: ClipPart): { t: number; pose: Pose }[] {
  return keyTimes(part).map((t, i) => ({ t, pose: keyPose(part, i) }));
}

/** The pose keyed at index i. */
export function keyPose(part: ClipPart, i: number): Pose {
  const at = (name: string, n: number) => trackOf(part, name)?.values.slice(i * n, i * n + n);
  const hand = (s: Side): Hand => {
    const v = at(handTrack(s), 6) ?? [0, 0, 0, 0, 0, 0];
    return { curl: v.slice(0, 5) as Hand['curl'], spread: v[5] };
  };
  const bones: Pose['bones'] = {};
  for (const j of [...JOINTS, ...extrasOf(part).map(([b]) => b)]) {
    const q = at(boneTrack(j), 4);
    if (q?.length === 4) bones[j] = q as [number, number, number, number];
  }
  return { bones, position: (at(ROOT, 3) ?? [0, 0, 0]) as Vec3, hands: { L: hand('L'), R: hand('R') }, grounded: (at(GROUNDED, 1)?.[0] ?? 1) > 0.5 };
}

/* ---------- sampling ---------- */

/** Cubic Hermite through p1→p2 with Catmull-Rom tangents from the neighbours (non-uniform times). */
export function hermite(p0: number, p1: number, p2: number, p3: number, t0: number, t1: number, t2: number, t3: number, t: number) {
  const h = t2 - t1;
  // A value held between two keys stays put (not drawn off by the keys around them).
  if (h <= 1e-9 || Math.abs(p2 - p1) < 1e-9) return p1;
  const u = (t - t1) / h;
  const m1 = t2 - t0 > 1e-9 ? ((p2 - p0) / (t2 - t0)) * h : 0;
  const m2 = t3 - t1 > 1e-9 ? ((p3 - p1) / (t3 - t1)) * h : 0;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
}

/**
 * The keys around time t: i1 → i2 is the segment containing t, i0 and i3 its neighbours, with
 * their times (shifted by the duration when wrapping a loop; mirrored at the ends otherwise).
 */
export function segment(times: number[], t: number, duration: number, loop: boolean) {
  const n = times.length;
  if (n === 1) return { i: [0, 0, 0, 0], t: [times[0], times[0], times[0], times[0]], time: t };
  if (loop && duration > 1e-9) {
    const at = (k: number) => ({ i: ((k % n) + n) % n, t: times[((k % n) + n) % n] + Math.floor(k / n) * duration });
    let time = ((t % duration) + duration) % duration;
    if (time < times[0]) time += duration;
    let k = 0;
    while (k < n - 1 && at(k + 1).t <= time) k++;
    const s = [at(k - 1), at(k), at(k + 1), at(k + 2)];
    return { i: s.map((x) => x.i), t: s.map((x) => x.t), time };
  }
  const time = Math.min(times[n - 1], Math.max(times[0], t));
  let k = 0;
  while (k < n - 2 && times[k + 1] <= time) k++;
  const t1 = times[k];
  const t2 = times[k + 1];
  return {
    i: [k > 0 ? k - 1 : k, k, k + 1, k + 2 < n ? k + 2 : k + 1],
    t: [k > 0 ? times[k - 1] : t1 - (t2 - t1), t1, t2, k + 2 < n ? times[k + 2] : t2 + (t2 - t1)],
    time,
  };
}

/** A smooth bone track's keys as joint angles, each read as the set nearest the key before it. */
const anglesCache = new WeakMap<ClipTrack, Vec3[]>();
function trackAngles(j: JointName, track: ClipTrack): Vec3[] {
  let out = anglesCache.get(track);
  if (!out) {
    out = [];
    for (let i = 0; i < track.times.length; i++) {
      const q = track.values.slice(i * 4, i * 4 + 4) as [number, number, number, number];
      out.push(quatToAngle(j, q, out[i - 1]));
    }
    anglesCache.set(track, out);
  }
  return out;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A rotation track's value at time t, turned the short way between its keys. */
function slerpTrack(track: ClipTrack, t: number, duration: number, loop: boolean): [number, number, number, number] {
  const seg = segment(track.times, t, duration, loop);
  const v = (i: number) => fromQuat(track.values.slice(i * 4, i * 4 + 4) as [number, number, number, number]);
  const u = seg.t[2] - seg.t[1] > 1e-9 && track.interpolation !== 'step' ? (seg.time - seg.t[1]) / (seg.t[2] - seg.t[1]) : 0;
  return toQuat(v(seg.i[1]).slerp(v(seg.i[2]), u));
}

/** One track's value at time t. */
function sampleTrack(track: ClipTrack, size: number, t: number, duration: number, loop: boolean, bone?: JointName): number[] {
  const { times, values } = track;
  if (!times.length) return [];
  const seg = segment(times, t, duration, loop);
  const [i0, i1, i2, i3] = seg.i;
  const v = (i: number) => values.slice(i * size, i * size + size);
  if (track.interpolation === 'step' || seg.t[2] - seg.t[1] <= 1e-9) return v(i1);
  const u = (seg.time - seg.t[1]) / (seg.t[2] - seg.t[1]);
  if (track.interpolation === 'linear') {
    if (bone) return toQuat(fromQuat(v(i1) as [number, number, number, number]).slerp(fromQuat(v(i2) as [number, number, number, number]), u));
    return v(i1).map((x, c) => x + (v(i2)[c] - x) * u);
  }
  const num = (p: number[]) => hermite(p[0], p[1], p[2], p[3], seg.t[0], seg.t[1], seg.t[2], seg.t[3], seg.time);
  if (!bone) return v(i1).map((_, c) => num([v(i0)[c], v(i1)[c], v(i2)[c], v(i3)[c]]));
  // Bones: in joint angles, the same rotation's two sets of angles read as the nearer each time.
  const ang = trackAngles(bone, track);
  const a1 = ang[i1];
  const a0 = nearer(bone, ang[i0], a1);
  const a2 = nearer(bone, ang[i2], a1);
  const a3 = nearer(bone, ang[i3], a2);
  const lim = jointLimits(bone);
  const out = [0, 1, 2].map((c) => {
    const p = [a0[c], a1[c], a2[c], a3[c]];
    const inside = (x: number) => x >= lim[c][0] && x <= lim[c][1];
    // Within a joint's range the direct path is the anatomical one (an arm swings forward over the
    // top rather than back through the shoulder); the body turns, and the rest, take the short way.
    if (bone !== 'hips' && inside(p[1]) && inside(p[2])) return num(p);
    const q2 = p[1] + wrapDeg(p[2] - p[1]);
    return wrapDeg(num([p[1] + wrapDeg(p[0] - p[1]), p[1], q2, q2 + wrapDeg(p[3] - p[2])]));
  }) as Vec3;
  return angleToQuat(bone, out);
}

/** A part's tracks of the bones beyond the mannequin's (most parts have none). */
const extraTracks = new WeakMap<ClipPart, [Bone, ClipTrack][]>();
function extrasOf(part: ClipPart) {
  let out = extraTracks.get(part);
  if (!out) {
    out = part.tracks.flatMap((tr): [Bone, ClipTrack][] => {
      const b = tr.name.endsWith('.quaternion') ? (tr.name.slice(0, -'.quaternion'.length) as Bone) : null;
      return b && (EXTRA_BONES as readonly string[]).includes(b) ? [[b, tr]] : [];
    });
    extraTracks.set(part, out);
  }
  return out;
}

/** A part's pose at time t (in the clip's own space). */
export function samplePart(part: ClipPart, t: number, duration: number, loop: boolean): Pose {
  const get = (name: string, size: number, bone?: JointName) => {
    const tr = trackOf(part, name);
    return tr ? sampleTrack(tr, size, t, duration, loop, bone) : null;
  };
  const bones: Pose['bones'] = {};
  for (const j of JOINTS) {
    const q = get(boneTrack(j), 4, j);
    if (q) bones[j] = q as [number, number, number, number];
  }
  // The bones beyond the mannequin's: turned the short way between keys.
  for (const [b, tr] of extrasOf(part)) bones[b] = slerpTrack(tr, t, duration, loop);
  const hand = (s: Side): Hand => {
    const v = get(handTrack(s), 6) ?? [0, 0, 0, 0, 0, 0];
    return { curl: v.slice(0, 5).map(clamp01) as Hand['curl'], spread: clamp01(v[5]) };
  };
  const p = get(ROOT, 3) ?? [0, 0, 0];
  return {
    bones,
    position: p.map((x) => Math.round(x * 1000) / 1000 || 0) as Vec3,
    hands: { L: hand('L'), R: hand('R') },
    grounded: (get(GROUNDED, 1)?.[0] ?? 1) > 0.5,
  };
}

/* ---------- editing keys ---------- */

/** The part with the pose keyed at time t (replacing a key within half a frame of it). */
export function setPartKey(part: ClipPart, t: number, pose: Pose, tolerance: number): ClipPart {
  const keys = partKeys(part).filter((k) => Math.abs(k.t - t) >= tolerance);
  keys.push({ t, pose });
  keys.sort((a, b) => a.t - b.t);
  return partFromPoses(part.name, keys, 'smooth', part.body);
}

/** The pose mirrored left ↔ right (across the plane x = 0). */
export function mirrorPose(p: Pose): Pose {
  return { ...p, bones: mirrorBones(p.bones), position: [-p.position[0] || 0, p.position[1], p.position[2]], hands: { L: { ...p.hands.R, curl: [...p.hands.R.curl] }, R: { ...p.hands.L, curl: [...p.hands.L.curl] } } };
}

/** A clip mirrored left ↔ right. */
export function mirrorClip(c: Clip): Clip {
  return {
    ...c,
    parts: c.parts.map((part) => {
      const keys = partKeys(part).map((k) => ({ t: k.t, pose: mirrorPose(k.pose) }));
      const interp = trackOf(part, ROOT)?.interpolation === 'linear' ? 'linear' : 'smooth';
      return partFromPoses(part.name, keys, interp, part.body);
    }),
    events: c.events.map((e) => (e.hand ? { ...e, hand: e.hand === 'L' ? 'R' : 'L' } : e)),
    contacts: c.contacts.map((x) => ({ ...x, bone: mirrorJointName(x.bone) })),
  };
}

/** A clip of keys in the world turned by `deg` about the vertical, its floor points moved by `place`. */
export function placeClip(c: Clip, deg: number, place: (x: number, z: number) => [number, number]): Clip {
  return {
    ...c,
    parts: c.parts.map((part) => {
      const keys = partKeys(part).map((k) => {
        const [x, z] = place(k.pose.position[0], k.pose.position[2]);
        return { t: k.t, pose: { ...k.pose, bones: turnBones(k.pose.bones, deg), position: [x, k.pose.position[1], z] as Vec3 } };
      });
      return partFromPoses(part.name, keys, trackOf(part, ROOT)?.interpolation === 'linear' ? 'linear' : 'smooth', part.body);
    }),
  };
}

/** What the library lists of an imported clip (its frames are kept apart). */
export const clipInfo = (c: Clip): ClipInfo => ({ id: c.id, name: c.name, duration: c.duration, loop: c.loop, people: c.parts.map((p) => p.name) });
