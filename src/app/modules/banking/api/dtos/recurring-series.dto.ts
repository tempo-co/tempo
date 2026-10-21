import {IsIn, IsOptional} from 'class-validator';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

import {BANK_TRANSACTION_DIRECTIONS, type BankTransactionDirection} from '../../bank-transaction-direction';
import {
	RECURRING_CONTINUATION_CHOICES,
	type RecurringContinuationChoiceValue,
} from '../../recurring/recurring-continuation-choice.entity';
import {
	RECURRING_SERIES_DECISIONS,
	type RecurringSeriesDecisionValue,
} from '../../recurring/recurring-series-decision.entity';
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

export class RecurringSeriesDecisionUpdateDto {
	/** `null` returns the series to suggested. */
	@IsIn([...RECURRING_SERIES_DECISIONS, null])
	decision: RecurringSeriesDecisionValue | null;
}

export class RecurringContinuationUpdateDto {
	/** `LINKED` joins the series with the earlier history it may continue, `SEPARATE` keeps them apart, `null` asks again. */
	@IsIn([...RECURRING_CONTINUATION_CHOICES, null])
	choice: RecurringContinuationChoiceValue | null;
}

/** An earlier history this series may continue. `choice` is null while the owner has not answered. */
export class RecurringContinuationDto {
	choice: RecurringContinuationChoiceValue | null;
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
	decision: RecurringSeriesDecisionValue | null;
	/** Set on a history that may continue an earlier one, or that the owner linked to one. */
	continuation: RecurringContinuationDto | null;
}

export class RecurringSeriesListResponseDto {
	/** Confirmed first, then suggested, then dismissed; active before ended; larger monthly cost first. */
	series: RecurringSeriesDto[];
	/** Monthly cost of active confirmed series that have a base amount. */
	confirmedMonthlyTotal: string;
	/** Active confirmed series left out of the total because a payment is not converted yet. */
	unconvertedConfirmedCount: number;
	baseCurrency: string | null;
}
