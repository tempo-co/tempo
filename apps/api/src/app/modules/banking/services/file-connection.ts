import {EntityManager} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankConnection} from '../bank-connection.entity';
import {
	BANK_CONNECTION_PROVIDERS,
	BANK_CONNECTION_STATUSES,
	BANK_SYNC_STATUSES,
	FILE_CONNECTION_ASPSP,
} from './banking-sync.constants';

/**
 * The owner's imported-files connection, created when missing and locked for the caller's transaction. The partial
 * unique index makes two concurrent creations end up with one connection; the row lock serializes imports, undo,
 * and the connection removals and authorizations that move accounts to or from it. Null only when the owner's
 * connection was removed between the two statements.
 */
export async function lockFileConnection(
	manager: EntityManager,
	ownerId: Account['id'],
): Promise<BankConnection | null> {
	const connections = manager.getRepository(BankConnection);
	await connections
		.createQueryBuilder()
		.insert()
		.into(BankConnection)
		.values({
			account: {id: ownerId},
			provider: BANK_CONNECTION_PROVIDERS.FILE,
			aspspName: FILE_CONNECTION_ASPSP.name,
			aspspCountry: FILE_CONNECTION_ASPSP.country,
			status: BANK_CONNECTION_STATUSES.AUTHORIZED,
			syncStatus: BANK_SYNC_STATUSES.IDLE,
			nextSyncAt: null,
			consentValidUntil: null,
			providerSessionId: null,
		})
		.orIgnore()
		.updateEntity(false)
		.execute();
	return connections.findOne({
		where: {accountId: ownerId, provider: BANK_CONNECTION_PROVIDERS.FILE},
		lock: {mode: 'pessimistic_write'},
	});
}

/** The `providerAccountId` of the imported-files account a statement naming this account (IBAN or other id) goes to. */
export function fileAccountProviderId(identifier: string, currency: string): string {
	return `file:${identifier}:${currency}`;
}
