import {INestApplication} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {getRepositoryToken} from '@nestjs/typeorm';
import {createHash} from 'node:crypto';
import TestAgent from 'supertest/lib/agent';
import type {DeepPartial} from 'typeorm';
import {Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';
import {BANKING_TRANSACTION_BREAKDOWN_RANGE} from '@modules/banking/api/constants/banking-messages.constants';
import type {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {MerchantLogo} from '@modules/banking/merchant-logos/merchant-logo.entity';
import {Merchant} from '@modules/banking/merchant-logos/merchant.entity';

import {BankingFixtures, CURRENCY_EXCHANGE_EVENT, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createVerifiedAccount} from '../../utils/auth-utils';

const BREAKDOWN = '/bank-transactions/breakdown';
const CASH_FLOW = '/bank-transactions/cash-flow';

/** A row from a named merchant; the display name and merchant key follow the name. */
const named = (date: string, amount: string, name: string, overrides: DeepPartial<BankTransaction> = {}) =>
	bookedRow(date, amount, {
		description: name,
		displayDescription: name,
		merchantKey: `${amount.startsWith('-') ? 'EXPENSE' : 'INCOME'}:${name.toLowerCase()}`,
		...overrides,
	});

describe('Bank transaction history', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let accounts: Repository<Account>;

	async function verifiedOwner() {
		const fresh = await createVerifiedAccount(
			app.getHttpServer(),
			app.get(ConfigurationService).get('EMAIL_UI_URL'),
		);
		await accounts.update({id: fresh.id}, {baseCurrency: 'EUR'});
		const bankAccount = await fixtures.createBankAccount(await fixtures.createConnection({id: fresh.id}));
		return {...fresh, bankAccount};
	}

	beforeAll(() => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
	});

	describe('breakdown', () => {
		let agent: TestAgent;
		let otherAgent: TestAgent;
		let ownerId: string;
		const ASOF = '2026-03-10';

		beforeAll(async () => {
			const owner = await verifiedOwner();
			const other = await verifiedOwner();
			agent = owner.agent;
			ownerId = owner.id;
			otherAgent = other.agent;
			const employer = {merchantKey: 'INCOME:example employer'};
			await fixtures.createTransactions(owner.bankAccount, [
				// History starts on 15 November.
				named('2025-11-15', '-50.00', 'Corner Shop', {category: 'FOOD_AND_DRINK'}),
				named('2025-11-20', '1000.00', 'Example Employer', {category: 'INCOME', ...employer}),
				named('2025-12-05', '-30.00', 'Corner Shop', {category: 'FOOD_AND_DRINK'}),
				named('2025-12-10', '-200.00', 'Example Store', {category: 'SHOPPING'}),
				named('2025-12-12', '40.00', 'Example Store', {category: 'REFUND'}),
				named('2025-12-20', '1000.00', 'EXAMPLE EMPLOYER PAYROLL', {category: 'INCOME', ...employer}),
				// No merchant key: the source falls back to the display name.
				named('2025-12-22', '25.00', 'Market Stall', {category: null, merchantKey: null}),
				named('2026-01-08', '-80.00', 'Unknown Place', {category: null}),
				named('2026-01-20', '1000.00', 'Example Employer', {category: 'INCOME', ...employer}),
				// Left out: an own transfer, a currency exchange and a row without a base amount.
				named('2026-01-09', '-500.00', 'Own Savings', {category: null, ownTransferEvidence: 'IBAN'}),
				named('2026-01-09', '500.00', 'Own Savings', {category: null, ownTransferEvidence: 'IBAN'}),
				named('2026-01-10', '-300.00', 'Exchange', {
					category: null,
					categoryStatus: 'NOT_APPLICABLE',
					...CURRENCY_EXCHANGE_EVENT,
				}),
				named('2026-01-11', '-999.00', 'Foreign Shop', {category: 'SHOPPING', amountInBaseCurrency: null}),
				named('2026-02-03', '60.00', 'Example Store', {category: 'REFUND'}),
				named('2026-02-04', '-10.00', 'Corner Shop', {category: 'FOOD_AND_DRINK'}),
				// A person paying the owner back.
				named('2026-02-10', '150.00', 'Jane Example', {category: 'TRANSFER_IN'}),
				named('2026-03-02', '-20.00', 'Corner Shop', {category: 'FOOD_AND_DRINK'}),
			]);
			await fixtures.createTransactions(other.bankAccount, [
				named('2026-01-05', '-7777.00', 'Corner Shop', {category: 'FOOD_AND_DRINK'}),
				named('2026-01-06', '5555.00', 'Example Employer', {category: 'INCOME', ...employer}),
			]);
		});

		it('splits each month’s spending by category, net of refunds, with cash flow’s totals', async () => {
			const query = {interval: 'month', from: '2025-10-01', to: ASOF, asOf: ASOF};
			const [{body}, {body: flow}] = await Promise.all([
				agent
					.get(BREAKDOWN)
					.query({...query, by: 'category'})
					.expect(200),
				agent.get(CASH_FLOW).query(query).expect(200),
			]);

			const part = (key: string, amount: string) => ({key, label: key, amount});
			expect(body).toEqual({
				baseCurrency: 'EUR',
				interval: 'month',
				by: 'category',
				periods: [
					// October is before the history; November starts inside it, so it is partial.
					{
						start: '2025-11-01',
						end: '2025-11-30',
						complete: false,
						total: '50.00',
						parts: [part('FOOD_AND_DRINK', '50.00')],
					},
					{
						start: '2025-12-01',
						end: '2025-12-31',
						complete: true,
						total: '190.00',
						parts: [part('SHOPPING', '200.00'), part('FOOD_AND_DRINK', '30.00'), part('REFUND', '-40.00')],
					},
					{
						start: '2026-01-01',
						end: '2026-01-31',
						complete: true,
						total: '80.00',
						parts: [part('UNCATEGORIZED', '80.00')],
					},
					{
						start: '2026-02-01',
						end: '2026-02-28',
						complete: true,
						total: '-50.00',
						parts: [part('FOOD_AND_DRINK', '10.00'), part('REFUND', '-60.00')],
					},
					{
						start: '2026-03-01',
						end: ASOF,
						complete: false,
						total: '20.00',
						parts: [part('FOOD_AND_DRINK', '20.00')],
					},
				],
			});
			expect(body.periods.map(({start, total}: {start: string; total: string}) => [start, total])).toEqual(
				flow.periods.map(({start, spending}: {start: string; spending: string}) => [start, spending]),
			);
		});

		it('splits each year’s income by source, labelled by its most common name and shown with its latest merchant’s logo', async () => {
			// The employer has a trusted logo; the person and the source without a merchant key have none.
			const merchants = app.get<Repository<Merchant>>(getRepositoryToken(Merchant));
			const logos = app.get<Repository<MerchantLogo>>(getRepositoryToken(MerchantLogo));
			const image = Buffer.from('synthetic logo');
			const logo = await logos.save(
				logos.create({
					domain: 'employer.example.test',
					status: 'READY',
					image,
					version: createHash('sha256').update(image).digest('hex'),
					siteNames: ['Example Employer'],
					homepageLoaded: true,
					sourceSize: 256,
					retryAfter: new Date(0),
				}),
			);
			await merchants.save([
				merchants.create({
					accountId: ownerId,
					key: 'example employer',
					status: 'IDENTIFIED',
					brand: 'Example Employer',
					domain: logo.domain,
					domainConfident: true,
					logoId: logo.id,
				}),
				merchants.create({accountId: ownerId, key: 'jane example', status: 'NONE'}),
			]);
			const config = app.get(ConfigService);
			config.set('MERCHANT_LOGOS_ENABLED', true);
			const query = {interval: 'year', from: '2025-01-01', to: ASOF, asOf: ASOF};
			try {
				const [{body}, {body: flow}] = await Promise.all([
					agent
						.get(BREAKDOWN)
						.query({...query, by: 'source'})
						.expect(200),
					agent.get(CASH_FLOW).query(query).expect(200),
				]);

				const employer = {
					key: 'INCOME:example employer',
					label: 'Example Employer',
					merchantLogoUrl: `/merchant-logos/${logo.id}/${logo.version}`,
					category: 'INCOME',
				};
				const stall = {key: 'Market Stall', label: 'Market Stall', merchantLogoUrl: null, category: null};
				const person = {
					key: 'INCOME:jane example',
					label: 'Jane Example',
					merchantLogoUrl: null,
					category: 'TRANSFER_IN',
				};
				expect(body).toEqual({
					baseCurrency: 'EUR',
					interval: 'year',
					by: 'source',
					periods: [
						{
							start: '2025-01-01',
							end: '2025-12-31',
							complete: false,
							total: '2025.00',
							parts: [
								{...employer, amount: '2000.00'},
								{...stall, amount: '25.00'},
							],
						},
						{
							start: '2026-01-01',
							end: ASOF,
							complete: false,
							total: '1150.00',
							parts: [
								{...employer, amount: '1000.00'},
								{...person, amount: '150.00'},
							],
						},
					],
				});
				expect(body.periods.map(({total}: {total: string}) => total)).toEqual(
					flow.periods.map(({income}: {income: string}) => income),
				);
			} finally {
				config.set('MERCHANT_LOGOS_ENABLED', false);
			}
		});

		it('leaves out another owner’s rows', async () => {
			const {body} = await otherAgent
				.get(BREAKDOWN)
				.query({interval: 'year', by: 'category', from: '2025-01-01', to: ASOF, asOf: ASOF})
				.expect(200);
			expect(body.periods).toEqual([
				{
					start: '2026-01-01',
					end: ASOF,
					complete: false,
					total: '7777.00',
					parts: [{key: 'FOOD_AND_DRINK', label: 'FOOD_AND_DRINK', amount: '7777.00'}],
				},
			]);
		});

		it.each([
			['240 months', {interval: 'month', from: '2006-04-01', to: ASOF, asOf: ASOF}],
			['20 years', {interval: 'year', from: '2007-01-01', to: ASOF, asOf: ASOF}],
		])('accepts exactly %s', async (_case, query) => {
			await agent
				.get(BREAKDOWN)
				.query({...query, by: 'category'})
				.expect(200);
		});

		it.each([
			['a range that runs backwards', {interval: 'month', from: '2026-03-02', to: '2026-03-01', asOf: ASOF}],
			['more than 240 months', {interval: 'month', from: '2006-03-31', to: ASOF, asOf: ASOF}],
			['more than 20 years', {interval: 'year', from: '2006-12-31', to: ASOF, asOf: ASOF}],
			['an end after the given date', {interval: 'month', from: '2026-01-01', to: '2026-03-11', asOf: ASOF}],
		])('explains why it rejects %s', async (_case, query) => {
			const {body} = await agent
				.get(BREAKDOWN)
				.query({...query, by: 'category'})
				.expect(400);
			expect(body.message).toBe(BANKING_TRANSACTION_BREAKDOWN_RANGE);
		});

		it.each([
			['weeks', {interval: 'week', by: 'category'}],
			['an unknown dimension', {interval: 'month', by: 'merchant'}],
			['a missing dimension', {interval: 'month'}],
			['an impossible day', {interval: 'month', by: 'category', to: '2026-02-30'}],
		])('rejects %s', async (_case, query) => {
			await agent
				.get(BREAKDOWN)
				.query({from: '2026-01-01', to: ASOF, asOf: ASOF, ...query})
				.expect(400);
		});
	});
});
