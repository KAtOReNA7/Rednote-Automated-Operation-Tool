import type { BriefDependency, ContentBriefDraft } from '@mystery-operations/briefs';

import {
  COPY_CONTRACT_VERSION,
  COPY_FORMAT_POLICY_VERSION,
  COPY_OUTPUT_SCHEMA_VERSION,
  COPY_PROFILE_REGISTRY,
  COPY_PROFILE_REGISTRY_VERSION,
  COPY_SYSTEM_LOCKED_PATHS,
  COPY_VOICE_POLICY_VERSION,
} from './constants.js';
import {
  assertContentDraftPayload,
  briefSnapshotFromDraft,
  type ContentDraftPayloadV1,
  type DraftBlockV1,
  type DraftFieldStateV1,
} from './contracts.js';

export interface ManualCopyScaffoldInput {
  readonly briefId: string;
  readonly briefInputHash: string;
  readonly briefLockHash: string;
  readonly briefVersionId: string;
  readonly dependencies: readonly BriefDependency[];
  readonly draft: ContentBriefDraft;
}

export function buildManualCopyScaffold(input: ManualCopyScaffoldInput): ContentDraftPayloadV1 {
  const brief = briefSnapshotFromDraft(input);
  const profile = COPY_PROFILE_REGISTRY[brief.profileId];
  const blocks: DraftBlockV1[] = profile.requiredBlockKinds.map((kind, index) => {
    const slot = input.draft.structurePlan.slots[index];
    return Object.freeze({
      blockId: `block-${index + 1}`,
      kind,
      lineage:
        slot === undefined
          ? Object.freeze([])
          : Object.freeze([
              Object.freeze({
                argumentId: null,
                briefFieldPath: `structurePlan.slots.${slot.slotId}`,
                evidenceRefIds: Object.freeze([]),
                experienceAssertionId: null,
                inputHash: input.briefInputHash,
                provenance: 'SYSTEM_DERIVED' as const,
                structureSlotId: slot.slotId,
                workId: null,
              }),
            ]),
      order: index,
      provenance: 'SYSTEM_DERIVED' as const,
      text: '待填写',
    });
  });
  const fieldStates: DraftFieldStateV1[] = [
    ...COPY_SYSTEM_LOCKED_PATHS.map((path) =>
      Object.freeze({
        lock: 'SYSTEM_LOCKED' as const,
        path,
        provenance: 'SYSTEM_DERIVED' as const,
      }),
    ),
    Object.freeze({
      lock: 'EDITABLE' as const,
      path: 'selectedTitle',
      provenance: 'SYSTEM_DERIVED' as const,
    }),
    ...blocks.map(({ blockId }) =>
      Object.freeze({
        lock: 'EDITABLE' as const,
        path: `blocks.${blockId}`,
        provenance: 'SYSTEM_DERIVED' as const,
      }),
    ),
    Object.freeze({
      lock: 'EDITABLE' as const,
      path: 'tags',
      provenance: 'SYSTEM_DERIVED' as const,
    }),
    Object.freeze({
      lock: 'EDITABLE' as const,
      path: 'pinnedComment',
      provenance: 'SYSTEM_DERIVED' as const,
    }),
    Object.freeze({
      lock: 'EDITABLE' as const,
      path: 'spoilerWarnings',
      provenance: 'SYSTEM_DERIVED' as const,
    }),
  ];
  return assertContentDraftPayload({
    blocks,
    brief,
    contractVersion: COPY_CONTRACT_VERSION,
    fieldStates,
    formatPolicyVersion: COPY_FORMAT_POLICY_VERSION,
    pinnedComment: null,
    profileId: brief.profileId,
    profileVersion: COPY_PROFILE_REGISTRY_VERSION,
    schemaVersion: COPY_OUTPUT_SCHEMA_VERSION,
    selectedTitleId: null,
    spoilerWarnings: {
      bodyOpeningWarningText: null,
      coverWarningText: null,
      pinnedCommentWarningText: null,
      provenance: 'SYSTEM_DERIVED',
      titleWarningMarker: null,
    },
    tags: [],
    titles: [],
    voicePolicyVersion: COPY_VOICE_POLICY_VERSION,
  });
}
