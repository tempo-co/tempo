import {ConflictException} from '@nestjs/common';

import {BANKING_SYNC_ALREADY_IN_PROGRESS} from '../api/constants/banking-messages.constants';

/** A history write could not take the sync lease of a connection it writes to in time: a sync holds it. HTTP 409. */
export class AccountHistoryWriteBusyError extends ConflictException {
	constructor() {
		super(BANKING_SYNC_ALREADY_IN_PROGRESS);
		this.name = 'AccountHistoryWriteBusyError';
	}
}
