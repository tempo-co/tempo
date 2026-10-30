import {getQueueToken} from '@nestjs/bullmq';
import {INestApplication} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Queue} from 'bullmq';
import Redis from 'ioredis';
import {createHash} from 'node:crypto';
import {Server} from 'node:net';
import sharp from 'sharp';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import {Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {MERCHANT_LOGO_QUEUE, MERCHANT_LOGO_RECONCILE_SCHEDULER_ID} from '@core/queue/queue.constants';
import {REDIS} from '@core/redis/redis.constants';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {BankTransactionCategorizationUnavailableError} from '@modules/banking/categorization/bank-transaction-categorization.provider';
import {
	MerchantIdentification,
	MerchantIdentificationInput,
} from '@modules/banking/categorization/bank-transaction-categorization.types';
import {ClaudeBankTransactionCategorizationProvider} from '@modules/banking/categorization/providers/claude-bank-transaction-categorization.provider';
import {LogoDevClient, LogoDevResult} from '@modules/banking/merchant-logos/logo-dev.client';
import * as maskConversion from '@modules/banking/merchant-logos/merchant-logo-mask';
import {MerchantLogoMaskService} from '@modules/banking/merchant-logos/merchant-logo-mask.service';
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
const MASK_CACHE_PREFIX = 'merchant-logo:mask-v1:';
const maskKey = (source: Buffer) => MASK_CACHE_PREFIX + createHash('sha256').update(source).digest('hex');
function getPng(agent: TestAgent, url: string) {
	return agent
		.get(url)
		.buffer(true)
		.parse((response, callback) => {
			const chunks: Buffer[] = [];
			response.on('data', (chunk: Buffer) => chunks.push(chunk));
			response.on('end', () => callback(null, Buffer.concat(chunks)));
		});
}

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
		// Synthetic artwork with a distinct foreground, rather than an empty solid-colour field.
		largeIcon = await sharp({create: {width: 256, height: 256, channels: 4, background: '#22aa33'}})
			.composite([
				{
					input: await sharp({create: {width: 96, height: 128, channels: 4, background: 'white'}})
						.png()
						.toBuffer(),
					left: 80,
					top: 64,
				},
			])
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
		const [purchase, refund, person, ownTransfer, branch, payment, personOut, personIn, businessTransfer] =
			await fixtures.createTransactions(bankAccount, [
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
				bookedRow('2026-10-08', '-30.00', {
					description: 'Transfer to Alex Example',
					transactionType: 'TRANSFER',
					category: 'HOUSING_AND_UTILITIES',
				}),
				bookedRow('2026-10-09', '30.00', {
					description: 'Transfer from Alex Example',
					transactionType: 'TRANSFER',
				}),
				bookedRow('2026-10-10', '-10.00', {
					description: 'Transfer to Example Pay',
					counterpartyName: 'Example Pay',
					transactionType: 'TRANSFER',
				}),
			]);
		// An older purchase is business evidence even behind a full page of transfer descriptions for the same key.
		await fixtures.createTransactions(
			bankAccount,
			Array.from({length: 21}, () =>
				bookedRow('2026-10-11', '-2.00', {
					description: 'Transfer to Example Shop',
					transactionType: 'TRANSFER',
				}),
			),
		);
		expect(purchase.merchantKey).toBe('EXPENSE:example shop');
		expect(refund.merchantKey).toBe('INCOME:example shop');
		expect(ownTransfer.merchantKey).toBe('EXPENSE:example shop');

		await app.get(MerchantLogoService).enqueueForOwnerSafely(owner.id);
		await waitFor(
			() => merchants.findBy({accountId: owner.id}),
			(rows) => rows.length === 5 && rows.every(({status}) => status !== 'PENDING'),
		);
		expect(JSON.stringify(identifySpy.mock.calls)).not.toContain('Alex Example');

		const listed = await waitFor(
			() =>
				owner.agent
					.get('/bank-transactions')
					.query({pagination: {pageSize: 50}})
					.expect(200),
			(response) =>
				[purchase.id, businessTransfer.id].every(
					(id) =>
						typeof response.body.transactions.find((row: BankTransaction) => row.id === id)
							?.merchantLogoUrl === 'string',
				),
		);
		const logoOf = (id: string) =>
			listed.body.transactions.find((row: BankTransaction & {merchantLogoUrl: string | null}) => row.id === id)
				?.merchantLogoUrl;
		const logoUrl: string = logoOf(purchase.id);
		expect(logoUrl).toMatch(/^\/merchant-logos\/[0-9a-f-]{36}\/[0-9a-f]{64}$/);
		expect(logoOf(refund.id)).toBe(logoUrl);
		expect(logoOf(person.id)).toBeNull();
		expect(logoOf(personOut.id)).toBeNull();
		expect(logoOf(personIn.id)).toBeNull();
		expect(logoOf(ownTransfer.id)).toBeNull();
		expect(await fixtures.transactions.findOneByOrFail({id: personOut.id})).toMatchObject({
			category: 'HOUSING_AND_UTILITIES',
			categorySource: 'AI',
		});
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
		expect(logoOf(businessTransfer.id)).toBe(paymentLogo);

		// Known people need no identification; ambiguous names and businesses share one sanitized model call.
		expect(identifySpy).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(identifySpy.mock.calls)).not.toMatch(/12\.40|PAS123|XX000/);
		expect(identifySpy.mock.calls[0][0]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({name: 'Example Shop 02', location: 'Example City', direction: 'INCOME'}),
				expect.objectContaining({name: 'Jane Example', location: null}),
				expect.objectContaining({name: 'Example Pay', direction: 'EXPENSE'}),
			]),
		);
		expect(await merchants.findBy({accountId: owner.id})).toEqual(
			expect.arrayContaining([
				expect.objectContaining({key: 'example shop', status: 'IDENTIFIED', brand: 'Example Shop'}),
				expect.objectContaining({key: 'jane example', status: 'NONE', logoId: null}),
				expect.objectContaining({key: 'alex example', status: 'NONE', logoId: null, attempts: 0}),
				expect.objectContaining({key: 'example shop station', status: 'IDENTIFIED', logoId: null}),
				expect.objectContaining({key: 'example pay', status: 'IDENTIFIED', brand: 'Example Pay'}),
			]),
		);
		expect(await merchants.countBy({accountId: owner.id})).toBe(5);
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
		const connectionRows = await owner.agent
			.get(`/bank-connections/${connection.id}/transactions`)
			.query({limit: 50})
			.expect(200);
		expect(connectionRows.body.transactions).toEqual(
			expect.arrayContaining([expect.objectContaining({id: purchase.id, merchantLogoUrl: logoUrl})]),
		);

		const image = await getPng(owner.agent, logoUrl)
			.expect(200)
			.expect('Content-Type', 'image/png')
			.expect('Cache-Control', 'private, max-age=31536000, immutable');
		expect(await sharp(image.body as Buffer).metadata()).toMatchObject({format: 'png', width: 128, height: 128});
		const sourceBefore = Buffer.from(image.body as Buffer);
		const metadataBefore = await logos.findOneByOrFail({domain: 'shop.example.test'});
		const maskUrl = `${logoUrl}/mask-v1`;
		const mask = await getPng(owner.agent, maskUrl)
			.expect(200)
			.expect('Content-Type', 'image/png')
			.expect('Cache-Control', 'private, max-age=31536000, immutable')
			.expect('Cross-Origin-Resource-Policy', 'same-site');
		const {data: rgba, info} = await sharp(mask.body as Buffer)
			.ensureAlpha()
			.raw()
			.toBuffer({resolveWithObject: true});
		expect(info).toMatchObject({width: 128, height: 128, channels: 4});
		const alpha = Array.from(rgba).filter((_, i) => i % 4 === 3);
		expect(Math.max(...alpha)).toBe(255);
		expect(alpha[0]).toBe(0);
		expect(alpha.some((a) => a > 0 && a < 255)).toBe(true);
		const redis = app.get<Redis>(REDIS);
		expect(await redis.getBuffer(maskKey(sourceBefore))).toEqual(mask.body);
		expect(await redis.ttl(maskKey(sourceBefore))).toBeGreaterThan(0);
		expect(await redis.ttl(maskKey(sourceBefore))).toBeLessThanOrEqual(7 * 24 * 60 * 60);
		expect((await getPng(owner.agent, maskUrl).expect(200)).body).toEqual(mask.body);
		expect((await getPng(owner.agent, logoUrl).expect(200)).body).toEqual(sourceBefore);
		expect(await logos.findOneByOrFail({domain: 'shop.example.test'})).toEqual(metadataBefore);

		// Every refusal, including a cached derivative and a feature toggle, passes the source gate first.
		const lookup = jest.spyOn(redis, 'getBuffer');
		try {
			for (const [agent, url] of [
				[other.agent, maskUrl],
				[owner.agent, `${logoUrl.replace(/[0-9a-f]{64}$/, 'b'.repeat(64))}/mask-v1`],
			] as const) {
				expect((await agent.get(url).expect(404)).headers).not.toHaveProperty('cache-control');
			}
			app.get(ConfigService).set('MERCHANT_LOGOS_ENABLED', false);
			expect((await owner.agent.get(maskUrl).expect(404)).headers).not.toHaveProperty('cache-control');
			app.get(ConfigService).set('MERCHANT_LOGOS_ENABLED', true);
			await logos.update(metadataBefore.id, {status: 'MISSING'});
			expect((await owner.agent.get(maskUrl).expect(404)).headers).not.toHaveProperty('cache-control');
			expect(lookup).not.toHaveBeenCalled();
		} finally {
			app.get(ConfigService).set('MERCHANT_LOGOS_ENABLED', true);
			await logos.update(metadataBefore.id, {status: 'READY'});
			lookup.mockRestore();
		}
		// A uniform cached source has no foreground: keep the original available, refuse and never cache its mask.
		const emptySource = (await getPng(owner.agent, paymentLogo).expect(200)).body as Buffer;
		const emptyConversion = jest.spyOn(maskConversion, 'createMerchantLogoMask');
		try {
			for (let attempt = 0; attempt < 2; attempt++)
				expect((await owner.agent.get(`${paymentLogo}/mask-v1`).expect(404)).headers).not.toHaveProperty(
					'cache-control',
				);
			expect(emptyConversion).toHaveBeenCalledTimes(2);
		} finally {
			emptyConversion.mockRestore();
		}
		expect(await redis.exists(maskKey(emptySource))).toBe(0);

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

	it('serves cached logos with acquisition and identification disabled', async () => {
		const config = app.get(ConfigService);
		const service = app.get(MerchantLogoService);
		const account = await createVerifiedAccount(
			app.getHttpServer(),
			app.get(ConfigurationService).get('EMAIL_UI_URL'),
		);
		const connection = await fixtures.createConnection({id: account.id});
		const bankAccount = await fixtures.createBankAccount(connection);
		const [purchase] = await fixtures.createTransactions(bankAccount, [
			bookedRow('2026-10-12', '-3.00', {counterpartyName: 'Example Shop', transactionType: 'CARD_PAYMENT'}),
			bookedRow('2026-10-12', '-4.00', {counterpartyName: 'Example Pending', transactionType: 'CARD_PAYMENT'}),
			bookedRow('2026-10-12', '-5.00', {counterpartyName: 'Example Unseen', transactionType: 'CARD_PAYMENT'}),
		]);
		const original = await sharp(largeIcon).resize(128, 128).png().toBuffer();
		const logo = await logos.save(
			logos.create({
				domain: 'cached.example.test',
				status: 'READY',
				image: original,
				version: createHash('sha256').update(original).digest('hex'),
				siteNames: ['Example Shop'],
				homepageLoaded: true,
				sourceSize: 256,
				retryAfter: new Date(0),
			}),
		);
		await merchants.save(
			merchants.create({
				accountId: account.id,
				key: 'example shop',
				status: 'IDENTIFIED',
				brand: 'Example Shop',
				domain: logo.domain,
				domainConfident: true,
				logoId: logo.id,
			}),
		);
		const pending = await merchants.save(merchants.create({accountId: account.id, key: 'example pending'}));
		const readMerchants = () => merchants.find({where: {accountId: account.id}, order: {id: 'ASC'}});
		const before = await readMerchants();
		const logoBefore = await logos.findOneByOrFail({id: logo.id});
		const callsBefore = [
			identifySpy.mock.calls.length,
			fetchSpy.mock.calls.length,
			jest.mocked(app.get(LogoDevClient).findLogo).mock.calls.length,
		];
		await queue.pause();
		config.set('MERCHANT_LOGOS_CACHED_ONLY', true);
		try {
			const detail = await account.agent.get(`/bank-transactions/${purchase.id}`).expect(200);
			expect(detail.body.merchantLogoUrl).toBe(`/merchant-logos/${logo.id}/${logo.version}`);
			await getPng(account.agent, `${detail.body.merchantLogoUrl}/mask-v1`).expect(200);
			for (const operation of [
				() => service.enqueueForOwnerSafely(account.id),
				() => service.reconcile(),
				() => service.identifyMerchants([pending.id]),
				() => service.fetchLogo(logo.id),
			]) {
				await operation();
				expect(await readMerchants()).toEqual(before);
				expect(await logos.findOneByOrFail({id: logo.id})).toEqual(logoBefore);
				expect([
					identifySpy.mock.calls.length,
					fetchSpy.mock.calls.length,
					jest.mocked(app.get(LogoDevClient).findLogo).mock.calls.length,
				]).toEqual(callsBefore);
			}
			config.set('NODE_ENV', 'development');
			await service.onApplicationBootstrap();
			expect(await queue.getJobSchedulers()).toEqual([]);
			const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
			expect(Object.values(counts).every((count) => count === 0)).toBe(true);
			expect(await queue.getWaitingCount()).toBe(0);
		} finally {
			config.set('NODE_ENV', 'test');
			config.set('MERCHANT_LOGOS_CACHED_ONLY', false);
			await queue.removeJobScheduler(MERCHANT_LOGO_RECONCILE_SCHEDULER_ID);
			await queue.drain(true);
			await queue.resume();
		}
	});

	it('deduplicates concurrent mask conversions and bounds the expiring source-hash cache', async () => {
		const redis = app.get<Redis>(REDIS);
		const masks = app.get(MerchantLogoMaskService);
		const source = await sharp(largeIcon).resize(128, 128).png().toBuffer();
		const key = maskKey(source);
		await redis.del(key);
		const conversion = jest.spyOn(maskConversion, 'createMerchantLogoMask');
		try {
			const images = await Promise.all(Array.from({length: 8}, () => masks.getImage(source)));
			expect(conversion).toHaveBeenCalledTimes(1);
			for (const image of images) expect(image).toEqual(images[0]);
			expect(await masks.getImage(source)).toEqual(images[0]);
			expect(conversion).toHaveBeenCalledTimes(1);
			expect(await redis.getBuffer(key)).toEqual(images[0]);
			// Populate a full cache with synthetic entries, then exercise atomic eviction through the real writer.
			const index = MASK_CACHE_PREFIX + 'index';
			const old = await redis.zrange(index, 0, -1);
			if (old.length) await redis.del(...old);
			await redis.del(index, key);
			const keys = Array.from(
				{length: 256},
				(_, i) => MASK_CACHE_PREFIX + createHash('sha256').update(`synthetic-${i}`).digest('hex'),
			);
			const pipeline = redis.multi();
			for (const [i, entry] of keys.entries()) {
				pipeline.set(entry, images[0], 'EX', 60);
				pipeline.zadd(index, i, entry);
			}
			await pipeline.exec();
			await masks.getImage(source);
			expect(await redis.zcard(index)).toBe(256);
			expect(await redis.exists(keys[0])).toBe(0);
			expect(await redis.exists(key)).toBe(1);
			expect(await redis.ttl(index)).toBeGreaterThan(0);
			for (const operation of ['getBuffer', 'eval'] as const) {
				await redis.del(key);
				const fault = jest.spyOn(redis, operation).mockRejectedValueOnce(new Error('Synthetic cache failure'));
				try {
					await expect(masks.getImage(source)).rejects.toThrow('Synthetic cache failure');
					expect(await masks.getImage(source)).toEqual(images[0]);
				} finally {
					fault.mockRestore();
				}
			}
		} finally {
			conversion.mockRestore();
		}
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
