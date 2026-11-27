import type {BankImportFormat, BankImportStatementGap} from '@wisp/contracts';
import {Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';

/** A closing balance an import's statements state for one account: a decimal string as of the end of `date`. */
export type BankImportClosingBalance = {bankAccountId: string; date: string; amount: string};

/** One drop of statement files. The files themselves are discarded after parsing; only this record is kept. */
@Entity('bank_imports')
@Index('idx_bank_imports_account_created', ['accountId', 'createdAt'])
@Index('idx_bank_imports_connection', ['bankConnectionId'])
export class BankImport {
	@PrimaryGeneratedColumn('uuid', {primaryKeyConstraintName: 'pk_bank_imports'})
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId', foreignKeyConstraintName: 'fk_bank_imports_account'})
	account?: Account;

	/**
	 * The synced connection the drop wrote to (a drop writes to one at most), otherwise the owner's imported-files
	 * connection. Removing that connection removes this import record too.
	 */
	@Column({type: 'uuid'})
	bankConnectionId: string;

	@ManyToOne(() => BankConnection, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'bankConnectionId', foreignKeyConstraintName: 'fk_bank_imports_connection'})
	bankConnection?: BankConnection;

	/** sha256 hex of the file, or of the sorted per-file hashes for a drop of several files. */
	@Column({type: 'varchar', length: 64})
	fileHash: string;

	@Column({type: 'varchar', length: 16})
	format: BankImportFormat;

	/** The bank the owner picked for the drop: a `BANK_LIST` id or `OTHER_BANK_ID`; null when they picked none. */
	@Column({type: 'varchar', length: 64, nullable: true})
	bankId: string | null;

	/** The known layout of a CSV-style file; null for standard formats. */
	@Column({type: 'varchar', length: 64, nullable: true})
	layout: string | null;

	@Column({type: 'integer'})
	filesCount: number;

	@Column({type: 'integer'})
	rowsParsed: number;

	@Column({type: 'integer'})
	rowsAdded: number;

	@Column({type: 'integer'})
	rowsAlreadyPresent: number;

	@Column({type: 'integer', default: 0})
	rowsMatchedByReference: number;

	@Column({type: 'integer', default: 0})
	rowsMatchedByBalance: number;

	/** Steps 3 and 4 of the ladder: same day, or the only candidate within three days. */
	@Column({type: 'integer', default: 0})
	rowsMatchedByDate: number;

	/** Doubtful rows still open. */
	@Column({type: 'integer', default: 0})
	rowsDoubtful: number;

	/** Rows on days bank sync is final for that it never sent, not added and still not added by the owner. */
	@Column({type: 'integer', default: 0})
	rowsNotInBank: number;

	/** Rows of the import a later sync removed from days it is final for, still not added back by the owner. */
	@Column({type: 'integer', default: 0})
	rowsRemovedBySync: number;

	@Column({type: 'date', nullable: true})
	dateFrom: string | null;

	@Column({type: 'date', nullable: true})
	dateTo: string | null;

	/** Every account the drop wrote to. */
	@Column({type: 'uuid', array: true})
	bankAccountIds: string[];

	/** The accounts the drop created. */
	@Column({type: 'uuid', array: true})
	createdBankAccountIds: string[];

	/**
	 * Per imported-files account, the newest closing balance the drop's statements state, dated the later of its day
	 * and its statement's last booking day. The account's balance may anchor on it until the import is undone.
	 */
	@Column({type: 'jsonb', default: () => `'[]'::jsonb`})
	closingBalances: BankImportClosingBalance[];

	/** Where a statement of the drop does not open at the closing balance of the one before it. */
	@Column({type: 'jsonb', default: () => `'[]'::jsonb`})
	statementGaps: BankImportStatementGap[];

	@Column({type: 'timestamptz', nullable: true})
	undoneAt: Date | null;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;
}
