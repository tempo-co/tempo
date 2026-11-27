import {
	BANK_TRANSACTION_BULK_CATEGORY_SCOPES,
	type BankTransactionBulkCategoryPreviewRequest,
	type BankTransactionBulkCategoryScope,
	type BankTransactionBulkCategoryUpdate,
	type BankTransactionCategory,
} from '@wisp/contracts';
import {IsIn} from 'class-validator';

import {REUSABLE_MANUAL_CATEGORIES} from '../../categorization/manual-category-follow-up';
import {BankTransactionBulkSelectionDto} from './bank-transaction-bulk-selection.dto';

export class BankTransactionBulkCategoryPreviewDto
	extends BankTransactionBulkSelectionDto
	implements BankTransactionBulkCategoryPreviewRequest
{
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
