import { describe, expect, it } from 'vitest';
import { setDuration, frameTimes } from '@/lib/animation';
import { partKeys } from '@/lib/clip';
import { figurePoseAt, sceneAt } from '@/lib/evaluate';
import { addFigure, addKeyframe, applyCameraMove, applyMotion, deleteFigure, deleteKeyframe, moveKeyframe, startAnimation } from '@/lib/actions';
import { BODY_PRESETS } from '@/lib/body';
import { duplicateScene, mirrorScene, newFigure, newScene, parseScene } from '@/lib/doc';
import { jointLimits } from '@/lib/joints';
import { MOTIONS } from '@/lib/motions';
import { describeShot } from '@/lib/prompt';
import { checkMotion } from '@/lib/qa';
import { withFacing } from '@/lib/relations';
import { Store } from '@/lib/store';
import { keyAtTime, keyTimesOf, keysAction, moveKeyTo, removeKeyAt, setPoseAt } from '@/lib/track';
import type { Figure, JointName, Scene } from '@/lib/types';
import { angle, anglesOf, facingOf, withAngles } from '@/lib/pose';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const withKnee = (f: Figure, deg: number): Figure => ({ ...f, bones: withAngles(f.bones, { leftLowerLeg: [deg, 0, 0] }) });

/** One figure keyed at these times. */
function keyed(keys: [number, Figure][], loop = false, duration = 2): Scene {
  const s = newScene('Test', [keys[0][1]]);
  return { ...s, animation: { duration, fps: 24, loop, actions: [keysAction(s.figures[0].id, keys.map(([t, pose]) => ({ t, pose })))] } };
}

function twoKeyScene(loop = false) {
  const f = newFigure();
  return keyed([[0, withKnee(f, 0)], [1, withKnee(f, 60)]], loop);
}

const kneeAt = (s: Scene, t: number) => angle(figurePoseAt(s, s.figures[0].id, t)!.bones, 'leftLowerLeg')[0];

describe('keyframe sampling', () => {
  it('passes exactly through the keys and in between', () => {
    const s = twoKeyScene();
    expect(kneeAt(s, 0)).toBe(0);
    expect(kneeAt(s, 1)).toBe(60);
    const mid = kneeAt(s, 0.5);
    expect(mid).toBeGreaterThan(20);
    expect(mid).toBeLessThan(40);
    // Holds the last key after it (no loop).
    expect(kneeAt(s, 1.8)).toBe(60);
  });

  it('loops smoothly back to the first key', () => {
    const s = twoKeyScene(true);
    expect(kneeAt(s, 1.5)).toBeGreaterThan(10);
    expect(kneeAt(s, 1.5)).toBeLessThan(50);
    expect(kneeAt(s, 1.999)).toBeLessThan(2);
  });

  it('turns the short way across ±180°', () => {
    const f = newFigure();
    const s = keyed([[0, withFacing(f, 170)], [1, withFacing(f, -170)]]);
    expect(Math.abs(facingOf(figurePoseAt(s, f.id, 0.5)!.bones))).toBeGreaterThan(170);
  });

  it('adds, moves and removes keys on the frame grid', () => {
    const s = twoKeyScene();
    const id = s.figures[0].id;
    let a = setPoseAt(s, id, 0.51, s.figures[0]);
    expect(keyTimesOf(a, id)).toEqual([0, 0.5, 1]);
    a = moveKeyTo(a, id, 0.5, 1.25);
    expect(keyTimesOf(a, id)).toEqual([0, 1, 1.25]);
    expect(keyTimesOf(moveKeyTo(a, id, 1.25, 1), id)).toEqual([0, 1, 1.25]); // occupied
    a = removeKeyAt(a, id, 1);
    expect(keyAtTime(a, id, 1)).toBeNull();
    expect(keyTimesOf(setDuration(a, 4), id)).toEqual([0, 2.5]);
    expect(frameTimes({ ...a, duration: 1, fps: 24, loop: true }, 4)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('survives save/load, duplication and mirroring', () => {
    const s = twoKeyScene();
    expect(parseScene(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const copy = duplicateScene(s);
    expect(copy.animation!.actions.map((x) => x.roles[0].figure)).toEqual([copy.figures[0].id]);
    const m = mirrorScene(s);
    expect(angle(figurePoseAt(m, s.figures[0].id, 1)!.bones, 'rightLowerLeg')[0]).toBe(60);
  });
});

describe('animation in the store', () => {
  it('auto-keys edits at the playhead and follows the playhead', () => {
    const store = new Store(new MemoryStorage());
    startAnimation(store);
    const id = store.scene.figures[0].id;
    const knee0 = angle(store.scene.figures[0].bones, 'leftLowerLeg')[0];
    store.setTime(1);
    store.updateFigure(id, (f) => withKnee(f, 45));
    expect(keyTimesOf(store.scene.animation!, id)).toEqual([0, 1]);
    store.setTime(0);
    expect(angle(store.scene.figures[0].bones, 'leftLowerLeg')[0]).toBe(knee0);
    store.setTime(1);
    expect(angle(store.scene.figures[0].bones, 'leftLowerLeg')[0]).toBe(45);
    // Undo removes the key and puts the figure back.
    store.undo();
    expect(keyTimesOf(store.scene.animation!, id)).toHaveLength(1);
    expect(angle(store.scene.figures[0].bones, 'leftLowerLeg')[0]).toBe(knee0);
    addKeyframe(store);
    expect(keyTimesOf(store.scene.animation!, id)).toHaveLength(2);
  });

  it('opens animated poses at their first frame', () => {
    const storage = new MemoryStorage();
    const a = new Store(storage);
    a.updateScene(() => MOTIONS[0].build());
    a.setTime(0.5);
    a.save();
    const b = new Store(storage);
    const s = b.scene;
    expect(b.getState().time).toBe(0);
    expect(s.figures[0].bones).toEqual(sceneAt(s, 0).figures[0].bones);
  });
});

describe('shot camera', () => {
  it('applies camera moves and describes the shot', () => {
    const store = new Store(new MemoryStorage());
    applyCameraMove(store, 'orbit360');
    const text = describeShot(store.scene);
    expect(text).toMatch(/360° orbit/);
    expect(text).toMatch(/mannequin figure/);
  });
});

describe('animation templates', () => {
  it('gives motions that pass the motion check (no slides, pops, bad joints or people through each other)', () => {
    for (const m of MOTIONS) expect(checkMotion(m.build()).map((i) => i.message), m.id).toEqual([]);
  }, 60_000);

  it('keeps one-person motions clean on figures of every build (feet locked, travel scaled)', () => {
    for (const preset of BODY_PRESETS) {
      for (const m of MOTIONS.filter((x) => x.people === 1)) {
        const store = new Store(new MemoryStorage());
        const id = store.figure!.id;
        store.updateScene((s) => ({ ...s, figures: s.figures.map((f) => ({ ...f, body: { ...preset.body } })) }));
        applyMotion(store, id, m.id);
        expect(checkMotion(store.scene).map((i) => i.message), `${m.id} on ${preset.name}`).toEqual([]);
      }
    }
  }, 300_000);


  it('builds every motion with valid keys within joint limits', () => {
    for (const m of MOTIONS) {
      const s = m.build();
      const a = s.animation!;
      expect(s.figures, m.id).toHaveLength(m.people);
      expect(a.actions.length, m.id).toBeGreaterThan(m.people - 1);
      // Only what the people do: no cameras, no set.
      expect(a.cameras ?? a.shots ?? s.props[0], m.id).toBeUndefined();
      expect(parseScene(JSON.parse(JSON.stringify(s)))).toEqual(s);
      for (const x of a.actions) {
        if (x.source.kind !== 'keys') continue;
        for (const k of partKeys(x.source.clip.parts[0])) {
          for (const [j, r] of Object.entries(anglesOf(k.pose.bones))) {
            if (j === 'hips') continue;
            const lim = jointLimits(j as JointName);
            r!.forEach((v, i) => {
              expect(v, `${m.id} ${j}[${i}] at ${k.t}`).toBeGreaterThanOrEqual(lim[i][0] - 0.5);
              expect(v, `${m.id} ${j}[${i}] at ${k.t}`).toBeLessThanOrEqual(lim[i][1] + 0.5);
            });
          }
        }
      }
    }
  }, 60_000);
});

describe('per-figure tracks', () => {
  function duo() {
    const store = new Store(new MemoryStorage());
    const [a, b] = [newFigure({ name: 'A' }), newFigure({ name: 'B', position: [1, 0, 0] })];
    store.updateScene((s) => ({ ...s, figures: [a, b] }));
    startAnimation(store, 2);
    return { store, a: a.id, b: b.id };
  }
  const keys = (store: Store, id: string) => keyTimesOf(store.scene.animation!, id);
  const knee = (store: Store, id: string, t: number) => angle(figurePoseAt(store.scene, id, t)!.bones, 'leftLowerLeg')[0];
  const bend = (store: Store, id: string, deg: number) => store.updateFigure(id, (f) => withKnee(f, deg));

  it('keys only the figure that was posed', () => {
    const { store, a, b } = duo();
    store.setTime(1);
    bend(store, a, 60);
    expect(keys(store, a)).toEqual([0, 1]);
    expect(keys(store, b)).toEqual([0]);
    // B did not move.
    expect(knee(store, b, 1)).toBe(knee(store, b, 0));
  });

  it('retimes and deletes one figure\'s keys without touching the other\'s', () => {
    const { store, a, b } = duo();
    store.setTime(1);
    bend(store, a, 60);
    bend(store, b, 40);
    expect([...keys(store, a), ...keys(store, b)]).toEqual([0, 1, 0, 1]);
    // A's punch later; B's reaction stays at 1 s.
    moveKeyframe(store, 1, 1.5, a);
    expect(keys(store, a)).toEqual([0, 1.5]);
    expect(keys(store, b)).toEqual([0, 1]);
    expect(knee(store, b, 1)).toBe(40);
    // Moving onto a time where the figure already has a key is refused.
    moveKeyframe(store, 1.5, 0, a);
    expect(keys(store, a)).toEqual([0, 1.5]);
    store.setTime(1.5);
    store.setActiveFigure(a);
    deleteKeyframe(store);
    expect(keys(store, a)).toEqual([0]);
    expect(keys(store, b)).toEqual([0, 1]);
    // A figure keeps its last key.
    store.setTime(0);
    deleteKeyframe(store, a);
    expect(keys(store, a)).toEqual([0]);
  });

  it('K keys the active figure; deleting a figure drops its track', () => {
    const { store, a, b } = duo();
    store.setTime(0.5);
    store.setActiveFigure(b);
    addKeyframe(store);
    expect(keys(store, b)).toEqual([0, 0.5]);
    expect(keys(store, a)).toEqual([0]);
    addKeyframe(store, [a, b]);
    expect(keys(store, a)).toEqual([0, 0.5]);
    deleteFigure(store, b);
    expect(store.scene.animation!.actions.every((x) => x.roles.every((r) => r.figure !== b))).toBe(true);
  });

  it('a figure added later stays put until it is keyed', () => {
    const { store } = duo();
    store.setTime(1);
    addFigure(store);
    const c = store.getState().activeFigure!;
    expect(keys(store, c)).toEqual([0]);
    expect(knee(store, c, 0)).toBe(knee(store, c, 2));
  });
});
