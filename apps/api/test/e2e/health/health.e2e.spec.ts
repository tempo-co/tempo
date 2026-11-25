import {INestApplication} from '@nestjs/common';
import {Server} from 'node:net';
import request from 'supertest';

import {getApp} from '../../setup/e2e.setup';

describe('Health page (e2e)', () => {
	let app: INestApplication<Server>;

	beforeAll(() => {
		app = getApp();
	});

	it('reports the API, the database and Redis up without a login', async () => {
		const response = await request(app.getHttpServer()).get('/health').expect(200);

		expect(response.body).toMatchObject({
			status: 'ok',
			info: {api: {status: 'up'}, database: {status: 'up'}, redis: {status: 'up'}},
		});
	});
});
