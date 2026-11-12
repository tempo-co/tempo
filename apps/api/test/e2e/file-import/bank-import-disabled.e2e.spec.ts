import {Server} from 'node:net';
import TestAgent from 'supertest/lib/agent';

import {VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

describe('Bank imports while FILE_IMPORT_ENABLED is off', () => {
	let agent: TestAgent;

	beforeAll(async () => {
		agent = await loginAgent(getApp().getHttpServer() as Server, VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
	});

	it.each([
		['post', '/bank-imports'],
		['get', '/bank-imports'],
		['delete', '/bank-imports/00000000-0000-4000-8000-000000000000'],
	] as const)('%s %s answers 404', async (method, path) => {
		await agent[method](path).set('Origin', 'http://localhost:5173').expect(404);
	});
});
