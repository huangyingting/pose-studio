import { newAnimation } from './animation';
import { clipRange, keyPose } from './clip';
import { newFigure, newScene } from './doc';
import { bakeClip } from './evaluate';
import { GAIT_WAYS } from './locomotion';
import { HANDLING, MOTIONS } from './motions';
import { uid } from './uid';
import type { Action, Clip, Library, Scene } from './types';

/*
 * Assets by id, from one place: the built-in motions (made into clips when first used) and the
 * imported clips loaded so far (lib/assetstore.ts keeps them; the library lists them).
 */

/** Ids of built-in motions' clips: this, then the motion's id. */
export const BUILT_IN = 'motion:';
/** Ids of the Library's motion files (public/motions, fetched when first used): this, then the file's name. */
export const LIBRARY = 'library:';

const loaded = new Map<string, Clip>();
const builtIn = new Map<string, Clip | null>();
let version = 0;
const listeners = new Set<() => void>();

export function clipById(id: string): Clip | null {
  if (!id.startsWith(BUILT_IN)) return loaded.get(id) ?? null;
  if (!builtIn.has(id)) {
    const m = [...MOTIONS, ...HANDLING].find((x) => x.id === id.slice(BUILT_IN.length));
    builtIn.set(id, m && !m.travel ? { ...bakeClip(m.build(), id, m.name), events: m.events ?? [] } : null);
  }
  return builtIn.get(id)!;
}

/** Imported clips now at hand (loaded from where they are kept, or just imported). */
export function putClips(clips: Clip[]) {
  if (!clips.length) return;
  for (const c of clips) loaded.set(c.id, c);
  version++;
  listeners.forEach((f) => f());
}

export const hasClip = (id: string) => id.startsWith(BUILT_IN) || loaded.has(id);

/** Whether an action's motion goes round: as its block says (its Loops), else as the motion does. */
export const loopsOf = (src: { clip: string; loops?: boolean }) => src.loops ?? !!clipById(src.clip)?.loop;

// (A motion made to go round, or not, by its block: the same one each time.)
const relooped = new WeakMap<Clip, Clip>();
/** The clip an action plays (#22): the part of it from `from` to `to`, or all of it (a loop is played whole); going round as its block says. */
export function playedClip(src: { clip: string; from?: number; to?: number; loops?: boolean }): Clip | null {
  let c = clipById(src.clip);
  if (c && src.loops !== undefined && src.loops !== c.loop) {
    let other = relooped.get(c);
    if (!other) relooped.set(c, (other = { ...c, loop: src.loops }));
    c = other;
  }
  return c && !c.loop && (src.from !== undefined || src.to !== undefined) ? clipRange(c, src.from ?? 0, src.to ?? c.duration) : c;
}

/** Changes whenever clips come in (what is evaluated with them is worked out again). */
export const clipsVersion = () => version;

/** Call `f` whenever clips come in. Returns a function that stops it. */
export function onClips(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** The imported clips a library uses: listed in it, or played in its scenes (not those that come with the app). */
export function clipIdsOf(lib: Library): string[] {
  const ids = new Set((lib.clips ?? []).map((c) => c.id));
  for (const id of playedClips(lib)) if (!id.startsWith(BUILT_IN) && !id.startsWith(LIBRARY)) ids.add(id);
  return [...ids];
}

/** The ids of the clips a library's scenes play. */
export function playedClips(lib: Library): string[] {
  // (A walk or run with a captured cycle plays it too, #26, and keeping its facing, those that back up and step sideways.)
  const gaits = (x: Action['source']) => (x.kind === 'travel' && x.gait && x.mode !== 'jump' ? [x.gait, ...(x.strafe ? Object.values(GAIT_WAYS[x.mode]) : [])] : []);
  return [...new Set(lib.scenes.flatMap((s) => (s.animation?.actions ?? []).flatMap((x) => (x.source.kind === 'clip' ? [x.source.clip] : gaits(x.source)))))];
}

/** A clip playing on its own people, where it has them. */
export function clipScene(clip: Clip): Scene {
  const figures = clip.parts.map((p) => ({ ...newFigure({ name: p.name, ...(p.body ? { body: { ...p.body } } : {}) }), ...keyPose(p, 0) }));
  const scene = newScene(clip.name, figures);
  const base = { ...newAnimation(scene, Math.max(0.2, clip.duration)), loop: clip.loop };
  const play: Action = { id: uid('act'), start: 0, duration: clip.duration, roles: figures.map((f) => ({ figure: f.id })), source: { kind: 'clip', clip: clip.id } };
  return { ...scene, animation: { ...base, actions: [...base.actions, play] } };
}
