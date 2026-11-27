import type {
	BankTransactionCategorizationSource,
	BankTransactionCategorizationStatus,
	BankTransactionCategory,
} from '@wisp/contracts';

import type {BankTransaction} from '../bank-transaction.entity';
import type {BankTransactionCategorizationSearchTrace} from './bank-transaction-categorization.types';
import {CLAIMABLE_CATEGORIZATION_STATUSES, isManualCategorySource} from './bank-transaction-categorization.types';

/**
 * The one place that decides whether automation may categorize a row and that builds every write of a row's category
 * fields. Each rule comes as a code predicate and a SQL condition; `test/e2e/banking/category-fields.e2e.spec.ts` pins
 * the two equal.
 */

export type CategoryFieldsUpdate = {
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

export type CategoryEligibilityRow = Partial<
	Pick<BankTransaction, 'categorySource' | 'financialEventType' | 'ownTransferEvidence'>
>;

const column = (alias: string | undefined, name: string) => (alias ? `${alias}."${name}"` : `"${name}"`);

/**
 * A payment to or from a counterparty: neither an own transfer, which the own-transfer rule categorizes, nor a
 * financial event such as a currency exchange, which has no category. Only these rows are for the model or count as
 * history.
 */
export function isCounterpartyPayment(row: CategoryEligibilityRow): boolean {
	return row.ownTransferEvidence == null && row.financialEventType == null;
}

/** SQL for {@link isCounterpartyPayment}; `alias` qualifies the columns in a select, updates use bare names. */
export function counterpartyPaymentSql(alias?: string): string {
	return `(${column(alias, 'ownTransferEvidence')} IS NULL AND ${column(alias, 'financialEventType')} IS NULL)`;
}

/**
 * Whether automation (the model or a history follow-up) may set this row's category: a counterparty payment whose
 * category the owner did not set. Every AI boundary checks it: enqueue, reconciliation, claim, renewal and completion.
 */
export function isModelCategorizable(row: CategoryEligibilityRow): boolean {
	return !isManualCategorySource(row.categorySource) && isCounterpartyPayment(row);
}

/** SQL for {@link isModelCategorizable}. */
export function modelCategorizableSql(alias?: string): string {
	return `(${column(alias, 'categorySource')} IS DISTINCT FROM 'MANUAL' AND ${counterpartyPaymentSql(alias)})`;
}

/**
 * How long a PROCESSING claim holds before another worker may take the row. The pipeline renews its claims before
 * every provider call after the first, so this only has to outlast one row group (up to two 90 s API calls and a
 * 10 s web search between them) with the database work around it. A worker that died leaves its rows for the next sweep after this.
 */
const STALE_PROCESSING_AFTER_MS = 15 * 60 * 1000;

/**
 * The condition for rows a worker may claim: claimable statuses, or a PROCESSING claim older than the stale window.
 * `alias` qualifies the columns in a select; updates use bare column names.
 */
export function claimableCondition(
	alias?: string,
	statuses: readonly string[] = CLAIMABLE_CATEGORIZATION_STATUSES,
): {sql: string; parameters: Record<string, unknown>} {
	const status = column(alias, 'categoryStatus');
	const updatedAt = column(alias, 'categoryUpdatedAt');
	return {
		sql: `(${status} IN (:...claimableStatuses) OR (${status} = :processingStatus AND (${updatedAt} IS NULL OR ${updatedAt} < :staleBefore)))`,
		parameters: {
			claimableStatuses: statuses,
			processingStatus: 'PROCESSING',
			staleBefore: new Date(Date.now() - STALE_PROCESSING_AFTER_MS),
		},
	};
}

/** Every category field a reset clears; status and timestamp are set by the reset itself. */
const CLEARED_CATEGORY_FIELDS = {
	category: null,
	categorySource: null,
	categoryConfidence: null,
	categoryAppliedInputHash: null,
	categoryProvider: null,
	categoryModel: null,
	categoryPromptVersion: null,
	categorySearchTrace: null,
	categoryLastError: null,
} as const satisfies CategoryFieldsUpdate;

type ResetStatus = Extract<BankTransactionCategorizationStatus, 'PENDING' | 'NOT_APPLICABLE'>;

/**
 * The SET list of a raw SQL update that clears the category and its provenance: PENDING sends the row back to the
 * model, NOT_APPLICABLE takes it out of categorization. Every reset stamps `categoryUpdatedAt`.
 */
export function categoryResetSql(categoryStatus: ResetStatus): string {
	const cleared = Object.keys(CLEARED_CATEGORY_FIELDS).map((field) => `"${field}" = NULL`);
	return [...cleared, `"categoryStatus" = '${categoryStatus}'`, `"categoryUpdatedAt" = now()`].join(', ');
}

/** The owner's own category for a row, applied for its current input. */
export function manualCategoryValues(
	category: BankTransactionCategory,
	inputHash: string,
): CategoryFieldsUpdate & {categoryInputHash: string} {
	return {
		...CLEARED_CATEGORY_FIELDS,
		category,
		categoryStatus: 'COMPLETED',
		categorySource: 'MANUAL',
		categoryInputHash: inputHash,
		categoryAppliedInputHash: inputHash,
		categoryUpdatedAt: new Date(),
	};
}

/**
 * A category taken from the owner's agreeing manual choices for the merchant, applied to each row's stored input. The
 * `categoryAppliedInputHash` value is a TypeORM raw-SQL setter.
 */
export function historyCategoryValues(
	category: BankTransactionCategory,
	provider: string,
	promptVersion: string,
): Omit<CategoryFieldsUpdate, 'categoryAppliedInputHash'> & {categoryAppliedInputHash: () => string} {
	return {
		...CLEARED_CATEGORY_FIELDS,
		category,
		categoryConfidence: '1',
		categoryProvider: provider,
		categoryPromptVersion: promptVersion,
		categoryStatus: 'COMPLETED',
		categorySource: 'HISTORY',
		categoryAppliedInputHash: () => '"categoryInputHash"',
		categoryUpdatedAt: new Date(),
	};
}

/**
 * The SET list of a rule that categorizes rows without a model call, applied to each row's stored input. The
 * arguments are SQL expressions: the category and the rule's provider and version parameters.
 */
export function ruleCategorySql({
	category,
	provider,
	ruleVersion,
}: {
	category: string;
	provider: string;
	ruleVersion: string;
}): string {
	return `"category" = ${category}, "categoryStatus" = 'COMPLETED', "categorySource" = NULL,
		"categoryConfidence" = '1', "categoryProvider" = ${provider}, "categoryModel" = NULL,
		"categoryPromptVersion" = ${ruleVersion}, "categorySearchTrace" = NULL, "categoryLastError" = NULL,
		"categoryAppliedInputHash" = "categoryInputHash", "categoryUpdatedAt" = now()`;
}

/** Sends a row whose input changed in a sync back to the model; it keeps its category until the new one lands. */
export function syncRecheckValues(): CategoryFieldsUpdate {
	return {categoryStatus: 'PENDING', categoryLastError: null};
}

/** Sends a row filled from history back to the model; it keeps its category until the new one lands. */
export function historyRecheckValues(): CategoryFieldsUpdate {
	return {categoryStatus: 'PENDING', categoryUpdatedAt: new Date()};
}

/** A worker's claim on a row. */
export function modelClaimValues(claimedAt: Date): CategoryFieldsUpdate {
	return {categoryStatus: 'PROCESSING', categoryUpdatedAt: claimedAt};
}

/** The renewal of a worker's claim, so no other worker takes the row as stale. */
export function modelClaimRenewalValues(): CategoryFieldsUpdate {
	return {categoryUpdatedAt: new Date()};
}

/** The model's category for the input the row was claimed with. */
export function modelCompletionValues(
	values: Pick<
		CategoryFieldsUpdate,
		| 'category'
		| 'categoryConfidence'
		| 'categoryProvider'
		| 'categoryModel'
		| 'categoryPromptVersion'
		| 'categorySearchTrace'
	>,
	source: BankTransactionCategorizationSource | null,
	inputHash: string,
): CategoryFieldsUpdate {
	return {
		...values,
		categoryStatus: 'COMPLETED',
		categorySource: source,
		categoryAppliedInputHash: inputHash,
		categoryLastError: null,
		categoryUpdatedAt: new Date(),
	};
}

/** A failed model call: the row keeps its category and records a safe message. */
export function modelFailureValues(
	categoryStatus: Extract<BankTransactionCategorizationStatus, 'PENDING' | 'FAILED'>,
	categoryLastError: string,
): CategoryFieldsUpdate {
	return {categoryStatus, categoryLastError, categoryUpdatedAt: new Date()};
}
