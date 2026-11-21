import {Injectable} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {BankTransactionCategorizationSource} from '@tempo/contracts';
import {In, IsNull, Repository} from 'typeorm';

import {BankTransaction} from '../bank-transaction.entity';
import {chunkArray} from '../banking.utils';
import {
	createBankTransactionCategorizationInputHash,
	toBankTransactionCategorizationInput,
} from './bank-transaction-categorization-input';
import {
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from './bank-transaction-categorization.provider';
import {BankTransactionCategorizationInput} from './bank-transaction-categorization.types';
import {
	CategoryFieldsUpdate,
	claimableCondition,
	isCounterpartyPayment,
	modelCategorizableSql,
	modelClaimRenewalValues,
	modelClaimValues,
	modelCompletionValues,
	modelFailureValues,
} from './category-fields';

export type ClaimedTransaction = {
	transaction: BankTransaction;
	input: BankTransactionCategorizationInput;
	inputHash: string;
};

/** The model's answer for a row; the store adds status, source and provenance. */
export type CompletionValues = Parameters<typeof modelCompletionValues>[0];

/** Bounds the concurrent hash refreshes so a batch does not take the whole connection pool. */
const REFRESH_CONCURRENCY = 5;
const MAX_ERROR_LENGTH = 500;

/**
 * Reads and writes the categorization columns of transaction rows. Every write is guarded: it skips owner-set,
 * own-transfer and financial-event rows (see `category-fields.ts`) and rows whose input changed since they were read, so a stale worker never
 * overwrites newer data.
 */
@Injectable()
export class CategorizationRowStore {
	constructor(
		@InjectRepository(BankTransaction)
		private readonly repository: Repository<BankTransaction>,
	) {}

	loadBatch(ids: readonly string[]): Promise<BankTransaction[]> {
		return this.repository.find({where: {id: In([...ids])}, relations: {bankAccount: {bankConnection: true}}});
	}

	/**
	 * Refreshes each row's input hash, then claims the claimable rows in one update. A row keeps its category, even one
	 * given for an older input, until a new one is applied. Returns the claimed rows in batch order, and the first refresh failure, if any, so the rows
	 * that were claimed are still categorized before the job fails and retries the rest.
	 */
	async claim(transactions: readonly BankTransaction[]): Promise<{claimed: ClaimedTransaction[]; error?: unknown}> {
		const prepared: ClaimedTransaction[] = [];
		let error: unknown;
		for (const chunk of chunkArray(transactions, REFRESH_CONCURRENCY)) {
			for (const result of await Promise.allSettled(chunk.map((transaction) => this.prepare(transaction)))) {
				if (result.status === 'rejected') error ??= result.reason;
				else if (result.value) prepared.push(result.value);
			}
		}
		if (prepared.length === 0) return {claimed: [], error};

		const claimValues = modelClaimValues(new Date());
		const condition = claimableCondition();
		const result = await this.guardedUpdate(claimValues, claimedInputs(prepared))
			.andWhere(condition.sql, condition.parameters)
			.returning('id')
			.execute();
		const claimedIds = new Set(((result.raw ?? []) as {id: string}[]).map(({id}) => id));
		const claimed = prepared.filter(({transaction}) => claimedIds.has(transaction.id));
		for (const {transaction} of claimed) Object.assign(transaction, claimValues);
		return {claimed, error};
	}

	/**
	 * Moves the claims of rows still being worked on forward, so no other worker takes them as stale. Returns the ids
	 * still held: a row that was deleted, became a currency exchange or an own transfer, or changed input is not.
	 */
	async renewClaims(batch: readonly ClaimedTransaction[]): Promise<Set<string>> {
		if (batch.length === 0) return new Set();
		const result = await this.guardedUpdate(modelClaimRenewalValues(), claimedInputs(batch))
			.andWhere('"categoryStatus" = :processingStatus', {processingStatus: 'PROCESSING'})
			.returning('id')
			.execute();
		return new Set(((result.raw ?? []) as {id: string}[]).map(({id}) => id));
	}

	async complete(
		claimed: ClaimedTransaction,
		values: CompletionValues,
		source: BankTransactionCategorizationSource | null = 'AI',
	): Promise<void> {
		const completionValues = modelCompletionValues(values, source, claimed.inputHash);
		const applied = await this.updateWithGuard(
			claimed.transaction.id,
			claimed.inputHash,
			completionValues,
			'PROCESSING',
		);
		if (applied) Object.assign(claimed.transaction, completionValues);
	}

	/**
	 * A row whose call failed keeps the category it had, so a re-check never blanks a category the owner sees.
	 * Unavailable routes stay PENDING for the job retry and hourly reconciliation; ordinary failures stay FAILED for the
	 * job retry or next start.
	 */
	async markFailed(batch: readonly ClaimedTransaction[], error: unknown): Promise<void> {
		const safeMessage = safeFailureMessage(error);
		const categoryStatus = error instanceof BankTransactionCategorizationUnavailableError ? 'PENDING' : 'FAILED';
		await Promise.all(
			batch.map(async ({transaction, inputHash}) => {
				const values = modelFailureValues(categoryStatus, safeMessage);
				const failed = await this.updateWithGuard(transaction.id, inputHash, values, 'PROCESSING');
				if (failed) Object.assign(transaction, values);
			}),
		);
	}

	/** The row's input and hash once its stored hash is current, or null when it is not for the model. */
	private async prepare(transaction: BankTransaction): Promise<ClaimedTransaction | null> {
		// Own transfers get their transfer category from the own-transfer rule, without a model call; the claim's guard
		// skips manual rows.
		if (!isCounterpartyPayment(transaction)) return null;

		const input = toBankTransactionCategorizationInput({
			...transaction,
			aspspName: transaction.bankAccount?.bankConnection?.aspspName,
		});
		const inputHash = createBankTransactionCategorizationInputHash(input);
		if (!(await this.refreshInputHash(transaction, inputHash))) return null;
		return {transaction, input, inputHash};
	}

	/** Stores the row's current input hash; false when a concurrent write changed the row first. */
	private async refreshInputHash(transaction: BankTransaction, inputHash: string): Promise<boolean> {
		const previousHash = transaction.categoryInputHash;
		if (previousHash === inputHash) return true;
		const result = await this.repository.update(
			{
				id: transaction.id,
				categoryInputHash: previousHash == null ? IsNull() : previousHash,
				financialEventType: IsNull(),
				categoryStatus: transaction.categoryStatus ?? IsNull(),
			},
			{categoryInputHash: inputHash},
		);
		if ((result.affected ?? 0) === 0) return false;
		transaction.categoryInputHash = inputHash;
		return true;
	}

	/** An update of the rows `where` selects that skips owner-set, own-transfer and financial-event rows. */
	private guardedUpdate(values: CategoryFieldsUpdate, where: {sql: string; parameters: Record<string, unknown>}) {
		return this.repository
			.createQueryBuilder()
			.update(BankTransaction)
			.set(values)
			.where(where.sql, where.parameters)
			.andWhere(modelCategorizableSql());
	}

	private async updateWithGuard(
		id: string,
		inputHash: string,
		values: CategoryFieldsUpdate,
		status?: string,
	): Promise<boolean> {
		const query = this.guardedUpdate(values, {sql: 'id = :id', parameters: {id}}).andWhere(
			'"categoryInputHash" = :inputHash',
			{inputHash},
		);
		if (status) query.andWhere('"categoryStatus" = :expectedStatus', {expectedStatus: status});
		const result = await query.execute();
		return (result.affected ?? 0) > 0;
	}
}

/** These rows, each only while it still has the input it was claimed with. */
function claimedInputs(batch: readonly ClaimedTransaction[]): {sql: string; parameters: Record<string, unknown>} {
	return {
		sql: '("id", "categoryInputHash") IN (SELECT * FROM unnest(CAST(:claimedIds AS uuid[]), CAST(:claimedHashes AS text[])))',
		parameters: {
			claimedIds: batch.map(({transaction}) => transaction.id),
			claimedHashes: batch.map(({inputHash}) => inputHash),
		},
	};
}

/** The provider's own messages are safe to store; anything else gets a fixed one. */
function safeFailureMessage(error: unknown): string {
	if (error instanceof BankTransactionCategorizationUnavailableError)
		return 'Claude categorization is temporarily unavailable.';
	if (
		error instanceof BankTransactionCategorizationProviderError &&
		/^Claude (?:categorization request failed|returned an invalid)/.test(error.message)
	)
		return error.message.slice(0, MAX_ERROR_LENGTH);
	return 'Transaction categorization failed.';
}
