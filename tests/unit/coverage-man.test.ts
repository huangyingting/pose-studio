import { describe, it } from 'vitest';
import { BODY_PRESETS } from '@/lib/body';
import { expectCoverageClean } from '../fixtures/coverage';

describe('every scene template × coverage is clean', () => {
  it(`with builds from ${BODY_PRESETS[1].name} on`, () => expectCoverageClean(1), 900_000);
});
