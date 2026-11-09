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

/**
 * One browser's Web Push subscription. It belongs to the signed-in session that registered it: logging out removes it,
 * and delivery skips and removes it once that session no longer belongs to the owner.
 */
@Entity('push_subscriptions')
export class PushSubscription {
	@PrimaryGeneratedColumn('uuid', {primaryKeyConstraintName: 'pk_push_subscriptions'})
	id: string;

	@Index('idx_push_subscriptions_account')
	@Column('uuid')
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId', foreignKeyConstraintName: 'fk_push_subscriptions_account'})
	account: Account;

	/** The push service URL; a browser has one per subscription, so a new owner takes it over. */
	@Index('idx_push_subscriptions_endpoint', {unique: true})
	@Column({type: 'varchar', length: 2048})
	endpoint: string;

	@Column({type: 'varchar', length: 128})
	p256dh: string;

	@Column({type: 'varchar', length: 64})
	auth: string;

	@Index('idx_push_subscriptions_session')
	@Column({type: 'varchar', length: 128})
	sessionId: string;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
