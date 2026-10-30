import {Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';

import {BankAccount} from './bank-account.entity';
import {BankSyncRun} from './bank-sync-run.entity';

@Entity('bank_account_balances')
@Index('idx_bank_account_balances_account_observed_at', ['bankAccountId', 'observedAt'])
@Index('idx_bank_account_balances_sync_run_account', ['bankSyncRunId', 'bankAccountId'])
export class BankAccountBalance {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({type: 'uuid'})
	bankAccountId: string;

	@ManyToOne(() => BankAccount, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'bankAccountId'})
	bankAccount: BankAccount;

	@Column({type: 'uuid'})
	bankSyncRunId: string;

	@ManyToOne(() => BankSyncRun, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'bankSyncRunId'})
	bankSyncRun: BankSyncRun;

	@Column({type: 'varchar', length: 255, nullable: true})
	name: string | null;

	@Column({type: 'varchar', length: 32})
	balanceType: string;

	@Column({type: 'numeric', precision: 20, scale: 8})
	amount: string;

	@Column({type: 'varchar', length: 3})
	currency: string;

	@Column({type: 'timestamptz', nullable: true})
	lastChangeDateTime: Date | null;

	@Column({type: 'date', nullable: true})
	referenceDate: string | null;

	@Column({type: 'varchar', length: 255, nullable: true})
	lastCommittedTransaction: string | null;

	@CreateDateColumn({type: 'timestamptz'})
	observedAt: Date;
}
