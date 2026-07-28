import type { JsonValue } from './contracts.js';
import { CAPABILITY_PROBE_MARKERS } from './capability-probe-classifier.js';
import type { CapabilityProbeStep } from './capability-probe-contracts.js';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function responsesBase(modelId: string, input: JsonValue): Record<string, JsonValue> {
  return {
    input,
    max_output_tokens: 24,
    model: modelId,
    store: false,
    temperature: 0,
  };
}

function chatBase(modelId: string, content: JsonValue): Record<string, JsonValue> {
  return {
    max_tokens: 24,
    messages: [{ content, role: 'user' }],
    model: modelId,
    temperature: 0,
  };
}

export function capabilityProbeRequestBody(step: CapabilityProbeStep): JsonValue | null {
  if (step.modelId === null) {
    return null;
  }
  if (step.kind === 'TEXT') {
    return step.protocolMode === 'CHAT_COMPLETIONS'
      ? chatBase(step.modelId, `Return exactly ${CAPABILITY_PROBE_MARKERS.text}`)
      : responsesBase(step.modelId, `Return exactly ${CAPABILITY_PROBE_MARKERS.text}`);
  }
  if (step.kind === 'STRUCTURED') {
    return {
      ...responsesBase(step.modelId, 'Return the requested JSON object.'),
      text: {
        format: {
          name: 'rednote_capability_probe',
          schema: {
            additionalProperties: false,
            properties: {
              marker: { const: CAPABILITY_PROBE_MARKERS.structured, type: 'string' },
            },
            required: ['marker'],
            type: 'object',
          },
          strict: true,
          type: 'json_schema',
        },
      },
    };
  }
  if (step.kind === 'TOOL') {
    return {
      ...responsesBase(step.modelId, 'Call the supplied function exactly once.'),
      tool_choice: { name: CAPABILITY_PROBE_MARKERS.tool, type: 'function' },
      tools: [
        {
          name: CAPABILITY_PROBE_MARKERS.tool,
          parameters: {
            additionalProperties: false,
            properties: {
              marker: { const: CAPABILITY_PROBE_MARKERS.text, type: 'string' },
            },
            required: ['marker'],
            type: 'object',
          },
          strict: true,
          type: 'function',
        },
      ],
    };
  }
  if (step.kind === 'WEB_SEARCH') {
    return {
      ...responsesBase(step.modelId, 'Find one harmless public fact and cite the result.'),
      tools: [{ type: 'web_search' }],
    };
  }
  if (step.kind === 'VISION') {
    return responsesBase(step.modelId, [
      {
        content: [
          {
            image_url: `data:image/png;base64,${TINY_PNG_BASE64}`,
            type: 'input_image',
          },
          {
            text: `Return exactly ${CAPABILITY_PROBE_MARKERS.vision}`,
            type: 'input_text',
          },
        ],
        role: 'user',
        type: 'message',
      },
    ]);
  }
  if (step.kind === 'IMAGE') {
    return {
      model: step.modelId,
      n: 1,
      prompt: 'A single plain blue square on a white background.',
      quality: 'low',
      response_format: 'b64_json',
      size: '256x256',
    };
  }
  if (step.kind === 'STREAMING') {
    return {
      ...responsesBase(step.modelId, `Return exactly ${CAPABILITY_PROBE_MARKERS.text}`),
      stream: true,
    };
  }
  return null;
}
