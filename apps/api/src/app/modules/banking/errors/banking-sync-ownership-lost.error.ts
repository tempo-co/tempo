import {ConflictException} from '@nestjs/common';

import {BANKING_SYNC_CONNECTION_CHANGED} from '../api/constants/banking-messages.constants';

/**
 * A sync's fenced write matched no row: the connection was re-authorized, expired, removed or claimed by a newer run
 * since this run read it. HTTP 409; the run's own writes roll back.
 */
export class BankingSyncOwnershipLostError extends ConflictException {
	constructor() {
		super(BANKING_SYNC_CONNECTION_CHANGED);
		this.name = 'BankingSyncOwnershipLostError';
	}
}
