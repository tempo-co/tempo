import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {REPORTING_CURRENCIES, type ReportingCurrency} from '@tempo/contracts';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {dateInAppTimeZone} from '@core/time/app-time-zone';
import {Account} from '@modules/account/account.entity';
import {REPORTING_CURRENCY_UNSUPPORTED} from '@modules/banking/api/constants/banking-messages.constants';
import {addDays} from '@modules/banking/banking.utils';
import {McpReaderService} from '@modules/banking/services/mcp-reader.service';
import {ReportingCurrencyService} from '@modules/banking/services/reporting-currency.service';

import {BankingFixtures, CURRENCY_EXCHANGE_EVENT} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {expectValidationMessage} from '../../utils/auth-utils';
import {createBankingOwner} from '../../utils/banking-utils';

const ROUTE = '/reporting-currency';

describe('Reporting currency', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let accounts: Repository<Account>;
	let service: ReportingCurrencyService;
	/** Today in the app's time zone, as the suggestion counts it. */
	let today: string;

	beforeAll(() => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
		service = app.get(ReportingCurrencyService);
	});

	beforeEach(() => {
		today = dateInAppTimeZone(new Date());
	});

	/** A verified owner without a reporting currency, with one connection holding accounts in these currencies. */
	async function ownerWithAccounts(...currencies: string[]) {
		const {owner, agent, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: null});
		await fixtures.bankAccounts.delete({id: bankAccount.id});
		const bankAccounts = await fixtures.createBankAccounts(
			connection,
			currencies.map((currency) => ({currency})),
		);
		return {owner, agent, connection, bankAccounts};
	}

	async function read(agent: TestAgent): Promise<ReportingCurrency> {
		return (await agent.get(ROUTE).expect(200)).body as ReportingCurrency;
	}

	/** Booked, ordinary rows `daysAgo` days before today. */
	function booked(daysAgo: number, count: number, overrides: Record<string, unknown> = {}) {
		return Array.from({length: count}, () => ({bookingDate: addDays(today, -daysAgo), ...overrides}));
	}

	it('asks an owner with accounts in several currencies to choose once their history is in, and saves the choice', async () => {
		const {owner, agent, bankAccounts} = await ownerWithAccounts('EUR', 'GBP');
		const [eurAccount, gbpAccount] = bankAccounts;
		await fixtures.createTransactions(gbpAccount, [
			...booked(3, 3, {currency: 'GBP'}),
			// Older than the window.
			...booked(91, 4, {currency: 'GBP'}),
		]);
		await fixtures.createTransactions(eurAccount, [
			...booked(1, 2),
			...booked(0, 3, {transactionStatus: 'PDNG'}),
			...booked(2, 2, {ownTransferEvidence: 'IBAN'}),
			...booked(2, 2, CURRENCY_EXCHANGE_EVENT),
			// Card spending abroad still counts in the account's own currency.
			...booked(5, 1, {instructedAmount: '1.00', instructedCurrency: 'GBP'}),
		]);
		const unset = {
			currency: null,
			confirmed: false,
			setupRequired: false,
			suggestion: null,
			connectedCurrencies: ['EUR', 'GBP'],
			options: ['EUR', 'GBP', ...REPORTING_CURRENCIES.filter((code) => code !== 'EUR' && code !== 'GBP')],
			recalculating: false,
		};
		expect(await read(agent)).toEqual(unset);

		// Authorizing knows the accounts but not their history yet.
		await service.reconcileSafely(owner.id, {historySettled: false});
		expect(await read(agent)).toEqual(unset);

		// The first sync finished: 4 recent GBP rows against 3 EUR ones, since pending rows, own transfers and currency
		// exchanges do not count. GBP is only suggested; nothing is saved.
		await fixtures.createTransactions(gbpAccount, booked(4, 1, {currency: 'GBP'}));
		await service.reconcileSafely(owner.id, {historySettled: true});
		expect(await read(agent)).toEqual({...unset, setupRequired: true, suggestion: 'GBP'});
		expect(await accounts.findOneByOrFail({id: owner.id})).toMatchObject({baseCurrency: null});

		// A currency none of the accounts is in can be chosen.
		const chosen = (await agent.put(ROUTE).send({currency: 'USD'}).expect(200)).body as ReportingCurrency;
		const usd = {...unset, currency: 'USD', confirmed: true, recalculating: true};
		expect(chosen).toEqual(usd);
		expect(await read(agent)).toEqual(usd);

		// Accounts in yet another currency never bring the question back.
		await fixtures.createBankAccount(await fixtures.createConnection(owner, {aspspName: 'Example Second Bank'}), {
			currency: 'CHF',
		});
		await service.reconcileSafely(owner.id, {historySettled: true});
		expect(await read(agent)).toEqual({
			...usd,
			connectedCurrencies: ['CHF', 'EUR', 'GBP'],
			options: [
				'CHF',
				'EUR',
				'GBP',
				...REPORTING_CURRENCIES.filter((code) => !['CHF', 'EUR', 'GBP'].includes(code)),
			],
		});
	});

	it.each([
		['the currencies tie', [3, 3]],
		['there is no recent history', [0, 0]],
	])('suggests no currency when %s', async (_case, [eurRows, gbpRows]) => {
		const {owner, agent, bankAccounts} = await ownerWithAccounts('EUR', 'GBP');
		await fixtures.createTransactions(bankAccounts[0], booked(1, eurRows));
		await fixtures.createTransactions(bankAccounts[1], booked(1, gbpRows, {currency: 'GBP'}));

		await service.reconcileSafely(owner.id, {historySettled: true});

		expect(await read(agent)).toMatchObject({currency: null, setupRequired: true, suggestion: null});
	});

	it('uses the only currency of the accounts right away and asks once a second one appears', async () => {
		const {owner, agent, connection} = await ownerWithAccounts('EUR');
		const [account] = await fixtures.bankAccounts.find({where: {bankConnection: {id: connection.id}}});
		const [row] = await fixtures.createTransactions(account, booked(1, 1, {amount: '-4.20'}));

		// Every amount is already in EUR, so the totals are complete at once.
		await service.reconcileSafely(owner.id, {historySettled: false});
		const automatic = {currency: 'EUR', confirmed: false, setupRequired: false, recalculating: false};
		expect(await read(agent)).toMatchObject(automatic);
		const converted = {amountInBaseCurrency: '-4.20', baseAmountMethod: 'SAME'};
		expect(await fixtures.transactions.findOneByOrFail({id: row.id})).toMatchObject(converted);

		await fixtures.createBankAccount(connection, {currency: 'GBP'});
		await service.reconcileSafely(owner.id, {historySettled: false});
		expect(await read(agent)).toMatchObject(automatic);

		// Once the sync finishes, the owner is asked, with the automatic currency kept until they choose.
		await service.reconcileSafely(owner.id, {historySettled: true});
		expect(await read(agent)).toMatchObject({...automatic, setupRequired: true, suggestion: null});

		// Keeping it confirms it without converting anything again.
		expect((await agent.put(ROUTE).send({currency: 'EUR'}).expect(200)).body).toMatchObject({
			...automatic,
			confirmed: true,
		});
		expect(await fixtures.transactions.findOneByOrFail({id: row.id})).toMatchObject(converted);
	});

	it('stops asking once accounts in one currency are left, and follows that currency until the owner chooses', async () => {
		const {owner, agent, bankAccounts} = await ownerWithAccounts('EUR', 'GBP');
		const [eurAccount, gbpAccount] = bankAccounts;
		await service.reconcileSafely(owner.id, {historySettled: true});
		expect(await read(agent)).toMatchObject({currency: null, setupRequired: true});

		// The GBP bank is removed before the owner answers.
		await fixtures.bankAccounts.update({id: gbpAccount.id}, {isActive: false});
		await service.reconcileSafely(owner.id, {historySettled: false});
		const automatic = {confirmed: false, setupRequired: false, suggestion: null, recalculating: false};
		expect(await read(agent)).toMatchObject({...automatic, currency: 'EUR', connectedCurrencies: ['EUR']});

		// Never chosen, it moves with the accounts.
		await fixtures.bankAccounts.update({id: eurAccount.id}, {isActive: false});
		await fixtures.createBankAccount(await fixtures.createConnection(owner, {aspspName: 'Example Second Bank'}), {
			currency: 'CHF',
		});
		await service.reconcileSafely(owner.id, {historySettled: false});
		expect(await read(agent)).toMatchObject({...automatic, currency: 'CHF', connectedCurrencies: ['CHF']});
	});

	it('stops asking once no accounts are left to ask about', async () => {
		const {owner, agent, bankAccounts} = await ownerWithAccounts('EUR', 'GBP');
		await service.reconcileSafely(owner.id, {historySettled: true});
		expect(await read(agent)).toMatchObject({currency: null, setupRequired: true});

		// The only connection, holding both accounts, is removed before the owner answers.
		await fixtures.bankAccounts.update(
			bankAccounts.map(({id}) => id),
			{isActive: false},
		);
		await service.reconcileSafely(owner.id, {historySettled: false});

		expect(await read(agent)).toMatchObject({
			currency: null,
			confirmed: false,
			setupRequired: false,
			suggestion: null,
			connectedCurrencies: [],
		});
	});

	it('is ready at once when the owner goes back to a currency every amount is in before the conversion ran', async () => {
		const {owner, agent, connection} = await ownerWithAccounts('EUR');
		const [account] = await fixtures.bankAccounts.find({where: {bankConnection: {id: connection.id}}});
		const [row] = await fixtures.createTransactions(account, booked(1, 1, {amount: '-4.20'}));
		await service.reconcileSafely(owner.id, {historySettled: false});

		await agent.put(ROUTE).send({currency: 'GBP'}).expect(200);
		expect(await read(agent)).toMatchObject({currency: 'GBP', recalculating: true});

		expect((await agent.put(ROUTE).send({currency: 'EUR'}).expect(200)).body).toMatchObject({
			currency: 'EUR',
			confirmed: true,
			recalculating: false,
		});
		expect(await fixtures.transactions.findOneByOrFail({id: row.id})).toMatchObject({
			amountInBaseCurrency: '-4.20',
			baseAmountMethod: 'SAME',
		});
	});

	it('names no currency for amounts read across a change of it', async () => {
		const {owner, agent, connection} = await ownerWithAccounts('GBP');
		const [account] = await fixtures.bankAccounts.find({where: {bankConnection: {id: connection.id}}});
		await fixtures.createTransactions(account, booked(1, 1, {currency: 'GBP', amount: '-4.20'}));
		await service.reconcileSafely(owner.id, {historySettled: false});
		// The account as a request authenticated just before the owner changed currency read it.
		const authenticated = await accounts.findOneByOrFail({id: owner.id});
		const reader = app.get(McpReaderService).forAccount(authenticated);
		expect(await reader.transactionTotals({filters: {}})).toMatchObject({baseCurrency: 'GBP', spending: '4.20'});

		await agent.put(ROUTE).send({currency: 'EUR'}).expect(200);

		expect(await reader.transactionTotals({filters: {}})).toMatchObject({baseCurrency: null});
		expect(await reader.listAccounts()).toEqual([expect.objectContaining({baseCurrency: null})]);
	});

	it('keeps a currency set before owners could choose one', async () => {
		const {owner, agent} = await ownerWithAccounts('EUR', 'GBP');
		await accounts.update({id: owner.id}, {baseCurrency: 'BGN', baseCurrencyState: 'PRESET'});

		await service.reconcileSafely(owner.id, {historySettled: true});
		expect(await read(agent)).toMatchObject({
			currency: 'BGN',
			confirmed: true,
			setupRequired: false,
			// Kept as an option even though amounts can no longer be converted into it.
			options: ['BGN', 'EUR', 'GBP', ...REPORTING_CURRENCIES.filter((code) => code !== 'EUR' && code !== 'GBP')],
		});
		await agent.put(ROUTE).send({currency: 'BGN'}).expect(200);
	});

	it.each([
		['a currency Tempo cannot convert into', 'BGN', REPORTING_CURRENCY_UNSUPPORTED],
		['a code in lower case', 'gbp', /three-letter currency code/],
		['no currency', undefined, /three-letter currency code/],
	])('refuses %s and changes nothing', async (_case, currency, message) => {
		const {owner, agent} = await ownerWithAccounts('EUR', 'GBP');
		await service.reconcileSafely(owner.id, {historySettled: true});
		const before = await read(agent);

		const response = await agent.put(ROUTE).send({currency}).expect(400);

		if (typeof message === 'string') expect(response.body.message).toBe(message);
		else expectValidationMessage(response, message);
		expect(await read(agent)).toEqual(before);
	});

	it("reads and changes only the signed-in owner's currency", async () => {
		const first = await ownerWithAccounts('EUR', 'GBP');
		const second = await ownerWithAccounts('EUR', 'GBP');
		await service.reconcileSafely(first.owner.id, {historySettled: true});
		await service.reconcileSafely(second.owner.id, {historySettled: true});

		await first.agent.put(ROUTE).send({currency: 'GBP'}).expect(200);

		expect(await read(first.agent)).toMatchObject({currency: 'GBP', confirmed: true});
		expect(await read(second.agent)).toMatchObject({currency: null, setupRequired: true});
	});
});
