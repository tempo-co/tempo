import {getQueueToken} from '@nestjs/bullmq';
import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Queue} from 'bullmq';
import {Server} from 'node:net';
import sharp from 'sharp';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {MERCHANT_LOGO_QUEUE} from '@core/queue/queue.constants';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BankTransactionCategorizationUnavailableError} from '@modules/banking/categorization/bank-transaction-categorization.provider';
import {
	MerchantIdentification,
	MerchantIdentificationInput,
} from '@modules/banking/categorization/bank-transaction-categorization.types';
import {ClaudeBankTransactionCategorizationProvider} from '@modules/banking/categorization/providers/claude-bank-transaction-categorization.provider';
import {MerchantLogo} from '@modules/banking/merchant-logos/merchant-logo.entity';
import {MerchantLogoService} from '@modules/banking/merchant-logos/merchant-logo.service';
import {MerchantSiteFetcher, MerchantSiteResponse} from '@modules/banking/merchant-logos/merchant-site-fetcher';
import {Merchant} from '@modules/banking/merchant-logos/merchant.entity';

import {BankingFixtures, bookedRow} from '../../../scripts/seed-data/banking-fixtures';
import {enableMerchantLogosE2e, getApp} from '../../setup/e2e.setup';
import {createVerifiedAccount} from '../../utils/auth-utils';
import {waitFor} from '../../utils/wait-utils';

enableMerchantLogosE2e();

/** What the fake model answers per sanitized merchant name, ignoring a card terminal number. */
const IDENTITIES: Record<string, Omit<MerchantIdentification, 'correlationId'>> = {
	'Example Shop': {kind: 'BUSINESS', brand: 'Example Shop', domain: 'shop.example.test'},
	'Other Example Shop': {kind: 'BUSINESS', brand: 'Other Example Shop', domain: 'other-shop.example.test'},
	'Jane Example': {kind: 'PERSON', brand: null, domain: null},
	Exampleshop: {kind: 'BUSINESS', brand: 'Exampleshop', domain: 'exampleshop.test'},
};

describe('Merchant logos', () => {
	jest.setTimeout(30_000);

	let app: INestApplication<Server>;
	let fixtures: BankingFixtures;
	let merchants: Repository<Merchant>;
	let logos: Repository<MerchantLogo>;
	let owner: {id: string; agent: TestAgent};
	let other: {id: string; agent: TestAgent};
	let icon: Buffer;
	let identifySpy: jest.SpyInstance;
	let fetchSpy: jest.SpyInstance;
	let queue: Queue;
	let routesUnavailable = false;
	/** Hostnames whose pages and icons currently fail to load. */
	const unreachable = new Set<string>();

	beforeAll(async () => {
		app = getApp();
		const config = app.get(ConfigurationService);
		expect(config.get('MERCHANT_LOGOS_ENABLED')).toBe(true);
		fixtures = new BankingFixtures(app);
		merchants = app.get(getRepositoryToken(Merchant));
		logos = app.get(getRepositoryToken(MerchantLogo));
		queue = app.get(getQueueToken(MERCHANT_LOGO_QUEUE));
		owner = await createVerifiedAccount(app.getHttpServer(), config.get('EMAIL_UI_URL'));
		other = await createVerifiedAccount(app.getHttpServer(), config.get('EMAIL_UI_URL'));
		icon = await sharp({create: {width: 180, height: 180, channels: 4, background: '#cc3322'}})
			.png()
			.toBuffer();

		identifySpy = jest
			.spyOn(app.get(ClaudeBankTransactionCategorizationProvider), 'identifyMerchants')
			.mockImplementation(async (inputs: readonly MerchantIdentificationInput[]) => {
				if (routesUnavailable) throw new BankTransactionCategorizationUnavailableError();
				return inputs.map(({correlationId, name}) => ({
					correlationId,
					...(IDENTITIES[name.replace(/\s+\d+$/, '')] ?? {kind: 'UNCLEAR', brand: null, domain: null}),
				}));
			});
		const sites: Record<string, MerchantSiteResponse> = {
			'https://shop.example.test/': {
				url: 'https://www.shop.example.test/',
				bytes: Buffer.from(
					'<title>Example Shop | Groceries</title><link rel="apple-touch-icon" href="/touch.png">',
				),
			},
			'https://www.shop.example.test/touch.png': {
				url: 'https://www.shop.example.test/touch.png',
				bytes: icon,
			},
			// Its icon loads, but its homepage is unreachable during the test that uses it.
			'https://exampleshop.test/favicon.ico': {
				url: 'https://exampleshop.test/favicon.ico',
				bytes: icon,
			},
			'https://exampleshop.test/': {
				url: 'https://exampleshop.test/',
				bytes: Buffer.from('<p>Welcome</p>'),
			},
			// The model named a site that calls itself something else.
			'https://other-shop.example.test/': {
				url: 'https://other-shop.example.test/',
				bytes: Buffer.from('<title>Unrelated Business</title>'),
			},
			'https://other-shop.example.test/favicon.ico': {
				url: 'https://other-shop.example.test/favicon.ico',
				bytes: icon,
			},
		};
		fetchSpy = jest.spyOn(app.get(MerchantSiteFetcher), 'fetch').mockImplementation(async (url: string) => {
			const site = sites[url];
			if (!site || unreachable.has(new URL(url).hostname)) throw new Error('not found');
			return site;
		});
	});

	afterEach(() => {
		routesUnavailable = false;
		unreachable.clear();
	});

	it('shows a synced merchant’s official logo on its purchases and refunds, to its owner only', async () => {
		const connection = await fixtures.createConnection({id: owner.id});
		const bankAccount = await fixtures.createBankAccount(connection);
		const [purchase, refund, person, ownTransfer] = await fixtures.createTransactions(bankAccount, [
			bookedRow('2026-10-01', '-12.40', {
				description: 'BEA, Betaalpas Example Shop 01,PAS123 NR:XX000, 01.10.26/12:00 Example City',
				transactionType: 'CARD_PAYMENT',
			}),
			bookedRow('2026-10-03', '12.40', {
				description: 'BEA, Betaalpas Example Shop 02,PAS123 NR:XX001, 03.10.26/12:00 Example City',
				transactionType: 'REFUND',
			}),
			bookedRow('2026-10-04', '-20.00', {counterpartyName: 'Jane Example', transactionType: 'TRANSFER'}),
			// Money moved to the owner's own account held with the same business shares its merchant key.
			bookedRow('2026-10-05', '-50.00', {
				counterpartyName: 'Example Shop',
				transactionType: 'TRANSFER',
				ownTransferEvidence: 'IBAN',
			}),
		]);
		expect(purchase.merchantKey).toBe('EXPENSE:example shop');
		expect(refund.merchantKey).toBe('INCOME:example shop');
		expect(ownTransfer.merchantKey).toBe('EXPENSE:example shop');

		await app.get(MerchantLogoService).enqueueForOwnerSafely(owner.id);

		const listed = await waitFor(
			() => owner.agent.get('/bank-transactions').expect(200),
			(response) =>
				response.body.transactions.find(({id}: BankTransaction) => id === purchase.id)?.merchantLogoUrl !==
				null,
		);
		const logoOf = (id: string) =>
			listed.body.transactions.find((row: BankTransaction & {merchantLogoUrl: string | null}) => row.id === id)
				?.merchantLogoUrl;
		const logoUrl: string = logoOf(purchase.id);
		expect(logoUrl).toMatch(/^\/merchant-logos\/[0-9a-f-]{36}\/[0-9a-f]{64}$/);
		expect(logoOf(refund.id)).toBe(logoUrl);
		expect(logoOf(person.id)).toBeNull();
		expect(logoOf(ownTransfer.id)).toBeNull();

		// One model call for both merchants of the owner, with sanitized names and no amounts or references.
		expect(identifySpy).toHaveBeenCalledTimes(1);
		expect(identifySpy.mock.calls[0][0]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({name: 'Example Shop 02', location: 'Example City', direction: 'INCOME'}),
				expect.objectContaining({name: 'Jane Example', location: null}),
			]),
		);
		expect(JSON.stringify(identifySpy.mock.calls)).not.toMatch(/12\.40|PAS123|XX000/);
		expect(await merchants.findBy({accountId: owner.id})).toEqual(
			expect.arrayContaining([
				expect.objectContaining({key: 'example shop', status: 'IDENTIFIED', brand: 'Example Shop'}),
				expect.objectContaining({key: 'jane example', status: 'NONE', logoId: null}),
			]),
		);
		expect(await merchants.countBy({accountId: owner.id})).toBe(2);

		const detail = await owner.agent.get(`/bank-transactions/${purchase.id}`).expect(200);
		expect(detail.body.merchantLogoUrl).toBe(logoUrl);
		const connectionRows = await owner.agent.get(`/bank-connections/${connection.id}/transactions`).expect(200);
		expect(connectionRows.body.transactions).toEqual(
			expect.arrayContaining([expect.objectContaining({id: purchase.id, merchantLogoUrl: logoUrl})]),
		);

		const image = await owner.agent
			.get(logoUrl)
			.buffer(true)
			.parse((response, callback) => {
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () => callback(null, Buffer.concat(chunks)));
			})
			.expect(200)
			.expect('Content-Type', 'image/png')
			.expect('Cache-Control', 'private, max-age=31536000, immutable');
		expect(await sharp(image.body as Buffer).metadata()).toMatchObject({format: 'png', width: 128, height: 128});

		const refused = await other.agent.get(logoUrl).expect(404);
		expect(refused.headers).not.toHaveProperty('cache-control');
		await owner.agent.get(logoUrl.replace(/[0-9a-f]{64}$/, 'b'.repeat(64))).expect(404);
		await request(app.getHttpServer()).get(logoUrl).expect(401);

		// A refresh while the site is down keeps the logo and the names that confirmed it.
		const logo = await logos.findOneByOrFail({domain: 'shop.example.test'});
		await logos.update(logo.id, {retryAfter: new Date()});
		unreachable.add('www.shop.example.test');
		unreachable.add('shop.example.test');
		await app.get(MerchantLogoService).fetchLogo(logo.id);
		expect(await logos.findOneByOrFail({id: logo.id})).toMatchObject({
			status: 'READY',
			version: logo.version,
			siteNames: ['Example Shop | Groceries'],
			attempts: 1,
		});
		const refreshed = await owner.agent.get(`/bank-transactions/${purchase.id}`).expect(200);
		expect(refreshed.body.merchantLogoUrl).toBe(logoUrl);
	});

	it('shows no logo when the named website does not call itself the brand or its homepage does not load', async () => {
		const connection = await fixtures.createConnection({id: other.id});
		const bankAccount = await fixtures.createBankAccount(connection);
		const transaction = await fixtures.createTransaction(
			bankAccount,
			bookedRow('2026-10-02', '-8.00', {
				description: 'BEA, Betaalpas Other Example Shop,PAS123 NR:XX002, 02.10.26/09:00 Example City',
				transactionType: 'CARD_PAYMENT',
			}),
		);

		await app.get(MerchantLogoService).enqueueForOwnerSafely(other.id);
		await waitFor(
			() => logos.findOneBy({domain: 'other-shop.example.test'}),
			(logo) => logo?.status === 'READY',
		);

		const response = await other.agent.get(`/bank-transactions/${transaction.id}`).expect(200);
		expect(response.body.merchantLogoUrl).toBeNull();
		expect(fetchSpy).toHaveBeenCalledWith('https://other-shop.example.test/', expect.anything());

		// A site whose hostname spells the brand still needs a homepage that loads, even when its icon does.
		const unconfirmed = await fixtures.createTransaction(
			bankAccount,
			bookedRow('2026-10-03', '-9.00', {
				description: 'BEA, Betaalpas Exampleshop,PAS123 NR:XX004, 03.10.26/09:00 Example City',
				transactionType: 'CARD_PAYMENT',
			}),
		);
		unreachable.add('exampleshop.test');
		await app.get(MerchantLogoService).enqueueForOwnerSafely(other.id);
		const logo = await waitFor(
			() => logos.findOneBy({domain: 'exampleshop.test'}),
			(row) => row?.attempts === 1,
		);
		expect(logo).toMatchObject({status: 'PENDING', version: null});
		const unconfirmedResponse = await other.agent.get(`/bank-transactions/${unconfirmed.id}`).expect(200);
		expect(unconfirmedResponse.body.merchantLogoUrl).toBeNull();
	});

	it('keeps merchants pending while both model routes are unavailable and identifies them once one recovers', async () => {
		const account = await createVerifiedAccount(
			app.getHttpServer(),
			app.get(ConfigurationService).get('EMAIL_UI_URL'),
		);
		const connection = await fixtures.createConnection({id: account.id});
		const bankAccount = await fixtures.createBankAccount(connection);
		const transaction = await fixtures.createTransaction(
			bankAccount,
			bookedRow('2026-10-06', '-3.10', {
				description: 'BEA, Betaalpas Example Shop,PAS123 NR:XX003, 06.10.26/08:00 Example City',
				transactionType: 'CARD_PAYMENT',
			}),
		);
		routesUnavailable = true;
		identifySpy.mockClear();

		await app.get(MerchantLogoService).enqueueForOwnerSafely(account.id);
		await waitFor(
			async () => identifySpy.mock.calls.length,
			(calls) => calls === 1,
		);
		await waitFor(
			() => queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized'),
			(counts) => Object.values(counts).every((count) => count === 0),
		);
		expect(await merchants.findOneByOrFail({accountId: account.id})).toMatchObject({
			status: 'PENDING',
			attempts: 0,
		});

		routesUnavailable = false;
		await app.get(MerchantLogoService).reconcile();
		const response = await waitFor(
			() => account.agent.get(`/bank-transactions/${transaction.id}`).expect(200),
			(result) => result.body.merchantLogoUrl !== null,
		);
		// The shared site was fetched once for the first owner; this owner's merchant reuses its logo.
		expect(response.body.merchantLogoUrl).toMatch(/^\/merchant-logos\//);
		expect(await logos.countBy({domain: 'shop.example.test'})).toBe(1);
	});
});
