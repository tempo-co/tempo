import {INestApplicationContext} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BANK_TRANSACTION_TYPES} from '@modules/banking/bank-transaction-type';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';

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
export const CATEGORIZATION_E2E_COUNTERPARTY_TRANSACTION_ID = '00000000-0000-4000-8000-000000000113';
export const CATEGORIZATION_E2E_GOVERNMENT_TRANSACTION_ID = '00000000-0000-4000-8000-000000000114';
export const CATEGORIZATION_E2E_SHARED_IBAN_TRANSACTION_ID = '00000000-0000-4000-8000-000000000115';
export const CATEGORIZATION_E2E_SHARED_IBAN_OTHER_MERCHANT_TRANSACTION_ID = '00000000-0000-4000-8000-000000000116';
/** A stored category value that is no longer in the category list. */
export const CATEGORIZATION_E2E_REMOVED_CATEGORY = 'RETIRED_CATEGORY';
/** Published example IBANs: the gym's own account, and a payment processor's account that collects for two shops. */
export const CATEGORIZATION_E2E_COUNTERPARTY_IBAN = 'DE89370400440532013000';
const CATEGORIZATION_E2E_PROCESSOR_IBAN = 'GB82WEST12345698765432';
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
			category: 'GROCERIES',
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
			...completed('GROCERIES', 'MANUAL'),
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

	// A gym the owner pays monthly and that sometimes pays money back, and a council that refunds a tax bill.
	const gym = {
		transactionType: BANK_TRANSACTION_TYPES.TRANSFER,
		counterpartyName: 'Example Gym',
		description: 'Example Gym',
	};
	const gymPayment = (transactionDate: string, amount: string, values: Partial<BankTransaction> = {}) => ({
		...gym,
		...completed('HEALTH', 'AI'),
		transactionDate,
		amount,
		...values,
	});
	const gymRefund = (transactionDate: string, amount: string) => ({
		...gym,
		...completed('REFUND', 'AI'),
		transactionDate,
		amount,
		creditDebitIndicator: 'CRDT' as const,
	});
	const council = {
		transactionType: BANK_TRANSACTION_TYPES.TRANSFER,
		counterpartyName: 'Example Council',
		description: 'Example Council',
	};
	await fixtures.createTransactions(bankAccount, [
		// Same amount as the September payment: shown as sameAmountPayments, so not again as counterparty history.
		gymPayment('2026-09-01', '-30.00'),
		gymPayment('2026-08-01', '-30.00'),
		// Seven earlier payments in the same direction; the oldest falls outside the six newest. One names no merchant
		// and is matched by the gym's IBAN alone.
		gymPayment('2026-07-01', '-31.00'),
		gymPayment('2026-06-01', '-32.00', {
			counterpartyName: null,
			description: null,
			counterpartyIban: CATEGORIZATION_E2E_COUNTERPARTY_IBAN,
		}),
		gymPayment('2026-05-01', '-33.00'),
		gymPayment('2026-04-01', '-34.00'),
		gymPayment('2026-03-01', '-35.00'),
		gymPayment('2026-02-01', '-36.00'),
		gymPayment('2026-01-01', '-37.00'),
		// Five payments back from the gym; only the four newest are shown.
		gymRefund('2026-09-15', '12.00'),
		gymRefund('2025-12-01', '13.00'),
		gymRefund('2025-06-01', '14.00'),
		gymRefund('2025-01-01', '15.00'),
		gymRefund('2024-10-15', '16.00'),
		// The owner's pick of a category no longer in the list, at the same amount: no hint carries it.
		gymPayment('2026-08-20', '-30.00', completed(CATEGORIZATION_E2E_REMOVED_CATEGORY, 'MANUAL')),
		// After the September payment, a row still waiting for a category, and an own transfer: none is history.
		gymPayment('2026-10-01', '-38.00'),
		gymPayment('2026-07-15', '-40.00', {...completed('TRANSFER_OUT', 'AI'), ownTransferEvidence: 'NAME'}),
		{...gym, transactionDate: '2026-08-15', amount: '-39.00'},
		{
			...gym,
			id: CATEGORIZATION_E2E_COUNTERPARTY_TRANSACTION_ID,
			transactionDate: '2026-09-30',
			amount: '-30.00',
			counterpartyIban: CATEGORIZATION_E2E_COUNTERPARTY_IBAN,
		},
		// Two shops paid through one processor account: a payment at either matches that shop's rows by name only.
		{
			transactionType: BANK_TRANSACTION_TYPES.TRANSFER,
			...completed('GROCERIES', 'AI'),
			counterpartyName: 'Example Bakery',
			description: 'Example Bakery',
			counterpartyIban: CATEGORIZATION_E2E_PROCESSOR_IBAN,
			transactionDate: '2026-09-05',
			amount: '-6.00',
		},
		{
			transactionType: BANK_TRANSACTION_TYPES.TRANSFER,
			...completed('ENTERTAINMENT', 'AI'),
			counterpartyName: 'Example Cinema',
			description: 'Example Cinema',
			counterpartyIban: CATEGORIZATION_E2E_PROCESSOR_IBAN,
			transactionDate: '2026-09-10',
			amount: '-14.00',
		},
		{
			id: CATEGORIZATION_E2E_SHARED_IBAN_TRANSACTION_ID,
			transactionType: BANK_TRANSACTION_TYPES.TRANSFER,
			counterpartyName: 'Example Bakery',
			description: 'Example Bakery',
			counterpartyIban: CATEGORIZATION_E2E_PROCESSOR_IBAN,
			transactionDate: '2026-09-30',
			amount: '-7.00',
		},
		{
			id: CATEGORIZATION_E2E_SHARED_IBAN_OTHER_MERCHANT_TRANSACTION_ID,
			transactionType: BANK_TRANSACTION_TYPES.TRANSFER,
			counterpartyName: 'Example Cinema',
			description: 'Example Cinema',
			counterpartyIban: CATEGORIZATION_E2E_PROCESSOR_IBAN,
			transactionDate: '2026-09-30',
			amount: '-15.00',
		},
		// Tax bills paid to the council, and its refund days after the gym payment: 24 months before the refund is the
		// oldest day still in its history.
		{...council, ...completed('TAXES_AND_GOVERNMENT', 'AI'), transactionDate: '2024-10-04', amount: '-118.00'},
		{...council, ...completed('TAXES_AND_GOVERNMENT', 'AI'), transactionDate: '2024-10-05', amount: '-119.00'},
		{...council, ...completed('TAXES_AND_GOVERNMENT', 'AI'), transactionDate: '2026-03-01', amount: '-120.00'},
		{
			...council,
			id: CATEGORIZATION_E2E_GOVERNMENT_TRANSACTION_ID,
			transactionDate: '2026-10-05',
			amount: '120.00',
			creditDebitIndicator: 'CRDT',
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
		// The same gym, by name and IBAN, in another owner's account: never history for the first owner.
		{
			...gym,
			...completed('ENTERTAINMENT', 'MANUAL'),
			transactionDate: '2026-09-20',
			amount: '-40.00',
			counterpartyIban: CATEGORIZATION_E2E_COUNTERPARTY_IBAN,
		},
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
