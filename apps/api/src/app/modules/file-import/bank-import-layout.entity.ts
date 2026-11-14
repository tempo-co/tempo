import {Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import type {CsvLayout} from './parsers/csv-layout';

/** A layout an owner confirmed. Only that owner's drops are read with it, after every built-in reader. */
@Entity('bank_import_layouts')
@Index('idx_bank_import_layouts_account_created', ['accountId', 'createdAt'])
export class BankImportLayout {
	@PrimaryGeneratedColumn('uuid', {primaryKeyConstraintName: 'pk_bank_import_layouts'})
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId', foreignKeyConstraintName: 'fk_bank_import_layouts_account'})
	account?: Account;

	/** A `CsvLayout` whose id is `learned-<this row's id>` and whose bank is `bankName`; checked again on every load. */
	@Column({type: 'jsonb'})
	layout: CsvLayout;

	@Column({type: 'varchar', length: 60})
	bankName: string;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;
}

/** The id a saved layout's rows are recorded under (`BankImportSummary.layout`). */
export function savedLayoutId(rowId: string): string {
	return `learned-${rowId}`;
}
