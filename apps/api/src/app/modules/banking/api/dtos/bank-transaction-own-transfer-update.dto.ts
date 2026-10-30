import {IsIn} from 'class-validator';

import {OWN_TRANSFER_OVERRIDES, type OwnTransferOverride} from '../../own-transfer/own-transfer-detection';

export class BankTransactionOwnTransferUpdateDto {
	/** `null` returns the transaction to automatic recognition. */
	@IsIn([...Object.values(OWN_TRANSFER_OVERRIDES), null])
	override: OwnTransferOverride | null;
}
