import {
	BANK_TRANSACTION_CATEGORIES,
	type BankTransactionCategory,
	type BankTransactionCategoryImpactQuery,
} from '@tempo/contracts';
import {IsEnum} from 'class-validator';

export class BankTransactionCategoryImpactQueryDto implements BankTransactionCategoryImpactQuery {
	@IsEnum(BANK_TRANSACTION_CATEGORIES)
	category: BankTransactionCategory;
}
