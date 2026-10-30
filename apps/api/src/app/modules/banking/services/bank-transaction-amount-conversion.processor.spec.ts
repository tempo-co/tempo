import {Job} from 'bullmq';

import {
	BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB,
	BANK_TRANSACTION_AMOUNT_CONVERSION_JOB,
} from '@core/queue/queue.constants';

import {BankTransactionAmountConversionProcessor} from './bank-transaction-amount-conversion.processor';
import {BankTransactionAmountConversionJobData} from './bank-transaction-amount-conversion.queue.service';

describe('BankTransactionAmountConversionProcessor', () => {
	const job = {name: BACKFILL_BANK_TRANSACTION_AMOUNTS_JOB} as Job<BankTransactionAmountConversionJobData>;

	it('does not process conversion jobs when banking integration is disabled', async () => {
		const conversionService = {backfill: jest.fn()};
		const configurationService = {get: jest.fn().mockReturnValue(false)};

		await new BankTransactionAmountConversionProcessor(
			conversionService as never,
			configurationService as never,
		).process(job);

		expect(conversionService.backfill).not.toHaveBeenCalled();
	});

	it('processes supported conversion jobs when banking integration is enabled', async () => {
		const conversionService = {backfill: jest.fn().mockResolvedValue(undefined)};
		const configurationService = {get: jest.fn().mockReturnValue(true)};
		const conversionJob = {
			name: BANK_TRANSACTION_AMOUNT_CONVERSION_JOB,
		} as Job<BankTransactionAmountConversionJobData>;

		await new BankTransactionAmountConversionProcessor(
			conversionService as never,
			configurationService as never,
		).process(conversionJob);

		expect(conversionService.backfill).toHaveBeenCalledTimes(1);
	});
});
