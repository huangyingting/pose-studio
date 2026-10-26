import { describe, expect, it } from 'vitest';
import { sampleCamera } from '@/lib/animation';
import { applyCameraMove, cutShot, editCameraKey, editShot, removeShotCut, setTargetModel, startAnimation } from '@/lib/actions';
import { parseScene } from '@/lib/doc';
import { buildOtio } from '@/lib/otio';
import { describeShot } from '@/lib/prompt';
import { overLimit, shotSpans } from '@/lib/shots';
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
  it('cuts at the playhead and frames each shot with its own camera keys', () => {
    const store = animatedStore();
    applyCameraMove(store, 'orbit90');
    store.setTime(2);
    cutShot(store);
    const a = store.scene.animation!;
    expect(shotSpans(a).map((s) => [s.start, s.end, s.shot.name])).toEqual([[0, 2, 'Shot 1'], [2, 4, 'Shot 2']]);
    // The new shot holds the framing it was cut on.
    const before = sampleCamera(a, 1.99)!;
    const after = sampleCamera(a, 2.01)!;
    expect(Math.abs(after.yaw - sampleCamera(a, 2)!.yaw)).toBeLessThan(0.5);
    expect(Math.abs(after.yaw - before.yaw)).toBeLessThan(5);
    // A move on shot 2 leaves shot 1 alone.
    applyCameraMove(store, 'push');
    const b = store.scene.animation!;
    expect(sampleCamera(b, 1)!.yaw).toBeCloseTo(sampleCamera(a, 1)!.yaw, 3);
    expect(sampleCamera(b, 3.99)!.zoom).toBeGreaterThan(1.5);
    expect(sampleCamera(b, 1)!.zoom).toBeCloseTo(1.1, 2);
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

  it('flags shots longer than the target model and writes an OTIO cut list', () => {
    const store = animatedStore();
    store.setTime(1);
    cutShot(store);
    setTargetModel(store, 'wan');
    const a = store.scene.animation!;
    const spans = shotSpans(a);
    expect(overLimit(a, spans[0])).toBe(false);
    expect(overLimit({ ...a, target: 'wan', duration: 7 }, shotSpans({ ...a, duration: 7 })[1])).toBe(true);
    const otio = buildOtio(store.scene, 'clip.mp4');
    const clips = otio.tracks.children[0].children;
    expect(clips.map((c) => [c.name, c.source_range.start_time.value, c.source_range.duration.value])).toEqual([['Shot 1', 0, 24], ['Shot 2', 24, 72]]);
    expect(clips[0].media_references.DEFAULT_MEDIA.target_url).toBe('clip.mp4');
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
    const { MOTIONS } = await import('@/lib/motions');
    const boxing = MOTIONS.find((m) => m.id === 'boxing')!.build();
    expect(describeShot(boxing)).toMatch(/two mannequin figures \(two men\)/i);
    const waltz = MOTIONS.find((m) => m.id === 'waltz-turn')!.build();
    expect(describeShot(waltz)).toMatch(/\(a man and a woman\)/);
  });

  it('edits one camera key (dragged in the viewport) as one undo step', () => {
    const store = animatedStore();
    applyCameraMove(store, 'orbit90');
    const keys = () => store.scene.animation!.camera!.keys;
    const [first, last] = [keys()[0], keys()[keys().length - 1]];
    editCameraKey(store, last.t, { yaw: 120, zoom: 1.5 }, 'drag');
    editCameraKey(store, last.t, { yaw: 130, zoom: 1.8 }, 'drag');
    expect(keys().at(-1)).toMatchObject({ t: last.t, yaw: 130, zoom: 1.8, pitch: last.pitch });
    expect(keys()[0]).toEqual(first);
    store.undo();
    expect(keys().at(-1)).toEqual(last);
  });
});
