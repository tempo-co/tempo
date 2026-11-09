import {
	BREAKDOWN_DIMENSIONS,
	BREAKDOWN_INTERVALS,
	type BankTransactionBreakdownQuery,
	type BreakdownDimension,
	type BreakdownInterval,
} from '@tempo/contracts';
import {IsIn} from 'class-validator';

import {PeriodRangeQueryDto} from './bank-transaction-cash-flow-query.dto';

export class BankTransactionBreakdownQueryDto extends PeriodRangeQueryDto implements BankTransactionBreakdownQuery {
	@IsIn(BREAKDOWN_INTERVALS)
	interval: BreakdownInterval;

	@IsIn(BREAKDOWN_DIMENSIONS)
	by: BreakdownDimension;
}
