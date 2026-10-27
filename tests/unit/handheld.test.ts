import { describe, expect, it } from 'vitest';
import { addFigure, addProp, deleteFigure, holdProp } from '@/lib/actions';
import { newFigure, newProp, newScene, parseScene } from '@/lib/doc';
import { released } from '@/lib/hold';
import { SceneView } from '@/lib/sceneview';
import { Store } from '@/lib/store';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('props in the hand', () => {
  it('a handheld prop goes into the selected figure\'s free hand, which grips it', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    addProp(store, 'phone');
    addProp(store, 'cup');
    addProp(store, 'book'); // both hands busy: on the floor
    const [phone, cup, book] = store.scene.props;
    expect(phone.hold).toEqual({ figure: id, hand: 'R' });
    expect(cup.hold).toEqual({ figure: id, hand: 'L' });
    expect(book.hold).toBeUndefined();
    expect(store.figure!.hands.R.curl[1]).toBeGreaterThan(0.4);
    // Floor props stay on the floor.
    addProp(store, 'chair');
    expect(store.scene.props.at(-1)!.hold).toBeUndefined();
  });

  it('follows the hand: the prop rides on the wrist', () => {
    const store = new Store(new MemoryStorage());
    addProp(store, 'stick');
    const sv = new SceneView();
    sv.sync(store.scene);
    const stick = sv.props.get(store.scene.props[0].id)!;
    expect(stick.object.parent).toBe(sv.figures.get(store.figure!.id)!.joints.rightHand);
    sv.dispose();
  });

  it('lets go onto the floor where it was, and one prop per hand', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    addProp(store, 'phone');
    const phone = store.scene.props[0];
    const dropped = released(phone, store.scene);
    expect(dropped.hold).toBeUndefined();
    expect(dropped.position[1]).toBe(0);
    // It lands near the figure's right hand (x < 0 for a figure facing +Z).
    expect(dropped.position[0]).toBeLessThan(0);
    addProp(store, 'book');
    holdProp(store, store.scene.props[1].id, { figure: id, hand: 'R' }); // takes the phone's place
    expect(store.scene.props[0].hold).toBeUndefined();
    expect(store.scene.props[1].hold).toEqual({ figure: id, hand: 'R' });
    holdProp(store, store.scene.props[1].id, null);
    expect(store.scene.props[1].hold).toBeUndefined();
  });

  it('a deleted figure drops what it held; a file with a dangling hold loads it on the floor', () => {
    const store = new Store(new MemoryStorage());
    const first = store.figure!.id;
    addFigure(store);
    addProp(store, 'cup');
    deleteFigure(store, store.getState().activeFigure!);
    expect(store.scene.props[0].hold).toBeUndefined();
    expect(store.scene.figures.map((f) => f.id)).toEqual([first]);
    const scene = { ...newScene('S', [newFigure()]), props: [{ ...newProp('cup'), hold: { figure: 'gone', hand: 'L' } }] };
    expect(parseScene(JSON.parse(JSON.stringify(scene))).props[0].hold).toBeUndefined();
  });
});

describe('the floor is solid', () => {
  it('a figure not standing on the floor is lifted out of it; a prop too', () => {
    const f = { ...newFigure(), grounded: false, position: [0, -0.6, 0] as [number, number, number] };
    const scene = { ...newScene('S', [f]), props: [{ ...newProp('box'), position: [1, -0.3, 0] as [number, number, number], rotation: [30, 0, 20] as [number, number, number] }] };
    const sv = new SceneView();
    sv.sync(scene);
    expect(sv.figures.get(f.id)!.lowest()).toBeGreaterThanOrEqual(-1e-6);
    expect(sv.bounds().min.y).toBeGreaterThanOrEqual(-1e-6);
    sv.dispose();
  });
});
