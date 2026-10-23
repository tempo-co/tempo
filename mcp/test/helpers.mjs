import assert from 'node:assert/strict';
import {createServer as createHttpServer} from 'node:http';
import {once} from 'node:events';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createServer} from '../dist/server.js';

export const TOKEN = 'synthetic-test-token';
export const ID = '00000000-0000-4000-8000-000000000001';
export async function fixture(t, options = {}) {
	const requests = [];
	let response = {status: 200, body: {ok: true}, headers: {}};
	const http = createHttpServer((req, res) => {
		requests.push({method: req.method, url: req.url, authorization: req.headers.authorization});
		const reply = typeof response === 'function' ? response(req.url) : response;
		res.writeHead(reply.status, {'content-type': 'application/json', ...reply.headers});
		res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
	});
	http.listen(0, '127.0.0.1');
	await once(http, 'listening');
	const apiUrl = `http://127.0.0.1:${http.address().port}/api`;
	const server = createServer({apiUrl, apiToken: TOKEN, now: () => new Date('2040-02-02T23:30:00Z'), ...options});
	const client = new Client({name: 'synthetic-test', version: '1'});
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	t.after(async () => {
		await client.close();
		await server.close();
		await new Promise((resolve) => http.close(resolve));
	});
	return {
		client,
		requests,
		apiUrl,
		respondWith(handler) {
			response = handler;
		},
		respond(body, status = 200, headers = {}) {
			response = {body, status, headers};
		},
	};
}
export function json(result) {
	assert.equal(result.isError, undefined, JSON.stringify(result));
	assert.equal(result.content.length, 1);
	assert.equal(result.content[0].type, 'text');
	const value = JSON.parse(result.content[0].text);
	assert.equal(result.content[0].text, JSON.stringify(value), 'compact JSON');
	return value;
}
