import {BANK_TRANSACTION_CATEGORIES, BankTransactionCategory} from '@tempo/contracts';
import {ArrayMaxSize, IsArray, IsEnum, IsOptional, IsUUID} from 'class-validator';

import {MAX_MANUAL_CATEGORY_FOLLOW_UP_TRANSACTIONS} from '../../categorization/manual-category-follow-up';

export class BankTransactionCategoryUpdateDto {
	@IsEnum(BANK_TRANSACTION_CATEGORIES)
	category: BankTransactionCategory;

	/**
	 * The owner's other rows from the same merchant that the correction should also change, chosen from the category
	 * impact preview. Omitted or empty changes only this transaction. Ids the preview would not list are ignored.
	 */
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(MAX_MANUAL_CATEGORY_FOLLOW_UP_TRANSACTIONS)
	@IsUUID('4', {each: true})
	applyToTransactionIds?: string[];
}
