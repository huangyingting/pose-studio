import { describe, expect, it } from 'vitest';
import { addScene, cutShot, editProjectSettings, moveScene, setCaption, setHold, setInStory, startAnimation } from '@/lib/actions';
import { DEFAULT_HOLD, storyLength, storyScenes, storyShots } from '@/lib/board';
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

const inStory = (store: Store) => storyScenes(store.getState().library).map((s) => s.id);

describe('storyboard', () => {
  it('is the story: the scenes in order, an animated one as its shots, a still one held; one caption per shot', () => {
    const store = new Store(new MemoryStorage());
    const first = store.scene.id;
    addScene(store);
    startAnimation(store, 3);
    store.setTime(1);
    cutShot(store);
    expect(inStory(store)).toEqual([first, store.scene.id]);
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
    setHold(store, first, 3.5);
    expect(story()[0].length).toBe(3.5);

    // One order: moving a scene in the list moves it in the story; one left out is not in it.
    const second = store.scene.id;
    moveScene(store, 0, 1);
    expect(inStory(store)).toEqual([second, first]);
    setInStory(store, first, false);
    expect(inStory(store)).toEqual([second]);
    expect(store.getState().library.scenes).toHaveLength(2);
    store.undo();
    expect(inStory(store)).toEqual([second, first]);
  });

  it('cuts the whole story into one OTIO cut list, shot after shot', () => {
    const store = new Store(new MemoryStorage());
    addScene(store);
    startAnimation(store, 3);
    store.setTime(1);
    cutShot(store);
    const otio = buildOtio(storyShots(store.getState().library), 'Story', 'story.mp4');
    const clips = otio.tracks.children[0].children;
    expect(clips.map((c) => [c.name, c.source_range.start_time.value, c.source_range.duration.value])).toEqual([['Scene 1', 0, 48], ['Shot 1', 48, 24], ['Shot 2', 72, 48]]);
    expect(otio.metadata.pose_studio.duration).toBe(5);
  });

  it('round-trips through the library file and survives bad input', () => {
    const store = new Store(new MemoryStorage());
    const id = store.scene.id;
    setHold(store, id, 3.5);
    addScene(store);
    setInStory(store, store.scene.id, false);
    editProjectSettings(store, { frame: '9:16', style: 'sketch' });
    const lib = parseLibrary(JSON.parse(JSON.stringify(store.getState().library)));
    expect(storyScenes(lib).map((s) => [s.id, s.hold])).toEqual([[id, 3.5]]);
    // The project settings travel with the project.
    expect(lib.settings).toEqual({ frame: '9:16', style: 'sketch' });
    const bad = parseLibrary({ scenes: [{ ...lib.scenes[0], hold: 1e9, offStory: 'yes' }] });
    expect([bad.scenes[0].hold, bad.scenes[0].offStory]).toEqual([60, undefined]);
  });
});
