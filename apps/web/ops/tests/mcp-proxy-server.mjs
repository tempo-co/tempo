import {createServer} from 'node:http';

const streams = new Set();
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/mcp?release=1') {
    for (const stream of streams) stream.end('data: second\n\n');
    streams.clear();
    response.writeHead(204).end();
    return;
  }
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    if (
      request.method !== 'POST' ||
      request.url !== '/mcp' ||
      request.headers.authorization !== 'Bearer synthetic-proxy-token' ||
      request.headers.origin !== 'https://example.test' ||
      request.headers['mcp-protocol-version'] !== '2025-11-25' ||
      body !== '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
    ) {
      response.writeHead(400).end();
      return;
    }
    response.writeHead(200, {'Content-Type': 'text/event-stream'});
    response.write('data: first\n\n');
    streams.add(response);
    response.on('close', () => streams.delete(response));
  });
});
server.listen(3000, '127.0.0.1');
