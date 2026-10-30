import {BANK_TRANSACTION_AMOUNT_CONVERSION_SCHEDULER_ID} from '@core/queue/queue.constants';

import {BankTransactionAmountConversionQueueService} from './bank-transaction-amount-conversion.queue.service';

describe('BankTransactionAmountConversionQueueService', () => {
	const configurationService = {get: jest.fn().mockReturnValue('production')};

	afterEach(() => {
		configurationService.get.mockReset().mockReturnValue('production');
	});

	it('re-enqueues a failed one-time backfill and keeps the scheduler idempotent', async () => {
		const remove = jest.fn();
		const queue = {
			getJob: jest.fn().mockResolvedValue({getState: jest.fn().mockResolvedValue('failed'), remove}),
			add: jest.fn(),
			upsertJobScheduler: jest.fn(),
		};

		await new BankTransactionAmountConversionQueueService(
			queue as never,
			configurationService as never,
		).onModuleInit();

		expect(remove).toHaveBeenCalledTimes(1);
		expect(queue.add).toHaveBeenCalledTimes(1);
		expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
	});

	it('does not enqueue conversion work when banking integration is disabled', async () => {
		configurationService.get.mockImplementation((key: string) => (key === 'NODE_ENV' ? 'production' : false));
		const queue = {
			getJob: jest.fn(),
			add: jest.fn(),
			upsertJobScheduler: jest.fn(),
			removeJobScheduler: jest.fn().mockResolvedValue(false),
		};

		await new BankTransactionAmountConversionQueueService(
			queue as never,
			configurationService as never,
		).onModuleInit();

		expect(queue.getJob).not.toHaveBeenCalled();
		expect(queue.add).not.toHaveBeenCalled();
		expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
		expect(queue.removeJobScheduler).toHaveBeenCalledWith(BANK_TRANSACTION_AMOUNT_CONVERSION_SCHEDULER_ID);
	});

	it('enqueues the one-time backfill and keeps booting when Redis refuses the scheduler or the backfill', async () => {
		const queue = {
			getJob: jest.fn().mockResolvedValue(undefined),
			add: jest.fn().mockRejectedValue(new Error('redis unavailable')),
			upsertJobScheduler: jest.fn().mockRejectedValue(new Error('redis unavailable')),
		};

		await expect(
			new BankTransactionAmountConversionQueueService(
				queue as never,
				configurationService as never,
			).onModuleInit(),
		).resolves.toBeUndefined();

		expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
		expect(queue.add).toHaveBeenCalledTimes(1);
	});

	it('does not enqueue a completed one-time backfill again', async () => {
		const queue = {
			getJob: jest
				.fn()
				.mockResolvedValue({getState: jest.fn().mockResolvedValue('completed'), remove: jest.fn()}),
			add: jest.fn(),
			upsertJobScheduler: jest.fn(),
		};

		await new BankTransactionAmountConversionQueueService(
			queue as never,
			configurationService as never,
		).onModuleInit();

		expect(queue.add).not.toHaveBeenCalled();
		expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
	});
});
