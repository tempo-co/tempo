import {
	CASH_FLOW_INTERVALS,
	type CashFlowInterval,
	MERCHANT_LIST_MAX_LIMIT,
	MERCHANT_RANKING_MAX_LIMIT,
	MERCHANT_SEARCH_MAX_LENGTH,
	type MerchantGroupsQuery,
	type MerchantRankingQuery,
} from '@tempo/contracts';
import {Transform} from 'class-transformer';
import {IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min} from 'class-validator';

import {transformStrictDecimalInteger} from '@core/pagination/pagination.transform';
import {IsCalendarDate} from '@core/validation/is-calendar-date';

export class MerchantGroupsQueryDto implements MerchantGroupsQuery {
	@IsOptional()
	@IsString()
	@MaxLength(MERCHANT_SEARCH_MAX_LENGTH)
	search?: string;

	@IsOptional()
	@Transform(transformStrictDecimalInteger)
	@IsInt()
	@Min(0)
	offset?: number;

	@IsOptional()
	@Transform(transformStrictDecimalInteger)
	@IsInt()
	@Min(1)
	@Max(MERCHANT_LIST_MAX_LIMIT)
	limit?: number;
}

export class MerchantRankingQueryDto implements MerchantRankingQuery {
	@IsIn(CASH_FLOW_INTERVALS)
	interval: CashFlowInterval;

	@IsCalendarDate()
	period: string;

	@IsCalendarDate()
	asOf: string;

	@IsOptional()
	@Transform(transformStrictDecimalInteger)
	@IsInt()
	@Min(1)
	@Max(MERCHANT_RANKING_MAX_LIMIT)
	limit?: number;
}
