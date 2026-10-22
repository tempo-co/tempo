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

import {MerchantLogo} from './merchant-logo.entity';

export const MERCHANT_STATUSES = {PENDING: 'PENDING', IDENTIFIED: 'IDENTIFIED', NONE: 'NONE'} as const;
export type MerchantStatus = (typeof MERCHANT_STATUSES)[keyof typeof MERCHANT_STATUSES];

/**
 * One merchant of an owner, keyed by the transactions' merchant key without its direction, so a purchase and its
 * refund share it. Display-only: categories, merchant keys and recurring payments never read it.
 */
@Entity('merchants')
@Index('idx_merchants_account_key', ['accountId', 'key'], {unique: true})
export class Merchant {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId'})
	account: Account;

	@Column({type: 'text'})
	key: string;

	/** PENDING until identified; NONE for people, payment processors and merchants the model could not name. */
	@Column({type: 'varchar', length: 16, default: 'PENDING'})
	status: MerchantStatus;

	@Column({type: 'varchar', length: 120, nullable: true})
	brand: string | null;

	/** The official website hostname the model named; a logo is shown only after the site confirms the brand. */
	@Column({type: 'varchar', length: 253, nullable: true})
	domain: string | null;

	@Column({type: 'uuid', nullable: true})
	logoId: string | null;

	@ManyToOne(() => MerchantLogo, {onDelete: 'SET NULL', nullable: true})
	@JoinColumn({name: 'logoId'})
	logo: MerchantLogo | null;

	@Column({type: 'int', default: 0})
	attempts: number;

	@Column({type: 'timestamptz', nullable: true})
	retryAfter: Date | null;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
