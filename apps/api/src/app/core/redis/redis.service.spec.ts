import Redis from 'ioredis';

import {RedisService} from './redis.service';

function fakeClient(status: string) {
	let replyToQuit: () => void = () => undefined;
	const client = {
		status,
		quit: jest.fn(() => new Promise<'OK'>((resolve) => (replyToQuit = () => resolve('OK')))),
		disconnect: jest.fn(),
	};
	return {client, redis: client as unknown as Redis, replyToQuit: () => replyToQuit()};
}

describe('RedisService', () => {
	it('quits a ready connection on shutdown and finishes once Redis replies', async () => {
		const {client, redis, replyToQuit} = fakeClient('ready');
		let finished = false;

		const shutdown = new RedisService(redis).onModuleDestroy().then(() => (finished = true));
		await Promise.resolve();

		expect(client.quit).toHaveBeenCalledTimes(1);
		expect(finished).toBe(false);
		replyToQuit();
		await shutdown;
		expect(finished).toBe(true);
		expect(client.disconnect).not.toHaveBeenCalled();
	});

	it('drops a connection that is not ready on shutdown without waiting for Redis', async () => {
		const {client, redis} = fakeClient('reconnecting');

		await new RedisService(redis).onModuleDestroy();

		expect(client.disconnect).toHaveBeenCalledTimes(1);
		expect(client.quit).not.toHaveBeenCalled();
	});
});
