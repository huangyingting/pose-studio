import { describe, expect, it } from 'vitest';
import { addScene, addToBoard, deleteScene, editPanel, moveOnBoard, removeFromBoard, startAnimation } from '@/lib/actions';
import { DEFAULT_HOLD, boardDuration, boardPanels, movePanel, newPanel, parseBoard } from '@/lib/board';
import { parseLibrary } from '@/lib/doc';
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

const panels = (store: Store) => boardPanels(store.getState().library);

describe('storyboard', () => {
  it('adds, edits, reorders and removes panels with undo', () => {
    const store = new Store(new MemoryStorage());
    const first = store.scene.id;
    addToBoard(store);
    addScene(store);
    startAnimation(store, 3);
    addToBoard(store);
    expect(panels(store).map((p) => p.sceneId)).toEqual([first, store.scene.id]);
    // A still pose holds for the default time, an animation for its length.
    expect(panels(store).map((p) => p.hold)).toEqual([DEFAULT_HOLD, 3]);
    expect(boardDuration(panels(store))).toBe(5);

    const id = panels(store)[0].id;
    editPanel(store, id, { caption: 'She turns' });
    editPanel(store, id, { caption: 'She turns away' });
    expect(panels(store)[0].caption).toBe('She turns away');
    store.undo();
    // Typing into one caption is one undo step.
    expect(panels(store)[0].caption).toBeUndefined();
    store.redo();

    moveOnBoard(store, 0, 1);
    expect(panels(store)[1].id).toBe(id);
    removeFromBoard(store, id);
    expect(panels(store)).toHaveLength(1);
    store.undo();
    expect(panels(store)).toHaveLength(2);
  });

  it('drops panels whose pose was deleted', () => {
    const store = new Store(new MemoryStorage());
    addScene(store);
    addToBoard(store);
    deleteScene(store, store.getState().sceneIndex);
    expect(panels(store)).toEqual([]);
  });

  it('round-trips through the library file and survives bad input', () => {
    const store = new Store(new MemoryStorage());
    addToBoard(store);
    editPanel(store, panels(store)[0].id, { caption: 'Opening', hold: 3.5 });
    const lib = parseLibrary(JSON.parse(JSON.stringify(store.getState().library)));
    expect(boardPanels(lib)).toEqual(panels(store));

    const ids = new Set(['a']);
    expect(parseBoard('nope', ids)).toBeUndefined();
    expect(parseBoard([{ sceneId: 'missing' }], ids)).toBeUndefined();
    const [p] = parseBoard([{ sceneId: 'a', hold: 1e9, caption: 5 }, null], ids)!;
    expect(p.hold).toBe(60);
    expect(p.caption).toBeUndefined();
    expect(p.id).toBeTruthy();
  });

  it('moves panels within bounds only', () => {
    const b = [newPanel('a'), newPanel('b'), newPanel('c')];
    expect(movePanel(b, 2, 0).map((p) => p.sceneId)).toEqual(['c', 'a', 'b']);
    expect(movePanel(b, 0, 5)).toBe(b);
  });
});
