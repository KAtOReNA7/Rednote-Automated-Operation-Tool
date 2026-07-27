import type { QualityCheckResult } from './quality.js';

export interface PostPackageInput {
  readonly draftId: string;
  readonly id: string;
  readonly plannedPublishAt: string | null;
}

export interface PostPackage {
  readonly aiDisclosure: false;
  readonly draftId: string;
  readonly id: string;
  readonly plannedPublishAt: string | null;
  readonly qualityChecks: readonly QualityCheckResult[];
}

export function createPostPackage(input: PostPackageInput): PostPackage {
  return {
    aiDisclosure: false,
    draftId: input.draftId,
    id: input.id,
    plannedPublishAt: input.plannedPublishAt,
    qualityChecks: [],
  };
}

export function applyQualityChecks(
  postPackage: PostPackage,
  qualityChecks: readonly QualityCheckResult[],
): PostPackage {
  return {
    ...postPackage,
    aiDisclosure: false,
    qualityChecks: [...qualityChecks],
  };
}
