import type {BankTransactionCategory} from '@wisp/contracts';

import type {DetectedRecurringSeries, RecurringCandidate} from './recurring-series-detection';

const ORDINARY_RETAIL_CATEGORIES: ReadonlySet<string> = new Set<BankTransactionCategory>([
	'GROCERIES',
	'EATING_OUT',
	'SHOPPING',
]);

export function isOrdinaryRetailCategory(category: string | null): boolean {
	return category !== null && ORDINARY_RETAIL_CATEGORIES.has(category);
}

/** Regular shopping dates alone are not evidence of a bill. Existing owner decisions are handled by the caller. */
export function isOrdinaryRetailExpense(
	series: Pick<DetectedRecurringSeries, 'direction' | 'transactionIds'>,
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
): boolean {
	return (
		series.direction === 'EXPENSE' &&
		series.transactionIds.every((id) => isOrdinaryRetailCategory(candidatesById.get(id)!.category))
	);
}
