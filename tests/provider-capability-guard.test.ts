import { describe, expect, it } from 'vitest';

import { assertCurrentCapabilitySupported } from '../packages/providers/src/index.js';
import type { CapabilityGuardError } from '../packages/providers/src/index.js';

describe('Issue 013 capability guard', () => {
  it('permits only current non-stale SUPPORTED state', () => {
    expect(() =>
      assertCurrentCapabilitySupported({ capability: 'text', stale: false, state: 'SUPPORTED' }),
    ).not.toThrow();
  });

  it.each([
    ['UNKNOWN', false, 'CAPABILITY_UNKNOWN'],
    ['UNSUPPORTED', false, 'CAPABILITY_UNSUPPORTED'],
    ['SUPPORTED', true, 'CAPABILITY_STALE'],
  ] as const)('returns stable errors for %s stale=%s', (state, stale, code) => {
    expect(() =>
      assertCurrentCapabilitySupported({ capability: 'text', stale, state }),
    ).toThrowError(expect.objectContaining<Partial<CapabilityGuardError>>({ code }));
  });
});
