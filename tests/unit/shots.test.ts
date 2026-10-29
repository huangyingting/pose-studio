import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyCameraMove, cutShot, deleteCamera, duplicateSelection, editShot, moveCameraPoint, moveShotCut, removeShotCut, editFilm, startAnimation } from '@/lib/actions';
import { cameraAt, liveCamera } from '@/lib/cameras';
import type { PathCamera, Scene } from '@/lib/types';
import { parseScene } from '@/lib/doc';
import { buildOtio } from '@/lib/otio';
import { describeShot } from '@/lib/prompt';
import { overLimit, shotSpans } from '@/lib/shots';
import { sceneShots } from '@/lib/board';
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

function animatedStore() {
  const store = new Store(new MemoryStorage());
  startAnimation(store, 4);
  return store;
}

describe('shots and cuts', () => {
  it('cuts at the playhead and films each shot with its own camera path', () => {
    const store = animatedStore();
    applyCameraMove(store, 'orbit90');
    store.setTime(2);
    cutShot(store);
    const a = store.scene.animation!;
    expect(shotSpans(a).map((s) => [s.start, s.end, s.shot.name])).toEqual([[0, 2, 'Shot 1'], [2, 4, 'Shot 2']]);
    // Both sides of the cut film as before it: the earlier shot ends where the path was, the new one starts from there.
    const at = (s: Scene, t: number) => cameraAt(s, t).position;
    expect(at(store.scene, 1.99).distanceTo(at(store.scene, 2.01))).toBeLessThan(0.1);
    // A move on shot 2 leaves shot 1 alone.
    const before = store.scene;
    applyCameraMove(store, 'push');
    expect(at(store.scene, 1).distanceTo(at(before, 1))).toBeLessThan(1e-6);
    const far = (s: Scene, t: number) => cameraAt(s, t).position.distanceTo(cameraAt(s, t).target);
    expect(far(store.scene, 3.99)).toBeLessThan(far(store.scene, 2) * 0.7);
  });

  it('names, captions, removes cuts and survives save/load', () => {
    const store = animatedStore();
    store.setTime(1);
    cutShot(store);
    const id = store.scene.animation!.shots![1].id;
    editShot(store, id, { caption: 'She turns' });
    const s = store.scene;
    expect(parseScene(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(describeShot(s)).toMatch(/Shot 2 \(1\.0–4\.0 s\):.*she turns/);
    removeShotCut(store, id);
    expect(shotSpans(store.scene.animation!)).toHaveLength(1);
  });

  it('flags shots longer than the model the film is cut for and writes an OTIO cut list', () => {
    const store = animatedStore();
    store.setTime(1);
    cutShot(store);
    editFilm(store, { target: 'wan' });
    const a = store.scene.animation!;
    const spans = shotSpans(a);
    expect(overLimit(spans[0])).toBe(false);
    expect(overLimit(shotSpans({ ...a, duration: 7 })[1])).toBe(true);
    const otio = buildOtio(sceneShots(store.scene), store.scene.name, 'clip.mp4');
    const clips = otio.tracks.children[0].children;
    expect(clips.map((c) => [c.name, c.source_range.start_time.value, c.source_range.duration.value])).toEqual([['Shot 1', 0, 24], ['Shot 2', 24, 72]]);
    expect(clips[0].media_references.DEFAULT_MEDIA.target_url).toBe('clip.mp4');
    expect(clips[1].metadata.pose_studio).toMatchObject({ cut_for: 'Wan', over_limit: false });
    editFilm(store, { target: null });
  });
});

describe('keyframe pack pieces', () => {
  it('computes standard CRC-32 and writes a valid zip directory', async () => {
    const { crc32, zip } = await import('@/lib/zip');
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const blob = zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(bytes.slice(30, 35))).toBe('a.txt');
  });

  it('describes casts naturally', async () => {
    const { buildStaging } = await import('@/lib/stagings');
    expect(describeShot(buildStaging('sparring')!)).toMatch(/two mannequin figures \(two men\)/i);
    expect(describeShot(buildStaging('waltz')!)).toMatch(/\(a man and a woman\)/);
  });

  it('moves one camera point (dragged on the canvas) as one undo step', () => {
    const store = animatedStore();
    applyCameraMove(store, 'orbit90');
    const cam = liveCamera(store.scene, 0)!.id;
    const points = () => (store.scene.cameras.find((c) => c.id === cam) as PathCamera).points;
    const [first, last] = [points()[0], points()[points().length - 1]];
    moveCameraPoint(store, cam, last.t, new THREE.Vector3(3, 2, 4), 'drag');
    moveCameraPoint(store, cam, last.t, new THREE.Vector3(4, 2, 4), 'drag');
    expect(points().at(-1)).toMatchObject({ t: last.t, position: [4, 2, 4], lens: last.lens });
    expect(points()[0]).toEqual(first);
    store.undo();
    expect(points().at(-1)).toEqual(last);
  });

  it('moves a cut (no camera changes) and sets a blend by dragging, within the shots around it', () => {
    const store = animatedStore();
    store.setTime(2);
    cutShot(store);
    const id = shotSpans(store.scene.animation!)[1].shot.id;
    const cameras = store.scene.cameras;
    moveShotCut(store, id, 1.5, 'drag');
    moveShotCut(store, id, 1.26, 'drag');
    expect(shotSpans(store.scene.animation!).map((s) => s.start)).toEqual([0, 1.25]);
    expect(store.scene.cameras).toBe(cameras);
    // Not past the shot before, nor onto it.
    moveShotCut(store, id, -3);
    expect(shotSpans(store.scene.animation!)[1].start).toBeCloseTo(1 / 24, 9);
    store.undo();
    store.undo();
    expect(shotSpans(store.scene.animation!)[1].start).toBe(2);
  });

  it('copies a camera as one of the user\'s own, and looks through it until it goes', () => {
    const store = animatedStore();
    const [first] = store.scene.cameras;
    store.select({ kind: 'camera', camera: first.id });
    expect(duplicateSelection(store)).toBe(true);
    const copy = store.scene.cameras[1];
    expect(copy).toMatchObject({ name: `${first.name} copy`, kind: first.kind });
    expect(store.getState().selection).toEqual({ kind: 'camera', camera: copy.id });
    store.lookThrough({ camera: copy.id });
    deleteCamera(store, copy.id);
    expect(store.getState().through).toBeNull();
    store.lookThrough({});
    expect(store.getState().through).toEqual({});
  });
});
