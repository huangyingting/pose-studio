import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The thumbnails' queue (lib/previews.ts): one waits for what it shows (a set's models…); not come
 * in a while, it is shown as it is for now, not kept, and drawn again and kept once it has come.
 */
describe('thumbnails waiting for what they show', () => {
  // (Each with a queue of its own: the module afresh.)
  let requestThumb: typeof import('@/lib/previews').requestThumb;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    ({ requestThumb } = await import('@/lib/previews'));
  });
  afterEach(() => vi.useRealTimers());

  it('one not ready is shown as it is after a while, drawn again and kept once it is ready', async () => {
    let ready = false;
    let n = 0;
    const make = vi.fn(() => `url:${++n}:${ready ? 'whole' : 'part'}`);
    const got: string[] = [];
    requestThumb('test:waits', make, (u) => got.push(u), () => ready);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(got).toEqual([]);
    // (Not come in fifteen seconds: shown as it is, for now.)
    await vi.advanceTimersByTimeAsync(6_000);
    expect(got).toEqual(['url:1:part']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(make).toHaveBeenCalledTimes(1);
    // Come: drawn again, and kept (asked for again, at once).
    ready = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(got).toEqual(['url:1:part', 'url:2:whole']);
    const again: string[] = [];
    requestThumb('test:waits', make, (u) => again.push(u), () => true);
    expect(again).toEqual(['url:2:whole']);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('one that never comes is given up on unkept: asked for again, it is drawn again', async () => {
    const make = vi.fn(() => 'url:part');
    const got: string[] = [];
    requestThumb('test:never', make, (u) => got.push(u), () => false);
    await vi.advanceTimersByTimeAsync(130_000);
    expect(got).toEqual(['url:part']);
    const again: string[] = [];
    requestThumb('test:never', make, (u) => again.push(u), () => false);
    expect(again).toEqual([]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(again).toEqual(['url:part']);
  });

  it('one ready at once is drawn and kept', async () => {
    const make = vi.fn(() => 'url:now');
    const got: string[] = [];
    requestThumb('test:now', make, (u) => got.push(u));
    await vi.advanceTimersByTimeAsync(100);
    expect(got).toEqual(['url:now']);
    requestThumb('test:now', make, (u) => got.push(u));
    expect(got).toEqual(['url:now', 'url:now']);
    expect(make).toHaveBeenCalledTimes(1);
  });
});
