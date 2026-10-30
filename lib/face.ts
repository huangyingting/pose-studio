import type { Action, Animation, Expression, Face } from './types';

/*
 * A character's face as it plays (#15): it blinks now and then, its mouth moves as it talks, and it
 * shows what it feels (laughing, crying, angry, surprised), from what it is doing: the motion it
 * plays (by the Library's motions and our own). Characters with expressions (a VRM avatar's shape
 * keys: lib/vrm.ts) show it (lib/model.ts ModelRig.setFace); the mannequin has no face.
 */

/** What each motion shows on the face: a feeling and how strongly, whether the mouth talks. */
const MOODS: Record<string, { feel?: Expression; by?: number; talk?: boolean }> = {
  talking: { talk: true }, 'sitting-talking': { talk: true }, 'talking-on-phone': { talk: true }, 'motion:talk': { talk: true },
  'standing-arguing': { feel: 'angry', by: 0.5, talk: true }, 'dismissing-gesture': { feel: 'angry', by: 0.3, talk: true },
  laughing: { feel: 'happy', by: 1, talk: true }, 'happy-idle': { feel: 'happy', by: 0.8 }, victory: { feel: 'happy', by: 1 },
  'standing-thumbs-up': { feel: 'happy', by: 0.7 }, waving: { feel: 'happy', by: 0.6 }, 'happy-walk': { feel: 'happy', by: 0.6 }, 'motion:wave': { feel: 'happy', by: 0.5 },
  'salsa-dancing': { feel: 'happy', by: 0.5 }, 'hip-hop-dancing': { feel: 'relaxed', by: 0.6 }, 'swing-dancing': { feel: 'happy', by: 0.6 },
  'rumba-dancing': { feel: 'relaxed', by: 0.6 }, 'jazz-dancing': { feel: 'happy', by: 0.5 }, dancing: { feel: 'happy', by: 0.5 }, 'motion:dance': { feel: 'happy', by: 0.5 },
  crying: { feel: 'sad', by: 1 }, 'sad-idle': { feel: 'sad', by: 0.8 }, 'defeat-idle': { feel: 'sad', by: 0.8 }, disappointed: { feel: 'sad', by: 0.7 },
  angry: { feel: 'angry', by: 1, talk: true }, 'shake-fist': { feel: 'angry', by: 0.9 }, 'fight-idle': { feel: 'angry', by: 0.4 },
  'jab-cross': { feel: 'angry', by: 0.7 }, 'hook-punch': { feel: 'angry', by: 0.7 }, uppercut: { feel: 'angry', by: 0.7 }, 'roundhouse-kick': { feel: 'angry', by: 0.7 },
  surprised: { feel: 'surprised', by: 1 }, scared: { feel: 'surprised', by: 0.8 }, 'receive-punch-to-the-face': { feel: 'surprised', by: 0.7 },
  'hit-reaction': { feel: 'surprised', by: 0.6 }, 'falling-back-death': { feel: 'surprised', by: 0.5 }, 'death-from-the-front': { feel: 'surprised', by: 0.5 },
  bored: { feel: 'relaxed', by: 0.4 }, yawn: { feel: 'relaxed', by: 0.5, talk: true }, praying: { feel: 'relaxed', by: 0.6 }, thinking: { feel: 'relaxed', by: 0.3 },
};

/** A motion's mood, by its clip's id (the Library's by the file's name). */
function moodOf(act: Action) {
  if (act.source.kind !== 'clip') return null;
  const id = act.source.clip;
  return MOODS[id.startsWith('library:') ? id.slice(8) : id] ?? null;
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
  const mood = act && moodOf(act);
  if (mood) {
    const w = smooth(Math.min(t - act.start, act.start + act.duration - t) / 0.33);
    if (mood.feel) face[mood.feel] = Math.round((mood.by ?? 1) * w * 100) / 100;
    if (mood.talk) for (const [k, v] of Object.entries(talkAt(figure, t))) face[k as Expression] = (v ?? 0) * w;
  }
  // (Laughing or crying, the eyes are half shut already: no blink on top.)
  if (blink > 0 && !(face.happy && face.happy > 0.7)) face.blink = Math.round(blink * 100) / 100;
  return face;
}
