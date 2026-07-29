export type DossierErrorCode =
  | 'DOSSIER_CAPACITY_EXCEEDED'
  | 'DOSSIER_CONFIRMATION_INVALID'
  | 'DOSSIER_CONFLICT'
  | 'DOSSIER_INPUT_CHANGED'
  | 'DOSSIER_INVALID_CONTRACT'
  | 'DOSSIER_INVALID_PLAN'
  | 'DOSSIER_INVALID_REQUEST'
  | 'DOSSIER_NOT_FOUND'
  | 'DOSSIER_POLICY_STALE'
  | 'DOSSIER_STALE_REVISION';

export class DossierError extends Error {
  public readonly code: DossierErrorCode;
  public readonly retryable: boolean;
  public readonly safeDetails: Readonly<Record<string, boolean | number | string>>;

  public constructor(
    code: DossierErrorCode,
    options: {
      readonly retryable?: boolean;
      readonly safeDetails?: Readonly<Record<string, boolean | number | string>>;
    } = {},
  ) {
    super(code);
    this.name = 'DossierError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.safeDetails = Object.freeze({ ...(options.safeDetails ?? {}) });
  }
}
