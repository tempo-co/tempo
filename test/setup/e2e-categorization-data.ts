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
	]);
}
