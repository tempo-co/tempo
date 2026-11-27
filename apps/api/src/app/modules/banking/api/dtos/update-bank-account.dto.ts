import {
	BANK_ACCOUNT_ALIAS_MAX_LENGTH,
	type BankAccountRemoveRequest,
	type UpdateBankAccountRequest,
} from '@tempo/contracts';
import {Equals, IsBoolean, IsOptional, IsString, MaxLength, ValidateIf} from 'class-validator';

import {BANKING_ACCOUNT_REMOVAL_CONFIRMATION_REQUIRED} from '../constants/banking-messages.constants';

export class UpdateBankAccountDto implements UpdateBankAccountRequest {
	/** The owner's name for the account; null or blank goes back to the bank's name. */
	@IsOptional()
	@IsString()
	@MaxLength(BANK_ACCOUNT_ALIAS_MAX_LENGTH)
	alias?: string | null;

	/** `true` hides the account from lists and totals; `false` shows it again. Left out, it stays; null is refused. */
	@ValidateIf((_dto, value) => value !== undefined)
	@IsBoolean()
	isHidden?: boolean;
}

export class BankAccountRemoveDto implements BankAccountRemoveRequest {
	@Equals('DELETE', {message: BANKING_ACCOUNT_REMOVAL_CONFIRMATION_REQUIRED})
	confirmation: 'DELETE';
}
