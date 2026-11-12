import {Inject, Injectable} from '@nestjs/common';
import Redis from 'ioredis';
import {randomBytes} from 'node:crypto';

import {REDIS} from '@core/redis/redis.constants';

import {BankingAuthorizationStateError} from '../errors/banking-authorization-state.error';

const STATE_TTL_SECONDS = 10 * 60;
const CONSUMED_STATE_TTL_SECONDS = 24 * 60 * 60;
const STATE_KEY_PREFIX = 'banking:authorization:';
const CONSUMED_STATE_KEY_SUFFIX = ':consumed';
const ACCOUNT_INDEX_KEY_PREFIX = 'banking:authorization-index:account:';
const CONNECTION_INDEX_KEY_PREFIX = 'banking:authorization-index:connection:';

/**
 * Writes the state only if it is new and records its key in the account and connection index sets. Each index
 * expires with the newest state it names, so the indexes never outlive their states for long.
 */
const CREATE_STATE_SCRIPT = [
	"if not redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX') then return 0 end",
	'for index = 2, #KEYS do',
	"  redis.call('SADD', KEYS[index], KEYS[1])",
	"  redis.call('EXPIRE', KEYS[index], ARGV[2])",
	'end',
	'return 1',
].join('\n');
const CONSUME_STATE_SCRIPT = [
	"local value = redis.call('GET', KEYS[1])",
	'if not value then',
	"  if redis.call('EXISTS', KEYS[2]) == 1 then return {2} end",
	'  return {0}',
	'end',
	"if redis.call('EXISTS', KEYS[2]) == 1 then return {2} end",
	"redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])",
	"redis.call('DEL', KEYS[1])",
	'return {1, value}',
].join('\n');
/** Replaces the state only while it still holds the value read before, keeping its TTL. */
const REPLACE_STATE_SCRIPT = [
	"local value = redis.call('GET', KEYS[1])",
	'if not value then',
	"  if redis.call('EXISTS', KEYS[2]) == 1 then return 2 end",
	'  return 0',
	'end',
	'if value ~= ARGV[1] then return 3 end',
	"redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')",
	'return 1',
].join('\n');

export type BankingAuthorizationState = {
	accountId: string;
	connectionId: string;
	aspspName: string;
	aspspCountry: string;
	replacesConnectionId?: string | null;
	authorizationId?: string;
};

export type BankingAuthorizationStateConsumption =
	{status: 'consumed'; state: BankingAuthorizationState} | {status: 'already_consumed'} | {status: 'invalid'};

/** One-time authorization states in Redis. The key's TTL is the state's only expiry. */
@Injectable()
export class BankingAuthorizationStateService {
	constructor(@Inject(REDIS) private readonly redis: Redis) {}

	async create(input: BankingAuthorizationState): Promise<string> {
		const state = randomBytes(32).toString('base64url');

		const result = await this.runRedisOperation(() =>
			this.redis.eval(
				CREATE_STATE_SCRIPT,
				3,
				this.getKey(state),
				this.getAccountIndexKey(input.accountId),
				this.getConnectionIndexKey(input.connectionId),
				JSON.stringify(input),
				STATE_TTL_SECONDS,
			),
		);
		if (Number(result) !== 1) throw new BankingAuthorizationStateError('write_failed');

		return state;
	}

	async setAuthorizationId(state: string, authorizationId: string): Promise<void> {
		const key = this.getKey(state);
		const currentValue = await this.runRedisOperation(() => this.redis.get(key));
		const parsedValue = currentValue ? this.parse(currentValue) : null;
		if (currentValue && !parsedValue) {
			throw new BankingAuthorizationStateError('state_invalid');
		}

		const result = await this.runRedisOperation(() =>
			this.redis.eval(
				REPLACE_STATE_SCRIPT,
				2,
				key,
				this.getConsumedKey(state),
				currentValue ?? '',
				parsedValue ? JSON.stringify({...parsedValue, authorizationId}) : '',
			),
		);
		const outcome = Number(result);
		if (outcome === 1) return;
		if (outcome === 2) throw new BankingAuthorizationStateError('state_consumed');
		if (outcome === 3) throw new BankingAuthorizationStateError('state_superseded');
		throw new BankingAuthorizationStateError('state_expired');
	}

	async consumeWithStatus(state: string | undefined): Promise<BankingAuthorizationStateConsumption | null> {
		if (!state || state.length > 256) return null;

		const result = await this.runRedisOperation(() =>
			this.redis.eval(
				CONSUME_STATE_SCRIPT,
				2,
				this.getKey(state),
				this.getConsumedKey(state),
				CONSUMED_STATE_TTL_SECONDS,
			),
		);
		if (!Array.isArray(result)) return {status: 'invalid'};

		const outcome = Number(result[0]);
		if (outcome === 0) return null;
		if (outcome === 2) return {status: 'already_consumed'};
		if (outcome !== 1 || typeof result[1] !== 'string') return {status: 'invalid'};

		const parsedValue = this.parse(result[1]);
		if (!parsedValue) return {status: 'invalid'};

		return {status: 'consumed', state: parsedValue};
	}

	async delete(state: string): Promise<void> {
		// Keep the consumed marker so a callback racing this cleanup is not mistaken for expiry.
		await this.runRedisOperation(() => this.redis.del(this.getKey(state)));
	}

	/** Removes every pending authorization state owned by the given account. Returns the number of removed states. */
	async removeForAccount(accountId: string): Promise<number> {
		return this.removeIndexedStates([this.getAccountIndexKey(accountId)]);
	}

	/** Removes pending authorization states for the given connections. Returns the number of removed states. */
	async removeForConnections(connectionIds: string[]): Promise<number> {
		const indexKeys = [...new Set(connectionIds)].map((connectionId) => this.getConnectionIndexKey(connectionId));
		if (indexKeys.length === 0) return 0;

		return this.removeIndexedStates(indexKeys);
	}

	/** Deletes the states the index sets name and the sets themselves. Consumed markers stay. */
	private async removeIndexedStates(indexKeys: string[]): Promise<number> {
		const members = await this.runRedisOperation(() =>
			Promise.all(indexKeys.map((indexKey) => this.redis.smembers(indexKey))),
		);
		const stateKeys = [...new Set(members.flat())];

		const removed = stateKeys.length > 0 ? await this.runRedisOperation(() => this.redis.del(stateKeys)) : 0;
		await this.runRedisOperation(() => this.redis.del(indexKeys));
		return removed;
	}

	private async runRedisOperation<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch {
			throw new BankingAuthorizationStateError('storage_unavailable');
		}
	}

	private parse(value: string): BankingAuthorizationState | null {
		try {
			const parsed = JSON.parse(value) as Partial<BankingAuthorizationState>;

			if (
				typeof parsed.accountId !== 'string' ||
				typeof parsed.connectionId !== 'string' ||
				typeof parsed.aspspName !== 'string' ||
				typeof parsed.aspspCountry !== 'string' ||
				(parsed.replacesConnectionId !== undefined &&
					parsed.replacesConnectionId !== null &&
					typeof parsed.replacesConnectionId !== 'string') ||
				(parsed.authorizationId !== undefined && typeof parsed.authorizationId !== 'string')
			) {
				return null;
			}

			return parsed as BankingAuthorizationState;
		} catch {
			return null;
		}
	}

	private getConsumedKey(state: string): string {
		return `${this.getKey(state)}${CONSUMED_STATE_KEY_SUFFIX}`;
	}

	private getKey(state: string): string {
		return `${STATE_KEY_PREFIX}${state}`;
	}

	private getAccountIndexKey(accountId: string): string {
		return `${ACCOUNT_INDEX_KEY_PREFIX}${accountId}`;
	}

	private getConnectionIndexKey(connectionId: string): string {
		return `${CONNECTION_INDEX_KEY_PREFIX}${connectionId}`;
	}
}
