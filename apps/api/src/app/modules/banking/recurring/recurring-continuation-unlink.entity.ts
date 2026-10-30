import {
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

import {Account} from '@modules/account/account.entity';

/**
 * The owner unlinked a later recurring history from the earlier one it was joined with. It records the payments of
 * both histories when unlinked, so the answer follows them as the histories change. It never references or changes
 * transactions.
 */
@Entity('recurring_continuation_unlinks')
export class RecurringContinuationUnlink {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId'})
	account: Account;

	@Column({type: 'uuid', array: true})
	olderTransactionIds: string[];

	@Column({type: 'uuid', array: true})
	newerTransactionIds: string[];

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
