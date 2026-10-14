import {INestApplicationContext} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {randomUUID} from 'node:crypto';
import {DeepPartial, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankAccountBalance} from '@modules/banking/bank-account-balance.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankConnection} from '@modules/banking/bank-connection.entity';
import {BankSyncRun} from '@modules/banking/bank-sync-run.entity';
import {getBankTransactionDisplayDescription} from '@modules/banking/bank-transaction-display';
import {
	BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
	BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES,
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
} from '@modules/banking/bank-transaction-financial-event';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {getBankTransactionMerchantKey} from '@modules/banking/categorization/bank-transaction-merchant-key';

export const CURRENCY_EXCHANGE_EVENT = {
	financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
	financialEventSource: BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
	financialEventRuleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
} as const;

/** A categorized, booked row in EUR unless overridden when persisted by BankingFixtures. */
export function bookedRow(bookingDate: string | null, amount: string, overrides: DeepPartial<BankTransaction> = {}) {
	return {
		bookingDate,
		valueDate: bookingDate,
		amount,
		amountInBaseCurrency: amount,
		creditDebitIndicator: amount.startsWith('-') ? 'DBIT' : 'CRDT',
		category: 'SHOPPING',
		categoryStatus: 'COMPLETED',
		categorySource: 'AI',
		...overrides,
	} satisfies DeepPartial<BankTransaction>;
}

/**
 * Persists banking rows with minimal valid defaults, so callers (the dev seeder and e2e specs) only spell out
 * the fields they care about.
 */
export class BankingFixtures {
	readonly connections: Repository<BankConnection>;
	readonly bankAccounts: Repository<BankAccount>;
	readonly syncRuns: Repository<BankSyncRun>;
	readonly balances: Repository<BankAccountBalance>;
	readonly transactions: Repository<BankTransaction>;

	constructor(app: INestApplicationContext) {
		this.connections = app.get(getRepositoryToken(BankConnection));
		this.bankAccounts = app.get(getRepositoryToken(BankAccount));
		this.syncRuns = app.get(getRepositoryToken(BankSyncRun));
		this.balances = app.get(getRepositoryToken(BankAccountBalance));
		this.transactions = app.get(getRepositoryToken(BankTransaction));
	}

	createConnection(account: Pick<Account, 'id'>, overrides: DeepPartial<BankConnection> = {}) {
		return this.connections.save(
			this.connections.create({
				account,
				provider: 'enable-banking',
				aspspName: 'ABN AMRO',
				aspspCountry: 'NL',
				status: 'AUTHORIZED',
				consentValidUntil: new Date('2030-01-01T00:00:00.000Z'),
				...overrides,
			}),
		);
	}

	createBankAccount(bankConnection: BankConnection, overrides: DeepPartial<BankAccount> = {}) {
		return this.bankAccounts.save(this.bankAccounts.create(bankAccountValues(bankConnection, overrides)));
	}

	createBankAccounts(bankConnection: BankConnection, overrides: DeepPartial<BankAccount>[]) {
		return this.bankAccounts.save(
			overrides.map((values) => this.bankAccounts.create(bankAccountValues(bankConnection, values))),
		);
	}

	createSyncRun(bankConnection: BankConnection, overrides: DeepPartial<BankSyncRun> = {}) {
		return this.syncRuns.save(this.syncRuns.create({bankConnection, status: 'SUCCEEDED', ...overrides}));
	}

	createBalances(bankAccount: BankAccount, bankSyncRun: BankSyncRun, overrides: DeepPartial<BankAccountBalance>[]) {
		return this.balances.save(
			overrides.map((values) =>
				this.balances.create({
					bankAccountId: bankAccount.id,
					bankSyncRunId: bankSyncRun.id,
					balanceType: 'AVAILABLE',
					amount: '0.00',
					currency: bankAccount.currency,
					...values,
				}),
			),
		);
	}

	async createTransaction(bankAccount: Pick<BankAccount, 'id'>, overrides: DeepPartial<BankTransaction> = {}) {
		const [transaction] = await this.createTransactions(bankAccount, [overrides]);
		return transaction;
	}

	createTransactions(bankAccount: Pick<BankAccount, 'id'>, overrides: DeepPartial<BankTransaction>[]) {
		return this.transactions.save(
			overrides.map((values) =>
				this.transactions.create({
					bankAccountId: bankAccount.id,
					dedupeKey: randomUUID(),
					amount: '-1.00',
					currency: 'EUR',
					creditDebitIndicator: 'DBIT',
					transactionStatus: 'BOOK',
					displayDescription: getBankTransactionDisplayDescription({
						description: values.description,
						counterpartyName: values.counterpartyName,
					}),
					merchantKey: getBankTransactionMerchantKey({
						description: values.description,
						counterpartyName: values.counterpartyName,
						creditDebitIndicator: values.creditDebitIndicator ?? 'DBIT',
					}),
					...values,
				}),
			),
		);
	}
}

function bankAccountValues(bankConnection: BankConnection, overrides: DeepPartial<BankAccount>) {
	return {
		bankConnection,
		providerAccountId: `provider-account-${randomUUID()}`,
		identificationHash: `identification-hash-${randomUUID()}`,
		name: 'Main account',
		currency: 'EUR',
		isActive: true,
		...overrides,
	};
}
