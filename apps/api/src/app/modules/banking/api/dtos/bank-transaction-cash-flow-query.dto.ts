import {type BankTransactionCashFlowQuery, CASH_FLOW_INTERVALS, type CashFlowInterval} from '@tempo/contracts';
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
