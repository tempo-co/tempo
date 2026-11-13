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

import {Account} from '@modules/account/account.entity';

import type {CsvLayout} from './parsers/csv-layout';

export const LAYOUT_PROPOSAL_STATUSES = ['proposed', 'confirmed', 'rejected', 'failed'] as const;
export type LayoutProposalStatus = (typeof LAYOUT_PROPOSAL_STATUSES)[number];

/**
 * One request to work out a file's columns, counted against the owner's daily limit whatever its outcome. It holds
 * the file's hash, header cells and masked column shapes, never a row's content; the preview is not stored.
 */
@Entity('bank_import_layout_proposals')
@Index('idx_bank_import_layout_proposals_account_created', ['accountId', 'createdAt'])
export class BankImportLayoutProposal {
	@PrimaryGeneratedColumn('uuid', {primaryKeyConstraintName: 'pk_bank_import_layout_proposals'})
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId', foreignKeyConstraintName: 'fk_bank_import_layout_proposals_account'})
	account?: Account;

	/** sha256 hex of the file. */
	@Column({type: 'varchar', length: 64})
	fileHash: string;

	/** `proposed` while the model runs and once a layout reads the file; `failed` with `failureCode` otherwise. */
	@Column({type: 'varchar', length: 16})
	status: LayoutProposalStatus;

	@Column({type: 'varchar', length: 32, nullable: true})
	failureCode: string | null;

	/** The header's cells; null when the table has none or none was found. */
	@Column({type: 'jsonb', nullable: true})
	headerCells: string[] | null;

	/** Each column's first value with letters and digits masked. */
	@Column({type: 'jsonb', nullable: true})
	columnShapes: string[] | null;

	/** The layout once it read the whole file; its currency is fixed by the owner on confirmation when needed. */
	@Column({type: 'jsonb', nullable: true})
	layout: CsvLayout | null;

	/** The file states no currency, so confirming needs one. */
	@Column({type: 'boolean', default: false})
	currencyNeeded: boolean;

	@Column({type: 'timestamptz'})
	expiresAt: Date;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
