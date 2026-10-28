// The Library's motions from motion-capture clips (Pose Studio's own format, as "Import motion…"
// makes them): each *.clip.json in data/library/motions (or the folder given) is made ready to play
// and copied to public/motions as <slug>.json with the id library:<slug>; public/motions/index.json
// lists them, each in a group of the Library's Motions. Run with `npm run motions`.
//
// Made ready: each person facing where they look and the wrists' roll the forearms' (lib/motionfix.ts,
// as any import); a motion that ends as it starts loops; one that is another mirrored is left out
// (an action plays mirrored); the two halves of a motion of two people are one motion, the second
// placed where the hands meet the other and the bodies do not go through each other.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as THREE from 'three';
import { samplePart } from '../lib/clip';
import { newFigure, parseClip } from '../lib/doc';
import { DEFAULT_BODY } from '../lib/body';
import { legsOf } from '../lib/locomotion';
import { refineClip } from '../lib/motionfix';
import { facingOf } from '../lib/pose';
import { Rig } from '../lib/relations';
import { JOINTS, type Clip, type ClipPart, type JointName, type Pose } from '../lib/types';

const from = process.argv[2] ?? 'data/library/motions';
const to = 'public/motions';

/** Left out: the same as another mirrored (that one, mirrored, does it the other way). */
const MIRRORED = ['Walk Right', 'Strafe Right', 'Turn 90 Right'];

/** Names clearer than the files' (the rest only in sentence case). */
const NAMES: Record<string, string> = {
  'Walk Left': 'Walk sideways',
  'Strafe Left': 'Strafe',
  'Turn 90 Left': 'Turn 90°',
  'Laying Idle': 'Lying idle',
  'Head Nod Yes': 'Nod yes',
  'Shaking Head No': 'Shake head no',
  'Receive Punch To The Face': 'Punched in the face',
  'Stand Up': 'Stand up, slow',
  'Crouch To Stand': 'Get up from one knee',
  'Jab Cross': 'Jab, cross',
};

const HANDS: JointName[] = ['leftHand', 'rightHand'];
const ARMS: JointName[] = ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'];

/**
 * Two people's halves of one motion: the lead's, then the other's, and where they touch (a joint
 * of the lead's `a` near one of the other's `b`) while they do.
 */
const PAIRS: { name: string; lead: string; other: string; touch: { a: JointName[]; b: JointName[] }[]; facing?: 'each other'; apart?: number }[] = [
  // (Two people's own handshakes, the one put across from the other.)
  { name: 'Handshake', lead: 'Shaking Hands 1', other: 'Shaking Hands 2', touch: [{ a: ['rightHand'], b: ['rightHand'] }], facing: 'each other', apart: 0.6 },
  { name: 'Hostage', lead: 'Hostage Situation Villain', other: 'Hostage Situation Hostage', touch: [{ a: HANDS, b: ['neck', 'chest', 'head'] }, { a: ARMS, b: HANDS }] },
  { name: 'Shoulder throw', lead: 'Shoulder Throw Aggressor', other: 'Shoulder Throw Victim', touch: [{ a: HANDS, b: [...ARMS, 'chest', 'neck'] }] },
];

// The group a motion goes in, by its name (the first that matches; Everyday otherwise).
const GROUPS: [RegExp, string][] = [
  [/danc|salsa|rumba/i, 'Dance'],
  [/flip|baseball|golf|football|soccer|capoeira|jump|landing/i, 'Sport & gymnastics'],
  [/punch|kick|jab|uppercut|hook|block|dodge|sword|death|hit reaction|aim|shoot|fight/i, 'Fighting'],
  [/walk|run|jog|sprint|strafe|stairs|ladder|turn/i, 'Getting around'],
];
const groupOf = (name: string, people: number) => (people > 1 ? 'Together' : GROUPS.find(([re]) => re.test(name))?.[1] ?? 'Everyday');
const slug = (name: string) => name.toLowerCase().replace(/°/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sentence = (name: string) => name.charAt(0) + name.slice(1).toLowerCase();

const rig = new Rig();
const round = (v: number) => Math.round(v * 1000) / 1000;

const quatAngle = (a: number[], b: number[]) => (2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180) / Math.PI;

/** A walk, run or the like (not a turn): going round carries on from where it got to. */
const isCycle = (name: string) => /walk|run|jog|sprint|strafe/i.test(name) && !/turn/i.test(name);

/**
 * Whether a clip ends as it starts (each joint within 3°, the hips' height within 2 cm) and where
 * it starts (a dodge, a turn does not: done once), or goes on from there as a walk does: it can go round.
 */
function loops(clip: Clip): boolean {
  return clip.parts.every((p) => {
    const a = samplePart(p, 0, clip.duration, false), b = samplePart(p, clip.duration, clip.duration, false);
    if (Math.abs(a.position[1] - b.position[1]) > 0.02) return false;
    const there = Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]) < 0.05 && Math.abs(facingOf(b.bones) - facingOf(a.bones)) < 5;
    if (!there && !isCycle(clip.name)) return false;
    return Object.entries(a.bones).every(([j, q]) => j === 'hips' || !q || !b.bones[j as JointName] || quatAngle(q, b.bones[j as JointName]!) < 3);
  });
}

/**
 * A walk or run cycle level: captured, its hips often sink or rise a few centimetres over a cycle
 * (and its feet with them, on the floor only at its lowest); taken out evenly, its feet on the
 * floor all the way, so that it goes round without a jump.
 */
function level(clip: Clip): Clip {
  if (!isCycle(clip.name)) return clip;
  const parts = clip.parts.map((part) => {
    const t = part.tracks.find((x) => x.name === 'hips.position');
    if (!t) return part;
    const v = [...t.values];
    const drift = v[v.length - 2] - v[1];
    for (let i = 0; i < t.times.length; i++) v[i * 3 + 1] -= (drift * t.times[i]) / clip.duration;
    // Its feet as low as they go on the floor (at the ankle's height).
    let low = Infinity;
    const levelled = { ...part, tracks: part.tracks.map((x) => (x === t ? { ...t, values: v } : x)) };
    for (let k = 0; k <= 30; k++) {
      const m = rig.model({ ...newFigure({ body: part.body }), ...samplePart(levelled, (clip.duration * k) / 30, clip.duration, false) });
      low = Math.min(low, m.joints.leftFoot.getWorldPosition(new THREE.Vector3()).y, m.joints.rightFoot.getWorldPosition(new THREE.Vector3()).y);
    }
    const up = legsOf(part.body ?? DEFAULT_BODY).ankleY - low;
    for (let i = 0; i < t.times.length; i++) v[i * 3 + 1] = round(v[i * 3 + 1] + up);
    return levelled;
  });
  return { ...clip, parts };
}

/* ---------- two people's halves as one motion ---------- */

const TORSO: JointName[] = ['hips', 'spine', 'chest', 'head'];

/** Where a part's joints are over its clip (FRAMES times), in the clip's own space. */
function jointsOver(clip: Clip, part: ClipPart, frames: number) {
  return Array.from({ length: frames }, (_, k) => {
    const pose: Pose = samplePart(part, (clip.duration * k) / (frames - 1), clip.duration, false);
    const m = rig.model({ ...newFigure({ body: part.body }), ...pose });
    return Object.fromEntries(JOINTS.map((j) => [j, m.joints[j].getWorldPosition(new THREE.Vector3())])) as Record<JointName, THREE.Vector3>;
  });
}

/**
 * Where the other stands to the lead (turned by `turn` degrees, then moved by dx, dz): where they
 * touch as near as they get while they do (the closest fifth of the frames), and the bodies never
 * nearer than `apart` (through each other, or closer than people stand).
 */
function placeOther(clip: Clip, lead: ClipPart, other: ClipPart, touch: { a: JointName[]; b: JointName[] }[], facing?: 'each other', apart = 0.3) {
  const N = 24;
  const a = jointsOver(clip, lead, N), b = jointsOver(clip, other, N);
  const cost = (turn: number, dx: number, dz: number) => {
    const r = (turn * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const at = (v: THREE.Vector3) => [v.x * c + v.z * s + dx, v.y, -v.x * s + v.z * c + dz];
    const near: number[] = [];
    let through = 0;
    for (let k = 0; k < N; k++) {
      const bk = Object.fromEntries(JOINTS.map((j) => [j, at(b[k][j])])) as Record<JointName, number[]>;
      const d = (p: THREE.Vector3, q: number[]) => Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]);
      // How near each contact is: its nearest pair of joints.
      near.push(touch.reduce((sum, t) => sum + Math.min(...t.a.flatMap((x) => t.b.map((y) => d(a[k][x], bk[y])))), 0));
      for (const p of TORSO) for (const q of TORSO) through += Math.max(0, apart - d(a[k][p], bk[q])) ** 2;
    }
    const closest = near.sort((x, y) => x - y).slice(0, Math.ceil(N * 0.2));
    return closest.reduce((x, y) => x + y, 0) / closest.length + (200 * through) / N;
  };
  let best = { turn: 0, dx: 0, dz: 1, cost: Infinity };
  const search = (turns: number[], xs: number[], zs: number[]) => {
    for (const turn of turns) for (const dx of xs) for (const dz of zs) {
      const c = cost(turn, dx, dz);
      if (c < best.cost) best = { turn, dx, dz, cost: c };
    }
  };
  const range = (lo: number, hi: number, step: number) => Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  // (Facing each other: turned to look back at the lead, within 20°.)
  const across = (((lead.facing ?? 0) + 180 - (other.facing ?? 0)) % 360 + 360) % 360;
  search(facing ? range(across - 20, across + 20, 5) : range(0, 345, 15), range(-5, 5, 0.1), range(-5, 5, 0.1));
  const { turn, dx, dz } = best;
  search(range(turn - 12, turn + 12, 3), range(dx - 0.1, dx + 0.1, 0.025), range(dz - 0.1, dz + 0.1, 0.025));
  return best;
}

/** A part turned by `turn` degrees about the clip's origin, then moved by dx, dz. */
function moved(part: ClipPart, turn: number, dx: number, dz: number): ClipPart {
  const r = (turn * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
  const tracks = part.tracks.map((t) => {
    if (t.name === 'hips.position') {
      const v = [...t.values];
      for (let i = 0; i < v.length; i += 3) [v[i], v[i + 2]] = [round(v[i] * c + v[i + 2] * s + dx), round(-v[i] * s + v[i + 2] * c + dz)];
      return { ...t, values: v };
    }
    if (t.name === 'hips.quaternion') {
      const v = [...t.values];
      for (let i = 0; i < v.length; i += 4) yaw.clone().multiply(new THREE.Quaternion(v[i], v[i + 1], v[i + 2], v[i + 3])).toArray(v, i);
      return { ...t, values: v.map((x) => Math.round(x * 1e5) / 1e5) };
    }
    return t;
  });
  return { ...part, tracks, facing: Math.round((((part.facing ?? 0) + turn + 540) % 360) - 180) };
}
/* ---------- the library ---------- */

const read = async (file: string) => level(refineClip(parseClip(JSON.parse(await readFile(join(from, file), 'utf8')))!));
const files = (await readdir(from)).filter((f) => f.endsWith('.clip.json')).sort();
const clips = new Map<string, Clip>();
for (const f of files) {
  const clip = await read(f);
  clips.set(clip.name, clip);
}

const out: Clip[] = [];
const paired = new Set(PAIRS.flatMap((p) => [p.lead, p.other]));
for (const pair of PAIRS) {
  const lead = clips.get(pair.lead), other = clips.get(pair.other);
  if (!lead || !other) throw new Error(`Missing a half of ${pair.name}`);
  const duration = Math.min(lead.duration, other.duration);
  const clip = { ...lead, duration };
  const p = placeOther(clip, lead.parts[0], other.parts[0], pair.touch, pair.facing, pair.apart);
  console.log(`${pair.name}: the other turned ${p.turn}°, at ${p.dx.toFixed(2)}, ${p.dz.toFixed(2)} (cost ${p.cost.toFixed(3)})`);
  out.push({
    ...clip,
    name: pair.name,
    parts: [{ ...lead.parts[0], name: pair.lead }, { ...moved(other.parts[0], p.turn, p.dx, p.dz), name: pair.other }],
    contacts: [...lead.contacts, ...other.contacts.map((c) => ({ ...c, part: 1 }))],
  });
}
for (const clip of clips.values()) {
  if (MIRRORED.includes(clip.name) || paired.has(clip.name)) continue;
  out.push({ ...clip, name: NAMES[clip.name] ?? sentence(clip.name) });
}

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
const index: { id: string; name: string; duration: number; people: number; group: string; loop?: true }[] = [];
for (const clip of out.sort((a, b) => a.name.localeCompare(b.name))) {
  const id = `library:${slug(clip.name)}`;
  if (index.some((m) => m.id === id)) throw new Error(`Two motions are called ${clip.name}`);
  const ready: Clip = { ...clip, id, loop: loops(clip) };
  await writeFile(join(to, `${slug(clip.name)}.json`), JSON.stringify(ready));
  index.push({ id, name: ready.name, duration: ready.duration, people: ready.parts.length, group: groupOf(ready.name, ready.parts.length), ...(ready.loop ? { loop: true } : {}) });
}
await writeFile(join(to, 'index.json'), JSON.stringify(index, null, 1) + '\n');
rig.dispose();
console.log(`${index.length} motions in ${to} (${index.filter((m) => m.loop).length} loop, ${MIRRORED.length} left out as mirrored, ${PAIRS.length} of two people)`);
