// The Library's motions from motion-capture clips (Pose Studio's own format, as "Import motion…"
// makes them): each *.clip.json in data/library/motions (or the folder given) is made ready to play
// and copied to public/motions as <slug>.json with the id library:<slug>; public/motions/index.json
// lists them, each with its name and group in the Library's Motions (LIST). Run with `npm run motions`.
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
import { strikeTime } from '../lib/strike';
import { facingOf } from '../lib/pose';
import { Rig } from '../lib/relations';
import type { MOTION_GROUPS } from '../lib/motions';
import type { Clip, JointName } from '../lib/types';

type MotionGroup = (typeof MOTION_GROUPS)[number];

const from = process.argv[2] ?? 'data/library/motions';
const to = 'public/motions';

/** Left out: the same as another mirrored (that one, mirrored, does it the other way). */
const MIRRORED = ['Walk Right', 'Strafe Right', 'Turn 90 Right'];

/** Left out: one person's half of a motion of two (alone, it is not the motion). */
const HALVES = ['Shaking Hands 1', 'Shaking Hands 2', 'Hostage Situation Villain', 'Hostage Situation Hostage', 'Shoulder Throw Aggressor', 'Shoulder Throw Victim'];

/**
 * Each motion's name in the Library and its group, by what the person does (one holding a gun is
 * with the weapons, one handling a thing with the things), by its file's name. Its id is the file's
 * name (library:<the file's name>), whatever it is called.
 */
const LIST: Record<string, [string, MotionGroup]> = {
  'Walk': ['Walk', 'Moving'],
  'Walk Forward': ['Walk, brisk', 'Moving'],
  'Walk Backward': ['Walk backward', 'Moving'],
  'Walk Left': ['Walk sideways', 'Moving'],
  'Happy Walk': ['Walk, happy', 'Moving'],
  'Crouch Walk Forward': ['Sneak, crouched', 'Moving'],
  'Jog Forward': ['Jog', 'Moving'],
  'Run Forward': ['Run', 'Moving'],
  'Run Backward': ['Run backward', 'Moving'],
  'Sprint': ['Sprint', 'Moving'],
  'Strafe Left': ['Strafe', 'Moving'],
  'Turn 90 Left': ['Turn 90°', 'Moving'],
  'Walking Turn 180': ['Turn around, walking', 'Moving'],
  'Ascending Stairs': ['Walk up stairs', 'Moving'],
  'Descending Stairs': ['Walk down stairs', 'Moving'],
  'Climbing Ladder': ['Climb a ladder', 'Moving'],
  'Idle': ['Stand, idle', 'Standing & waiting'],
  'Standing Idle': ['Stand, shifting weight', 'Standing & waiting'],
  'Breathing Idle': ['Stand, breathing', 'Standing & waiting'],
  'Bored': ['Bored', 'Standing & waiting'],
  'Look Around': ['Look around', 'Standing & waiting'],
  'Leaning On A Wall': ['Lean on a wall', 'Standing & waiting'],
  'Yawn': ['Yawn', 'Standing & waiting'],
  'Sitting Idle': ['Sit, idle', 'Sitting & lying'],
  'Stand To Sit': ['Sit down on a chair', 'Sitting & lying'],
  'Sit To Stand': ['Get up from a chair', 'Sitting & lying'],
  'Sit To Type': ['Sit down to type', 'Sitting & lying'],
  'Crouch Idle': ['Crouch', 'Sitting & lying'],
  'Kneeling Idle': ['Kneel', 'Sitting & lying'],
  'Crouch To Stand': ['Get up from one knee', 'Sitting & lying'],
  'Stand Up': ['Stand up, slow', 'Sitting & lying'],
  'Lying Down': ['Lie down', 'Sitting & lying'],
  'Laying Idle': ['Lie, idle', 'Sitting & lying'],
  'Talking': ['Talk, explaining', 'Talking & gestures'],
  'Sitting Talking': ['Talk, sitting', 'Talking & gestures'],
  'Standing Arguing': ['Argue', 'Talking & gestures'],
  'Head Nod Yes': ['Nod yes', 'Talking & gestures'],
  'Shaking Head No': ['Shake head no', 'Talking & gestures'],
  'Pointing': ['Point at someone', 'Talking & gestures'],
  'Waving': ['Wave, both arms', 'Talking & gestures'],
  'Salute': ['Salute', 'Talking & gestures'],
  'Clapping': ['Clap', 'Talking & gestures'],
  'Shrugging': ['Shrug', 'Talking & gestures'],
  'Dismissing Gesture': ['Wave it away', 'Talking & gestures'],
  'Standing Thumbs Up': ['Thumbs up', 'Talking & gestures'],
  'Shake Fist': ['Shake a fist', 'Talking & gestures'],
  'Praying': ['Pray', 'Talking & gestures'],
  'Angry': ['Angry', 'Feelings'],
  'Crying': ['Cry', 'Feelings'],
  'Sad Idle': ['Sad', 'Feelings'],
  'Happy Idle': ['Happy', 'Feelings'],
  'Laughing': ['Laugh', 'Feelings'],
  'Scared': ['Scared', 'Feelings'],
  'Surprised': ['Surprised', 'Feelings'],
  'Disappointed': ['Disappointed', 'Feelings'],
  'Defeat Idle': ['Defeated', 'Feelings'],
  'Victory': ['Cheer, victory', 'Feelings'],
  'Thinking': ['Think', 'Feelings'],
  'Carrying': ['Hold a box', 'Using things'],
  'Lifting Object': ['Lift a heavy box', 'Using things'],
  'Pick Up Item': ['Pick something up', 'Using things'],
  'Throw Object': ['Throw', 'Using things'],
  'Push': ['Push something heavy', 'Using things'],
  'Pull Heavy Object': ['Pull something heavy', 'Using things'],
  'Pulling Lever': ['Pull a lever', 'Using things'],
  'Opening Door Inwards': ['Open a door', 'Using things'],
  'Button Pushing': ['Press a button', 'Using things'],
  'Drinking': ['Drink', 'Using things'],
  'Sitting Drinking': ['Drink, sitting', 'Using things'],
  'Talking On Phone': ['Talk on the phone', 'Using things'],
  'Aim Pistol': ['Aim a pistol', 'Weapons'],
  'Shooting': ['Fire a pistol', 'Weapons'],
  'Sword And Shield Idle': ['Sword and shield, ready', 'Weapons'],
  'Sword And Shield Attack': ['Sword and shield, strike', 'Weapons'],
  'Fight Idle': ['Fighting stance', 'Fighting'],
  'Jab Cross': ['Jab, cross', 'Fighting'],
  'Hook Punch': ['Hook punch', 'Fighting'],
  'Uppercut': ['Uppercut', 'Fighting'],
  'Roundhouse Kick': ['Roundhouse kick', 'Fighting'],
  'Punching Bag': ['Hit a punching bag', 'Fighting'],
  'Blocking': ['Guard up', 'Fighting'],
  'Standing Block': ['Block', 'Fighting'],
  'Standing Dodge Left': ['Dodge', 'Fighting'],
  'Capoeira': ['Capoeira', 'Fighting'],
  'Hit Reaction': ['Hit, recoil', 'Fighting'],
  'Receive Punch To The Face': ['Punched in the face', 'Fighting'],
  'Death From The Front': ['Hit, fall forward', 'Fighting'],
  'Falling Back Death': ['Hit, fall back', 'Fighting'],
  'Jump': ['Jump', 'Sport & acrobatics'],
  'Standing Jump': ['Jump on the spot', 'Sport & acrobatics'],
  'Jump Over': ['Jump over', 'Sport & acrobatics'],
  'Landing': ['Land from a jump', 'Sport & acrobatics'],
  'Jumping Jacks': ['Jumping jacks', 'Sport & acrobatics'],
  'Jumping Rope': ['Skip rope', 'Sport & acrobatics'],
  'Backflip': ['Backflip', 'Sport & acrobatics'],
  'Front Flip': ['Front flip', 'Sport & acrobatics'],
  'Baseball Hit': ['Baseball swing', 'Sport & acrobatics'],
  'Baseball Pitching': ['Baseball pitch', 'Sport & acrobatics'],
  'Golf Drive': ['Golf drive', 'Sport & acrobatics'],
  'Football Catch': ['Catch a football', 'Sport & acrobatics'],
  'Soccer Penalty Kick': ['Penalty kick', 'Sport & acrobatics'],
  'Dancing': ['Dance', 'Dance'],
  'Hip Hop Dancing': ['Hip hop', 'Dance'],
  'Jazz Dancing': ['Jazz', 'Dance'],
  'Rumba Dancing': ['Rumba', 'Dance'],
  'Salsa Dancing': ['Salsa', 'Dance'],
  'Swing Dancing': ['Swing', 'Dance'],
};
const slug = (name: string) => name.toLowerCase().replace(/°/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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

/** A clip as captured: its people's bodies a sex and a height (a capture's actor has no build of ours). */
const asCaptured = (clip: Clip): Clip => ({ ...clip, parts: clip.parts.map((p) => (p.body ? { ...p, body: { sex: p.body.sex, height: p.body.height } } : p)) });
const read = async (file: string) => level(refineClip(asCaptured(parseClip(JSON.parse(await readFile(join(from, file), 'utf8')))!)));
const files = (await readdir(from)).filter((f) => f.endsWith('.clip.json')).sort();
const clips = new Map<string, Clip>();
for (const f of files) {
  const clip = await read(f);
  clips.set(clip.name, clip);
}

/** When a strike lands (s): only for strikes (for scenes made with them, the one struck reacting then: lib/films.ts). */
const impactOf = (clip: Clip) => (/kick|punch|jab|uppercut|cross|hook/i.test(clip.name) ? strikeTime(clip) : undefined);

// (Whether it loops and when it strikes by the file's name: what it is.)
const out: { file: string; clip: Clip; group: MotionGroup; loop: boolean; impact?: number }[] = [];
for (const clip of clips.values()) {
  if (MIRRORED.includes(clip.name) || HALVES.includes(clip.name)) continue;
  if (!LIST[clip.name]) throw new Error(`${clip.name}: give it a name and a group in LIST`);
  const [name, group] = LIST[clip.name];
  out.push({ file: clip.name, clip: { ...clip, name }, group, loop: loops(clip), impact: impactOf(clip) });
}

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
const index: { id: string; name: string; duration: number; people: number; group: MotionGroup; loop?: true; impact?: number }[] = [];

for (const { file, clip, group, loop, impact } of out.sort((a, b) => a.clip.name.localeCompare(b.clip.name))) {
  const id = `library:${slug(file)}`;
  if (index.some((m) => m.name === clip.name)) throw new Error(`Two motions are called ${clip.name}`);
  const ready: Clip = { ...clip, id, loop };
  await writeFile(join(to, `${slug(file)}.json`), JSON.stringify(ready));
  index.push({
    id, name: ready.name, duration: ready.duration, people: ready.parts.length, group,
    ...(loop ? { loop: true as const } : {}),
    ...(impact !== undefined ? { impact } : {}),
  });
}
await writeFile(join(to, 'index.json'), JSON.stringify(index, null, 1) + '\n');
rig.dispose();
console.log(`${index.length} motions in ${to} (${index.filter((m) => m.loop).length} loop, ${MIRRORED.length} left out as mirrored, ${HALVES.length} halves of two people's)`);
