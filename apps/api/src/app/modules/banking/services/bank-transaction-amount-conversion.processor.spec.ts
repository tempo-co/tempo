import {Job} from 'bullmq';

import {
	BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB,
	BANK_TRANSACTION_AMOUNT_CONVERSION_JOB,
	RECOMPUTE_OWN_TRANSFERS_JOB,
} from '@core/queue/queue.constants';

import {BankTransactionAmountConversionProcessor} from './bank-transaction-amount-conversion.processor';
import {BankTransactionAmountConversionJobData} from './bank-transaction-amount-conversion.queue.service';

const PROCESSOR_DEPENDENCIES = [
	'conversionService',
	'configurationService',
	'derivedDataRefreshService',
	'recurringSeriesService',
] as const;

/** Builds the processor with named test doubles, in constructor order. */
function createProcessor(
	dependencies: Record<(typeof PROCESSOR_DEPENDENCIES)[number], unknown>,
): BankTransactionAmountConversionProcessor {
	return new BankTransactionAmountConversionProcessor(
		...(PROCESSOR_DEPENDENCIES.map((name) => dependencies[name]) as ConstructorParameters<
			typeof BankTransactionAmountConversionProcessor
		>),
	);
}

describe('BankTransactionAmountConversionProcessor', () => {
	const job = (name: string) => ({name}) as Job<BankTransactionAmountConversionJobData>;
	const setup = (enabled: boolean | Record<string, boolean>) => {
		const conversionService = {backfill: jest.fn().mockResolvedValue(undefined)};
		const derivedDataRefreshService = {recomputeAllLabels: jest.fn().mockResolvedValue(undefined)};
		const recurringSeriesService = {foldAllChangeNotes: jest.fn().mockResolvedValue(undefined)};
		const processor = createProcessor({
			conversionService,
			configurationService: {
				get: jest.fn((key: string) => (typeof enabled === 'boolean' ? enabled : (enabled[key] ?? false))),
			},
			derivedDataRefreshService,
			recurringSeriesService,
		});
		return {conversionService, derivedDataRefreshService, recurringSeriesService, processor};
	};

	it('does not process jobs when banking integration is disabled', async () => {
		const {conversionService, derivedDataRefreshService, recurringSeriesService, processor} = setup(false);

		await processor.process(job(BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB));
		await processor.process(job(RECOMPUTE_OWN_TRANSFERS_JOB));

		expect(conversionService.backfill).not.toHaveBeenCalled();
		expect(derivedDataRefreshService.recomputeAllLabels).not.toHaveBeenCalled();
		expect(recurringSeriesService.foldAllChangeNotes).not.toHaveBeenCalled();
	});

	it('processes supported conversion jobs when banking integration is enabled', async () => {
		const {conversionService, derivedDataRefreshService, processor} = setup(true);

		await processor.process(job(BANK_TRANSACTION_AMOUNT_CONVERSION_JOB));

		expect(conversionService.backfill).toHaveBeenCalledTimes(1);
		expect(derivedDataRefreshService.recomputeAllLabels).not.toHaveBeenCalled();
	});

	it('converts imported statements while bank synchronization is off', async () => {
		const {conversionService, processor} = setup({BANKING_INTEGRATION_ENABLED: false, FILE_IMPORT_ENABLED: true});

		await processor.process(job(BANK_TRANSACTION_AMOUNT_CONVERSION_JOB));

		expect(conversionService.backfill).toHaveBeenCalledTimes(1);
	});

	it('runs the daily whole-history own-transfer recompute, then folds every owner’s history change notes', async () => {
		const {conversionService, derivedDataRefreshService, recurringSeriesService, processor} = setup(true);

		await processor.process(job(RECOMPUTE_OWN_TRANSFERS_JOB));

		expect(derivedDataRefreshService.recomputeAllLabels).toHaveBeenCalledTimes(1);
		expect(recurringSeriesService.foldAllChangeNotes).toHaveBeenCalledTimes(1);
		expect(derivedDataRefreshService.recomputeAllLabels.mock.invocationCallOrder[0]).toBeLessThan(
			recurringSeriesService.foldAllChangeNotes.mock.invocationCallOrder[0],
		);
		expect(conversionService.backfill).not.toHaveBeenCalled();
	});
});
