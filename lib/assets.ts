import { newAnimation } from './animation';
import { keyPose } from './clip';
import { newFigure, newScene } from './doc';
import { bakeClip } from './evaluate';
import { HANDLING, MOTIONS } from './motions';
import { filmWith } from './shot';
import { uid } from './uid';
import type { Action, Clip, Library, Scene } from './types';

/*
 * Assets by id, from one place: the built-in motions (made into clips when first used) and the
 * imported clips loaded so far (lib/assetstore.ts keeps them; the library lists them).
 */

/** Ids of built-in motions' clips: this, then the motion's id. */
export const BUILT_IN = 'motion:';

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

/** Changes whenever clips come in (what is evaluated with them is worked out again). */
export const clipsVersion = () => version;

/** Call `f` whenever clips come in. Returns a function that stops it. */
export function onClips(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** The imported clips a library uses: listed in it, or played in its scenes. */
export function clipIdsOf(lib: Library): string[] {
  const ids = new Set((lib.clips ?? []).map((c) => c.id));
  for (const s of lib.scenes) for (const x of s.animation?.actions ?? []) if (x.source.kind === 'clip' && !x.source.clip.startsWith(BUILT_IN)) ids.add(x.source.clip);
  return [...ids];
}

/** A clip playing on its own people, where it has them (to preview it). */
export function clipScene(clip: Clip): Scene {
  const figures = clip.parts.map((p) => ({ ...newFigure({ name: p.name, ...(p.body ? { body: { ...p.body } } : {}) }), ...keyPose(p, 0) }));
  const scene = newScene(clip.name, figures);
  const base = { ...newAnimation(scene, Math.max(0.2, clip.duration)), loop: clip.loop };
  const play: Action = { id: uid('act'), start: 0, duration: clip.duration, roles: figures.map((f) => ({ figure: f.id })), source: { kind: 'clip', clip: clip.id } };
  return filmWith({ ...scene, animation: { ...base, actions: [...base.actions, play] } }, 'static', { follow: true });
}
