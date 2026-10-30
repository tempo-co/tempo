import {INestApplicationContext} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BANK_TRANSACTION_TYPES} from '@modules/banking/bank-transaction-type';

import {BankingFixtures} from './banking-fixtures';
import {VERIFIED_ACCOUNT_EMAIL} from './seed.constants';

const SEEDED_BANK_CONNECTION_ID = '00000000-0000-4000-8000-000000000001';
const SEEDED_BANK_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const SEEDED_SYNC_RUN_ID = '00000000-0000-4000-8000-000000000003';
const SEEDED_BALANCE_IDS = ['00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005'] as const;

/** Seeds one authorized connection with an account, a sync run, balances, and transactions for the given account. */
export async function seedBankingData(
	app: INestApplicationContext,
	{accountEmail = VERIFIED_ACCOUNT_EMAIL}: {accountEmail?: string} = {},
) {
	const account = await app
		.get<Repository<Account>>(getRepositoryToken(Account))
		.findOneByOrFail({email: accountEmail});
	await app.get<Repository<Account>>(getRepositoryToken(Account)).update(account.id, {baseCurrency: 'EUR'});
	const fixtures = new BankingFixtures(app);

	const bankConnection = await fixtures.createConnection(account, {
		id: SEEDED_BANK_CONNECTION_ID,
		providerSessionId: 'seed-provider-session',
		lastSyncedAt: new Date('2026-08-26T12:00:00.000Z'),
	});
	const bankAccount = await fixtures.createBankAccount(bankConnection, {
		id: SEEDED_BANK_ACCOUNT_ID,
		providerAccountId: 'seed-provider-account',
		identificationHash: 'seed-identification-hash',
		alias: 'Daily spending',
		cashAccountType: 'CACC',
		usage: 'PRIV',
		currentBalanceAmount: '123.45000000',
		currentBalanceType: 'AVAILABLE',
		balanceUpdatedAt: new Date('2026-08-26T12:00:00.000Z'),
	});
	const bankSyncRun = await fixtures.createSyncRun(bankConnection, {
		id: SEEDED_SYNC_RUN_ID,
		startedAt: new Date('2026-08-26T12:00:00.000Z'),
		finishedAt: new Date('2026-08-26T12:00:02.000Z'),
		requestedTo: '2026-08-26',
		accountsFetched: 1,
		balancesFetched: 2,
		transactionsFetched: 13,
	});
	const balances = await fixtures.createBalances(bankAccount, bankSyncRun, [
		{
			id: SEEDED_BALANCE_IDS[0],
			name: 'Available balance',
			balanceType: 'AVAILABLE',
			amount: '123.45000000',
			lastChangeDateTime: new Date('2026-08-26T12:00:00.000Z'),
			referenceDate: '2026-08-26',
			observedAt: new Date('2026-08-26T12:00:00.000Z'),
		},
		{
			id: SEEDED_BALANCE_IDS[1],
			name: 'Booked balance',
			balanceType: 'BOOKED',
			amount: '120.00000000',
			referenceDate: '2026-08-26',
			observedAt: new Date('2026-08-26T12:00:00.000Z'),
		},
	]);
	const transactions = await fixtures.createTransactions(bankAccount, createSeedTransactions());

	return {bankConnection, bankAccount, bankSyncRun, balances, transactions};
}

function createSeedTransactions() {
	const transactions = [
		{
			id: '00000000-0000-4000-8000-000000000011',
			transactionDate: '2026-08-24',
			bookingDate: '2026-08-26',
			valueDate: '2026-08-25',
			description: 'Coffee shop',
			counterpartyName: 'Cafe',
			amount: '-4.50000000',
			creditDebitIndicator: 'DBIT',
			transactionType: BANK_TRANSACTION_TYPES.CARD_PAYMENT,
			bankTransactionDescription: 'Card payment',
			merchantCategoryCode: '5814',
			remittanceInformation: 'Morning coffee',
			balanceAfterAmount: '100.50000000',
			balanceAfterCurrency: 'EUR',
			instructedAmount: '4.50000000',
			instructedCurrency: 'USD',
			exchangeRate: '0.923400000000000000',
			exchangeRateUnitCurrency: 'USD',
			exchangeRateType: 'SPOT',
			referenceNumber: 'reference-coffee',
			referenceNumberScheme: 'RF',
		},
		{
			id: '00000000-0000-4000-8000-000000000012',
			transactionDate: '2026-08-19',
			bookingDate: '2026-08-20',
			valueDate: '2026-08-20',
			description: 'Salary',
			counterpartyName: 'Employer',
			amount: '100.00000000',
			creditDebitIndicator: 'CRDT',
			transactionType: BANK_TRANSACTION_TYPES.SALARY,
			bankTransactionDescription: 'Salary payment',
		},
		{
			id: '00000000-0000-4000-8000-000000000013',
			transactionDate: '2026-08-18',
			bookingDate: '2026-08-19',
			valueDate: '2026-08-19',
			description:
				'Online card payment at a particularly long merchant description that resembles the detail returned by the bank provider',
			counterpartyName: 'Long Merchant Name',
			amount: '-42.00000000',
			creditDebitIndicator: 'DBIT',
			transactionType: BANK_TRANSACTION_TYPES.CARD_PAYMENT,
			bankTransactionDescription: 'Card payment',
			merchantCategoryCode: '5999',
			remittanceInformation: 'Long transaction description',
		},
		{
			id: '00000000-0000-4000-8000-000000000014',
			transactionDate: '2026-08-17',
			bookingDate: '2026-08-18',
			valueDate: '2026-08-18',
			description: 'Provider purchase',
			counterpartyName: 'Shop',
			amount: '-12.50000000',
			creditDebitIndicator: 'DBIT',
			transactionType: BANK_TRANSACTION_TYPES.CARD_PAYMENT,
			bankTransactionDescription: 'Card payment',
			merchantCategoryCode: '5411',
			remittanceInformation: 'Groceries',
		},
		...Array.from({length: 9}, (_, index) => {
			const day = String(17 - index).padStart(2, '0');
			return {
				id: `00000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`,
				transactionDate: `2026-08-${day}`,
				bookingDate: `2026-08-${day}`,
				valueDate: `2026-08-${day}`,
				description: `Extra transaction ${index + 1}`,
				counterpartyName: 'Provider',
				amount: '-1.00000000',
				creditDebitIndicator: 'DBIT',
				transactionType: BANK_TRANSACTION_TYPES.OTHER,
				bankTransactionDescription: null,
			};
		}),
	];

	return transactions.map((transaction) => ({
		...transaction,
		// These fixtures are all EUR: seed the completed same-currency conversion explicitly.
		amountInBaseCurrency: Number(transaction.amount).toFixed(2),
		baseAmountMethod: 'SAME' as const,
		baseAmountRateDate: null,
		dedupeKey: `seed-${transaction.id}`,
		providerTransactionId: transaction.id,
		entryReference: transaction.id,
	}));
}
