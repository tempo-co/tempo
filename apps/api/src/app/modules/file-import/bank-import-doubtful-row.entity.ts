import type {BankImportDoubtfulDecision} from '@wisp/contracts';
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
import type {OwnTransferOverride} from '@modules/banking/own-transfer/own-transfer-detection';

import {BankImport} from './bank-import.entity';
import {NormalizedRow} from './parsers/parse-result';

/**
 * What a stored row of an import is: `doubtful`, a question for the owner; `not_in_bank`, a file row on a day bank
 * sync is final for that sync never sent, kept out of history and offered to add; `removed_by_sync`, a row of the
 * import a later sync removed from such a day, offered to add back.
 */
export const BANK_IMPORT_ROW_KINDS = ['doubtful', 'not_in_bank', 'removed_by_sync'] as const;
export type BankImportRowKind = (typeof BANK_IMPORT_ROW_KINDS)[number];

/** The kinds the owner can add: rows the bank never sent. */
export const BANK_IMPORT_NEVER_SENT_ROW_KINDS = [
	'not_in_bank',
	'removed_by_sync',
] as const satisfies readonly BankImportRowKind[];

/** The owner's choices on a row sync removed, restored when it is added back; older rows lack `leftOutOfTotals`. */
export type BankImportRowOwnerEdits = {
	category: string | null;
	ownTransferOverride: OwnTransferOverride | null;
	leftOutOfTotals?: boolean;
};

/**
 * A row of an import kept beside history (`kind`). A `doubtful` row is a question for the owner: usually a file row
 * the duplicate ladder could not decide, held out of `bank_transactions` until the owner answers. When
 * `importedTransactionId` is set, the import's row is already in history and a sync later delivered look-alikes it
 * may be (the candidates). A `not_in_bank` or `removed_by_sync` row is resolved `new` when the owner adds it, with
 * the row it became, which bank sync then never removes.
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

	@Column({type: 'varchar', length: 16, default: 'doubtful'})
	kind: BankImportRowKind;

	/** The parsed row, as it would be written. */
	@Column({type: 'jsonb'})
	row: NormalizedRow;

	@Column({type: 'uuid', array: true})
	candidateTransactionIds: string[];

	/** A `removed_by_sync` row's manual category and own-transfer choice; null when it had neither. */
	@Column({type: 'jsonb', nullable: true})
	ownerEdits: BankImportRowOwnerEdits | null;

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
