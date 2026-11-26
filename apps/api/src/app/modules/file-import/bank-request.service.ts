import {HttpException, HttpStatus, Injectable} from '@nestjs/common';
import {BANK_REQUEST_MAX_PER_DAY, CreateBankRequest} from '@tempo/contracts';
import {DataSource, MoreThan} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankRequest} from './bank-request.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Keeps "Tell us your bank" requests: at most `BANK_REQUEST_MAX_PER_DAY` per owner in any 24 hours. */
@Injectable()
export class BankRequestService {
	constructor(private readonly dataSource: DataSource) {}

	/** Counted under the owner's row lock, so two requests at once cannot both pass the limit. */
	async create(ownerId: Account['id'], request: CreateBankRequest): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			await manager.query('SELECT "id" FROM "accounts" WHERE "id" = $1 FOR UPDATE', [ownerId]);
			const requests = manager.getRepository(BankRequest);
			const recent = await requests.find({
				select: {id: true, createdAt: true},
				where: {accountId: ownerId, createdAt: MoreThan(new Date(Date.now() - DAY_MS))},
				order: {createdAt: 'ASC'},
			});
			if (recent.length >= BANK_REQUEST_MAX_PER_DAY) {
				// The oldest of the day's requests leaves the window first.
				const retryAt = new Date(recent[recent.length - BANK_REQUEST_MAX_PER_DAY].createdAt.getTime() + DAY_MS);
				throw new HttpException(
					{
						statusCode: HttpStatus.TOO_MANY_REQUESTS,
						message: `You have sent ${BANK_REQUEST_MAX_PER_DAY} bank requests in the last 24 hours. Try again later.`,
						retryAt: retryAt.toISOString(),
					},
					HttpStatus.TOO_MANY_REQUESTS,
				);
			}
			await requests.insert({
				accountId: ownerId,
				bankName: request.bankName,
				country: request.country,
				fileTypes: request.fileTypes,
			});
		});
	}
}
