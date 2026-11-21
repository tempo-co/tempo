import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {BANK_TRANSACTION_CATEGORIES, type BankTransactionCategory} from '@tempo/contracts';
import {Repository, SelectQueryBuilder} from 'typeorm';

import {CreditDebitIndicator, toBankTransactionDirection} from '../bank-transaction-direction';
import {BankTransaction} from '../bank-transaction.entity';
import {safeErrorName} from '../banking.utils';
import {toHistoryNote} from './bank-transaction-categorization-input';
import {
	COUNTERPARTY_HISTORY_MONTHS,
	MAX_COUNTERPARTY_HISTORY_OPPOSITE_DIRECTION,
	MAX_COUNTERPARTY_HISTORY_SAME_DIRECTION,
	MAX_MANUAL_CATEGORY_EXAMPLES,
	MAX_SAME_AMOUNT_AI_PAYMENTS,
	MAX_SAME_AMOUNT_MANUAL_PAYMENTS,
	MIN_SAME_AMOUNT_PAYMENTS,
} from './bank-transaction-categorization-input.schema';
import {
	CounterpartyHistoryEntry,
	PreviousManualCategory,
	SameAmountPayment,
} from './bank-transaction-categorization.types';
import {getMerchantKeyName, getMerchantKeysForName} from './bank-transaction-merchant-key';
import type {ClaimedTransaction} from './categorization-row-store.service';
import {counterpartyPaymentSql} from './category-fields';
import {ManualCategoryCounts, REUSABLE_MANUAL_CATEGORIES} from './manual-category-follow-up';

type ManualCategoryExample = PreviousManualCategory['recentExamples'][number];

/** An IBAN the owner's rows show under this many merchant names is a payment processor's collection account. */
const MIN_COLLECTION_ACCOUNT_MERCHANTS = 2;

/** The hints a transaction gets from the owner's earlier payments. */
export type PaymentHistory = {
	sameAmountPayments?: SameAmountPayment[];
	counterpartyHistory?: CounterpartyHistoryEntry[];
};

type SameAmountRow = {
	id: string;
	category: BankTransactionCategory;
	source: 'MANUAL' | 'AI';
	description: string | null;
	remittanceInformation: string | null;
	date: string | null;
};

type CounterpartyRow = {
	id: string;
	merchantKey: string | null;
	counterpartyIban: string | null;
	amount: string;
	currency: string;
	creditDebitIndicator: CreditDebitIndicator;
	category: BankTransactionCategory;
	date: string;
};

/** The date a transaction is shown under: when it happened, else when it was booked, else its value date. */
export function transactionDateSql(alias = 'transaction'): string {
	return `COALESCE(${alias}."transactionDate", ${alias}."bookingDate", ${alias}."valueDate")`;
}

/** Loads the owner's history that the model sees as hints next to a transaction. */
@Injectable()
export class CategorizationContextLoader {
	private readonly logger = new Logger(CategorizationContextLoader.name);

	constructor(
		@InjectRepository(BankTransaction)
		private readonly repository: Repository<BankTransaction>,
	) {}

	/**
	 * Returns, per batch transaction id, every manual choice of the account owner for the same merchant as a model
	 * hint: raw counts and recent examples, one-offs included, for the model to weigh. Batches built by reconciliation
	 * can contain several accounts, so history is loaded and matched per account. A history failure only drops the
	 * hint; the batch still goes to the model.
	 */
	async loadManualCategoryHistory(
		batch: readonly ClaimedTransaction[],
	): Promise<Map<string, PreviousManualCategory[]>> {
		const batchByAccount = new Map<string, {id: string; merchantKey: string}[]>();
		for (const {transaction} of batch) {
			const accountId = transaction.bankAccount?.bankConnection?.accountId;
			const {id, merchantKey} = transaction;
			if (!accountId || !merchantKey) continue;
			batchByAccount.set(accountId, [...(batchByAccount.get(accountId) ?? []), {id, merchantKey}]);
		}

		const hintsByTransaction = new Map<string, PreviousManualCategory[]>();
		try {
			await Promise.all(
				[...batchByAccount].map(async ([accountId, entries]) => {
					const merchantKeys = [...new Set(entries.map(({merchantKey}) => merchantKey))];
					const [history, examples] = await Promise.all([
						this.loadManualCategoryCounts(accountId, merchantKeys),
						this.loadManualCategoryExamples(accountId, merchantKeys),
					]);
					for (const {id, merchantKey} of entries) {
						const counts = history.get(merchantKey);
						if (counts?.size)
							hintsByTransaction.set(id, toPreviousManualCategories(counts, examples.get(merchantKey)));
					}
				}),
			);
		} catch (error) {
			this.logger.warn(`Manual category history lookup failed: ${safeErrorName(error)}`);
			return new Map();
		}
		return hintsByTransaction;
	}

	/**
	 * Returns, per batch transaction, the owner's earlier payments it sends as hints: `sameAmountPayments` for an
	 * outgoing payment with enough earlier completed payments to the same payee of exactly its amount and currency, and
	 * `counterpartyHistory` with the newest earlier categorized payments in either direction with the same counterparty,
	 * leaving out the ones already in `sameAmountPayments`. Like the manual history, a lookup failure only drops the
	 * hints.
	 */
	async loadPaymentHistory(batch: readonly ClaimedTransaction[]): Promise<Map<string, PaymentHistory>> {
		const batchByAccount = new Map<string, ClaimedTransaction[]>();
		for (const claimed of batch) {
			const accountId = claimed.transaction.bankAccount?.bankConnection?.accountId;
			if (!accountId) continue;
			batchByAccount.set(accountId, [...(batchByAccount.get(accountId) ?? []), claimed]);
		}

		const historyByTransaction = new Map<string, PaymentHistory>();
		try {
			await Promise.all(
				[...batchByAccount].map(async ([accountId, entries]) => {
					const [sameAmounts, counterparty] = await Promise.all([
						this.loadSameAmountPayments(accountId, entries),
						this.loadCounterpartyRows(accountId, entries),
					]);
					for (const claimed of entries) {
						const sameAmountRows = sameAmounts.get(claimed.transaction.id);
						const shown = new Set(sameAmountRows?.map(({id}) => id));
						const counterpartyHistory = toCounterpartyHistory(claimed, counterparty, shown);
						const history: PaymentHistory = {
							...(sameAmountRows && {
								sameAmountPayments: sameAmountRows.map((row) => ({
									date: row.date,
									category: row.category,
									source: row.source,
									text: toHistoryNote(row),
								})),
							}),
							...(counterpartyHistory.length > 0 && {counterpartyHistory}),
						};
						if (history.sameAmountPayments || history.counterpartyHistory)
							historyByTransaction.set(claimed.transaction.id, history);
					}
				}),
			);
		} catch (error) {
			this.logger.warn(`Payment history lookup failed: ${safeErrorName(error)}`);
			return new Map();
		}
		return historyByTransaction;
	}

	/**
	 * Per outgoing transaction, the owner's earlier completed payments to the same payee with exactly the same amount
	 * and currency, when there are enough of them: the owner's picks newest first, then the two oldest AI rows per
	 * category.
	 */
	private async loadSameAmountPayments(
		accountId: string,
		batch: readonly ClaimedTransaction[],
	): Promise<Map<string, SameAmountRow[]>> {
		const entries = batch.filter(
			({transaction, input}) => transaction.merchantKey && input.direction === 'EXPENSE',
		);
		const paymentsByTransaction = new Map<string, SameAmountRow[]>();
		if (entries.length === 0) return paymentsByTransaction;
		const date = transactionDateSql();
		const merchantKeys = [...new Set(entries.map(({transaction}) => transaction.merchantKey!))];
		const amounts = [...new Set(entries.map(({transaction}) => transaction.amount))];
		const rows = await this.merchantHistoryQuery(accountId, merchantKeys)
			.select('transaction.id', 'id')
			.addSelect('transaction.merchantKey', 'merchantKey')
			.addSelect('transaction.amount', 'amount')
			.addSelect('transaction.currency', 'currency')
			.addSelect('transaction.category', 'category')
			.addSelect('transaction.categorySource', 'source')
			.addSelect('transaction.description', 'description')
			.addSelect('transaction.remittanceInformation', 'remittanceInformation')
			.addSelect(`${date}::text`, 'date')
			.andWhere('transaction."categoryStatus" = :completed', {completed: 'COMPLETED'})
			.andWhere('transaction."categorySource" IN (:...sources)', {sources: ['MANUAL', 'AI']})
			.andWhere('transaction.amount IN (:...amounts)', {amounts})
			.orderBy(date, 'DESC', 'NULLS LAST')
			.addOrderBy('transaction.id', 'DESC')
			.getRawMany<SameAmountRow & {merchantKey: string; amount: string; currency: string}>();
		for (const {transaction} of entries) {
			const ownDate = ownTransactionDate(transaction);
			const earlier = rows.filter(
				(row) =>
					row.id !== transaction.id &&
					row.merchantKey === transaction.merchantKey &&
					row.amount === transaction.amount &&
					row.currency === transaction.currency &&
					(!ownDate || !row.date || row.date <= ownDate),
			);
			// The owner's picks newest first. From AI rows, the two oldest per category: the payments that first
			// stated a purpose stay in view when later rows carry the category without one.
			const aiPerCategory = new Map<BankTransactionCategory, number>();
			const payments = [
				...earlier.filter(({source}) => source === 'MANUAL').slice(0, MAX_SAME_AMOUNT_MANUAL_PAYMENTS),
				...earlier
					.filter(({source}) => source === 'AI')
					.reverse()
					.filter(({category}) => {
						const count = aiPerCategory.get(category) ?? 0;
						aiPerCategory.set(category, count + 1);
						return count < 2;
					})
					.slice(0, MAX_SAME_AMOUNT_AI_PAYMENTS),
			];
			if (payments.length >= MIN_SAME_AMOUNT_PAYMENTS) paymentsByTransaction.set(transaction.id, payments);
		}
		return paymentsByTransaction;
	}

	/**
	 * The owner's categorized rows that can be counterparty history for a batch row: the same counterparty IBAN or the
	 * same merchant name in either direction, dated within the history window of the batch's rows, newest first. A row
	 * whose stored category is no longer in the category list is left out. Own transfers and financial events are not
	 * payments to a counterparty. A payment processor's collection account names no counterparty, so rows on one match
	 * by merchant name only; it is returned with the rows.
	 */
	private async loadCounterpartyRows(
		accountId: string,
		batch: readonly ClaimedTransaction[],
	): Promise<{rows: CounterpartyRow[]; collectionIbans: ReadonlySet<string>}> {
		const entries = batch.flatMap(({transaction}) => {
			const ownDate = ownTransactionDate(transaction);
			return ownDate && (transaction.merchantKey || transaction.counterpartyIban) ? [{transaction, ownDate}] : [];
		});
		if (entries.length === 0) return {rows: [], collectionIbans: new Set()};
		const merchantKeys = [...new Set(entries.flatMap(({transaction}) => counterpartyMerchantKeys(transaction)))];
		const batchIbans = [
			...new Set(
				entries.flatMap(({transaction}) =>
					transaction.counterpartyIban ? [transaction.counterpartyIban] : [],
				),
			),
		];
		const collectionIbans =
			batchIbans.length > 0 ? await this.loadCollectionAccountIbans(accountId, batchIbans) : new Set<string>();
		const ibans = batchIbans.filter((iban) => !collectionIbans.has(iban));
		const matches = [
			...(merchantKeys.length > 0 ? ['transaction."merchantKey" IN (:...historyMerchantKeys)'] : []),
			...(ibans.length > 0 ? ['transaction."counterpartyIban" IN (:...historyIbans)'] : []),
		];
		if (matches.length === 0) return {rows: [], collectionIbans};
		const ownDates = entries.map(({ownDate}) => ownDate).sort();
		const date = transactionDateSql();
		const rows = await this.ownerHistoryQuery(accountId)
			.select('transaction.id', 'id')
			.addSelect('transaction.merchantKey', 'merchantKey')
			.addSelect('transaction.counterpartyIban', 'counterpartyIban')
			.addSelect('transaction.amount', 'amount')
			.addSelect('transaction.currency', 'currency')
			.addSelect('transaction.creditDebitIndicator', 'creditDebitIndicator')
			.addSelect('transaction.category', 'category')
			.addSelect(`${date}::text`, 'date')
			.andWhere('transaction."categoryStatus" = :completed', {completed: 'COMPLETED'})
			.andWhere('transaction.category IN (:...historyCategories)', {
				historyCategories: BANK_TRANSACTION_CATEGORIES,
			})
			.andWhere(`${date} BETWEEN :historyFrom AND :historyTo`, {
				historyFrom: monthsBefore(ownDates[0], COUNTERPARTY_HISTORY_MONTHS),
				historyTo: ownDates[ownDates.length - 1],
			})
			.andWhere(`(${matches.join(' OR ')})`, {historyMerchantKeys: merchantKeys, historyIbans: ibans})
			.orderBy(date, 'DESC')
			.addOrderBy('transaction.id', 'DESC')
			.getRawMany<CounterpartyRow>();
		return {rows, collectionIbans};
	}

	/**
	 * Counts the owner's reusable manual categories per merchant key. With a `correction`, that row counts as if the
	 * owner had already set it manually to that category, under the same rules as every other manual row.
	 */
	async loadManualCategoryCounts(
		accountId: string,
		merchantKeys: readonly string[],
		correction?: {transactionId: string; category: BankTransactionCategory},
	): Promise<Map<string, ManualCategoryCounts>> {
		const category = correction
			? 'CASE WHEN transaction.id = :correctedId THEN :correctedCategory ELSE transaction.category END'
			: 'transaction.category';
		const isManual = correction
			? '(transaction."categorySource" = :manualSource OR transaction.id = :correctedId)'
			: 'transaction."categorySource" = :manualSource';
		const rows = await this.merchantHistoryQuery(accountId, merchantKeys, category)
			.select('transaction.merchantKey', 'merchantKey')
			.addSelect(category, 'category')
			.addSelect('COUNT(*)::int', 'count')
			.andWhere(isManual, {
				manualSource: 'MANUAL',
				...(correction && {correctedId: correction.transactionId, correctedCategory: correction.category}),
			})
			.groupBy('transaction."merchantKey"')
			.addGroupBy(category)
			.getRawMany<{merchantKey: string; category: BankTransactionCategory; count: number}>();

		const history = new Map<string, ManualCategoryCounts>();
		for (const row of rows) {
			const counts = history.get(row.merchantKey) ?? new Map<BankTransactionCategory, number>();
			counts.set(row.category, Number(row.count));
			history.set(row.merchantKey, counts);
		}
		return history;
	}

	/**
	 * The owner's rows for these merchants that can count as history: a reusable category, and not an own transfer or
	 * financial event. `category` lets a correction preview count one row under its new category.
	 */
	private merchantHistoryQuery(
		accountId: string,
		merchantKeys: readonly string[],
		category = 'transaction.category',
	): SelectQueryBuilder<BankTransaction> {
		return this.ownerHistoryQuery(accountId)
			.andWhere(`${category} IN (:...reusableCategories)`, {reusableCategories: REUSABLE_MANUAL_CATEGORIES})
			.andWhere('transaction."merchantKey" IN (:...merchantKeys)', {merchantKeys});
	}

	/**
	 * The owner's rows that can be history for another row: payments to or from a counterparty, so not own transfers or
	 * financial events. Every history lookup starts here.
	 */
	private ownerHistoryQuery(accountId: string): SelectQueryBuilder<BankTransaction> {
		return this.repository
			.createQueryBuilder('transaction')
			.innerJoin('transaction.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.where('connection."accountId" = :accountId', {accountId})
			.andWhere(counterpartyPaymentSql('transaction'));
	}

	/**
	 * Of these IBANs, the ones the owner's rows show under at least {@link MIN_COLLECTION_ACCOUNT_MERCHANTS} merchant
	 * names in either direction: a payment processor's collection account, which names no single counterparty.
	 */
	private async loadCollectionAccountIbans(accountId: string, ibans: readonly string[]): Promise<Set<string>> {
		const merchantName = `SUBSTRING(transaction."merchantKey" FROM STRPOS(transaction."merchantKey", ':') + 1)`;
		const rows = await this.ownerHistoryQuery(accountId)
			.select('transaction.counterpartyIban', 'iban')
			.addSelect(`COUNT(DISTINCT ${merchantName})::int`, 'merchants')
			.andWhere('transaction."counterpartyIban" IN (:...ibans)', {ibans})
			.andWhere('transaction."merchantKey" IS NOT NULL')
			.groupBy('transaction."counterpartyIban"')
			.getRawMany<{iban: string; merchants: number}>();
		return new Set(
			rows.filter(({merchants}) => Number(merchants) >= MIN_COLLECTION_ACCOUNT_MERCHANTS).map(({iban}) => iban),
		);
	}

	/**
	 * The amounts, currencies, dates and notes of the owner's most recent manual choices per merchant and category, so
	 * the model can tell apart different kinds of payments to the same payee. Uses the same eligibility rules as the
	 * counts.
	 */
	private async loadManualCategoryExamples(
		accountId: string,
		merchantKeys: readonly string[],
	): Promise<Map<string, Map<BankTransactionCategory, ManualCategoryExample[]>>> {
		const date = transactionDateSql();
		const rows = await this.merchantHistoryQuery(accountId, merchantKeys)
			.select('transaction.merchantKey', 'merchantKey')
			.addSelect('transaction.category', 'category')
			.addSelect('transaction.amount', 'amount')
			.addSelect('transaction.currency', 'currency')
			.addSelect(`${date}::text`, 'date')
			.addSelect('transaction.description', 'description')
			.addSelect('transaction.remittanceInformation', 'remittanceInformation')
			.andWhere('transaction."categorySource" = :manualSource', {manualSource: 'MANUAL'})
			.orderBy(date, 'DESC', 'NULLS LAST')
			.addOrderBy('transaction.id', 'DESC')
			.getRawMany<{
				merchantKey: string;
				category: BankTransactionCategory;
				amount: string;
				currency: string;
				date: string | null;
				description: string | null;
				remittanceInformation: string | null;
			}>();

		const examples = new Map<string, Map<BankTransactionCategory, ManualCategoryExample[]>>();
		for (const row of rows) {
			const {merchantKey, category} = row;
			const byCategory = examples.get(merchantKey) ?? new Map<BankTransactionCategory, ManualCategoryExample[]>();
			const list = byCategory.get(category) ?? [];
			if (list.length < MAX_MANUAL_CATEGORY_EXAMPLES)
				list.push({
					amount: normalizeAmount(row.amount),
					currency: row.currency,
					date: row.date,
					text: toHistoryNote(row),
				});
			byCategory.set(category, list);
			examples.set(merchantKey, byCategory);
		}
		return examples;
	}
}

/**
 * The newest rows of `rows` with the transaction's counterparty (its IBAN unless that is a collection account, or its
 * merchant name), dated on or before it and within the history window,
 * up to the limit per direction relative to it, newest first. Rows in `shown` are already in the transaction's
 * `sameAmountPayments`.
 */
function toCounterpartyHistory(
	{transaction, input}: ClaimedTransaction,
	{rows, collectionIbans}: {rows: readonly CounterpartyRow[]; collectionIbans: ReadonlySet<string>},
	shown: ReadonlySet<string>,
): CounterpartyHistoryEntry[] {
	const ownDate = ownTransactionDate(transaction);
	const iban =
		transaction.counterpartyIban && !collectionIbans.has(transaction.counterpartyIban)
			? transaction.counterpartyIban
			: null;
	if (!ownDate) return [];
	const from = monthsBefore(ownDate, COUNTERPARTY_HISTORY_MONTHS);
	const merchantKeys = new Set(counterpartyMerchantKeys(transaction));
	const remaining = {
		same: MAX_COUNTERPARTY_HISTORY_SAME_DIRECTION,
		opposite: MAX_COUNTERPARTY_HISTORY_OPPOSITE_DIRECTION,
	};
	const history: CounterpartyHistoryEntry[] = [];
	for (const row of rows) {
		const sameCounterparty =
			(!!iban && row.counterpartyIban === iban) || (!!row.merchantKey && merchantKeys.has(row.merchantKey));
		if (!sameCounterparty || row.id === transaction.id || shown.has(row.id)) continue;
		if (row.date > ownDate || row.date < from) continue;
		const direction = toBankTransactionDirection(row.creditDebitIndicator);
		const side = direction === input.direction ? 'same' : 'opposite';
		if (remaining[side] === 0) continue;
		remaining[side] -= 1;
		history.push({
			date: row.date,
			amount: normalizeAmount(row.amount),
			currency: row.currency,
			direction,
			category: row.category,
		});
	}
	return history;
}

/** The transaction's merchant key in both directions, so payments to and from the counterparty both match. */
function counterpartyMerchantKeys(transaction: BankTransaction): string[] {
	const name = getMerchantKeyName(transaction.merchantKey);
	return name ? getMerchantKeysForName(name) : [];
}

function ownTransactionDate(transaction: BankTransaction): string | null {
	return transaction.transactionDate ?? transaction.bookingDate ?? transaction.valueDate;
}

/** The `YYYY-MM-DD` date `months` calendar months earlier, on the month's last day when it is shorter, as SQL does. */
function monthsBefore(date: string, months: number): string {
	const [year, month, day] = date.split('-').map(Number);
	const target = new Date(Date.UTC(year, month - 1 - months, 1));
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(day, lastDay));
	return target.toISOString().slice(0, 10);
}

function toPreviousManualCategories(
	counts: ManualCategoryCounts,
	examples: Map<BankTransactionCategory, ManualCategoryExample[]> | undefined,
): PreviousManualCategory[] {
	return [...counts]
		.sort(
			([leftCategory, left], [rightCategory, right]) => right - left || leftCategory.localeCompare(rightCategory),
		)
		.map(([category, count]) => ({category, count, recentExamples: examples?.get(category) ?? []}));
}

/** "-12.30000000" -> "-12.30": numeric columns come back with the full scale. */
function normalizeAmount(amount: string): string {
	return amount.replace(/(\.\d{2}\d*?)0+$/, '$1');
}
