import {Injectable, NotFoundException} from '@nestjs/common';
import type {BankAccountBalanceSource} from '@tempo/contracts';
import {DataSource, EntityManager} from 'typeorm';

import {dateInTimeZone} from '@core/time/app-time-zone';
import {Account} from '@modules/account/account.entity';

import {BANKING_ACCOUNT_NOT_FOUND} from '../api/constants/banking-messages.constants';
import {BankAccount} from '../bank-account.entity';
import {BankConnection} from '../bank-connection.entity';
import {BalanceFromBankException} from '../errors/balance-from-bank.exception';
import {FILE_ANCHOR_MAX_DAYS, FileAnchor, StatedBalanceRow, findFileAnchor} from '../file-account-balance';
import {BANK_CONNECTION_PROVIDERS} from './banking-sync.constants';

/** The balance type of an imported-files account's balance: a closing balance, from the file or the owner. */
export const FILE_ACCOUNT_BALANCE_TYPE = 'CLBD';

type BalanceFields = Pick<BankAccount, 'currentBalanceAmount' | 'currentBalanceType' | 'balanceUpdatedAt'>;

/**
 * The balance of an account that exists only from imported files. It is the anchor amount plus every row booked
 * after the anchor's day, reported as of midnight UTC of the later of that day and the newest booking day, so the
 * balance trend rebuilds history from it like a synced account's. The anchor is the newest unambiguous end-of-day
 * balance the stored rows state (`findFileAnchor`), else the balance the owner stated, dated the day they stated it.
 */
@Injectable()
export class FileAccountBalanceService {
	constructor(private readonly dataSource: DataSource) {}

	/**
	 * Stores the balance the owner entered for an imported-files account, dated their today in their time zone, and
	 * recomputes the account's balance. Refuses an account of a bank connection: bank sync reports its balance.
	 */
	async setStatedBalance(
		owner: Pick<Account, 'id' | 'timeZone'>,
		connectionId: BankConnection['id'],
		bankAccountId: BankAccount['id'],
		amount: string,
	): Promise<void> {
		// Checked before any lock, so an account of a syncing bank is refused at once.
		const owned = await this.dataSource.getRepository(BankAccount).findOne({
			where: {id: bankAccountId, bankConnection: {id: connectionId, accountId: owner.id}},
			relations: {bankConnection: true},
		});
		if (!owned) throw new NotFoundException(BANKING_ACCOUNT_NOT_FOUND);
		if (owned.bankConnection.provider !== BANK_CONNECTION_PROVIDERS.FILE) throw new BalanceFromBankException();
		await this.dataSource.transaction(async (manager) => {
			// The imported-files connection is locked as an import and an undo lock it, so its rows stay as read.
			const connection = await manager.getRepository(BankConnection).findOne({
				where: {id: connectionId, accountId: owner.id, provider: BANK_CONNECTION_PROVIDERS.FILE},
				lock: {mode: 'pessimistic_write'},
			});
			const account =
				connection &&
				(await manager
					.getRepository(BankAccount)
					.findOne({where: {id: owned.id, bankConnection: {id: connection.id}}}));
			// Only an undo or a removal committing in between gets here.
			if (!account) throw new NotFoundException(BANKING_ACCOUNT_NOT_FOUND);
			await manager
				.getRepository(BankAccount)
				.update(
					{id: account.id},
					{statedBalanceAmount: amount, statedBalanceDate: dateInTimeZone(new Date(), owner.timeZone)},
				);
			await this.recompute(manager, owner.id, account.id);
		});
	}
	/**
	 * Recomputes an imported-files account's balance fields from its stored rows and stated balance, in the caller's
	 * transaction; returns them, or null (and changes nothing) for an account of another connection or none.
	 */
	async recompute(
		manager: EntityManager,
		ownerId: Account['id'],
		bankAccountId: BankAccount['id'],
	): Promise<BalanceFields | null> {
		const account = await manager.getRepository(BankAccount).findOne({
			where: {id: bankAccountId, bankConnection: {accountId: ownerId, provider: BANK_CONNECTION_PROVIDERS.FILE}},
		});
		if (!account) return null;
		const fileAnchor = await this.findFileAnchor(manager, account.id);
		const anchor: FileAnchor | null =
			fileAnchor ??
			(account.statedBalanceAmount !== null && account.statedBalanceDate !== null
				? {date: account.statedBalanceDate, amount: account.statedBalanceAmount}
				: null);
		const fields: BalanceFields = anchor
			? await this.balanceFrom(manager, account.id, anchor)
			: {currentBalanceAmount: null, currentBalanceType: null, balanceUpdatedAt: null};
		await manager.getRepository(BankAccount).update({id: account.id}, fields);
		return fields;
	}

	/** Where each account's balance comes from, for accounts the caller already scoped to their owner. */
	async findBalanceSources(
		manager: EntityManager,
		accounts: readonly (Pick<
			BankAccount,
			'id' | 'currentBalanceAmount' | 'statedBalanceAmount' | 'statedBalanceDate'
		> & {provider: string})[],
	): Promise<Map<BankAccount['id'], BankAccountBalanceSource | null>> {
		const sources = new Map<BankAccount['id'], BankAccountBalanceSource | null>();
		for (const account of accounts) {
			if (account.currentBalanceAmount === null) sources.set(account.id, null);
			else if (account.provider !== BANK_CONNECTION_PROVIDERS.FILE) sources.set(account.id, 'bank');
			else if (account.statedBalanceAmount === null || account.statedBalanceDate === null) {
				sources.set(account.id, 'file');
			} else {
				// A file anchor wins over a stated balance, so only an account with both needs its rows read.
				sources.set(account.id, (await this.findFileAnchor(manager, account.id)) ? 'file' : 'stated');
			}
		}
		return sources;
	}

	/** The account's file anchor, from the rows of its newest `FILE_ANCHOR_MAX_DAYS` booking days with balances. */
	private async findFileAnchor(manager: EntityManager, bankAccountId: BankAccount['id']): Promise<FileAnchor | null> {
		const rows: StatedBalanceRow[] = await manager.query(
			`SELECT to_char(t."bookingDate", 'YYYY-MM-DD') AS "bookingDate", t."amount"::text AS "amount",
				t."balanceAfterAmount"::text AS "balanceAfter"
			FROM "bank_transactions" t
			WHERE t."bankAccountId" = $1 AND t."balanceAfterAmount" IS NOT NULL AND t."bookingDate" IN (
				SELECT DISTINCT d."bookingDate" FROM "bank_transactions" d
				WHERE d."bankAccountId" = $1 AND d."balanceAfterAmount" IS NOT NULL AND d."bookingDate" IS NOT NULL
				ORDER BY d."bookingDate" DESC
				LIMIT $2
			)`,
			[bankAccountId, FILE_ANCHOR_MAX_DAYS],
		);
		return findFileAnchor(rows);
	}

	/** The anchor plus the rows booked after its day, summed exactly in PostgreSQL. */
	private async balanceFrom(
		manager: EntityManager,
		bankAccountId: BankAccount['id'],
		anchor: FileAnchor,
	): Promise<BalanceFields> {
		const [{amount, reported}]: Array<{amount: string; reported: string}> = await manager.query(
			`SELECT ($3::numeric + COALESCE(SUM(t."amount") FILTER (WHERE t."bookingDate" > $2::date), 0))::text AS "amount",
				to_char(GREATEST($2::date, MAX(t."bookingDate")), 'YYYY-MM-DD') AS "reported"
			FROM "bank_transactions" t
			WHERE t."bankAccountId" = $1`,
			[bankAccountId, anchor.date, anchor.amount],
		);
		return {
			currentBalanceAmount: amount,
			currentBalanceType: FILE_ACCOUNT_BALANCE_TYPE,
			balanceUpdatedAt: new Date(`${reported}T00:00:00.000Z`),
		};
	}
}
