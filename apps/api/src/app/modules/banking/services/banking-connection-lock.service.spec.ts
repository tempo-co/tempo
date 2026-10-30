import Redis from 'ioredis';

import {
	BANKING_SERVICE_UNAVAILABLE,
	BANKING_SYNC_ALREADY_IN_PROGRESS,
} from '../api/constants/banking-messages.constants';
import {BankingConnectionLockService} from './banking-connection-lock.service';

type RedisState = {
	redis: Redis;
	owners: Map<string, string>;
	renewalShouldFail: {value: boolean};
};

function createRedisState(): RedisState {
	const owners = new Map<string, string>();
	const renewalShouldFail = {value: false};
	const redis = {
		set: jest.fn(async (key: string, token: string) => {
			if (owners.has(key)) return null;
			owners.set(key, token);
			return 'OK';
		}),
		eval: jest.fn(async (script: string, _keyCount: number, key: string, token: string) => {
			if (script.includes('expire')) {
				if (renewalShouldFail.value) return 0;
				if (!owners.has(key) || owners.get(key) !== token) return 0;
				return 1;
			}

			if (owners.get(key) !== token) return 0;
			owners.delete(key);
			return 1;
		}),
	} as unknown as Redis;

	return {redis, owners, renewalShouldFail};
}

describe('BankingConnectionLockService', () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('rejects a second owner while the connection mutation lock is held', async () => {
		const {redis} = createRedisState();
		const service = new BankingConnectionLockService(redis);
		const firstLock = await service.acquire('connection-id');

		await expect(service.acquire('connection-id')).rejects.toThrow(BANKING_SYNC_ALREADY_IN_PROGRESS);

		firstLock.stop();
		await firstLock.release();
	});

	it('waits briefly for the current owner when requested', async () => {
		jest.useRealTimers();
		const {redis} = createRedisState();
		const service = new BankingConnectionLockService(redis);
		const firstLock = await service.acquire('connection-id');
		const secondLockPromise = service.acquire('connection-id', {waitForMs: 1_000});

		await new Promise((resolve) => setTimeout(resolve, 100));
		firstLock.stop();
		await firstLock.release();
		const secondLock = await secondLockPromise;

		expect(secondLock).toBeDefined();
		secondLock.stop();
		await secondLock.release();
	});

	it('does not release a lock that a different token now owns', async () => {
		const {redis, owners} = createRedisState();
		const service = new BankingConnectionLockService(redis);
		const lock = await service.acquire('connection-id');
		const key = 'banking:sync:connection-id';
		owners.set(key, 'replacement-owner');

		lock.stop();
		await lock.release();

		expect(owners.get(key)).toBe('replacement-owner');
	});

	it('aborts the holder and fails health checks when renewal loses ownership', async () => {
		const {redis, renewalShouldFail} = createRedisState();
		const service = new BankingConnectionLockService(redis);
		const lock = await service.acquire('connection-id');
		renewalShouldFail.value = true;

		await jest.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

		expect(lock.signal.aborted).toBe(true);
		expect(() => lock.assertHealthy()).toThrow(BANKING_SERVICE_UNAVAILABLE);

		lock.stop();
		await lock.release();
	});

	it('stops renewal and releases the lock when caller cleanup runs after an error', async () => {
		const {redis, owners} = createRedisState();
		const service = new BankingConnectionLockService(redis);
		const lock = await service.acquire('connection-id');
		const renewalCallsBeforeCleanup = (redis.eval as jest.Mock).mock.calls.length;

		lock.stop();
		await lock.release();
		await jest.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

		expect(owners.size).toBe(0);
		expect((redis.eval as jest.Mock).mock.calls).toHaveLength(renewalCallsBeforeCleanup + 1);
	});
});
