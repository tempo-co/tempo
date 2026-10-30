import {
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from 'typeorm';

import {Account} from '@modules/account/account.entity';

/** The owner marked a detected series as not recurring. It never references or changes transactions. */
@Entity('recurring_series_hides')
@Unique('uq_recurring_series_hides_account_series', ['accountId', 'seriesKey'])
export class RecurringSeriesHide {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId'})
	account: Account;

	@Column({type: 'varchar', length: 32})
	seriesKey: string;

	/**
	 * The series' payments when hidden. A series' key changes when it is reclassified (a bill turning
	 * variable or settling on one amount), so the hide follows the payments it was made on.
	 */
	@Column({type: 'uuid', array: true, default: () => "'{}'"})
	transactionIds: string[];

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
