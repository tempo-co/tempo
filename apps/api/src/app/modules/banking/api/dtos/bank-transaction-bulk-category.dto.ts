import {
	BANK_TRANSACTION_BULK_CATEGORY_SCOPES,
	type BankTransactionBulkCategoryPreviewRequest,
	type BankTransactionBulkCategoryScope,
	type BankTransactionBulkCategoryUpdate,
	type BankTransactionCategory,
} from '@tempo/contracts';
import {ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsUUID} from 'class-validator';

import {
	MAX_MANUAL_CATEGORY_FOLLOW_UP_TRANSACTIONS,
	REUSABLE_MANUAL_CATEGORIES,
} from '../../categorization/manual-category-follow-up';

export class BankTransactionBulkCategoryPreviewDto implements BankTransactionBulkCategoryPreviewRequest {
	/** The owner's selected rows; one that is not theirs refuses the whole request. */
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(MAX_MANUAL_CATEGORY_FOLLOW_UP_TRANSACTIONS)
	@IsUUID('4', {each: true})
	transactionIds: string[];

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
