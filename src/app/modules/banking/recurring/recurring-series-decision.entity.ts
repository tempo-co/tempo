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

export const RECURRING_SERIES_DECISIONS = ['CONFIRMED', 'DISMISSED'] as const;
export type RecurringSeriesDecisionValue = (typeof RECURRING_SERIES_DECISIONS)[number];

/** The owner's confirm or dismiss choice for a detected series. It never references or changes transactions. */
@Entity('recurring_series_decisions')
@Unique('uq_recurring_series_decisions_account_series', ['accountId', 'seriesKey'])
export class RecurringSeriesDecision {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({type: 'uuid'})
	accountId: string;

	@ManyToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId'})
	account: Account;

	@Column({type: 'varchar', length: 32})
	seriesKey: string;

	@Column({type: 'varchar', length: 16})
	decision: RecurringSeriesDecisionValue;

	/**
	 * The series' payments when decided. A series' key changes when it is reclassified (a bill turning
	 * variable or settling on one amount), so the decision follows the payments it was made on.
	 */
	@Column({type: 'uuid', array: true, default: () => "'{}'"})
	transactionIds: string[];

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
