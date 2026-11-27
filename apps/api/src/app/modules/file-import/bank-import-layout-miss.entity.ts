import type {BankImportErrorCode} from '@wisp/contracts';
import {Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';

import {Account} from '@modules/account/account.entity';

/**
 * Where a file of a verified bank went instead of one of that bank's own readers: the column mapper, the owner's
 * saved layout, a built-in reader of another bank or format, or a refusal.
 */
export const LAYOUT_MISS_OUTCOMES = ['mapper', 'saved_layout', 'other_reader', 'refused'] as const;
export type LayoutMissOutcome = (typeof LAYOUT_MISS_OUTCOMES)[number];

/**
 * A request naming a verified bank whose file none of that bank's readers read. It keeps the bank, the outcome and
 * the time; nothing of the file.
 */
@Entity('bank_import_layout_misses')
@Index('idx_bank_import_layout_misses_account_created', ['accountId', 'createdAt'])
@Index('idx_bank_import_layout_misses_bank_created', ['bankId', 'createdAt'])
export class BankImportLayoutMiss {
	@PrimaryGeneratedColumn('uuid', {primaryKeyConstraintName: 'pk_bank_import_layout_misses'})
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId', foreignKeyConstraintName: 'fk_bank_import_layout_misses_account'})
	account?: Account;

	/** A verified bank of `BANK_LIST`. */
	@Column({type: 'varchar', length: 64})
	bankId: string;

	@Column({type: 'varchar', length: 16})
	outcome: LayoutMissOutcome;

	/** The refusal's code, for a refused upload or a column mapper that refused; null otherwise. */
	@Column({type: 'varchar', length: 32, nullable: true})
	refusalCode: BankImportErrorCode | null;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;
}
