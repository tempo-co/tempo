import {Injectable} from '@nestjs/common';
import {FindOptionsSelect, In, Repository} from 'typeorm';

import {BankAccount} from '../bank-account.entity';
import {
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
	detectCurrencyExchangeMarker,
} from '../bank-transaction-financial-event';
import {
	assignBankTransactionStableIdentityKeys,
	bankTransactionStableIdentityKeyRange,
	createBankTransactionStableIdentityGroupKey,
	createBankTransactionStableIdentityKey,
} from '../bank-transaction-identity';
import {normalizeBankTransactionLocation} from '../bank-transaction-location';
import {deriveBankTransactionTextColumns} from '../bank-transaction-text-columns';
import {normalizeBankTransactionType} from '../bank-transaction-type';
import {BankTransaction} from '../bank-transaction.entity';
import {
	BATCH_WRITE_CHUNK_SIZE,
	buildPostgresValuesList,
	chunkArray,
	normalizeBankCode,
	toDateOnly,
	truncate,
} from '../banking.utils';
import {
	createBankTransactionCategorizationInputHash,
	toBankTransactionCategorizationInput,
} from '../categorization/bank-transaction-categorization-input';
import {
	isManualCategorySource,
	notManualCategorySourceSql,
} from '../categorization/bank-transaction-categorization.types';
import {EnableBankingTransaction} from '../enable-banking.types';
import {notOwnTransferCategorizedSql} from '../own-transfer/own-transfer-category';
import {BASE_AMOUNT_INPUT_COLUMNS, baseAmountInputsSql} from './bank-transaction-amount-conversion.utils';

const BANK_TRANSACTION_IDENTITY_SELECT = {
	id: true,
	bankAccountId: true,
	entryReference: true,
	transactionDate: true,
	bookingDate: true,
	valueDate: true,
	bookingDateFilled: true,
	valueDateFilled: true,
	amount: true,
	currency: true,
	creditDebitIndicator: true,
	bankTransactionCode: true,
	bankTransactionSubCode: true,
	bankTransactionDescription: true,
	description: true,
	counterpartyName: true,
	merchantLocation: true,
	merchantCategoryCode: true,
	remittanceInformation: true,
	instructedAmount: true,
	instructedCurrency: true,
	exchangeRate: true,
	exchangeRateUnitCurrency: true,
	exchangeRateType: true,
	referenceNumber: true,
	referenceNumberScheme: true,
	stableIdentityKey: true,
	stableIdentityGroupKey: true,
	transactionStatus: true,
} satisfies FindOptionsSelect<BankTransaction>;

const PENDING_ROW_SQL = `UPPER(BTRIM("transactionStatus")) = 'PDNG'`;
/** A pending row's earliest date: a fetch window starting on or before it covers the row whichever date the bank filters on. */
const PENDING_ROW_START_SQL = 'LEAST("transactionDate", "bookingDate", "valueDate")';

export type PersistTransactionsResult = {
	transactionsAdded: number;
	persistedTransactionIds: string[];
};

@Injectable()
export class BankTransactionPersistenceService {
	/**
	 * The stored keys among the occurrences new rows of these groups could take. Each group is checked from its first
	 * occurrence until it has as many free occurrences as it has new rows, so allocating from the result never
	 * overwrites a stored row, including one that kept its key after moving to another group. The first query covers
	 * `newRows + storedRows` occurrences, which is enough unless rows moved between groups.
	 */
	private async findOccupiedTransactionIdentityKeys(
		repository: Repository<BankTransaction>,
		bankAccountId: BankAccount['id'],
		groups: ReadonlyArray<{groupKey: string; newRows: number; storedRows: number}>,
	): Promise<Set<string>> {
		const occupied = new Set<string>();
		let ranges = groups.map(({groupKey, newRows, storedRows}) => ({
			groupKey,
			needed: newRows,
			first: 1,
			count: newRows + storedRows,
		}));
		while (ranges.length > 0) {
			const candidates = ranges.map((range) => ({
				...range,
				keys: bankTransactionStableIdentityKeyRange(range.groupKey, range.first, range.count),
			}));
			for (const keys of chunkArray(
				candidates.flatMap(({keys}) => keys),
				BATCH_WRITE_CHUNK_SIZE,
			)) {
				const rows: Array<{stableIdentityKey: string}> = await repository.query(
					`SELECT "stableIdentityKey" FROM "bank_transactions"
					WHERE "bankAccountId" = $1 AND "stableIdentityKey" = ANY($2::varchar[])`,
					[bankAccountId, keys],
				);
				for (const {stableIdentityKey} of rows) occupied.add(stableIdentityKey);
			}
			ranges = candidates.flatMap(({groupKey, needed, first, count, keys}) => {
				const stillNeeded = needed - keys.filter((key) => !occupied.has(key)).length;
				return stillNeeded > 0 ? [{groupKey, needed: stillNeeded, first: first + count, count: count * 2}] : [];
			});
		}
		return occupied;
	}

	async persistTransactions(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
		transactions: EnableBankingTransaction[],
		aspspName: string,
		// Nothing stored depends on the provider; the parameter keeps the callers' shared signature.
		_provider: string,
	): Promise<PersistTransactionsResult> {
		const unassignedTransactionValues = transactions.map((transaction) =>
			this.toBankTransactionValues(bankAccount, transaction, aspspName),
		);
		const stableIdentityGroupKeys = [
			...new Set(unassignedTransactionValues.map(({stableIdentityGroupKey}) => stableIdentityGroupKey)),
		];
		const entryReferences = [
			...new Set(
				unassignedTransactionValues.flatMap(({entryReference}) =>
					entryReference?.trim() ? [entryReference] : [],
				),
			),
		];
		const existingTransactions = await repository.find({
			select: {
				...BANK_TRANSACTION_IDENTITY_SELECT,
				categoryInputHash: true,
				categorySource: true,
				categoryStatus: true,
				financialEventType: true,
			},
			// Include every same-reference candidate, not just pending rows: repeated references
			// and already-booked copies must make a cross-group transition ambiguous.
			where: entryReferences.length
				? [
						{bankAccountId: bankAccount.id, stableIdentityGroupKey: In(stableIdentityGroupKeys)},
						{bankAccountId: bankAccount.id, entryReference: In(entryReferences)},
					]
				: {bankAccountId: bankAccount.id, stableIdentityGroupKey: In(stableIdentityGroupKeys)},
		});
		// Rows the assignment cannot match need free occurrences of their group; a stored row can hold one of them
		// after it moved to another group, so look at the keys themselves, not just the rows of the group.
		const countByGroup = (rows: ReadonlyArray<{stableIdentityGroupKey: string}>) =>
			rows.reduce(
				(counts, {stableIdentityGroupKey}) =>
					counts.set(stableIdentityGroupKey, (counts.get(stableIdentityGroupKey) ?? 0) + 1),
				new Map<string, number>(),
			);
		const newRowsByGroup = countByGroup(unassignedTransactionValues);
		const storedRowsByGroup = countByGroup(existingTransactions);
		const occupiedIdentityKeys = await this.findOccupiedTransactionIdentityKeys(
			repository,
			bankAccount.id,
			stableIdentityGroupKeys.map((groupKey) => ({
				groupKey,
				newRows: newRowsByGroup.get(groupKey) ?? 0,
				storedRows: storedRowsByGroup.get(groupKey) ?? 0,
			})),
		);
		const transactionValues = assignBankTransactionStableIdentityKeys(
			unassignedTransactionValues,
			existingTransactions,
			occupiedIdentityKeys,
		);
		const stableIdentityKeys = transactionValues.map(({stableIdentityKey}) => stableIdentityKey);
		// The exchange recompute after the sync decides which marked rows are exchanges.
		const exchangeMarkerKeys = transactionValues.flatMap((value) =>
			detectCurrencyExchangeMarker({
				accountCurrency: bankAccount.currency,
				transactionCurrency: value.currency,
				creditDebitIndicator: value.creditDebitIndicator,
				description: value.description,
				bankTransactionCode: value.bankTransactionCode,
				bankTransactionSubCode: value.bankTransactionSubCode,
			})
				? [value.stableIdentityKey]
				: [],
		);

		const conflictColumns = ['bankAccountId', 'stableIdentityKey'];
		const overwriteColumns = Object.keys(transactionValues[0]).filter(
			(column) => !conflictColumns.includes(column),
		);
		const upsertResult = await repository
			.createQueryBuilder()
			.insert()
			.into(BankTransaction)
			.values(transactionValues)
			.orUpdate(overwriteColumns, conflictColumns, {
				// A row the categorization worker holds keeps its values until the worker finishes, except one that
				// now carries a currency exchange marker, so the exchange recompute can take it out of categorization.
				overwriteCondition: {
					where: exchangeMarkerKeys.length
						? '("bank_transactions"."categoryStatus" IS DISTINCT FROM :processingStatus OR EXCLUDED."stableIdentityKey" IN (:...exchangeMarkerKeys))'
						: '"bank_transactions"."categoryStatus" IS DISTINCT FROM :processingStatus',
					parameters: {processingStatus: 'PROCESSING', exchangeMarkerKeys},
				},
			})
			// xmax is 0 only on a freshly inserted row version, so it tells inserts apart from updates.
			.returning('"id", ("xmax" = 0) AS "inserted"')
			// Rows skipped by the condition are missing from RETURNING, so merging it back by position would hand
			// the wrong ids to the values; keep them unmodified.
			.updateEntity(false)
			.execute();
		const transactionsAdded = this.getInsertedTransactionIds(upsertResult.raw).length;

		await this.clearStaleBaseAmounts(repository, bankAccount.id, existingTransactions);
		await this.copySameCurrencyBaseAmounts(repository, bankAccount.id);

		const transactionByStableIdentityKey = new Map(
			transactionValues.map((value) => [value.stableIdentityKey, value]),
		);
		// A row whose classification-relevant fields changed goes back to the model, keeping its category until the new
		// one lands. Both sides are hashed here with the current rules, so a hash stored under older rules (which, for
		// example, still covered the dates) never counts as a change.
		const recheckIds: string[] = [];
		for (const existingTransaction of existingTransactions) {
			const currentValue = transactionByStableIdentityKey.get(existingTransaction.stableIdentityKey);
			if (
				!currentValue ||
				existingTransaction.financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE ||
				isManualCategorySource(existingTransaction.categorySource) ||
				// A row without a stored hash has never been categorized for this input.
				(existingTransaction.categoryInputHash !== null &&
					createBankTransactionCategorizationInputHash(
						toBankTransactionCategorizationInput({...existingTransaction, aspspName}),
					) === currentValue.categoryInputHash)
			) {
				continue;
			}
			recheckIds.push(existingTransaction.id);
		}

		for (const ids of chunkArray(recheckIds, BATCH_WRITE_CHUNK_SIZE)) {
			// The guards are evaluated per row, so one statement matches per-row updates exactly.
			await repository
				.createQueryBuilder()
				.update(BankTransaction)
				.set({categoryStatus: 'PENDING', categoryLastError: null})
				.where('"bankAccountId" = :bankAccountId', {bankAccountId: bankAccount.id})
				.andWhere('id IN (:...ids)', {ids})
				.andWhere(notManualCategorySourceSql())
				.andWhere(notOwnTransferCategorizedSql())
				.andWhere('"categoryStatus" IN (:...recheckStatuses)', {
					recheckStatuses: ['COMPLETED', 'FAILED', 'NOT_APPLICABLE'],
				})
				.andWhere('"financialEventType" IS NULL')
				.execute();
		}

		const persistedRows = await repository.find({
			select: {id: true},
			where: {bankAccountId: bankAccount.id, stableIdentityKey: In(stableIdentityKeys)},
		});
		return {transactionsAdded, persistedTransactionIds: persistedRows.map(({id}) => id)};
	}

	/** The earliest date of each account's pending rows, so the account's next fetch still covers all of them. */
	async findPendingTransactionStarts(
		repository: Repository<BankTransaction>,
		bankAccountIds: readonly string[],
	): Promise<Map<string, string>> {
		if (bankAccountIds.length === 0) return new Map();
		const rows: Array<{bankAccountId: string; start: string | null}> = await repository.query(
			`SELECT "bankAccountId", to_char(MIN(${PENDING_ROW_START_SQL}), 'YYYY-MM-DD') AS "start"
			FROM "bank_transactions"
			WHERE "bankAccountId" = ANY($1::uuid[]) AND ${PENDING_ROW_SQL}
			GROUP BY "bankAccountId"`,
			[bankAccountIds],
		);
		return new Map(rows.flatMap(({bankAccountId, start}) => (start ? [[bankAccountId, start] as const] : [])));
	}

	/**
	 * Pending rows are temporary. After a complete fetch from `coveredFrom` (null: the account's whole history), a
	 * pending row of that window the fetch did not return was released or booked as another row, so it is deleted.
	 * Rows without any date count as covered. Returns the own-transfer counterparts the deleted rows were paired with,
	 * whose own-transfer state the recompute after the sync must decide again.
	 */
	async removeUnreturnedPendingTransactions(
		repository: Repository<BankTransaction>,
		bankAccountId: BankAccount['id'],
		returnedTransactionIds: readonly string[],
		coveredFrom: string | null,
	): Promise<string[]> {
		const result: unknown = await repository.query(
			`DELETE FROM "bank_transactions"
			WHERE "bankAccountId" = $1 AND ${PENDING_ROW_SQL}
				AND NOT ("id" = ANY($2::uuid[]))
				AND ($3::date IS NULL OR COALESCE(${PENDING_ROW_START_SQL}, $3::date) >= $3::date)
			RETURNING "ownTransferCounterpartId"`,
			[bankAccountId, returnedTransactionIds, coveredFrom],
		);
		// TypeORM returns [rows, affected] for a DELETE on PostgreSQL.
		const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : (result ?? [])) as Array<{
			ownTransferCounterpartId: string | null;
		}>;
		return rows.flatMap(({ownTransferCounterpartId}) =>
			ownTransferCounterpartId ? [ownTransferCounterpartId] : [],
		);
	}

	/**
	 * Stores amounts already in the owner's base currency right away, so they never wait for the conversion job
	 * and count in totals as soon as they are synced. Matches the job's `SAME` method; other currencies still wait
	 * for rates. Owners without a base currency yet (before their first conversion run) are left to the job.
	 */
	private async copySameCurrencyBaseAmounts(
		repository: Repository<BankTransaction>,
		bankAccountId: BankAccount['id'],
	): Promise<void> {
		await repository.query(
			`UPDATE "bank_transactions" AS t
			SET "amountInBaseCurrency" = ROUND(t."amount", 2), "baseAmountMethod" = 'SAME',
				"baseAmountRateDate" = NULL, "updatedAt" = CURRENT_TIMESTAMP
			FROM "bank_accounts" bank_account
			INNER JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
			INNER JOIN "accounts" account ON account."id" = connection."accountId"
			WHERE bank_account."id" = $1
				AND t."bankAccountId" = bank_account."id"
				AND t."baseAmountMethod" IS NULL
				AND t."currency" = account."baseCurrency"`,
			[bankAccountId],
		);
	}

	/**
	 * Clears base-currency amounts whose conversion inputs the upsert just changed, so the conversion job
	 * recomputes them. Compares the pre-sync snapshot with the stored row, so rows the upsert skipped keep theirs.
	 */
	private async clearStaleBaseAmounts(
		repository: Repository<BankTransaction>,
		bankAccountId: BankAccount['id'],
		previousTransactions: readonly BankTransaction[],
	): Promise<void> {
		const rows = previousTransactions.map((transaction) => [
			transaction.id,
			...BASE_AMOUNT_INPUT_COLUMNS.map(([column]) => transaction[column]),
		]);
		const casts = ['uuid', ...BASE_AMOUNT_INPUT_COLUMNS.map(([, cast]) => cast)];
		const columns = ['id', ...BASE_AMOUNT_INPUT_COLUMNS.map(([column]) => column)].map((column) => `"${column}"`);
		for (const chunk of chunkArray(rows, BATCH_WRITE_CHUNK_SIZE)) {
			const values = buildPostgresValuesList(chunk, casts);
			await repository.query(
				`UPDATE "bank_transactions" AS t
				SET "amountInBaseCurrency" = NULL, "baseAmountMethod" = NULL, "baseAmountRateDate" = NULL
				FROM (VALUES ${values.sql}) AS previous(${columns.join(', ')})
				WHERE t."bankAccountId" = $${values.parameters.length + 1}
					AND t."id" = previous."id"
					AND t."amountInBaseCurrency" IS NOT NULL
					AND ${baseAmountInputsSql('t')} IS DISTINCT FROM ${baseAmountInputsSql('previous')}`,
				[...values.parameters, bankAccountId],
			);
		}
	}

	private toBankTransactionValues(
		bankAccount: BankAccount,
		transaction: EnableBankingTransaction,
		aspspName: string,
	) {
		const creditDebitIndicator = truncate(normalizeBankCode(transaction.creditDebitIndicator ?? ''), 8);
		const amount = this.toSignedAmount(transaction.amount, creditDebitIndicator);
		const currency = normalizeBankCode(transaction.currency);
		const description = truncate(transaction.description, 500);
		const counterpartyName = truncate(transaction.counterpartyName, 255);
		const counterpartyIban = transaction.counterpartyIban ?? null;
		const {displayDescription, merchantKey} = deriveBankTransactionTextColumns({
			description,
			counterpartyName,
			creditDebitIndicator,
		});
		const remittanceInformation = truncate(transaction.remittanceInformation, 10_000);
		const transactionDate = toDateOnly(transaction.transactionDate);
		const bookingDate = toDateOnly(transaction.bookingDate);
		const valueDate = toDateOnly(transaction.valueDate);
		const bookingDateFilled = transaction.bookingDateFilled === true;
		const valueDateFilled = transaction.valueDateFilled === true;
		const providerTransactionId = truncate(transaction.providerTransactionId, 255);
		const entryReference = truncate(transaction.entryReference, 255);
		const bankTransactionCode = truncate(transaction.bankTransactionCode, 64);
		const bankTransactionSubCode = truncate(transaction.bankTransactionSubCode, 64);
		const bankTransactionDescription = truncate(transaction.bankTransactionDescription, 255);
		const merchantLocation = normalizeBankTransactionLocation(transaction.counterpartyLocation);
		const transactionType = normalizeBankTransactionType({
			code: bankTransactionCode ?? undefined,
			subCode: bankTransactionSubCode ?? undefined,
			aspspName,
		});
		const merchantCategoryCode = truncate(transaction.merchantCategoryCode, 16);
		const hasBalanceAfter = Boolean(transaction.balanceAfterAmount && transaction.balanceAfterCurrency);
		const hasInstructedAmount = Boolean(transaction.instructedAmount && transaction.instructedCurrency);
		const hasExchangeRate = Boolean(transaction.exchangeRate && transaction.exchangeRateUnitCurrency);
		const instructedAmount = hasInstructedAmount ? (transaction.instructedAmount ?? null) : null;
		const instructedCurrency = hasInstructedAmount ? normalizeBankCode(transaction.instructedCurrency!) : null;
		const exchangeRate = hasExchangeRate ? (transaction.exchangeRate ?? null) : null;
		const exchangeRateUnitCurrency = hasExchangeRate
			? normalizeBankCode(transaction.exchangeRateUnitCurrency!)
			: null;
		const exchangeRateType = truncate(transaction.exchangeRateType, 16);
		const referenceNumber = truncate(transaction.referenceNumber, 255);
		const referenceNumberScheme = truncate(transaction.referenceNumberScheme, 32);
		const identityValues = {
			bankAccountId: bankAccount.id,
			entryReference,
			transactionDate,
			bookingDate,
			valueDate,
			bookingDateFilled,
			valueDateFilled,
			amount,
			currency,
			creditDebitIndicator,
			bankTransactionCode,
			bankTransactionSubCode,
			bankTransactionDescription,
			description,
			counterpartyName,
			merchantLocation,
			merchantCategoryCode,
			remittanceInformation,
			instructedAmount,
			instructedCurrency,
			exchangeRate,
			exchangeRateUnitCurrency,
			exchangeRateType,
			referenceNumber,
			referenceNumberScheme,
		};
		const stableIdentityGroupKey = createBankTransactionStableIdentityGroupKey(identityValues);
		const stableIdentityKey = createBankTransactionStableIdentityKey(identityValues, 1);
		const categoryInputHash = createBankTransactionCategorizationInputHash(
			toBankTransactionCategorizationInput({
				id: stableIdentityKey,
				transactionDate,
				bookingDate,
				valueDate,
				amount,
				currency,
				creditDebitIndicator,
				bankTransactionCode,
				bankTransactionSubCode,
				aspspName,
				description,
				counterpartyName,
				bankTransactionDescription,
				merchantCategoryCode,
				remittanceInformation,
				merchantLocation,
			}),
		);

		return {
			bankAccountId: bankAccount.id,
			providerTransactionId,
			entryReference,
			stableIdentityKey,
			stableIdentityGroupKey,
			transactionDate,
			bookingDate,
			valueDate,
			bookingDateFilled,
			valueDateFilled,
			amount,
			currency,
			creditDebitIndicator,
			transactionType,
			transactionStatus: truncate(transaction.status, 32),
			bankTransactionCode,
			bankTransactionSubCode,
			bankTransactionDescription,
			description,
			displayDescription,
			merchantKey,
			counterpartyName,
			counterpartyIban,
			merchantCategoryCode,
			remittanceInformation,
			merchantLocation,
			categoryInputHash,
			balanceAfterAmount: hasBalanceAfter ? transaction.balanceAfterAmount : null,
			balanceAfterCurrency: hasBalanceAfter ? normalizeBankCode(transaction.balanceAfterCurrency!) : null,
			instructedAmount,
			instructedCurrency,
			exchangeRate,
			exchangeRateUnitCurrency,
			exchangeRateType,
			referenceNumber,
			referenceNumberScheme,
		};
	}

	private getInsertedTransactionIds(raw: unknown): string[] {
		const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
		return rows.flatMap((row) => {
			if (!row || typeof row !== 'object') return [];
			const {id, inserted} = row as {id?: unknown; inserted?: unknown};
			return typeof id === 'string' && inserted === true ? [id] : [];
		});
	}

	private toSignedAmount(amount: string, creditDebitIndicator: string | null): string {
		const normalizedAmount = amount.trim();
		const isNegative = normalizedAmount.startsWith('-');
		const unsignedAmount = normalizedAmount.replace(/^[+-]/, '');

		if (creditDebitIndicator === 'DBIT' && !isNegative) return `-${unsignedAmount}`;
		if (creditDebitIndicator === 'CRDT' && isNegative) return unsignedAmount;
		return normalizedAmount;
	}
}
