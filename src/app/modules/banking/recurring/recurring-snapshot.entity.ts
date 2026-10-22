import {Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn} from 'typeorm';

import {Account} from '@modules/account/account.entity';

/**
 * The owner's detected recurring series, before any date or answer is applied. It is derived data: it is rebuilt when
 * the payments it was detected from change, and dropped when the app starts so new detection rules apply at once.
 */
@Entity('recurring_snapshots')
export class RecurringSnapshot {
	@PrimaryColumn({type: 'uuid'})
	accountId: string;

	@OneToOne(() => Account, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'accountId'})
	account: Account;

	/** Hash of every payment field detection reads. */
	@Column({type: 'varchar', length: 32})
	inputVersion: string;

	@Column({type: 'jsonb'})
	payload: unknown;

	@UpdateDateColumn({type: 'timestamptz'})
	computedAt: Date;
}
