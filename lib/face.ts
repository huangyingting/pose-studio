import type { Action, Animation, Expression, Face } from './types';

/*
 * A character's face as it plays (#15): it blinks now and then, its mouth moves as it talks, and it
 * shows what it feels (laughing, crying, angry, surprised), from what it is doing: the motion it
 * plays (by the Library's motions and our own), or as set by hand for its stretch (#56: Role.face).
 * Characters with expressions (a VRM avatar's shape keys: lib/vrm.ts) show it (lib/model.ts
 * ModelRig.setFace); the mannequin has no face.
 */

type Mood = { feel?: Expression; by?: number; talk?: boolean };

/**
 * What each motion shows on the face: a feeling and how strongly, whether the mouth talks. A motion
 * of two: each person's own, by their part (a captor angry, the hostage frightened).
 */
const MOODS: Record<string, Mood | Mood[]> = {
  talking: { talk: true }, 'sitting-talking': { talk: true }, 'talking-on-phone': { talk: true }, 'laying-hand-gesture': { talk: true },
  'standing-arguing': { feel: 'angry', by: 0.5, talk: true }, 'dismissing-gesture': { feel: 'angry', by: 0.3, talk: true },
  laughing: { feel: 'happy', by: 1, talk: true }, 'happy-idle': { feel: 'happy', by: 0.8 }, victory: { feel: 'happy', by: 1 },
  'standing-thumbs-up': { feel: 'happy', by: 0.7 }, waving: { feel: 'happy', by: 0.6 }, 'happy-walk': { feel: 'happy', by: 0.6 },
  clapping: { feel: 'happy', by: 0.8 }, 'cheering-while-sitting': { feel: 'happy', by: 1 }, 'blow-a-kiss': { feel: 'happy', by: 0.8 },
  hug: { feel: 'happy', by: 0.8 }, 'high-five': { feel: 'happy', by: 1 }, kiss: { feel: 'relaxed', by: 0.8 }, 'shaking-hands': { feel: 'happy', by: 0.5 },
  kneel: { feel: 'happy', by: 0.6 }, 'drunk-walk': { feel: 'happy', by: 0.5 }, 'head-nod-yes': { feel: 'relaxed', by: 0.4 },
  'salsa-dancing': { feel: 'happy', by: 0.5 }, 'hip-hop-dancing': { feel: 'relaxed', by: 0.6 }, 'swing-dancing': { feel: 'happy', by: 0.6 },
  'rumba-dancing': { feel: 'relaxed', by: 0.6 }, 'jazz-dancing': { feel: 'happy', by: 0.5 }, dancing: { feel: 'happy', by: 0.5 },
  crying: { feel: 'sad', by: 1 }, 'sad-idle': { feel: 'sad', by: 0.8 }, 'defeat-idle': { feel: 'sad', by: 0.8 }, disappointed: { feel: 'sad', by: 0.7 },
  'laying-moaning': { feel: 'sad', by: 0.9 }, 'laying-severe-cough': { feel: 'sad', by: 0.6 }, 'injured-walk': { feel: 'sad', by: 0.6 }, 'limping-walk': { feel: 'sad', by: 0.5 },
  angry: { feel: 'angry', by: 1, talk: true }, 'shake-fist': { feel: 'angry', by: 0.9 }, 'fight-idle': { feel: 'angry', by: 0.4 },
  'jab-cross': { feel: 'angry', by: 0.7 }, 'hook-punch': { feel: 'angry', by: 0.7 }, uppercut: { feel: 'angry', by: 0.7 }, 'roundhouse-kick': { feel: 'angry', by: 0.7 },
  'mma-kick': { feel: 'angry', by: 0.7 }, 'punching-bag': { feel: 'angry', by: 0.5 }, 'standing-block': { feel: 'angry', by: 0.4 }, blocking: { feel: 'angry', by: 0.4 },
  'aim-pistol': { feel: 'angry', by: 0.5 }, 'pistol-idle': { feel: 'angry', by: 0.5 }, 'pistol-walk': { feel: 'angry', by: 0.5 }, shooting: { feel: 'angry', by: 0.6 }, 'pistol-whip': { feel: 'angry', by: 0.8 },
  'sword-and-shield-idle': { feel: 'angry', by: 0.4 }, 'sword-and-shield-attack': { feel: 'angry', by: 0.8 }, 'sword-and-shield-block': { feel: 'angry', by: 0.5 },
  'hostage-situation': [{ feel: 'angry', by: 0.8 }, { feel: 'surprised', by: 0.9 }],
  'release-hostage': [{ feel: 'angry', by: 0.5 }, { feel: 'surprised', by: 0.6 }],
  // (The one given CPR: eyes shut. Asleep, too.)
  cpr: [{ feel: 'sad', by: 0.4 }, { feel: 'blink', by: 1 }], 'laying-sleeping': { feel: 'blink', by: 1 },
  surprised: { feel: 'surprised', by: 1 }, scared: { feel: 'surprised', by: 0.8 }, 'receive-punch-to-the-face': { feel: 'surprised', by: 0.7 },
  'hit-reaction': { feel: 'surprised', by: 0.6 }, 'falling-back-death': { feel: 'surprised', by: 0.5 }, 'death-from-the-front': { feel: 'surprised', by: 0.5 },
  'falling-down': { feel: 'surprised', by: 0.8 }, 'standing-dodge-left': { feel: 'surprised', by: 0.5 }, 'sword-and-shield-impact': { feel: 'surprised', by: 0.6 }, 'sword-and-shield-death': { feel: 'surprised', by: 0.5 },
  bored: { feel: 'relaxed', by: 0.4 }, yawn: { feel: 'relaxed', by: 0.5, talk: true }, praying: { feel: 'relaxed', by: 0.6 }, thinking: { feel: 'relaxed', by: 0.3 },
  'texting-while-standing': { feel: 'relaxed', by: 0.3 }, 'texting-and-walking': { feel: 'relaxed', by: 0.3 },
  'waving-hello': { feel: 'happy', by: 0.7 }, 'clapping-standing': { feel: 'happy', by: 0.8 }, yelling: { feel: 'angry', by: 0.9, talk: true },
  smoking: { feel: 'relaxed', by: 0.4 }, 'arm-stretching': { feel: 'relaxed', by: 0.5 }, 'looking-behind': { feel: 'surprised', by: 0.3 },
  ...Object.fromEntries(['rifle-idle', 'rifle-aiming-idle', 'firing-rifle', 'firing-rifle-kneeling', 'rifle-walk', 'rifle-walk-aiming', 'rifle-run'].map((m) => [m, { feel: 'angry' as const, by: 0.5 }])),
  'cover-idle': { feel: 'surprised', by: 0.4 }, 'crouch-look-around-corner': { feel: 'surprised', by: 0.4 },
  'death-from-the-back': { feel: 'surprised', by: 0.6 }, dying: { feel: 'sad', by: 0.9 }, 'shove-reaction': { feel: 'surprised', by: 0.6 },
  tripping: { feel: 'surprised', by: 0.8 }, 'stumble-backwards': { feel: 'surprised', by: 0.8 },
  // (Out cold, or lying dead: eyes shut.)
  'knocked-out': { feel: 'blink', by: 1 }, 'lying-dead': { feel: 'blink', by: 1 },
  'sitting-angry': { feel: 'angry', by: 0.9, talk: true }, 'sitting-disbelief': { feel: 'surprised', by: 0.8 }, 'sitting-laughing': { feel: 'happy', by: 1, talk: true },
  excited: { feel: 'happy', by: 1 }, rejected: { feel: 'sad', by: 0.8 }, 'nervously-look-around': { feel: 'surprised', by: 0.4 }, 'standing-greeting': { feel: 'happy', by: 0.6 },
  agony: { feel: 'sad', by: 1 }, 'injured-hurting-idle': { feel: 'sad', by: 0.8 }, 'injured-idle': { feel: 'sad', by: 0.6 }, 'injured-run': { feel: 'sad', by: 0.6 }, 'sitting-dazed': { feel: 'sad', by: 0.4 }, 'dizzy-idle': { feel: 'sad', by: 0.3 },
  'being-electrocuted': { feel: 'surprised', by: 1 }, 'hit-by-car': { feel: 'surprised', by: 1 }, 'big-stomach-hit': { feel: 'surprised', by: 0.7 }, 'kick-to-the-groin': { feel: 'surprised', by: 0.9 }, 'shoulder-hit-and-fall': { feel: 'surprised', by: 0.7 },
  strangle: [{ feel: 'angry', by: 0.9 }, { feel: 'surprised', by: 1 }], 'shoulder-throw': [{ feel: 'angry', by: 0.7 }, { feel: 'surprised', by: 0.9 }], 'grab-and-slam': [{ feel: 'angry', by: 0.9 }, { feel: 'surprised', by: 0.9 }],
  'jostled-passenger': { feel: 'surprised', by: 0.3 }, takedown: [{ feel: 'angry', by: 0.8 }, { feel: 'surprised', by: 0.8 }],
};

/** A motion's mood for the one in its part `part` (the Library's by the file's name), or as set by hand for them (Role.face). */
function moodOf(act: Action, part = 0): Mood | null {
  const own = act.source.kind === 'clip' ? MOODS[act.source.clip.startsWith('library:') ? act.source.clip.slice(8) : act.source.clip] : undefined;
  const mood = (Array.isArray(own) ? own[part] : own) ?? null;
  const set = act.roles[part]?.face;
  if (!set) return mood;
  // (Set by hand: that feeling, or none; the mouth still talks as the motion has it.)
  return { ...(set === 'neutral' ? {} : { feel: set, by: 0.9 }), ...(mood?.talk ? { talk: true } : {}) };
}

/** Whether a motion is someone talking (what a conversation cuts to: lib/coverage.ts). */
export function talking(act: Action) {
  return !!act.say || act.roles.some((_, i) => !!moodOf(act, i)?.talk);
}

/** A number from a figure's id, 0–1, the same every time (its own rhythm of blinking and talking). */
function seed(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };

/** How shut the eyes are at t: a blink every three to five seconds, a sixth of a second long. */
export function blinkAt(id: string, t: number) {
  const s = seed(id);
  const period = 3 + 2 * s;
  const k = Math.floor((t + s * period) / period);
  // (Where in its period this one falls: its own, the same each time.)
  const at = k * period - s * period + period * (0.2 + 0.6 * seed(`${id}:${k}`));
  const u = (t - at) / 0.16;
  return u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
}

/** The mouth while talking at t: syllables (open on a vowel, then another), with short pauses. */
function talkAt(id: string, t: number): Face {
  const s = seed(id);
  const beat = (t + s * 7) * 5.5;
  const syllable = Math.floor(beat);
  // (Now and then a pause, a breath between phrases.)
  if (seed(`${id}:p${Math.floor(beat / 9)}`) < 0.25 && beat % 9 > 6) return {};
  const open = Math.sin((beat - syllable) * Math.PI) * (0.5 + 0.5 * seed(`${id}:${syllable}`));
  const vowels: Expression[] = ['aa', 'oh', 'ee', 'ou', 'ih'];
  return { [vowels[Math.floor(seed(`${id}:v${syllable}`) * vowels.length)]]: Math.round(open * 100) / 100 };
}

/**
 * A figure's face at t in an animation: a blink now and then; the feeling of what it does (eased in
 * and out over a third of a second at either end of it); its mouth moving while it talks.
 */
export function faceAt(a: Animation, figure: string, t: number): Face {
  const face: Face = {};
  const blink = blinkAt(figure, t);
  const act = a.actions.find((x) => !x.layer && x.roles.some((r) => r.figure === figure) && x.start <= t && t < x.start + x.duration);
  const mood = act && moodOf(act, act.roles.findIndex((r) => r.figure === figure));
  if (mood) {
    const w = smooth(Math.min(t - act.start, act.start + act.duration - t) / 0.33);
    if (mood.feel) face[mood.feel] = Math.round((mood.by ?? 1) * w * 100) / 100;
    if (mood.talk) for (const [k, v] of Object.entries(talkAt(figure, t))) face[k as Expression] = (v ?? 0) * w;
  }
  // (Laughing or crying, the eyes are half shut already: no blink on top.)
  // (Nor where the eyes are shut already: asleep, given CPR.)
  if (blink > 0 && !face.blink && !(face.happy && face.happy > 0.7)) face.blink = Math.round(blink * 100) / 100;
  return face;
}
