import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from '../dist/server.js';

for (const apiUrl of [
	'not-a-url',
	'/api',
	'file:///api',
	'ftp://example.test/api',
	'http://example.test/api',
	'https://synthetic-user:synthetic-secret@example.test/api',
	'https://example.test/api?token=synthetic-secret',
	'https://example.test/api#synthetic-secret',
]) {
	test(`unsafe base URL variant ${apiUrl.split(':')[0]} is rejected without credentials`, () => {
		assert.throws(
			() => createServer({apiUrl, apiToken: 'synthetic-token'}),
			(error) => {
				assert.match(error.message, /TEMPO_API_URL/);
				assert.doesNotMatch(error.message, /synthetic-secret|synthetic-user|synthetic-token/);
				return true;
			},
		);
	});
}
for (const apiToken of [undefined, '', ' ', 'synthetic-token\nvalue']) {
	test('invalid API token configuration is rejected without echoing it', () => {
		assert.throws(
			() => createServer({apiToken}),
			(error) => {
				assert.match(error.message, /TEMPO_API_TOKEN/);
				assert.doesNotMatch(error.message, /synthetic-token/);
				return true;
			},
		);
	});
}
