import {IsBoolean, IsIn, IsOptional} from 'class-validator';

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

	@IsOptional()
	@IsIn(RECURRING_SERIES_DIRECTIONS)
	direction: RecurringSeriesDirection = BANK_TRANSACTION_DIRECTIONS.EXPENSE;
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

/** The earlier history a series was joined with because it continues it. */
export class RecurringContinuationDto {
	previousName: string;
	previousFirstDate: string;
	previousLastDate: string;
}

/** A fixed price's recent change; `amount` is signed, `since` is the first payment at the new price. */
export class RecurringPriceChangeDto {
	amount: string;
	since: string;
}

/**
 * Amounts are positive decimal strings with two places; `monthlyEquivalent` is in the owner's base currency.
 * `typicalAmount` is the latest payment, or the one before it while the latest is a one-off.
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
	/** Null until every payment in the series has a base-currency amount. */
	monthlyEquivalent: string | null;
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
	/** Set while the series includes an earlier history it continues. */
	continuation: RecurringContinuationDto | null;
}

export class RecurringSeriesListResponseDto {
	/** Shown before hidden; active before ended; larger monthly cost first. */
	series: RecurringSeriesDto[];
	/** Monthly cost of shown active series that have a base amount. */
	monthlyTotal: string;
	/** Shown active series left out of the total because a payment is not converted yet. */
	unconvertedCount: number;
	baseCurrency: string | null;
}
