import Redis from 'ioredis';

import {BankingAuthorizationStateService} from './banking-authorization-state.service';

const STATE_KEY = 'banking:authorization:state-value';
const CONSUMED_KEY = `${STATE_KEY}:consumed`;
const STORED_STATE = {
	accountId: 'account-id',
	connectionId: 'connection-id',
	aspspName: 'Example Bank',
	aspspCountry: 'XX',
};

describe('BankingAuthorizationStateService', () => {
	let redis: {
		get: jest.Mock;
		eval: jest.Mock;
		del: jest.Mock;
		smembers: jest.Mock;
	};
	let service: BankingAuthorizationStateService;

	beforeEach(() => {
		redis = {
			get: jest.fn(),
			eval: jest.fn(),
			del: jest.fn().mockResolvedValue(0),
			smembers: jest.fn().mockResolvedValue([]),
		};
		service = new BankingAuthorizationStateService(redis as unknown as Redis);
	});

	it('creates an opaque state with the configured TTL, indexed by account and connection', async () => {
		redis.eval.mockResolvedValue(1);

		const state = await service.create(STORED_STATE);

		expect(state).toEqual(expect.any(String));
		expect(state.length).toBeGreaterThan(30);
		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining("'NX'"),
			3,
			`banking:authorization:${state}`,
			'banking:authorization-index:account:account-id',
			'banking:authorization-index:connection:connection-id',
			expect.any(String),
			600,
		);
		expect(JSON.parse(redis.eval.mock.calls[0][5] as string)).toEqual(STORED_STATE);
	});

	it('converts Redis failures into a typed storage error', async () => {
		redis.eval.mockRejectedValue(new Error('Redis is unavailable'));

		await expect(service.create(STORED_STATE)).rejects.toMatchObject({code: 'storage_unavailable'});
	});

	it('reports a failed state write when Redis does not acknowledge it', async () => {
		redis.eval.mockResolvedValue(0);

		await expect(service.create(STORED_STATE)).rejects.toMatchObject({code: 'write_failed'});
	});

	it('consumes a valid state only once', async () => {
		redis.eval.mockResolvedValueOnce([1, JSON.stringify(STORED_STATE)]).mockResolvedValueOnce([2]);

		await expect(service.consumeWithStatus('state-value')).resolves.toEqual({
			status: 'consumed',
			state: STORED_STATE,
		});
		await expect(service.consumeWithStatus('state-value')).resolves.toEqual({status: 'already_consumed'});
		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining("redis.call('GET', KEYS[1])"),
			2,
			STATE_KEY,
			CONSUMED_KEY,
			86_400,
		);
	});

	it('treats a missing state as absent and a malformed one as invalid without throwing', async () => {
		redis.eval.mockResolvedValueOnce([0]).mockResolvedValueOnce([1, '{not-json']);

		await expect(service.consumeWithStatus('missing-state')).resolves.toBeNull();
		await expect(service.consumeWithStatus('malformed-state')).resolves.toEqual({status: 'invalid'});
	});

	it('ignores empty and oversized callback states without reading Redis', async () => {
		await expect(service.consumeWithStatus(undefined)).resolves.toBeNull();
		await expect(service.consumeWithStatus('x'.repeat(257))).resolves.toBeNull();
		expect(redis.eval).not.toHaveBeenCalled();
	});

	it('converts callback-state Redis failures into a typed storage error', async () => {
		redis.eval.mockRejectedValue(new Error('Redis is unavailable'));

		await expect(service.consumeWithStatus('state-value')).rejects.toMatchObject({code: 'storage_unavailable'});
	});

	describe('setAuthorizationId', () => {
		it('replaces the state it read, keeping the remaining TTL', async () => {
			const storedValue = JSON.stringify(STORED_STATE);
			redis.get.mockResolvedValue(storedValue);
			redis.eval.mockResolvedValue(1);

			await service.setAuthorizationId('state-value', 'authorization-id');

			expect(redis.eval).toHaveBeenCalledWith(
				expect.stringContaining("'KEEPTTL'"),
				2,
				STATE_KEY,
				CONSUMED_KEY,
				storedValue,
				JSON.stringify({...STORED_STATE, authorizationId: 'authorization-id'}),
			);
		});

		it('reports a state the callback consumed between the read and the write as consumed, not expired', async () => {
			redis.get.mockResolvedValue(JSON.stringify(STORED_STATE));
			// The replace script finds the state gone and its consumed marker present.
			redis.eval.mockResolvedValue(2);

			await expect(service.setAuthorizationId('state-value', 'authorization-id')).rejects.toMatchObject({
				code: 'state_consumed',
			});
		});

		it.each([
			{case: 'expired', stored: null, outcome: 0, code: 'state_expired'},
			{case: 'changed', stored: JSON.stringify(STORED_STATE), outcome: 3, code: 'state_superseded'},
		])('reports a $case state as $code', async ({stored, outcome, code}) => {
			redis.get.mockResolvedValue(stored);
			redis.eval.mockResolvedValue(outcome);

			await expect(service.setAuthorizationId('state-value', 'authorization-id')).rejects.toMatchObject({code});
		});

		it('refuses a malformed state without writing', async () => {
			redis.get.mockResolvedValue('{not-json');

			await expect(service.setAuthorizationId('state-value', 'authorization-id')).rejects.toMatchObject({
				code: 'state_invalid',
			});
			expect(redis.eval).not.toHaveBeenCalled();
		});
	});

	describe('removeForAccount', () => {
		it('deletes the states in the account index and the index itself', async () => {
			redis.smembers.mockResolvedValueOnce([
				'banking:authorization:state-one',
				'banking:authorization:state-two',
			]);
			redis.del.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

			await expect(service.removeForAccount('account-id')).resolves.toBe(1);

			expect(redis.smembers).toHaveBeenCalledWith('banking:authorization-index:account:account-id');
			expect(redis.del).toHaveBeenNthCalledWith(1, [
				'banking:authorization:state-one',
				'banking:authorization:state-two',
			]);
			expect(redis.del).toHaveBeenNthCalledWith(2, ['banking:authorization-index:account:account-id']);
		});

		it('wraps Redis failures into the typed storage error', async () => {
			redis.smembers.mockRejectedValue(new Error('Redis is unavailable'));

			await expect(service.removeForAccount('account-id')).rejects.toMatchObject({code: 'storage_unavailable'});
		});
	});

	describe('removeForConnections', () => {
		it('returns zero without touching Redis when no connection ids are provided', async () => {
			await expect(service.removeForConnections([])).resolves.toBe(0);

			expect(redis.smembers).not.toHaveBeenCalled();
			expect(redis.del).not.toHaveBeenCalled();
		});

		it('deletes the indexed states of every given connection once', async () => {
			redis.smembers
				.mockResolvedValueOnce(['banking:authorization:state-one'])
				.mockResolvedValueOnce(['banking:authorization:state-one', 'banking:authorization:state-two']);
			redis.del.mockResolvedValueOnce(2).mockResolvedValueOnce(2);

			await expect(
				service.removeForConnections(['connection-one', 'connection-two', 'connection-one']),
			).resolves.toBe(2);

			expect(redis.smembers).toHaveBeenCalledTimes(2);
			expect(redis.del).toHaveBeenNthCalledWith(1, [
				'banking:authorization:state-one',
				'banking:authorization:state-two',
			]);
			expect(redis.del).toHaveBeenNthCalledWith(2, [
				'banking:authorization-index:connection:connection-one',
				'banking:authorization-index:connection:connection-two',
			]);
		});

		it('converts Redis failures into a typed storage error', async () => {
			redis.smembers.mockRejectedValue(new Error('Redis is unavailable'));

			await expect(service.removeForConnections(['connection-id'])).rejects.toMatchObject({
				code: 'storage_unavailable',
			});
		});
	});
});
