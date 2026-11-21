import {BadRequestException, ConflictException, Injectable, Logger, NotFoundException} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {BankConnectionRemoveRequest} from '@tempo/contracts';
import {DataSource, EntityManager, In, Repository} from 'typeorm';

import {dateInTimeZone} from '@core/time/app-time-zone';
import {Account} from '@modules/account/account.entity';

import {
	BANKING_CONNECTION_NOT_FOUND,
	BANKING_CONNECTION_NOT_REMOVABLE,
	BANKING_CONNECTION_REMOVAL_CONFIRMATION_REQUIRED,
} from '../api/constants/banking-messages.constants';
import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {nameBankIdentity} from '../bank-identity';
import {releaseLockSafely, safeErrorCode} from './bank-connection.utils';
import {BankingAuthorizationStateService} from './banking-authorization-state.service';
import {BankingConnectionLockService} from './banking-connection-lock.service';
import {BankingConsentRevocationService} from './banking-consent-revocation.service';
import {
	BANK_CONNECTION_PROVIDERS,
	BANK_CONNECTION_STATUSES,
	DESTRUCTIVE_CONNECTION_STATUSES,
} from './banking-sync.constants';
import {DerivedDataRefreshService} from './derived-data-refresh.service';
import {FileAccountBalanceService} from './file-account-balance.service';
import {fileAccountProviderId, lockExistingFileConnection, lockFileConnection} from './file-connection';
import {findOwnedConnection} from './find-owned-connection';
import {ImportedRowRecordsRegistry} from './imported-row-records';

const REMOVABLE_CONNECTION_STATUSES = [
	BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION,
	BANK_CONNECTION_STATUSES.CANCELLED,
	BANK_CONNECTION_STATUSES.FAILED,
	...DESTRUCTIVE_CONNECTION_STATUSES,
] as const;

/** Whether the removal keeps the accounts; the imported-files connection has nowhere to keep them. */
function keepsAccounts(connection: BankConnection, {keepAccounts}: BankConnectionRemoveRequest): boolean {
	return keepAccounts === true && connection.provider !== BANK_CONNECTION_PROVIDERS.FILE;
}

/**
 * Removes an owner's bank connection: revokes its consent, deletes it and cleans its pending authorizations. Its
 * accounts are deleted with it, or kept as imported-files accounts (`keepAccounts`).
 */
@Injectable()
export class BankConnectionRemovalService {
	private readonly logger = new Logger(BankConnectionRemovalService.name);

	constructor(
		@InjectRepository(BankConnection)
		private readonly bankConnectionRepository: Repository<BankConnection>,
		@InjectRepository(BankAccount)
		private readonly bankAccountRepository: Repository<BankAccount>,
		private readonly dataSource: DataSource,
		private readonly authorizationStateService: BankingAuthorizationStateService,
		private readonly connectionLockService: BankingConnectionLockService,
		private readonly consentRevocationService: BankingConsentRevocationService,
		private readonly fileAccountBalanceService: FileAccountBalanceService,
		private readonly derivedDataRefresh: DerivedDataRefreshService,
		private readonly importedRowRecords: ImportedRowRecordsRegistry,
	) {}

	async removeConnection(
		accountId: Account['id'],
		connectionId: BankConnection['id'],
		removal: BankConnectionRemoveRequest = {},
	): Promise<void> {
		await findOwnedConnection(this.bankConnectionRepository, accountId, connectionId);

		const connectionLock = await this.connectionLockService.acquire(connectionId);
		let deletionCommitted = false;
		let authorizationConnectionIdsToClean = [connectionId];

		try {
			connectionLock.assertHealthy();
			// Close the bank consent before deleting the row that names its session. The lease keeps sync and
			// reauthorization off the session meanwhile; the transaction below checks the same refusals again.
			const connectionToRevoke = await findOwnedConnection(
				this.bankConnectionRepository,
				accountId,
				connectionId,
			);
			await this.assertRemovable(connectionToRevoke, removal, this.bankAccountRepository);
			await this.consentRevocationService.revokeSessions([connectionToRevoke]);
			connectionLock.assertHealthy();

			await this.dataSource.transaction(async (manager) => {
				connectionLock.assertHealthy();
				const connectionRepository = manager.getRepository(BankConnection);
				const bankAccountRepository = manager.getRepository(BankAccount);
				const candidateConnection = await findOwnedConnection(connectionRepository, accountId, connectionId);

				// The lock order of banking-invariants.md: the owner's account row, as account deletion takes it; the
				// imported-files connection, created here when the removal moves accounts to it, as history writes and
				// authorization take it; pending reauthorizations; then the connection. Callback persistence uses the
				// same order, so deletion and callback cannot deadlock or recreate the connection.
				await manager.query('SELECT "id" FROM "accounts" WHERE "id" = $1 FOR UPDATE', [accountId]);
				const movesAccounts =
					keepsAccounts(candidateConnection, removal) &&
					(await bankAccountRepository.count({
						where: {bankConnection: {id: candidateConnection.id, accountId}},
					})) > 0;
				const fileConnection = movesAccounts
					? await lockFileConnection(manager, accountId)
					: await lockExistingFileConnection(manager, accountId);
				const pendingConnections = await connectionRepository.find({
					where: {
						account: {id: accountId},
						provider: candidateConnection.provider,
						aspspName: candidateConnection.aspspName,
						aspspCountry: candidateConnection.aspspCountry,
						status: BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION,
					},
					order: {id: 'ASC'},
					lock: {mode: 'pessimistic_write'},
				});
				const connection = await connectionRepository.findOne({
					where: {id: connectionId, account: {id: accountId}},
					lock: {mode: 'pessimistic_write'},
				});

				if (!connection) throw new NotFoundException(BANKING_CONNECTION_NOT_FOUND);
				const isDestructive = await this.assertRemovable(connection, removal, bankAccountRepository);

				if (isDestructive) {
					const pendingConnectionIds = pendingConnections.map((pendingConnection) => pendingConnection.id);
					authorizationConnectionIdsToClean = [connectionId, ...pendingConnectionIds];
					if (pendingConnectionIds.length > 0) {
						await connectionRepository.update(
							{id: In(pendingConnectionIds), status: BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION},
							{status: BANK_CONNECTION_STATUSES.CANCELLED, authorizationStateHash: null},
						);
					}
				}

				// Its import records go with it, and with them closing balances imported-files accounts may anchor on.
				const anchored = await this.fileAccountBalanceService.findAnchoredByConnection(
					manager,
					accountId,
					connection.id,
				);
				const kept =
					isDestructive && keepsAccounts(connection, removal)
						? await this.moveAccountsToFileConnection(manager, accountId, connection, fileConnection)
						: [];
				await connectionRepository.remove(connection);
				await this.fileAccountBalanceService.recomputeAll(manager, accountId, [
					...new Set([...anchored, ...kept]),
				]);
				connectionLock.assertHealthy();
			});
			deletionCommitted = true;
		} finally {
			if (deletionCommitted) {
				try {
					await this.authorizationStateService.removeForConnections(authorizationConnectionIdsToClean);
				} catch (error) {
					this.logger.warn(`Banking authorization cleanup failed: ${safeErrorCode(error)}`);
				}
			}

			await releaseLockSafely(connectionLock, this.logger, 'Banking synchronization lock release failed');
		}

		await this.derivedDataRefresh.refresh(accountId, {kind: 'removal'});
	}

	/**
	 * Moves the connection's accounts, their history and its import records onto the owner's imported-files
	 * connection, in the removal's transaction; returns the moved account ids. Each account keeps its bank
	 * identification hash, so authorizing the same bank again picks it up, and takes the imported-files identity of
	 * its IBAN unless another imported-files account holds it, so a statement with that IBAN goes to it, and records the
	 * connection's bank, so its exchanges pair only with legs of the same bank there. The bank's
	 * last reported balance becomes its stated balance, dated the day the bank reported it. Its bank balance reports
	 * go with the connection's sync runs.
	 */
	private async moveAccountsToFileConnection(
		manager: EntityManager,
		ownerId: Account['id'],
		connection: BankConnection,
		/** The owner's imported-files connection, created and locked by the removal before the connection. */
		fileConnection: BankConnection | null,
	): Promise<BankAccount['id'][]> {
		const bankAccountRepository = manager.getRepository(BankAccount);
		const accounts = await bankAccountRepository.find({
			where: {bankConnection: {id: connection.id}},
			order: {id: 'ASC'},
		});
		if (accounts.length === 0) return [];
		// Only a deletion of the whole Tempo account committing before the removal locked it gets here.
		if (!fileConnection) throw new NotFoundException(BANKING_CONNECTION_NOT_FOUND);
		const owner = await manager.getRepository(Account).findOneOrFail({
			select: {id: true, timeZone: true},
			where: {id: ownerId},
		});
		const fileAccounts = await bankAccountRepository.find({
			select: {id: true, providerAccountId: true},
			where: {bankConnection: {id: fileConnection.id}},
		});
		const takenIds = new Set(fileAccounts.map(({providerAccountId}) => providerAccountId));
		for (const account of accounts) {
			const iban = account.iban?.replace(/\s+/g, '').toUpperCase();
			const fileId = iban ? fileAccountProviderId(iban, account.currency) : null;
			const providerAccountId = fileId && !takenIds.has(fileId) ? fileId : account.providerAccountId;
			takenIds.add(providerAccountId);
			const reported = account.currentBalanceAmount !== null && account.balanceUpdatedAt !== null;
			await bankAccountRepository
				.createQueryBuilder()
				.update()
				.set({
					bankConnection: {id: fileConnection.id},
					providerAccountId,
					bankIdentity: nameBankIdentity(connection.aspspName),
					bankIdentityImportId: null,
					statedBalanceAmount: reported ? account.currentBalanceAmount : null,
					statedBalanceDate: reported ? dateInTimeZone(account.balanceUpdatedAt!, owner.timeZone) : null,
				})
				.where('"id" = :id', {id: account.id})
				.andWhere(
					'"bankConnectionId" IN (SELECT "id" FROM "bank_connections" WHERE "id" = :connectionId AND "accountId" = :ownerId)',
					{connectionId: connection.id, ownerId},
				)
				.execute();
		}
		const ids = accounts.map(({id}) => id);
		await this.importedRowRecords.records.moveToConnection(manager, ownerId, connection.id, fileConnection.id);
		return ids;
	}

	/** Refuses a removal the connection's status or the confirmation does not allow; returns whether it is destructive. */
	private async assertRemovable(
		connection: BankConnection,
		{confirmation, keepAccounts}: BankConnectionRemoveRequest,
		bankAccountRepository: Repository<BankAccount>,
	): Promise<boolean> {
		const isDestructive = DESTRUCTIVE_CONNECTION_STATUSES.includes(
			connection.status as (typeof DESTRUCTIVE_CONNECTION_STATUSES)[number],
		);
		if (
			!REMOVABLE_CONNECTION_STATUSES.includes(connection.status as (typeof REMOVABLE_CONNECTION_STATUSES)[number])
		) {
			throw new ConflictException(BANKING_CONNECTION_NOT_REMOVABLE);
		}
		if (isDestructive && !keepsAccounts(connection, {keepAccounts}) && confirmation !== 'DELETE') {
			throw new BadRequestException(BANKING_CONNECTION_REMOVAL_CONFIRMATION_REQUIRED);
		}
		if (!isDestructive && (await bankAccountRepository.count({where: {bankConnection: {id: connection.id}}})) > 0) {
			throw new ConflictException(BANKING_CONNECTION_NOT_REMOVABLE);
		}
		return isDestructive;
	}
}
