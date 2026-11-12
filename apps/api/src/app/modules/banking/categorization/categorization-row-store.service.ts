import {Injectable} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {
	BankTransactionCategorizationSource,
	BankTransactionCategorizationStatus,
	BankTransactionCategory,
} from '@tempo/contracts';
import {In, IsNull, Repository} from 'typeorm';

import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '../bank-transaction-financial-event';
import {BankTransaction} from '../bank-transaction.entity';
import {chunkArray} from '../banking.utils';
import {isOwnTransferCategorized, notOwnTransferCategorizedSql} from '../own-transfer/own-transfer-category';
import {
	createBankTransactionCategorizationInputHash,
	toBankTransactionCategorizationInput,
} from './bank-transaction-categorization-input';
import {BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES} from './bank-transaction-categorization.constants';
import {
	BankTransactionCategorizationProviderError,
	BankTransactionCategorizationUnavailableError,
} from './bank-transaction-categorization.provider';
import {
	BankTransactionCategorizationInput,
	BankTransactionCategorizationSearchTrace,
	CLAIMABLE_CATEGORIZATION_STATUSES,
	isManualCategorySource,
	notManualCategorySourceSql,
} from './bank-transaction-categorization.types';

export type ClaimedTransaction = {
	transaction: BankTransaction;
	input: BankTransactionCategorizationInput;
	inputHash: string;
};

export type CategorizationUpdate = {
	category?: BankTransactionCategory | null;
	categoryStatus?: BankTransactionCategorizationStatus;
	categorySource?: BankTransactionCategorizationSource | null;
	categoryConfidence?: string | null;
	categoryAppliedInputHash?: string | null;
	categoryProvider?: string | null;
	categoryModel?: string | null;
	categoryPromptVersion?: string | null;
	categorySearchTrace?: BankTransactionCategorizationSearchTrace | null;
	categoryUpdatedAt?: Date;
	categoryLastError?: string | null;
};

export type CompletionValues = Pick<
	CategorizationUpdate,
	| 'category'
	| 'categoryConfidence'
	| 'categoryProvider'
	| 'categoryModel'
	| 'categoryPromptVersion'
	| 'categorySearchTrace'
>;

/**
 * How long a PROCESSING claim holds before another worker may take the row. The pipeline renews its claims before
 * every provider call after the first, so this only has to outlast one call on both routes (90 s on the API plus 125 s
 * on the bridge) with the database work around it. A worker that died leaves its rows for the next sweep after this.
 */
const STALE_PROCESSING_AFTER_MS = 15 * 60 * 1000;
/** Bounds the concurrent hash refreshes so a batch does not take the whole connection pool. */
const REFRESH_CONCURRENCY = 5;
const MAX_ERROR_LENGTH = 500;

/**
 * The condition for rows a worker may claim: claimable statuses, or a PROCESSING claim older than the stale window.
 * `alias` qualifies the columns in a select; updates use bare column names.
 */
export function claimableCondition(
	alias?: string,
	statuses: readonly string[] = CLAIMABLE_CATEGORIZATION_STATUSES,
): {sql: string; parameters: Record<string, unknown>} {
	const status = alias ? `${alias}."categoryStatus"` : '"categoryStatus"';
	const updatedAt = alias ? `${alias}."categoryUpdatedAt"` : '"categoryUpdatedAt"';
	return {
		sql: `(${status} IN (:...claimableStatuses) OR (${status} = :processingStatus AND (${updatedAt} IS NULL OR ${updatedAt} < :staleBefore)))`,
		parameters: {
			claimableStatuses: statuses,
			processingStatus: 'PROCESSING',
			staleBefore: new Date(Date.now() - STALE_PROCESSING_AFTER_MS),
		},
	};
}

/**
 * Reads and writes the categorization columns of transaction rows. Every write is guarded: it skips owner-set,
 * own-transfer and currency-exchange rows and rows whose input changed since they were read, so a stale worker never
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
	 * Refreshes each row's input hash (resetting a classification made for an older input), then claims the claimable
	 * rows in one update. Returns the claimed rows in batch order, and the first refresh failure, if any, so the rows
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

		const claimedAt = new Date();
		const condition = claimableCondition();
		const result = await this.guardedUpdate(
			{categoryStatus: 'PROCESSING', categoryUpdatedAt: claimedAt},
			claimedInputs(prepared),
		)
			.andWhere(condition.sql, condition.parameters)
			.returning('id')
			.execute();
		const claimedIds = new Set(((result.raw ?? []) as {id: string}[]).map(({id}) => id));
		const claimed = prepared.filter(({transaction}) => claimedIds.has(transaction.id));
		for (const {transaction} of claimed)
			Object.assign(transaction, {categoryStatus: 'PROCESSING', categoryUpdatedAt: claimedAt});
		return {claimed, error};
	}

	/** Moves the claims of rows still being worked on forward, so no other worker takes them as stale. */
	async renewClaims(batch: readonly ClaimedTransaction[]): Promise<void> {
		if (batch.length === 0) return;
		await this.guardedUpdate({categoryUpdatedAt: new Date()}, claimedInputs(batch))
			.andWhere('"categoryStatus" = :processingStatus', {processingStatus: 'PROCESSING'})
			.execute();
	}

	async complete(
		claimed: ClaimedTransaction,
		values: CompletionValues,
		source: BankTransactionCategorizationSource | null = 'AI',
	): Promise<void> {
		const completionValues: CategorizationUpdate = {
			...values,
			categoryStatus: 'COMPLETED',
			categorySource: source,
			categoryAppliedInputHash: claimed.inputHash,
			categoryLastError: null,
		};
		const applied = await this.updateWithGuard(
			claimed.transaction.id,
			claimed.inputHash,
			{...completionValues, categoryUpdatedAt: new Date()},
			'PROCESSING',
		);
		if (applied) Object.assign(claimed.transaction, completionValues);
	}

	/**
	 * A row sent back to the model keeps its category when the call fails, as long as that category was given for the
	 * same input. Unavailable routes stay PENDING for the job retry and hourly reconciliation; ordinary failures stay
	 * FAILED for the job retry or next start. Other rows are cleared.
	 */
	async markFailed(batch: readonly ClaimedTransaction[], error: unknown): Promise<void> {
		const safeMessage = safeFailureMessage(error);
		const categoryStatus = error instanceof BankTransactionCategorizationUnavailableError ? 'PENDING' : 'FAILED';
		await Promise.all(
			batch.map(async ({transaction, inputHash}) => {
				const keepCategory = transaction.category != null && transaction.categoryAppliedInputHash === inputHash;
				const values: CategorizationUpdate = {
					...(keepCategory ? {} : BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES),
					categoryStatus,
					categoryLastError: safeMessage,
				};
				const failed = await this.updateWithGuard(
					transaction.id,
					inputHash,
					{...values, categoryUpdatedAt: new Date()},
					'PROCESSING',
				);
				if (failed) Object.assign(transaction, values);
			}),
		);
	}

	/** The row's input and hash once its stored hash is current, or null when it is not for the model. */
	private async prepare(transaction: BankTransaction): Promise<ClaimedTransaction | null> {
		// Own transfers get their transfer category from the own-transfer rule, without a model call.
		if (
			transaction.financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE ||
			isOwnTransferCategorized(transaction)
		)
			return null;

		const input = toBankTransactionCategorizationInput({
			...transaction,
			aspspName: transaction.bankAccount?.bankConnection?.aspspName,
		});
		const inputHash = createBankTransactionCategorizationInputHash(input);
		if (!(await this.refreshInputHashAndResetStaleClassification(transaction, inputHash))) return null;
		return {transaction, input, inputHash};
	}

	private async refreshInputHashAndResetStaleClassification(
		transaction: BankTransaction,
		inputHash: string,
	): Promise<boolean> {
		const previousHash = transaction.categoryInputHash;
		if (previousHash !== inputHash) {
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
		}

		if (isManualCategorySource(transaction.categorySource)) return true;
		if (transaction.categoryStatus === 'COMPLETED') return true;
		const appliedHashIsStale =
			transaction.categoryAppliedInputHash !== null && transaction.categoryAppliedInputHash !== inputHash;
		if (!appliedHashIsStale) return true;

		const reset = await this.updateWithGuard(
			transaction.id,
			inputHash,
			{...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES, categoryStatus: 'PENDING', categoryUpdatedAt: new Date()},
			transaction.categoryStatus ?? undefined,
		);
		if (reset)
			Object.assign(transaction, {...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES, categoryStatus: 'PENDING'});
		return true;
	}

	/** An update of the rows `where` selects that skips owner-set, own-transfer and currency-exchange rows. */
	private guardedUpdate(values: CategorizationUpdate, where: {sql: string; parameters: Record<string, unknown>}) {
		return this.repository
			.createQueryBuilder()
			.update(BankTransaction)
			.set(values)
			.where(where.sql, where.parameters)
			.andWhere(notManualCategorySourceSql())
			.andWhere(notOwnTransferCategorizedSql())
			.andWhere('"financialEventType" IS DISTINCT FROM :financialEventType', {
				financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			});
	}

	private async updateWithGuard(
		id: string,
		inputHash: string,
		values: CategorizationUpdate,
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
