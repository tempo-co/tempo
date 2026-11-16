import {Job} from 'bullmq';

import {
	BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB,
	BANK_TRANSACTION_AMOUNT_CONVERSION_JOB,
	RECOMPUTE_OWN_TRANSFERS_JOB,
} from '@core/queue/queue.constants';

import {BankTransactionAmountConversionProcessor} from './bank-transaction-amount-conversion.processor';
import {BankTransactionAmountConversionJobData} from './bank-transaction-amount-conversion.queue.service';

describe('BankTransactionAmountConversionProcessor', () => {
	const job = (name: string) => ({name}) as Job<BankTransactionAmountConversionJobData>;
	const setup = (enabled: boolean | Record<string, boolean>) => {
		const conversionService = {backfill: jest.fn().mockResolvedValue(undefined)};
		const ownTransferService = {recomputeAllOwners: jest.fn().mockResolvedValue(undefined)};
		const recurringSeriesService = {foldAllChangeNotes: jest.fn().mockResolvedValue(undefined)};
		const processor = new BankTransactionAmountConversionProcessor(
			conversionService as never,
			{
				get: jest.fn((key: string) => (typeof enabled === 'boolean' ? enabled : (enabled[key] ?? false))),
			} as never,
			ownTransferService as never,
			recurringSeriesService as never,
		);
		return {conversionService, ownTransferService, recurringSeriesService, processor};
	};

	it('does not process jobs when banking integration is disabled', async () => {
		const {conversionService, ownTransferService, recurringSeriesService, processor} = setup(false);

		await processor.process(job(BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB));
		await processor.process(job(RECOMPUTE_OWN_TRANSFERS_JOB));

		expect(conversionService.backfill).not.toHaveBeenCalled();
		expect(ownTransferService.recomputeAllOwners).not.toHaveBeenCalled();
		expect(recurringSeriesService.foldAllChangeNotes).not.toHaveBeenCalled();
	});

	it('processes supported conversion jobs when banking integration is enabled', async () => {
		const {conversionService, ownTransferService, processor} = setup(true);

		await processor.process(job(BANK_TRANSACTION_AMOUNT_CONVERSION_JOB));

		expect(conversionService.backfill).toHaveBeenCalledTimes(1);
		expect(ownTransferService.recomputeAllOwners).not.toHaveBeenCalled();
	});

	it('converts imported statements while bank synchronization is off', async () => {
		const {conversionService, processor} = setup({BANKING_INTEGRATION_ENABLED: false, FILE_IMPORT_ENABLED: true});

		await processor.process(job(BANK_TRANSACTION_AMOUNT_CONVERSION_JOB));

		expect(conversionService.backfill).toHaveBeenCalledTimes(1);
	});

	it('runs the daily whole-history own-transfer recompute, then folds every owner’s history change notes', async () => {
		const {conversionService, ownTransferService, recurringSeriesService, processor} = setup(true);

		await processor.process(job(RECOMPUTE_OWN_TRANSFERS_JOB));

		expect(ownTransferService.recomputeAllOwners).toHaveBeenCalledTimes(1);
		expect(recurringSeriesService.foldAllChangeNotes).toHaveBeenCalledTimes(1);
		expect(ownTransferService.recomputeAllOwners.mock.invocationCallOrder[0]).toBeLessThan(
			recurringSeriesService.foldAllChangeNotes.mock.invocationCallOrder[0],
		);
		expect(conversionService.backfill).not.toHaveBeenCalled();
	});
});
