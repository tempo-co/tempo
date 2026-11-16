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
 * balance trend rebuilds history from it like a synced account's. The anchor is the newest balance the account's
 * files state: an unambiguous end-of-day balance of its stored rows (`findFileAnchor`) or a statement's closing
 * balance an import that is not undone recorded for it, the rows' on the same day. Without one it is the balance the
 * owner stated, dated the day they stated it.
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

	/**
	 * The imported-files accounts whose balance may anchor on a closing balance an import recorded under the
	 * connection states; removing the connection removes those imports, so the caller recomputes them after
	 * (`recomputeAll`), in the same transaction.
	 */
	async findAnchoredByConnection(
		manager: EntityManager,
		ownerId: Account['id'],
		connectionId: BankConnection['id'],
	): Promise<BankAccount['id'][]> {
		const rows: Array<{bankAccountId: string}> = await manager.query(
			`SELECT DISTINCT closing->>'bankAccountId' AS "bankAccountId"
			FROM "bank_imports" bank_import
			CROSS JOIN LATERAL jsonb_array_elements(bank_import."closingBalances") closing
			WHERE bank_import."bankConnectionId" = $1 AND bank_import."accountId" = $2`,
			[connectionId, ownerId],
		);
		return rows.map(({bankAccountId}) => bankAccountId);
	}

	/** Recomputes the given imported-files accounts under the owner's locked imported-files connection. */
	async recomputeAll(
		manager: EntityManager,
		ownerId: Account['id'],
		bankAccountIds: readonly BankAccount['id'][],
	): Promise<void> {
		if (bankAccountIds.length === 0) return;
		// Locked as an import and an undo lock it, so its rows stay as read.
		const connection = await manager.getRepository(BankConnection).findOne({
			where: {accountId: ownerId, provider: BANK_CONNECTION_PROVIDERS.FILE},
			lock: {mode: 'pessimistic_write'},
		});
		if (!connection) return;
		for (const id of bankAccountIds) await this.recompute(manager, ownerId, id);
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

	/**
	 * The account's file anchor: the newer of its rows' (`findRowAnchor`) and the newest closing balance its imports
	 * that are not undone recorded, the rows' on the same day.
	 */
	private async findFileAnchor(manager: EntityManager, bankAccountId: BankAccount['id']): Promise<FileAnchor | null> {
		const rowAnchor = await this.findRowAnchor(manager, bankAccountId);
		// Joined through the account's own connection, so only its owner's imports count.
		const [statement]: FileAnchor[] = await manager.query(
			`SELECT closing->>'date' AS "date", closing->>'amount' AS "amount"
			FROM "bank_accounts" bank_account
			JOIN "bank_connections" connection ON connection."id" = bank_account."bankConnectionId"
			JOIN "bank_imports" bank_import ON bank_import."accountId" = connection."accountId"
				AND bank_import."undoneAt" IS NULL
			CROSS JOIN LATERAL jsonb_array_elements(bank_import."closingBalances") closing
			WHERE bank_account."id" = $1 AND closing->>'bankAccountId' = $1::text
			ORDER BY closing->>'date' DESC, bank_import."createdAt" DESC
			LIMIT 1`,
			[bankAccountId],
		);
		if (!statement) return rowAnchor;
		return rowAnchor && rowAnchor.date >= statement.date ? rowAnchor : statement;
	}

	/** The anchor of the account's rows, from those of its newest `FILE_ANCHOR_MAX_DAYS` booking days with balances. */
	private async findRowAnchor(manager: EntityManager, bankAccountId: BankAccount['id']): Promise<FileAnchor | null> {
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
