import {Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique} from 'typeorm';

import {Account} from '@modules/account/account.entity';

/**
 * A recurring bill alert that was raised: one per series, flag and period, so each late due date or higher payment
 * alerts once. The period is the missed due date for LATE and the higher payment's date for HIGHER_THAN_USUAL.
 */
@Entity('recurring_bill_alerts')
@Unique('uq_recurring_bill_alerts_period', ['accountId', 'seriesKey', 'flag', 'period'])
export class RecurringBillAlert {
	@PrimaryGeneratedColumn('uuid', {primaryKeyConstraintName: 'pk_recurring_bill_alerts'})
	id: string;

	@Column('uuid')
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId', foreignKeyConstraintName: 'fk_recurring_bill_alerts_account'})
	account: Account;

	@Column({type: 'varchar', length: 32})
	seriesKey: string;

	@Column({type: 'varchar', length: 32})
	flag: string;

	@Column({type: 'date'})
	period: string;

	/** When its push went to the owner's devices; null while it waits, or when it no longer applied. */
	@Column({type: 'timestamptz', nullable: true})
	pushedAt: Date | null;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;
}
