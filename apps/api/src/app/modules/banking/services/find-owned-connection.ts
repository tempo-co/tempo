import {NotFoundException} from '@nestjs/common';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BANKING_CONNECTION_NOT_FOUND} from '../api/constants/banking-messages.constants';
import {BankConnection} from '../bank-connection.entity';

/** The owner's connection, or a 404 when it does not exist or belongs to another account. */
export async function findOwnedConnection(
	repository: Repository<BankConnection>,
	accountId: Account['id'],
	connectionId: BankConnection['id'],
): Promise<BankConnection> {
	const connection = await repository.findOne({where: {id: connectionId, account: {id: accountId}}});
	if (!connection) throw new NotFoundException(BANKING_CONNECTION_NOT_FOUND);
	return connection;
}
