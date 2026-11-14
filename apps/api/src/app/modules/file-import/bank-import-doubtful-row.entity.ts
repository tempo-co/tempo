import type {BankImportDoubtfulDecision} from '@tempo/contracts';
import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';

import {BankImport} from './bank-import.entity';
import {NormalizedRow} from './parsers/parse-result';

/**
 * A question for the owner about one of an import's rows. Usually a file row the duplicate ladder could not decide,
 * held out of `bank_transactions` until the owner answers. When `importedTransactionId` is set, the import's row is
 * already in history and a sync later delivered look-alikes it may be (the candidates).
 */
@Entity('bank_import_doubtful_rows')
@Index('idx_bank_import_doubtful_rows_import', ['importId'])
@Index('idx_bank_import_doubtful_rows_imported_transaction', ['importedTransactionId'])
export class BankImportDoubtfulRow {
	@PrimaryGeneratedColumn('uuid', {primaryKeyConstraintName: 'pk_bank_import_doubtful_rows'})
	id: string;

	@Column({type: 'uuid'})
	importId: string;

	@ManyToOne(() => BankImport, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'importId', foreignKeyConstraintName: 'fk_bank_import_doubtful_rows_import'})
	bankImport?: BankImport;

	@Column({type: 'uuid'})
	bankAccountId: string;

	@ManyToOne(() => BankAccount, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'bankAccountId', foreignKeyConstraintName: 'fk_bank_import_doubtful_rows_bank_account'})
	bankAccount?: BankAccount;

	/** The parsed row, as it would be written. */
	@Column({type: 'jsonb'})
	row: NormalizedRow;

	@Column({type: 'uuid', array: true})
	candidateTransactionIds: string[];

	/** The import's row in history this question is about; null for a row held out of history. */
	@Column({type: 'uuid', nullable: true})
	importedTransactionId: string | null;

	@ManyToOne(() => BankTransaction, {onDelete: 'CASCADE', nullable: true})
	@JoinColumn({
		name: 'importedTransactionId',
		foreignKeyConstraintName: 'fk_bank_import_doubtful_rows_imported_transaction',
	})
	importedTransaction?: BankTransaction | null;

	/** Null while open. */
	@Column({type: 'varchar', length: 16, nullable: true})
	resolution: BankImportDoubtfulDecision | null;

	/** The row added for `new`, or the candidate chosen for `duplicate`. */
	@Column({type: 'uuid', nullable: true})
	resolvedTransactionId: string | null;

	@ManyToOne(() => BankTransaction, {onDelete: 'SET NULL', nullable: true})
	@JoinColumn({
		name: 'resolvedTransactionId',
		foreignKeyConstraintName: 'fk_bank_import_doubtful_rows_resolved_transaction',
	})
	resolvedTransaction?: BankTransaction | null;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
