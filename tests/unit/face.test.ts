import { describe, expect, it } from 'vitest';
import { blinkAt, faceAt } from '@/lib/face';
import type { Animation } from '@/lib/types';

const anim = (clip: string, duration = 4): Animation => ({
  duration, fps: 24, loop: false, shots: [{ id: 'main', start: 0, name: 'Shot 1', camera: 'c' }],
  actions: [{ id: 'a', start: 0, duration, roles: [{ figure: 'f' }], source: { kind: 'clip', clip: clip } }],
});

describe('a character\'s face as it plays (#15)', () => {
  it('blinks now and then: a few times in ten seconds, each a sixth of a second, at its own times', () => {
    const shut = (id: string) => Array.from({ length: 2400 }, (_, i) => blinkAt(id, i / 240)).filter((v) => v > 0.5).length / 240;
    expect(shut('a')).toBeGreaterThan(0.08 * 2);
    expect(shut('a')).toBeLessThan(0.08 * 5);
    const times = (id: string) => Array.from({ length: 2400 }, (_, i) => i / 240).filter((t) => blinkAt(id, t) > 0.9).map((t) => Math.round(t));
    expect(times('a')).not.toEqual(times('b'));
  });

  it('talks while it talks, shows what it feels as it does it, eased in, and blinks', () => {
    const talk = anim('library:talking');
    const open = Array.from({ length: 96 }, (_, i) => faceAt(talk, 'f', 0.5 + i / 32)).filter((f) => (f.aa ?? 0) + (f.oh ?? 0) + (f.ee ?? 0) + (f.ou ?? 0) + (f.ih ?? 0) > 0.3).length;
    expect(open).toBeGreaterThan(20);
    expect(faceAt(anim('library:crying'), 'f', 2).sad).toBe(1);
    expect(faceAt(anim('library:crying'), 'f', 0.05).sad!).toBeLessThan(0.2);
    expect(faceAt(anim('library:laughing'), 'f', 2).happy).toBe(1);
    // Nothing to feel standing idle: only the blinks.
    expect(Object.keys(faceAt(anim('library:idle'), 'f', 2)).filter((k) => k !== 'blink')).toEqual([]);
  });
});
