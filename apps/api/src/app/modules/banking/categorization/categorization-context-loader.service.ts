import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {BankTransactionCategory} from '@tempo/contracts';
import {Repository, SelectQueryBuilder} from 'typeorm';

import {BankTransaction} from '../bank-transaction.entity';
import {safeErrorName} from '../banking.utils';
import {toSameAmountPaymentText} from './bank-transaction-categorization-input';
import {
	MAX_MANUAL_CATEGORY_EXAMPLES,
	MAX_SAME_AMOUNT_AI_PAYMENTS,
	MAX_SAME_AMOUNT_MANUAL_PAYMENTS,
	MIN_SAME_AMOUNT_PAYMENTS,
} from './bank-transaction-categorization-input.schema';
import {PreviousManualCategory, SameAmountPayment} from './bank-transaction-categorization.types';
import type {ClaimedTransaction} from './categorization-row-store.service';
import {ManualCategoryCounts, REUSABLE_MANUAL_CATEGORIES, withoutOneOffChoices} from './manual-category-follow-up';

type ManualCategoryExample = PreviousManualCategory['recentExamples'][number];

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
	 * Returns, per batch transaction id, the account owner's manual choices for the same merchant as a model hint.
	 * Batches built by reconciliation can contain several accounts, so history is loaded and matched per account. A
	 * history failure only drops the hint; the batch still goes to the model.
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
					const [history, examples, categorized] = await Promise.all([
						this.loadManualCategoryCounts(accountId, merchantKeys),
						this.loadManualCategoryExamples(accountId, merchantKeys),
						this.loadCompletedCategories(accountId, merchantKeys),
					]);
					for (const {id, merchantKey} of entries) {
						const counts = history.get(merchantKey);
						if (!counts) continue;
						const habits = withoutOneOffChoices(counts, categorized.get(merchantKey) ?? new Set());
						if (habits.size)
							hintsByTransaction.set(id, toPreviousManualCategories(habits, examples.get(merchantKey)));
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
	 * Returns, per outgoing batch transaction, the owner's earlier completed payments to the same payee with exactly the
	 * same amount and currency, when there are enough of them. Like the manual history, a lookup failure only drops the
	 * hint.
	 */
	async loadSameAmountPayments(batch: readonly ClaimedTransaction[]): Promise<Map<string, SameAmountPayment[]>> {
		const batchByAccount = new Map<string, ClaimedTransaction[]>();
		for (const claimed of batch) {
			const accountId = claimed.transaction.bankAccount?.bankConnection?.accountId;
			if (!accountId || !claimed.transaction.merchantKey || claimed.input.direction !== 'EXPENSE') continue;
			batchByAccount.set(accountId, [...(batchByAccount.get(accountId) ?? []), claimed]);
		}

		const paymentsByTransaction = new Map<string, SameAmountPayment[]>();
		const date = transactionDateSql();
		try {
			await Promise.all(
				[...batchByAccount].map(async ([accountId, entries]) => {
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
						.getRawMany<{
							id: string;
							merchantKey: string;
							amount: string;
							currency: string;
							category: BankTransactionCategory;
							source: 'MANUAL' | 'AI';
							description: string | null;
							remittanceInformation: string | null;
							date: string | null;
						}>();
					for (const {transaction} of entries) {
						const ownDate = transaction.transactionDate ?? transaction.bookingDate ?? transaction.valueDate;
						const earlier = rows.filter(
							(row) =>
								row.id !== transaction.id &&
								row.merchantKey === transaction.merchantKey &&
								row.amount === transaction.amount &&
								row.currency === transaction.currency &&
								(!ownDate || !row.date || row.date <= ownDate),
						);
						// The owner's picks newest first. From AI rows, the two oldest per category: the payments that
						// first stated a purpose stay in view when later rows carry the category without one.
						const aiPerCategory = new Map<BankTransactionCategory, number>();
						const payments = [
							...earlier
								.filter(({source}) => source === 'MANUAL')
								.slice(0, MAX_SAME_AMOUNT_MANUAL_PAYMENTS),
							...earlier
								.filter(({source}) => source === 'AI')
								.reverse()
								.filter(({category}) => {
									const count = aiPerCategory.get(category) ?? 0;
									aiPerCategory.set(category, count + 1);
									return count < 2;
								})
								.slice(0, MAX_SAME_AMOUNT_AI_PAYMENTS),
						].map((row) => ({
							date: row.date,
							category: row.category,
							source: row.source,
							text: toSameAmountPaymentText(row),
						}));
						if (payments.length >= MIN_SAME_AMOUNT_PAYMENTS)
							paymentsByTransaction.set(transaction.id, payments);
					}
				}),
			);
		} catch (error) {
			this.logger.warn(`Same-amount payment lookup failed: ${safeErrorName(error)}`);
			return new Map();
		}
		return paymentsByTransaction;
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
		return this.repository
			.createQueryBuilder('transaction')
			.innerJoin('transaction.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.where(`${category} IN (:...reusableCategories)`, {reusableCategories: REUSABLE_MANUAL_CATEGORIES})
			.andWhere('transaction."ownTransferEvidence" IS NULL')
			.andWhere('transaction."financialEventType" IS NULL')
			.andWhere('transaction."merchantKey" IN (:...merchantKeys)', {merchantKeys})
			.andWhere('connection."accountId" = :accountId', {accountId});
	}

	/**
	 * The amounts, currencies and dates of the owner's most recent manual choices per merchant and category, so the
	 * model can tell apart different kinds of payments to the same payee. Uses the same eligibility rules as the counts.
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
			.andWhere('transaction."categorySource" = :manualSource', {manualSource: 'MANUAL'})
			.orderBy(date, 'DESC', 'NULLS LAST')
			.addOrderBy('transaction.id', 'DESC')
			.getRawMany<{
				merchantKey: string;
				category: BankTransactionCategory;
				amount: string;
				currency: string;
				date: string | null;
			}>();

		const examples = new Map<string, Map<BankTransactionCategory, ManualCategoryExample[]>>();
		for (const {merchantKey, category, amount, currency, date: exampleDate} of rows) {
			const byCategory = examples.get(merchantKey) ?? new Map<BankTransactionCategory, ManualCategoryExample[]>();
			const list = byCategory.get(category) ?? [];
			if (list.length < MAX_MANUAL_CATEGORY_EXAMPLES)
				list.push({amount: normalizeAmount(amount), currency, date: exampleDate});
			byCategory.set(category, list);
			examples.set(merchantKey, byCategory);
		}
		return examples;
	}

	/** The categories the owner's completed rows per merchant key currently have, from any source. */
	private async loadCompletedCategories(
		accountId: string,
		merchantKeys: readonly string[],
	): Promise<Map<string, Set<BankTransactionCategory>>> {
		const rows = await this.merchantHistoryQuery(accountId, merchantKeys)
			.select('transaction.merchantKey', 'merchantKey')
			.addSelect('transaction.category', 'category')
			.distinct(true)
			.andWhere('transaction."categoryStatus" = :completed', {completed: 'COMPLETED'})
			.getRawMany<{merchantKey: string; category: BankTransactionCategory}>();

		const categories = new Map<string, Set<BankTransactionCategory>>();
		for (const {merchantKey, category} of rows) {
			categories.set(merchantKey, (categories.get(merchantKey) ?? new Set()).add(category));
		}
		return categories;
	}
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
