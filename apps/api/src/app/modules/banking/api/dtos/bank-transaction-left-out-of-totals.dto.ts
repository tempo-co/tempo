import type {BankTransactionBulkLeftOutOfTotalsUpdate, BankTransactionLeftOutOfTotalsUpdate} from '@wisp/contracts';
import {IsBoolean} from 'class-validator';

import {BankTransactionBulkSelectionDto} from './bank-transaction-bulk-selection.dto';

export class BankTransactionLeftOutOfTotalsUpdateDto implements BankTransactionLeftOutOfTotalsUpdate {
	/** `true` leaves the row out of every total; `false` counts it again. */
	@IsBoolean()
	leftOutOfTotals: boolean;
}

export class BankTransactionBulkLeftOutOfTotalsUpdateDto
	extends BankTransactionBulkSelectionDto
	implements BankTransactionBulkLeftOutOfTotalsUpdate
{
	/** `true` leaves every selected row out of every total; `false` counts them again. */
	@IsBoolean()
	leftOutOfTotals: boolean;
}
