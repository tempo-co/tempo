import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {createHash} from 'node:crypto';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {
	MERCHANT_GROUP_ID_INVALID,
	MERCHANT_NOT_FOUND,
	MERCHANT_RANKING_FUTURE_PERIOD,
} from '@modules/banking/api/constants/banking-messages.constants';
import {Merchant} from '@modules/banking/merchant-logos/merchant.entity';

import {BankingFixtures, CURRENCY_EXCHANGE_EVENT, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {
	SESSION_TEST_ACCOUNT_EMAIL,
	SESSION_TEST_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

const md5 = (value: string) => createHash('md5').update(value).digest('hex');
const BURGER = `b_${md5('example burger')}`;
const FRIEND = `k_${md5('alex example')}`;
const CORNER = `k_${md5('corner shop')}`;

describe('Merchant spending', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let merchants: Repository<Merchant>;
	let owner: Account;
	let otherOwner: Account;
	let ownerAgent: TestAgent;
	let otherAgent: TestAgent;

	async function removeData() {
		const accountIds = [owner.id, otherOwner.id];
		await fixtures.connections
			.createQueryBuilder()
			.delete()
			.where('accountId IN (:...accountIds)', {accountIds})
			.execute();
		await merchants.createQueryBuilder().delete().where('accountId IN (:...accountIds)', {accountIds}).execute();
	}

	beforeAll(async () => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		merchants = app.get(getRepositoryToken(Merchant));
		const accounts: Repository<Account> = app.get(getRepositoryToken(Account));
		const accountService = app.get(AccountService);
		owner = (await accountService.findByEmail(VERIFIED_ACCOUNT_EMAIL))!;
		otherOwner = (await accountService.findByEmail(SESSION_TEST_ACCOUNT_EMAIL))!;
		ownerAgent = await loginAgent(app.getHttpServer(), VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		otherAgent = await loginAgent(app.getHttpServer(), SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);

		await removeData();
		await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});
		await accounts.update({id: otherOwner.id}, {baseCurrency: 'EUR'});
		const ownerBankAccount = await fixtures.createBankAccount(await fixtures.createConnection(owner));
		const otherBankAccount = await fixtures.createBankAccount(await fixtures.createConnection(otherOwner));

		// One brand under two keys, spelled differently; a third key of the brand has no rows yet.
		await merchants.save([
			{accountId: owner.id, key: 'example burger nl', status: 'IDENTIFIED', brand: 'Example Burger'},
			{accountId: owner.id, key: 'example burger online', status: 'IDENTIFIED', brand: 'EXAMPLE BURGER '},
			{accountId: owner.id, key: 'example burger station', status: 'IDENTIFIED', brand: 'Example Burger'},
			{accountId: owner.id, key: 'alex example', status: 'NONE', brand: null},
			{accountId: otherOwner.id, key: 'example burger nl', status: 'IDENTIFIED', brand: 'Example Burger'},
		]);
		const burgerNl = {merchantKey: 'EXPENSE:example burger nl', description: 'Example Burger NL'};
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-08-20', '-4.00', {merchantKey: 'EXPENSE:corner shop', description: 'Corner Shop'}),
			bookedRow('2026-09-10', '-10.00', {...burgerNl, category: 'FOOD_AND_DRINK'}),
			bookedRow('2026-10-03', '-13.50', {
				merchantKey: 'EXPENSE:example burger online',
				description: 'Example Burger Online',
				category: 'FOOD_AND_DRINK',
			}),
			bookedRow('2026-10-05', '-50.00', {
				merchantKey: 'EXPENSE:alex example',
				description: 'Transfer to Alex Example',
				category: 'TRANSFER_OUT',
			}),
			bookedRow('2026-10-06', '20.00', {
				merchantKey: 'INCOME:alex example',
				description: 'Transfer from Alex Example',
				category: 'TRANSFER_IN',
			}),
			// An own transfer and a currency exchange never count toward a merchant, whatever their key.
			bookedRow('2026-10-07', '-100.00', {
				merchantKey: 'EXPENSE:alex example',
				description: 'Transfer to Alex Example',
				category: null,
				ownTransferEvidence: 'NAME',
			}),
			bookedRow('2026-10-08', '-40.00', {
				merchantKey: 'EXPENSE:corner shop',
				category: null,
				categoryStatus: 'NOT_APPLICABLE',
				...CURRENCY_EXCHANGE_EVENT,
			}),
			bookedRow('2026-10-12', '-7.50', {...burgerNl, category: 'FOOD_AND_DRINK'}),
			bookedRow('2026-10-14', '5.00', {...burgerNl, merchantKey: 'INCOME:example burger nl', category: 'REFUND'}),
			bookedRow('2026-10-15', '-6.00', {merchantKey: 'EXPENSE:corner shop', description: 'Corner Shop'}),
			bookedRow('2026-10-16', '-9.99', {
				merchantKey: 'EXPENSE:corner shop',
				description: 'Corner Shop',
				amountInBaseCurrency: null,
			}),
		]);
		await fixtures.createTransactions(otherBankAccount, [bookedRow('2026-10-04', '-999.00', burgerNl)]);
	});

	afterAll(async () => {
		await removeData();
	});

	it('lists every merchant group of the owner, most spent first, and searches names and variants', async () => {
		const {body} = await ownerAgent.get('/merchants').expect(200);
		expect(body).toEqual({
			baseCurrency: 'EUR',
			total: 3,
			merchants: [
				{
					id: FRIEND,
					name: 'Transfer from Alex Example',
					kind: 'MERCHANT',
					logoUrl: null,
					spent: '50.00',
					received: '20.00',
					count: 2,
					lastDate: '2026-10-06',
				},
				{
					id: BURGER,
					name: 'Example Burger',
					kind: 'BRAND',
					logoUrl: null,
					spent: '26.00',
					received: '0.00',
					count: 4,
					lastDate: '2026-10-14',
				},
				{
					id: CORNER,
					name: 'Corner Shop',
					kind: 'MERCHANT',
					logoUrl: null,
					spent: '10.00',
					received: '0.00',
					count: 3,
					lastDate: '2026-10-16',
				},
			],
		});

		const search = await ownerAgent.get('/merchants').query({search: 'ONLINE'}).expect(200);
		expect(search.body.merchants.map(({id}: {id: string}) => id)).toEqual([BURGER]);
		const page = await ownerAgent.get('/merchants').query({offset: '1', limit: '1'}).expect(200);
		expect(page.body).toMatchObject({total: 3, merchants: [{id: BURGER}]});

		const other = await otherAgent.get('/merchants').expect(200);
		expect(other.body.merchants).toEqual([expect.objectContaining({id: BURGER, spent: '999.00', count: 1})]);
	});

	it('shows a group’s all-time totals and variants, reconciling with the transactions filtered by it', async () => {
		const {body} = await ownerAgent.get(`/merchants/${BURGER}`).expect(200);
		expect(body).toEqual({
			id: BURGER,
			name: 'Example Burger',
			kind: 'BRAND',
			logoUrl: null,
			baseCurrency: 'EUR',
			spent: '26.00',
			received: '0.00',
			paid: '31.00',
			refunded: '5.00',
			count: 4,
			paymentCount: 3,
			averagePayment: '10.33',
			firstDate: '2026-09-10',
			lastDate: '2026-10-14',
			excluded: {unknownDirection: 0, missingBaseAmount: 0},
			variants: [
				{
					key: 'example burger online',
					name: 'Example Burger Online',
					spent: '13.50',
					received: '0.00',
					count: 1,
					lastDate: '2026-10-03',
				},
				{
					key: 'example burger nl',
					name: 'Example Burger NL',
					spent: '12.50',
					received: '0.00',
					count: 3,
					lastDate: '2026-10-14',
				},
			],
		});

		const totals = await ownerAgent
			.get('/bank-transactions/totals')
			.query({'filter[merchantGroup]': BURGER})
			.expect(200);
		expect(totals.body).toMatchObject({spending: body.spent, count: body.count});

		const corner = await ownerAgent.get(`/merchants/${CORNER}`).expect(200);
		expect(corner.body).toMatchObject({spent: '10.00', count: 3, excluded: {missingBaseAmount: 1}});

		const list = await ownerAgent
			.get('/bank-transactions')
			.query({'filter[merchantGroup]': FRIEND, 'pagination[pageSize]': '100'})
			.expect(200);
		expect(list.body.total).toBe(2);
		expect(list.body.transactions.map(({merchantGroupId}: {merchantGroupId: string}) => merchantGroupId)).toEqual([
			FRIEND,
			FRIEND,
		]);
		const ownTransfer = await ownerAgent
			.get('/bank-transactions')
			.query({'filter[cashFlows][]': 'OWN_TRANSFER'})
			.expect(200);
		expect(ownTransfer.body.transactions).toEqual([expect.objectContaining({merchantGroupId: null})]);
	});

	it('refuses malformed ids, other owners’ groups and malformed filters', async () => {
		const malformed = await ownerAgent.get('/merchants/not-a-group').expect(400);
		expect(malformed.body.message).toBe(MERCHANT_GROUP_ID_INVALID);
		const unknown = await ownerAgent.get(`/merchants/k_${md5('example unknown')}`).expect(404);
		expect(unknown.body.message).toBe(MERCHANT_NOT_FOUND);
		await otherAgent.get(`/merchants/${FRIEND}`).expect(404);
		await otherAgent
			.get(`/merchants/${FRIEND}/periods`)
			.query({interval: 'month', from: '2026-08-01', to: '2026-10-18', asOf: '2026-10-18'})
			.expect(404);
		await ownerAgent.get('/bank-transactions').query({'filter[merchantGroup]': 'x_1'}).expect(400);
	});

	it('totals a group per period from the owner’s first booking', async () => {
		const {body} = await ownerAgent
			.get(`/merchants/${BURGER}/periods`)
			.query({interval: 'month', from: '2026-07-01', to: '2026-10-18', asOf: '2026-10-18'})
			.expect(200);
		expect(body).toEqual({
			baseCurrency: 'EUR',
			interval: 'month',
			periods: [
				{start: '2026-08-01', end: '2026-08-31', complete: false, spent: '0.00', received: '0.00', count: 0},
				{start: '2026-09-01', end: '2026-09-30', complete: true, spent: '10.00', received: '0.00', count: 1},
				{start: '2026-10-01', end: '2026-10-18', complete: false, spent: '16.00', received: '0.00', count: 3},
			],
		});
	});

	it('ranks a running period against the same days of earlier periods', async () => {
		const {body} = await ownerAgent
			.get('/merchants/ranking')
			.query({interval: 'month', period: '2026-10-01', asOf: '2026-10-18', limit: '2'})
			.expect(200);
		expect(body).toEqual({
			baseCurrency: 'EUR',
			interval: 'month',
			start: '2026-10-01',
			end: '2026-10-31',
			through: '2026-10-18',
			baselinePeriods: ['2026-08-01', '2026-09-01'],
			total: 3,
			merchants: [
				{
					id: FRIEND,
					name: 'Transfer from Alex Example',
					kind: 'MERCHANT',
					logoUrl: null,
					spent: '50.00',
					count: 2,
					usual: '0.00',
					change: '50.00',
				},
				// September's payment falls before the 18th; August's corner shop payment after it.
				{
					id: BURGER,
					name: 'Example Burger',
					kind: 'BRAND',
					logoUrl: null,
					spent: '16.00',
					count: 3,
					usual: '5.00',
					change: '11.00',
				},
			],
		});

		const past = await ownerAgent
			.get('/merchants/ranking')
			.query({interval: 'month', period: '2026-09-05', asOf: '2026-10-18'})
			.expect(200);
		expect(past.body).toMatchObject({
			through: '2026-09-30',
			baselinePeriods: ['2026-08-01'],
			total: 1,
			merchants: [{id: BURGER, spent: '10.00', usual: '0.00', change: '10.00'}],
		});

		const future = await ownerAgent
			.get('/merchants/ranking')
			.query({interval: 'month', period: '2026-11-01', asOf: '2026-10-18'})
			.expect(400);
		expect(future.body.message).toBe(MERCHANT_RANKING_FUTURE_PERIOD);
	});
});
