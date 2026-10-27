import { newAnimation } from './animation';
import { keyPose } from './clip';
import { newFigure, newScene } from './doc';
import { bakeClip } from './evaluate';
import { MOTIONS } from './motions';
import { CAMERA_MOVES } from './shot';
import { uid } from './uid';
import type { Action, Clip, Scene } from './types';

/*
 * Assets by id, from one place: the built-in motions (made into clips when first used) and the
 * clips in the library (imported motions). The store keeps it in step with the library.
 */

/** Ids of built-in motions' clips: this, then the motion's id. */
export const BUILT_IN = 'motion:';

const library = new Map<string, Clip>();
const builtIn = new Map<string, Clip | null>();

export function clipById(id: string): Clip | null {
  if (!id.startsWith(BUILT_IN)) return library.get(id) ?? null;
  if (!builtIn.has(id)) {
    const m = MOTIONS.find((x) => x.id === id.slice(BUILT_IN.length));
    builtIn.set(id, m && !m.travel ? bakeClip(m.build(), id, m.name) : null);
  }
  return builtIn.get(id)!;
}

/** The library's clips (called whenever the library changes). */
export function setLibraryClips(clips: Clip[] | undefined) {
  library.clear();
  for (const c of clips ?? []) library.set(c.id, c);
}

/** A clip playing on its own people, where it has them (to preview it). */
export function clipScene(clip: Clip): Scene {
  const figures = clip.parts.map((p) => ({ ...newFigure({ name: p.name, ...(p.body ? { body: { ...p.body } } : {}) }), ...keyPose(p, 0) }));
  const scene = newScene(clip.name, figures);
  const base = { ...newAnimation(scene, Math.max(0.2, clip.duration)), loop: clip.loop };
  const play: Action = { id: uid('act'), start: 0, duration: clip.duration, roles: figures.map((f) => ({ figure: f.id })), source: { kind: 'clip', clip: clip.id } };
  const animation = { ...base, actions: [...base.actions, play] };
  const move = CAMERA_MOVES.find((m) => m.id === 'static')!;
  return { ...scene, animation: { ...animation, camera: { keys: move.keys(animation, scene.view), follow: true, shake: 0 } } };
}
