import {Injectable} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import type {
	BankAccountBalanceSource,
	BankAccount as BankAccountResponse,
	BankConnection as BankConnectionResponse,
	BankConnectionStatus,
	BankSyncStatus,
} from '@tempo/contracts';
import {DataSource, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankAccountBalance} from '../bank-account-balance.entity';
import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {bankLogoReference} from '../bank-logos/bank-logo-reference';
import {BankSyncRun} from '../bank-sync-run.entity';
import {selectPreferredBalance} from '../banking.utils';
import {type ReportingOwner, totalsCurrency} from '../reporting-currency';
import {convertEcbAmountSql, newestEcbRatePairSql} from './bank-transaction-amount-conversion.utils';
import {BANK_CONNECTION_PROVIDERS, BANK_SYNC_STATUSES} from './banking-sync.constants';
import {FileAccountBalanceService} from './file-account-balance.service';

type ConvertedBalance = {amount: string; rateDate: string | null};

/** Reads an owner's bank connections with their accounts, latest balances and sync history for the API. */
@Injectable()
export class BankConnectionQueryService {
	constructor(
		@InjectRepository(BankConnection)
		private readonly bankConnectionRepository: Repository<BankConnection>,
		@InjectRepository(BankAccount)
		private readonly bankAccountRepository: Repository<BankAccount>,
		@InjectRepository(BankAccountBalance)
		private readonly bankAccountBalanceRepository: Repository<BankAccountBalance>,
		private readonly dataSource: DataSource,
		private readonly fileAccountBalanceService: FileAccountBalanceService,
	) {}

	async findAll(owner: ReportingOwner): Promise<BankConnectionResponse[]> {
		const {id: accountId} = owner;
		const baseCurrency = totalsCurrency(owner);
		const connections = await this.bankConnectionRepository
			.createQueryBuilder('connection')
			.where('connection.accountId = :accountId', {accountId})
			.orderBy('connection.createdAt', 'DESC')
			.getMany();

		if (connections.length === 0) {
			return [];
		}

		const connectionIds = connections.map(({id}) => id);
		const bankAccounts = await this.bankAccountRepository
			.createQueryBuilder('bankAccount')
			.innerJoin('bankAccount.bankConnection', 'bankConnection')
			.addSelect('bankConnection.id')
			.where('bankConnection.id IN (:...connectionIds)', {connectionIds})
			.andWhere('bankConnection.accountId = :accountId', {accountId})
			.orderBy('bankAccount.createdAt', 'ASC')
			.getMany();
		const providers = new Map(connections.map(({id, provider}) => [id, provider]));
		const [latestBalancesByAccountId, convertedBalances, lastSuccessfulSyncAtByConnectionId, balanceSources] =
			await Promise.all([
				this.findLatestBalancesByAccountId(
					accountId,
					bankAccounts.map(({id}) => id),
				),
				this.convertBalances(bankAccounts, baseCurrency),
				this.findLastSuccessfulSyncAt(accountId, connectionIds),
				this.fileAccountBalanceService.findBalanceSources(
					this.dataSource.manager,
					bankAccounts.map((bankAccount) => ({
						...bankAccount,
						provider: providers.get(bankAccount.bankConnection.id)!,
					})),
				),
			]);
		const bankAccountsByConnectionId = new Map<string, BankAccount[]>();
		for (const bankAccount of bankAccounts) {
			const connectionAccounts = bankAccountsByConnectionId.get(bankAccount.bankConnection.id) ?? [];
			connectionAccounts.push(bankAccount);
			bankAccountsByConnectionId.set(bankAccount.bankConnection.id, connectionAccounts);
		}

		return connections.map((connection) => ({
			id: connection.id,
			provider: connection.provider,
			aspspName: connection.aspspName,
			aspspCountry: connection.aspspCountry,
			...(connection.provider === BANK_CONNECTION_PROVIDERS.ENABLE_BANKING
				? {logo: bankLogoReference(connection.aspspName, connection.aspspCountry)}
				: {}),
			// Written only from BANK_CONNECTION_STATUSES.
			status: connection.status as BankConnectionStatus,
			consentValidUntil: connection.consentValidUntil?.toISOString() ?? null,
			lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
			lastSuccessfulSyncAt: lastSuccessfulSyncAtByConnectionId.get(connection.id)?.toISOString() ?? null,
			createdAt: connection.createdAt.toISOString(),
			lastSyncError: connection.lastSyncError,
			nextSyncAt: connection.nextSyncAt?.toISOString() ?? null,
			// Written only from BANK_SYNC_STATUSES.
			syncStatus: connection.syncStatus as BankSyncStatus,
			baseCurrency,
			bankAccounts: (bankAccountsByConnectionId.get(connection.id) ?? []).map((bankAccount) =>
				this.toBankAccountResponse(
					bankAccount,
					latestBalancesByAccountId.get(bankAccount.id) ?? [],
					convertedBalances.get(bankAccount.id),
					balanceSources.get(bankAccount.id) ?? null,
				),
			),
		}));
	}

	/** One account of the owner's connection as `findAll` describes it; null when it is not theirs. */
	async findAccount(
		owner: ReportingOwner,
		connectionId: BankConnection['id'],
		bankAccountId: BankAccount['id'],
	): Promise<BankAccountResponse | null> {
		const connections = await this.findAll(owner);
		const connection = connections.find(({id}) => id === connectionId);
		return connection?.bankAccounts.find(({id}) => id === bankAccountId) ?? null;
	}

	/** `lastSyncedAt` also advances for partial runs, so the last fully successful run is read from the run history. */
	private async findLastSuccessfulSyncAt(
		accountId: Account['id'],
		connectionIds: string[],
	): Promise<Map<string, Date>> {
		const rows = await this.dataSource
			.getRepository(BankSyncRun)
			.createQueryBuilder('run')
			.innerJoin('run.bankConnection', 'bankConnection')
			.select('run.bankConnectionId', 'connectionId')
			.addSelect('MAX(run.finishedAt)', 'lastSuccessfulSyncAt')
			.where('run.bankConnectionId IN (:...connectionIds)', {connectionIds})
			.andWhere('bankConnection.accountId = :accountId', {accountId})
			.andWhere('run.status = :status', {status: BANK_SYNC_STATUSES.SUCCEEDED})
			.groupBy('run.bankConnectionId')
			.getRawMany<{connectionId: string; lastSuccessfulSyncAt: Date | null}>();
		return new Map(
			rows.flatMap(({connectionId, lastSuccessfulSyncAt}) =>
				lastSuccessfulSyncAt ? [[connectionId, lastSuccessfulSyncAt] as const] : [],
			),
		);
	}

	private async findLatestBalancesByAccountId(
		accountId: Account['id'],
		bankAccountIds: string[],
	): Promise<Map<string, BankAccountBalance[]>> {
		const latestBalancesByAccountId = new Map<string, BankAccountBalance[]>();
		if (bankAccountIds.length === 0) {
			return latestBalancesByAccountId;
		}

		const latestBalances = await this.bankAccountBalanceRepository
			.createQueryBuilder('balance')
			.innerJoin('balance.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'bankConnection')
			.distinctOn(['balance.bankAccountId', 'balance.balanceType'])
			.where('balance.bankAccountId IN (:...bankAccountIds)', {bankAccountIds})
			.andWhere('bankConnection.accountId = :accountId', {accountId})
			.orderBy('balance.bankAccountId', 'ASC')
			.addOrderBy('balance.balanceType', 'ASC')
			.addOrderBy('balance.observedAt', 'DESC')
			.addOrderBy('balance.id', 'DESC')
			.getMany();
		for (const balance of latestBalances) {
			const accountBalances = latestBalancesByAccountId.get(balance.bankAccountId) ?? [];
			accountBalances.push(balance);
			latestBalancesByAccountId.set(balance.bankAccountId, accountBalances);
		}

		return latestBalancesByAccountId;
	}

	/**
	 * Converts current balances with the newest stored ECB rates up to today, at a date both currencies were
	 * published. Approximate by design: unlike transactions, a balance has no single historical date.
	 */
	private async convertBalances(
		bankAccounts: BankAccount[],
		baseCurrency: string | null,
	): Promise<Map<string, ConvertedBalance>> {
		const converted = new Map<string, ConvertedBalance>();
		const balances = bankAccounts.filter(({currentBalanceAmount}) => currentBalanceAmount !== null);
		if (!baseCurrency || balances.length === 0) return converted;

		const rows: Array<{id: string; amount: string | null; rateDate: string | null}> = await this.dataSource.query(
			`
			SELECT input."id",
				CASE
					WHEN input."currency" = $4 THEN ROUND(input."amount", 2)
					ELSE ${convertEcbAmountSql('input."amount"', 'rate."source"', 'rate."base"')}
				END::text AS "amount",
				CASE WHEN input."currency" <> $4 THEN to_char(rate."rateDate", 'YYYY-MM-DD') END AS "rateDate"
			FROM unnest($1::uuid[], $2::varchar[], $3::numeric[]) AS input("id", "currency", "amount")
			-- CURRENT_DATE follows the session time zone; just after midnight that may pick yesterday's rate.
			LEFT JOIN LATERAL (${newestEcbRatePairSql('input."currency"', '$4::varchar', 'CURRENT_DATE')}) rate ON TRUE`,
			[
				balances.map(({id}) => id),
				balances.map(({currency}) => currency),
				balances.map(({currentBalanceAmount}) => currentBalanceAmount),
				baseCurrency,
			],
		);
		for (const {id, amount, rateDate} of rows) if (amount !== null) converted.set(id, {amount, rateDate});
		return converted;
	}

	private toBankAccountResponse(
		account: BankAccount,
		latestBalances: BankAccountBalance[],
		convertedBalance: ConvertedBalance | undefined,
		balanceSource: BankAccountBalanceSource | null,
	): BankAccountResponse {
		const primaryBalance = selectPreferredBalance(latestBalances);

		return {
			id: account.id,
			name: account.name,
			details: account.details,
			alias: account.alias,
			currency: account.currency,
			cashAccountType: account.cashAccountType,
			usage: account.usage,
			maskedIdentifier: account.maskedIdentifier,
			currentBalanceAmount: account.currentBalanceAmount,
			currentBalanceType: account.currentBalanceType,
			currentBalanceInBaseCurrency: convertedBalance?.amount ?? null,
			baseCurrencyRateDate: convertedBalance?.rateDate ?? null,
			balanceUpdatedAt: account.balanceUpdatedAt?.toISOString() ?? null,
			balanceSource,
			isActive: account.isActive,
			latestBalances: latestBalances.map((balance) => ({
				name: balance.name,
				balanceType: balance.balanceType,
				amount: balance.amount,
				currency: balance.currency,
				lastChangeDateTime: balance.lastChangeDateTime?.toISOString() ?? null,
				referenceDate: balance.referenceDate,
				observedAt: balance.observedAt.toISOString(),
				isPrimary: primaryBalance?.id === balance.id,
			})),
		};
	}
}
