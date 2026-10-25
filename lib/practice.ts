import type { Scene, Style } from './types';

/*
 * Gesture-drawing practice: a timed slideshow of poses, like the timers artists use for
 * figure-drawing warm-ups. Poses can be shuffled, seen from random angles and mirrored.
 */

export interface PracticeOptions {
  source: 'all' | 'current';
  /** Seconds per pose; 0 = no limit (advance manually). */
  seconds: number;
  /** Number of poses; 0 = the whole library (or 10 for a single pose). */
  count: number;
  shuffle: boolean;
  randomAngle: boolean;
  mirror: boolean;
  style: Style;
}

export const DEFAULT_PRACTICE: PracticeOptions = {
  source: 'all', seconds: 60, count: 10, shuffle: true, randomAngle: false, mirror: false, style: 'line',
};

export const DURATIONS = [15, 30, 60, 120, 300, 600, 0];
export const COUNTS = [5, 10, 20, 0];

export function formatTime(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const durationLabel = (s: number) => (s === 0 ? 'No limit' : s < 60 ? `${s}s` : `${s / 60} min`);

export function parsePracticeOptions(raw: unknown): PracticeOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof PracticeOptions, unknown>>;
  return {
    source: o.source === 'current' ? 'current' : 'all',
    seconds: DURATIONS.includes(o.seconds as number) ? (o.seconds as number) : DEFAULT_PRACTICE.seconds,
    count: COUNTS.includes(o.count as number) ? (o.count as number) : DEFAULT_PRACTICE.count,
    shuffle: o.shuffle !== false,
    randomAngle: o.randomAngle === true,
    mirror: o.mirror === true,
    style: o.style === 'shaded' || o.style === 'silhouette' ? o.style : 'line',
  };
}

/** Number of poses a session will show. */
export function sessionLength(o: Pick<PracticeOptions, 'source' | 'count'>, librarySize: number) {
  return o.count || (o.source === 'all' ? librarySize : 10);
}

export interface Slide {
  scene: Scene;
  mirrored: boolean;
}

/** Build the slides for a session. `random` is injectable for tests. */
export function buildSession(scenes: Scene[], current: Scene, o: PracticeOptions, random = Math.random): Slide[] {
  const n = sessionLength(o, scenes.length);
  let pool: Scene[];
  if (o.source === 'current') {
    pool = Array.from({ length: n }, () => current);
  } else {
    pool = [...scenes];
    if (o.shuffle) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }
    // Repeat the library if more poses were asked for than it has.
    while (pool.length < n) pool = pool.concat(pool.slice(0, n - pool.length));
    pool = pool.slice(0, n);
  }
  // A single pose is only interesting from different angles.
  const randomAngle = o.randomAngle || o.source === 'current';
  return pool.map((scene) => ({
    scene: randomAngle
      ? { ...scene, view: { ...scene.view, yaw: Math.round(random() * 360 - 180), pitch: Math.round(random() * 45 - 10) } }
      : scene,
    mirrored: o.mirror && random() < 0.5,
  }));
}
