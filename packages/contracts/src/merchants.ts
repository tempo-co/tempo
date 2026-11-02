import type {CashFlowInterval} from './dashboard.js';

/**
 * A merchant group's id: `b_` plus the MD5 of the lowercased brand for merchants identified with a brand, otherwise
 * `k_` plus the MD5 of the merchant key without its direction (people and merchants without a brand). Stable for as
 * long as the brand or key is.
 */
export const MERCHANT_GROUP_ID_PATTERN = '^[bk]_[0-9a-f]{32}$';

/** `BRAND` groups every merchant key identified with one brand; `MERCHANT` is one merchant key, such as a person. */
export const MERCHANT_GROUP_KINDS = ['BRAND', 'MERCHANT'] as const;
export type MerchantGroupKind = (typeof MERCHANT_GROUP_KINDS)[number];

export const MERCHANT_LIST_DEFAULT_LIMIT = 50;
export const MERCHANT_LIST_MAX_LIMIT = 100;
export const MERCHANT_SEARCH_MAX_LENGTH = 200;
export const MERCHANT_RANKING_DEFAULT_LIMIT = 50;
export const MERCHANT_RANKING_MAX_LIMIT = 200;
/** Earlier periods the ranking's usual amount averages. */
export const MERCHANT_RANKING_BASELINE_PERIODS = 6;

/**
 * Money with one merchant group in the owner's base currency, as decimal strings with two places. Own transfers and
 * currency exchanges never belong to a group; rows without a base amount or direction are left out and counted in
 * `excluded`.
 */
export type MerchantGroupListItem = {
	id: string;
	/** The brand, or the latest description of the merchant key. */
	name: string;
	kind: MerchantGroupKind;
	/** Path of the brand's logo image, null when no confirmed logo exists. */
	logoUrl: string | null;
	/** Payments minus refunds; negative when more was refunded than paid. */
	spent: string;
	/** Money received that is not a refund, such as pay or a friend paying back. */
	received: string;
	/** Every row of the group, as the filtered transaction list counts them. */
	count: number;
	lastDate: string | null;
};

/** `GET /merchants` query. */
export type MerchantGroupsQuery = {
	/** Matches the group's name or any of its merchant names. */
	search?: string;
	offset?: number;
	limit?: number;
};

/** `GET /merchants`: every group, most spent first. */
export type MerchantGroupsResponse = {
	baseCurrency: string | null;
	merchants: MerchantGroupListItem[];
	total: number;
};

/** One merchant key inside a group. */
export type MerchantGroupVariant = {
	/** The merchant key without its direction. */
	key: string;
	/** The key's latest description. */
	name: string;
	spent: string;
	received: string;
	count: number;
	lastDate: string | null;
};

/** `GET /merchants/:id`: all-time totals of one group. */
export type MerchantGroup = MerchantGroupListItem & {
	baseCurrency: string | null;
	/** Debits only. */
	paid: string;
	/** Refund credits only. */
	refunded: string;
	/** Debits counted in `paid`. */
	paymentCount: number;
	/** `paid` over `paymentCount`, null without payments. */
	averagePayment: string | null;
	firstDate: string | null;
	excluded: {unknownDirection: number; missingBaseAmount: number};
	/** Most spent first. */
	variants: MerchantGroupVariant[];
};

/** `GET /merchants/:id/periods` query; the same window rules as cash flow. */
export type MerchantGroupPeriodsQuery = {
	interval: CashFlowInterval;
	from: string;
	to: string;
	asOf: string;
};

export type MerchantGroupPeriod = {
	start: string;
	end: string;
	complete: boolean;
	spent: string;
	received: string;
	count: number;
};

/** `GET /merchants/:id/periods`: every period from the owner's first booked transaction (or `from`), oldest first. */
export type MerchantGroupPeriods = {
	baseCurrency: string | null;
	interval: CashFlowInterval;
	periods: MerchantGroupPeriod[];
};

/** `GET /merchants/ranking` query. */
export type MerchantRankingQuery = {
	interval: CashFlowInterval;
	/** Any day in the ranked period. */
	period: string;
	/** The client's local date; a running period is ranked through this day. */
	asOf: string;
	limit?: number;
};

export type MerchantRankingItem = Pick<MerchantGroupListItem, 'id' | 'name' | 'kind' | 'logoUrl'> & {
	spent: string;
	count: number;
	/**
	 * Average spent in the earlier periods, each counted through the same day of its period while the ranked one is
	 * running; null without earlier periods.
	 */
	usual: string | null;
	/** `spent` minus `usual`; null without earlier periods. */
	change: string | null;
};

/** `GET /merchants/ranking`: groups with net spending in the period, most spent first. */
export type MerchantRanking = {
	baseCurrency: string | null;
	interval: CashFlowInterval;
	start: string;
	end: string;
	/** The last day counted: `end`, or `asOf` while the period is running. */
	through: string;
	/** The earlier periods `usual` averages, oldest first; none before the first booked transaction. */
	baselinePeriods: string[];
	merchants: MerchantRankingItem[];
	/** Groups with net spending in the period, before `limit`. */
	total: number;
};
