import Redis from 'ioredis';

import {BankingAuthorizationStateService} from './banking-authorization-state.service';

describe('BankingAuthorizationStateService', () => {
	let redis: {
		set: jest.Mock;
		get: jest.Mock;
		ttl: jest.Mock;
		eval: jest.Mock;
		del: jest.Mock;
		scan: jest.Mock;
		mget: jest.Mock;
	};
	let service: BankingAuthorizationStateService;

	beforeEach(() => {
		redis = {
			set: jest.fn(),
			get: jest.fn(),
			ttl: jest.fn(),
			eval: jest.fn(),
			del: jest.fn(),
			scan: jest.fn().mockResolvedValue(['0', []]),
			mget: jest.fn().mockResolvedValue([]),
		};
		service = new BankingAuthorizationStateService(redis as unknown as Redis);
	});

	it('creates an opaque state with the configured TTL', async () => {
		redis.set.mockResolvedValue('OK');

		const state = await service.create({
			accountId: 'account-id',
			connectionId: 'connection-id',
			aspspName: 'ABN AMRO',
			aspspCountry: 'NL',
		});

		expect(state).toEqual(expect.any(String));
		expect(state.length).toBeGreaterThan(30);
		expect(redis.set).toHaveBeenCalledWith(
			expect.stringContaining('banking:authorization:'),
			expect.any(String),
			'EX',
			600,
			'NX',
		);

		const serializedState = redis.set.mock.calls[0][1] as string;
		expect(JSON.parse(serializedState)).toEqual(
			expect.objectContaining({
				accountId: 'account-id',
				connectionId: 'connection-id',
				aspspName: 'ABN AMRO',
				aspspCountry: 'NL',
			}),
		);
	});

	it('converts Redis failures into a typed storage error', async () => {
		redis.set.mockRejectedValue(new Error('Redis is unavailable'));

		await expect(
			service.create({
				accountId: 'account-id',
				connectionId: 'connection-id',
				aspspName: 'ABN AMRO',
				aspspCountry: 'NL',
			}),
		).rejects.toMatchObject({
			code: 'storage_unavailable',
		});
	});

	it('reports a failed state write when Redis does not acknowledge it', async () => {
		redis.set.mockResolvedValue(null);

		await expect(
			service.create({
				accountId: 'account-id',
				connectionId: 'connection-id',
				aspspName: 'ABN AMRO',
				aspspCountry: 'NL',
			}),
		).rejects.toMatchObject({
			code: 'write_failed',
		});
	});

	it('consumes a valid state only once', async () => {
		redis.eval
			.mockResolvedValueOnce([
				1,
				JSON.stringify({
					accountId: 'account-id',
					connectionId: 'connection-id',
					aspspName: 'ABN AMRO',
					aspspCountry: 'NL',
					expiresAt: Date.now() + 60_000,
				}),
			])
			.mockResolvedValueOnce([2]);

		await expect(service.consume('state-value')).resolves.toEqual(
			expect.objectContaining({accountId: 'account-id', connectionId: 'connection-id'}),
		);
		await expect(service.consume('state-value')).resolves.toBeNull();
		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining("redis.call('GET', KEYS[1])"),
			2,
			expect.stringContaining('banking:authorization:'),
			expect.stringContaining(':consumed'),
			86_400,
		);
	});

	it('treats missing or malformed state as an invalid callback without throwing', async () => {
		redis.eval.mockResolvedValueOnce([0]).mockResolvedValueOnce([1, '{not-json']);

		await expect(service.consume('missing-state')).resolves.toBeNull();
		await expect(service.consume('malformed-state')).resolves.toBeNull();
	});

	it('converts callback-state Redis failures into a typed storage error', async () => {
		redis.eval.mockRejectedValue(new Error('Redis is unavailable'));

		await expect(service.consume('state-value')).rejects.toMatchObject({
			code: 'storage_unavailable',
		});
	});

	it('distinguishes an expired state from a replayed state', async () => {
		const expiredState = {
			accountId: 'account-id',
			connectionId: 'connection-id',
			aspspName: 'ABN AMRO',
			aspspCountry: 'NL',
			expiresAt: Date.now() - 1,
		};
		redis.eval.mockResolvedValueOnce([1, JSON.stringify(expiredState)]).mockResolvedValueOnce([2]);

		await expect(service.consumeWithStatus('expired-state')).resolves.toEqual({
			status: 'expired',
			state: expiredState,
		});
		await expect(service.consumeWithStatus('expired-state')).resolves.toEqual({status: 'already_consumed'});
	});

	it('updates the authorization id while retaining the remaining TTL', async () => {
		redis.get.mockResolvedValue(
			JSON.stringify({
				accountId: 'account-id',
				connectionId: 'connection-id',
				aspspName: 'ABN AMRO',
				aspspCountry: 'NL',
				expiresAt: Date.now() + 60_000,
			}),
		);
		redis.ttl.mockResolvedValue(500);
		redis.set.mockResolvedValue('OK');

		await service.setAuthorizationId('state-value', 'authorization-id');

		expect(redis.set).toHaveBeenCalledWith(
			'banking:authorization:state-value',
			expect.stringContaining('authorization-id'),
			'EX',
			500,
			'XX',
		);
	});

	describe('removeForAccount', () => {
		it('deletes pending authorization states owned by the given account', async () => {
			redis.scan
				.mockResolvedValueOnce(['2', ['banking:authorization:state-one', 'banking:authorization:state-two']])
				.mockResolvedValueOnce(['0', ['banking:authorization:state-three']]);
			redis.mget
				.mockResolvedValueOnce([
					JSON.stringify({
						accountId: 'account-id',
						connectionId: 'connection-one',
						aspspName: 'A',
						aspspCountry: 'NL',
						expiresAt: Date.now() + 60_000,
					}),
					JSON.stringify({
						accountId: 'other-account',
						connectionId: 'connection-two',
						aspspName: 'A',
						aspspCountry: 'NL',
						expiresAt: Date.now() + 60_000,
					}),
				])
				.mockResolvedValueOnce([null]);

			await expect(service.removeForAccount('account-id')).resolves.toBe(1);
			expect(redis.del).toHaveBeenCalledTimes(1);
			expect(redis.del).toHaveBeenCalledWith(['banking:authorization:state-one']);
		});

		it('returns 0 when no owned states are pending and leaves Redis untouched', async () => {
			redis.scan.mockResolvedValue(['0', []]);

			await expect(service.removeForAccount('account-id')).resolves.toBe(0);
			expect(redis.del).not.toHaveBeenCalled();
		});

		it('wraps Redis failures into the typed storage error', async () => {
			redis.scan.mockRejectedValue(new Error('Redis is unavailable'));

			await expect(service.removeForAccount('account-id')).rejects.toMatchObject({code: 'storage_unavailable'});
		});
	});

	describe('removeForConnection', () => {
		it('deletes only the pending authorization state for the given connection', async () => {
			redis.scan.mockResolvedValueOnce(['0', ['banking:authorization:***', 'banking:authorization:***']]);
			redis.mget.mockResolvedValueOnce([
				JSON.stringify({
					accountId: 'account-id',
					connectionId: 'connection-id',
					aspspName: 'A',
					aspspCountry: 'NL',
					expiresAt: Date.now() + 60_000,
				}),
				JSON.stringify({
					accountId: 'account-id',
					connectionId: 'other-connection',
					aspspName: 'A',
					aspspCountry: 'NL',
					expiresAt: Date.now() + 60_000,
				}),
			]);

			await expect(service.removeForConnection('connection-id')).resolves.toBe(1);
			expect(redis.del).toHaveBeenCalledWith(['banking:authorization:***']);
		});
	});

	describe('removeForConnections', () => {
		it('returns zero without scanning when no connection ids are provided', async () => {
			await expect(service.removeForConnections([])).resolves.toBe(0);

			expect(redis.scan).not.toHaveBeenCalled();
			expect(redis.mget).not.toHaveBeenCalled();
			expect(redis.del).not.toHaveBeenCalled();
		});

		it('scans once and deletes matching states for multiple connections', async () => {
			const keys = [
				'banking:authorization:state-one',
				'banking:authorization:state-two',
				'banking:authorization:unrelated',
				'banking:authorization:malformed',
				'banking:authorization:expired',
				'banking:authorization:state-one:consumed',
			];
			redis.scan.mockResolvedValueOnce(['0', keys]);
			redis.mget.mockResolvedValueOnce([
				JSON.stringify({
					accountId: 'account-id',
					connectionId: 'connection-one',
					aspspName: 'A',
					aspspCountry: 'NL',
					expiresAt: Date.now() + 60_000,
				}),
				JSON.stringify({
					accountId: 'account-id',
					connectionId: 'connection-two',
					aspspName: 'A',
					aspspCountry: 'NL',
					expiresAt: Date.now() - 1,
				}),
				JSON.stringify({
					accountId: 'account-id',
					connectionId: 'unrelated-connection',
					aspspName: 'A',
					aspspCountry: 'NL',
					expiresAt: Date.now() + 60_000,
				}),
				'{not-json',
				null,
				'1',
			]);

			await expect(service.removeForConnections(['connection-one', 'connection-two'])).resolves.toBe(2);

			expect(redis.scan).toHaveBeenCalledTimes(1);
			expect(redis.mget).toHaveBeenCalledTimes(1);
			expect(redis.del).toHaveBeenCalledWith([keys[0], keys[1]]);
		});

		it('converts Redis failures into a typed storage error', async () => {
			redis.scan.mockRejectedValue(new Error('Redis is unavailable'));

			await expect(service.removeForConnections(['connection-id'])).rejects.toMatchObject({
				code: 'storage_unavailable',
			});
		});
	});
});
