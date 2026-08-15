import { createServer } from 'node:http';

export async function startR07PackagedProviderFixture() {
  const requests = [];
  let contentIndex = 0;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const actionKind = body.includes('CONTENT_PACKAGES')
        ? 'CONTENT_PACKAGES'
        : body.includes('REPLY_SUGGESTION')
          ? 'REPLY_SUGGESTION'
          : 'CAPABILITY_PROBE';
      requests.push({
        actionKind,
        authorizationPresent:
          typeof request.headers.authorization === 'string' &&
          request.headers.authorization.startsWith('Bearer unusable-runtime-'),
        method: request.method,
        path: request.url,
      });
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: [{ context_window: 8192, id: 'r07-loopback-text' }] }));
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/responses') {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ error: { code: 'unsupported_protocol', type: 'unsupported_protocol' } }),
        );
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/images/generations') {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ error: { code: 'unsupported_feature', type: 'unsupported_feature' } }),
        );
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        let output;
        if (actionKind === 'CONTENT_PACKAGES') {
          contentIndex += 1;
          output = {
            packages: [
              {
                body: `受控黑盒正文 ${contentIndex}`,
                coverKey: 'morgue',
                materialNotes: '仅使用隔离本机合成输入。',
                suggestedTime: `2026-07-${String(26 + contentIndex).padStart(2, '0')}T10:00`,
                tags: ['本地黑盒', `文案${contentIndex}`],
                title: `受控黑盒内容 ${contentIndex}`,
              },
            ],
          };
        } else if (actionKind === 'REPLY_SUGGESTION') {
          output = { replyText: '这是仅保存到本机、需要用户手动发送的受控回复建议。' };
        } else {
          output = body.includes('Return the requested JSON object.')
            ? { marker: 'REDNOTE_STRUCTURED_OK' }
            : 'REDNOTE_CAPABILITY_OK';
        }
        response.writeHead(200, {
          'content-type': 'application/json',
          'x-ratelimit-limit-requests': '60',
          'x-ratelimit-limit-tokens': '100000',
        });
        response.end(
          JSON.stringify({
            choices: [
              {
                message: { content: typeof output === 'string' ? output : JSON.stringify(output) },
              },
            ],
            model: 'r07-loopback-text',
            usage: { completion_tokens: 8, prompt_tokens: 12, total_tokens: 20 },
          }),
        );
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'not_found', type: 'not_found' } }));
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: '127.0.0.1', port: 0 }, resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('R07 fixture bind failed.');
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
