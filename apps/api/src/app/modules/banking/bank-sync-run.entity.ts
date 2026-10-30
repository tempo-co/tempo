import {Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';

import {BankConnection} from './bank-connection.entity';

@Entity('bank_sync_runs')
@Index('idx_bank_sync_runs_connection_started_at', ['bankConnection', 'startedAt'])
export class BankSyncRun {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => BankConnection, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'bankConnectionId'})
	bankConnection: BankConnection;

	@Column({type: 'varchar', length: 16, default: 'RUNNING'})
	status: string;

	@CreateDateColumn({type: 'timestamptz'})
	startedAt: Date;

	@Column({type: 'timestamptz', nullable: true})
	finishedAt: Date | null;

	@Column({type: 'date', nullable: true})
	requestedFrom: string | null;

	@Column({type: 'date', nullable: true})
	requestedTo: string | null;

	@Column({type: 'integer', default: 0})
	accountsFetched: number;

	@Column({type: 'integer', default: 0})
	balancesFetched: number;

	@Column({type: 'integer', default: 0})
	transactionsFetched: number;

	@Column({type: 'text', nullable: true})
	errorMessage: string | null;
}
