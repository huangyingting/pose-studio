import { describe, expect, it } from 'vitest';
import { blinkAt, faceAt } from '@/lib/face';
import { newFigure, newScene, parseScene } from '@/lib/doc';
import { applyMotion, setFace } from '@/lib/actions';
import { captured, fresh } from '../fixtures/scenes';
import type { Animation, Role } from '@/lib/types';

const anim = (clip: string, duration = 4): Animation => ({
  duration, fps: 24, loop: false, shots: [{ id: 'main', start: 0, name: 'Shot 1', camera: 'c' }],
  actions: [{ id: 'a', start: 0, duration, roles: [{ figure: 'f' }], source: { kind: 'clip', clip: clip } }],
});

describe('a character\'s face as it plays (#15)', () => {
  it('blinks now and then: a few times in ten seconds, each a sixth of a second, at its own times', () => {
    const shut = (id: string) => Array.from({ length: 2400 }, (_, i) => blinkAt(id, i / 240)).filter((v) => v > 0.5).length / 240;
    expect(shut('a')).toBeGreaterThan(0.08 * 2);
    expect(shut('a')).toBeLessThan(0.08 * 5);
    const times = (id: string) => Array.from({ length: 2400 }, (_, i) => i / 240).filter((t) => blinkAt(id, t) > 0.9).map((t) => Math.round(t));
    expect(times('a')).not.toEqual(times('b'));
  });

  it('talks while it talks, shows what it feels as it does it, eased in, and blinks', () => {
    const talk = anim('library:talking');
    const open = Array.from({ length: 96 }, (_, i) => faceAt(talk, 'f', 0.5 + i / 32)).filter((f) => (f.aa ?? 0) + (f.oh ?? 0) + (f.ee ?? 0) + (f.ou ?? 0) + (f.ih ?? 0) > 0.3).length;
    expect(open).toBeGreaterThan(20);
    expect(faceAt(anim('library:crying'), 'f', 2).sad).toBe(1);
    expect(faceAt(anim('library:crying'), 'f', 0.05).sad!).toBeLessThan(0.2);
    expect(faceAt(anim('library:laughing'), 'f', 2).happy).toBe(1);
    // Nothing to feel standing idle: only the blinks.
    expect(Object.keys(faceAt(anim('library:idle'), 'f', 2)).filter((k) => k !== 'blink')).toEqual([]);
  });

  it('in a motion of two, each their own (a captor angry, the hostage frightened; one given CPR, eyes shut)', () => {
    const two = (clip: string): Animation => ({ ...anim(clip), actions: [{ ...anim(clip).actions[0], roles: [{ figure: 'f' }, { figure: 'g' }] }] });
    expect(faceAt(two('library:hostage-situation'), 'f', 2).angry).toBeGreaterThan(0.5);
    expect(faceAt(two('library:hostage-situation'), 'g', 2).surprised).toBeGreaterThan(0.5);
    expect(faceAt(two('library:hostage-situation'), 'g', 2).angry).toBeUndefined();
    // (Shut all the time: not opened and shut again by a blink.)
    expect(Array.from({ length: 25 }, (_, i) => faceAt(two('library:cpr'), 'g', 0.5 + i / 10).blink)).toEqual(Array(25).fill(1));
    expect(faceAt(two('library:hug'), 'g', 2).happy).toBeGreaterThan(0.5);
  });

  it("set by hand for a stretch (a role's face): that feeling over the motion's own, or none, the mouth still talking; kept with the scene", () => {
    const set = (clip: string, face: Role['face']): Animation => ({ ...anim(clip), actions: [{ ...anim(clip).actions[0], roles: [{ figure: 'f', face }] }] });
    expect(faceAt(set('library:crying', 'happy'), 'f', 2)).toMatchObject({ happy: 0.9 });
    expect(faceAt(set('library:crying', 'happy'), 'f', 2).sad).toBeUndefined();
    expect(Object.keys(faceAt(set('library:crying', 'neutral'), 'f', 2)).filter((k) => k !== 'blink')).toEqual([]);
    const angryTalk = Array.from({ length: 96 }, (_, i) => faceAt(set('library:talking', 'angry'), 'f', 0.5 + i / 32));
    expect(angryTalk.every((f) => f.angry === 0.9 || (f.angry ?? 0) > 0)).toBe(true);
    expect(angryTalk.filter((f) => (f.aa ?? 0) + (f.oh ?? 0) + (f.ee ?? 0) + (f.ou ?? 0) + (f.ih ?? 0) > 0.3).length).toBeGreaterThan(20);
    // (Saved and read back with the scene.)
    const scene = newScene('S', [{ ...newFigure(), id: 'f' }]);
    const kept = parseScene(JSON.parse(JSON.stringify({ ...scene, animation: set('library:crying', 'surprised') })));
    expect(kept?.animation?.actions.find((x) => x.id === 'a')?.roles[0].face).toBe('surprised');
  });

  it('set in the block\'s inspector, for that person; As it plays again, the motion\'s own; one undo each', () => {
    const { store, a } = fresh();
    applyMotion(store, a, captured('crying'));
    const act = store.scene.animation!.actions.find((x) => x.source.kind === 'clip')!;
    setFace(store, act.id, a, 'angry');
    const t = act.start + 1;
    expect(faceAt(store.scene.animation!, a, t).angry).toBe(0.9);
    setFace(store, act.id, a, null);
    expect(store.scene.animation!.actions.find((x) => x.id === act.id)!.roles[0].face).toBeUndefined();
    expect(faceAt(store.scene.animation!, a, t).sad).toBe(1);
    store.undo();
    expect(faceAt(store.scene.animation!, a, t).angry).toBe(0.9);
  });
});
