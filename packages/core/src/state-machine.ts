import { ContentStatus } from './statuses.js';

const CONTENT_TRANSITIONS: Readonly<Record<ContentStatus, readonly ContentStatus[]>> = {
  [ContentStatus.IDEA]: [ContentStatus.RESEARCHING, ContentStatus.ARCHIVED],
  [ContentStatus.RESEARCHING]: [
    ContentStatus.RESEARCH_READY,
    ContentStatus.FACT_BLOCKED,
    ContentStatus.ARCHIVED,
  ],
  [ContentStatus.RESEARCH_READY]: [ContentStatus.DRAFTING, ContentStatus.ARCHIVED],
  [ContentStatus.DRAFTING]: [
    ContentStatus.REVIEW_REQUIRED,
    ContentStatus.GENERATION_FAILED,
    ContentStatus.ARCHIVED,
  ],
  [ContentStatus.REVIEW_REQUIRED]: [
    ContentStatus.APPROVAL_READY,
    ContentStatus.FACT_BLOCKED,
    ContentStatus.GENERATION_FAILED,
    ContentStatus.VISUAL_FAILED,
    ContentStatus.USER_REJECTED,
    ContentStatus.ARCHIVED,
  ],
  [ContentStatus.APPROVAL_READY]: [
    ContentStatus.APPROVED,
    ContentStatus.USER_REJECTED,
    ContentStatus.ARCHIVED,
  ],
  [ContentStatus.APPROVED]: [
    ContentStatus.EXPORT_READY,
    ContentStatus.USER_REJECTED,
    ContentStatus.ARCHIVED,
  ],
  [ContentStatus.EXPORT_READY]: [
    ContentStatus.EXPORTED,
    ContentStatus.VISUAL_FAILED,
    ContentStatus.ARCHIVED,
  ],
  [ContentStatus.EXPORTED]: [ContentStatus.MANUALLY_PUBLISHED, ContentStatus.ARCHIVED],
  [ContentStatus.MANUALLY_PUBLISHED]: [ContentStatus.MEASURED, ContentStatus.ARCHIVED],
  [ContentStatus.MEASURED]: [ContentStatus.ARCHIVED],
  [ContentStatus.FACT_BLOCKED]: [ContentStatus.RESEARCHING, ContentStatus.ARCHIVED],
  [ContentStatus.GENERATION_FAILED]: [ContentStatus.DRAFTING, ContentStatus.ARCHIVED],
  [ContentStatus.VISUAL_FAILED]: [ContentStatus.REVIEW_REQUIRED, ContentStatus.ARCHIVED],
  [ContentStatus.USER_REJECTED]: [ContentStatus.DRAFTING, ContentStatus.ARCHIVED],
  [ContentStatus.ARCHIVED]: [],
};

export class InvalidContentStatusTransitionError extends Error {
  public readonly from: ContentStatus;
  public readonly to: ContentStatus;

  public constructor(from: ContentStatus, to: ContentStatus) {
    super(`Invalid content status transition: ${from} -> ${to}`);
    this.name = 'InvalidContentStatusTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function allowedContentTransitions(from: ContentStatus): readonly ContentStatus[] {
  return CONTENT_TRANSITIONS[from];
}

export function canTransitionContentStatus(from: ContentStatus, to: ContentStatus): boolean {
  return CONTENT_TRANSITIONS[from].includes(to);
}

export function transitionContentStatus(from: ContentStatus, to: ContentStatus): ContentStatus {
  if (!canTransitionContentStatus(from, to)) {
    throw new InvalidContentStatusTransitionError(from, to);
  }

  return to;
}
