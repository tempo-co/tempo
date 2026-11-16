import {QueryRunner} from 'typeorm';

import {RestampSameDayRowsNewestFirst20261119090000} from './migrations/20261119090000-restamp-same-day-rows-newest-first';

describe('RestampSameDayRowsNewestFirst migration', () => {
	it('does nothing on a database without bank transactions, which the schema script creates from the entities', async () => {
		const query = jest.fn();
		const queryRunner = {hasTable: jest.fn().mockResolvedValue(false), query} as unknown as QueryRunner;

		await new RestampSameDayRowsNewestFirst20261119090000().up(queryRunner);

		expect(queryRunner.hasTable).toHaveBeenCalledWith('bank_transactions');
		expect(query).not.toHaveBeenCalled();
	});
});
