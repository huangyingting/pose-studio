import { afterEach, describe, expect, it, vi } from 'vitest';
import { newAnimation } from '@/lib/animation';
import { newFigure, newScene } from '@/lib/doc';
import { sceneAt } from '@/lib/evaluate';
import { PlayAhead, onGrid, type PlayAheadReply, type PlayAheadRequest } from '@/lib/playahead';
import { withPhysics } from '@/lib/physics';

/** A worker that keeps what it is asked, and answers when told to (as lib/playahead.worker.ts would). */
class FakeWorker {
  static last: FakeWorker;
  asked: PlayAheadRequest[] = [];
  onmessage: ((e: MessageEvent<PlayAheadReply>) => void) | null = null;
  constructor() { FakeWorker.last = this; }
  postMessage(m: PlayAheadRequest) { this.asked.push(m); }
  terminate() {}
  /** Work out frame k of the last scene sent, and send it back. */
  answer(k: number) {
    const s = [...this.asked].reverse().find((m) => m.type === 'scene') as Extract<PlayAheadRequest, { type: 'scene' }>;
    const at = sceneAt(s.scene, k / s.scene.animation!.fps / 2, true);
    this.onmessage?.({ data: { gen: s.gen, k, physics: withPhysics(s.scene), figures: at.figures, props: at.props } } as MessageEvent<PlayAheadReply>);
  }
}

const scene = () => {
  const s = newScene('Playing', [newFigure()]);
  return { ...s, animation: { ...newAnimation(s, 2), fps: 24 } };
};

afterEach(() => vi.unstubAllGlobals());

describe('playback worked out ahead (lib/playahead.ts)', () => {
  it('asks for the second ahead of the playhead, round the loop; draws a frame once it is worked out, the same as the page would', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const ahead = new PlayAhead();
    const s = scene();
    const span = { start: 0, end: 2, loop: true };
    // Not there yet: the page works it out itself.
    expect(ahead.at(s, onGrid(s, 1.5), span, 1)).toBeNull();
    const w = FakeWorker.last;
    expect(w.asked[0].type).toBe('scene');
    const frames = (w.asked.at(-1) as Extract<PlayAheadRequest, { type: 'frames' }>).frames;
    // (Behind: from a little further on; on a grid of twice 24 frames a second; past the end, from the start again.)
    expect(frames[0]).toBeGreaterThan(72);
    expect(frames).toContain(96);
    expect(frames).toContain(0);
    expect(frames.length).toBeLessThanOrEqual(48);
    // Worked out there: drawn from it, as the page would have.
    w.answer(80);
    const t = 80 / 48;
    expect(ahead.at(s, t, span, 1)?.figures).toEqual(sceneAt(s, t, true).figures);
    // An edit: worked out again from the new scene, the frames of the old one not drawn.
    const edited = { ...s, figures: s.figures.map((f) => ({ ...f, position: [1, 0, 0] as [number, number, number] })) };
    expect(ahead.at(edited, t, span, 1)).toBeNull();
    expect(w.asked.filter((m) => m.type === 'scene')).toHaveLength(2);
    // Stopped: what was asked for dropped, once.
    ahead.stop();
    ahead.stop();
    expect(w.asked.filter((m) => m.type === 'frames' && !m.frames.length)).toHaveLength(1);
  });

  it('without workers (an old browser, the tests), the page works every frame out itself', () => {
    vi.stubGlobal('Worker', undefined);
    const s = scene();
    expect(new PlayAhead().at(s, 0, { start: 0, end: 2, loop: false }, 1)).toBeNull();
  });
});
