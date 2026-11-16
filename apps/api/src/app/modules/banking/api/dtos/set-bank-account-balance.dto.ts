import type {SetBankAccountBalanceRequest} from '@tempo/contracts';
import {IsString, Matches} from 'class-validator';

import {BANKING_BALANCE_AMOUNT_INVALID} from '../constants/banking-messages.constants';

/** At most 12 whole digits, which `numeric(20,8)` holds, and two decimals. */
const BALANCE_AMOUNT = /^-?\d{1,12}(\.\d{1,2})?$/;

export class SetBankAccountBalanceDto implements SetBankAccountBalanceRequest {
	@IsString({message: BANKING_BALANCE_AMOUNT_INVALID})
	@Matches(BALANCE_AMOUNT, {message: BANKING_BALANCE_AMOUNT_INVALID})
	amount: string;
}
