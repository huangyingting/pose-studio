import { describe, expect, it } from 'vitest';
import { PAIRS, expectStretcher } from '../fixtures/pairs';

describe('carried together on every pairing of builds', () => {
  it('a stretcher carried off by two is clean, or declined when the one behind is much taller', () => {
    const declined = PAIRS.map((p) => expectStretcher(p)).filter(Boolean);
    expect(declined.length).toBeLessThan(PAIRS.length / 4);
  }, 1_200_000);
});
