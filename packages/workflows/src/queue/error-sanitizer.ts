export interface SafeJobError {
  readonly code: string;
  readonly summary: string;
}

export class JobHandlerExecutionError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'JobHandlerExecutionError';
    this.code = code;
  }
}

function sanitizeText(value: string): string {
  return value
    .replaceAll(/bearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replaceAll(
      /((?:api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)[^\s,;]+/giu,
      '$1[REDACTED]',
    )
    .slice(0, 1000);
}

function sanitizeErrorCode(value: string): string {
  const trimmed = value.trim();
  return /^[A-Z][A-Z0-9_]{0,127}$/u.test(trimmed) ? trimmed : 'HANDLER_FAILED';
}

export function sanitizeJobError(error: unknown): SafeJobError {
  if (error instanceof JobHandlerExecutionError) {
    return {
      code: sanitizeErrorCode(error.code),
      summary: sanitizeText(error.message),
    };
  }
  if (error instanceof Error) {
    return {
      code: 'HANDLER_FAILED',
      summary: sanitizeText(error.message),
    };
  }
  return {
    code: 'HANDLER_FAILED',
    summary: sanitizeText(String(error)),
  };
}
