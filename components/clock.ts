import { spanAt } from '@/lib/shots';
import type { Store } from '@/lib/store';

/**
 * Animation playback clock. Kept outside React state so playing an animation does not
 * re-render the whole studio every frame: the viewport and the timeline subscribe to it.
 */
export class Clock {
  time = 0;
  playing = false;
  private raf = 0;
  private last = 0;
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  set(time: number) {
    this.time = time;
    this.emit();
  }

  /** Playback speed (1 = real time; slower to study fast action). */
  speed = 1;
  /** Play the shot under the playhead over and over, instead of the whole animation. */
  repeatShot = false;

  setSpeed(speed: number) {
    this.speed = speed;
    this.emit();
  }

  setRepeatShot(on: boolean) {
    this.repeatShot = on;
    this.emit();
  }

  /** Play from the current time over `range` (read every frame), at `speed`. */
  play(range: () => { start: number; end: number; loop: boolean } | null, onEnd?: (time: number) => void) {
    if (this.playing) return;
    const r = range();
    if (!r) return;
    if (this.time < r.start - 1e-3 || (!r.loop && this.time >= r.end - 1e-3) || this.time > r.end) this.time = r.start;
    this.playing = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.playing) return;
      const cur = range();
      if (!cur) {
        this.pause();
        return;
      }
      this.time += Math.min(0.1, (now - this.last) / 1000) * this.speed;
      this.last = now;
      if (this.time >= cur.end) {
        if (cur.loop) this.time = cur.start + ((this.time - cur.start) % Math.max(1e-3, cur.end - cur.start));
        else {
          this.time = cur.end;
          this.pause();
          onEnd?.(this.time);
          return;
        }
      }
      this.emit();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }
}

/**
 * Start playing the open scene from the playhead: the whole animation (looping if it loops), or
 * with "repeat this shot" just the shot under the playhead, over and over.
 */
export function startPlayback(clock: Clock, store: Store) {
  if (clock.playing) return;
  clock.set(store.getState().time);
  let shot: { start: number; end: number } | null = null;
  clock.play(() => {
    const a = store.scene.animation;
    if (!a) return null;
    if (clock.repeatShot) {
      shot ??= spanAt(a, clock.time);
      return { start: shot.start, end: shot.end, loop: true };
    }
    shot = null;
    return { start: 0, end: a.duration, loop: a.loop };
  }, (t) => store.setTime(t));
  // Playing plays the film (#14): through its cuts, unless a camera is being looked through or
  // edited; the editor's view comes back when it stops.
  const s = store.getState();
  if (clock.playing && store.scene.cameras.length && !s.through && s.selection?.kind !== 'camera') {
    store.lookThrough({});
    const off = clock.subscribe(() => {
      if (clock.playing) return;
      off();
      const now = store.getState().through;
      if (now && !now.camera) store.lookThrough(null);
    });
  }
}
