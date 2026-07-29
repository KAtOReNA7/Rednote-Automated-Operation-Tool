export type CatalogErrorCode =
  | 'CATALOG_CONFIRMATION_EXPIRED'
  | 'CATALOG_CONFIRMATION_INVALID'
  | 'CATALOG_CONFLICT'
  | 'CATALOG_ENTITY_NOT_FOUND'
  | 'CATALOG_INVALID_IDENTIFIER'
  | 'CATALOG_INVALID_OBSERVATION'
  | 'CATALOG_INVALID_PLAN'
  | 'CATALOG_INVALID_REQUEST'
  | 'CATALOG_RUN_NOT_FOUND'
  | 'CATALOG_STALE_REVISION';

export class CatalogError extends Error {
  public readonly code: CatalogErrorCode;
  public readonly retryable: boolean;
  public readonly safeDetails: Readonly<Record<string, boolean | number | string>>;

  public constructor(
    code: CatalogErrorCode,
    options: {
      readonly retryable?: boolean;
      readonly safeDetails?: Readonly<Record<string, boolean | number | string>>;
    } = {},
  ) {
    super(code);
    this.name = 'CatalogError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.safeDetails = options.safeDetails ?? {};
  }
}

export function isCatalogError(value: unknown): value is CatalogError {
  return value instanceof CatalogError;
}
