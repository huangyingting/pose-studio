// The Library's motions from motion-capture clips (Pose Studio's own format, as "Import motion…"
// makes them): each *.clip.json in data/library/motions (or the folder given) is made ready to play
// and copied to public/motions as <slug>.json with the id library:<slug>; public/motions/index.json
// lists them, each in a group of the Library's Motions. Run with `npm run motions`.
//
// Made ready: each person facing where they look and the wrists' roll the forearms' (lib/motionfix.ts,
// as any import); a motion that ends as it starts loops; one that is another mirrored is left out
// (an action plays mirrored); so are the halves of motions of two people (a motion is one person's).
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
import type { Clip, JointName } from '../lib/types';

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

/** Left out: one person's half of a motion of two (alone, it is not the motion). */
const HALVES = ['Shaking Hands 1', 'Shaking Hands 2', 'Hostage Situation Villain', 'Hostage Situation Hostage', 'Shoulder Throw Aggressor', 'Shoulder Throw Victim'];

// The group a motion goes in, by its name (the first that matches; Everyday otherwise).
const GROUPS: [RegExp, string][] = [
  [/danc|salsa|rumba/i, 'Dance'],
  [/flip|baseball|golf|football|soccer|capoeira|jump|landing/i, 'Sport & gymnastics'],
  [/punch|kick|jab|uppercut|hook|block|dodge|sword|death|hit reaction|aim|shoot|fight/i, 'Fighting'],
  [/walk|run|jog|sprint|strafe|stairs|ladder|turn/i, 'Getting around'],
];
const groupOf = (name: string) => GROUPS.find(([re]) => re.test(name))?.[1] ?? 'Everyday';
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

/* ---------- the library ---------- */

const read = async (file: string) => level(refineClip(parseClip(JSON.parse(await readFile(join(from, file), 'utf8')))!));
const files = (await readdir(from)).filter((f) => f.endsWith('.clip.json')).sort();
const clips = new Map<string, Clip>();
for (const f of files) {
  const clip = await read(f);
  clips.set(clip.name, clip);
}

const out: Clip[] = [];
for (const clip of clips.values()) {
  if (MIRRORED.includes(clip.name) || HALVES.includes(clip.name)) continue;
  out.push({ ...clip, name: NAMES[clip.name] ?? sentence(clip.name) });
}

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
const index: { id: string; name: string; duration: number; people: number; group: string; loop?: true; impact?: number }[] = [];
/**
 * When a strike lands (s): its hand or foot as far out from the hips as it goes (for scenes made
 * with it, the one struck reacting then: lib/films.ts).
 */
function impactOf(clip: Clip): number | undefined {
  if (!/kick|punch|jab|uppercut|cross|hook/i.test(clip.name)) return undefined;
  const part = clip.parts[0];
  let best = { t: 0, reach: 0 };
  for (let k = 0; k <= 60; k++) {
    const t = (clip.duration * k) / 60;
    const m = rig.model({ ...newFigure({ body: part.body }), ...samplePart(part, t, clip.duration, false) });
    const hips = m.joints.hips.getWorldPosition(new THREE.Vector3());
    for (const j of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const) {
      const p = m.joints[j].getWorldPosition(new THREE.Vector3());
      const reach = Math.hypot(p.x - hips.x, p.z - hips.z);
      if (reach > best.reach) best = { t, reach };
    }
  }
  return Math.round(best.t * 100) / 100;
}

for (const clip of out.sort((a, b) => a.name.localeCompare(b.name))) {
  const id = `library:${slug(clip.name)}`;
  if (index.some((m) => m.id === id)) throw new Error(`Two motions are called ${clip.name}`);
  const ready: Clip = { ...clip, id, loop: loops(clip) };
  await writeFile(join(to, `${slug(clip.name)}.json`), JSON.stringify(ready));
  index.push({
    id, name: ready.name, duration: ready.duration, people: ready.parts.length, group: groupOf(ready.name),
    ...(ready.loop ? { loop: true as const } : {}),
  });
  const impact = impactOf(ready);
  if (impact !== undefined) index[index.length - 1].impact = impact;
}
await writeFile(join(to, 'index.json'), JSON.stringify(index, null, 1) + '\n');
rig.dispose();
console.log(`${index.length} motions in ${to} (${index.filter((m) => m.loop).length} loop, ${MIRRORED.length} left out as mirrored, ${HALVES.length} halves of two people's)`);
