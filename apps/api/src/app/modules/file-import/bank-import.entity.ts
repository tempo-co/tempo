import type {BankImportFormat} from '@tempo/contracts';
import {Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';

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

	@Column({type: 'timestamptz', nullable: true})
	undoneAt: Date | null;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;
}
