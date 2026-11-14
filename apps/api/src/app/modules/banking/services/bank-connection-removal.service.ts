import {BadRequestException, ConflictException, Injectable, Logger, NotFoundException} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {DataSource, In, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {
	BANKING_CONNECTION_NOT_FOUND,
	BANKING_CONNECTION_NOT_REMOVABLE,
	BANKING_CONNECTION_REMOVAL_CONFIRMATION_REQUIRED,
} from '../api/constants/banking-messages.constants';
import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {releaseLockSafely, safeErrorCode} from './bank-connection.utils';
import {BankingAuthorizationStateService} from './banking-authorization-state.service';
import {BankingConnectionLockService} from './banking-connection-lock.service';
import {BankingConsentRevocationService} from './banking-consent-revocation.service';
import {BANK_CONNECTION_STATUSES, DESTRUCTIVE_CONNECTION_STATUSES} from './banking-sync.constants';
import {findOwnedConnection} from './find-owned-connection';
import {OwnTransferService} from './own-transfer.service';
import {ReportingCurrencyService} from './reporting-currency.service';

const REMOVABLE_CONNECTION_STATUSES = [
	BANK_CONNECTION_STATUSES.PENDING_AUTHORIZATION,
	BANK_CONNECTION_STATUSES.CANCELLED,
	BANK_CONNECTION_STATUSES.FAILED,
	...DESTRUCTIVE_CONNECTION_STATUSES,
] as const;

/** Removes an owner's bank connection: revokes its consent, deletes it and cleans its pending authorizations. */
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
		private readonly ownTransferService: OwnTransferService,
		private readonly consentRevocationService: BankingConsentRevocationService,
		private readonly reportingCurrencyService: ReportingCurrencyService,
	) {}

	async removeConnection(
		accountId: Account['id'],
		connectionId: BankConnection['id'],
		confirmation?: string,
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
			await this.assertRemovable(connectionToRevoke, confirmation, this.bankAccountRepository);
			await this.consentRevocationService.revokeSessions([connectionToRevoke]);
			connectionLock.assertHealthy();

			await this.dataSource.transaction(async (manager) => {
				connectionLock.assertHealthy();
				const connectionRepository = manager.getRepository(BankConnection);
				const bankAccountRepository = manager.getRepository(BankAccount);
				const candidateConnection = await findOwnedConnection(connectionRepository, accountId, connectionId);

				// Lock pending reauthorizations before the existing connection. Callback persistence uses
				// the same order, so deletion and callback cannot deadlock or recreate the connection.
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
				const isDestructive = await this.assertRemovable(connection, confirmation, bankAccountRepository);

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

				await connectionRepository.remove(connection);
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

		// Remaining legs whose counterpart was deleted become one-sided or unlabelled.
		await this.ownTransferService.recomputeForOwnerSafely(accountId);
		// Removing every account in other currencies leaves one an owner without a currency can use right away.
		await this.reportingCurrencyService.reconcileSafely(accountId, {historySettled: false});
	}

	/** Refuses a removal the connection's status or the confirmation does not allow; returns whether it is destructive. */
	private async assertRemovable(
		connection: BankConnection,
		confirmation: string | undefined,
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
		if (isDestructive && confirmation !== 'DELETE') {
			throw new BadRequestException(BANKING_CONNECTION_REMOVAL_CONFIRMATION_REQUIRED);
		}
		if (!isDestructive && (await bankAccountRepository.count({where: {bankConnection: {id: connection.id}}})) > 0) {
			throw new ConflictException(BANKING_CONNECTION_NOT_REMOVABLE);
		}
		return isDestructive;
	}
}
