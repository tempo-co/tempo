import {
	BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES,
	BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES,
	BANK_TRANSACTION_CATEGORIZATION_SOURCES,
	BANK_TRANSACTION_CATEGORY_FILTER_VALUES,
	BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES,
	BANK_TRANSACTION_FINANCIAL_EVENT_FILTER_VALUES,
	BANK_TRANSACTION_PAGE_SIZE_OPTIONS,
	BANK_TRANSACTION_SEARCH_MAX_LENGTH,
	BANK_TRANSACTION_SORT_FIELDS,
	type BankTransactionBaseAmountFilterValue,
	type BankTransactionCashFlowFilterValue,
	type BankTransactionCategorizationSource,
	type BankTransactionCategoryFilterValue,
	type BankTransactionCategoryStatusFilterValue,
	type BankTransactionFilter,
	type BankTransactionFinancialEventFilterValue,
	type BankTransactionSortField,
	type BankTransactionTotalsQuery,
	type BankTransactionsQuery,
	SORT_ORDERS,
	type SortOrder,
} from '@tempo/contracts';
import {Transform, Type} from 'class-transformer';
import {
	IsArray,
	IsEnum,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	MaxLength,
	Min,
	ValidateNested,
} from 'class-validator';

import {DEFAULT_PAGE_INDEX, DEFAULT_PAGE_SIZE} from '@core/pagination/pagination.constants';
import {transformStrictDecimalInteger} from '@core/pagination/pagination.transform';
import {IsCalendarDate} from '@core/validation/is-calendar-date';

import {SERIES_KEY_PATTERN} from '../pipes/series-key.pipe';

export const DEFAULT_BANK_TRANSACTION_PAGE_INDEX = DEFAULT_PAGE_INDEX;
export const DEFAULT_BANK_TRANSACTION_PAGE_SIZE = DEFAULT_PAGE_SIZE;

export class BankTransactionPaginationQueryDto implements NonNullable<BankTransactionsQuery['pagination']> {
	@IsOptional()
	@Transform(transformStrictDecimalInteger)
	@IsInt()
	@Min(0)
	pageIndex: number = DEFAULT_BANK_TRANSACTION_PAGE_INDEX;

	@IsOptional()
	@Transform(transformStrictDecimalInteger)
	@IsInt()
	@Min(1)
	@IsIn(BANK_TRANSACTION_PAGE_SIZE_OPTIONS)
	pageSize: number = DEFAULT_BANK_TRANSACTION_PAGE_SIZE;
}

export class BankTransactionSortQueryDto implements NonNullable<BankTransactionsQuery['sort']> {
	@IsIn(BANK_TRANSACTION_SORT_FIELDS)
	by: BankTransactionSortField;

	@IsIn(SORT_ORDERS)
	order: SortOrder;
}

export class BankTransactionBookingDateFilterDto implements NonNullable<BankTransactionFilter['bookingDate']> {
	@IsOptional()
	@IsCalendarDate()
	from?: string;

	@IsOptional()
	@IsCalendarDate()
	to?: string;
}

export class BankTransactionFilterQueryDto implements BankTransactionFilter {
	@IsOptional()
	@ValidateNested()
	@Type(() => BankTransactionBookingDateFilterDto)
	bookingDate?: BankTransactionBookingDateFilterDto;

	@IsOptional()
	@IsArray()
	@IsUUID('4', {each: true})
	bankAccountIds?: string[];

	@IsOptional()
	@IsString()
	@MaxLength(BANK_TRANSACTION_SEARCH_MAX_LENGTH)
	search?: string;

	@IsOptional()
	@IsArray()
	@IsEnum(BANK_TRANSACTION_CATEGORY_FILTER_VALUES, {each: true})
	categories?: BankTransactionCategoryFilterValue[];

	@IsOptional()
	@IsArray()
	@IsEnum(BANK_TRANSACTION_CATEGORIZATION_SOURCES, {each: true})
	categorySources?: BankTransactionCategorizationSource[];

	@IsOptional()
	@IsArray()
	@IsIn(BANK_TRANSACTION_FINANCIAL_EVENT_FILTER_VALUES, {each: true})
	financialEventTypes?: BankTransactionFinancialEventFilterValue[];

	@IsOptional()
	@IsArray()
	@IsIn(BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES, {each: true})
	cashFlows?: BankTransactionCashFlowFilterValue[];

	@IsOptional()
	@IsIn(BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES)
	baseAmount?: BankTransactionBaseAmountFilterValue;

	@IsOptional()
	@IsArray()
	@IsIn(BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES, {each: true})
	categoryStatuses?: BankTransactionCategoryStatusFilterValue[];

	/** Only the payments of one detected recurring series. */
	@IsOptional()
	@Matches(SERIES_KEY_PATTERN)
	recurringSeriesKey?: string;
}

/** Totals use the list's filter contract, without sort or pagination inputs. */
export class BankTransactionTotalsQueryDto implements BankTransactionTotalsQuery {
	@IsOptional()
	@ValidateNested()
	@Type(() => BankTransactionFilterQueryDto)
	filter?: BankTransactionFilterQueryDto;
}

export class BankTransactionQueryDto extends BankTransactionTotalsQueryDto implements BankTransactionsQuery {
	@IsOptional()
	@ValidateNested()
	@Type(() => BankTransactionPaginationQueryDto)
	pagination?: BankTransactionPaginationQueryDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => BankTransactionSortQueryDto)
	sort?: BankTransactionSortQueryDto;
}
