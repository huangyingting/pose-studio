import { describe, expect, it } from 'vitest';
import { addFigure, addProp, holdProp, moveProp, setPropPhysics, startAnimation, throwProp } from '@/lib/actions';
import { figurePoseAt, sceneAt, propWorldAt } from '@/lib/evaluate';
import { duplicateScene, parseLibrary } from '@/lib/doc';
import { handPosition } from '@/lib/propmotion';
import { Store } from '@/lib/store';
import type { Scene } from '@/lib/types';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const where = (scene: Scene, id: string, t: number) => propWorldAt(scene, id, t)!.position;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A figure holding a ball in its right hand, animated. */
function thrower() {
  const store = new Store(new MemoryStorage());
  const id = store.figure!.id;
  addProp(store, 'sphere');
  const ball = store.scene.props[0].id;
  holdProp(store, ball, { figure: id, hand: 'R' });
  startAnimation(store, 2);
  store.setTime(0.5);
  return { store, id, ball };
}

describe('props over time: carried, thrown, caught, dropped', () => {
  it('throws from the hand to a floor point, flying in an arc', () => {
    const { store, id, ball } = thrower();
    const span = throwProp(store, ball, { at: [2, 1] })!;
    const scene = store.scene;
    // Held until the throw, leaving from the hand.
    expect(sceneAt(scene, span.from - 0.1).props[0].hold?.figure).toBe(id);
    const release = where(scene, ball, span.from);
    expect(dist(release, handPosition(figurePoseAt(scene, id, span.from)!, 'R'))).toBeLessThan(0.25);
    // Up and over, then down on the floor at the target.
    const mid = where(scene, ball, (span.from + span.to) / 2);
    const land = where(scene, ball, span.to);
    expect(mid[1]).toBeGreaterThan(Math.max(release[1], land[1]));
    // (It is a real bounce: the floor takes a little off it as it lands.)
    expect(land[0]).toBeCloseTo(2, 1);
    expect(land[2]).toBeCloseTo(1, 1);
    expect(land[1]).toBeCloseTo(0, 1);
    expect(store.getState().time).toBeCloseTo(span.to, 3);
  });

  it('bounces and grips as set for it', () => {
    const { store, ball } = thrower();
    const span = throwProp(store, ball, { at: [2, 1] })!;
    const after = span.to + 0.25;
    setPropPhysics(store, ball, { bounce: 0 });
    expect(store.scene.props[0].physics).toEqual({ bounce: 0, friction: 0.15 });
    const dead = where(store.scene, ball, after)[1];
    setPropPhysics(store, ball, { bounce: 0.95, friction: 2 });
    expect(store.scene.props[0].physics).toEqual({ bounce: 0.95, friction: 1 });
    // A lively ball is back up off the floor a moment after it lands; a dead one is not.
    expect(where(store.scene, ball, after)[1]).toBeGreaterThan(dead + 0.05);
    setPropPhysics(store, ball, null);
    expect(store.scene.props[0].physics).toBeUndefined();
  });

  it('passes to another figure, who catches it in a hand', () => {
    const { store, ball } = thrower();
    addFigure(store, [2.5, 0, 0]);
    const catcher = store.getState().activeFigure!;
    store.setTime(0.5);
    const span = throwProp(store, ball, { figure: catcher, hand: 'L' })!;
    const scene = store.scene;
    const caught = sceneAt(scene, span.to + 0.2).props[0];
    expect(caught.hold).toEqual({ figure: catcher, hand: 'L' });
    expect(dist(where(scene, ball, span.to), handPosition(figurePoseAt(scene, catcher, span.to)!, 'L'))).toBeLessThan(0.25);
  });

  it('let go, it falls to the floor', () => {
    const { store, ball } = thrower();
    holdProp(store, ball, null);
    const scene = store.scene;
    const y0 = where(scene, ball, 0.5)[1];
    expect(y0).toBeGreaterThan(0.5);
    expect(where(scene, ball, 0.7)[1]).toBeLessThan(y0);
    // Down on the floor, bouncing.
    const low = Math.min(...Array.from({ length: 60 }, (_, i) => where(scene, ball, 0.55 + i / 40)[1]));
    expect(low).toBeCloseTo(0, 2);
  });

  it('moving a prop in an animated scene keys it, from where it was', () => {
    const store = new Store(new MemoryStorage());
    addProp(store, 'box', [1, 0, 0]);
    const box = store.scene.props[0].id;
    startAnimation(store, 2);
    store.setTime(1);
    moveProp(store, box, { position: [1, 0, 2] });
    expect(sceneAt(store.scene, 0).props[0].position).toEqual([1, 0, 0]);
    expect(sceneAt(store.scene, 0.5).props[0].position[2]).toBeGreaterThan(0.2);
    expect(sceneAt(store.scene, 1).props[0].position).toEqual([1, 0, 2]);
  });

  it('keeps prop keys in files and in duplicated scenes', () => {
    const { store, id, ball } = thrower();
    throwProp(store, ball, { at: [2, 1] });
    const lib = parseLibrary(JSON.parse(JSON.stringify(store.getState().library)));
    const scene = lib.scenes[0];
    // Where it starts (in the hand), and the throw that handles it (where it sends it).
    expect(scene.animation!.props![ball]).toHaveLength(1);
    expect(scene.animation!.actions.find((x) => x.prop === ball)!.target).toEqual({ at: [2, 1] });
    const copy = duplicateScene(scene);
    const newBall = copy.props[0].id;
    const newFigure = copy.figures[0].id;
    expect(newBall).not.toBe(ball);
    const held = copy.animation!.props![newBall].find((k) => k.hold)!;
    expect(held.hold!.figure).toBe(newFigure);
    expect(newFigure).not.toBe(id);
    expect(copy.animation!.actions.find((x) => x.prop === newBall)!.roles[0].figure).toBe(newFigure);
  });
});
