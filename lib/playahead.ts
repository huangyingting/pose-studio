import { BUILT_IN, clipById, clipsVersion, playedClips } from './assets';
import { withPhysics } from './physics';
import type { Clip, Figure, Prop, Scene } from './types';

/*
 * Playback worked out ahead, on another thread (lib/playahead.worker.ts): while a scene plays, where
 * everything is at the moments it is about to reach (the second ahead), so the page's thread only
 * draws them. On a grid of twice the scene's frame rate. A moment not there yet (just started, a
 * jump, an edit, no worker in this browser) is worked out on the page's thread as before: what is
 * drawn is the same either way.
 */

/** To the worker: the scene to play (and the clips it plays that are not built in), or the frames wanted next. */
export type PlayAheadRequest = { type: 'scene'; gen: number; scene: Scene; clips: Clip[] } | { type: 'frames'; gen: number; frames: number[] };
/** From the worker: a frame worked out (for that scene, `gen`), and whether the physics was loaded there. */
export interface PlayAheadReply { gen: number; k: number; physics: boolean; figures: Figure[]; props: Prop[] }

/** How far ahead of the playhead it works (seconds of the scene, at its speed); how far on it starts when it has fallen behind. */
const AHEAD = 1;
const LEAD = 0.15;

/** The frame (of the grid) a time falls on, and the time of a frame. */
const frameOf = (scene: Scene, t: number) => Math.round(t * scene.animation!.fps * 2);
const timeOf = (scene: Scene, k: number) => k / scene.animation!.fps / 2;

/** A time on the grid playback is drawn at (the page's own frames on it too, so either way the same). */
export const onGrid = (scene: Scene, t: number) => timeOf(scene, frameOf(scene, t));

export class PlayAhead {
  private worker: Worker | null | undefined;
  private gen = 0;
  private scene: Scene | null = null;
  private clips = -1;
  private frames = new Map<number, PlayAheadReply>();
  private asked = NaN;

  private start(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    try {
      this.worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./playahead.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.worker = null;
    }
    if (this.worker) this.worker.onmessage = (e: MessageEvent<PlayAheadReply>) => { if (e.data.gen === this.gen) this.frames.set(e.data.k, e.data); };
    return this.worker;
  }

  /**
   * The scene as it plays at `t` (on the grid: onGrid), if the other thread has worked it out; null
   * if not (yet). `span`: what is playing (wrapping round where it loops), at `speed`: what comes
   * next is asked for.
   */
  at(scene: Scene, t: number, span: { start: number; end: number; loop: boolean } | null, speed: number): Scene | null {
    const worker = this.start();
    const a = scene.animation;
    if (!worker || !a) return null;
    // Another scene (an edit), or clips come in: worked out again from it.
    if (scene !== this.scene || clipsVersion() !== this.clips) {
      this.scene = scene;
      this.clips = clipsVersion();
      this.gen++;
      this.frames.clear();
      this.asked = NaN;
      const clips = playedClips({ scenes: [scene] }).filter((id) => !id.startsWith(BUILT_IN)).flatMap((id) => clipById(id) ?? []);
      worker.postMessage({ type: 'scene', gen: this.gen, scene, clips } satisfies PlayAheadRequest);
    }
    const k = frameOf(scene, t);
    if (k !== this.asked && span) {
      this.asked = k;
      // The frames from here on for the next second, round the loop where it goes round; behind
      // (this one not there yet), from a little further on: what it works out next is still ahead
      // when it is done, not one the page has already drawn.
      const [first, last] = [frameOf(scene, span.start), frameOf(scene, span.end)];
      const rate = a.fps * 2 * Math.max(0.1, speed);
      const lead = this.frames.has(k) ? 0 : Math.ceil(LEAD * rate);
      const wanted: number[] = [];
      for (let i = 0, j = k; i < Math.ceil(AHEAD * rate); i++, j++) {
        if (j > last) {
          if (!span.loop) break;
          j = first;
        }
        if (i >= lead) wanted.push(j);
      }
      const keep = new Set(wanted);
      for (const done of this.frames.keys()) if (done !== k && !keep.has(done)) this.frames.delete(done);
      worker.postMessage({ type: 'frames', gen: this.gen, frames: wanted.filter((j) => !this.frames.has(j)) } satisfies PlayAheadRequest);
    }
    const f = this.frames.get(k);
    if (!f) return null;
    // (Worked out without the physics the page has, or the other way round: not the same; dropped,
    // so that it is asked for again.)
    if (f.physics !== withPhysics(scene)) {
      this.frames.delete(k);
      return null;
    }
    return { ...scene, figures: f.figures, props: f.props };
  }

  /** Playback stopped: nothing more worked out ahead (what was asked for dropped). */
  stop() {
    if (!this.worker || Number.isNaN(this.asked)) return;
    this.asked = NaN;
    this.worker.postMessage({ type: 'frames', gen: this.gen, frames: [] } satisfies PlayAheadRequest);
  }

  /** Its thread stopped (started again if asked for more). */
  dispose() {
    this.worker?.terminate();
    this.worker = undefined;
    this.scene = null;
  }
}
