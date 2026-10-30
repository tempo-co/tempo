import {IsIn} from 'class-validator';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

export const CASH_FLOW_INTERVALS = ['week', 'month', 'year'] as const;
export type CashFlowInterval = (typeof CASH_FLOW_INTERVALS)[number];

export class BankTransactionCashFlowQueryDto {
	@IsIn(CASH_FLOW_INTERVALS)
	interval: CashFlowInterval;

	/** Any day in the first period; the period starts on its Monday, 1st or 1 January. */
	@IsCalendarDate()
	from: string;

	/** The last day to count, on or before `asOf`. */
	@IsCalendarDate()
	to: string;

	/** The client's local date. A period is complete only once it has ended before this day. */
	@IsCalendarDate()
	asOf: string;
}
