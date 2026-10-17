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

import {DEFAULT_PAGE_INDEX, DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS} from '@core/pagination/pagination.constants';
import {transformStrictDecimalInteger} from '@core/pagination/pagination.transform';
import {IsCalendarDate} from '@core/validation/is-calendar-date';

import {
	BANK_TRANSACTION_BASE_AMOUNT_FILTER_VALUES,
	BANK_TRANSACTION_CASH_FLOW_FILTER_VALUES,
	BANK_TRANSACTION_FINANCIAL_EVENT_FILTER_VALUES,
	type BankTransactionBaseAmountFilterValue,
	type BankTransactionCashFlowFilterValue,
	type BankTransactionFinancialEventFilterValue,
} from '../../bank-transaction-financial-event';
import {
	BANK_TRANSACTION_CATEGORIZATION_SOURCES,
	BANK_TRANSACTION_CATEGORY_STATUS_FILTER_VALUES,
	type BankTransactionCategorizationSource,
	type BankTransactionCategoryStatusFilterValue,
} from '../../categorization/bank-transaction-categorization.types';
import {
	BANK_TRANSACTION_CATEGORY_FILTER_VALUES,
	type BankTransactionCategoryFilterValue,
} from '../../categorization/bank-transaction-category';
import {SERIES_KEY_PATTERN} from '../pipes/series-key.pipe';

export const DEFAULT_BANK_TRANSACTION_PAGE_INDEX = DEFAULT_PAGE_INDEX;
export const DEFAULT_BANK_TRANSACTION_PAGE_SIZE = DEFAULT_PAGE_SIZE;
// The Home dashboard shows its five most recent transactions.
export const BANK_TRANSACTION_PAGE_SIZE_OPTIONS = [5, ...PAGE_SIZE_OPTIONS];

export enum BankTransactionSortField {
	BOOKING_DATE = 'bookingDate',
	AMOUNT = 'amount',
	CATEGORY = 'category',
	SOURCE = 'source',
}

export enum BankTransactionSortOrder {
	ASC = 'ASC',
	DESC = 'DESC',
}

export class BankTransactionPaginationQueryDto {
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

export class BankTransactionSortQueryDto {
	@IsEnum(BankTransactionSortField)
	by: BankTransactionSortField;

	@IsEnum(BankTransactionSortOrder)
	order: BankTransactionSortOrder;
}

export class BankTransactionBookingDateFilterDto {
	@IsOptional()
	@IsCalendarDate()
	from?: string;

	@IsOptional()
	@IsCalendarDate()
	to?: string;
}

export class BankTransactionFilterQueryDto {
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
	@MaxLength(100)
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

export class BankTransactionQueryDto {
	@IsOptional()
	@ValidateNested()
	@Type(() => BankTransactionPaginationQueryDto)
	pagination?: BankTransactionPaginationQueryDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => BankTransactionSortQueryDto)
	sort?: BankTransactionSortQueryDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => BankTransactionFilterQueryDto)
	filter?: BankTransactionFilterQueryDto;
}
