import { assertCapability, createMockCapabilities } from './capabilities.js';
import {
  assertImageBytes,
  sanitizeSchemaIssues,
  validateCallContext,
  validateImageGenerationRequest,
  validateJsonValueLimits,
  validateRuntimeSchema,
  validateTextRequest,
  validateVisionRequest,
} from './content.js';
import {
  type ImageGenerationProvider,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ProviderCallContext,
  type ProviderOperation,
  type RuntimeSchema,
  type StructuredGenerationProvider,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
  type TextGenerationProvider,
  type TextGenerationRequest,
  type TextGenerationResult,
  type VisionGenerationRequest,
  type VisionProvider,
} from './contracts.js';
import {
  ProviderError,
  type OutcomeCertainty,
  type ProviderCauseCategory,
  type ProviderErrorCode,
  type RetryDisposition,
} from './errors.js';
import { safeIdentifierReference } from './redaction.js';
import { PROVIDER_LIMITS } from './response-limits.js';
import { emptyProviderUsage, type ProviderUsage } from './usage.js';

export const MOCK_ERROR_SCENARIOS = Object.freeze([
  'NETWORK_UNREACHABLE',
  'RATE_LIMIT',
  'TIMEOUT',
  'ABORT',
  'UPSTREAM_4XX',
  'UPSTREAM_5XX',
  'INVALID_CONTENT_TYPE',
  'INVALID_JSON',
  'SCHEMA_MISMATCH',
  'MALFORMED_USAGE',
  'RESPONSE_TOO_LARGE',
  'AMBIGUOUS_DISCONNECT',
  'CAPABILITY_UNKNOWN',
  'CAPABILITY_UNSUPPORTED',
] as const);
export type MockErrorScenario = (typeof MOCK_ERROR_SCENARIOS)[number];

interface MockStepBase {
  readonly delayMs?: number;
}

export type MockProviderStep =
  | (MockStepBase & {
      readonly text: string;
      readonly type: 'TEXT_SUCCESS';
      readonly usage?: ProviderUsage;
    })
  | (MockStepBase & {
      readonly type: 'STRUCTURED_SUCCESS';
      readonly usage?: ProviderUsage;
      readonly value: unknown;
    })
  | (MockStepBase & {
      readonly text: string;
      readonly type: 'VISION_SUCCESS';
      readonly usage?: ProviderUsage;
    })
  | (MockStepBase & {
      readonly bytes?: Uint8Array;
      readonly type: 'IMAGE_SUCCESS';
      readonly usage?: ProviderUsage;
    })
  | (MockStepBase & { readonly type: 'REFUSAL' })
  | (MockStepBase & {
      readonly retryAfterMs?: number;
      readonly scenario: MockErrorScenario;
      readonly type: 'ERROR';
    });

export interface MockClock {
  nowMilliseconds(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface MockSafeCall {
  readonly modelReference: string;
  readonly operation: ProviderOperation;
  readonly providerId: string;
  readonly requestId: string;
}

const defaultMockClock: MockClock = {
  nowMilliseconds: () => 0,
  sleep: (milliseconds, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, milliseconds);
      const abort = (): void => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
    }),
};

const TINY_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII=',
    'base64',
  ),
);

export class ScriptedMockProvider
  implements
    TextGenerationProvider,
    StructuredGenerationProvider,
    VisionProvider,
    ImageGenerationProvider
{
  readonly #calls: MockSafeCall[] = [];
  readonly #clock: MockClock;
  readonly #script: MockProviderStep[];

  public constructor(script: readonly MockProviderStep[], clock: MockClock = defaultMockClock) {
    this.#script = [...script];
    this.#clock = clock;
  }

  public getSafeCalls(): readonly MockSafeCall[] {
    return Object.freeze(this.#calls.map((call) => Object.freeze({ ...call })));
  }

  public async generateText(
    request: TextGenerationRequest,
    context: ProviderCallContext,
  ): Promise<TextGenerationResult> {
    this.#assertMockContext(context, 'TEXT_GENERATION', 'text');
    validateTextRequest(request, context);
    const startedAt = this.#clock.nowMilliseconds();
    const step = await this.#take(context, ['TEXT_SUCCESS', 'REFUSAL', 'ERROR']);
    if (step.type === 'ERROR') {
      throw this.#scenarioError(step, context);
    }
    if (step.type === 'REFUSAL') {
      return this.#textResult('', context, startedAt, step, true);
    }
    return this.#textResult(step.text, context, startedAt, step, false);
  }

  public async generateStructured<T>(
    request: StructuredGenerationRequest,
    schema: RuntimeSchema<T>,
    context: ProviderCallContext,
  ): Promise<StructuredGenerationResult<T>> {
    this.#assertMockContext(context, 'STRUCTURED_GENERATION', 'structuredJson');
    validateTextRequest(request, context);
    validateRuntimeSchema(schema, context);
    const startedAt = this.#clock.nowMilliseconds();
    const step = await this.#take(context, ['STRUCTURED_SUCCESS', 'REFUSAL', 'ERROR']);
    if (step.type === 'ERROR') {
      throw this.#scenarioError(step, context);
    }
    if (step.type === 'REFUSAL') {
      throw this.#basicError(
        'PROVIDER_REFUSAL',
        context,
        'PROTOCOL',
        'COMPLETED_INVALID_OUTPUT',
        'RETRY_MANUAL',
      );
    }
    validateJsonValueLimits(step.value, context);
    const validation = schema.validate(step.value);
    if (!validation.ok) {
      const issue = sanitizeSchemaIssues(validation.issues)[0];
      throw new ProviderError('PROVIDER_SCHEMA_VALIDATION_FAILED', {
        causeCategory: 'SCHEMA',
        details: {
          issueCode: issue?.code ?? 'SCHEMA_VALIDATION_FAILED',
          issuePath: issue?.path ?? [],
          schemaId: schema.id,
          schemaVersion: schema.version,
        },
        modelId: context.modelId,
        operation: context.operation,
        outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
        providerId: context.providerId,
        requestId: context.requestId,
        retryDisposition: 'RETRY_MANUAL',
      });
    }
    return Object.freeze({
      finishReason: 'STOP',
      latencyMs: Math.max(0, this.#clock.nowMilliseconds() - startedAt),
      modelId: context.modelId,
      protocolMode: 'MOCK',
      providerRequestId: null,
      usage: step.usage ?? emptyProviderUsage(),
      value: validation.value,
      warnings: step.usage?.warnings ?? emptyProviderUsage().warnings,
    });
  }

  public async analyzeVision(
    request: VisionGenerationRequest,
    context: ProviderCallContext,
  ): Promise<TextGenerationResult> {
    this.#assertMockContext(context, 'VISION_ANALYSIS', 'vision');
    validateVisionRequest(request, context);
    const startedAt = this.#clock.nowMilliseconds();
    const step = await this.#take(context, ['VISION_SUCCESS', 'REFUSAL', 'ERROR']);
    if (step.type === 'ERROR') {
      throw this.#scenarioError(step, context);
    }
    if (step.type === 'REFUSAL') {
      return this.#textResult('', context, startedAt, step, true);
    }
    return this.#textResult(step.text, context, startedAt, step, false);
  }

  public async generateImage(
    request: ImageGenerationRequest,
    context: ProviderCallContext,
  ): Promise<ImageGenerationResult> {
    this.#assertMockContext(context, 'IMAGE_GENERATION', 'imageGeneration');
    validateImageGenerationRequest(request, context);
    const startedAt = this.#clock.nowMilliseconds();
    const step = await this.#take(context, ['IMAGE_SUCCESS', 'REFUSAL', 'ERROR']);
    if (step.type === 'ERROR') {
      throw this.#scenarioError(step, context);
    }
    if (step.type === 'REFUSAL') {
      throw this.#basicError(
        'PROVIDER_REFUSAL',
        context,
        'PROTOCOL',
        'COMPLETED_INVALID_OUTPUT',
        'RETRY_MANUAL',
      );
    }
    const bytes = step.bytes ?? TINY_PNG;
    assertImageBytes(
      { bytes, mimeType: 'image/png' },
      context,
      PROVIDER_LIMITS.maxImageOutputBytes,
    );
    return Object.freeze({
      images: Object.freeze(
        Array.from({ length: request.count }, () =>
          Object.freeze({
            bytes: Uint8Array.from(bytes),
            height: 1,
            mimeType: 'image/png' as const,
            revisedPrompt: null,
            width: 1,
          }),
        ),
      ),
      latencyMs: Math.max(0, this.#clock.nowMilliseconds() - startedAt),
      modelId: context.modelId,
      protocolMode: 'MOCK',
      providerRequestId: null,
      usage: step.usage ?? emptyProviderUsage(),
      warnings: step.usage?.warnings ?? emptyProviderUsage().warnings,
    });
  }

  #assertMockContext(
    context: ProviderCallContext,
    operation: ProviderOperation,
    capability: 'imageGeneration' | 'structuredJson' | 'text' | 'vision',
  ): void {
    validateCallContext(context, operation);
    if (context.protocolMode !== 'MOCK' || context.capabilities.source !== 'MOCK') {
      throw this.#basicError(
        'PROVIDER_PROTOCOL_ERROR',
        context,
        'PROTOCOL',
        'REJECTED_BEFORE_EXECUTION',
        'DO_NOT_RETRY',
      );
    }
    assertCapability(context.capabilities, capability, context);
    this.#calls.push(
      Object.freeze({
        modelReference: safeIdentifierReference(context.modelId),
        operation,
        providerId: context.providerId,
        requestId: context.requestId,
      }),
    );
  }

  async #take<T extends MockProviderStep['type']>(
    context: ProviderCallContext,
    allowed: readonly T[],
  ): Promise<Extract<MockProviderStep, { readonly type: T }>> {
    const step = this.#script.shift();
    if (step === undefined) {
      throw this.#basicError(
        'PROVIDER_MOCK_SCRIPT_EXHAUSTED',
        context,
        'VALIDATION',
        'NOT_SENT',
        'DO_NOT_RETRY',
      );
    }
    if (!allowed.includes(step.type as T)) {
      throw this.#basicError(
        'PROVIDER_INTERNAL_ERROR',
        context,
        'VALIDATION',
        'NOT_SENT',
        'DO_NOT_RETRY',
      );
    }
    if (step.delayMs !== undefined) {
      if (!Number.isSafeInteger(step.delayMs) || step.delayMs < 0) {
        throw this.#basicError(
          'PROVIDER_INTERNAL_ERROR',
          context,
          'VALIDATION',
          'NOT_SENT',
          'DO_NOT_RETRY',
        );
      }
      if (step.delayMs >= context.timeoutMs) {
        throw this.#basicError('PROVIDER_TIMEOUT', context, 'TIMEOUT', 'NOT_SENT', 'DO_NOT_RETRY');
      }
      const startedAt = this.#clock.nowMilliseconds();
      try {
        await this.#clock.sleep(step.delayMs, context.signal);
      } catch {
        throw this.#basicError('PROVIDER_ABORTED', context, 'ABORT', 'NOT_SENT', 'DO_NOT_RETRY');
      }
      if (this.#clock.nowMilliseconds() - startedAt >= context.timeoutMs) {
        throw this.#basicError('PROVIDER_TIMEOUT', context, 'TIMEOUT', 'NOT_SENT', 'DO_NOT_RETRY');
      }
    }
    return step as Extract<MockProviderStep, { readonly type: T }>;
  }

  #textResult(
    text: string,
    context: ProviderCallContext,
    startedAt: number,
    step: MockProviderStep,
    refused: boolean,
  ): TextGenerationResult {
    if (text.length > PROVIDER_LIMITS.maxOutputCharacters) {
      throw this.#basicError(
        'PROVIDER_RESPONSE_TOO_LARGE',
        context,
        'PROTOCOL',
        'COMPLETED_INVALID_OUTPUT',
        'RETRY_MANUAL',
      );
    }
    const usage = 'usage' in step && step.usage !== undefined ? step.usage : emptyProviderUsage();
    return Object.freeze({
      finishReason: refused ? 'CONTENT_FILTER' : 'STOP',
      latencyMs: Math.max(0, this.#clock.nowMilliseconds() - startedAt),
      modelId: context.modelId,
      outputTruncated: false,
      protocolMode: 'MOCK',
      providerRequestId: null,
      refusal: refused ? Object.freeze({ reason: 'PROVIDER_REFUSAL' as const }) : null,
      text,
      usage,
      warnings: usage.warnings,
    });
  }

  #scenarioError(
    step: Extract<MockProviderStep, { readonly type: 'ERROR' }>,
    context: ProviderCallContext,
  ): ProviderError {
    switch (step.scenario) {
      case 'NETWORK_UNREACHABLE':
        return this.#basicError(
          'PROVIDER_NETWORK_UNREACHABLE',
          context,
          'NETWORK',
          'NOT_SENT',
          'RETRY_AUTOMATIC_SAFE',
        );
      case 'RATE_LIMIT':
        return new ProviderError('PROVIDER_RATE_LIMITED', {
          causeCategory: 'RATE_LIMIT',
          modelId: context.modelId,
          operation: context.operation,
          outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
          providerId: context.providerId,
          requestId: context.requestId,
          retryAfterMs: step.retryAfterMs ?? 1_000,
          retryDisposition: 'RETRY_QUEUE',
        });
      case 'TIMEOUT':
        return this.#basicError(
          'PROVIDER_TIMEOUT',
          context,
          'TIMEOUT',
          'MAY_HAVE_EXECUTED',
          'RETRY_MANUAL',
        );
      case 'ABORT':
        return this.#basicError('PROVIDER_ABORTED', context, 'ABORT', 'NOT_SENT', 'DO_NOT_RETRY');
      case 'UPSTREAM_4XX':
        return this.#basicError(
          'PROVIDER_UPSTREAM_4XX',
          context,
          'UPSTREAM',
          'REJECTED_BEFORE_EXECUTION',
          'DO_NOT_RETRY',
        );
      case 'UPSTREAM_5XX':
        return this.#basicError(
          'PROVIDER_UPSTREAM_5XX',
          context,
          'UPSTREAM',
          'MAY_HAVE_EXECUTED',
          'RETRY_MANUAL',
        );
      case 'INVALID_CONTENT_TYPE':
        return this.#basicError(
          'PROVIDER_INVALID_CONTENT_TYPE',
          context,
          'CONTENT_TYPE',
          'COMPLETED_INVALID_OUTPUT',
          'RETRY_MANUAL',
        );
      case 'INVALID_JSON':
        return this.#basicError(
          'PROVIDER_INVALID_JSON',
          context,
          'PROTOCOL',
          'COMPLETED_INVALID_OUTPUT',
          'RETRY_MANUAL',
        );
      case 'SCHEMA_MISMATCH':
        return this.#basicError(
          'PROVIDER_SCHEMA_VALIDATION_FAILED',
          context,
          'SCHEMA',
          'COMPLETED_INVALID_OUTPUT',
          'RETRY_MANUAL',
        );
      case 'MALFORMED_USAGE':
        return this.#basicError(
          'PROVIDER_INVALID_USAGE',
          context,
          'PROTOCOL',
          'COMPLETED_INVALID_OUTPUT',
          'RETRY_MANUAL',
        );
      case 'RESPONSE_TOO_LARGE':
        return this.#basicError(
          'PROVIDER_RESPONSE_TOO_LARGE',
          context,
          'PROTOCOL',
          'COMPLETED_INVALID_OUTPUT',
          'RETRY_MANUAL',
        );
      case 'AMBIGUOUS_DISCONNECT':
        return this.#basicError(
          'PROVIDER_AMBIGUOUS_OUTCOME',
          context,
          'NETWORK',
          'MAY_HAVE_EXECUTED',
          'RETRY_MANUAL',
        );
      case 'CAPABILITY_UNKNOWN':
        return this.#basicError(
          'PROVIDER_CAPABILITY_UNKNOWN',
          context,
          'CONFIGURATION',
          'REJECTED_BEFORE_EXECUTION',
          'DO_NOT_RETRY',
        );
      case 'CAPABILITY_UNSUPPORTED':
        return this.#basicError(
          'PROVIDER_CAPABILITY_UNSUPPORTED',
          context,
          'CONFIGURATION',
          'REJECTED_BEFORE_EXECUTION',
          'DO_NOT_RETRY',
        );
    }
  }

  #basicError(
    code: ProviderErrorCode,
    context: ProviderCallContext,
    causeCategory: ProviderCauseCategory,
    outcomeCertainty: OutcomeCertainty,
    retryDisposition: RetryDisposition,
  ): ProviderError {
    return new ProviderError(code, {
      causeCategory,
      modelId: context.modelId,
      operation: context.operation,
      outcomeCertainty,
      providerId: context.providerId,
      requestId: context.requestId,
      retryDisposition,
    });
  }
}

export const DEFAULT_MOCK_CAPABILITIES = createMockCapabilities();
