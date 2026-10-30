import type {BankTransactionOwnTransferUpdate} from '@tempo/contracts';
import {IsIn} from 'class-validator';

import {OWN_TRANSFER_OVERRIDES, type OwnTransferOverride} from '../../own-transfer/own-transfer-detection';

export class BankTransactionOwnTransferUpdateDto implements BankTransactionOwnTransferUpdate {
	/** `null` returns the transaction to automatic recognition. */
	@IsIn([...Object.values(OWN_TRANSFER_OVERRIDES), null])
	override: OwnTransferOverride | null;
}
