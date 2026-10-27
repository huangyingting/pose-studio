import { describe, expect, it } from 'vitest';
import { PAIRS, expectPair } from '../fixtures/pairs';

describe('a waltz turn on every pairing of builds', () => {
  it('is clean, or declined when the builds cannot do it together', () => {
    const declined = PAIRS.map((p) => expectPair('waltz-turn', p)).filter(Boolean);
    expect(declined.length).toBeLessThan(PAIRS.length / 4);
  }, 600_000);
});
