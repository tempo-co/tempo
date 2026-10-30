import {Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn} from 'typeorm';

@Entity('bank_transaction_fx_rates')
@Index('idx_bank_transaction_fx_rates_currency_date', ['currency', 'rateDate'], {unique: true})
export class BankTransactionFxRate {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({type: 'varchar', length: 3})
	currency: string;

	@Column({type: 'date'})
	rateDate: string;

	@Column({type: 'numeric', precision: 20, scale: 12})
	rateToEur: string;

	@Column({type: 'varchar', length: 32})
	provider: string;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;
}
