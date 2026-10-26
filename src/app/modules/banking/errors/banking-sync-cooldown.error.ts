import {HttpException, HttpStatus} from '@nestjs/common';

import {BANKING_RATE_LIMITED_SYNC_ERROR} from '../api/constants/banking-messages.constants';

export class BankingSyncCooldownError extends HttpException {
	constructor(readonly retryAfterSeconds: number) {
		super(
			{
				statusCode: HttpStatus.TOO_MANY_REQUESTS,
				message: BANKING_RATE_LIMITED_SYNC_ERROR,
				error: 'Too Many Requests',
				rateLimitSource: 'enable-banking',
				retryAfterSeconds,
			},
			HttpStatus.TOO_MANY_REQUESTS,
		);
	}
}
