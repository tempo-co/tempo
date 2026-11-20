import {recomputeCurrencyExchanges} from '../currency-exchange/currency-exchange-recompute';
import {recomputeOwnTransfersAndCategories} from '../own-transfer/own-transfer-category';
import {DerivedDataRefreshService} from './derived-data-refresh.service';

jest.mock('../currency-exchange/currency-exchange-recompute', () => ({recomputeCurrencyExchanges: jest.fn()}));
jest.mock('../own-transfer/own-transfer-category', () => ({recomputeOwnTransfersAndCategories: jest.fn()}));

const DERIVED_DATA_REFRESH_SERVICE_DEPENDENCIES = [
	'dataSource',
	'reportingCurrencyService',
	'categorizationService',
	'merchantLogoService',
] as const;

/** Builds the service with named test doubles; unspecified dependencies are empty objects. */
function createDerivedDataRefreshService(
	dependencies: Partial<Record<(typeof DERIVED_DATA_REFRESH_SERVICE_DEPENDENCIES)[number], unknown>>,
): DerivedDataRefreshService {
	return new DerivedDataRefreshService(
		...(DERIVED_DATA_REFRESH_SERVICE_DEPENDENCIES.map((name) => dependencies[name] ?? {}) as ConstructorParameters<
			typeof DerivedDataRefreshService
		>),
	);
}

/** A refresh whose steps record, in order, what they did. */
function createRecordingRefresh(options: {failingEnqueue?: readonly string[]} = {}) {
	const steps: string[] = [];
	jest.mocked(recomputeCurrencyExchanges).mockImplementation(async () => {
		steps.push('exchanges');
		return {transactionsChanged: 2, reclassifiedIds: ['former-leg'], requeuedIds: ['former-leg']};
	});
	jest.mocked(recomputeOwnTransfersAndCategories).mockImplementation(async () => {
		steps.push('own transfers');
		return {result: {accountIbansAdded: 0, transactionsChanged: 0, changedIds: []}, requeuedIds: []};
	});
	const service = createDerivedDataRefreshService({
		dataSource: {transaction: jest.fn((work: (manager: unknown) => Promise<unknown>) => work({}))},
		reportingCurrencyService: {
			reconcileSafely: jest.fn(async () => {
				steps.push('reconcile');
			}),
		},
		categorizationService: {
			enqueueForTransactions: jest.fn(async (ids: readonly string[]) => {
				steps.push(`categorize ${ids.join(', ')}`);
				if (ids.some((id) => options.failingEnqueue?.includes(id)))
					throw new Error('Synthetic enqueue failure');
			}),
		},
		merchantLogoService: {
			enqueueForOwnerSafely: jest.fn(async (_ownerId: string, ids?: readonly string[]) => {
				steps.push(`logos ${ids?.join(', ')}`);
			}),
		},
	});
	return {service, steps};
}

describe('DerivedDataRefreshService', () => {
	afterEach(() => jest.resetAllMocks());

	it('labels exchanges and own transfers before queueing the written rows, then the former exchange legs', async () => {
		const {service, steps} = createRecordingRefresh();

		await service.refresh('owner-id', {kind: 'sync-write', writtenIds: ['written'], formerCounterpartIds: []});

		expect(steps).toEqual([
			'reconcile',
			'exchanges',
			'own transfers',
			'categorize written',
			'categorize former-leg',
			'logos written',
		]);
	});

	it('queues the former exchange legs and logos when queueing the written rows fails', async () => {
		const {service, steps} = createRecordingRefresh({failingEnqueue: ['written']});

		await service.refresh('owner-id', {kind: 'sync-write', writtenIds: ['written'], formerCounterpartIds: []});

		expect(steps.slice(-3)).toEqual(['categorize written', 'categorize former-leg', 'logos written']);
	});

	it('queues the former exchange legs after own transfers when no row was written', async () => {
		const {service, steps} = createRecordingRefresh();

		await service.refresh('owner-id', {
			kind: 'converted-amounts',
			amountsConverted: true,
			reportingCurrencyChanged: false,
		});

		expect(steps).toEqual(['exchanges', 'own transfers', 'categorize former-leg']);
	});
});
