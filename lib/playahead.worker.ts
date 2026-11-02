/// <reference lib="webworker" />
import { putClips } from './assets';
import { sceneAt } from './evaluate';
import { loadPhysics, physicsReady } from './physics';
import type { PlayAheadReply, PlayAheadRequest } from './playahead';
import type { Scene } from './types';

/*
 * Playback's other thread (lib/playahead.ts): where the playing scene is at the moments asked for
 * next, worked out here so the page's own thread only draws them. The same evaluation as the page's
 * (lib/evaluate.ts sceneAt), from the same scene and clips, the physics loaded here too.
 */

let scene: Scene | null = null;
let gen = -1;
/** The frames asked for and not yet worked out, the next first. */
let queue: number[] = [];
let busy = false;
void loadPhysics();

/** Work out the next frames, a few at a time (between them, a newer scene or request is read). */
function work() {
  busy = false;
  const until = performance.now() + 12;
  while (scene?.animation && queue.length && performance.now() < until) {
    const k = queue.shift()!;
    const at = sceneAt(scene, k / scene.animation.fps / 2, true);
    const reply: PlayAheadReply = { gen, k, physics: physicsReady(), figures: at.figures, props: at.props };
    postMessage(reply);
  }
  if (queue.length) {
    busy = true;
    setTimeout(work, 0);
  }
}

self.onmessage = (e: MessageEvent<PlayAheadRequest>) => {
  const m = e.data;
  if (m.type === 'scene') {
    putClips(m.clips);
    scene = m.scene;
    gen = m.gen;
    queue = [];
    return;
  }
  if (m.gen !== gen) return;
  // (The latest wish is the order: those behind the playhead now, not asked for again, dropped.)
  queue = m.frames;
  if (!busy) {
    busy = true;
    setTimeout(work, 0);
  }
};
