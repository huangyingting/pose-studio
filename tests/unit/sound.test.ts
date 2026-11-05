import { describe, expect, it } from 'vitest';
import { moveSound, removeSound, sceneSound, setSceneSound, setSoundOptions, startAnimation, trimSound } from '@/lib/actions';
import { newAnimation } from '@/lib/animation';
import { sceneShots, storyWindows } from '@/lib/board';
import { newFigure, newScene, parseLibrary } from '@/lib/doc';
import { playedPart, segmentsOf, soundBeats, soundExt, soundSegment, soundSpan } from '@/lib/sound';
import type { Scene, SoundInfo } from '@/lib/types';
import { fresh } from '../fixtures/scenes';

/* A scene's sound (#35): kept, placed, trimmed; what of it a video carries. */

const SONG: SoundInfo = { id: 'snd1', name: 'Song', duration: 10, peaks: Array.from({ length: 100 }, (_, i) => (i % 10 === 5 ? 90 : 10)) };

describe('a scene\'s sound (#35)', () => {
  it('is kept with the project: the library lists the sound (its waveform), the scene where it plays; odd values set right', () => {
    const scene = { ...newScene('S', [newFigure()]), sound: { id: 'snd1', start: 1.5, from: 2, to: 6, volume: 0.5, muted: true } };
    const lib = parseLibrary(JSON.parse(JSON.stringify({ scenes: [scene], sounds: [SONG] })));
    expect(lib.sounds).toEqual([SONG]);
    expect(lib.scenes[0].sound).toEqual({ id: 'snd1', start: 1.5, from: 2, to: 6, volume: 0.5, muted: true });
    const odd = parseLibrary({ scenes: [{ ...scene, sound: { id: 'snd1', start: 'x', from: -3, to: 1, volume: 7 } }], sounds: [{ id: 'snd1', duration: -1, peaks: [500, 'a'] }] });
    expect(odd.scenes[0].sound).toEqual({ id: 'snd1', start: 0, to: 1 });
    expect(odd.sounds![0]).toMatchObject({ duration: 0, peaks: [100, 0] });
  });

  it('put on a scene: in the library once, from the start; a still scene animated as long as it; replaced in the same place', () => {
    const { store } = fresh();
    setSceneSound(store, SONG);
    expect(store.getState().library.sounds).toEqual([SONG]);
    expect(store.scene.sound).toEqual({ id: 'snd1', start: 0 });
    expect(store.scene.animation!.duration).toBe(10);
    moveSound(store, 2.01);
    setSceneSound(store, { ...SONG, id: 'snd2', name: 'Other' });
    expect(store.scene.sound).toEqual({ id: 'snd2', start: 2 });
    expect(store.getState().library.sounds!.map((x) => x.id)).toEqual(['snd1', 'snd2']);
    // (One undo each.)
    store.undo();
    expect(store.scene.sound?.id).toBe('snd1');
  });

  it('moved along its row (on frames), trimmed at either end (no more than it has, never inside out), made quieter, muted, taken off', () => {
    const { store } = fresh();
    startAnimation(store, 12);
    setSceneSound(store, SONG);
    expect(store.scene.animation!.duration).toBe(12);
    moveSound(store, 1.01);
    expect(store.scene.sound!.start).toBeCloseTo(1, 6);
    // Its start trimmed in: the sound under it stays where it was on the timeline.
    trimSound(store, 'start', 3);
    expect(store.scene.sound).toMatchObject({ start: 3, from: 2 });
    expect(soundSpan(store.scene.sound!, SONG)).toEqual({ t0: 3, t1: 11, from: 2 });
    trimSound(store, 'end', 8);
    expect(playedPart(store.scene.sound!, SONG)).toEqual({ from: 2, to: 7 });
    trimSound(store, 'end', 40);
    expect(store.scene.sound!.to).toBeUndefined();
    trimSound(store, 'start', -5);
    expect(store.scene.sound).toMatchObject({ start: 1 });
    expect(store.scene.sound!.from).toBeUndefined();
    trimSound(store, 'start', 50);
    expect(playedPart(store.scene.sound!, SONG).to - playedPart(store.scene.sound!, SONG).from).toBeCloseTo(0.1, 6);
    setSoundOptions(store, { volume: 0.5, muted: true });
    expect(store.scene.sound).toMatchObject({ volume: 0.5, muted: true });
    setSoundOptions(store, { volume: 1, muted: false });
    expect(store.scene.sound!.volume).toBeUndefined();
    expect(store.scene.sound!.muted).toBeUndefined();
    removeSound(store);
    expect(store.scene.sound).toBeUndefined();
    expect(sceneSound(store)).toBeNull();
    expect(store.getState().library.sounds).toHaveLength(1);
  });

  it('heard over a stretch of the timeline: from where in it, how long, how loud; nothing muted or beyond it', () => {
    const scene = { sound: { id: 'snd1', start: 2, from: 1, to: 7, volume: 0.6 } };
    expect(soundSegment(scene, SONG, 0, 4)).toEqual({ id: 'snd1', at: 2, from: 1, length: 2, volume: 0.6 });
    expect(soundSegment(scene, SONG, 5, 20)).toEqual({ id: 'snd1', at: 0, from: 4, length: 3, volume: 0.6 });
    expect(soundSegment(scene, SONG, 9, 12)).toBeNull();
    expect(soundSegment({ sound: { ...scene.sound, muted: true } }, SONG, 0, 4)).toBeNull();
    // A video of the scene played twice: under each play.
    expect(segmentsOf(scene, SONG, [{ t0: 0, t1: 10, at: 0 }, { t0: 0, t1: 10, at: 10.04 }]).map((s) => [s.at, s.from, s.length])).toEqual([[2, 1, 6], [12.04, 1, 6]]);
  });

  it('snaps drags to its ends and its beats (the louder peaks), a few a second at most', () => {
    const beats = soundBeats({ id: 'snd1', start: 1 }, SONG);
    expect(beats.slice(0, 2)).toEqual([1, 11]);
    // (Peaks every tenth of it: one a second, half way through each.)
    expect(beats.slice(2)).toEqual([1.55, 2.55, 3.55, 4.55, 5.55, 6.55, 7.55, 8.55, 9.55, 10.55]);
  });

  it('in the storyboard video, under each of its scene\'s shots where they come in the story', () => {
    const a = { ...newScene('A', [newFigure()]) };
    const one: Scene = { ...a, animation: newAnimation(a, 3) };
    const two: Scene = { ...a, id: 'b', animation: newAnimation(a, 2), sound: { id: 'snd1', start: 0 } };
    const shots = [...sceneShots(one), ...sceneShots(two)];
    const windows = storyWindows(shots, 24);
    expect(windows.map((w) => [w.scene.id, w.t0, w.at])).toEqual([[one.id, 0, 0], ['b', 0, 3]]);
    expect(windows.flatMap((w) => segmentsOf(w.scene, SONG, [w])).map((s) => [s.at, s.from, s.length])).toEqual([[3, 0, 2]]);
  });

  it('packed under the extension its file says it is', () => {
    const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
    expect(soundExt(bytes('RIFF\0\0\0\0WAVEfmt '))).toBe('wav');
    expect(soundExt(bytes('OggS\0\0\0\0\0\0\0\0'))).toBe('ogg');
    expect(soundExt(bytes('\0\0\0\x20ftypM4A '))).toBe('m4a');
    expect(soundExt(bytes('ID3\x03\0\0\0\0\0\0\0\0'))).toBe('mp3');
  });
});
