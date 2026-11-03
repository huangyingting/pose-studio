import { describe, expect, it } from 'vitest';
import { lineTime, sayLine, setLine, sitOn, addProp } from '@/lib/actions';
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
    expect(store.scene.animation!.actions.find((x) => x.id === id)!.source).toMatchObject({ clip: 'library:sitting-talking' });
  });
});
