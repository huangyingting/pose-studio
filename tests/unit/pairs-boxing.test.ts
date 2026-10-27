import { describe, expect, it } from 'vitest';
import { PAIRS, expectPair } from '../fixtures/pairs';

describe('a boxing exchange on every pairing of builds', () => {
  it('is clean, or declined when the builds cannot do it together', () => {
    const declined = PAIRS.map((p) => expectPair('boxing', p)).filter(Boolean);
    expect(declined.length).toBeLessThan(PAIRS.length / 4);
  }, 1_200_000);
});
