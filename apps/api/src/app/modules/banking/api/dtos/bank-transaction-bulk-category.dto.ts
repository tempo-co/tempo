import {BadRequestException} from '@nestjs/common';
import {
	BANK_TRANSACTION_BULK_CATEGORY_MAX_IDS,
	BANK_TRANSACTION_BULK_CATEGORY_SCOPES,
	type BankTransactionBulkCategoryPreviewRequest,
	type BankTransactionBulkCategoryScope,
	type BankTransactionBulkCategoryUpdate,
	type BankTransactionCategory,
} from '@tempo/contracts';
import {Type} from 'class-transformer';
import {ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsUUID, ValidateNested} from 'class-validator';

import {REUSABLE_MANUAL_CATEGORIES} from '../../categorization/manual-category-follow-up';
import {BankTransactionFilterQueryDto} from './bank-transaction-query.dto';

/** The rows a bulk category is for: the selected ids, or every row the Transactions list's filters match. */
export type BulkCategorySelection = {transactionIds: readonly string[]} | {filter: BankTransactionFilterQueryDto};

/** The selection is `transactionIds` or `filter`, never both: `toBulkCategorySelection` refuses anything else. */
export class BankTransactionBulkCategoryPreviewDto implements BankTransactionBulkCategoryPreviewRequest {
	/** The owner's selected rows; one that is not theirs refuses the whole request. */
	@IsOptional()
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(BANK_TRANSACTION_BULK_CATEGORY_MAX_IDS)
	@IsUUID('4', {each: true})
	transactionIds?: string[];

	/** Every one of the owner's rows the Transactions list's filters match; matching none refuses the request. */
	@IsOptional()
	@IsObject()
	@ValidateNested()
	@Type(() => BankTransactionFilterQueryDto)
	filter?: BankTransactionFilterQueryDto;

	/** A category the owner can pick for a row; Needs review is not one. */
	@IsIn(REUSABLE_MANUAL_CATEGORIES)
	category: BankTransactionCategory;
}

export class BankTransactionBulkCategoryUpdateDto
	extends BankTransactionBulkCategoryPreviewDto
	implements BankTransactionBulkCategoryUpdate
{
	@IsIn(BANK_TRANSACTION_BULK_CATEGORY_SCOPES)
	scope: BankTransactionBulkCategoryScope;
}

/** The request's selection; refuses (400) a request that sends both ids and a filter, or neither. */
export function toBulkCategorySelection(dto: BankTransactionBulkCategoryPreviewDto): BulkCategorySelection {
	if (dto.transactionIds && !dto.filter) return {transactionIds: dto.transactionIds};
	if (dto.filter && !dto.transactionIds) return {filter: dto.filter};
	throw new BadRequestException(['Send either transactionIds or filter']);
}
