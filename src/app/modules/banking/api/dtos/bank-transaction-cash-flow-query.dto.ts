import {Matches} from 'class-validator';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

const MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

export class BankTransactionCashFlowQueryDto {
	@Matches(MONTH)
	from: string;

	@Matches(MONTH)
	to: string;

	/** The client's local date; the current month is totalled through this day. */
	@IsCalendarDate()
	asOf: string;
}
