import { createHash } from 'node:crypto';

import { assertCapability, type ProviderCapabilityName } from './capabilities.js';
import {
  assertConfiguredModel,
  assertCurrentConfigRevision,
  type CredentialResolver,
  type ProviderRuntimeConfig,
} from './configuration.js';
import {
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
  type JsonObject,
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
  decodeChatCompletionsText,
  encodeChatCompletionsText,
  encodeChatCompletionsVision,
} from './codecs/chat-completions-codec.js';
import { decodeImagesGeneration, encodeImagesGeneration } from './codecs/images-codec.js';
import {
  decodeResponsesText,
  encodeResponsesText,
  encodeResponsesVision,
} from './codecs/responses-codec.js';
import { ProviderError, isProviderError } from './errors.js';
import { ProviderRetryPolicy, parseRetryAfter } from './retry-policy.js';
import { PROVIDER_LIMITS } from './response-limits.js';
import {
  NodeFetchHttpTransport,
  type HttpTransport,
  type HttpTransportResponse,
  type ProviderEndpoint,
} from './transport.js';

export interface OpenAICompatibleProviderOptions {
  readonly nowMilliseconds?: () => number;
  readonly retryPolicy?: ProviderRetryPolicy;
  readonly transport?: HttpTransport;
}

interface OperationSpec {
  readonly capability: ProviderCapabilityName;
  readonly operation: ProviderOperation;
  readonly protocols: readonly ProviderCallContext['protocolMode'][];
}

const OPERATION_SPECS: Readonly<Record<ProviderOperation, OperationSpec>> = Object.freeze({
  IMAGE_GENERATION: {
    capability: 'imageGeneration',
    operation: 'IMAGE_GENERATION',
    protocols: ['IMAGES_GENERATIONS'],
  },
  STRUCTURED_GENERATION: {
    capability: 'structuredJson',
    operation: 'STRUCTURED_GENERATION',
    protocols: ['RESPONSES', 'CHAT_COMPLETIONS'],
  },
  TEXT_GENERATION: {
    capability: 'text',
    operation: 'TEXT_GENERATION',
    protocols: ['RESPONSES', 'CHAT_COMPLETIONS'],
  },
  VISION_ANALYSIS: {
    capability: 'vision',
    operation: 'VISION_ANALYSIS',
    protocols: ['RESPONSES', 'CHAT_COMPLETIONS'],
  },
});

export class OpenAICompatibleProvider
  implements
    TextGenerationProvider,
    StructuredGenerationProvider,
    VisionProvider,
    ImageGenerationProvider
{
  readonly #config: ProviderRuntimeConfig;
  readonly #credentials: CredentialResolver;
  readonly #nowMilliseconds: () => number;
  readonly #retryPolicy: ProviderRetryPolicy;
  readonly #transport: HttpTransport;

  public constructor(
    config: ProviderRuntimeConfig,
    credentials: CredentialResolver,
    options: OpenAICompatibleProviderOptions = {},
  ) {
    this.#config = config;
    this.#credentials = credentials;
    this.#nowMilliseconds = options.nowMilliseconds ?? Date.now;
    this.#retryPolicy = options.retryPolicy ?? new ProviderRetryPolicy();
    this.#transport = options.transport ?? new NodeFetchHttpTransport();
  }

  public async generateText(
    request: TextGenerationRequest,
    context: ProviderCallContext,
  ): Promise<TextGenerationResult> {
    this.#assertReady(context, 'TEXT_GENERATION');
    validateTextRequest(request, context);
    const body =
      context.protocolMode === 'RESPONSES'
        ? encodeResponsesText(request, context)
        : encodeChatCompletionsText(request, context);
    const response = await this.#send(
      context.protocolMode === 'RESPONSES' ? 'RESPONSES' : 'CHAT_COMPLETIONS',
      body,
      context,
    );
    return context.protocolMode === 'RESPONSES'
      ? decodeResponsesText(
          response.body,
          context,
          response.latencyMs,
          response.headers.providerRequestId,
        )
      : decodeChatCompletionsText(
          response.body,
          context,
          response.latencyMs,
          response.headers.providerRequestId,
        );
  }

  public async generateStructured<T>(
    request: StructuredGenerationRequest,
    schema: RuntimeSchema<T>,
    context: ProviderCallContext,
  ): Promise<StructuredGenerationResult<T>> {
    this.#assertReady(context, 'STRUCTURED_GENERATION');
    validateTextRequest(request, context);
    validateRuntimeSchema(schema, context);
    const erasedSchema = schema as RuntimeSchema<unknown>;
    const body =
      context.protocolMode === 'RESPONSES'
        ? encodeResponsesText(request, context, erasedSchema)
        : encodeChatCompletionsText(request, context, erasedSchema);
    const response = await this.#send(
      context.protocolMode === 'RESPONSES' ? 'RESPONSES' : 'CHAT_COMPLETIONS',
      body,
      context,
    );
    const textResult =
      context.protocolMode === 'RESPONSES'
        ? decodeResponsesText(
            response.body,
            context,
            response.latencyMs,
            response.headers.providerRequestId,
          )
        : decodeChatCompletionsText(
            response.body,
            context,
            response.latencyMs,
            response.headers.providerRequestId,
          );
    if (textResult.refusal !== null) {
      throw new ProviderError('PROVIDER_REFUSAL', {
        causeCategory: 'PROTOCOL',
        modelId: context.modelId,
        operation: context.operation,
        outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
        providerId: context.providerId,
        requestId: context.requestId,
        retryDisposition: 'RETRY_MANUAL',
      });
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(textResult.text) as unknown;
    } catch {
      throw new ProviderError('PROVIDER_INVALID_JSON', {
        causeCategory: 'PROTOCOL',
        details: {
          characterCount: textResult.text.length,
          contentHash: createHash('sha256').update(textResult.text, 'utf8').digest('hex'),
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
    try {
      validateJsonValueLimits(candidate, context);
    } catch (error) {
      if (isProviderError(error)) {
        throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE', {
          causeCategory: 'SCHEMA',
          details: { schemaId: schema.id, schemaVersion: schema.version },
          modelId: context.modelId,
          operation: context.operation,
          outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
          providerId: context.providerId,
          requestId: context.requestId,
          retryDisposition: 'RETRY_MANUAL',
        });
      }
      throw error;
    }
    const validation = schema.validate(candidate);
    if (!validation.ok) {
      const issues = sanitizeSchemaIssues(validation.issues);
      const first = issues[0];
      throw new ProviderError('PROVIDER_SCHEMA_VALIDATION_FAILED', {
        causeCategory: 'SCHEMA',
        details: {
          contentHash: createHash('sha256').update(textResult.text, 'utf8').digest('hex'),
          issueCode: first?.code ?? 'SCHEMA_VALIDATION_FAILED',
          issuePath: first?.path ?? [],
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
      finishReason: textResult.finishReason,
      latencyMs: textResult.latencyMs,
      modelId: textResult.modelId,
      protocolMode: textResult.protocolMode,
      providerRequestId: textResult.providerRequestId,
      usage: textResult.usage,
      value: validation.value,
      warnings: textResult.warnings,
    });
  }

  public async analyzeVision(
    request: VisionGenerationRequest,
    context: ProviderCallContext,
  ): Promise<TextGenerationResult> {
    this.#assertReady(context, 'VISION_ANALYSIS');
    validateVisionRequest(request, context);
    const body =
      context.protocolMode === 'RESPONSES'
        ? encodeResponsesVision(request, context)
        : encodeChatCompletionsVision(request, context);
    const response = await this.#send(
      context.protocolMode === 'RESPONSES' ? 'RESPONSES' : 'CHAT_COMPLETIONS',
      body,
      context,
    );
    return context.protocolMode === 'RESPONSES'
      ? decodeResponsesText(
          response.body,
          context,
          response.latencyMs,
          response.headers.providerRequestId,
        )
      : decodeChatCompletionsText(
          response.body,
          context,
          response.latencyMs,
          response.headers.providerRequestId,
        );
  }

  public async generateImage(
    request: ImageGenerationRequest,
    context: ProviderCallContext,
  ): Promise<ImageGenerationResult> {
    this.#assertReady(context, 'IMAGE_GENERATION');
    validateImageGenerationRequest(request, context);
    const response = await this.#send(
      'IMAGES_GENERATIONS',
      encodeImagesGeneration(request, context),
      context,
    );
    return decodeImagesGeneration(
      response.body,
      request,
      context,
      response.latencyMs,
      response.headers.providerRequestId,
    );
  }

  #assertReady(context: ProviderCallContext, operation: ProviderOperation): void {
    validateCallContext(context, operation);
    const spec = OPERATION_SPECS[operation];
    if (context.providerId !== this.#config.providerId) {
      throw new ProviderError('PROVIDER_INVALID_REQUEST', {
        causeCategory: 'VALIDATION',
        modelId: context.modelId,
        operation,
        outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
        providerId: this.#config.providerId,
        requestId: context.requestId,
        retryDisposition: 'DO_NOT_RETRY',
      });
    }
    assertCurrentConfigRevision(this.#config, context.configRevision, context);
    assertConfiguredModel(this.#config, context.modelId, context);
    if (!spec.protocols.includes(context.protocolMode)) {
      throw new ProviderError('PROVIDER_PROTOCOL_ERROR', {
        causeCategory: 'PROTOCOL',
        details: { protocolMode: context.protocolMode },
        modelId: context.modelId,
        operation,
        outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
        providerId: context.providerId,
        requestId: context.requestId,
        retryDisposition: 'DO_NOT_RETRY',
      });
    }
    assertCapability(context.capabilities, spec.capability, context);
  }

  async #send(
    endpoint: ProviderEndpoint,
    body: JsonObject,
    context: ProviderCallContext,
  ): Promise<HttpTransportResponse & { readonly latencyMs: number }> {
    const startedAt = this.#nowMilliseconds();
    return this.#retryPolicy.execute(
      async (_attempt, remainingMs) => {
        const credentialHandle: { value?: string } = {};
        try {
          credentialHandle.value = await this.#credentials.resolve(
            this.#config.credentialReference,
          );
          const credential = credentialHandle.value;
          if (
            typeof credential !== 'string' ||
            credential.length === 0 ||
            credential.length > 16 * 1024 ||
            credential.includes('\u0000') ||
            credential.includes('\r') ||
            credential.includes('\n')
          ) {
            throw new ProviderError('PROVIDER_CREDENTIAL_UNAVAILABLE', {
              causeCategory: 'CREDENTIAL',
              modelId: context.modelId,
              operation: context.operation,
              outcomeCertainty: 'NOT_SENT',
              providerId: context.providerId,
              requestId: context.requestId,
              retryDisposition: 'DO_NOT_RETRY',
            });
          }
          const response = await this.#transport.request({
            baseUrl: this.#config.baseUrl,
            body: JSON.stringify(body),
            credential,
            endpoint,
            modelId: context.modelId,
            operation: context.operation,
            providerId: context.providerId,
            requestId: context.requestId,
            ...(context.signal === undefined ? {} : { signal: context.signal }),
            timeoutMs: remainingMs,
          });
          this.#assertHttpStatus(response, context);
          if (Buffer.byteLength(response.body, 'utf8') > PROVIDER_LIMITS.maxResponseBodyBytes) {
            throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE', {
              causeCategory: 'PROTOCOL',
              modelId: context.modelId,
              operation: context.operation,
              outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
              providerId: context.providerId,
              requestId: context.requestId,
              retryDisposition: 'RETRY_MANUAL',
            });
          }
          return Object.freeze({
            ...response,
            latencyMs: Math.max(0, this.#nowMilliseconds() - startedAt),
          });
        } catch (error) {
          if (isProviderError(error)) {
            throw error;
          }
          throw new ProviderError('PROVIDER_CREDENTIAL_UNAVAILABLE', {
            causeCategory: 'CREDENTIAL',
            modelId: context.modelId,
            operation: context.operation,
            outcomeCertainty: 'NOT_SENT',
            providerId: context.providerId,
            requestId: context.requestId,
            retryDisposition: 'DO_NOT_RETRY',
          });
        } finally {
          Reflect.deleteProperty(credentialHandle, 'value');
        }
      },
      {
        modelId: context.modelId,
        operation: context.operation,
        providerId: context.providerId,
        requestId: context.requestId,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        timeoutMs: context.timeoutMs,
      },
    );
  }

  #assertHttpStatus(response: HttpTransportResponse, context: ProviderCallContext): void {
    if (response.status >= 200 && response.status < 300) {
      return;
    }
    if (response.status === 429) {
      throw new ProviderError('PROVIDER_RATE_LIMITED', {
        causeCategory: 'RATE_LIMIT',
        details: { status: response.status },
        modelId: context.modelId,
        operation: context.operation,
        outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
        providerId: context.providerId,
        requestId: context.requestId,
        retryAfterMs: parseRetryAfter(response.headers.retryAfter, this.#nowMilliseconds()),
        retryDisposition: 'RETRY_QUEUE',
      });
    }
    if (response.status >= 400 && response.status < 500) {
      throw new ProviderError('PROVIDER_UPSTREAM_4XX', {
        causeCategory: 'UPSTREAM',
        details: { status: response.status },
        modelId: context.modelId,
        operation: context.operation,
        outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
        providerId: context.providerId,
        requestId: context.requestId,
        retryDisposition: 'DO_NOT_RETRY',
      });
    }
    throw new ProviderError('PROVIDER_UPSTREAM_5XX', {
      causeCategory: 'UPSTREAM',
      details: { status: response.status },
      modelId: context.modelId,
      operation: context.operation,
      outcomeCertainty: 'MAY_HAVE_EXECUTED',
      providerId: context.providerId,
      requestId: context.requestId,
      retryAfterMs: parseRetryAfter(response.headers.retryAfter, this.#nowMilliseconds()),
      retryDisposition: 'RETRY_MANUAL',
    });
  }
}
