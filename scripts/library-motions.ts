// The Library's motions from motion-capture clips (Film Studio's own format, as "Import motion…"
// makes them): each *.clip.json in data/library/motions (or the folder given) is made ready to play
// and copied to public/motions as <slug>.json with the id library:<slug>; public/motions/index.json
// lists them, each with its name and group in the Library's Motions (LIST). Run with `npm run motions`.
//
// Made ready: each person facing where they look and the wrists' roll the forearms' (lib/motionfix.ts,
// as any import); a motion that ends as it starts loops; one that is another mirrored is left out
// (an action plays mirrored); so are the halves of motions of two people, but those whose halves
// line up, which are put together (PAIRS: one motion of two, as shaking hands).
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as THREE from 'three';
import { partFromPoses, samplePart } from '../lib/clip';
import { newFigure, parseClip } from '../lib/doc';
import { DEFAULT_BODY } from '../lib/body';
import { legsOf } from '../lib/locomotion';
import { goesRound, isCycle, refineClip, seamless } from '../lib/motionfix';
import { clipCourse, strikeTime } from '../lib/strike';
import { Rig } from '../lib/relations';
import { BOTS_FILE } from '../lib/bots';
import { setBotMeshes } from '../lib/mannequin';
import { detectGrips } from '../lib/constraints';
import { HAND_PRESETS, cloneHand } from '../lib/hands';
import { anglesOf, bonesOf, type Angles } from '../lib/pose';
import { STAGINGS } from '../lib/stagings';
import type { MOTION_GROUPS } from '../lib/motions';
import type { Clip, ClipContact, Figure, JointName, Pose } from '../lib/types';

type MotionGroup = (typeof MOTION_GROUPS)[number];

// (The mannequin's meshes, as the app fetches them.)
setBotMeshes(await readFile(`public/mannequin/${BOTS_FILE}`));

const from = process.argv[2] ?? 'data/library/motions';
const to = 'public/motions';

/** Left out: the same as another mirrored (that one, mirrored, does it the other way). */
const MIRRORED = ['Walk Right', 'Strafe Right', 'Turn 90 Right'];

/** Left out: one person's half of a motion of two (alone, it is not the motion; those PAIRS has are put together). */
const HALVES = ['Shaking Hands 1', 'Shaking Hands 2', 'Hostage Situation Villain', 'Hostage Situation Hostage', 'Shoulder Throw Aggressor', 'Shoulder Throw Victim', 'Administering Cpr', 'Receiving Cpr', 'Release Hostage Villain', 'Release Hostage Hostage', 'Kiss 1', 'Kiss 2'];

/**
 * Motions of two people put together from halves captured apart, each at the place it starts
 * from: the second put where the first meets it (in the first's frame where it starts: `at`, x to
 * its left, z ahead; `facing`, degrees), worked out from where their hands are as they meet (the
 * hands that shake; the arm round the neck). The shoulder throw's halves do not meet so (its
 * thrower runs four metres to it): left out.
 */
const PAIRS: { file: string; name: string; group: MotionGroup; lead: string; partner: string; roles: [string, string]; at: [number, number]; facing: number }[] = [
  { file: 'Shaking Hands', name: 'Shake hands', group: 'Talking & gestures', lead: 'Shaking Hands 1', partner: 'Shaking Hands 2', roles: ['Lead', 'Partner'], at: [0.03, 1.04], facing: 180 },
  // (The rescuer kneeling by the patient's chest, hands on it: placed where both, played in the app, keep out of each other.)
  { file: 'Cpr', name: 'Give CPR', group: 'Sitting & lying', lead: 'Administering Cpr', partner: 'Receiving Cpr', roles: ['Rescuer', 'Patient'], at: [-0.2, 0.55], facing: 200 },
  { file: 'Hostage Situation', name: 'Hold someone hostage', group: 'Fighting', lead: 'Hostage Situation Villain', partner: 'Hostage Situation Hostage', roles: ['Captor', 'Hostage'], at: [-0.06, 0.48], facing: 0 },
  { file: 'Release Hostage', name: 'Let a hostage go', group: 'Fighting', lead: 'Release Hostage Villain', partner: 'Release Hostage Hostage', roles: ['Captor', 'Hostage'], at: [-0.06, 0.48], facing: 0 },
  // (Her head a little in front of his as she rises on her toes, her arms round his neck, his hands at her waist.)
  { file: 'Kiss', name: 'Kiss', group: 'Feelings', lead: 'Kiss 1', partner: 'Kiss 2', roles: ['Lead', 'Partner'], at: [0, 0.57], facing: 180 },
];

/**
 * Each motion's name in the Library and its group, by what the person does (one holding a gun is
 * with the weapons, one handling a thing with the things), by its file's name. Its id is the file's
 * name (library:<the file's name>), whatever it is called.
 */
const LIST: Record<string, [string, MotionGroup]> = {
  'Walk': ['Walk', 'Moving'],
  'Walk Forward': ['Walk, brisk', 'Moving'],
  'Walk Backward': ['Walk backward', 'Moving'],
  'Sneak Backward': ['Sneak backward', 'Moving'],
  'Drunk Walk': ['Walk, drunk', 'Moving'],
  'Injured Walk': ['Walk, hurt', 'Moving'],
  'Limping Walk': ['Walk, limping', 'Moving'],
  'Texting And Walking': ['Walk, texting', 'Moving'],
  'Walk Left': ['Walk sideways', 'Moving'],
  'Happy Walk': ['Walk, happy', 'Moving'],
  'Crouch Walk Forward': ['Sneak, crouched', 'Moving'],
  'Jog Forward': ['Jog', 'Moving'],
  'Run Forward': ['Run', 'Moving'],
  'Run Backward': ['Run backward', 'Moving'],
  'Sprint': ['Sprint', 'Moving'],
  'Strafe Left': ['Run sideways', 'Moving'],
  'Turn 90 Left': ['Turn 90°', 'Moving'],
  'Walking Turn 180': ['Turn around, walking', 'Moving'],
  'Ascending Stairs': ['Walk up stairs', 'Moving'],
  'Descending Stairs': ['Walk down stairs', 'Moving'],
  'Running Up Stairs': ['Run up stairs', 'Moving'],
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
  'Sit To Type': ['Start typing, sitting', 'Sitting & lying'],
  'Crouch Idle': ['Crouch', 'Sitting & lying'],
  'Kneeling Idle': ['Kneel', 'Sitting & lying'],
  'Crouch To Stand': ['Get up from one knee', 'Sitting & lying'],
  'Stand Up': ['Get up off the floor, slow', 'Sitting & lying'],
  'Falling Down': ['Fall down', 'Sitting & lying'],
  'Getting Up': ['Get up off the floor', 'Sitting & lying'],
  'Lying Down': ['Lie down on a bed', 'Sitting & lying'],
  'Laying Idle': ['Lie, idle', 'Sitting & lying'],
  'Laying Sleeping': ['Sleep, lying', 'Sitting & lying'],
  'Laying Severe Cough': ['Cough, lying', 'Sitting & lying'],
  'Laying Moaning': ['Groan in pain, lying', 'Sitting & lying'],
  'Laying Hand Gesture': ['Talk, lying', 'Sitting & lying'],
  'Kneel': ['Down on one knee, and up', 'Sitting & lying'],
  'Talking': ['Talk, explaining', 'Talking & gestures'],
  'Quick Informal Bow': ['Bow, quick', 'Talking & gestures'],
  'Sitting Talking': ['Talk, sitting', 'Talking & gestures'],
  'Standing Arguing': ['Argue', 'Talking & gestures'],
  'Head Nod Yes': ['Nod yes', 'Talking & gestures'],
  'Shaking Head No': ['Shake head no', 'Talking & gestures'],
  'Pointing': ['Point at someone', 'Talking & gestures'],
  'Waving': ['Wave, both arms', 'Talking & gestures'],
  'Blow A Kiss': ['Blow a kiss', 'Talking & gestures'],
  'Salute': ['Salute', 'Talking & gestures'],
  'Clapping': ['Clap, sitting', 'Sitting & lying'],
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
  'Victory': ['Cheer', 'Feelings'],
  'Cheering While Sitting': ['Cheer, sitting', 'Sitting & lying'],
  'Thinking': ['Think', 'Feelings'],
  'Carrying': ['Hold a box', 'Using things'],
  'Lifting Object': ['Lift a heavy box', 'Using things'],
  'Pick Up Item': ['Grab something on the run', 'Moving'],
  'Picking Up': ['Pick something up', 'Using things'],
  'Throw Object': ['Throw', 'Using things'],
  'Push': ['Push something heavy', 'Using things'],
  'Pull Heavy Object': ['Pull something heavy', 'Using things'],
  'Pulling Lever': ['Pull a lever', 'Using things'],
  'Opening Door Inwards': ['Open a door', 'Using things'],
  'Button Pushing': ['Press a button', 'Using things'],
  'Drinking': ['Drink', 'Using things'],
  'Sitting Drinking': ['Drink, sitting', 'Using things'],
  'Talking On Phone': ['Talk on the phone', 'Using things'],
  'Texting While Standing': ['Text on a phone', 'Using things'],
  'Typing': ['Type, sitting', 'Using things'],
  'Aim Pistol': ['Aim a pistol, sitting', 'Weapons'],
  'Shooting': ['Fire a pistol', 'Weapons'],
  'Sword And Shield Idle': ['Sword and shield, ready', 'Weapons'],
  'Sword And Shield Attack': ['Sword and shield, jump attack', 'Weapons'],
  'Sword And Shield Block': ['Sword and shield, block', 'Weapons'],
  'Sword And Shield Impact': ['Sword and shield, hit', 'Weapons'],
  'Sword And Shield Death': ['Sword and shield, fall', 'Weapons'],
  'Pistol Idle': ['Aim a pistol', 'Weapons'],
  'Pistol Walk': ['Walk, aiming a pistol', 'Weapons'],
  'Pistol Whip': ['Strike with a pistol', 'Weapons'],
  'Fight Idle': ['Fighting stance', 'Fighting'],
  'Jab Cross': ['Jab, cross', 'Fighting'],
  'Hook Punch': ['Hook punch', 'Fighting'],
  'Uppercut': ['Uppercut', 'Fighting'],
  'Roundhouse Kick': ['Roundhouse kick', 'Fighting'],
  'Mma Kick': ['Front kick', 'Fighting'],
  'Punching Bag': ['Hit a punching bag', 'Fighting'],
  'Blocking': ['Guard up', 'Fighting'],
  'Standing Block': ['Block', 'Fighting'],
  'Standing Dodge Left': ['Dodge', 'Fighting'],
  'Capoeira': ['Capoeira', 'Fighting'],
  'Hit Reaction': ['Hit, recoil', 'Fighting'],
  'Receive Punch To The Face': ['Punched in the face', 'Fighting'],
  'Death From The Front': ['Hit, fall forward', 'Fighting'],
  'Falling Back Death': ['Hit, fall back', 'Fighting'],
  'Jump': ['Jump forward', 'Sport & acrobatics'],
  'Standing Jump': ['Jump on the spot', 'Sport & acrobatics'],
  'Jump Over': ['Dive over and roll', 'Sport & acrobatics'],
  'Landing': ['Land from a jump', 'Sport & acrobatics'],
  'Jumping Jacks': ['Jumping jacks', 'Sport & acrobatics'],
  'Jumping Rope': ['Skip rope', 'Sport & acrobatics'],
  'Backflip': ['Backflip', 'Sport & acrobatics'],
  'Cartwheel': ['Cartwheel', 'Sport & acrobatics'],
  'Front Flip': ['Front flip, running', 'Sport & acrobatics'],
  'Baseball Hit': ['Baseball swing', 'Sport & acrobatics'],
  'Baseball Pitching': ['Baseball pitch', 'Sport & acrobatics'],
  'Golf Drive': ['Golf drive', 'Sport & acrobatics'],
  'Football Catch': ['Catch a football, diving', 'Sport & acrobatics'],
  'Soccer Penalty Kick': ['Penalty kick', 'Sport & acrobatics'],
  'Dancing': ['Dance', 'Dance'],
  'Spinning': ['Spin on one foot', 'Dance'],
  'Hip Hop Dancing': ['Hip hop', 'Dance'],
  'Jazz Dancing': ['Jazz', 'Dance'],
  'Rumba Dancing': ['Rumba', 'Dance'],
  'Salsa Dancing': ['Salsa', 'Dance'],
  'Swing Dancing': ['Swing', 'Dance'],
};

/**
 * The motions done sitting, by their file's name: seated from the start, or (sitting down) at the
 * end. Given to someone with nothing under them to sit on, a chair is put there (lib/actions/motion.ts).
 */
const SEATED: Record<string, 'start' | 'end'> = {
  'Sitting Idle': 'start', 'Sitting Talking': 'start', 'Clapping': 'start', 'Cheering While Sitting': 'start', 'Aim Pistol': 'start',
  'Sitting Drinking': 'start', 'Sit To Stand': 'start', 'Stand To Sit': 'end', 'Sit To Type': 'start', 'Typing': 'start',
};
for (const name of Object.keys(SEATED)) if (!LIST[name]) throw new Error(`SEATED names ${name}, not a motion in LIST`);
const slug = (name: string) => name.toLowerCase().replace(/°/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const rig = new Rig();
const round = (v: number) => Math.round(v * 1000) / 1000;


/**
 * Done once, though they end as they start: a gesture, a blow, a reaction, using something (a
 * block of one is trimmed, not made of laps; played longer, it holds its last pose).
 */
const ONCE = [
  'Shooting', 'Surprised', 'Head Nod Yes', 'Shaking Head No', 'Pointing', 'Salute', 'Shake Fist', 'Shrugging', 'Standing Thumbs Up', 'Dismissing Gesture',
  'Cartwheel', 'Spinning', 'Falling Down', 'Getting Up', 'Mma Kick', 'Picking Up', 'Quick Informal Bow',
  'Jump', 'Hit Reaction', 'Hook Punch', 'Jab Cross', 'Receive Punch To The Face', 'Roundhouse Kick', 'Uppercut', 'Lifting Object', 'Button Pushing', 'Pulling Lever', 'Throw Object',
  'Kneel', 'Pistol Whip', 'Sword And Shield Impact', 'Blow A Kiss',
];

/**
 * Climbing, a lap at a time: each lap ends higher than it starts, as it should (a ladder's rungs,
 * a flight of stairs), and played longer it goes on up (lib/evaluate.ts: a loop's laps carry a
 * climb on). Not levelled as a walk is, nor its end eased into its start as a loop on the spot is:
 * either would take the climb out (their laps join within a few degrees as they are).
 */
const CLIMBS = ['Climbing Ladder', 'Ascending Stairs', 'Running Up Stairs'];

/** Whether a clip goes round (lib/motionfix.ts), unless it is done once; a climb does. */
const loops = (clip: Clip) => CLIMBS.includes(clip.name) || (!ONCE.includes(clip.name) && goesRound(clip));

/**
 * A walk or run cycle level: captured, its hips often sink or rise a few centimetres over a cycle
 * (and its feet with them, on the floor only at its lowest); taken out evenly, its feet on the
 * floor all the way, so that it goes round without a jump.
 */
function level(clip: Clip): Clip {
  if (!isCycle(clip.name) || CLIMBS.includes(clip.name)) return clip;
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

/** A pair's halves as one motion of two: the second half placed and turned as PAIRS says, its contacts its own, and the hands each holds of the other. */
async function paired(p: (typeof PAIRS)[number]): Promise<Clip> {
  const raw = async (name: string) => asCaptured(parseClip(JSON.parse(await readFile(join(from, `${name}.clip.json`), 'utf8')))!);
  const [a, b] = [await raw(p.lead), await raw(p.partner)];
  const yaw = (p.facing * Math.PI) / 180;
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const q = new THREE.Quaternion();
  const placed = {
    ...b.parts[0],
    tracks: b.parts[0].tracks.map((t) => {
      if (t.name === 'hips.position') {
        const v = [...t.values];
        for (let i = 0; i < v.length; i += 3) {
          const [x, z] = [v[i], v[i + 2]];
          v[i] = round(x * Math.cos(yaw) + z * Math.sin(yaw) + p.at[0]);
          v[i + 2] = round(-x * Math.sin(yaw) + z * Math.cos(yaw) + p.at[1]);
        }
        return { ...t, values: v };
      }
      if (t.name !== 'hips.quaternion') return t;
      const v = [...t.values];
      for (let i = 0; i < v.length; i += 4) {
        q.set(v[i], v[i + 1], v[i + 2], v[i + 3]).premultiply(turn);
        [v[i], v[i + 1], v[i + 2], v[i + 3]] = [q.x, q.y, q.z, q.w];
      }
      return { ...t, values: v };
    }),
  };
  const both = refineClip({
    // (Each part named by its role, as the inspector lists who plays it.)
    ...a, name: p.file, duration: Math.min(a.duration, b.duration), parts: [{ ...a.parts[0], name: p.roles[0] }, { ...placed, name: p.roles[1] }],
    contacts: [...(a.contacts ?? []).map((c) => ({ ...c, part: 0 })), ...(b.contacts ?? []).map((c) => ({ ...c, part: 1 }))],
  });
  // (Hands held both ways at once, a handshake: both kept; as played, the shorter one's follows.)
  return { ...both, contacts: [...(both.contacts ?? []), ...detectGrips(both, 30)] };
}

/**
 * Motions of two made here, from People together's poses (there is no capture of them): the two
 * standing where the pose has them, their arms at rest, into the pose, held, and out again. A hug
 * goes in and out through arms opened wide (round the other, not through them).
 */
const MADE_PAIRS: { file: string; name: string; group: MotionGroup; staging: string; roles: [string, string]; keys: [number, 'rest' | 'open' | 'peak'][]; meet?: JointName }[] = [
  { file: 'Hug', name: 'Hug', group: 'Feelings', staging: 'hug', roles: ['Lead', 'Partner'], keys: [[0, 'rest'], [0.45, 'open'], [0.95, 'peak'], [2.6, 'peak'], [3.05, 'open'], [3.5, 'rest']] },
  { file: 'High Five', name: 'High five', group: 'Talking & gestures', staging: 'highfive', roles: ['Lead', 'Partner'], keys: [[0, 'rest'], [0.5, 'peak'], [0.62, 'peak'], [1.25, 'rest']], meet: 'rightHand' },
];

const ARMS = ['leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'neck', 'head'] as const;
const AT_REST: Angles = { leftUpperArm: [0, 0, 8], rightUpperArm: [0, 0, -8], leftLowerArm: [-10, 0, 0], rightLowerArm: [-10, 0, 0] };
const OPEN: Angles = { ...AT_REST, leftUpperArm: [-45, 0, 50], rightUpperArm: [-45, 0, -50], leftLowerArm: [-35, 0, 0], rightLowerArm: [-35, 0, 0] };
const relaxedHand = () => cloneHand(HAND_PRESETS.find((h) => h.name === 'Relaxed')!.hand);

/** A made pair's clip: each person's keys as poses, where their hips are in the pose; the hands each holds of the other found. */
function madePair(p: (typeof MADE_PAIRS)[number]): Clip {
  const staged = STAGINGS.find((x) => x.id === p.staging)!.build();
  const parts = staged.figures.map((f, n) => {
    const hips = rig.model(f).joints.hips.getWorldPosition(new THREE.Vector3());
    const position: [number, number, number] = [round(hips.x), round(hips.y), round(hips.z)];
    const peak = anglesOf(f.bones);
    const without = Object.fromEntries(Object.entries(peak).filter(([j]) => !(ARMS as readonly string[]).includes(j)));
    const as = (arms: Angles | null): Pose => ({
      bones: arms ? bonesOf({ ...without, ...arms }) : f.bones,
      position, grounded: false,
      hands: arms ? { L: relaxedHand(), R: relaxedHand() } : (f as Figure).hands,
    });
    const keys = p.keys.map(([t, what]) => ({ t, pose: as(what === 'peak' ? null : what === 'open' ? OPEN : AT_REST) }));
    return { ...partFromPoses(p.roles[n], keys, 'smooth', { sex: f.body.sex, height: f.body.height }), name: p.roles[n] };
  });
  const duration = p.keys[p.keys.length - 1][0];
  const clip = refineClip({ id: p.file, name: p.file, duration, loop: false, parts, events: [], contacts: [] });
  // Held while the pose is: an arm passing the other's on its way in or out holds nothing. Hands that
  // meet each other (a high five's palms) are held both ways (a hand is not a bone grips are found on).
  const peaks = p.keys.filter(([, what]) => what === 'peak').map(([t]) => t);
  const [from, to] = [Math.min(...peaks), Math.max(...peaks)];
  const grips = detectGrips(clip, 30).filter((c) => c.start < to && c.end > from);
  const meet = p.meet ? [0, 1].map((n): ClipContact => ({ part: n, bone: p.meet!, start: from, end: to, on: { part: 1 - n, bone: p.meet! } })) : [];
  return { ...clip, name: p.name, contacts: [...(clip.contacts ?? []), ...grips, ...meet] };
}

/** When a strike lands (s): only for strikes (for scenes made with them, the one struck reacting then: lib/films.ts). */
const impactOf = (clip: Clip) => (/kick|punch|jab|uppercut|cross|hook/i.test(clip.name) && !/^receive/i.test(clip.name) ? strikeTime(clip) : undefined);

// (Whether it loops and when it strikes by the file's name: what it is.)
const out: { file: string; clip: Clip; group: MotionGroup; loop: boolean; impact?: number }[] = [];
for (const clip of clips.values()) {
  if (MIRRORED.includes(clip.name) || HALVES.includes(clip.name)) continue;
  if (!LIST[clip.name]) throw new Error(`${clip.name}: give it a name and a group in LIST`);
  const [name, group] = LIST[clip.name];
  out.push({ file: clip.name, clip: { ...clip, name }, group, loop: loops(clip), impact: impactOf(clip) });
}
for (const p of PAIRS) {
  const clip = await paired(p);
  out.push({ file: p.file, clip: { ...clip, name: p.name }, group: p.group, loop: false });
}
for (const p of MADE_PAIRS) out.push({ file: p.file, clip: madePair(p), group: p.group, loop: false });

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
const index: { id: string; name: string; duration: number; people: number; group: MotionGroup; loop?: true; impact?: number; seat?: 'start' | 'end'; move: [number, number]; turn: number; reach?: [number, number, number]; partner?: { at: [number, number]; facing: number } }[] = [];

for (const { file, clip, group, loop, impact } of out.sort((a, b) => a.clip.name.localeCompare(b.clip.name))) {
  const id = `library:${slug(file)}`;
  if (index.some((m) => m.name === clip.name)) throw new Error(`Two motions are called ${clip.name}`);
  // (One that goes round where it stands, seamless: its end eased into its start. Not a walk or
  // run, which goes on from where it got to: by the file's name, what it is.)
  const ready: Clip = { ...(loop && !isCycle(file) && !CLIMBS.includes(file) ? seamless(clip) : clip), id, loop };
  await writeFile(join(to, `${slug(file)}.json`), JSON.stringify(ready));
  index.push({
    id, name: ready.name, duration: ready.duration, people: ready.parts.length, group,
    ...(loop ? { loop: true as const } : {}),
    ...(impact !== undefined ? { impact } : {}),
    ...(SEATED[file] ? { seat: SEATED[file] } : {}),
    // (Where it takes its person, and where a strike lands: lib/strike.ts clipCourse.)
    ...clipCourse(ready, impact),
  });
}
await writeFile(join(to, 'index.json'), JSON.stringify(index, null, 1) + '\n');
rig.dispose();
console.log(`${index.length} motions in ${to} (${index.filter((m) => m.loop).length} loop, ${PAIRS.length + MADE_PAIRS.length} of two people, ${MIRRORED.length} left out as mirrored, ${HALVES.length} halves of two people's, put together or left out)`);
