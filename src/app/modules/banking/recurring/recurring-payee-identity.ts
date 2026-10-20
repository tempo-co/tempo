import type {RecurringPayeeAlias} from './recurring-payee-alias.entity';
import type {RecurringCandidate} from './recurring-series-detection';

/** Mappings are loaded for one owner; purpose and direction remain part of the recurring identity. */
export function resolveRecurringPayees(
	candidates: readonly RecurringCandidate[],
	aliases: readonly Pick<RecurringPayeeAlias, 'merchantKey' | 'category' | 'payeeGroupId'>[],
): RecurringCandidate[] {
	const bySource = new Map(aliases.map((alias) => [`${alias.merchantKey}\u0000${alias.category}`, alias]));
	return candidates.map((row) => {
		const alias = bySource.get(`${row.merchantKey}\u0000${row.category}`);
		if (!alias) return row;
		const direction = row.merchantKey.slice(0, row.merchantKey.indexOf(':'));
		return {...row, recurringPayeeKey: `${direction}:recurring-payee:${alias.payeeGroupId}:${alias.category}`};
	});
}
