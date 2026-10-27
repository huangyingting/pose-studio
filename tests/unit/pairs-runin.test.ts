import { describe, it } from 'vitest';
import { PAIRS, expectPair } from '../fixtures/pairs';

describe('a clinch and takedown after both walk in from apart, on every pairing of builds', () => {
  it('is clean: the one walking over gets there in time (or goes straight there), its steps planted', () => {
    for (const p of PAIRS) expectPair('takedown', p, true);
  }, 1_200_000);
});
