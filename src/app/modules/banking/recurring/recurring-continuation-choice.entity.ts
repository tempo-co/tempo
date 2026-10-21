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

export const RECURRING_CONTINUATION_CHOICES = ['LINKED', 'SEPARATE'] as const;
export type RecurringContinuationChoiceValue = (typeof RECURRING_CONTINUATION_CHOICES)[number];

/**
 * The owner's answer to whether a later recurring history continues an earlier one. It records the payments of both
 * histories when answered, so the answer follows them as the histories change. It never references or changes
 * transactions.
 */
@Entity('recurring_continuation_choices')
export class RecurringContinuationChoice {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId'})
	account: Account;

	@Column({type: 'varchar', length: 16})
	choice: RecurringContinuationChoiceValue;

	@Column({type: 'uuid', array: true})
	olderTransactionIds: string[];

	@Column({type: 'uuid', array: true})
	newerTransactionIds: string[];

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
