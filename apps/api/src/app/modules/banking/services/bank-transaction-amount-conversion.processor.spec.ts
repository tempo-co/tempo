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
	const setup = (enabled: boolean) => {
		const conversionService = {backfill: jest.fn().mockResolvedValue(undefined)};
		const ownTransferService = {recomputeAllOwners: jest.fn().mockResolvedValue(undefined)};
		const processor = new BankTransactionAmountConversionProcessor(
			conversionService as never,
			{get: jest.fn().mockReturnValue(enabled)} as never,
			ownTransferService as never,
		);
		return {conversionService, ownTransferService, processor};
	};

	it('does not process jobs when banking integration is disabled', async () => {
		const {conversionService, ownTransferService, processor} = setup(false);

		await processor.process(job(BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB));
		await processor.process(job(RECOMPUTE_OWN_TRANSFERS_JOB));

		expect(conversionService.backfill).not.toHaveBeenCalled();
		expect(ownTransferService.recomputeAllOwners).not.toHaveBeenCalled();
	});

	it('processes supported conversion jobs when banking integration is enabled', async () => {
		const {conversionService, ownTransferService, processor} = setup(true);

		await processor.process(job(BANK_TRANSACTION_AMOUNT_CONVERSION_JOB));

		expect(conversionService.backfill).toHaveBeenCalledTimes(1);
		expect(ownTransferService.recomputeAllOwners).not.toHaveBeenCalled();
	});

	it('runs the daily whole-history own-transfer recompute', async () => {
		const {conversionService, ownTransferService, processor} = setup(true);

		await processor.process(job(RECOMPUTE_OWN_TRANSFERS_JOB));

		expect(ownTransferService.recomputeAllOwners).toHaveBeenCalledTimes(1);
		expect(conversionService.backfill).not.toHaveBeenCalled();
	});
});
