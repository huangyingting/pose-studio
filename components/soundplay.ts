import { audioContext, soundBuffer, soundSpan } from '@/lib/sound';
import type { Store } from '@/lib/store';
import type { Clock } from './clock';

/*
 * The scene's sound heard as it plays (#35): started where the playhead is in it when the clock
 * plays, at its speed, and started again there whenever the clock jumps (a seek, going round a
 * loop or an in/out stretch) or drifts far from it; stopped with it. (A machine slow to draw lets
 * the clock fall behind: its picture lags the sound rather than the sound stuttering.) Scrubbing
 * plays a moment of it.
 */

/** How far the clock may step in a frame and still be playing on (s, at speed 1): further is a jump. */
const STEP = 0.12;
/** How far the sound may drift from the clock, playing on, before it is started again where it should be (s). */
const DRIFT = 1;
/** How long a moment scrubbed to is heard (s). */
const SCRUB = 0.12;

export function playSound(clock: Clock, store: Store): () => void {
  let playing: { src: AudioBufferSourceNode; gain: GainNode; t0: number; at: number; rate: number; id: string } | null = null;
  // (The sound being read: started once it is, if the clock still plays.)
  let reading = false;
  const stop = () => {
    if (!playing) return;
    playing.src.onended = null;
    try {
      playing.src.stop();
    } catch {
      // (Already ended.)
    }
    playing = null;
  };
  /** Where the playhead is in the scene's sound now (seconds of it), its gain, or null where none is heard. */
  const position = () => {
    const sound = store.scene.sound;
    const info = sound && (store.getState().library.sounds ?? []).find((x) => x.id === sound.id);
    if (!sound || !info || sound.muted) return null;
    const span = soundSpan(sound, info);
    if (clock.time < span.t0 - 1e-3 || clock.time >= span.t1) return null;
    return { id: sound.id, at: span.from + (clock.time - span.t0), until: span.from + (span.t1 - span.t0), volume: sound.volume ?? 1 };
  };
  const start = async (p: NonNullable<ReturnType<typeof position>>, length?: number) => {
    const buf = await soundBuffer(p.id);
    if (!buf) return null;
    const ctx = audioContext();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = clock.speed;
    const gain = ctx.createGain();
    gain.gain.value = p.volume;
    src.connect(gain).connect(ctx.destination);
    src.start(0, p.at, Math.max(0.01, length ?? p.until - p.at));
    return { src, gain, t0: ctx.currentTime, at: p.at, rate: clock.speed, id: p.id };
  };
  // (When playing stopped: the playhead set where it stopped is not a scrub.)
  let stopped = 0;
  let lastTime = clock.time;
  const tick = () => {
    // (Back, or further on than a frame takes it: a seek, or going round.)
    const step = clock.time - lastTime;
    const jumped = step < -1e-3 || step > STEP * clock.speed;
    lastTime = clock.time;
    if (!clock.playing) {
      if (playing || reading) stopped = performance.now();
      stop();
      return;
    }
    const p = position();
    if (!p) {
      stop();
      return;
    }
    if (playing) {
      // (Where it has got to, against where the clock is: started again there if they differ.)
      const heard = playing.at + (audioContext().currentTime - playing.t0) * playing.rate;
      if (playing.id === p.id && playing.rate === clock.speed && !jumped && Math.abs(heard - p.at) < DRIFT) {
        playing.gain.gain.value = p.volume;
        return;
      }
      stop();
    }
    if (reading) return;
    reading = true;
    void start(p).then((got) => {
      reading = false;
      if (!got) return;
      // (Stopped, or moved on, while it was being read: not heard.)
      if (!clock.playing || playing) got.src.stop();
      else playing = got;
    });
  };
  // A moment scrubbed to (the playhead moved, not playing): heard briefly.
  let last = store.getState().time;
  let lastScrub = 0;
  const scrub = () => {
    const t = store.getState().time;
    if (t === last) return;
    last = t;
    if (clock.playing || performance.now() - lastScrub < 60 || performance.now() - stopped < 300) return;
    const sound = store.scene.sound;
    const info = sound && (store.getState().library.sounds ?? []).find((x) => x.id === sound.id);
    if (!sound || !info || sound.muted) return;
    const span = soundSpan(sound, info);
    if (t < span.t0 || t >= span.t1) return;
    lastScrub = performance.now();
    void start({ id: sound.id, at: span.from + (t - span.t0), until: span.from + (span.t1 - span.t0), volume: sound.volume ?? 1 }, SCRUB);
  };
  const offClock = clock.subscribe(tick);
  const offStore = store.subscribe(scrub);
  return () => {
    offClock();
    offStore();
    stop();
  };
}
