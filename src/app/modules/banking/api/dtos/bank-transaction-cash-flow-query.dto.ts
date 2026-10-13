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

	/** The client's local date or an earlier one; the last period is counted through this day. */
	@IsCalendarDate()
	to: string;
}
