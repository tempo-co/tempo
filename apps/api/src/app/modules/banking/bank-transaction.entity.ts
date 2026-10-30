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

import {BankAccount} from './bank-account.entity';
import type {
	BankTransactionFinancialEventSource,
	BankTransactionFinancialEventType,
} from './bank-transaction-financial-event';
import type {BankTransactionLocation} from './bank-transaction-location';
import {BankTransactionType} from './bank-transaction-type';
import type {BankTransactionCategorizationSearchTrace} from './categorization/bank-transaction-categorization.types';
import type {OwnTransferEvidence, OwnTransferOverride} from './own-transfer/own-transfer-detection';

/** How `amountInBaseCurrency` was derived: copied, taken from the bank's instructed amount, or via ECB rates. */
export type BankTransactionBaseAmountMethod = 'SAME' | 'INSTRUCTED' | 'ECB';

@Entity('bank_transactions')
@Index('idx_bank_transactions_own_transfer_counterpart', ['ownTransferCounterpartId'])
@Index('idx_bank_transactions_currency_exchange_counterpart', ['currencyExchangeCounterpartId'])
@Index('idx_bank_transactions_account_dedupe', ['bankAccountId', 'dedupeKey'], {unique: true})
@Index('idx_bank_transactions_account_stable_identity', ['bankAccountId', 'stableIdentityKey'], {unique: true})
@Index('idx_bank_transactions_account_identity_group', ['bankAccountId', 'stableIdentityGroupKey'])
@Index('idx_bank_transactions_account_booking_date', ['bankAccountId', 'bookingDate'])
@Index('idx_bank_transactions_account_merchant_key', ['bankAccountId', 'merchantKey'])
export class BankTransaction {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({type: 'uuid'})
	bankAccountId: string;

	@ManyToOne(() => BankAccount, {onDelete: 'CASCADE', nullable: false})
	@JoinColumn({name: 'bankAccountId'})
	bankAccount: BankAccount;

	@Column({type: 'varchar', length: 255, nullable: true})
	providerTransactionId: string | null;

	@Column({type: 'varchar', length: 255, nullable: true})
	entryReference: string | null;

	@Column({type: 'varchar', length: 64})
	dedupeKey: string;

	@Column({type: 'varchar', length: 64, nullable: true})
	stableIdentityKey: string | null;

	@Column({type: 'varchar', length: 64, nullable: true})
	stableIdentityGroupKey: string | null;

	@Column({type: 'date', nullable: true})
	bookingDate: string | null;

	@Column({type: 'date', nullable: true})
	valueDate: string | null;

	@Column({type: 'date', nullable: true})
	transactionDate: string | null;

	@Column({type: 'numeric', precision: 20, scale: 8})
	amount: string;

	/** Exact cents in the owner's base currency; null until converted. */
	@Column({type: 'numeric', precision: 30, scale: 2, nullable: true})
	amountInBaseCurrency: string | null;

	@Column({type: 'varchar', length: 16, nullable: true})
	baseAmountMethod: BankTransactionBaseAmountMethod | null;

	/** The ECB reference rate date used, when `baseAmountMethod` is `ECB`. */
	@Column({type: 'date', nullable: true})
	baseAmountRateDate: string | null;

	@Column({type: 'varchar', length: 3})
	currency: string;

	@Column({type: 'varchar', length: 8, nullable: true})
	creditDebitIndicator: string | null;

	@Column({type: 'varchar', length: 32, nullable: true})
	transactionType: BankTransactionType | null;

	@Column({type: 'varchar', length: 32, nullable: true})
	transactionStatus: string | null;

	@Column({type: 'varchar', length: 64, nullable: true})
	bankTransactionCode: string | null;

	@Column({type: 'varchar', length: 64, nullable: true})
	bankTransactionSubCode: string | null;

	@Column({type: 'varchar', length: 255, nullable: true})
	bankTransactionDescription: string | null;

	@Column({type: 'varchar', length: 500, nullable: true})
	description: string | null;

	@Column({type: 'varchar', length: 500})
	displayDescription: string;

	@Column({type: 'varchar', length: 255, nullable: true})
	counterpartyName: string | null;

	/** Identifies the same merchant in the same direction; derived from description, counterparty and direction. */
	@Column({type: 'text', nullable: true})
	merchantKey: string | null;

	@Column({type: 'varchar', length: 34, nullable: true})
	counterpartyIban: string | null;

	/** Written only by own-transfer recognition, never by provider sync. */
	@Column({type: 'varchar', length: 16, nullable: true})
	ownTransferEvidence: OwnTransferEvidence | null;

	@Column({type: 'uuid', nullable: true})
	ownTransferCounterpartId: string | null;

	@ManyToOne(() => BankTransaction, {onDelete: 'SET NULL', nullable: true})
	@JoinColumn({name: 'ownTransferCounterpartId'})
	ownTransferCounterpart?: BankTransaction | null;

	/** Written only by the owner, never by provider sync or recognition. */
	@Column({type: 'varchar', length: 16, nullable: true})
	ownTransferOverride: OwnTransferOverride | null;

	@Column({type: 'jsonb', nullable: true})
	merchantLocation: BankTransactionLocation | null;

	@Column({type: 'varchar', length: 16, nullable: true})
	merchantCategoryCode: string | null;

	@Column({type: 'text', nullable: true})
	remittanceInformation: string | null;

	@Column({type: 'varchar', length: 32, nullable: true})
	category: string | null;

	@Column({type: 'varchar', length: 16, default: 'PENDING'})
	categoryStatus: string;

	@Column({type: 'varchar', length: 16, nullable: true})
	categorySource: string | null;

	@Column({type: 'numeric', precision: 4, scale: 3, nullable: true})
	categoryConfidence: string | null;

	@Column({type: 'varchar', length: 64, nullable: true})
	categoryInputHash: string | null;

	@Column({type: 'varchar', length: 64, nullable: true})
	categoryAppliedInputHash: string | null;

	@Column({type: 'varchar', length: 32, nullable: true})
	categoryProvider: string | null;

	@Column({type: 'varchar', length: 128, nullable: true})
	categoryModel: string | null;

	@Column({type: 'varchar', length: 64, nullable: true})
	categoryPromptVersion: string | null;

	@Column({type: 'timestamptz', nullable: true})
	categoryUpdatedAt: Date | null;

	@Column({type: 'text', nullable: true})
	categoryLastError: string | null;

	@Column({type: 'jsonb', nullable: true})
	categorySearchTrace: BankTransactionCategorizationSearchTrace | null;

	@Column({type: 'varchar', length: 32, nullable: true})
	financialEventType: BankTransactionFinancialEventType | null;

	@Column({type: 'varchar', length: 16, nullable: true})
	financialEventSource: BankTransactionFinancialEventSource | null;

	@Column({type: 'varchar', length: 64, nullable: true})
	financialEventRuleVersion: string | null;

	/** The other leg of a currency exchange. Written only by currency exchange pairing, never by provider sync. */
	@Column({type: 'uuid', nullable: true})
	currencyExchangeCounterpartId: string | null;

	@ManyToOne(() => BankTransaction, {onDelete: 'SET NULL', nullable: true})
	@JoinColumn({name: 'currencyExchangeCounterpartId'})
	currencyExchangeCounterpart?: BankTransaction | null;

	@Column({type: 'numeric', precision: 20, scale: 8, nullable: true})
	balanceAfterAmount: string | null;

	@Column({type: 'varchar', length: 3, nullable: true})
	balanceAfterCurrency: string | null;

	@Column({type: 'numeric', precision: 20, scale: 8, nullable: true})
	instructedAmount: string | null;

	@Column({type: 'varchar', length: 3, nullable: true})
	instructedCurrency: string | null;

	@Column({type: 'numeric', precision: 30, scale: 18, nullable: true})
	exchangeRate: string | null;

	@Column({type: 'varchar', length: 3, nullable: true})
	exchangeRateUnitCurrency: string | null;

	@Column({type: 'varchar', length: 16, nullable: true})
	exchangeRateType: string | null;

	@Column({type: 'varchar', length: 255, nullable: true})
	referenceNumber: string | null;

	@Column({type: 'varchar', length: 32, nullable: true})
	referenceNumberScheme: string | null;

	@CreateDateColumn({type: 'timestamptz'})
	createdAt: Date;

	@UpdateDateColumn({type: 'timestamptz'})
	updatedAt: Date;
}
