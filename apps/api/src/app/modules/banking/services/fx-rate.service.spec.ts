import {Repository} from 'typeorm';

import {BankTransactionFxRate} from '../bank-transaction-fx-rate.entity';
import {FxRateService} from './fx-rate.service';

describe('FxRateService', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('fetches and persists ECB daily rates for uncovered ranges', async () => {
		const repository = {
			query: jest.fn().mockResolvedValue([{minimumDate: null, maximumDate: null, hasGap: false}]),
			upsert: jest.fn().mockResolvedValue(undefined),
		} as unknown as Repository<BankTransactionFxRate>;
		const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			text: async () =>
				'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n' +
				'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-08-24,1.1664\n' +
				'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-08-25,1.1662\n',
		} as Response);
		const service = new FxRateService(repository);

		await service.ensureRates(['EUR', 'usd'], '2026-08-24', '2026-08-25');

		expect(fetchMock).toHaveBeenCalledWith(
			'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=2026-08-24&endPeriod=2026-08-25&format=csvdata',
			expect.objectContaining({headers: {Accept: 'text/csv'}}),
		);
		expect(repository.upsert).toHaveBeenCalledWith(
			[
				{currency: 'USD', rateDate: '2026-08-24', rateToEur: '1.1664', provider: 'ECB'},
				{currency: 'USD', rateDate: '2026-08-25', rateToEur: '1.1662', provider: 'ECB'},
			],
			['currency', 'rateDate'],
		);
	});
});
