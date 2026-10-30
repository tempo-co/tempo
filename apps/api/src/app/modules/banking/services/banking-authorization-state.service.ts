import {Inject, Injectable} from '@nestjs/common';
import Redis from 'ioredis';
import {randomBytes} from 'node:crypto';

import {REDIS} from '@core/redis/redis.constants';

import {BankingAuthorizationStateError} from '../errors/banking-authorization-state.error';

const STATE_TTL_SECONDS = 10 * 60;
const CONSUMED_STATE_TTL_SECONDS = 24 * 60 * 60;
const SCAN_BATCH_SIZE = '250';
const STATE_KEY_PREFIX = 'banking:authorization:';
const CONSUMED_STATE_KEY_SUFFIX = ':consumed';
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

export type BankingAuthorizationState = {
	accountId: string;
	connectionId: string;
	aspspName: string;
	aspspCountry: string;
	replacesConnectionId?: string | null;
	authorizationId?: string;
	expiresAt: number;
};

export type BankingAuthorizationStateConsumption =
	| {status: 'consumed'; state: BankingAuthorizationState}
	| {status: 'expired'; state: BankingAuthorizationState}
	| {status: 'already_consumed'}
	| {status: 'invalid'};

@Injectable()
export class BankingAuthorizationStateService {
	constructor(@Inject(REDIS) private readonly redis: Redis) {}

	async create(input: Omit<BankingAuthorizationState, 'expiresAt'>): Promise<string> {
		const state = randomBytes(32).toString('base64url');
		const value: BankingAuthorizationState = {
			...input,
			expiresAt: Date.now() + STATE_TTL_SECONDS * 1000,
		};

		const result = await this.runRedisOperation(() =>
			this.redis.set(this.getKey(state), JSON.stringify(value), 'EX', STATE_TTL_SECONDS, 'NX'),
		);
		if (result !== 'OK') throw new BankingAuthorizationStateError('write_failed');

		return state;
	}

	async setAuthorizationId(state: string, authorizationId: string): Promise<void> {
		const key = this.getKey(state);
		const [currentValue, ttl] = await this.runRedisOperation(() =>
			Promise.all([this.redis.get(key), this.redis.ttl(key)]),
		);

		if (!currentValue || ttl <= 0) {
			throw new BankingAuthorizationStateError('state_expired');
		}

		const parsedValue = this.parse(currentValue);
		if (!parsedValue) {
			throw new BankingAuthorizationStateError('state_invalid');
		}

		const result = await this.runRedisOperation(() =>
			this.redis.set(key, JSON.stringify({...parsedValue, authorizationId}), 'EX', Math.max(ttl, 1), 'XX'),
		);
		if (result !== 'OK') throw new BankingAuthorizationStateError('state_expired');
	}

	async consume(state: string | undefined): Promise<BankingAuthorizationState | null> {
		const result = await this.consumeWithStatus(state);
		return result?.status === 'consumed' ? result.state : null;
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
		if (parsedValue.expiresAt <= Date.now()) return {status: 'expired', state: parsedValue};

		return {status: 'consumed', state: parsedValue};
	}

	async delete(state: string): Promise<void> {
		// Keep the consumed marker so a callback racing this cleanup is not mistaken for expiry.
		await this.runRedisOperation(() => this.redis.del(this.getKey(state)));
	}

	/** Removes every pending authorization state owned by the given account. Returns the number of removed states. */
	async removeForAccount(accountId: string): Promise<number> {
		return this.removeMatchingStates((state) => state.accountId === accountId);
	}

	/** Removes the pending authorization state for the given connection. Returns the number of removed states. */
	async removeForConnection(connectionId: string): Promise<number> {
		return this.removeForConnections([connectionId]);
	}

	/** Removes pending authorization states for the given connections. Returns the number of removed states. */
	async removeForConnections(connectionIds: string[]): Promise<number> {
		const connectionIdSet = new Set(connectionIds);
		if (connectionIdSet.size === 0) return 0;

		return this.removeMatchingStates((state) => connectionIdSet.has(state.connectionId));
	}

	private async removeMatchingStates(matches: (state: BankingAuthorizationState) => boolean): Promise<number> {
		const matchingKeys: string[] = [];
		const matchPattern = `${STATE_KEY_PREFIX}*`;
		let cursor = '0';

		while (true) {
			const reply = await this.runRedisOperation(() =>
				this.redis.scan(cursor, 'MATCH', matchPattern, 'COUNT', SCAN_BATCH_SIZE),
			);
			cursor = reply[0];
			const keys = reply[1];

			if (keys.length > 0) {
				const values = await this.runRedisOperation(() => this.redis.mget(keys));
				for (let i = 0; i < keys.length; i++) {
					const parsed = this.parse(values[i] ?? '');
					if (parsed && matches(parsed)) matchingKeys.push(keys[i]);
				}
			}

			if (cursor === '0') break;
		}

		if (matchingKeys.length > 0) {
			await this.runRedisOperation(() => this.redis.del(matchingKeys));
		}
		return matchingKeys.length;
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
				typeof parsed.expiresAt !== 'number' ||
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
}
