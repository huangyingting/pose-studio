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

  /** Play from the current time; `range` gives the length and looping (read every frame). */
  play(range: () => { duration: number; loop: boolean } | null, onEnd?: (time: number) => void) {
    if (this.playing) return;
    const r = range();
    if (!r) return;
    if (!r.loop && this.time >= r.duration - 1e-3) this.time = 0;
    this.playing = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.playing) return;
      const cur = range();
      if (!cur) {
        this.pause();
        return;
      }
      this.time += Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.time >= cur.duration) {
        if (cur.loop) this.time %= cur.duration;
        else {
          this.time = cur.duration;
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
