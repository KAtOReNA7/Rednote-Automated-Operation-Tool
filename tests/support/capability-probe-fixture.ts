import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { CAPABILITY_PROBE_MARKERS } from '../../packages/providers/src/index.js';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export interface CapabilityProbeFixture {
  readonly baseUrl: string;
  readonly requests: readonly {
    readonly authorizationPresent: boolean;
    readonly body: string;
    readonly method: string;
    readonly path: string;
  }[];
  close(): Promise<void>;
}

export function syntheticInvalidCredential(): string {
  return `synthetic-invalid-${randomBytes(24).toString('base64url')}`;
}

export async function startCapabilityProbeFixture(options: {
  readonly delayMilliseconds?: number;
  readonly expectedCredential: string;
}): Promise<CapabilityProbeFixture> {
  const requests: {
    authorizationPresent: boolean;
    body: string;
    method: string;
    path: string;
  }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        authorizationPresent:
          request.headers.authorization === `Bearer ${options.expectedCredential}`,
        body,
        method: request.method ?? '',
        path: request.url ?? '',
      });
      const send = (): void => {
        const path = request.url ?? '';
        if (path === '/v1/models' && request.method === 'GET') {
          response.writeHead(200, {
            'content-type': 'application/json',
            'x-ratelimit-limit-requests': '60',
            'x-ratelimit-limit-tokens': '100000',
          });
          response.end(
            JSON.stringify({
              data: [{ context_window: 8192, id: 'fixture-model', object: 'model' }],
            }),
          );
          return;
        }
        if (path === '/v1/batches' && request.method === 'OPTIONS') {
          response.writeHead(204, {
            allow: 'OPTIONS, POST',
            'x-batch-capabilities': 'create submit',
          });
          response.end();
          return;
        }
        if (path === '/v1/images/generations') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ data: [{ b64_json: TINY_PNG_BASE64 }] }));
          return;
        }
        if (path === '/v1/chat/completions') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              choices: [{ message: { content: CAPABILITY_PROBE_MARKERS.text, role: 'assistant' } }],
              usage: { completion_tokens: 1, prompt_tokens: 2, total_tokens: 3 },
            }),
          );
          return;
        }
        if (path === '/v1/responses') {
          const parsed = JSON.parse(body) as Record<string, unknown>;
          if (parsed.stream === true) {
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            response.end(`data: {"type":"response.output_text.delta","delta":"ok"}\n\n`);
            return;
          }
          if ('text' in parsed) {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(
              JSON.stringify({
                output_text: JSON.stringify({ marker: CAPABILITY_PROBE_MARKERS.structured }),
                usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
              }),
            );
            return;
          }
          if ('tool_choice' in parsed) {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(
              JSON.stringify({
                output: [
                  {
                    arguments: JSON.stringify({ marker: CAPABILITY_PROBE_MARKERS.text }),
                    name: CAPABILITY_PROBE_MARKERS.tool,
                    type: 'function_call',
                  },
                ],
                usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
              }),
            );
            return;
          }
          if (Array.isArray(parsed.tools) && JSON.stringify(parsed.tools).includes('web_search')) {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(
              JSON.stringify({
                output: [
                  { status: 'completed', type: 'web_search_call' },
                  { annotations: [{ type: 'url_citation' }], type: 'message' },
                ],
                usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
              }),
            );
            return;
          }
          const isVision = body.includes('input_image');
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              output_text: isVision
                ? CAPABILITY_PROBE_MARKERS.vision
                : CAPABILITY_PROBE_MARKERS.text,
              usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
            }),
          );
          return;
        }
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'not_found' } }));
      };
      if ((options.delayMilliseconds ?? 0) > 0) {
        setTimeout(send, options.delayMilliseconds);
      } else {
        send();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeAllConnections();
      }),
  };
}
