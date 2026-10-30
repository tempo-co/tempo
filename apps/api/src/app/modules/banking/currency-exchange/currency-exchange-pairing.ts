import {compareIds} from '../own-transfer/own-transfer-detection';

export type CurrencyExchangeLeg = {
	id: string;
	connectionId: string;
	/** ISO date (YYYY-MM-DD): booking date, else transaction date. */
	date: string | null;
	indicator: string | null;
	/** Signed decimal string. */
	amount: string;
	currency: string;
	/** The currency named in the exchange description. */
	targetCurrency: string | null;
	/** Signed amount in the owner's base currency, or null while unconverted. */
	baseAmount: string | null;
};

/**
 * The largest same-day group matched by amount. Groups above it stay unlinked rather than enumerating
 * every assignment; real days stay far below it.
 */
export const CURRENCY_EXCHANGE_MAX_GROUP_SIZE = 6;

/**
 * How much better, as a summed log ratio of base amounts, the best assignment of a day must fit than the
 * next one. Exchange spreads stay well within it, so a closer call is ambiguous and stays unlinked.
 */
export const CURRENCY_EXCHANGE_MIN_MARGIN = 0.03;

type Assignment = {cost: number; creditIndexes: number[]};

/**
 * Links the two legs of each currency exchange. Pure and deterministic: the same legs always produce the
 * same pairs, independent of input order.
 *
 * Both legs of an exchange share the connection, date and target currency. A group with one debit and one
 * credit is one exchange. A group of several exchanges is matched on how well base amounts agree, when
 * one assignment fits clearly better than every other distinct one; assignments that differ only by
 * swapping identical legs count as the same. Anything else stays unlinked.
 */
export function pairCurrencyExchanges(legs: readonly CurrencyExchangeLeg[]): Map<string, string> {
	const groups = new Map<string, {debits: CurrencyExchangeLeg[]; credits: CurrencyExchangeLeg[]}>();
	for (const leg of [...legs].sort((first, second) => compareIds(first.id, second.id))) {
		if (!leg.date || !leg.targetCurrency) continue;
		const key = `${leg.connectionId}:${leg.date}:${leg.targetCurrency}`;
		const group = groups.get(key) ?? {debits: [], credits: []};
		if (leg.indicator === 'DBIT') group.debits.push(leg);
		else if (leg.indicator === 'CRDT') group.credits.push(leg);
		else continue;
		groups.set(key, group);
	}

	const pairs = new Map<string, string>();
	for (const {debits, credits} of groups.values()) {
		for (const [debitIndex, creditIndex] of matchGroup(debits, credits).entries()) {
			pairs.set(debits[debitIndex].id, credits[creditIndex].id);
			pairs.set(credits[creditIndex].id, debits[debitIndex].id);
		}
	}
	return pairs;
}

/** Returns, per debit index, the matched credit index; empty when the group stays unlinked. */
function matchGroup(debits: CurrencyExchangeLeg[], credits: CurrencyExchangeLeg[]): number[] {
	const size = debits.length;
	if (size === 0 || size !== credits.length) return [];
	if (size === 1) return [0];
	if (size > CURRENCY_EXCHANGE_MAX_GROUP_SIZE) return [];

	const debitBases = debits.map(baseMagnitude);
	const creditBases = credits.map(baseMagnitude);
	if (debitBases.includes(null) || creditBases.includes(null)) return [];

	// Keep the cheapest assignment per distinct shape: swapping identical legs yields the same shape.
	const bestByShape = new Map<string, Assignment>();
	for (const creditIndexes of permutations(size)) {
		const cost = creditIndexes.reduce(
			(total, creditIndex, debitIndex) =>
				total + Math.abs(Math.log(creditBases[creditIndex]! / debitBases[debitIndex]!)),
			0,
		);
		const shape = creditIndexes
			.map((creditIndex, debitIndex) => `${legKey(debits[debitIndex])}>${legKey(credits[creditIndex])}`)
			.sort()
			.join('|');
		const best = bestByShape.get(shape);
		if (!best || cost < best.cost) bestByShape.set(shape, {cost, creditIndexes});
	}

	const [best, runnerUp] = [...bestByShape.values()].sort((first, second) => first.cost - second.cost);
	if (runnerUp && runnerUp.cost - best.cost <= CURRENCY_EXCHANGE_MIN_MARGIN) return [];
	return best.creditIndexes;
}

function baseMagnitude(leg: CurrencyExchangeLeg): number | null {
	const value = leg.baseAmount === null ? Number.NaN : Math.abs(Number(leg.baseAmount));
	return Number.isFinite(value) && value > 0 ? value : null;
}

function legKey(leg: CurrencyExchangeLeg): string {
	return `${leg.currency}:${Math.abs(Number(leg.amount))}`;
}

/** Every ordering of 0..size-1, in lexicographic order. */
function* permutations(size: number): Generator<number[]> {
	const visit = function* (prefix: number[], remaining: number[]): Generator<number[]> {
		if (remaining.length === 0) {
			yield prefix;
			return;
		}
		for (const [index, value] of remaining.entries()) {
			yield* visit([...prefix, value], [...remaining.slice(0, index), ...remaining.slice(index + 1)]);
		}
	};
	yield* visit([], [...Array(size).keys()]);
}
