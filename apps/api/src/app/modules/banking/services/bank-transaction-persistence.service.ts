import {Injectable} from '@nestjs/common';
import {createHash, randomUUID} from 'node:crypto';
import {FindOptionsSelect, In, IsNull, Not, Repository} from 'typeorm';

import {BankAccount} from '../bank-account.entity';
import {
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
	detectBankTransactionFinancialEvent,
} from '../bank-transaction-financial-event';
import {
	allocateNextBankTransactionStableIdentityKey,
	assignBankTransactionStableIdentityKeys,
	createBankTransactionStableIdentityGroupKey,
	createBankTransactionStableIdentityKey,
	isLegacyBankTransactionDedupeKey,
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
import {BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES} from '../categorization/bank-transaction-categorization.constants';
import {
	isManualCategorySource,
	notManualCategorySourceSql,
} from '../categorization/bank-transaction-categorization.types';
import {EnableBankingTransaction} from '../enable-banking.types';
import {BASE_AMOUNT_INPUT_COLUMNS, baseAmountInputsSql} from './bank-transaction-amount-conversion.utils';

const BANK_TRANSACTION_IDENTITY_SELECT = {
	id: true,
	bankAccountId: true,
	entryReference: true,
	transactionDate: true,
	bookingDate: true,
	valueDate: true,
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

export type PersistTransactionsResult = {
	transactionsAdded: number;
	persistedTransactionIds: string[];
};

type LegacyDedupeKeyValues = {
	providerTransactionId: string | null;
	entryReference: string | null;
	bookingDate: string | null;
	valueDate: string | null;
	amount: string;
	currency: string;
	creditDebitIndicator: string | null;
	description: string | null;
	counterpartyName: string | null;
	remittanceInformation: string | null;
};

@Injectable()
export class BankTransactionPersistenceService {
	async repairIncompleteTransactionIdentities(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
	): Promise<void> {
		const incompleteTransactions = await repository.find({
			select: BANK_TRANSACTION_IDENTITY_SELECT,
			where: [
				{bankAccountId: bankAccount.id, stableIdentityKey: IsNull()},
				{bankAccountId: bankAccount.id, stableIdentityKey: ''},
				{bankAccountId: bankAccount.id, stableIdentityGroupKey: IsNull()},
				{bankAccountId: bankAccount.id, stableIdentityGroupKey: ''},
			],
			order: {id: 'ASC'},
		});
		if (incompleteTransactions.length === 0) return;

		const usedKeys = await this.getOccupiedTransactionIdentityKeys(repository, bankAccount.id);
		const identityUpdates = incompleteTransactions.map((transaction) => {
			const stableIdentityGroupKey =
				transaction.stableIdentityGroupKey || createBankTransactionStableIdentityGroupKey(transaction);
			let stableIdentityKey = transaction.stableIdentityKey;
			if (!stableIdentityKey) {
				stableIdentityKey = allocateNextBankTransactionStableIdentityKey(
					stableIdentityGroupKey,
					usedKeys,
				).stableIdentityKey;
			}
			usedKeys.add(stableIdentityKey);
			return {id: transaction.id, stableIdentityKey, stableIdentityGroupKey};
		});

		for (const chunk of chunkArray(identityUpdates, BATCH_WRITE_CHUNK_SIZE)) {
			const values = buildPostgresValuesList(
				chunk.map(({id, stableIdentityKey, stableIdentityGroupKey}) => [
					id,
					stableIdentityKey,
					stableIdentityGroupKey,
				]),
				['uuid', 'varchar', 'varchar'],
			);
			await repository.query(
				`UPDATE "bank_transactions" AS t
				SET "stableIdentityKey" = v."stableIdentityKey",
					"stableIdentityGroupKey" = v."stableIdentityGroupKey",
					"updatedAt" = CURRENT_TIMESTAMP
				FROM (VALUES ${values.sql}) AS v("id", "stableIdentityKey", "stableIdentityGroupKey")
				WHERE t."id" = v."id"`,
				values.parameters,
			);
		}
	}

	private async getOccupiedTransactionIdentityKeys(
		repository: Repository<BankTransaction>,
		bankAccountId: string,
	): Promise<Set<string>> {
		const occupiedIdentities = await repository.find({
			select: {stableIdentityKey: true},
			where: {bankAccountId, stableIdentityKey: Not(IsNull())},
		});
		return new Set(
			occupiedIdentities.flatMap(({stableIdentityKey}) => (stableIdentityKey ? [stableIdentityKey] : [])),
		);
	}

	async persistTransactions(
		repository: Repository<BankTransaction>,
		bankAccount: BankAccount,
		transactions: EnableBankingTransaction[],
		aspspName: string,
		provider: string,
	): Promise<PersistTransactionsResult> {
		const unassignedTransactionValues = transactions.map((transaction) =>
			this.toBankTransactionValues(bankAccount, transaction, aspspName, provider),
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
				dedupeKey: true,
				categoryInputHash: true,
				categorySource: true,
				categoryStatus: true,
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
		// A booked row can retain a key from its former pending group while no longer
		// matching the incoming group or reference. Reserve keys independently of matching.
		const occupiedIdentityKeys = await this.getOccupiedTransactionIdentityKeys(repository, bankAccount.id);
		const transactionValues = assignBankTransactionStableIdentityKeys(
			unassignedTransactionValues,
			existingTransactions,
			occupiedIdentityKeys,
		);
		const stableIdentityKeys = transactionValues.map(({stableIdentityKey}) => stableIdentityKey);
		const existingTransactionsByIdentity = new Map(
			existingTransactions
				.filter(({stableIdentityKey}) => stableIdentityKey)
				.map((transaction) => [transaction.stableIdentityKey as string, transaction]),
		);
		for (const transactionValue of transactionValues) {
			const existingTransaction = existingTransactionsByIdentity.get(transactionValue.stableIdentityKey);
			if (!existingTransaction) {
				transactionValue.dedupeKey = randomUUID();
			} else if (existingTransaction.dedupeKey !== transactionValue.dedupeKey) {
				// UUID markers make rollback refuse rows the previous sync can no longer match by this legacy key.
				transactionValue.dedupeKey = isLegacyBankTransactionDedupeKey(existingTransaction.dedupeKey)
					? randomUUID()
					: existingTransaction.dedupeKey;
			}
		}

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
				// A row the categorization worker holds keeps its values until the worker finishes, except a currency
				// exchange, which leaves categorization below.
				overwriteCondition: {
					where: '("bank_transactions"."categoryStatus" IS DISTINCT FROM :processingStatus OR EXCLUDED."financialEventType" = :currencyExchangeType)',
					parameters: {
						processingStatus: 'PROCESSING',
						currencyExchangeType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
					},
				},
			})
			// xmax is 0 only on a freshly inserted row version, so it tells inserts apart from updates.
			.returning('"id", ("xmax" = 0) AS "inserted"')
			// Rows skipped by the condition are missing from RETURNING, so merging it back by position would hand
			// the wrong ids to the values; keep them unmodified.
			.updateEntity(false)
			.execute();
		const insertedTransactionIds = this.getInsertedTransactionIds(upsertResult.raw);
		const transactionsAdded = insertedTransactionIds.length;

		const eventTransactionValues = transactionValues.filter(
			({financialEventType}) => financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		);
		await this.clearStaleBaseAmounts(repository, existingTransactions);
		await this.copySameCurrencyBaseAmounts(repository, bankAccount.id);

		const eventStableIdentityKeys = [
			...new Set(eventTransactionValues.map(({stableIdentityKey}) => stableIdentityKey)),
		];
		if (eventStableIdentityKeys.length > 0) {
			await repository
				.createQueryBuilder()
				.update(BankTransaction)
				.set({
					...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
					categoryInputHash: null,
					categoryStatus: 'NOT_APPLICABLE',
					categoryUpdatedAt: null,
				})
				.where('"bankAccountId" = :bankAccountId', {bankAccountId: bankAccount.id})
				.andWhere('"stableIdentityKey" IN (:...eventStableIdentityKeys)', {eventStableIdentityKeys})
				.andWhere('"financialEventType" = :financialEventType', {
					financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
				})
				.andWhere('"categorySource" IS DISTINCT FROM \'MANUAL\'')
				.execute();
		}

		const transactionByStableIdentityKey = new Map(
			transactionValues.map((value) => [value.stableIdentityKey, value]),
		);
		const staleCategorizationIds: string[] = [];
		for (const existingTransaction of existingTransactions) {
			if (!existingTransaction.stableIdentityKey) continue;
			const currentValue = transactionByStableIdentityKey.get(existingTransaction.stableIdentityKey);
			if (
				!currentValue ||
				currentValue.financialEventType === BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE ||
				isManualCategorySource(existingTransaction.categorySource) ||
				existingTransaction.categoryStatus === 'COMPLETED' ||
				existingTransaction.categoryInputHash === currentValue.categoryInputHash
			) {
				continue;
			}
			staleCategorizationIds.push(existingTransaction.id);
		}

		for (const ids of chunkArray(staleCategorizationIds, BATCH_WRITE_CHUNK_SIZE)) {
			// The guards are evaluated per row, so one statement matches the former per-row updates exactly.
			await repository
				.createQueryBuilder()
				.update(BankTransaction)
				.set({
					...BANK_TRANSACTION_CATEGORIZATION_RESET_VALUES,
					categoryStatus: 'PENDING',
					categoryUpdatedAt: null,
				})
				.where('id IN (:...ids)', {ids})
				.andWhere(notManualCategorySourceSql())
				.andWhere('categoryStatus IS DISTINCT FROM :completedCategoryStatus', {
					completedCategoryStatus: 'COMPLETED',
				})
				.andWhere('"categoryStatus" IS DISTINCT FROM \'PROCESSING\'')
				.andWhere('"financialEventType" IS NULL')
				.execute();
		}

		const persistedRows = await repository.find({
			select: {id: true},
			where: {bankAccountId: bankAccount.id, stableIdentityKey: In(stableIdentityKeys)},
		});
		const persistedTransactionIds =
			persistedRows.length > 0 ? persistedRows.map(({id}) => id) : insertedTransactionIds;

		return {transactionsAdded, persistedTransactionIds};
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
				WHERE t."id" = previous."id"
					AND t."amountInBaseCurrency" IS NOT NULL
					AND ${baseAmountInputsSql('t')} IS DISTINCT FROM ${baseAmountInputsSql('previous')}`,
				values.parameters,
			);
		}
	}

	private toBankTransactionValues(
		bankAccount: BankAccount,
		transaction: EnableBankingTransaction,
		aspspName: string,
		provider: string,
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
		const financialEvent = detectBankTransactionFinancialEvent({
			provider,
			aspspName,
			accountCurrency: bankAccount.currency,
			transactionCurrency: currency,
			creditDebitIndicator,
			description,
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
		const dedupeKey = this.createLegacyDedupeKey({
			providerTransactionId,
			entryReference,
			bookingDate,
			valueDate,
			amount,
			currency,
			creditDebitIndicator,
			description,
			counterpartyName,
			remittanceInformation,
		});
		const categoryInputHash = financialEvent
			? null
			: createBankTransactionCategorizationInputHash(
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
			dedupeKey,
			stableIdentityKey,
			stableIdentityGroupKey,
			transactionDate,
			bookingDate,
			valueDate,
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
			financialEventType: financialEvent?.type ?? null,
			financialEventSource: financialEvent?.source ?? null,
			financialEventRuleVersion: financialEvent?.ruleVersion ?? null,
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

	private createLegacyDedupeKey(values: LegacyDedupeKeyValues): string {
		const fallbackValues: Record<string, string | null> = {
			providerTransactionId: values.providerTransactionId,
			entryReference: values.entryReference,
			bookingDate: values.bookingDate,
			valueDate: values.valueDate,
			amount: values.amount,
			currency: values.currency,
			creditDebitIndicator: values.creditDebitIndicator,
			description: values.description,
			counterpartyName: values.counterpartyName,
			remittanceInformation: values.remittanceInformation,
		};
		const identity = values.providerTransactionId
			? `transaction:${values.providerTransactionId}`
			: values.entryReference
				? `entry:${values.entryReference}`
				: Object.entries(fallbackValues)
						.map(([key, value]) => `${key}:${value?.trim().toLowerCase() ?? ''}`)
						.join('|');

		return createHash('sha256').update(identity).digest('hex');
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
