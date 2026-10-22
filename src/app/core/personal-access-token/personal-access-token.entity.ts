import {Exclude} from 'class-transformer';
import {Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';

import {Account} from '@modules/account/account.entity';

@Entity('personal_access_tokens')
export class PersonalAccessToken {
	@PrimaryGeneratedColumn('uuid', {primaryKeyConstraintName: 'pk_personal_access_tokens'})
	id: string;

	@Index('idx_personal_access_tokens_account')
	@Column('uuid')
	@Exclude()
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId', foreignKeyConstraintName: 'fk_personal_access_tokens_account'})
	@Exclude()
	account: Account;

	@Column({type: 'varchar', length: 100})
	name: string;

	@Index('idx_personal_access_tokens_token_hash', {unique: true})
	@Column({type: 'varchar', length: 64, select: false})
	@Exclude()
	tokenHash: string;

	@Column({type: 'varchar', length: 24})
	prefix: string;

	@Column({type: 'text', array: true, default: () => "ARRAY['read']::text[]"})
	scopes: string[];

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@Column({type: 'timestamptz', nullable: true})
	lastUsedAt: Date | null;

	@Column({type: 'timestamptz', nullable: true})
	@Exclude()
	revokedAt: Date | null;
}
