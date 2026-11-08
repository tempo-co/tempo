import {
	BALANCE_TREND_INTERVALS,
	type BalanceTrendInterval,
	type BankBalanceTrendQuery,
	type BankTransactionCashFlowQuery,
	CASH_FLOW_INTERVALS,
	type CashFlowInterval,
} from '@tempo/contracts';
import {IsIn} from 'class-validator';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

export class BankTransactionCashFlowQueryDto implements BankTransactionCashFlowQuery {
	@IsIn(CASH_FLOW_INTERVALS)
	interval: CashFlowInterval;

	@IsCalendarDate()
	from: string;

	@IsCalendarDate()
	to: string;

	@IsCalendarDate()
	asOf: string;
}

/** The cash-flow query with day ends too, which only the balance trend reads. */
export class BankBalanceTrendQueryDto implements BankBalanceTrendQuery {
	@IsIn(BALANCE_TREND_INTERVALS)
	interval: BalanceTrendInterval;

	@IsCalendarDate()
	from: string;

	@IsCalendarDate()
	to: string;

	@IsCalendarDate()
	asOf: string;
}
