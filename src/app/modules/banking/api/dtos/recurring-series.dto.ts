import {PickType} from '@nestjs/swagger';
import {IsBoolean} from 'class-validator';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

import {BANK_TRANSACTION_DIRECTIONS, type BankTransactionDirection} from '../../bank-transaction-direction';
import type {
	RecurringAmountKind,
	RecurringCadence,
	RecurringSeriesFlag,
	RecurringSeriesStatus,
} from '../../recurring/recurring-series-detection';

export const RECURRING_SERIES_DIRECTIONS = [
	BANK_TRANSACTION_DIRECTIONS.EXPENSE,
	BANK_TRANSACTION_DIRECTIONS.INCOME,
] as const;
export type RecurringSeriesDirection = (typeof RECURRING_SERIES_DIRECTIONS)[number];

export class RecurringSeriesQueryDto {
	/** The client's local date; late and ended are judged against it. */
	@IsCalendarDate()
	asOf: string;
}

export class RecurringSeriesHiddenUpdateDto {
	/** `true` marks the series as not recurring; `false` shows it again. */
	@IsBoolean()
	hidden: boolean;
}

export class RecurringContinuationUpdateDto {
	/** `false` splits a joined series into its two histories; `true` joins them again. */
	@IsBoolean()
	linked: boolean;
}

/** The earlier history a series continues: joined with it, or kept apart because the owner unlinked them. */
export class RecurringContinuationDto {
	previousName: string;
	previousFirstDate: string;
	previousLastDate: string;
	/** `false` once unlinked; linking again joins them. */
	linked: boolean;
}

/** A fixed price's recent change; `amount` is signed, `since` is the first payment at the new price. */
export class RecurringPriceChangeDto {
	amount: string;
	since: string;
}

/** A variable amount's lowest and highest recent payment. */
export class RecurringAmountRangeDto {
	low: string;
	high: string;
}

export class RecurringPaymentDto {
	date: string;
	amount: string;
}

/**
 * Amounts are positive decimal strings with two places; `monthlyEquivalent` is in the owner's base currency.
 * `typicalAmount` is a fixed price, or the median of a variable amount's recent payments.
 */
export class RecurringSeriesDto {
	key: string;
	name: string;
	direction: BankTransactionDirection;
	cadence: RecurringCadence;
	amountKind: RecurringAmountKind;
	currency: string;
	typicalAmount: string;
	latestAmount: string;
	/**
	 * This month's cost: the usual amount per month, or what a variable monthly bill was paid in the month of its latest
	 * payment. Null until every payment in the series has a base-currency amount.
	 */
	monthlyEquivalent: string | null;
	/** Set for a variable amount. */
	amountRange: RecurringAmountRangeDto | null;
	/** A variable amount's recent payments, oldest first; empty for a fixed price. */
	recentPayments: RecurringPaymentDto[];
	transactionCount: number;
	firstDate: string;
	lastDate: string;
	nextExpectedDate: string;
	status: RecurringSeriesStatus;
	flags: RecurringSeriesFlag[];
	/** Set until the new price has been paid three times. */
	priceChange: RecurringPriceChangeDto | null;
	/** The owner marked it as not recurring; it is left out of totals. */
	hidden: boolean;
	/** Set while the series continues an earlier history, linked or unlinked. */
	continuation: RecurringContinuationDto | null;
}

/** One direction's series and total. */
export class RecurringSeriesListDto {
	/** Shown before hidden; active before ended; larger monthly cost first. */
	series: RecurringSeriesDto[];
	/** Monthly cost of shown active series that have a base amount. */
	monthlyTotal: string;
	/** Shown active series left out of the total because a payment is not converted yet. */
	unconvertedCount: number;
	baseCurrency: string | null;
}

/** A counted series' next payment. */
export class RecurringUpcomingPaymentDto extends PickType(RecurringSeriesDto, [
	'key',
	'name',
	'direction',
	'nextExpectedDate',
	'typicalAmount',
	'amountKind',
	'currency',
] as const) {}

/** Bills and income, from one read. */
export class RecurringSeriesListsResponseDto {
	expenses: RecurringSeriesListDto;
	income: RecurringSeriesListDto;
}

export class RecurringSeriesSummaryResponseDto {
	/** The bills and income lists' monthly totals. */
	expenseMonthlyTotal: string;
	incomeMonthlyTotal: string;
	/** The three soonest next payments of shown active series, bills and income together. */
	upcoming: RecurringUpcomingPaymentDto[];
	/** Each list's shown active series left out of its total because a payment is not converted yet. */
	expenseUnconvertedCount: number;
	incomeUnconvertedCount: number;
	baseCurrency: string | null;
}
