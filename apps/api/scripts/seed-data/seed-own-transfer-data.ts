import {INestApplicationContext} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {DeepPartial, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {
	BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
	BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES,
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
} from '@modules/banking/bank-transaction-financial-event';
import {BANK_TRANSACTION_TYPES} from '@modules/banking/bank-transaction-type';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {CurrencyExchangeService} from '@modules/banking/services/currency-exchange.service';
import {OwnTransferService} from '@modules/banking/services/own-transfer.service';

import {BankingFixtures} from './banking-fixtures';
import {OWN_TRANSFER_ACCOUNT_EMAIL} from './seed.constants';

/** Synthetic account holder and IBAN (published example). */
const SEEDED_HOLDER_NAME = 'Jane Example';
const SEEDED_REVOLUT_IBAN = 'GB82WEST12345698765432';

export const SEEDED_OWN_TRANSFER_IDS = {
	ibanPairOutgoing: '00000000-0000-4000-8000-000000000101',
	ibanPairIncoming: '00000000-0000-4000-8000-000000000102',
	namePairOutgoing: '00000000-0000-4000-8000-000000000103',
	namePairIncoming: '00000000-0000-4000-8000-000000000104',
	oneSided: '00000000-0000-4000-8000-000000000105',
	coincidenceOutgoing: '00000000-0000-4000-8000-000000000106',
	coincidenceIncoming: '00000000-0000-4000-8000-000000000107',
	cardTopUp: '00000000-0000-4000-8000-000000000108',
	exchangeOutgoing: '00000000-0000-4000-8000-000000000111',
	exchangeIncoming: '00000000-0000-4000-8000-000000000112',
	unmatchedExchange: '00000000-0000-4000-8000-000000000113',
} as const;

/**
 * Seeds an owner with two connected banks and synthetic own-transfer cases: an IBAN pair, a name pair,
 * a one-sided transfer, a same-amount coincidence that must stay unlabelled, and a card top-up. The Revolut
 * connection also holds a USD account with a linked currency exchange and an exchange leg without its other side.
 */
export async function seedOwnTransferData(
	app: INestApplicationContext,
	{accountEmail = OWN_TRANSFER_ACCOUNT_EMAIL}: {accountEmail?: string} = {},
) {
	const account = await app
		.get<Repository<Account>>(getRepositoryToken(Account))
		.findOneByOrFail({email: accountEmail});
	const fixtures = new BankingFixtures(app);

	const abnConnection = await fixtures.createConnection(account, {
		id: '00000000-0000-4000-8000-000000000091',
		providerSessionId: 'seed-own-transfer-abn-session',
		lastSyncedAt: new Date('2026-08-26T12:00:00.000Z'),
	});
	const abnAccount = await fixtures.createBankAccount(abnConnection, {
		id: '00000000-0000-4000-8000-000000000092',
		providerAccountId: 'seed-own-transfer-abn-account',
		identificationHash: 'seed-own-transfer-abn-hash',
		name: SEEDED_HOLDER_NAME,
		alias: 'Main',
	});
	const revolutConnection = await fixtures.createConnection(account, {
		id: '00000000-0000-4000-8000-000000000093',
		aspspName: 'Revolut',
		aspspCountry: 'LT',
		providerSessionId: 'seed-own-transfer-revolut-session',
		lastSyncedAt: new Date('2026-08-26T12:00:00.000Z'),
	});
	const revolutAccount = await fixtures.createBankAccount(revolutConnection, {
		id: '00000000-0000-4000-8000-000000000094',
		providerAccountId: 'seed-own-transfer-revolut-account',
		identificationHash: 'seed-own-transfer-revolut-hash',
		name: SEEDED_HOLDER_NAME,
		alias: 'Travel',
		iban: SEEDED_REVOLUT_IBAN,
	});
	const revolutUsdAccount = await fixtures.createBankAccount(revolutConnection, {
		id: '00000000-0000-4000-8000-000000000095',
		providerAccountId: 'seed-own-transfer-revolut-usd-account',
		identificationHash: 'seed-own-transfer-revolut-usd-hash',
		name: SEEDED_HOLDER_NAME,
		currency: 'USD',
	});

	const ids = SEEDED_OWN_TRANSFER_IDS;
	await fixtures.createTransactions(
		abnAccount,
		seedTransactions([
			{
				id: ids.ibanPairOutgoing,
				bookingDate: '2026-08-24',
				amount: '-200.00000000',
				description: 'Online banking transfer to Travel',
				counterpartyIban: SEEDED_REVOLUT_IBAN,
			},
			{
				id: ids.namePairIncoming,
				bookingDate: '2026-08-21',
				amount: '50.00000000',
				description: `SEPA Overboeking Naam: ${SEEDED_HOLDER_NAME} Omschrijving: back from Travel`,
				counterpartyName: SEEDED_HOLDER_NAME,
			},
			{
				id: ids.coincidenceOutgoing,
				bookingDate: '2026-08-18',
				amount: '-25.00000000',
				description: 'SEPA Overboeking Naam: Sam Friend Omschrijving: Birthday gift',
				counterpartyName: 'Sam Friend',
			},
		]),
	);
	await fixtures.createTransactions(
		revolutAccount,
		seedTransactions([
			{
				id: ids.ibanPairIncoming,
				bookingDate: '2026-08-25',
				amount: '200.00000000',
				description: `Payment from ${SEEDED_HOLDER_NAME}`,
			},
			{
				id: ids.namePairOutgoing,
				bookingDate: '2026-08-21',
				amount: '-50.00000000',
				description: `To ${SEEDED_HOLDER_NAME}`,
			},
			{
				id: ids.oneSided,
				bookingDate: '2026-08-19',
				amount: '300.00000000',
				description: `Payment from ${SEEDED_HOLDER_NAME}`,
			},
			{
				id: ids.coincidenceIncoming,
				bookingDate: '2026-08-18',
				amount: '25.00000000',
				description: 'Payment from Sam Friend',
			},
			{
				id: ids.cardTopUp,
				bookingDate: '2026-08-17',
				amount: '40.00000000',
				description: 'Top-up by *0000',
				transactionType: BANK_TRANSACTION_TYPES.OTHER,
			},
			exchangeLeg({id: ids.exchangeOutgoing, bookingDate: '2026-08-16', amount: '-80.00000000'}),
			exchangeLeg({id: ids.unmatchedExchange, bookingDate: '2026-08-14', amount: '-30.00000000'}),
		]),
	);
	await fixtures.createTransactions(
		revolutUsdAccount,
		seedTransactions([
			exchangeLeg({
				id: ids.exchangeIncoming,
				bookingDate: '2026-08-16',
				amount: '92.00000000',
				currency: 'USD',
				amountInBaseCurrency: '79.80',
				baseAmountMethod: 'ECB',
			}),
		]),
	);

	await app.get(OwnTransferService).recomputeForOwner(account.id);
	await app.get(CurrencyExchangeService).recomputeForOwner(account.id);
	return {abnConnection, abnAccount, revolutConnection, revolutAccount, revolutUsdAccount};
}

/** A Revolut exchange leg from EUR into USD, as the financial event rule classifies it. */
function exchangeLeg(transaction: DeepPartial<BankTransaction> & {id: string; amount: string}) {
	return {
		description: 'Exchanged to USD',
		transactionType: BANK_TRANSACTION_TYPES.OTHER,
		categoryStatus: 'NOT_APPLICABLE',
		financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		financialEventSource: BANK_TRANSACTION_FINANCIAL_EVENT_SOURCES.RULE,
		financialEventRuleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
		...transaction,
	};
}

function seedTransactions(transactions: (DeepPartial<BankTransaction> & {id: string; amount: string})[]) {
	return transactions.map((transaction) => ({
		valueDate: transaction.bookingDate,
		transactionDate: transaction.bookingDate,
		amountInBaseCurrency: transaction.amount,
		baseAmountMethod: 'SAME' as const,
		creditDebitIndicator: transaction.amount.startsWith('-') ? 'DBIT' : 'CRDT',
		transactionType: BANK_TRANSACTION_TYPES.TRANSFER,
		...transaction,
		dedupeKey: `seed-${transaction.id}`,
		providerTransactionId: transaction.id,
		entryReference: transaction.id,
	}));
}
