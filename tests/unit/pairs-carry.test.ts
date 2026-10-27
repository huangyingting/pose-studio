import { describe, expect, it } from 'vitest';
import { BODY_PRESETS } from '@/lib/body';
import { PAIRS, expectGroup, expectStretcher } from '../fixtures/pairs';

describe('carried and danced together on every pairing of builds', () => {
  it('a stretcher carried off by two is clean, or declined when the one behind is much taller', () => {
    const declined = PAIRS.map((p) => expectStretcher(p)).filter(Boolean);
    expect(declined.length).toBeLessThan(PAIRS.length / 4);
  }, 600_000);

  it('a group dance of four builds is clean', () => {
    BODY_PRESETS.forEach((_, k) => expectGroup(k));
  }, 300_000);
});
