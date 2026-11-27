import type {BankRequestFileType} from '@wisp/contracts';
import {Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';

import {Account} from '@modules/account/account.entity';

/** A user's "Tell us your bank" request for a bank Wisp does not read yet. The name is plain text as typed. */
@Entity('bank_requests')
@Index('idx_bank_requests_account_created', ['accountId', 'createdAt'])
export class BankRequest {
	@PrimaryGeneratedColumn('uuid', {primaryKeyConstraintName: 'pk_bank_requests'})
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId', foreignKeyConstraintName: 'fk_bank_requests_account'})
	account?: Account;

	@Column({type: 'varchar', length: 60})
	bankName: string;

	/** ISO 3166-1 alpha-2. */
	@Column({type: 'varchar', length: 2})
	country: string;

	@Column({type: 'jsonb'})
	fileTypes: BankRequestFileType[];

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;
}
