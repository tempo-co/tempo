import {INestApplicationContext} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BANK_TRANSACTION_TYPES} from '@modules/banking/bank-transaction-type';

import {BankingFixtures} from '../../scripts/seed-data/banking-fixtures';
import {VERIFIED_ACCOUNT_EMAIL} from '../../scripts/seed-data/seed.constants';

export const CATEGORIZATION_E2E_AI_TRANSACTION_ID = '00000000-0000-4000-8000-000000000103';
export const CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID = '00000000-0000-4000-8000-000000000104';
export const CATEGORIZATION_E2E_WEB_TRANSACTION_ID = '00000000-0000-4000-8000-000000000105';
export const CATEGORIZATION_E2E_MANUAL_HISTORY_TRANSACTION_ID = '00000000-0000-4000-8000-000000000106';
export const CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID = '00000000-0000-4000-8000-000000000107';
export const CATEGORIZATION_E2E_OTHER_ACCOUNT_TRANSACTION_ID = '00000000-0000-4000-8000-000000000108';
export const CATEGORIZATION_E2E_ONE_OFF_MERCHANT_TRANSACTION_ID = '00000000-0000-4000-8000-000000000109';
export const CATEGORIZATION_E2E_ONE_OFF_CHOICE_TRANSACTION_ID = '00000000-0000-4000-8000-000000000110';
export const CATEGORIZATION_E2E_REPEAT_AMOUNT_TRANSACTION_ID = '00000000-0000-4000-8000-000000000111';
export const CATEGORIZATION_E2E_SINGLE_AMOUNT_TRANSACTION_ID = '00000000-0000-4000-8000-000000000112';
const CATEGORIZATION_E2E_OTHER_ACCOUNT_EMAIL = 'categorization-other@test.com';

export async function seedBankTransactionCategorizationData(app: INestApplicationContext): Promise<void> {
	const account = await app
		.get<Repository<Account>>(getRepositoryToken(Account))
		.findOneByOrFail({email: VERIFIED_ACCOUNT_EMAIL});
	const fixtures = new BankingFixtures(app);

	const connection = await fixtures.createConnection(account, {providerSessionId: 'categorization-e2e-session'});
	const bankAccount = await fixtures.createBankAccount(connection, {name: 'Categorization test account'});

	const cardPurchase = {
		transactionType: BANK_TRANSACTION_TYPES.CARD_PAYMENT,
		bankTransactionDescription: 'Card purchase',
	};
	await fixtures.createTransactions(bankAccount, [
		{
			...cardPurchase,
			id: CATEGORIZATION_E2E_AI_TRANSACTION_ID,
			transactionDate: '2026-08-31',
			bookingDate: '2026-09-01',
			valueDate: '2026-09-01',
			amount: '-47.25',
			description: 'Lantern Books',
			counterpartyName: 'Lantern Books',
			merchantCategoryCode: '5814',
			bankTransactionCode: 'PMNT',
			bankTransactionSubCode: 'CARD',
			remittanceInformation: 'Fiction and non-fiction',
		},
		{
			...cardPurchase,
			id: CATEGORIZATION_E2E_FAILURE_TRANSACTION_ID,
			transactionDate: '2026-09-02',
			bookingDate: '2026-09-02',
			valueDate: '2026-09-02',
			amount: '-12.00',
			description: 'Synthetic provider failure',
			counterpartyName: 'Synthetic provider failure',
		},
		{
			...cardPurchase,
			id: CATEGORIZATION_E2E_WEB_TRANSACTION_ID,
			transactionDate: '2026-09-03',
			bookingDate: '2026-09-03',
			valueDate: '2026-09-03',
			amount: '-23.00',
			description: 'Synthetic ambiguous merchant',
			counterpartyName: 'Synthetic ambiguous merchant',
		},
		{
			...cardPurchase,
			id: CATEGORIZATION_E2E_MANUAL_HISTORY_TRANSACTION_ID,
			transactionDate: '2026-09-04',
			bookingDate: '2026-09-04',
			valueDate: '2026-09-04',
			amount: '-20.00',
			description: 'BEA, Betaalpas BCK*Synthetic Rail 201,PAS001 NR:SY0001, 04.09.26/08:00 SYNTHTOWN',
			counterpartyName: null,
			category: 'TRANSPORTATION',
			categoryStatus: 'COMPLETED',
			categorySource: 'MANUAL',
		},
		{
			...cardPurchase,
			id: CATEGORIZATION_E2E_REPEAT_MERCHANT_TRANSACTION_ID,
			transactionDate: '2026-09-05',
			bookingDate: '2026-09-05',
			valueDate: '2026-09-05',
			amount: '-15.00',
			description: 'BEA, Google Pay Synthetic Rail 305,PAS001 NR:SY0002, 05.09.26/17:30 SYNTHTOWN',
			counterpartyName: null,
		},
		// A market the owner once filed under Health for one purchase, while its other rows are groceries.
		{
			...cardPurchase,
			id: CATEGORIZATION_E2E_ONE_OFF_CHOICE_TRANSACTION_ID,
			transactionDate: '2026-09-07',
			bookingDate: '2026-09-07',
			valueDate: '2026-09-07',
			amount: '-16.00',
			description: 'BEA, Google Pay Synthetic Market,PAS001 NR:SY0005, 07.09.26/09:15 SYNTHTOWN',
			counterpartyName: null,
			category: 'HEALTH',
			categoryStatus: 'COMPLETED',
			categorySource: 'MANUAL',
		},
		{
			...cardPurchase,
			transactionDate: '2026-09-08',
			bookingDate: '2026-09-08',
			valueDate: '2026-09-08',
			amount: '-31.00',
			description: 'BEA, Google Pay Synthetic Market,PAS001 NR:SY0006, 08.09.26/09:15 SYNTHTOWN',
			counterpartyName: null,
			category: 'FOOD_AND_DRINK',
			categoryStatus: 'COMPLETED',
			categorySource: 'AI',
		},
		{
			...cardPurchase,
			id: CATEGORIZATION_E2E_ONE_OFF_MERCHANT_TRANSACTION_ID,
			transactionDate: '2026-09-09',
			bookingDate: '2026-09-09',
			valueDate: '2026-09-09',
			amount: '-17.00',
			description: 'BEA, Google Pay Synthetic Market,PAS001 NR:SY0007, 09.09.26/09:15 SYNTHTOWN',
			counterpartyName: null,
		},
	]);

	// Transfers to one person: the same amount paid every month, and varying smaller amounts.
	const personTransfer = {transactionType: BANK_TRANSACTION_TYPES.TRANSFER, counterpartyName: 'Example Housemate'};
	const completed = (category: string, categorySource: string) => ({
		category,
		categoryStatus: 'COMPLETED',
		categorySource,
	});
	await fixtures.createTransactions(bankAccount, [
		// Older no-note transfers of the same amount must not push the payments that stated rent out of view.
		...['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'].map((transactionDate) => ({
			...personTransfer,
			...completed('TRANSFER_OUT', 'AI'),
			transactionDate,
			amount: '-640.00',
			description: 'To Example H',
			remittanceInformation: 'To Example H',
		})),
		{
			...personTransfer,
			...completed('HOUSING_AND_UTILITIES', 'MANUAL'),
			transactionDate: '2026-08-10',
			amount: '-640.00',
			description: 'To Example H',
			remittanceInformation: 'To Example H',
		},
		{
			...personTransfer,
			...completed('HOUSING_AND_UTILITIES', 'AI'),
			transactionDate: '2026-06-28',
			amount: '-640.00',
			description: 'To Example H',
			remittanceInformation: 'rent july IBAN NL91ABNA0417164300',
		},
		// Later months carried the category without a note; the first month that stated rent must stay in view.
		...['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'].map((transactionDate) => ({
			...personTransfer,
			...completed('HOUSING_AND_UTILITIES', 'AI'),
			transactionDate,
			amount: '-640.00',
			description: 'To Example H',
			remittanceInformation: 'To Example H',
		})),
		{
			...personTransfer,
			...completed('HOUSING_AND_UTILITIES', 'MANUAL'),
			transactionDate: '2026-08-28',
			amount: '-640.00',
			description: 'To Example H',
			remittanceInformation: 'To Example H',
		},
		// Same number in another currency, and a later payment: neither is earlier evidence for the September row.
		{
			...personTransfer,
			...completed('SHOPPING', 'MANUAL'),
			transactionDate: '2026-08-15',
			amount: '-640.00',
			currency: 'RON',
			description: 'To Example H',
		},
		{
			...personTransfer,
			...completed('TRAVEL', 'MANUAL'),
			transactionDate: '2026-10-28',
			amount: '-640.00',
			description: 'To Example H',
		},
		{
			...personTransfer,
			...completed('FOOD_AND_DRINK', 'MANUAL'),
			transactionDate: '2026-08-20',
			amount: '-12.00',
			description: 'To Example H',
			remittanceInformation: 'food To Example H',
		},
		{
			...personTransfer,
			id: CATEGORIZATION_E2E_REPEAT_AMOUNT_TRANSACTION_ID,
			transactionDate: '2026-09-28',
			amount: '-640.00',
			description: 'To Example H',
			remittanceInformation: 'To Example H',
		},
		{
			...personTransfer,
			id: CATEGORIZATION_E2E_SINGLE_AMOUNT_TRANSACTION_ID,
			transactionDate: '2026-09-29',
			amount: '-12.00',
			description: 'To Example H',
			remittanceInformation: 'To Example H',
		},
	]);

	// A second Tempo account with a conflicting manual category for the same merchant must never influence the first.
	const accounts = app.get<Repository<Account>>(getRepositoryToken(Account));
	const otherAccount = await accounts.save(
		accounts.create({
			name: 'Categorization other account',
			email: CATEGORIZATION_E2E_OTHER_ACCOUNT_EMAIL,
			isEmailVerified: true,
			password: 'not-used',
		}),
	);
	const otherConnection = await fixtures.createConnection(otherAccount, {
		providerSessionId: 'categorization-e2e-other-session',
	});
	const otherBankAccount = await fixtures.createBankAccount(otherConnection, {name: 'Other categorization account'});
	await fixtures.createTransactions(otherBankAccount, [
		{
			...cardPurchase,
			transactionDate: '2026-09-04',
			bookingDate: '2026-09-04',
			valueDate: '2026-09-04',
			amount: '-20.00',
			description: 'BEA, Betaalpas Synthetic Rail 201,PAS002 NR:SY0003, 04.09.26/08:00 SYNTHTOWN',
			counterpartyName: null,
			category: 'ENTERTAINMENT',
			categoryStatus: 'COMPLETED',
			categorySource: 'MANUAL',
		},
		{
			...cardPurchase,
			id: CATEGORIZATION_E2E_OTHER_ACCOUNT_TRANSACTION_ID,
			transactionDate: '2026-09-06',
			bookingDate: '2026-09-06',
			valueDate: '2026-09-06',
			amount: '-15.00',
			description: 'BEA, Google Pay Synthetic Rail 412,PAS002 NR:SY0004, 06.09.26/17:30 SYNTHTOWN',
			counterpartyName: null,
		},
	]);
}
