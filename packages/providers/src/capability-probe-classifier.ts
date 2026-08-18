import {
  type CapabilityProbeObservation,
  type CapabilityProbeResponse,
  type CapabilityProbeStep,
  type ProbeReasonCode,
  type ProbeSafeDetails,
} from './capability-probe-contracts.js';
import {
  normalizeOpenAICompatibleResponse,
  OpenAIResponseNormalizationError,
} from './openai-response-normalizer.js';

const TEXT_MARKER = 'REDNOTE_CAPABILITY_OK';
const STRUCTURED_MARKER = 'REDNOTE_STRUCTURED_OK';
const VISION_MARKER = 'REDNOTE_VISION_OK';
const TOOL_NAME = 'rednote_capability_echo';

interface ParsedJson {
  readonly ok: boolean;
  readonly value: unknown;
}

function parseJson(body: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false, value: null };
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function safeErrorField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const filtered = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, 128);
  return filtered.length === 0 ? undefined : filtered;
}

function httpSafeDetails(response: CapabilityProbeResponse, parsed: unknown): ProbeSafeDetails {
  const error = record(record(parsed)?.error);
  const errorCode = safeErrorField(error?.code);
  const errorParam = safeErrorField(error?.param);
  const errorType = safeErrorField(error?.type);
  const requestId = safeErrorField(
    response.headers['x-request-id'] ?? response.headers['request-id'],
  );
  return {
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(errorParam === undefined ? {} : { errorParam }),
    ...(errorType === undefined ? {} : { errorType }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(response.receivedContentType === undefined
      ? {}
      : { receivedContentType: response.receivedContentType }),
    status: response.status,
    ...(response.transportVariant === undefined
      ? {}
      : { transportVariant: response.transportVariant }),
  };
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }
  return array(value).flatMap((item) => {
    const itemRecord = record(item);
    if (typeof item === 'string') {
      return [item];
    }
    if (typeof itemRecord?.text === 'string') {
      return [itemRecord.text];
    }
    if (typeof itemRecord?.content === 'string') {
      return [itemRecord.content];
    }
    return [];
  });
}

function outputText(value: unknown, mode: CapabilityProbeStep['protocolMode']): string {
  const root = record(value);
  if (root === null) {
    return '';
  }
  if (typeof root.output_text === 'string') {
    return root.output_text;
  }
  if (mode === 'CHAT_COMPLETIONS') {
    return array(root.choices)
      .flatMap((choice) => {
        const message = record(record(choice)?.message);
        return strings(message?.content);
      })
      .join('');
  }
  return array(root.output)
    .flatMap((item) => strings(record(item)?.content))
    .join('');
}

function usageDetails(value: unknown): ProbeSafeDetails | null {
  const root = record(value);
  const usage = record(root?.usage);
  if (usage === null) {
    return null;
  }
  const input =
    typeof usage.input_tokens === 'number'
      ? usage.input_tokens
      : typeof usage.prompt_tokens === 'number'
        ? usage.prompt_tokens
        : null;
  const output =
    typeof usage.output_tokens === 'number'
      ? usage.output_tokens
      : typeof usage.completion_tokens === 'number'
        ? usage.completion_tokens
        : null;
  const total =
    typeof usage.total_tokens === 'number'
      ? usage.total_tokens
      : input !== null && output !== null
        ? input + output
        : null;
  if (
    input === null ||
    output === null ||
    total === null ||
    ![input, output, total].every(
      (item) => Number.isSafeInteger(item) && item >= 0 && item <= 10_000_000,
    )
  ) {
    return null;
  }
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

function observation(
  step: CapabilityProbeStep,
  observedAt: string | null,
  reasonCode: ProbeReasonCode,
  state: CapabilityProbeObservation['state'],
  safeDetails: ProbeSafeDetails = {},
  source: CapabilityProbeObservation['source'] = 'PROBED',
): CapabilityProbeObservation {
  return Object.freeze({
    capability: step.capability,
    confidence: state === 'UNKNOWN' ? 'INCONCLUSIVE' : 'CONFIRMED',
    maxContextTokens: null,
    modelId: step.modelId,
    modelSlots: step.modelSlots,
    observedAt,
    protocolMode: step.protocolMode,
    rateLimitRequests: null,
    rateLimitTokens: null,
    reasonCode,
    safeDetails: Object.freeze(safeDetails),
    source,
    state,
  });
}

function explicitNegativeReason(status: number, parsed: unknown): ProbeReasonCode | null {
  if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
    return null;
  }
  const error = record(record(parsed)?.error);
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  const type = typeof error?.type === 'string' ? error.type.toLowerCase() : '';
  const combined = `${code} ${type}`;
  if (/(unsupported[_-]?model|model[_-]?not[_-]?supported)/u.test(combined)) {
    return 'MODEL_EXPLICITLY_UNSUPPORTED';
  }
  if (/(unsupported[_-]?protocol|protocol[_-]?not[_-]?supported)/u.test(combined)) {
    return 'PROTOCOL_EXPLICITLY_UNSUPPORTED';
  }
  if (
    /(unsupported[_-]?(feature|capability|endpoint)|feature[_-]?not[_-]?supported|not[_-]?implemented)/u.test(
      combined,
    )
  ) {
    return 'ENDPOINT_EXPLICITLY_UNSUPPORTED';
  }
  return null;
}

function httpFailure(
  step: CapabilityProbeStep,
  response: CapabilityProbeResponse,
  parsed: unknown,
  now: string,
): CapabilityProbeObservation | null {
  if (response.status >= 200 && response.status < 300) {
    return null;
  }
  if (response.status === 401) {
    return observation(
      step,
      now,
      'AUTHENTICATION_REJECTED',
      'UNKNOWN',
      httpSafeDetails(response, parsed),
    );
  }
  if (response.status === 403) {
    return observation(
      step,
      now,
      'PERMISSION_REJECTED',
      'UNKNOWN',
      httpSafeDetails(response, parsed),
    );
  }
  if (response.status === 429) {
    return observation(step, now, 'RATE_LIMITED', 'UNKNOWN', httpSafeDetails(response, parsed));
  }
  if (response.status === 404) {
    const error = record(record(parsed)?.error);
    const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
    const type = typeof error?.type === 'string' ? error.type.toLowerCase() : '';
    if (/(model[_-]?(not[_-]?found|unavailable)|unknown[_-]?model)/u.test(`${code} ${type}`)) {
      return observation(step, now, 'AMBIGUOUS_OUTCOME', 'UNKNOWN', {
        ...httpSafeDetails(response, parsed),
        modelNotFound: 1,
      });
    }
  }
  const negative = explicitNegativeReason(response.status, parsed);
  if (negative !== null) {
    return observation(step, now, negative, 'UNSUPPORTED', httpSafeDetails(response, parsed));
  }
  return observation(step, now, 'AMBIGUOUS_OUTCOME', 'UNKNOWN', {
    ...httpSafeDetails(response, parsed),
    ...(response.status === 404 ? { endpointNotFound: 1 } : {}),
  });
}

function classifyTool(
  step: CapabilityProbeStep,
  value: unknown,
  now: string,
): CapabilityProbeObservation {
  const root = record(value);
  const candidates = [
    ...array(root?.output),
    ...array(record(array(root?.choices)[0])?.message).flatMap(() => []),
    ...array(record(record(array(root?.choices)[0])?.message)?.tool_calls),
  ];
  const found = candidates.some((candidate) => {
    const item = record(candidate);
    const functionValue = record(item?.function);
    const name =
      typeof item?.name === 'string'
        ? item.name
        : typeof functionValue?.name === 'string'
          ? functionValue.name
          : '';
    const rawArguments =
      typeof item?.arguments === 'string'
        ? item.arguments
        : typeof functionValue?.arguments === 'string'
          ? functionValue.arguments
          : null;
    if (name !== TOOL_NAME || rawArguments === null) {
      return false;
    }
    const parsed = parseJson(rawArguments);
    return record(parsed.value)?.marker === TEXT_MARKER;
  });
  return found
    ? observation(step, now, 'NOT_PROBED', 'SUPPORTED', { eventCount: 1 })
    : observation(step, now, 'TOOL_NOT_OBSERVED', 'UNKNOWN');
}

function classifySearch(
  step: CapabilityProbeStep,
  value: unknown,
  now: string,
): CapabilityProbeObservation {
  const output = array(record(value)?.output);
  const eventCount = output.filter((item) => {
    const candidate = record(item);
    return candidate?.type === 'web_search_call' && candidate.status === 'completed';
  }).length;
  const citationCount = output
    .flatMap((item) => {
      const candidate = record(item);
      return [
        ...array(candidate?.annotations),
        ...array(candidate?.content).flatMap((part) => array(record(part)?.annotations)),
      ];
    })
    .filter((item) => record(item)?.type === 'url_citation').length;
  return eventCount > 0 && citationCount > 0
    ? observation(step, now, 'NOT_PROBED', 'SUPPORTED', { citationCount, eventCount })
    : observation(step, now, 'SEARCH_NOT_OBSERVED', 'UNKNOWN', {
        citationCount,
        eventCount,
      });
}

function hasSupportedImageMagic(bytes: Uint8Array): boolean {
  const png =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const prefix = new TextDecoder().decode(bytes.slice(0, 12));
  const gif = prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a');
  const webp = prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP';
  return png || jpeg || gif || webp;
}

function classifyImage(
  step: CapabilityProbeStep,
  value: unknown,
  now: string,
): CapabilityProbeObservation {
  const data = array(record(value)?.data);
  if (data.length !== 1) {
    return observation(step, now, 'INVALID_RESPONSE', 'UNKNOWN', { imageCount: data.length });
  }
  const image = record(data[0]);
  if (typeof image?.b64_json === 'string') {
    try {
      if (
        image.b64_json.length === 0 ||
        image.b64_json.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/u.test(image.b64_json)
      ) {
        return observation(step, now, 'INVALID_RESPONSE', 'UNKNOWN', { imageCount: 1 });
      }
      const bytes = Buffer.from(image.b64_json, 'base64');
      return bytes.length > 0 && bytes.length <= 2 * 1024 * 1024 && hasSupportedImageMagic(bytes)
        ? observation(step, now, 'NOT_PROBED', 'SUPPORTED', { imageCount: 1 })
        : observation(step, now, 'INVALID_RESPONSE', 'UNKNOWN', { imageCount: 1 });
    } catch {
      return observation(step, now, 'INVALID_RESPONSE', 'UNKNOWN', { imageCount: 1 });
    }
  }
  if (typeof image?.url === 'string') {
    return observation(step, now, 'OUTPUT_VARIANT_UNSUPPORTED', 'UNKNOWN', { imageCount: 1 });
  }
  return observation(step, now, 'INVALID_RESPONSE', 'UNKNOWN', { imageCount: 1 });
}

function classifyCapabilityProbeResponseWithoutRateLimits(
  step: CapabilityProbeStep,
  response: CapabilityProbeResponse,
  now: string,
): readonly CapabilityProbeObservation[] {
  const contentType = response.headers['content-type'];
  if (step.kind === 'STREAMING') {
    const supported =
      /^text\/event-stream(?:\s*;|$)/iu.test(contentType ?? '') &&
      /data:\s*\{[\s\S]*\}/u.test(response.body);
    return [
      supported
        ? observation(step, now, 'NOT_PROBED', 'SUPPORTED')
        : observation(step, now, 'INVALID_RESPONSE', 'UNKNOWN'),
    ];
  }
  if (step.kind === 'BATCH_METADATA') {
    if (response.status < 200 || response.status >= 300) {
      return [observation(step, now, 'AMBIGUOUS_OUTCOME', 'UNKNOWN', { status: response.status })];
    }
    const semantics = `${response.headers.allow ?? ''} ${response.headers['x-batch-capabilities'] ?? ''}`;
    return [
      /\b(create|submit)\b/iu.test(semantics)
        ? observation(step, now, 'NOT_PROBED', 'SUPPORTED', {}, 'METADATA')
        : observation(step, now, 'METADATA_NOT_REPORTED', 'UNKNOWN', {}, 'METADATA'),
    ];
  }

  let normalizedBody = response.body;
  let transportDetails: ProbeSafeDetails = {};
  if (
    response.status >= 200 &&
    response.status < 300 &&
    (step.kind === 'STRUCTURED' || step.kind === 'TEXT' || step.kind === 'VISION')
  ) {
    try {
      if (response.transportVariant !== undefined && response.receivedContentType !== undefined) {
        transportDetails = {
          receivedContentType: response.receivedContentType,
          transportVariant: response.transportVariant,
        };
      } else {
        const normalized = normalizeOpenAICompatibleResponse({
          body: response.body,
          contentType,
          maxBodyBytes: 2 * 1024 * 1024,
          protocol: step.protocolMode === 'CHAT_COMPLETIONS' ? 'CHAT_COMPLETIONS' : 'RESPONSES',
        });
        normalizedBody = normalized.body;
        transportDetails = {
          receivedContentType: normalized.receivedContentType,
          transportVariant: normalized.transportVariant,
        };
      }
    } catch (error) {
      if (error instanceof OpenAIResponseNormalizationError) {
        return [
          observation(
            step,
            now,
            error.reason === 'INVALID_CONTENT_TYPE' ? 'INVALID_CONTENT_TYPE' : 'INVALID_JSON',
            'UNKNOWN',
            {
              receivedContentType: error.receivedContentType,
              transportVariant: 'REJECTED',
            },
          ),
        ];
      }
      return [observation(step, now, 'INVALID_RESPONSE', 'UNKNOWN')];
    }
  }
  const parsed = parseJson(normalizedBody);
  const failure = httpFailure(step, response, parsed.value, now);
  if (failure !== null) {
    return [failure];
  }
  if (!parsed.ok) {
    return [observation(step, now, 'INVALID_JSON', 'UNKNOWN')];
  }
  const responseModel = record(parsed.value)?.model;
  if (
    step.modelId !== null &&
    typeof responseModel === 'string' &&
    responseModel !== step.modelId
  ) {
    return [
      observation(step, now, 'INVALID_RESPONSE', 'UNKNOWN', {
        modelIdMismatch: 1,
      }),
    ];
  }
  if (step.kind === 'METADATA') {
    const root = record(parsed.value);
    const data = array(root?.data);
    const exactModelMetadata = data.filter((item) => record(item)?.id === step.modelId);
    const maxContext = exactModelMetadata
      .map((item) => record(item)?.context_window)
      .find((value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
    return [
      Object.freeze({
        ...observation(
          step,
          now,
          exactModelMetadata.length > 0 ? 'NOT_PROBED' : 'METADATA_NOT_REPORTED',
          exactModelMetadata.length > 0 ? 'SUPPORTED' : 'UNKNOWN',
          {},
          'METADATA',
        ),
        maxContextTokens: typeof maxContext === 'number' ? maxContext : null,
      }),
    ];
  }
  if (step.kind === 'IMAGE') {
    return [classifyImage(step, parsed.value, now)];
  }
  if (step.kind === 'TOOL') {
    return [classifyTool(step, parsed.value, now)];
  }
  if (step.kind === 'WEB_SEARCH') {
    return [classifySearch(step, parsed.value, now)];
  }
  const text = outputText(parsed.value, step.protocolMode);
  let primary: CapabilityProbeObservation;
  if (step.kind === 'STRUCTURED') {
    const structured = parseJson(text);
    primary =
      structured.ok && record(structured.value)?.marker === STRUCTURED_MARKER
        ? observation(step, now, 'NOT_PROBED', 'SUPPORTED', transportDetails)
        : observation(step, now, 'SCHEMA_MISMATCH', 'UNKNOWN', transportDetails);
  } else if (step.kind === 'VISION') {
    primary = text.includes(VISION_MARKER)
      ? observation(step, now, 'NOT_PROBED', 'SUPPORTED')
      : observation(step, now, 'VISION_INCONCLUSIVE', 'UNKNOWN');
  } else {
    primary = text.includes(TEXT_MARKER)
      ? observation(step, now, 'NOT_PROBED', 'SUPPORTED')
      : observation(step, now, 'INVALID_RESPONSE', 'UNKNOWN');
  }
  const usage = usageDetails(parsed.value);
  const usageObservation = Object.freeze({
    ...observation(
      { ...step, capability: 'usage' },
      now,
      usage === null ? 'USAGE_NOT_REPORTED' : 'NOT_PROBED',
      usage === null ? 'UNKNOWN' : 'SUPPORTED',
      usage ?? {},
    ),
  });
  return [primary, usageObservation];
}

function safeRateLimitHeader(
  headers: Readonly<Record<string, string>>,
  name: 'x-ratelimit-limit-requests' | 'x-ratelimit-limit-tokens',
): number | null {
  const value = headers[name]?.trim();
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function classifyCapabilityProbeResponse(
  step: CapabilityProbeStep,
  response: CapabilityProbeResponse,
  now: string,
): readonly CapabilityProbeObservation[] {
  const observations = classifyCapabilityProbeResponseWithoutRateLimits(step, response, now);
  if (response.status < 200 || response.status >= 300) {
    return observations;
  }
  const rateLimitRequests = safeRateLimitHeader(response.headers, 'x-ratelimit-limit-requests');
  const rateLimitTokens = safeRateLimitHeader(response.headers, 'x-ratelimit-limit-tokens');
  return observations.map((candidate) =>
    Object.freeze({
      ...candidate,
      rateLimitRequests,
      rateLimitTokens,
    }),
  );
}

export function classifyCapabilityProbeFailure(
  step: CapabilityProbeStep,
  error: unknown,
  now: string,
): CapabilityProbeObservation {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return observation(step, now, 'ABORTED', 'UNKNOWN');
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  if (
    ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(
      code,
    )
  ) {
    return observation(step, now, 'TLS_FAILURE', 'UNKNOWN');
  }
  if (['ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'ENOTFOUND'].includes(code)) {
    return observation(step, now, 'NETWORK_UNREACHABLE', 'UNKNOWN');
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return observation(step, now, 'TIMEOUT', 'UNKNOWN');
  }
  return observation(step, now, 'AMBIGUOUS_OUTCOME', 'UNKNOWN');
}

export const CAPABILITY_PROBE_MARKERS = Object.freeze({
  structured: STRUCTURED_MARKER,
  text: TEXT_MARKER,
  tool: TOOL_NAME,
  vision: VISION_MARKER,
});
