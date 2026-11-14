import {ConflictException} from '@nestjs/common';
import type {BankConnectionErrorCode} from '@tempo/contracts';

import {BANKING_BALANCE_FROM_BANK} from '../api/constants/banking-messages.constants';

/** Entering a balance for an account bank sync reports the balance of. */
export class BalanceFromBankException extends ConflictException {
	constructor() {
		const code: BankConnectionErrorCode = 'balance_from_bank';
		super({statusCode: 409, error: 'Conflict', message: BANKING_BALANCE_FROM_BANK, code});
	}
}
