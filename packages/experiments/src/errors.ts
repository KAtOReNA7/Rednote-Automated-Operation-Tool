export type ExperimentErrorCode =
  | 'EXPERIMENT_CONFIRMATION_INVALID'
  | 'EXPERIMENT_CONFLICT'
  | 'EXPERIMENT_INVALID_CONTRACT'
  | 'EXPERIMENT_NOT_FOUND'
  | 'EXPERIMENT_POLICY_BLOCKED'
  | 'EXPERIMENT_STALE_REVISION'
  | 'EXPERIMENT_UNSUPPORTED';

export class ExperimentError extends Error {
  public readonly code: ExperimentErrorCode;
  public readonly retryable: boolean;

  public constructor(code: ExperimentErrorCode, options: { readonly retryable?: boolean } = {}) {
    super(code);
    this.name = 'ExperimentError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
