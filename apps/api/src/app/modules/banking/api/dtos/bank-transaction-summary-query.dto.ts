import {Matches} from 'class-validator';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

export class BankTransactionSummaryQueryDto {
	@Matches(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/)
	month: string;

	/** The client's local date; the current month is summarized through this day. */
	@IsCalendarDate()
	asOf: string;
}
