import {INestApplication} from '@nestjs/common';
import Redis from 'ioredis';
import sharp from 'sharp';
import TestAgent from 'supertest/lib/agent';

import {REDIS} from '@core/redis/redis.constants';
import {AccountService} from '@modules/account/account.service';
import {BankLogoService} from '@modules/banking/bank-logos/bank-logo.service';
import {MerchantSiteFetcher} from '@modules/banking/merchant-logos/merchant-site-fetcher';
import {EnableBankingClient} from '@modules/banking/services/enable-banking.client';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

const SOURCE = 'https://enablebanking.com/brands/XX/Example/';
const METADATA = '/bank-connections/aspsps/logos/XX/Example%20Bank';

describe('bank logo delivery', () => {
	let app: INestApplication;
	let agent: TestAgent;
	let fetchImage: jest.SpyInstance;
	beforeAll(async () => {
		app = getApp();
		const redis = app.get<Redis>(REDIS);
		const keys = await redis.keys('bank-logo:*');
		if (keys.length) await redis.del(...keys);
		agent = await loginAgent(app.getHttpServer(), VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		const png = await sharp({create: {width: 40, height: 20, channels: 4, background: '#00145a'}})
			.png()
			.toBuffer();
		fetchImage = jest.spyOn(MerchantSiteFetcher.prototype, 'fetch').mockResolvedValue({bytes: png, url: SOURCE});
		jest.spyOn(app.get(EnableBankingClient), 'getAspsps').mockResolvedValue([
			{name: 'Example Bank', country: 'XX', logoUrl: SOURCE, maximumConsentValiditySeconds: 86400},
		]);
	});
	afterAll(() => jest.restoreAllMocks());

	it('lists a lazy metadata reference and serves versioned original-colour variants with private caching', async () => {
		const list = await agent.get('/bank-connections/aspsps').expect(200);
		expect(list.body[0].logo).toEqual({metadataUrl: METADATA});
		expect(fetchImage).not.toHaveBeenCalled();
		const owner = await app.get(AccountService).findByEmail(VERIFIED_ACCOUNT_EMAIL);
		const fixtures = new BankingFixtures(app);
		const connection = await fixtures.createConnection(owner!, {aspspName: 'Example Bank', aspspCountry: 'XX'});
		const connections = await agent.get('/bank-connections').expect(200);
		expect(connections.body.find((item: {id: string}) => item.id === connection.id).logo).toEqual({
			metadataUrl: METADATA,
		});
		const metadata = await agent.get(METADATA).expect(200);
		expect(metadata.headers['cache-control']).toBe('private, max-age=86400');
		expect(metadata.body.light).toEqual({
			url: expect.stringMatching(/\/colour-v1\/[0-9a-f]{64}\/light$/),
			plate: false,
		});
		expect(metadata.body.dark).toEqual({
			url: expect.stringMatching(/\/colour-v1\/[0-9a-f]{64}\/light$/),
			plate: true,
		});
		for (const variant of [metadata.body.light, metadata.body.dark]) {
			const image = await agent
				.get(variant.url)
				.expect(200)
				.expect('Content-Type', /image\/png/);
			expect(image.headers['cache-control']).toBe('private, max-age=31536000, immutable');
			expect(image.headers['cross-origin-resource-policy']).toBe('same-site');
			expect((await sharp(image.body).metadata()).width).toBe(40);
		}
		await agent.get(METADATA).expect(200);
		expect(fetchImage).toHaveBeenCalledTimes(1);
		// An evicted derivative is rebuilt from the registered source, at the same immutable URL.
		const hash = metadata.body.light.url.split('/').at(-2);
		await app.get<Redis>(REDIS).del(`bank-logo:colour-v1:${hash}`);
		await agent.get(metadata.body.light.url).expect(200);
		expect(fetchImage).toHaveBeenCalledTimes(2);
		const bad = await agent.get(metadata.body.light.url.replace(/[0-9a-f]{64}/, 'f'.repeat(64))).expect(404);
		expect(bad.headers['cache-control']).toBeUndefined();
		const unknown = await agent.get(metadata.body.light.url.replace('colour-v1', 'colour-v99')).expect(404);
		expect(unknown.headers['cache-control']).toBeUndefined();
	});

	it('refuses missing or undecodable logos without immutable error caching', async () => {
		await app.get(BankLogoService).registerSources([{name: 'Invalid', country: 'XX', logoUrl: SOURCE + 'invalid'}]);
		fetchImage.mockResolvedValueOnce({bytes: Buffer.from('not an image'), url: SOURCE + 'invalid'});
		const invalid = await agent.get('/bank-connections/aspsps/logos/XX/Invalid').expect(404);
		expect(invalid.headers['cache-control']).toBeUndefined();
		const missing = await agent.get('/bank-connections/aspsps/logos/XX/Missing').expect(404);
		expect(missing.headers['cache-control']).toBeUndefined();
	});
});
