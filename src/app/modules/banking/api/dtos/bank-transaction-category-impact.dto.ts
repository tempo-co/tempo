import {PickType} from '@nestjs/swagger';
import {IsEnum} from 'class-validator';

import {BANK_TRANSACTION_CATEGORIES, BankTransactionCategory} from '../../categorization/bank-transaction-category';
import type {ManualCategoryFollowUpAction} from '../../categorization/manual-category-follow-up';
import {BankTransactionResponseDto} from './bank-transaction-response.dto';

export class BankTransactionCategoryImpactQueryDto {
	@IsEnum(BANK_TRANSACTION_CATEGORIES)
	category: BankTransactionCategory;
}

export class BankTransactionCategoryImpactTransactionDto extends PickType(BankTransactionResponseDto, [
	'id',
	'transactionDate',
	'bookingDate',
	'displayDescription',
	'amount',
	'currency',
	'category',
	'categoryStatus',
	'categorySource',
] as const) {}

export class BankTransactionCategoryImpactResponseDto {
	/**
	 * `APPLY` sets `category` on every listed row; `RECHECK` sends them back to AI categorization because the owner's
	 * choices for this merchant disagree or none is left. `null` when the correction changes no other row.
	 */
	action: ManualCategoryFollowUpAction | null;
	/** The category `APPLY` sets; `null` for `RECHECK`. */
	category: BankTransactionCategory | null;
	/** The affected rows, newest first by transaction date (then booking date), capped at 500. */
	transactions: BankTransactionCategoryImpactTransactionDto[];
	/** Every affected row, including any past the cap. */
	total: number;
}
