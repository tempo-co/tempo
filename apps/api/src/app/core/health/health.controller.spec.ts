import {HealthCheckService, HealthIndicatorService, TypeOrmHealthIndicator} from '@nestjs/terminus';
import {Test} from '@nestjs/testing';
import Redis from 'ioredis';

import {REDIS} from '@core/redis/redis.constants';

import {HealthController} from './health.controller';

async function buildController(ping: () => Promise<string>): Promise<HealthController> {
	const moduleRef = await Test.createTestingModule({
		controllers: [HealthController],
		providers: [
			HealthIndicatorService,
			{
				provide: HealthCheckService,
				useValue: {check: (checks: (() => unknown)[]) => Promise.all(checks.map((c) => c()))},
			},
			{provide: TypeOrmHealthIndicator, useValue: {pingCheck: () => ({database: {status: 'up'}})}},
			{provide: REDIS, useValue: {ping} as unknown as Redis},
		],
	}).compile();
	return moduleRef.get(HealthController);
}

describe('HealthController', () => {
	it.each([
		['answers', () => Promise.resolve('PONG'), 'up'],
		['refuses', () => Promise.reject(new Error('connection refused')), 'down'],
		['never answers', () => new Promise<string>(() => undefined), 'down'],
	])('reports Redis %s as %s', async (_case, ping, status) => {
		const controller = await buildController(ping);

		await expect(controller.check()).resolves.toContainEqual({redis: {status}});
	});
});
