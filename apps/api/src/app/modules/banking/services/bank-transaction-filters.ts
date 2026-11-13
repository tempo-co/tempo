import {
	BANK_TRANSACTION_OWN_TRANSFER_FILTER,
	BANK_TRANSACTION_UNCATEGORIZED,
	type BankTransactionCashFlowFilterValue,
	type BankTransactionCategorizationStatus,
	type BankTransactionCategory,
	type BankTransactionCategoryStatusFilterValue,
} from '@tempo/contracts';
import {Brackets, type Repository, SelectQueryBuilder} from 'typeorm';

import type {BankTransactionFilterQueryDto} from '../api/dtos/bank-transaction-query.dto';
import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '../bank-transaction-financial-event';
import type {BankTransaction} from '../bank-transaction.entity';
import {MERCHANT_STATUSES} from '../merchant-logos/merchant.entity';

const REFUND = 'REFUND' satisfies BankTransactionCategory;
const FAILED = 'FAILED' satisfies BankTransactionCategorizationStatus;
const PENDING = 'PENDING' satisfies BankTransactionCategorizationStatus;
const PROCESSING = 'PROCESSING' satisfies BankTransactionCategorizationStatus;

/** The row's amount in the owner's base currency; null until it is converted. */
export const SQL_BASE_AMOUNT = '"transaction"."amountInBaseCurrency"';
/** The first day of the row's week, month or year (`YYYY-MM-DD`, as `periodStarts` gives it); binds `:interval`. */
export const SQL_PERIOD_START = `to_char(date_trunc(:interval, "transaction"."bookingDate"::timestamp), 'YYYY-MM-DD')`;

// Provider writes persist canonical currency and direction codes.
const INDICATOR_SQL = '"transaction"."creditDebitIndicator"';
/** Own transfers and currency exchanges move money between the owner's accounts. */
// Null-safe on purpose: these predicates are negated, and `NOT (NULL OR FALSE)` would drop ordinary rows.
export const SQL_INTERNAL = `("transaction"."financialEventType" IS NOT DISTINCT FROM '${BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE}' OR "transaction"."ownTransferEvidence" IS NOT NULL)`;
/** Debits, including payments to other people, plus refund credits, which reduce spending. */
export const SQL_SPENDING = `(NOT ${SQL_INTERNAL} AND (${INDICATOR_SQL} = 'DBIT' OR (${INDICATOR_SQL} = 'CRDT' AND "transaction"."category" = '${REFUND}')))`;
export const SQL_INCOME = `(NOT ${SQL_INTERNAL} AND ${INDICATOR_SQL} = 'CRDT' AND "transaction"."category" IS DISTINCT FROM '${REFUND}')`;
export const SQL_UNKNOWN_DIRECTION = `(NOT ${SQL_INTERNAL} AND COALESCE(${INDICATOR_SQL}, '') NOT IN ('CRDT', 'DBIT'))`;
export const SQL_OWN_TRANSFER_DEBIT = `("transaction"."ownTransferEvidence" IS NOT NULL AND ${INDICATOR_SQL} = 'DBIT')`;
export const SQL_MISSING_BASE_AMOUNT = `(NOT ${SQL_INTERNAL} AND ${SQL_BASE_AMOUNT} IS NULL)`;

/** The SQL form of getMerchantKeyName: the stored merchant key without its direction. */
export const SQL_MERCHANT_KEY_NAME = `substring("transaction"."merchantKey" from position(':' in "transaction"."merchantKey") + 1)`;
/**
 * The row's merchant group (`MERCHANT_GROUP_ID_PATTERN`): the owner's merchant identified with a brand groups by the
 * lowercased brand, any other merchant key is its own group. Own transfers, currency exchanges and rows without a
 * merchant key have none. Needs the owner-scoped `connection` alias.
 */
export const SQL_MERCHANT_GROUP = `(CASE WHEN "transaction"."merchantKey" IS NULL OR ${SQL_INTERNAL} OR ${SQL_MERCHANT_KEY_NAME} = '' THEN NULL ELSE COALESCE((SELECT 'b_' || md5(lower(btrim(merchant."brand"))) FROM "merchants" merchant WHERE merchant."accountId" = "connection"."accountId" AND merchant."key" = ${SQL_MERCHANT_KEY_NAME} AND merchant."status" = '${MERCHANT_STATUSES.IDENTIFIED}' AND btrim(merchant."brand") <> ''), 'k_' || md5(${SQL_MERCHANT_KEY_NAME})) END)`;

const CASH_FLOW_SQL: Record<BankTransactionCashFlowFilterValue, string> = {
	SPENDING: SQL_SPENDING,
	INCOME: SQL_INCOME,
	INTERNAL: SQL_INTERNAL,
	CURRENCY_EXCHANGE: `("transaction"."financialEventType" = '${BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE}')`,
	OWN_TRANSFER: '("transaction"."ownTransferEvidence" IS NOT NULL)',
	UNKNOWN: SQL_UNKNOWN_DIRECTION,
};

export const SQL_CATEGORIZATION_FAILED = `("transaction"."categoryStatus" = '${FAILED}' AND "transaction"."category" IS NULL)`;
export const SQL_CATEGORIZING = `("transaction"."categoryStatus" IN ('${PENDING}', '${PROCESSING}') AND "transaction"."category" IS NULL AND "transaction"."financialEventType" IS NULL)`;

const CATEGORY_STATUS_SQL: Record<BankTransactionCategoryStatusFilterValue, string> = {
	FAILED: SQL_CATEGORIZATION_FAILED,
	CATEGORIZING: SQL_CATEGORIZING,
};

const anyOf = (conditions: string[]) => `(${conditions.join(' OR ')})`;

/** An income source as the breakdown groups it: the merchant key, else the display name. */
export const SQL_INCOME_SOURCE = `COALESCE(NULLIF("transaction"."merchantKey", ''), "transaction"."displayDescription")`;
/** Rows to review, failed or without a direction: what the owner still has to settle, each row once. */
export const SQL_NEEDS_ATTENTION = `("transaction"."category" = 'NEEDS_REVIEW' OR ${SQL_CATEGORIZATION_FAILED} OR ${SQL_UNKNOWN_DIRECTION})`;

/** Owner-scoped ledger query; transaction and bankAccount aliases are shared with the filters below. */
export function createOwnerScopedQuery(repository: Repository<BankTransaction>, accountId: string) {
	return repository
		.createQueryBuilder('transaction')
		.innerJoin('transaction.bankAccount', 'bankAccount')
		.innerJoin('bankAccount.bankConnection', 'connection')
		.where('connection.accountId = :accountId', {accountId});
}

/** The owner's first booking date over every row, internal ones included: where their history starts. */
export async function findFirstBookingDate(
	repository: Repository<BankTransaction>,
	accountId: string,
): Promise<string | null> {
	const row = await createOwnerScopedQuery(repository, accountId)
		.select(`to_char(MIN("transaction"."bookingDate"), 'YYYY-MM-DD')`, 'first')
		.getRawOne<{first: string | null}>();
	return row?.first ?? null;
}

/**
 * Applies the Transactions list filters to an owner-scoped query whose transaction alias is `transaction` and whose
 * bank account alias is `bankAccount`. Shared so every summary number reconciles with a filtered list.
 */
export function applyBankTransactionFilters(
	query: SelectQueryBuilder<BankTransaction>,
	filter: BankTransactionFilterQueryDto | undefined,
	recurringTransactionIds?: readonly string[],
): void {
	if (recurringTransactionIds) query.andWhereInIds(recurringTransactionIds);
	const bookingDate = filter?.bookingDate;
	if (bookingDate?.from) {
		query.andWhere('transaction.bookingDate >= :bookingDateFrom', {bookingDateFrom: bookingDate.from});
	}
	if (bookingDate?.to) {
		query.andWhere('transaction.bookingDate <= :bookingDateTo', {bookingDateTo: bookingDate.to});
	}
	if (filter?.bankAccountIds && filter.bankAccountIds.length > 0) {
		query.andWhere('bankAccount.id IN (:...bankAccountIds)', {
			bankAccountIds: filter.bankAccountIds,
		});
	}
	const categoryFilters = filter?.categories;
	if (categoryFilters && categoryFilters.length > 0) {
		const categorizedCategories = categoryFilters.filter((category) => category !== BANK_TRANSACTION_UNCATEGORIZED);
		const includesUncategorized = categoryFilters.includes(BANK_TRANSACTION_UNCATEGORIZED);

		query.andWhere(
			new Brackets((categoryQuery) => {
				if (categorizedCategories.length > 0) {
					categoryQuery.where('transaction.category IN (:...categories)', {
						categories: categorizedCategories,
					});
				}
				if (includesUncategorized) {
					// The summary keys spending rows with a null category as UNCATEGORIZED. They match this condition
					// because every financial event type is internal, so spending rows never carry one.
					const uncategorizedCondition =
						'transaction.category IS NULL AND transaction.financialEventType IS NULL';
					if (categorizedCategories.length > 0) categoryQuery.orWhere(uncategorizedCondition);
					else categoryQuery.where(uncategorizedCondition);
				}
			}),
		);
	}
	if (filter?.categorySources && filter.categorySources.length > 0) {
		query.andWhere('transaction.categorySource IN (:...categorySources)', {
			categorySources: filter.categorySources,
		});
	}

	const eventFilters = filter?.financialEventTypes ?? [];
	const financialEventTypes = eventFilters.filter((value) => value !== BANK_TRANSACTION_OWN_TRANSFER_FILTER);
	const activityConditions = [
		...(financialEventTypes.length > 0 ? ['transaction.financialEventType IN (:...financialEventTypes)'] : []),
		...(eventFilters.includes(BANK_TRANSACTION_OWN_TRANSFER_FILTER)
			? ['transaction.ownTransferEvidence IS NOT NULL']
			: []),
	];
	if (activityConditions.length > 0) {
		query.andWhere(anyOf(activityConditions), {financialEventTypes});
	}

	if (filter?.cashFlows && filter.cashFlows.length > 0) {
		query.andWhere(anyOf(filter.cashFlows.map((cashFlow) => CASH_FLOW_SQL[cashFlow])));
	}
	if (filter?.baseAmount) {
		query.andWhere(
			`"transaction"."amountInBaseCurrency" IS ${filter.baseAmount === 'PRESENT' ? 'NOT NULL' : 'NULL'}`,
		);
	}
	if (filter?.categoryStatuses && filter.categoryStatuses.length > 0) {
		query.andWhere(anyOf(filter.categoryStatuses.map((status) => CATEGORY_STATUS_SQL[status])));
	}
	if (filter?.merchantGroup) {
		query.andWhere(`${SQL_MERCHANT_GROUP} = :merchantGroup`, {merchantGroup: filter.merchantGroup});
	}
	if (filter?.incomeSource) {
		query.andWhere(`${SQL_INCOME_SOURCE} = :incomeSource`, {incomeSource: filter.incomeSource});
	}
	if (filter?.needsAttention) {
		query.andWhere(SQL_NEEDS_ATTENTION);
	}

	const search = filter?.search?.trim();
	if (search) {
		query.andWhere(
			new Brackets((searchQuery) => {
				// The search is literal text: escape LIKE's wildcards and its escape character.
				const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
				searchQuery
					.where(`transaction.description ILIKE :search ESCAPE '\\'`, {search: pattern})
					.orWhere(`transaction.counterpartyName ILIKE :search ESCAPE '\\'`, {search: pattern})
					.orWhere(`transaction.remittanceInformation ILIKE :search ESCAPE '\\'`, {search: pattern});
			}),
		);
	}
}
