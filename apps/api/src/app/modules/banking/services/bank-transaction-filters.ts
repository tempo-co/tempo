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
export const SQL_PERIOD_START = `to_char(date_trunc(:interval, "transaction"."date"::timestamp), 'YYYY-MM-DD')`;

// Provider writes persist canonical currency and direction codes.
const INDICATOR_SQL = '"transaction"."creditDebitIndicator"';
/** Own transfers and currency exchanges move money between the owner's accounts. */
// Null-safe on purpose: these predicates are negated, and `NOT (NULL OR FALSE)` would drop ordinary rows.
export const SQL_INTERNAL = `("transaction"."financialEventType" IS NOT DISTINCT FROM '${BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE}' OR "transaction"."ownTransferEvidence" IS NOT NULL)`;
/** Rows the owner left out of totals: they stay in the list and in balances, and no total counts them. */
export const SQL_LEFT_OUT = `("transaction"."leftOutOfTotals")`;
/** Rows of an account the owner hid; needs the owner-scoped `bankAccount` alias (`createOwnerScopedQuery`). */
export const SQL_HIDDEN_ACCOUNT = `("bankAccount"."isHidden")`;
/**
 * The one rule for whether a row counts in spending and income, and so in every total built on them (cash flow, the
 * breakdown, the list's totals, the month summary, merchants, recurring detection): it is no internal movement, the
 * owner has not left it out, and its account is not hidden. Balances never read it, because the money did move.
 */
export const SQL_COUNTED_IN_TOTALS = `(NOT ${SQL_INTERNAL} AND NOT ${SQL_LEFT_OUT} AND NOT ${SQL_HIDDEN_ACCOUNT})`;
/** Debits, including payments to other people, plus refund credits, which reduce spending. */
export const SQL_SPENDING = `(${SQL_COUNTED_IN_TOTALS} AND (${INDICATOR_SQL} = 'DBIT' OR (${INDICATOR_SQL} = 'CRDT' AND "transaction"."category" = '${REFUND}')))`;
export const SQL_INCOME = `(${SQL_COUNTED_IN_TOTALS} AND ${INDICATOR_SQL} = 'CRDT' AND "transaction"."category" IS DISTINCT FROM '${REFUND}')`;
/** The own transfers the summary totals as moved between accounts; one left out of totals or on a hidden account is not among them. */
export const SQL_OWN_TRANSFER_DEBIT = `("transaction"."ownTransferEvidence" IS NOT NULL AND ${INDICATOR_SQL} = 'DBIT' AND NOT ${SQL_LEFT_OUT} AND NOT ${SQL_HIDDEN_ACCOUNT})`;
/** Rows a total would count but cannot yet, for want of a base-currency amount. */
export const SQL_MISSING_BASE_AMOUNT = `(${SQL_COUNTED_IN_TOTALS} AND ${SQL_BASE_AMOUNT} IS NULL)`;

/** The SQL form of getMerchantKeyName: the stored merchant key without its direction. */
export const SQL_MERCHANT_KEY_NAME = `substring("transaction"."merchantKey" from position(':' in "transaction"."merchantKey") + 1)`;
/**
 * The row's merchant group (`MERCHANT_GROUP_ID_PATTERN`): the owner's merchant identified with a brand groups by the
 * lowercased name of its company (`sqlMerchantGroupName`), any other merchant key is its own group. Own transfers, currency exchanges and rows without a
 * merchant key have none. Needs the owner-scoped `connection` alias.
 */
/** The name an identified merchant groups under: its company, or its brand until identification named a company. */
export function sqlMerchantGroupName(alias: string): string {
	return `COALESCE(NULLIF(btrim(${alias}."company"), ''), btrim(${alias}."brand"))`;
}

export const SQL_MERCHANT_GROUP = `(CASE WHEN "transaction"."merchantKey" IS NULL OR ${SQL_INTERNAL} OR ${SQL_MERCHANT_KEY_NAME} = '' THEN NULL ELSE COALESCE((SELECT 'b_' || md5(lower(${sqlMerchantGroupName('merchant')})) FROM "merchants" merchant WHERE merchant."accountId" = "connection"."accountId" AND merchant."key" = ${SQL_MERCHANT_KEY_NAME} AND merchant."status" = '${MERCHANT_STATUSES.IDENTIFIED}' AND btrim(merchant."brand") <> ''), 'k_' || md5(${SQL_MERCHANT_KEY_NAME})) END)`;

const CASH_FLOW_SQL: Record<BankTransactionCashFlowFilterValue, string> = {
	SPENDING: SQL_SPENDING,
	INCOME: SQL_INCOME,
	INTERNAL: SQL_INTERNAL,
	CURRENCY_EXCHANGE: `("transaction"."financialEventType" = '${BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE}')`,
	OWN_TRANSFER: '("transaction"."ownTransferEvidence" IS NOT NULL)',
	LEFT_OUT: SQL_LEFT_OUT,
};

export const SQL_CATEGORIZATION_FAILED = `("transaction"."categoryStatus" = '${FAILED}' AND "transaction"."category" IS NULL)`;
/** A row the list's category filter lists as uncategorized: no category, and not a financial event, which takes none. */
export const SQL_UNCATEGORIZED = `("transaction"."category" IS NULL AND "transaction"."financialEventType" IS NULL)`;
export const SQL_CATEGORIZING = `("transaction"."categoryStatus" IN ('${PENDING}', '${PROCESSING}') AND "transaction"."category" IS NULL AND "transaction"."financialEventType" IS NULL)`;

const CATEGORY_STATUS_SQL: Record<BankTransactionCategoryStatusFilterValue, string> = {
	FAILED: SQL_CATEGORIZATION_FAILED,
	CATEGORIZING: SQL_CATEGORIZING,
};

const anyOf = (conditions: string[]) => `(${conditions.join(' OR ')})`;

/** An income source as the breakdown groups it: the merchant key, else the display name. */
export const SQL_INCOME_SOURCE = `COALESCE(NULLIF("transaction"."merchantKey", ''), "transaction"."displayDescription")`;
/** Rows to review or whose categorization failed: what the owner still has to settle, each row once. */
export const SQL_NEEDS_ATTENTION = `("transaction"."category" = 'NEEDS_REVIEW' OR ${SQL_CATEGORIZATION_FAILED})`;

/** Owner-scoped ledger query; transaction and bankAccount aliases are shared with the filters below. */
export function createOwnerScopedQuery(repository: Repository<BankTransaction>, accountId: string) {
	return repository
		.createQueryBuilder('transaction')
		.innerJoin('transaction.bankAccount', 'bankAccount')
		.innerJoin('bankAccount.bankConnection', 'connection')
		.where('connection.accountId = :accountId', {accountId});
}

/** The owner's first transaction `date` over every row, internal ones included: where their history starts. */
export async function findFirstTransactionDate(
	repository: Repository<BankTransaction>,
	accountId: string,
): Promise<string | null> {
	const row = await createOwnerScopedQuery(repository, accountId)
		.select(`to_char(MIN("transaction"."date"), 'YYYY-MM-DD')`, 'first')
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
	const date = filter?.date ?? filter?.bookingDate;
	if (date?.from) query.andWhere('transaction.date >= :dateFrom', {dateFrom: date.from});
	if (date?.to) query.andWhere('transaction.date <= :dateTo', {dateTo: date.to});
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
					if (categorizedCategories.length > 0) categoryQuery.orWhere(SQL_UNCATEGORIZED);
					else categoryQuery.where(SQL_UNCATEGORIZED);
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
		// MISSING lists exactly the rows totals leave out (`excluded.missingBaseAmount`); rows no total counts (own
		// transfers, currency exchanges, rows left out) are not missing from them.
		query.andWhere(
			filter.baseAmount === 'PRESENT'
				? `"transaction"."amountInBaseCurrency" IS NOT NULL`
				: SQL_MISSING_BASE_AMOUNT,
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
