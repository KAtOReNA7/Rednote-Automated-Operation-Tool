export const OPENAI_RESPONSE_TRANSPORT_VARIANTS = [
  'STANDARD_JSON',
  'NONSTANDARD_MIME_JSON',
  'SSE_NORMALIZED',
  'REJECTED',
] as const;
export type OpenAIResponseTransportVariant = (typeof OPENAI_RESPONSE_TRANSPORT_VARIANTS)[number];
export type OpenAITextProtocol = 'CHAT_COMPLETIONS' | 'RESPONSES';

export interface OpenAIResponseNormalization {
  readonly body: string;
  readonly receivedContentType: string;
  readonly transportVariant: OpenAIResponseTransportVariant;
}

export class OpenAIResponseNormalizationError extends Error {
  public constructor(
    readonly reason: 'INVALID_CONTENT_TYPE' | 'INVALID_JSON' | 'INVALID_SSE' | 'RESPONSE_TOO_LARGE',
    readonly receivedContentType: string,
  ) {
    super('OpenAI-compatible response could not be normalized.');
    this.name = 'OpenAIResponseNormalizationError';
  }
}

const MAX_CONTENT_TYPE_CHARACTERS = 128;
const MAX_SSE_EVENTS = 512;
const MAX_SSE_EVENT_CHARACTERS = 256 * 1024;
const MAX_SSE_TEXT_CHARACTERS = 256 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function safeReceivedContentType(contentType: string | null | undefined): string {
  if (contentType == null) return 'MISSING';
  const safe = [...contentType]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, MAX_CONTENT_TYPE_CHARACTERS);
  return safe.length === 0 ? 'MISSING' : safe;
}

function mimeType(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function parseObjectJson(body: string, receivedContentType: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new OpenAIResponseNormalizationError('INVALID_JSON', receivedContentType);
  }
  try {
    const parsed = record(JSON.parse(trimmed) as unknown);
    if (parsed === null) {
      throw new OpenAIResponseNormalizationError('INVALID_JSON', receivedContentType);
    }
    return parsed;
  } catch (error) {
    if (error instanceof OpenAIResponseNormalizationError) throw error;
    throw new OpenAIResponseNormalizationError('INVALID_JSON', receivedContentType);
  }
}

function sseObjects(
  body: string,
  receivedContentType: string,
): {
  readonly done: boolean;
  readonly events: readonly Record<string, unknown>[];
} {
  const blocks = body.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split(/\n\n+/u);
  const events: Record<string, unknown>[] = [];
  let done = false;
  for (const block of blocks) {
    if (block.trim().length === 0) continue;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.length === 0 || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      dataLines.push(line.slice(5).replace(/^ /u, ''));
    }
    if (dataLines.length === 0) continue;
    const data = dataLines.join('\n');
    if (data.length > MAX_SSE_EVENT_CHARACTERS || events.length >= MAX_SSE_EVENTS) {
      throw new OpenAIResponseNormalizationError('RESPONSE_TOO_LARGE', receivedContentType);
    }
    if (data === '[DONE]') {
      done = true;
      continue;
    }
    events.push(parseObjectJson(data, receivedContentType));
  }
  return { done, events };
}

function normalizeChatSse(
  events: readonly Record<string, unknown>[],
  done: boolean,
  receivedContentType: string,
): Record<string, unknown> {
  if (!done || events.length === 0) {
    throw new OpenAIResponseNormalizationError('INVALID_SSE', receivedContentType);
  }
  const text = new Map<number, string>();
  const finish = new Map<number, unknown>();
  let model: string | undefined;
  let id: string | undefined;
  let usage: unknown;
  for (const event of events) {
    if (typeof event.model === 'string') {
      if (model !== undefined && model !== event.model)
        throw new OpenAIResponseNormalizationError('INVALID_SSE', receivedContentType);
      model = event.model;
    }
    if (typeof event.id === 'string') id ??= event.id;
    if (record(event.usage) !== null) usage = event.usage;
    if (!Array.isArray(event.choices)) continue;
    for (const rawChoice of event.choices) {
      const choice = record(rawChoice);
      const index = choice?.index;
      if (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) > 32) {
        throw new OpenAIResponseNormalizationError('INVALID_SSE', receivedContentType);
      }
      const delta = record(choice?.delta);
      if (typeof delta?.content === 'string') {
        const next = `${text.get(index as number) ?? ''}${delta.content}`;
        if (next.length > MAX_SSE_TEXT_CHARACTERS)
          throw new OpenAIResponseNormalizationError('RESPONSE_TOO_LARGE', receivedContentType);
        text.set(index as number, next);
      }
      if (choice?.finish_reason != null) finish.set(index as number, choice.finish_reason);
    }
  }
  if (text.size === 0)
    throw new OpenAIResponseNormalizationError('INVALID_SSE', receivedContentType);
  return {
    choices: [...text.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, content]) => ({
        finish_reason: finish.get(index) ?? null,
        index,
        message: { content, role: 'assistant' },
      })),
    ...(id === undefined ? {} : { id }),
    ...(model === undefined ? {} : { model }),
    ...(usage === undefined ? {} : { usage }),
  };
}

function normalizeResponsesSse(
  events: readonly Record<string, unknown>[],
  done: boolean,
  receivedContentType: string,
): Record<string, unknown> {
  const completed = events
    .filter((event) => event.type === 'response.completed')
    .map((event) => record(event.response))
    .filter((event): event is Record<string, unknown> => event !== null);
  if (completed.length === 1) return completed[0] as Record<string, unknown>;
  if (completed.length > 1) {
    throw new OpenAIResponseNormalizationError('INVALID_SSE', receivedContentType);
  }
  let text = '';
  let textDone = false;
  for (const event of events) {
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      text += event.delta;
      if (text.length > MAX_SSE_TEXT_CHARACTERS)
        throw new OpenAIResponseNormalizationError('RESPONSE_TOO_LARGE', receivedContentType);
    } else if (event.type === 'response.output_text.done') {
      textDone = true;
      if (typeof event.text === 'string' && event.text !== text) {
        throw new OpenAIResponseNormalizationError('INVALID_SSE', receivedContentType);
      }
    }
  }
  if ((!done && !textDone) || text.length === 0) {
    throw new OpenAIResponseNormalizationError('INVALID_SSE', receivedContentType);
  }
  return {
    output: [{ content: [{ text, type: 'output_text' }], role: 'assistant', type: 'message' }],
    status: 'completed',
  };
}

export function normalizeOpenAICompatibleResponse(input: {
  readonly body: string;
  readonly contentType: string | null | undefined;
  readonly maxBodyBytes: number;
  readonly protocol: OpenAITextProtocol;
}): OpenAIResponseNormalization {
  const receivedContentType = safeReceivedContentType(input.contentType);
  if (Buffer.byteLength(input.body, 'utf8') > input.maxBodyBytes) {
    throw new OpenAIResponseNormalizationError('RESPONSE_TOO_LARGE', receivedContentType);
  }
  const mime = mimeType(receivedContentType === 'MISSING' ? '' : receivedContentType);
  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    throw new OpenAIResponseNormalizationError('INVALID_CONTENT_TYPE', receivedContentType);
  }
  if (mime === 'text/event-stream') {
    const parsed = sseObjects(input.body, receivedContentType);
    const envelope =
      input.protocol === 'CHAT_COMPLETIONS'
        ? normalizeChatSse(parsed.events, parsed.done, receivedContentType)
        : normalizeResponsesSse(parsed.events, parsed.done, receivedContentType);
    return {
      body: JSON.stringify(envelope),
      receivedContentType,
      transportVariant: 'SSE_NORMALIZED',
    };
  }
  const standardJson =
    mime === 'application/json' || /^application\/[!#$&^_.+A-Za-z0-9-]+\+json$/u.test(mime);
  const sniffable = mime === '' || mime === 'text/plain' || mime === 'application/octet-stream';
  if (!standardJson && !sniffable) {
    throw new OpenAIResponseNormalizationError('INVALID_CONTENT_TYPE', receivedContentType);
  }
  const envelope = parseObjectJson(input.body, receivedContentType);
  return {
    body: JSON.stringify(envelope),
    receivedContentType,
    transportVariant: standardJson ? 'STANDARD_JSON' : 'NONSTANDARD_MIME_JSON',
  };
}
