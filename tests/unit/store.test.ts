import { describe, expect, it } from 'vitest';
import { addFigure, addProp, deleteFigure, deleteScene, duplicateCurrentScene, moveScene } from '@/lib/actions';
import { builtInPoses, poseScene } from '@/lib/poses';

/** The 20 reference poses as scenes. */
const refScenes = () => builtInPoses().map((p) => poseScene(p));
import { decodeScene, encodeScene, sceneParam } from '@/lib/share';
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

describe('share links', () => {
  it('round-trips a scene through the URL fragment encoding', async () => {
    const scene = refScenes()[5];
    const encoded = await encodeScene(scene);
    expect(encoded).toMatch(/^[\w-]+$/);
    expect(await decodeScene(encoded)).toEqual(scene);
    expect(sceneParam(`#scene=${encoded}`)).toBe(encoded);
  });

  it('rejects garbage', async () => {
    await expect(decodeScene('not-a-real-link')).rejects.toThrow();
  });
});

/** Storage holding a project of the 20 reference scenes (a new project has just one blank scene). */
function seeded() {
  const storage = new MemoryStorage();
  storage.setItem(Store.LIBRARY_KEY, JSON.stringify({ version: 2, scenes: refScenes() }));
  return storage;
}

describe('Store', () => {
  it('starts a new project with one blank scene', () => {
    expect(new Store(new MemoryStorage()).getState().library.scenes.map((s) => s.name)).toEqual(['Scene 1']);
  });

  it('undoes and redoes edits', () => {
    const store = new Store(seeded());
    const before = store.scene.name;
    store.updateScene((s) => ({ ...s, name: 'Renamed' }));
    expect(store.scene.name).toBe('Renamed');
    expect(store.getState().canUndo).toBe(true);
    store.undo();
    expect(store.scene.name).toBe(before);
    store.redo();
    expect(store.scene.name).toBe('Renamed');
  });

  it('merges continuous edits with the same key into one undo step', () => {
    const store = new Store(seeded());
    const name = store.scene.name;
    for (let i = 0; i < 10; i++) store.updateScene((s) => ({ ...s, name: `Take ${i}` }), 'drag');
    store.undo();
    expect(store.scene.name).toBe(name); // as it was, not Take 8
  });

  it('clears the selection when its target disappears', () => {
    const store = new Store(seeded());
    addProp(store, 'box');
    const sel = store.getState().selection;
    expect(sel?.kind).toBe('prop');
    store.undo();
    expect(store.getState().selection).toBeNull();
  });

  it('keeps an active figure and never deletes the last one', () => {
    const store = new Store(seeded());
    const first = store.getState().activeFigure!;
    expect(first).toBe(store.scene.figures[0].id);
    addFigure(store);
    expect(store.scene.figures).toHaveLength(2);
    const second = store.getState().activeFigure!;
    expect(second).not.toBe(first);
    expect(deleteFigure(store, second)).toBe(true);
    expect(store.getState().activeFigure).toBe(first);
    expect(deleteFigure(store, first)).toBe(false);
  });

  it('persists the library and restores it', async () => {
    const storage = seeded();
    const a = new Store(storage);
    duplicateCurrentScene(a);
    a.save();
    const b = new Store(storage);
    expect(b.getState().library.scenes).toHaveLength(21);
    expect(b.getState().sceneIndex).toBe(1);
  });

  it('never deletes the last pose', () => {
    const storage = seeded();
    storage.setItem(Store.LIBRARY_KEY, JSON.stringify({ version: 2, scenes: [refScenes()[0]] }));
    const store = new Store(storage);
    expect(deleteScene(store)).toBe(false);
  });

  it('reports storage failures instead of throwing', () => {
    const storage = seeded();
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    const store = new Store(storage);
    store.save();
    expect(store.saveError).toMatch(/Quota/);
  });

  it('undo brings the edited pose back into view', () => {
    const store = new Store(seeded());
    store.setSceneIndex(3);
    store.updateScene((s) => ({ ...s, name: 'Edited' }));
    store.setSceneIndex(10);
    store.undo();
    expect(store.getState().sceneIndex).toBe(3);
    expect(store.scene.name).not.toBe('Edited');
    store.setSceneIndex(0);
    store.redo();
    expect(store.getState().sceneIndex).toBe(3);
    expect(store.scene.name).toBe('Edited');
  });

  it('undoing a new pose returns to the pose it was added after', () => {
    const store = new Store(seeded());
    store.setSceneIndex(5);
    duplicateCurrentScene(store);
    expect(store.getState().sceneIndex).toBe(6);
    store.undo();
    expect(store.getState().sceneIndex).toBe(5);
    store.redo();
    expect(store.getState().sceneIndex).toBe(6);
    expect(store.scene.name).toMatch(/copy$/);
  });

  it('reordering keeps the open pose selected', () => {
    const store = new Store(seeded());
    store.setSceneIndex(2);
    const id = store.scene.id;
    moveScene(store, 0, 5);
    expect(store.scene.id).toBe(id);
    expect(store.getState().sceneIndex).toBe(1);
    moveScene(store, 1, 0);
    expect(store.getState().sceneIndex).toBe(0);
    expect(store.scene.id).toBe(id);
  });

  it('adopts a library saved by another tab', () => {
    const storage = seeded();
    const a = new Store(storage);
    a.save();
    const b = new Store(storage);
    b.setSceneIndex(4);
    const id = b.scene.id;
    deleteScene(a, 0);
    a.save();
    expect(b.adoptExternal(storage.getItem(Store.LIBRARY_KEY))).toBe(true);
    expect(b.getState().library.scenes).toHaveLength(19);
    expect(b.scene.id).toBe(id);
    expect(b.getState().canUndo).toBe(false);
    expect(b.adoptExternal('{nonsense')).toBe(false);
  });
});

describe('share link limits', () => {
  it('refuses links that inflate to more than 1 MB', async () => {
    const big = new TextEncoder().encode(' '.repeat(3_000_000));
    const deflated = new Uint8Array(await new Response(new Blob([big]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    let bin = '';
    for (const b of deflated) bin += String.fromCharCode(b);
    const encoded = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(encoded.length).toBeLessThan(200_000);
    await expect(decodeScene(encoded)).rejects.toThrow(/too large/);
  });
});
