import { describe, expect, it } from 'vitest';
import {
  addFigure, addProp, addStandIn, applyPhotoPose, cutShot, deleteSelection, duplicateSelection, nextName, renameProp, startAnimation,
} from '@/lib/actions';
import { newFigure, parseScene } from '@/lib/doc';
import { withAngles } from '@/lib/pose';
import { keyTimesOf } from '@/lib/track';
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

describe('names, selection and editing', () => {
  it('names new things uniquely', () => {
    expect(nextName('Chair', [])).toBe('Chair');
    expect(nextName('Chair', ['Chair'])).toBe('Chair 2');
    expect(nextName('Chair 2', ['Chair', 'Chair 2'])).toBe('Chair 3');
    const store = new Store(new MemoryStorage());
    addProp(store, 'chair');
    addProp(store, 'chair');
    addStandIn(store);
    expect(store.scene.props.map((p) => p.name)).toEqual(['Chair', 'Chair 2']);
    expect(store.scene.figures.map((f) => f.name)).toEqual(['Figure', 'Stand-in']);
  });

  it('adds things where asked, in one undo step', () => {
    const store = new Store(new MemoryStorage());
    addFigure(store, [1.5, 0, -2]);
    expect(store.figure!.position).toEqual([1.5, 0, -2]);
    expect(store.getState().selection).toEqual({ kind: 'figure', figure: store.figure!.id });
    addProp(store, 'box', [0, 0, 3]);
    expect(store.scene.props[0].position).toEqual([0, 0, 3]);
    store.undo();
    expect(store.scene.props).toHaveLength(0);
  });

  it('renames props; names survive saving and loading', () => {
    const store = new Store(new MemoryStorage());
    addProp(store, 'wall');
    const id = store.scene.props[0].id;
    renameProp(store, id, 'Kitchen wall');
    expect(parseScene(JSON.parse(JSON.stringify(store.scene))).props[0].name).toBe('Kitchen wall');
    // A prop saved without a name gets its kind's label.
    const bare = { ...store.scene, props: [{ ...store.scene.props[0], name: undefined }] };
    expect(parseScene(JSON.parse(JSON.stringify(bare))).props[0].name).toBe('Wall');
  });

  it('deletes and duplicates the selection', () => {
    const store = new Store(new MemoryStorage());
    const first = store.figure!.id;
    // The last figure stays.
    store.select({ kind: 'figure', figure: first });
    expect(deleteSelection(store)).toBeNull();
    expect(duplicateSelection(store)).toBe(true);
    expect(store.scene.figures.map((f) => f.name)).toEqual(['Figure', 'Figure 2']);
    expect(deleteSelection(store)).toBe('Figure 2');
    expect(store.scene.figures).toHaveLength(1);

    addProp(store, 'stool');
    expect(duplicateSelection(store)).toBe(true);
    expect(deleteSelection(store)).toBe('Stool 2');
    expect(store.scene.props.map((p) => p.name)).toEqual(['Stool']);

    // A joint: duplicate copies its figure; delete does nothing (it is not the whole figure).
    store.select({ kind: 'joint', figure: first, joint: 'leftLowerArm' });
    expect(deleteSelection(store)).toBeNull();
    expect(duplicateSelection(store)).toBe(true);
    expect(store.scene.figures).toHaveLength(2);

    // A shot: delete removes the cut before it (the first shot has none).
    startAnimation(store, 2);
    store.setTime(1);
    cutShot(store);
    const [one, two] = store.scene.animation!.shots!;
    store.select({ kind: 'shot', shot: one.id });
    expect(deleteSelection(store)).toBeNull();
    store.select({ kind: 'shot', shot: two.id });
    expect(deleteSelection(store)).toBe(`the cut before ${two.name}`);
    expect(store.scene.animation!.shots).toHaveLength(1);
    store.select(null);
    expect(deleteSelection(store)).toBeNull();
    expect(duplicateSelection(store)).toBe(false);
  });
});

describe('pose from a photo', () => {
  it('goes on the selected figure as a library pose does (keyed, one undo step), the others beside it', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    store.updateFigure(id, (f) => ({ ...f, position: [3, 0, 2] }));
    startAnimation(store, 2);
    store.setTime(1);
    const bent = withAngles(newFigure().bones, { leftLowerLeg: [60, 0, 0] });
    const people = [newFigure({ bones: bent, position: [-0.5, 0, 0] }), newFigure({ position: [0.7, 0, 0] })];
    const before = store.scene;
    applyPhotoPose(store, people, id);
    const s = store.scene;
    expect(keyTimesOf(s.animation!, id)).toEqual([0, 1]);
    expect(s.figures[1].position).toEqual([4.2, 0, 2]);
    expect(s.cameras.map((c) => c.name)).toEqual(['Camera 1', 'Photo camera']);
    store.undo();
    expect(store.scene).toEqual(before);
  });
});
