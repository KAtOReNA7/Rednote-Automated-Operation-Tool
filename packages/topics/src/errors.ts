export type TopicErrorCode =
  | 'TOPIC_CAPACITY_EXCEEDED'
  | 'TOPIC_CONFIRMATION_INVALID'
  | 'TOPIC_CONFLICT'
  | 'TOPIC_DUPLICATE'
  | 'TOPIC_INVALID_CONTRACT'
  | 'TOPIC_INVALID_REQUEST'
  | 'TOPIC_NOT_FOUND'
  | 'TOPIC_PLAN_CONFLICT'
  | 'TOPIC_PLAN_NOT_FOUND'
  | 'TOPIC_POLICY_BLOCKED'
  | 'TOPIC_PROFILE_NOT_FOUND'
  | 'TOPIC_STALE_REVISION'
  | 'TOPIC_SUBJECT_NOT_FOUND';

export class TopicError extends Error {
  public readonly code: TopicErrorCode;
  public readonly retryable: boolean;
  public readonly safeDetails: Readonly<Record<string, boolean | number | string>>;

  public constructor(
    code: TopicErrorCode,
    options: {
      readonly retryable?: boolean;
      readonly safeDetails?: Readonly<Record<string, boolean | number | string>>;
    } = {},
  ) {
    super(code);
    this.name = 'TopicError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.safeDetails = Object.freeze({ ...(options.safeDetails ?? {}) });
  }
}
