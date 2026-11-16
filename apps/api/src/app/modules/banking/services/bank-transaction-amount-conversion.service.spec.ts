import {DataSource, Repository} from 'typeorm';

import {BankAccount} from '../bank-account.entity';
import {BankTransaction} from '../bank-transaction.entity';
import {BankTransactionAmountConversionService} from './bank-transaction-amount-conversion.service';
import {CurrencyExchangeService} from './currency-exchange.service';
import {FxRateService} from './fx-rate.service';
import {OwnTransferService} from './own-transfer.service';

describe('BankTransactionAmountConversionService', () => {
	const NOW = new Date('2026-03-10T12:00:00Z');
	let transactionQuery: jest.Mock;
	let ownerQuery: jest.Mock;
	let exchanges: {recomputeForOwnerSafely: jest.Mock};
	let ownTransfers: {recomputeForOwnerSafely: jest.Mock};
	let service: BankTransactionAmountConversionService;

	/** One owner with one pending base-currency row, converted by the backfill when `converted` is 1. */
	function pendingOwner(converted: number): void {
		transactionQuery.mockResolvedValueOnce([
			{accountId: 'owner-id', currency: 'EUR', fromDate: '2026-03-09', toDate: '2026-03-09', count: 1},
		]);
		ownerQuery.mockResolvedValueOnce([
			{id: 'owner-id', baseCurrency: 'EUR', baseCurrencyRevision: 0, baseAmountsRevision: 0},
		]);
		// Inside the conversion transaction: the lock, the owner's current currency, the conversion.
		ownerQuery
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{baseCurrency: 'EUR', baseCurrencyRevision: 0}])
			.mockResolvedValueOnce([{count: converted}]);
	}

	beforeEach(() => {
		transactionQuery = jest.fn();
		ownerQuery = jest.fn();
		exchanges = {recomputeForOwnerSafely: jest.fn()};
		ownTransfers = {recomputeForOwnerSafely: jest.fn()};
		service = new BankTransactionAmountConversionService(
			{
				query: ownerQuery,
				transaction: (work: (manager: unknown) => Promise<unknown>) => work({query: ownerQuery}),
			} as unknown as DataSource,
			{query: jest.fn().mockResolvedValue([])} as unknown as Repository<BankAccount>,
			{query: transactionQuery} as unknown as Repository<BankTransaction>,
			{ensureLatestRates: jest.fn(), ensureRates: jest.fn()} as unknown as FxRateService,
			exchanges as unknown as CurrencyExchangeService,
			ownTransfers as unknown as OwnTransferService,
		);
	});

	it('recomputes own transfers over the whole history only when the exchange recompute reclassified rows or failed', async () => {
		// Detection reads no converted amount, so conversions that change no exchange leave own transfers alone.
		pendingOwner(1);
		exchanges.recomputeForOwnerSafely.mockResolvedValueOnce([]);
		await service.backfill(NOW);
		expect(exchanges.recomputeForOwnerSafely).toHaveBeenCalledWith('owner-id');
		expect(ownTransfers.recomputeForOwnerSafely).not.toHaveBeenCalled();

		pendingOwner(1);
		exchanges.recomputeForOwnerSafely.mockResolvedValueOnce(['former-exchange-id']);
		await service.backfill(NOW);
		expect(ownTransfers.recomputeForOwnerSafely).toHaveBeenLastCalledWith('owner-id');

		// A failed exchange recompute may still have committed, so which rows changed is unknown.
		pendingOwner(1);
		exchanges.recomputeForOwnerSafely.mockResolvedValueOnce(null);
		await service.backfill(NOW);
		expect(ownTransfers.recomputeForOwnerSafely.mock.calls).toEqual([['owner-id'], ['owner-id']]);
	});

	it('recomputes nothing when no amount was converted', async () => {
		pendingOwner(0);
		await service.backfill(NOW);
		expect(exchanges.recomputeForOwnerSafely).not.toHaveBeenCalled();
		expect(ownTransfers.recomputeForOwnerSafely).not.toHaveBeenCalled();
	});
});
