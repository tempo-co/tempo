import {IsIn, IsOptional} from 'class-validator';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

import {BANK_TRANSACTION_DIRECTIONS, type BankTransactionDirection} from '../../bank-transaction-direction';
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
	/** The client's local date; overdue and ended are judged against it. */
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

/** Amounts are positive decimal strings with two places; `monthlyEquivalent` is in the owner's base currency. */
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
	decision: RecurringSeriesDecisionValue | null;
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
