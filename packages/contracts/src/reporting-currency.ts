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
	/**
	 * The owner chose this currency (or had it before choosing existed); Tempo asks again only once it is
	 * `currencyUnavailable`.
	 */
	confirmed: boolean;
	/**
	 * The owner is asked to choose: their accounts are in several currencies and none is chosen yet, or
	 * `currencyUnavailable`.
	 */
	setupRequired: boolean;
	/**
	 * Tempo can no longer convert amounts into `currency`: it left {@link REPORTING_CURRENCIES}. Totals stay in
	 * it until the owner chooses another; it is left out of `options`.
	 */
	currencyUnavailable: boolean;
	/**
	 * The currency of most recent transactions, offered while no currency is set or it is unavailable; null on a tie or
	 * no history.
	 */
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
	/** One of {@link REPORTING_CURRENCIES}; the current one confirms it. Anything else is a 400. */
	currency: string;
};
