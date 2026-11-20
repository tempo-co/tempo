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

type RecordingOptions = {
	/** The exchange recompute's result, or `fail` to make it throw. */
	exchanges?: {reclassifiedIds: string[]; requeuedIds: string[]} | 'fail';
	/** Which own-transfer recomputes throw. */
	ownTransfersFail?: (ownerId: string, scope?: {transactionIds: readonly string[]}) => boolean;
	/** Makes the first categorization enqueue throw. */
	failFirstEnqueue?: boolean;
	/** The owners the daily job finds. */
	owners?: readonly string[];
};

/** A refresh whose steps record, in order, what they did. */
function createRecordingRefresh(options: RecordingOptions = {}) {
	const steps: string[] = [];
	const exchanges = options.exchanges ?? {reclassifiedIds: ['former-leg'], requeuedIds: ['written', 'former-leg']};
	jest.mocked(recomputeCurrencyExchanges).mockImplementation(async () => {
		steps.push('exchanges');
		if (exchanges === 'fail') throw new Error('Synthetic exchange recompute failure');
		return {transactionsChanged: 2, ...exchanges};
	});
	jest.mocked(recomputeOwnTransfersAndCategories).mockImplementation(async (_manager, ownerId, scope) => {
		steps.push(`own transfers ${scope ? `in scope ${scope.transactionIds.join(', ')}` : 'whole history'}`);
		if (options.ownTransfersFail?.(ownerId, scope)) throw new Error('Synthetic own-transfer recompute failure');
		return {result: {accountIbansAdded: 0, transactionsChanged: 0, changedIds: []}, requeuedIds: []};
	});
	let enqueues = 0;
	const service = createDerivedDataRefreshService({
		dataSource: {
			transaction: jest.fn((work: (manager: unknown) => Promise<unknown>) => work({})),
			query: jest.fn(async () => (options.owners ?? []).map((accountId) => ({accountId}))),
		},
		reportingCurrencyService: {
			reconcileSafely: jest.fn(async () => {
				steps.push('reconcile');
			}),
		},
		categorizationService: {
			enqueueForTransactions: jest.fn(async (ids: readonly string[]) => {
				steps.push(`categorize ${ids.join(', ')}`);
				enqueues += 1;
				if (options.failFirstEnqueue && enqueues === 1) throw new Error('Synthetic enqueue failure');
			}),
		},
		merchantLogoService: {
			enqueueForOwnerSafely: jest.fn(async (_ownerId: string, ids?: readonly string[]) => {
				steps.push(`logos ${ids?.join(', ') ?? 'whole history'}`);
			}),
		},
	});
	return {service, steps};
}

const syncWrite = {kind: 'sync-write', writtenIds: ['written'], formerCounterpartIds: []} as const;
const convertedAmounts = {kind: 'converted-amounts', amountsConverted: true, reportingCurrencyChanged: false} as const;

describe('DerivedDataRefreshService', () => {
	afterEach(() => jest.resetAllMocks());

	it('labels exchanges and own transfers before queueing the written rows, then the former exchange legs not written', async () => {
		const {service, steps} = createRecordingRefresh();

		await service.refresh('owner-id', syncWrite);

		expect(steps).toEqual([
			'reconcile',
			'exchanges',
			'own transfers in scope written, former-leg',
			'categorize written',
			'categorize former-leg',
			'logos written',
		]);
	});

	it('queues every former exchange leg, written ones included, and the logos when queueing the written rows fails', async () => {
		const {service, steps} = createRecordingRefresh({failFirstEnqueue: true});

		await expect(service.refresh('owner-id', syncWrite)).resolves.toBeUndefined();

		expect(steps.slice(-3)).toEqual(['categorize written', 'categorize written, former-leg', 'logos written']);
	});

	it('queues the former exchange legs after own transfers when no row was written', async () => {
		const {service, steps} = createRecordingRefresh();

		await service.refresh('owner-id', convertedAmounts);

		expect(steps).toEqual(['exchanges', 'own transfers whole history', 'categorize written, former-leg']);
	});

	it.each([
		[
			'a sync write',
			syncWrite,
			['reconcile', 'exchanges', 'own transfers whole history', 'categorize written', 'logos written'],
		],
		['converted amounts', convertedAmounts, ['exchanges', 'own transfers whole history']],
	] as const)(
		'after %s whose exchange recompute fails, recomputes own transfers over the whole history',
		async (_, change, expected) => {
			const {service, steps} = createRecordingRefresh({exchanges: 'fail'});

			await service.refresh('owner-id', change);

			// Which rows the failed recompute reclassified is unknown, so no row is out of scope.
			expect(steps).toEqual(expected);
		},
	);

	it('retries a failed scoped own-transfer recompute over the whole history, then queues the rows', async () => {
		const {service, steps} = createRecordingRefresh({ownTransfersFail: (_ownerId, scope) => scope !== undefined});

		await service.refresh('owner-id', syncWrite);

		expect(steps.slice(1)).toEqual([
			'exchanges',
			'own transfers in scope written, former-leg',
			'own transfers whole history',
			'categorize written',
			'categorize former-leg',
			'logos written',
		]);
	});

	it('daily, recomputes every owner’s own transfers over the whole history, one owner’s failure not stopping the rest', async () => {
		const {service, steps} = createRecordingRefresh({
			owners: ['failing-owner', 'other-owner'],
			ownTransfersFail: (ownerId) => ownerId === 'failing-owner',
		});

		await expect(service.recomputeAllOwnTransfers()).resolves.toBeUndefined();

		// A failed whole-history recompute waits for the next day.
		expect(steps).toEqual(['own transfers whole history', 'own transfers whole history']);
		expect(jest.mocked(recomputeOwnTransfersAndCategories).mock.calls.map(([, ownerId]) => ownerId)).toEqual([
			'failing-owner',
			'other-owner',
		]);
	});
});
