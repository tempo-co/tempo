import {INestApplication} from '@nestjs/common';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {detectBankTransactionFinancialEvent} from '@modules/banking/bank-transaction-financial-event';
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

	async function createExchange(account: Account, description = 'Exchanged to USD') {
		const connection = await fixtures.createConnection(account, {aspspName: 'Revolut'});
		const [source, target] = await fixtures.createBankAccounts(connection, [{currency: 'EUR'}, {currency: 'USD'}]);
		const createLeg = async (bankAccount: typeof source, indicator: 'DBIT' | 'CRDT', amount: string) => {
			const event = detectBankTransactionFinancialEvent({
				provider: connection.provider,
				aspspName: connection.aspspName,
				accountCurrency: bankAccount.currency,
				transactionCurrency: bankAccount.currency,
				creditDebitIndicator: indicator,
				description,
			});
			expect(event).not.toBeNull();
			return fixtures.createTransaction(bankAccount, {
				amount,
				currency: bankAccount.currency,
				creditDebitIndicator: indicator,
				bookingDate: '2026-01-10',
				description,
				financialEventType: event!.type,
				financialEventSource: event!.source,
				financialEventRuleVersion: event!.ruleVersion,
			});
		};
		return [await createLeg(source, 'DBIT', '-10.00'), await createLeg(target, 'CRDT', '12.00')] as const;
	}

	async function counterpartOf(id: string) {
		return (await fixtures.transactions.findOneByOrFail({id})).currencyExchangeCounterpartId;
	}

	it('clears both links when a previously linked leg is no longer classified as an exchange', async () => {
		const [debit, credit] = await createExchange(owner);
		await service.recomputeForOwner(owner.id);
		await fixtures.transactions.update(debit.id, {financialEventType: null});

		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(2);

		expect(await counterpartOf(debit.id)).toBeNull();
		expect(await counterpartOf(credit.id)).toBeNull();
	});

	it('uses the same normalized description as exchange classification', async () => {
		const [debit, credit] = await createExchange(owner, '  Exchanged\t to  usd\n');

		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(2);

		expect(await counterpartOf(debit.id)).toBe(credit.id);
		expect(await counterpartOf(credit.id)).toBe(debit.id);
	});

	it('recomputes only the requested owner and leaves unchanged links alone', async () => {
		const [debit, credit] = await createExchange(owner);
		const [otherDebit, otherCredit] = await createExchange(otherOwner);

		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(2);
		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(0);

		expect(await counterpartOf(debit.id)).toBe(credit.id);
		expect(await counterpartOf(credit.id)).toBe(debit.id);
		expect(await counterpartOf(otherDebit.id)).toBeNull();
		expect(await counterpartOf(otherCredit.id)).toBeNull();
	});

	it('clears the surviving link when its counterpart is deleted', async () => {
		const [debit, credit] = await createExchange(owner);
		await service.recomputeForOwner(owner.id);

		await fixtures.transactions.delete(credit.id);

		expect(await counterpartOf(debit.id)).toBeNull();
		await expect(service.recomputeForOwner(owner.id)).resolves.toBe(0);
	});
});
