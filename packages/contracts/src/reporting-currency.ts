import {ECB_CURRENCIES} from './ecb-currencies.js';

/**
 * The currencies an owner can choose for totals: EUR plus every currency the ECB still publishes a daily euro
 * reference rate for, since amounts are converted through those rates. Codes only; names come from the client's locale.
 */
export const REPORTING_CURRENCIES: readonly string[] = [
	'EUR',
	...Object.keys(ECB_CURRENCIES).filter((code) => ECB_CURRENCIES[code] === null),
].sort();

/** `GET /reporting-currency` and `PUT /reporting-currency`: the currency Tempo adds amounts up in. */
export type ReportingCurrency = {
	/** Null until one is chosen, or picked automatically while every account holds the same currency. */
	currency: string | null;
	/** The owner chose this currency (or had it before choosing existed); Tempo never asks again. */
	confirmed: boolean;
	/** The owner has accounts in several currencies and has not chosen one yet. */
	setupRequired: boolean;
	/** The currency of most recent transactions, offered only while no currency is set; null on a tie or no history. */
	suggestion: string | null;
	/** Currencies of the owner's active accounts, in code order. */
	connectedCurrencies: string[];
	/** What the owner may choose: their accounts' currencies first, then the rest in code order. */
	options: string[];
	/**
	 * Amounts are being converted into `currency`. Until this is false, every combined money figure is unavailable and
	 * its response carries `baseCurrency: null`; amounts in each account's own currency stay as they are.
	 */
	recalculating: boolean;
};

/** `PUT /reporting-currency`. */
export type ReportingCurrencyUpdateRequest = {
	/** One of {@link REPORTING_CURRENCIES}, or the current currency to confirm it; anything else is a 400. */
	currency: string;
};
