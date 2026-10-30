import type {BankTransactionSummaryQuery} from '@tempo/contracts';
import {Matches} from 'class-validator';

import {IsCalendarDate} from '@core/validation/is-calendar-date';

export class BankTransactionSummaryQueryDto implements BankTransactionSummaryQuery {
	@Matches(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/)
	month: string;

	@IsCalendarDate()
	asOf: string;
}
