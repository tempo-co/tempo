import {BANKING_SERVICE_UNAVAILABLE} from '../api/constants/banking-messages.constants';
import {AspspCatalogService} from './aspsp-catalog.service';

const CATALOG = [{name: 'Example Bank', country: 'XX', maximumConsentValiditySeconds: 86_400}];

function createAspspCatalogService({
	configurationService = {get: jest.fn(() => true)},
	enableBankingClient = {getAspsps: jest.fn().mockResolvedValue(CATALOG)},
	redis = {get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK')},
}: Partial<Record<'configurationService' | 'enableBankingClient' | 'redis', unknown>> = {}) {
	return new AspspCatalogService(configurationService as never, enableBankingClient as never, redis as never);
}

describe('AspspCatalogService', () => {
	it('refuses the bank list without contacting the provider when the integration is disabled', async () => {
		const enableBankingClient = {getAspsps: jest.fn()};
		const service = createAspspCatalogService({
			configurationService: {
				get: jest.fn((key: string) => (key === 'BANKING_INTEGRATION_ENABLED' ? false : undefined)),
			},
			enableBankingClient,
		});

		await expect(service.findSupportedAspsps()).rejects.toThrow(BANKING_SERVICE_UNAVAILABLE);
		expect(enableBankingClient.getAspsps).not.toHaveBeenCalled();
	});

	it('serves the cached country catalog and fills the cache on a miss', async () => {
		const enableBankingClient = {getAspsps: jest.fn().mockResolvedValue(CATALOG)};
		const redis = {
			get: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify(CATALOG)),
			set: jest.fn().mockResolvedValue('OK'),
		};
		const service = createAspspCatalogService({enableBankingClient, redis});
		const signal = new AbortController().signal;

		await expect(service.getCachedAspsps('XX', signal)).resolves.toEqual(CATALOG);
		await expect(service.getCachedAspsps('XX', signal)).resolves.toEqual(CATALOG);

		expect(enableBankingClient.getAspsps).toHaveBeenCalledTimes(1);
		expect(enableBankingClient.getAspsps).toHaveBeenCalledWith('XX', signal);
		expect(redis.set).toHaveBeenCalledWith('banking:aspsp-catalog:XX', JSON.stringify(CATALOG), 'EX', 3600);
	});

	it('falls back to the provider when the cache is unavailable', async () => {
		const service = createAspspCatalogService({
			redis: {
				get: jest.fn().mockRejectedValue(new Error('redis down')),
				set: jest.fn().mockRejectedValue(new Error('redis down')),
			},
		});

		await expect(service.getCachedAspsps('XX', new AbortController().signal)).resolves.toEqual(CATALOG);
	});
});
