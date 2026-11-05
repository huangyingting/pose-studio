import { MAX_DURATION, newAnimation, snapTime } from '../animation';
import { playedPart } from '../sound';
import type { Store } from '../store';
import type { SceneSound, SoundInfo } from '../types';

/*
 * The scene's sound (#35): put on it, moved and trimmed on its timeline row, made quieter or
 * muted, taken off. The library keeps the sound itself (and its file, as an asset).
 */

const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

/** The library's sounds (those imported). */
const soundsOf = (store: Store) => store.getState().library.sounds ?? [];

/** The open scene's sound and what the library lists of it, if it has one. */
export function sceneSound(store: Store): { sound: SceneSound; info: SoundInfo } | null {
  const sound = store.scene.sound;
  const info = sound && soundsOf(store).find((x) => x.id === sound.id);
  return sound && info ? { sound, info } : null;
}

/**
 * A sound (just imported, or the library's) on the open scene, in place of the one it had, from
 * the start (or where the one it replaces started). A still scene is animated for as long as it.
 */
export function setSceneSound(store: Store, info: SoundInfo) {
  store.group(() => {
    if (!soundsOf(store).some((x) => x.id === info.id)) store.commit((lib) => ({ ...lib, sounds: [...(lib.sounds ?? []), info] }));
    const start = store.scene.sound?.start ?? 0;
    store.updateScene((s) => ({ ...s, sound: { id: info.id, start }, ...(s.animation ? {} : { animation: newAnimation(s, Math.min(MAX_DURATION, Math.max(1, Math.ceil(info.duration)))) }) }));
  });
}

/** The scene's sound starts at t on its timeline (dragged along its row). */
export function moveSound(store: Store, t: number, key = '') {
  store.updateScene((s) => (s.sound ? { ...s, sound: { ...s.sound, start: r3(Math.max(-MAX_DURATION, Math.min(MAX_DURATION, s.animation ? snapTime(s.animation, t) : t))) } } : s), key);
}

/**
 * Its start or end trimmed to t on the timeline (an edge of its row's block dragged): less of it
 * played, or more (no more than it has); its start's sound stays where it was on the timeline.
 */
export function trimSound(store: Store, side: 'start' | 'end', t: number, key = '') {
  const got = sceneSound(store);
  if (!got) return;
  const { sound, info } = got;
  const { from, to } = playedPart(sound, info);
  const at = store.scene.animation ? snapTime(store.scene.animation, t) : t;
  const next: SceneSound = side === 'start'
    ? (() => {
      // (The sound under the new start: from where the timeline has it, at most its end less a tenth.)
      const f = r3(Math.min(to - 0.1, Math.max(0, from + (at - sound.start))));
      return { ...sound, start: r3(sound.start + (f - from)), ...(f > 0 ? { from: f } : { from: undefined }) };
    })()
    : (() => {
      const e = r3(Math.min(info.duration, Math.max(from + 0.1, from + (at - sound.start))));
      return { ...sound, ...(e < info.duration ? { to: e } : { to: undefined }) };
    })();
  store.updateScene((s) => ({ ...s, sound: clean(next) }), key);
}

/** How loud the scene's sound is (0–1), or muted. */
export function setSoundOptions(store: Store, patch: { volume?: number; muted?: boolean }, key = '') {
  store.updateScene((s) => {
    if (!s.sound) return s;
    const volume = patch.volume === undefined ? s.sound.volume : Math.round(Math.min(1, Math.max(0, patch.volume)) * 100) / 100;
    const muted = patch.muted === undefined ? s.sound.muted : patch.muted;
    return { ...s, sound: clean({ ...s.sound, volume: volume !== undefined && volume < 1 ? volume : undefined, muted: muted || undefined }) };
  }, key);
}

/** The scene's sound taken off (the library keeps it). */
export function removeSound(store: Store) {
  store.updateScene((s) => {
    const { sound: _, ...rest } = s;
    void _;
    return rest;
  });
}

/** Without the fields left as they are by default (undefined). */
function clean(s: SceneSound): SceneSound {
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as unknown as SceneSound;
}
