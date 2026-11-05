import { describe, it } from 'vitest';
import { BODY_PRESETS } from '@/lib/body';
import { expectCoverageClean } from '../fixtures/coverage';

describe('every scene template × coverage is clean', () => {
  it(`with builds from ${BODY_PRESETS[2].name} on`, () => expectCoverageClean(2), 900_000);
});
