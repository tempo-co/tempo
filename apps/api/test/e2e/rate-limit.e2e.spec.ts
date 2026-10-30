import {INestApplication} from '@nestjs/common';
import {Throttle, seconds} from '@nestjs/throttler';
import {Server} from 'node:net';
import request from 'supertest';

import {ConfigurationService} from '@core/config/config.service';
import {HealthController} from '@core/health/health.controller';
import {TEST_THROTTLER_NAME} from '@core/rate-limit/rate-limit.module';

import {getApp} from '../setup/e2e.setup';

const THROTTLED_LIMIT = 3;
const THROTTLE_TEST_TRACKER = 'rate-limit-e2e';

describe('RateLimitModule - ThrottlerGuard (e2e)', () => {
	let app: INestApplication<Server>;
	let httpServer: Server;

	beforeAll(async () => {
		app = getApp();
		httpServer = app.getHttpServer();
	});

	function limitHealthRouteTo(limit: number) {
		const descriptor = Object.getOwnPropertyDescriptor(HealthController.prototype, 'check');
		if (!descriptor) throw new Error('HealthController.check descriptor not found');
		Throttle({
			[TEST_THROTTLER_NAME]: {limit, ttl: seconds(30), getTracker: () => THROTTLE_TEST_TRACKER},
		})(HealthController.prototype, 'check', descriptor);
	}

	it('keeps the throttler enabled with the generous test-environment defaults', async () => {
		const throttleLimit = app.get(ConfigurationService).get('THROTTLE_LIMIT');

		const first = await request(httpServer).get('/accounts/me').expect(401);
		expect(first.headers['x-ratelimit-limit-test']).toBe(String(throttleLimit));
		const remaining = Number(first.headers['x-ratelimit-remaining-test']);
		expect(remaining).toBeGreaterThan(throttleLimit - 10);

		const second = await request(httpServer).get('/accounts/me').expect(401);
		expect(Number(second.headers['x-ratelimit-remaining-test'])).toBe(remaining - 1);
	});

	it('returns 429 once the overridden limit is exceeded', async () => {
		limitHealthRouteTo(THROTTLED_LIMIT);
		const getHealth = () => request(httpServer).get('/health');

		await getHealth().expect(200);
		await getHealth().expect(200);
		await getHealth().expect(200);

		const throttled = await getHealth().expect(429);
		expect(throttled.body.statusCode).toBe(429);
		expect(throttled.body.message).toMatch(/Too Many Requests/i);
		expect(Number(throttled.headers['retry-after-test'])).toBeGreaterThan(0);

		await getHealth().expect(429);
	});
});
