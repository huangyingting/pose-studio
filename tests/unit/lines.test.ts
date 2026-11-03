import { describe, expect, it } from 'vitest';
import { addProp, applyMotion, lineTime, sayLine, setLine, sitOn } from '@/lib/actions';
import { actionsOf } from '@/lib/evaluate';
import { parseScene } from '@/lib/doc';
import { talking } from '@/lib/face';
import { actionLabel } from '@/lib/track';
import { lineAt } from '@/lib/video';
import { captured, fresh } from '../fixtures/scenes';

describe('lines of dialogue', () => {
  it('a line is said for as long as it takes, its words on the block, kept with the scene, and a subtitle while it is said', () => {
    const { store, a } = fresh();
    captured('talking');
    store.setTime(0);
    const id = sayLine(store, a, 'I told you to wait for me by the door.')!;
    expect(id).toBeTruthy();
    const act = store.scene.animation!.actions.find((x) => x.id === id)!;
    expect(act.source).toMatchObject({ kind: 'clip', clip: 'library:talking' });
    expect(act.say).toBe('I told you to wait for me by the door.');
    // (Nine words: about four seconds.)
    expect(act.duration).toBeCloseTo(lineTime(act.say!), 1);
    expect(act.duration).toBeGreaterThan(3.5);
    expect(act.duration).toBeLessThan(4.5);
    expect(talking(act)).toBe(true);
    expect(actionLabel(act, store.scene)).toBe('“I told you to wait for me by the door.”');
    expect(lineAt(store.scene, act.duration / 2)).toBe(act.say);
    expect(lineAt(store.scene, act.duration + 0.5)).toBeNull();
    expect(parseScene(JSON.parse(JSON.stringify(store.scene)))!.animation!.actions.find((x) => x.id === id)!.say).toBe(act.say);
    // Taken away: a motion again.
    setLine(store, id, '');
    expect(store.scene.animation!.actions.find((x) => x.id === id)!.say).toBeUndefined();
    expect(sayLine(store, a, '   ')).toBeNull();
  });

  it('said in the middle of something, what they were doing carries on after it', () => {
    const { store, a } = fresh();
    const dance = captured('dancing');
    captured('talking');
    store.setTime(0);
    expect(applyMotion(store, a, dance)).toBe(true);
    const whole = actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'clip')!;
    store.setTime(2);
    const id = sayLine(store, a, 'Not now.')!;
    const after = actionsOf(store.scene.animation!, a).filter((x) => x.source.kind === 'clip');
    const len = lineTime('Not now.');
    expect(after.map((x) => (x.source as { clip: string }).clip)).toEqual([dance, 'library:talking', dance]);
    expect(after[1].start).toBeCloseTo(2, 3);
    // (On a frame: within one of the line's length.)
    expect(Math.abs(after[2].start - (2 + len))).toBeLessThan(1 / 24 + 1e-6);
    expect(after[1].id).toBe(id);
    // (The dance where it would have been, to its end.)
    expect(after[2].start + after[2].duration).toBeCloseTo(whole.start + whole.duration, 2);
  });

  it('someone sitting says it sitting', () => {
    const { store, a } = fresh();
    captured('talking');
    captured('sitting-talking');
    for (const m of ['stand-to-sit', 'sitting-idle', 'sit-to-stand']) captured(m);
    addProp(store, 'chair', [0, 0, 1]);
    store.setTime(0);
    expect(sitOn(store, a, store.scene.props[0].id)).toBeTruthy();
    store.setTime(store.getState().time + 1);
    const id = sayLine(store, a, 'Sit down.')!;
    const said = store.scene.animation!.actions.find((x) => x.id === id)!;
    // (At its own pace, going round for as long as it is said.)
    expect(said.source).toMatchObject({ clip: 'library:sitting-talking', loops: true });
    expect((said.source as { speed?: number }).speed).toBeUndefined();
    expect(said.duration).toBeCloseTo(lineTime('Sit down.'), 1);
  });
});
