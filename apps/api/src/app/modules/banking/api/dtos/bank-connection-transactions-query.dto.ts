import {Transform} from 'class-transformer';
import {IsInt, IsOptional, Max, Min} from 'class-validator';

import {transformStrictDecimalInteger} from '@core/pagination/pagination.transform';

export const DEFAULT_BANK_CONNECTION_TRANSACTION_LIMIT = 25;
export const MAX_BANK_CONNECTION_TRANSACTION_LIMIT = 100;

export class BankConnectionTransactionsQueryDto {
	@IsOptional()
	@Transform(transformStrictDecimalInteger)
	@IsInt()
	@Min(1)
	@Max(MAX_BANK_CONNECTION_TRANSACTION_LIMIT)
	limit: number = DEFAULT_BANK_CONNECTION_TRANSACTION_LIMIT;
}
