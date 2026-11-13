import {INestApplication} from '@nestjs/common';
import {DeepPartial} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {
	BANK_TRANSACTION_FINANCIAL_EVENT_RULE_VERSION,
	BANK_TRANSACTION_FINANCIAL_EVENT_TYPES,
} from '@modules/banking/bank-transaction-financial-event';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {CategorizationScheduler} from '@modules/banking/categorization/categorization-scheduler.service';
import {CurrencyExchangeService} from '@modules/banking/services/currency-exchange.service';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {SESSION_TEST_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_EMAIL} from '../../../scripts/seed-data/seed.constants';
import {getApp} from '../../setup/e2e.setup';

describe('CurrencyExchangeService', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let owner: Account;
	let otherOwner: Account;
	let service: CurrencyExchangeService;

	beforeAll(async () => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		service = app.get(CurrencyExchangeService);
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

	const stored = (id: string) => fixtures.transactions.findOneByOrFail({id});

	it('recognizes the exchange description at any bank once both legs answer each other', async () => {
		const [debit, credit] = await createExchange(owner);

		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(2);

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

		await service.recomputeForOwner(owner.id);

		expect(await stored(debit.id)).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			currencyExchangeCounterpartId: credit.id,
		});
		expect(await stored(credit.id)).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			currencyExchangeCounterpartId: debit.id,
		});
	});

	it('never hides a marked leg that no other leg answers', async () => {
		// An incoming payment whose text happens to read like an exchange, next to an unmarked same-day debit.
		const [debit, credit] = await createLegs(
			owner,
			{description: 'Card payment'},
			{description: 'Exchanged to USD'},
		);

		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(0);

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

		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(0);

		expect(await stored(debit.id)).toMatchObject({financialEventType: null, ...categorized});
		expect(await stored(credit.id)).toMatchObject({financialEventType: null, ...categorized});
	});

	it('keeps a manual category on a leg that becomes an exchange', async () => {
		const [debit] = await createLegs(
			owner,
			{description: 'Exchanged to USD', category: 'TRAVEL', categorySource: 'MANUAL'},
			{description: 'Exchanged to USD'},
		);

		await service.recomputeForOwner(owner.id);

		expect(await stored(debit.id)).toMatchObject({
			financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
			category: 'TRAVEL',
			categorySource: 'MANUAL',
			categoryStatus: 'COMPLETED',
		});
	});

	it('returns both legs to categorization when one loses its marker', async () => {
		const [debit, credit] = await createExchange(owner);
		await service.recomputeForOwner(owner.id);
		await fixtures.transactions.update(debit.id, {description: 'Corrected provider description'});
		const enqueue = jest.spyOn(app.get(CategorizationScheduler), 'enqueueForTransactions');

		try {
			await expect(service.recomputeForOwner(owner.id)).resolves.toBe(2);
			expect(enqueue).toHaveBeenCalledTimes(1);
			expect([...enqueue.mock.calls[0][0]].sort()).toEqual([debit.id, credit.id].sort());
		} finally {
			enqueue.mockRestore();
		}

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

		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(2);

		expect((await stored(debit.id)).currencyExchangeCounterpartId).toBe(credit.id);
		expect((await stored(credit.id)).currencyExchangeCounterpartId).toBe(debit.id);
	});

	it('recomputes only the requested owner and leaves unchanged rows alone', async () => {
		const [debit, credit] = await createExchange(owner);
		const [otherDebit, otherCredit] = await createExchange(otherOwner);

		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(2);
		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(0);

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
		await service.recomputeForOwner(owner.id);

		await fixtures.transactions.delete(credit.id);

		expect((await stored(debit.id)).currencyExchangeCounterpartId).toBeNull();
		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(1);
		expect(await stored(debit.id)).toMatchObject({financialEventType: null, categoryStatus: 'PENDING'});
	});
});
