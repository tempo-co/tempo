import type {BankTransactionCategory} from '../categorization/bank-transaction-category';
import type {DetectedRecurringSeries, RecurringCandidate} from './recurring-series-detection';

const ORDINARY_RETAIL_CATEGORIES: ReadonlySet<string> = new Set<BankTransactionCategory>([
	'FOOD_AND_DRINK',
	'SHOPPING',
]);

/** Regular shopping dates alone are not evidence of a bill. Existing owner decisions are handled by the caller. */
export function isOrdinaryRetailExpense(
	series: Pick<DetectedRecurringSeries, 'direction' | 'transactionIds'>,
	candidatesById: ReadonlyMap<string, RecurringCandidate>,
): boolean {
	return (
		series.direction === 'EXPENSE' &&
		series.transactionIds.every((id) => {
			const category = candidatesById.get(id)!.category;
			return category !== null && ORDINARY_RETAIL_CATEGORIES.has(category);
		})
	);
}
