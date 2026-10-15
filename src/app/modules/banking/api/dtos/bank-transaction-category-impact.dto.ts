import {IsEnum} from 'class-validator';

import type {
	BankTransactionCategorizationSource,
	BankTransactionCategorizationStatus,
} from '../../categorization/bank-transaction-categorization.types';
import {BANK_TRANSACTION_CATEGORIES, BankTransactionCategory} from '../../categorization/bank-transaction-category';
import type {ManualCategoryFollowUpAction} from '../../categorization/manual-category-follow-up';

export class BankTransactionCategoryImpactQueryDto {
	@IsEnum(BANK_TRANSACTION_CATEGORIES)
	category: BankTransactionCategory;
}

export class BankTransactionCategoryImpactTransactionDto {
	id: string;
	transactionDate: string | null;
	bookingDate: string | null;
	displayDescription: string;
	amount: string;
	currency: string;
	category: BankTransactionCategory | null;
	categoryStatus: BankTransactionCategorizationStatus;
	categorySource: BankTransactionCategorizationSource | null;
}

export class BankTransactionCategoryImpactResponseDto {
	/**
	 * `APPLY` sets `category` on every listed row; `RECHECK` sends them back to AI categorization because the owner's
	 * choices for this merchant disagree or none is left. `null` when the correction changes no other row.
	 */
	action: ManualCategoryFollowUpAction | null;
	/** The category `APPLY` sets; `null` for `RECHECK`. */
	category: BankTransactionCategory | null;
	/** The affected rows, newest booking first, capped at 500. */
	transactions: BankTransactionCategoryImpactTransactionDto[];
	/** Every affected row, including any past the cap. */
	total: number;
}
