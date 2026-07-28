import { createServer } from 'node:http';

const TEXT = 'REDNOTE_CAPABILITY_OK';
const STRUCTURED = 'REDNOTE_STRUCTURED_OK';
const VISION = 'REDNOTE_VISION_OK';

export async function startIssue013CapabilityFixture() {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        authorizationPresent:
          typeof request.headers.authorization === 'string' &&
          request.headers.authorization.startsWith('Bearer unusable-runtime-'),
        method: request.method,
        path: request.url,
      });
      if (request.url === '/v1/models' && request.method === 'GET') {
        response.writeHead(200, {
          'content-type': 'application/json',
          'x-ratelimit-limit-requests': '60',
          'x-ratelimit-limit-tokens': '100000',
        });
        response.end(
          JSON.stringify({ data: [{ context_window: 8192, id: 'issue013-smoke-model' }] }),
        );
        return;
      }
      if (request.url === '/v1/chat/completions') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [{ message: { content: TEXT } }],
            usage: { completion_tokens: 1, prompt_tokens: 2, total_tokens: 3 },
          }),
        );
        return;
      }
      if (request.url === '/v1/responses') {
        const payload = JSON.parse(body);
        const outputText = body.includes('input_image')
          ? VISION
          : 'text' in payload
            ? JSON.stringify({ marker: STRUCTURED })
            : TEXT;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            output_text: outputText,
            usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
          }),
        );
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'not_found' } }));
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: '127.0.0.1', port: 0 }, resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Issue 013 smoke fixture did not bind IPv4 loopback.');
  }
  return {
    port: address.port,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
      });
    },
  };
}

export function assertIssue013CapabilityFixture(fixture, report) {
  const capability = report.settings?.capability;
  if (
    capability?.startupAutoRequestCount !== 0 ||
    capability?.status !== 'SUCCEEDED' ||
    capability?.matrixComplete !== true ||
    capability?.sentRequestCount !== capability?.plannedRequestCount ||
    fixture.requests.length !== capability?.sentRequestCount ||
    !fixture.requests.every((request) => request.authorizationPresent) ||
    fixture.requests.some((request) => request.path?.startsWith('/v1/batches'))
  ) {
    throw new Error(
      `Issue 013 loopback capability smoke did not satisfy its contract: ${JSON.stringify({
        capability,
        report: {
          context: report.context,
          error: report.error,
          ok: report.ok,
        },
        requests: fixture.requests,
      })}`,
    );
  }
}
