import {ConflictException, Injectable, NotFoundException} from '@nestjs/common';
import type {UpdateBankAccountRequest} from '@wisp/contracts';
import {DataSource} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {
	BANKING_ACCOUNT_NOT_FOUND,
	BANKING_ACCOUNT_REMOVED_WITH_CONNECTION,
} from '../api/constants/banking-messages.constants';
import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {AccountHistoryWriterService} from './account-history-writer.service';
import {BANK_CONNECTION_PROVIDERS} from './banking-sync.constants';
import {DerivedDataRefreshService} from './derived-data-refresh.service';
import {ImportedRowRecordsRegistry} from './imported-row-records';

/** The owner's own settings for one account: its name and whether it is hidden, and removing an imported-files one. */
@Injectable()
export class BankAccountSettingsService {
	constructor(
		private readonly dataSource: DataSource,
		private readonly historyWriter: AccountHistoryWriterService,
		private readonly derivedDataRefresh: DerivedDataRefreshService,
		private readonly importedRowRecords: ImportedRowRecordsRegistry,
	) {}

	/**
	 * Writes the owner's name for the account (trimmed; null or blank goes back to the bank's name) and whether it is
	 * hidden; a field left out stays. Refuses an account that is not the owner's under that connection (404).
	 */
	async update(
		ownerId: Account['id'],
		connectionId: BankConnection['id'],
		bankAccountId: BankAccount['id'],
		{alias, isHidden}: UpdateBankAccountRequest,
	): Promise<void> {
		const values: Partial<Pick<BankAccount, 'alias' | 'isHidden'>> = {};
		if (alias !== undefined) values.alias = alias?.trim() || null;
		if (isHidden !== undefined) values.isHidden = isHidden;
		const entries = Object.entries(values);
		const owned: Array<{id: string}> = await this.dataSource
			.query(
				`UPDATE "bank_accounts" bank_account
			SET ${entries.map(([column], index) => `"${column}" = $${index + 4}, `).join('')}"updatedAt" = CURRENT_TIMESTAMP
			FROM "bank_connections" connection
			WHERE bank_account."id" = $1 AND connection."id" = bank_account."bankConnectionId"
				AND connection."id" = $2 AND connection."accountId" = $3
			RETURNING bank_account."id"`,
				[bankAccountId, connectionId, ownerId, ...entries.map(([, value]) => value)],
			)
			.then(([rows]: [Array<{id: string}>, number]) => rows);
		if (owned.length === 0) throw new NotFoundException(BANKING_ACCOUNT_NOT_FOUND);
	}

	/**
	 * Deletes one of the owner's imported-files accounts for good, through the history writer: its rows, balances and
	 * open questions with it, and the imports that wrote to no other account; the imports it shares stop naming it.
	 * No other account's rows are written, except that own-transfer and exchange pointers to its rows are cleared by
	 * their foreign keys and decided again by the refresh after. Refuses an account that is not the owner's (404) and a
	 * synced one (409), which goes with its connection's removal.
	 */
	async removeFileAccount(
		ownerId: Account['id'],
		connectionId: BankConnection['id'],
		bankAccountId: BankAccount['id'],
	): Promise<void> {
		// Checked before any lock, so a synced account is refused at once.
		const owned = await this.dataSource.getRepository(BankAccount).findOne({
			where: {id: bankAccountId, bankConnection: {id: connectionId, accountId: ownerId}},
			relations: {bankConnection: true},
		});
		if (!owned) throw new NotFoundException(BANKING_ACCOUNT_NOT_FOUND);
		if (owned.bankConnection.provider !== BANK_CONNECTION_PROVIDERS.FILE) {
			throw new ConflictException(BANKING_ACCOUNT_REMOVED_WITH_CONNECTION);
		}

		await this.historyWriter.write(ownerId, {fileConnection: 'existing'}, async ({manager, fileConnection}) => {
			// Read again under the imported-files connection's lock: an undo or a removal may have taken it since, or an
			// authorization taken it back to its bank.
			const locked: Array<{id: string}> =
				fileConnection?.id === connectionId
					? await manager.query(
							`SELECT bank_account."id" FROM "bank_accounts" bank_account
							JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
							WHERE bank_account."id" = $1 AND connection."id" = $2 AND connection."accountId" = $3
							FOR UPDATE OF bank_account`,
							[bankAccountId, fileConnection.id, ownerId],
						)
					: [];
			if (locked.length === 0) throw new NotFoundException(BANKING_ACCOUNT_NOT_FOUND);
			await this.importedRowRecords.records.forgetAccount(manager, ownerId, bankAccountId);
			await manager.query(
				`DELETE FROM "bank_accounts" bank_account
				USING "bank_connections" connection
				WHERE bank_account."id" = $1 AND connection."id" = bank_account."bankConnectionId"
					AND connection."id" = $2 AND connection."accountId" = $3 AND connection."provider" = $4`,
				[bankAccountId, fileConnection!.id, ownerId, BANK_CONNECTION_PROVIDERS.FILE],
			);
		});

		await this.derivedDataRefresh.refresh(ownerId, {kind: 'removal'});
	}
}
