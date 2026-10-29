import { describe, expect, it } from 'vitest';
import { addScene, addToBoard, cutShot, deleteScene, editProjectSettings, moveOnBoard, removeFromBoard, setCaption, setHold, startAnimation } from '@/lib/actions';
import { DEFAULT_HOLD, boardPanels, movePanel, newPanel, parseBoard, storyLength, storyShots } from '@/lib/board';
import { parseLibrary } from '@/lib/doc';
import { buildOtio } from '@/lib/otio';
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
  it('is the story: scenes in order, an animated one as its shots, a still one held; one caption per shot', () => {
    const store = new Store(new MemoryStorage());
    const first = store.scene.id;
    addToBoard(store);
    addScene(store);
    startAnimation(store, 3);
    store.setTime(1);
    cutShot(store);
    addToBoard(store);
    expect(panels(store).map((p) => p.sceneId)).toEqual([first, store.scene.id]);
    const story = () => storyShots(store.getState().library);
    // The still scene for its hold, then the animated one's two shots.
    expect(story().map((x) => [x.scene.id, x.span?.shot.name ?? null, x.length])).toEqual([[first, null, DEFAULT_HOLD], [store.scene.id, 'Shot 1', 1], [store.scene.id, 'Shot 2', 2]]);
    expect(storyLength(story())).toBe(DEFAULT_HOLD + 3);

    // Captions are the shots' (and a still scene's own), typed as one undo step.
    const shot = story()[2].span!.shot.id;
    setCaption(store, store.scene.id, shot, 'She turns');
    setCaption(store, store.scene.id, shot, 'She turns away');
    expect(story()[2].caption).toBe('She turns away');
    expect(store.scene.animation!.shots[1].caption).toBe('She turns away');
    store.undo();
    expect(story()[2].caption).toBe('');
    setCaption(store, first, null, 'Opening');
    expect(store.getState().library.scenes[0].caption).toBe('Opening');
    setHold(store, panels(store)[0].id, 3.5);
    expect(story()[0].length).toBe(3.5);

    const id = panels(store)[0].id;
    moveOnBoard(store, 0, 1);
    expect(panels(store)[1].id).toBe(id);
    removeFromBoard(store, id);
    expect(panels(store)).toHaveLength(1);
    store.undo();
    expect(panels(store)).toHaveLength(2);
  });

  it('cuts the whole story into one OTIO cut list, shot after shot', () => {
    const store = new Store(new MemoryStorage());
    addToBoard(store);
    addScene(store);
    startAnimation(store, 3);
    store.setTime(1);
    cutShot(store);
    addToBoard(store);
    const otio = buildOtio(storyShots(store.getState().library), 'Story', 'story.mp4');
    const clips = otio.tracks.children[0].children;
    expect(clips.map((c) => [c.name, c.source_range.start_time.value, c.source_range.duration.value])).toEqual([['Scene 1', 0, 48], ['Shot 1', 48, 24], ['Shot 2', 72, 48]]);
    expect(otio.metadata.pose_studio.duration).toBe(5);
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
    setHold(store, panels(store)[0].id, 3.5);
    editProjectSettings(store, { frame: '9:16', style: 'sketch' });
    const lib = parseLibrary(JSON.parse(JSON.stringify(store.getState().library)));
    expect(boardPanels(lib)).toEqual(panels(store));
    // The film settings travel with the project.
    expect(lib.settings).toEqual({ frame: '9:16', style: 'sketch' });

    const ids = new Set(['a']);
    expect(parseBoard('nope', ids)).toBeUndefined();
    expect(parseBoard([{ sceneId: 'missing' }], ids)).toBeUndefined();
    const [p] = parseBoard([{ sceneId: 'a', hold: 1e9, caption: 'gone' }, null], ids)!;
    expect(p).toEqual({ id: p.id, sceneId: 'a', hold: 60 });
  });

  it('moves panels within bounds only', () => {
    const b = [newPanel('a'), newPanel('b'), newPanel('c')];
    expect(movePanel(b, 2, 0).map((p) => p.sceneId)).toEqual(['c', 'a', 'b']);
    expect(movePanel(b, 0, 5)).toBe(b);
  });
});
