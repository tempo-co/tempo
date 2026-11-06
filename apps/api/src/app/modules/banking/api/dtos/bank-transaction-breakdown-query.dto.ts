import {
	BREAKDOWN_DIMENSIONS,
	BREAKDOWN_INTERVALS,
	type BankTransactionBreakdownQuery,
	type BreakdownDimension,
	type BreakdownInterval,
} from '@tempo/contracts';
import {IsIn} from 'class-validator';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

export class BankTransactionBreakdownQueryDto implements BankTransactionBreakdownQuery {
	@IsIn(BREAKDOWN_INTERVALS)
	interval: BreakdownInterval;

	@IsIn(BREAKDOWN_DIMENSIONS)
	by: BreakdownDimension;

	@IsCalendarDate()
	from: string;

	@IsCalendarDate()
	to: string;

	@IsCalendarDate()
	asOf: string;
}
