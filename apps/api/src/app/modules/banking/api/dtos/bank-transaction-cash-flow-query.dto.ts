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

/** The local dates every period query takes: the range and the owner's today. Each query adds its interval. */
export abstract class PeriodRangeQueryDto {
	@IsCalendarDate()
	from: string;

	@IsCalendarDate()
	to: string;

	@IsCalendarDate()
	asOf: string;
}

export class BankTransactionCashFlowQueryDto extends PeriodRangeQueryDto implements BankTransactionCashFlowQuery {
	@IsIn(CASH_FLOW_INTERVALS)
	interval: CashFlowInterval;
}

/** The cash-flow query with day ends too, which only the balance trend reads. */
export class BankBalanceTrendQueryDto extends PeriodRangeQueryDto implements BankBalanceTrendQuery {
	@IsIn(BALANCE_TREND_INTERVALS)
	interval: BalanceTrendInterval;
}
