import { describe, expect, it } from 'vitest';

import {
  ContentStatus,
  EXCEPTION_CONTENT_STATUSES,
  InvalidContentStatusTransitionError,
  STANDARD_CONTENT_STATUSES,
  allowedContentTransitions,
  transitionContentStatus,
} from '../packages/core/src/index.js';

describe('content status machine', () => {
  it('follows the complete standard lifecycle', () => {
    for (const [index, from] of STANDARD_CONTENT_STATUSES.slice(0, -1).entries()) {
      const to = STANDARD_CONTENT_STATUSES[index + 1];
      if (to === undefined) {
        throw new Error(`Missing standard status after ${from}.`);
      }

      expect(transitionContentStatus(from, to)).toBe(to);
    }
  });

  it('rejects backward, skipped, and self transitions', () => {
    const illegalTransitions = [
      [ContentStatus.IDEA, ContentStatus.APPROVED],
      [ContentStatus.RESEARCH_READY, ContentStatus.IDEA],
      [ContentStatus.APPROVED, ContentStatus.APPROVED],
      [ContentStatus.ARCHIVED, ContentStatus.IDEA],
    ] as const;

    for (const [from, to] of illegalTransitions) {
      expect(() => transitionContentStatus(from, to)).toThrow(InvalidContentStatusTransitionError);
    }
  });

  it('enters and recovers from each recoverable exception explicitly', () => {
    const paths = [
      [ContentStatus.RESEARCHING, ContentStatus.FACT_BLOCKED, ContentStatus.RESEARCHING],
      [ContentStatus.DRAFTING, ContentStatus.GENERATION_FAILED, ContentStatus.DRAFTING],
      [ContentStatus.EXPORT_READY, ContentStatus.VISUAL_FAILED, ContentStatus.REVIEW_REQUIRED],
      [ContentStatus.APPROVAL_READY, ContentStatus.USER_REJECTED, ContentStatus.DRAFTING],
    ] as const;

    for (const [from, exception, recovery] of paths) {
      expect(transitionContentStatus(from, exception)).toBe(exception);
      expect(transitionContentStatus(exception, recovery)).toBe(recovery);
    }
  });

  it('treats archive as terminal and reachable from every non-archived state', () => {
    for (const status of Object.values(ContentStatus)) {
      if (status === ContentStatus.ARCHIVED) {
        expect(allowedContentTransitions(status)).toEqual([]);
      } else {
        expect(allowedContentTransitions(status)).toContain(ContentStatus.ARCHIVED);
      }
    }
  });

  it('keeps the exception status set limited to product-defined failures', () => {
    expect(EXCEPTION_CONTENT_STATUSES).toEqual([
      ContentStatus.FACT_BLOCKED,
      ContentStatus.GENERATION_FAILED,
      ContentStatus.VISUAL_FAILED,
      ContentStatus.USER_REJECTED,
      ContentStatus.ARCHIVED,
    ]);
  });
});
