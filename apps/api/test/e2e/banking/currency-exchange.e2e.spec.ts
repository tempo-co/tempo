import {INestApplication} from '@nestjs/common';
import {DataSource, DeepPartial} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {bicBankIdentity, nameBankIdentity} from '@modules/banking/bank-identity';
import {
	BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
} from '@modules/banking/bank-transaction-financial-event';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {recomputeCurrencyExchanges} from '@modules/banking/currency-exchange/currency-exchange-recompute';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {SESSION_TEST_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_EMAIL} from '../../../scripts/seed-data/seed.constants';
import {getApp} from '../../setup/e2e.setup';

describe('Currency exchange recompute', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let owner: Account;
	let otherOwner: Account;
	let dataSource: DataSource;
	const recompute = (ownerId: string) =>
		dataSource.transaction((manager) => recomputeCurrencyExchanges(manager, ownerId));
	/** How many rows' exchange classification or counterpart the recompute changed. */
	const recomputeCount = async (ownerId: string) => (await recompute(ownerId)).transactionsChanged;

	beforeAll(async () => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		dataSource = app.get(DataSource);
		const accounts = app.get(AccountService);
		owner = (await accounts.findByEmail(VERIFIED_ACCOUNT_EMAIL))!;
		otherOwner = (await accounts.findByEmail(SESSION_TEST_ACCOUNT_EMAIL))!;
	});

	beforeEach(async () => {
		await fixtures.connections.createQueryBuilder().delete().execute();
	});

	type Leg = DeepPartial<BankTransaction>;
	const categorized = {category: 'SHOPPING', categoryStatus: 'COMPLETED', categorySource: 'AI'} as const;

	/** A EUR and a USD account at a bank Tempo knows nothing special about, with one leg on each. */
	async function createLegs(account: Account, debit: Leg, credit: Leg) {
		const connection = await fixtures.createConnection(account, {aspspName: 'Synthetic Bank'});
		const [eurAccount, usdAccount] = await fixtures.createBankAccounts(connection, [
			{currency: 'EUR'},
			{currency: 'USD'},
		]);
		return [
			await fixtures.createTransaction(eurAccount, {
				amount: '-10.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				bookingDate: '2026-01-10',
				...categorized,
				...debit,
			}),
			await fixtures.createTransaction(usdAccount, {
				amount: '12.00',
				currency: 'USD',
				creditDebitIndicator: 'CRDT',
				bookingDate: '2026-01-10',
				...categorized,
				...credit,
			}),
		] as const;
	}

	const createExchange = (account: Account, description = 'Exchanged to USD') =>
		createLegs(account, {description}, {description});

	/**
	 * A EUR and a USD account on the owner's imported-files connection, recording the given banks, with a €20 "Exchanged
	 * to USD" debit on the first and a marked $900 credit on the second, on one day.
	 */
	async function createFileLegs(debitBank: string | null, creditBank: string | null) {
		const files = await fixtures.createConnection(owner, {
			provider: 'file',
			aspspName: 'Imported files',
			aspspCountry: 'ZZ',
		});
		const [eurAccount, usdAccount] = await fixtures.createBankAccounts(files, [
			{currency: 'EUR', bankIdentity: debitBank},
			{currency: 'USD', bankIdentity: creditBank},
		]);
		return [
			await fixtures.createTransaction(eurAccount, {
				amount: '-20.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				bookingDate: '2026-01-10',
				description: 'Exchanged to USD',
				...categorized,
			}),
			await fixtures.createTransaction(usdAccount, {
				amount: '900.00',
				currency: 'USD',
				creditDebitIndicator: 'CRDT',
				bookingDate: '2026-01-10',
				description: 'Exchanged to USD',
				...categorized,
			}),
		] as const;
	}

	const stored = (id: string) => fixtures.transactions.findOneByOrFail({id});

	it('recognizes the exchange description at any bank once both legs answer each other', async () => {
		const [debit, credit] = await createExchange(owner);

		await expect(recomputeCount(owner.id)).resolves.toBe(2);

		for (const [leg, counterpart] of [
			[debit, credit],
			[credit, debit],
		]) {
			expect(await stored(leg.id)).toMatchObject({
				financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
				financialEventSource: 'RULE',
				financialEventRuleVersion: BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
				currencyExchangeCounterpartId: counterpart.id,
				category: null,
				categorySource: null,
				categoryStatus: 'NOT_APPLICABLE',
			});
		}
	});

	it('recognizes legs that carry the ISO 20022 foreign exchange spot code instead of a description', async () => {
		const [debit, credit] = await createLegs(
			owner,
			{description: 'Conversion', bankTransactionCode: 'SPOT'},
			{description: 'Conversion', bankTransactionCode: 'FORX-SPOT'},
		);

		await recomputeCount(owner.id);

		expect(await stored(debit.id)).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			currencyExchangeCounterpartId: credit.id,
		});
		expect(await stored(credit.id)).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			currencyExchangeCounterpartId: debit.id,
		});
	});

	it('recognizes legs whose only marker is the bank exchange word in the code label or proprietary code', async () => {
		const [debit, credit] = await createLegs(
			owner,
			{description: 'Conversion', bankTransactionDescription: 'Exchange'},
			{description: 'Conversion', bankTransactionCode: 'EXCHANGE'},
		);

		await expect(recomputeCount(owner.id)).resolves.toBe(2);

		expect(await stored(debit.id)).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			currencyExchangeCounterpartId: credit.id,
			categoryStatus: 'NOT_APPLICABLE',
		});
		expect(await stored(credit.id)).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			currencyExchangeCounterpartId: debit.id,
			categoryStatus: 'NOT_APPLICABLE',
		});
	});

	it('never hides a leg marked only by the exchange word when no other leg answers it', async () => {
		// The credit carries the bank's exchange word, but the same-day debit in the other currency is a transfer.
		const [debit, credit] = await createLegs(
			owner,
			{description: 'Transfer', bankTransactionDescription: 'Transfer'},
			{description: 'Conversion', bankTransactionDescription: 'Exchange'},
		);

		await expect(recomputeCount(owner.id)).resolves.toBe(0);

		for (const leg of [debit, credit]) {
			expect(await stored(leg.id)).toMatchObject({financialEventType: null, ...categorized});
		}
	});

	it('does not read the exchange word inside remittance text as a marker', async () => {
		const [debit, credit] = await createLegs(
			owner,
			{description: 'Book exchange club'},
			{description: 'Exchange of keys', bankTransactionCode: 'CURRENCY_EXCHANGE'},
		);

		await expect(recomputeCount(owner.id)).resolves.toBe(0);

		for (const leg of [debit, credit]) {
			expect(await stored(leg.id)).toMatchObject({financialEventType: null, ...categorized});
		}
	});

	it('never hides a marked leg that no other leg answers', async () => {
		// An incoming payment whose text happens to read like an exchange, next to an unmarked same-day debit.
		const [debit, credit] = await createLegs(
			owner,
			{description: 'Card payment'},
			{description: 'Exchanged to USD'},
		);

		await expect(recomputeCount(owner.id)).resolves.toBe(0);

		for (const leg of [debit, credit]) {
			expect(await stored(leg.id)).toMatchObject({
				financialEventType: null,
				currencyExchangeCounterpartId: null,
				...categorized,
			});
		}
	});

	it('does not treat an unmarked same-day pair in two currencies as an exchange', async () => {
		const [debit, credit] = await createLegs(owner, {description: 'Transfer'}, {description: 'Transfer'});

		await expect(recomputeCount(owner.id)).resolves.toBe(0);

		expect(await stored(debit.id)).toMatchObject({financialEventType: null, ...categorized});
		expect(await stored(credit.id)).toMatchObject({financialEventType: null, ...categorized});
	});

	it('keeps a manual category on a leg that becomes an exchange', async () => {
		const [debit] = await createLegs(
			owner,
			{description: 'Exchanged to USD', category: 'TRAVEL', categorySource: 'MANUAL'},
			{description: 'Exchanged to USD'},
		);

		await recomputeCount(owner.id);

		expect(await stored(debit.id)).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			category: 'TRAVEL',
			categorySource: 'MANUAL',
			categoryStatus: 'COMPLETED',
		});
	});

	it('returns both legs to categorization when one loses its marker', async () => {
		const [debit, credit] = await createExchange(owner);
		await recomputeCount(owner.id);
		await fixtures.transactions.update(debit.id, {description: 'Corrected provider description'});

		const {reclassifiedIds, requeuedIds} = await recompute(owner.id);

		// The legs come back for own-transfer recognition, which skips exchange legs.
		expect(reclassifiedIds.sort()).toEqual([debit.id, credit.id].sort());
		expect(requeuedIds.sort()).toEqual([debit.id, credit.id].sort());
		for (const leg of [debit, credit]) {
			expect(await stored(leg.id)).toMatchObject({
				financialEventType: null,
				financialEventSource: null,
				financialEventRuleVersion: null,
				currencyExchangeCounterpartId: null,
				categoryStatus: 'PENDING',
			});
		}
	});

	it('uses the same normalized description as exchange classification', async () => {
		const [debit, credit] = await createExchange(owner, '  Exchanged\t to  usd\n');

		await expect(recomputeCount(owner.id)).resolves.toBe(2);

		expect((await stored(debit.id)).currencyExchangeCounterpartId).toBe(credit.id);
		expect((await stored(credit.id)).currencyExchangeCounterpartId).toBe(debit.id);
	});

	it.each([
		['different banks', nameBankIdentity('Example Bank A'), nameBankIdentity('Example Bank B')],
		['different BICs', bicBankIdentity('EXMPDEFFXXX'), bicBankIdentity('EXMPNL2A')],
		['no recorded bank', null, null],
		['a bank name and a BIC', nameBankIdentity('ABN AMRO'), bicBankIdentity('ABNANL2A')],
	])(
		'on the imported-files connection, leaves marked legs of accounts with %s spending and income',
		async (_caseName, debitBank, creditBank) => {
			const [debit, credit] = await createFileLegs(debitBank, creditBank);

			await expect(recomputeCount(owner.id)).resolves.toBe(0);

			for (const leg of [debit, credit]) {
				expect(await stored(leg.id)).toMatchObject({
					financialEventType: null,
					currencyExchangeCounterpartId: null,
					categoryStatus: 'COMPLETED',
				});
			}
		},
	);

	it.each([
		['the same BIC, with and without a branch', bicBankIdentity('EXMPDEFFXXX'), bicBankIdentity('exmpdeff')],
		[
			'the bank an owner typed and the same bank as named elsewhere',
			nameBankIdentity('  ing '),
			nameBankIdentity('ING'),
		],
	])('on the imported-files connection, pairs the legs of accounts recording %s', async (_caseName, ...banks) => {
		const [debit, credit] = await createFileLegs(...banks);

		await expect(recomputeCount(owner.id)).resolves.toBe(2);

		expect(await stored(debit.id)).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			currencyExchangeCounterpartId: credit.id,
		});
		expect(await stored(credit.id)).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			currencyExchangeCounterpartId: debit.id,
		});
	});

	it('recomputes only the requested owner and leaves unchanged rows alone', async () => {
		const [debit, credit] = await createExchange(owner);
		const [otherDebit, otherCredit] = await createExchange(otherOwner);

		await expect(recomputeCount(owner.id)).resolves.toBe(2);
		await expect(recomputeCount(owner.id)).resolves.toBe(0);

		expect((await stored(debit.id)).currencyExchangeCounterpartId).toBe(credit.id);
		expect((await stored(credit.id)).currencyExchangeCounterpartId).toBe(debit.id);
		expect(await stored(otherDebit.id)).toMatchObject({
			financialEventType: null,
			currencyExchangeCounterpartId: null,
		});
		expect(await stored(otherCredit.id)).toMatchObject({
			financialEventType: null,
			currencyExchangeCounterpartId: null,
		});
	});

	it('returns the surviving leg to categorization when its counterpart is deleted', async () => {
		const [debit, credit] = await createExchange(owner);
		await recomputeCount(owner.id);

		await fixtures.transactions.delete(credit.id);

		expect((await stored(debit.id)).currencyExchangeCounterpartId).toBeNull();
		await expect(recomputeCount(owner.id)).resolves.toBe(1);
		expect(await stored(debit.id)).toMatchObject({financialEventType: null, categoryStatus: 'PENDING'});
	});
});
