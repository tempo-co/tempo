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
import {LogoDevClient, LogoDevResult} from '@modules/banking/merchant-logos/logo-dev.client';
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
	'Example Shop': {kind: 'BUSINESS', brand: 'Example Shop', domain: 'shop.example.test', domainConfident: true},
	// A branch of the same brand whose own site the model could not name.
	'Example Shop Station': {kind: 'BUSINESS', brand: 'Example Shop', domain: null, domainConfident: false},
	'Example Pay': {kind: 'PAYMENT_SERVICE', brand: 'Example Pay', domain: 'pay.example.test', domainConfident: true},
	'Other Example Shop': {
		kind: 'BUSINESS',
		brand: 'Other Example Shop',
		domain: 'other-shop.example.test',
		domainConfident: true,
	},
	'Jane Example': {kind: 'PERSON', brand: null, domain: null, domainConfident: false},
	Exampleshop: {kind: 'BUSINESS', brand: 'Exampleshop', domain: 'exampleshop.test', domainConfident: false},
	'Walled Example': {kind: 'BUSINESS', brand: 'Walled Example', domain: 'walled.example.test', domainConfident: true},
};

const FAVICON_SERVICE = 'https://icons.duckduckgo.com/ip3/';
const LOGO_DEV_ASSET = 'https://img.logo.dev/assets/';
const DAY_MS = 24 * 60 * 60 * 1000;

/** What logo.dev knows per domain: a vector logo, only a small original, still indexing, or nothing. */
const LOGO_DEV: Record<string, LogoDevResult> = {
	'shop.example.test': {status: 'found', url: `${LOGO_DEV_ASSET}shop?format=png&size=256`, size: 512},
	'walled.example.test': {status: 'found', url: `${LOGO_DEV_ASSET}walled?format=png&size=256`, size: 48},
	'exampleshop.test': {status: 'later', retryAfterMs: DAY_MS},
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
	let smallIcon: Buffer;
	let largeIcon: Buffer;
	let identifySpy: jest.SpyInstance;
	let fetchSpy: jest.SpyInstance;
	let queue: Queue;
	let routesUnavailable = false;
	/** Hostnames whose pages and icons currently fail to load. */
	const unreachable = new Set<string>();
	/** Hostnames whose homepage refuses the server while their other files still load, like a bot wall. */
	const walledHomepages = new Set<string>();
	/** logo.dev answers that replace the usual ones for a domain. */
	const logoDevNow = new Map<string, LogoDevResult>();

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
		largeIcon = await sharp({create: {width: 256, height: 256, channels: 4, background: '#22aa33'}})
			.png()
			.toBuffer();
		smallIcon = await sharp({create: {width: 32, height: 32, channels: 4, background: '#2233cc'}})
			.png()
			.toBuffer();

		identifySpy = jest
			.spyOn(app.get(ClaudeBankTransactionCategorizationProvider), 'identifyMerchants')
			.mockImplementation(async (inputs: readonly MerchantIdentificationInput[]) => {
				if (routesUnavailable) throw new BankTransactionCategorizationUnavailableError();
				return inputs.map(({correlationId, name}) => ({
					correlationId,
					...(IDENTITIES[name.replace(/\s+\d+$/, '')] ?? {
						kind: 'UNCLEAR',
						brand: null,
						domain: null,
						domainConfident: false,
					}),
				}));
			});
		jest.spyOn(app.get(LogoDevClient), 'findLogo').mockImplementation(
			async (domain: string) => logoDevNow.get(domain) ?? LOGO_DEV[domain] ?? {status: 'none'},
		);
		const sites: Record<string, MerchantSiteResponse> = {
			// logo.dev's downloads, enlarged to the requested size whatever the original's.
			[`${LOGO_DEV_ASSET}shop?format=png&size=256`]: {url: `${LOGO_DEV_ASSET}shop`, bytes: largeIcon},
			[`${LOGO_DEV_ASSET}walled?format=png&size=256`]: {url: `${LOGO_DEV_ASSET}walled`, bytes: largeIcon},
			[`${LOGO_DEV_ASSET}shop-new?format=png&size=256`]: {url: `${LOGO_DEV_ASSET}shop-new`, bytes: icon},
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
			'https://pay.example.test/': {
				url: 'https://pay.example.test/',
				bytes: Buffer.from('<title>Example Pay</title>'),
			},
			'https://pay.example.test/favicon.ico': {url: 'https://pay.example.test/favicon.ico', bytes: icon},
			// Homepages that refuse the server; the favicon service has their icons.
			[`${FAVICON_SERVICE}exampleshop.test.ico`]: {url: `${FAVICON_SERVICE}exampleshop.test.ico`, bytes: icon},
			[`${FAVICON_SERVICE}walled.example.test.ico`]: {
				url: `${FAVICON_SERVICE}walled.example.test.ico`,
				bytes: smallIcon,
			},
			// Behind its homepage's wall, the site still serves its own large icon at the conventional path.
			'https://walled.example.test/apple-touch-icon.png': {
				url: 'https://walled.example.test/apple-touch-icon.png',
				bytes: icon,
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
			const {hostname, pathname} = new URL(url);
			if (!site || unreachable.has(hostname) || (pathname === '/' && walledHomepages.has(hostname)))
				throw new Error('not found');
			return site;
		});
	});

	afterEach(() => {
		routesUnavailable = false;
		unreachable.clear();
		walledHomepages.clear();
		logoDevNow.clear();
	});

	it('shows a synced merchant’s official logo on its purchases and refunds, to its owner only', async () => {
		const connection = await fixtures.createConnection({id: owner.id});
		const bankAccount = await fixtures.createBankAccount(connection);
		const [purchase, refund, person, ownTransfer, branch, payment] = await fixtures.createTransactions(
			bankAccount,
			[
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
				bookedRow('2026-10-06', '-4.10', {
					description: 'BEA, Betaalpas Example Shop Station,PAS123 NR:XX005, 06.10.26/07:00 Example City',
					transactionType: 'CARD_PAYMENT',
				}),
				// A payment service named on its own shows its own logo.
				bookedRow('2026-10-07', '-15.00', {
					description: 'BEA, Betaalpas Example Pay,PAS123 NR:XX006, 07.10.26/10:00 Example City',
					transactionType: 'CARD_PAYMENT',
				}),
			],
		);
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
		// A branch without a site of its own shows its brand's logo.
		expect(logoOf(branch.id)).toBe(logoUrl);
		await waitFor(
			() => owner.agent.get(`/bank-transactions/${payment.id}`).expect(200),
			(response) => response.body.merchantLogoUrl !== null,
		);
		const paymentLogo = (await owner.agent.get(`/bank-transactions/${payment.id}`).expect(200)).body
			.merchantLogoUrl;
		expect(paymentLogo).toMatch(/^\/merchant-logos\//);
		expect(paymentLogo).not.toBe(logoUrl);

		// One model call for every merchant of the owner, with sanitized names and no amounts or references.
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
				expect.objectContaining({key: 'example shop station', status: 'IDENTIFIED', logoId: null}),
				expect.objectContaining({key: 'example pay', status: 'IDENTIFIED', brand: 'Example Pay'}),
			]),
		);
		expect(await merchants.countBy({accountId: owner.id})).toBe(4);
		// logo.dev's logo, rated by its vector original; a site logo.dev doesn't know shows its own icon.
		expect(await logos.findOneByOrFail({domain: 'shop.example.test'})).toMatchObject({
			sourceUrl: `${LOGO_DEV_ASSET}shop`,
			sourceSize: 512,
			homepageLoaded: true,
		});
		expect(await logos.findOneByOrFail({domain: 'pay.example.test'})).toMatchObject({
			sourceUrl: 'https://pay.example.test/favicon.ico',
			sourceSize: 180,
		});

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

		// A refresh while the site is down and logo.dev can't answer yet keeps the logo and the names that confirmed
		// it, and asks logo.dev again when it can answer.
		const logo = await logos.findOneByOrFail({domain: 'shop.example.test'});
		const due = () => logos.update(logo.id, {retryAfter: new Date()});
		await due();
		unreachable.add('www.shop.example.test');
		unreachable.add('shop.example.test');
		// Out of the month's free credits: asked again a week later.
		logoDevNow.set('shop.example.test', {status: 'later', retryAfterMs: 7 * DAY_MS});
		await app.get(MerchantLogoService).fetchLogo(logo.id);
		const kept = await logos.findOneByOrFail({id: logo.id});
		expect(kept).toMatchObject({
			status: 'READY',
			version: logo.version,
			siteNames: ['Example Shop | Groceries'],
			attempts: 1,
		});
		expect(kept.retryAfter!.getTime() - kept.fetchedAt!.getTime()).toBe(7 * DAY_MS);
		// A week later logo.dev has a new logo: it replaces the old one while the site is still down.
		await due();
		logoDevNow.set('shop.example.test', {
			status: 'found',
			url: `${LOGO_DEV_ASSET}shop-new?format=png&size=256`,
			size: 512,
		});
		await app.get(MerchantLogoService).fetchLogo(logo.id);
		const renewed = await logos.findOneByOrFail({id: logo.id});
		expect(renewed).toMatchObject({
			status: 'READY',
			sourceUrl: `${LOGO_DEV_ASSET}shop-new`,
			homepageLoaded: true,
			siteNames: ['Example Shop | Groceries'],
			attempts: 0,
		});
		expect(renewed.version).not.toBe(logo.version);
		const refreshed = await owner.agent.get(`/bank-transactions/${purchase.id}`).expect(200);
		expect(refreshed.body.merchantLogoUrl).toBe(`/merchant-logos/${logo.id}/${renewed.version}`);
	});

	it('shows a logo only when the named website calls itself the brand, or the model was sure of a site that would not load', async () => {
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

		// Homepages that refuse the server: a logo shows only for a site the model was sure of, since nothing on the
		// site confirmed the brand, and it is the site's own large icon rather than logo.dev's or the favicon service's
		// small one. A guess whose hostname spells the brand is not enough.
		const [guessed, walled] = await fixtures.createTransactions(bankAccount, [
			bookedRow('2026-10-03', '-9.00', {
				description: 'BEA, Betaalpas Exampleshop,PAS123 NR:XX004, 03.10.26/09:00 Example City',
				transactionType: 'CARD_PAYMENT',
			}),
			bookedRow('2026-10-04', '-6.00', {
				description: 'BEA, Betaalpas Walled Example,PAS123 NR:XX007, 04.10.26/09:00 Example City',
				transactionType: 'CARD_PAYMENT',
			}),
		]);
		unreachable.add('exampleshop.test');
		walledHomepages.add('walled.example.test');
		await app.get(MerchantLogoService).enqueueForOwnerSafely(other.id);
		const walledResponse = await waitFor(
			() => other.agent.get(`/bank-transactions/${walled.id}`).expect(200),
			(result) => result.body.merchantLogoUrl !== null,
		);
		expect(walledResponse.body.merchantLogoUrl).toMatch(/^\/merchant-logos\//);
		expect(await logos.findOneByOrFail({domain: 'walled.example.test'})).toMatchObject({
			homepageLoaded: false,
			sourceUrl: 'https://walled.example.test/apple-touch-icon.png',
			sourceSize: 180,
		});
		const guessedLogo = await waitFor(
			() => logos.findOneBy({domain: 'exampleshop.test'}),
			(row) => row?.status === 'READY',
		);
		expect(guessedLogo).toMatchObject({
			homepageLoaded: false,
			siteNames: [],
			sourceUrl: `${FAVICON_SERVICE}exampleshop.test.ico`,
		});
		// logo.dev was still indexing the site, so it is asked again the next day.
		expect(guessedLogo!.retryAfter!.getTime() - guessedLogo!.fetchedAt!.getTime()).toBe(DAY_MS);
		const guessedResponse = await other.agent.get(`/bank-transactions/${guessed.id}`).expect(200);
		expect(guessedResponse.body.merchantLogoUrl).toBeNull();
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
