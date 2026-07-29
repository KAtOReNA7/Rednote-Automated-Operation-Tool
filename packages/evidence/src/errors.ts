export const EVIDENCE_ERROR_CODES = Object.freeze([
  'EVIDENCE_CONFIRMATION_EXPIRED',
  'EVIDENCE_CONFIRMATION_INVALID',
  'EVIDENCE_CONFLICT',
  'EVIDENCE_INVALID_CLAIM',
  'EVIDENCE_INVALID_LOCATOR',
  'EVIDENCE_INVALID_PLAN',
  'EVIDENCE_INVALID_REQUEST',
  'EVIDENCE_INVALID_SOURCE',
  'EVIDENCE_NOT_FOUND',
  'EVIDENCE_POLICY_BLOCKED',
  'EVIDENCE_STALE_REVISION',
] as const);

export type EvidenceErrorCode = (typeof EVIDENCE_ERROR_CODES)[number];

export class EvidenceError extends Error {
  public readonly code: EvidenceErrorCode;
  public readonly retryable: boolean;

  public constructor(code: EvidenceErrorCode, retryable = false) {
    super(code);
    this.name = 'EvidenceError';
    this.code = code;
    this.retryable = retryable;
  }
}
