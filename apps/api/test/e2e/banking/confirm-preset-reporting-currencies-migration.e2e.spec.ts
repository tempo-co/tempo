import {getRepositoryToken} from '@nestjs/typeorm';
import {type ReportingCurrency} from '@tempo/contracts';
import {DataSource, Repository} from 'typeorm';

import {ConfirmPresetReportingCurrencies20261119150000} from '@core/database/migrations/20261119150000-confirm-preset-reporting-currencies';
import {Account} from '@modules/account/account.entity';
import {ReportingCurrencyService} from '@modules/banking/services/reporting-currency.service';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

describe('ConfirmPresetReportingCurrencies migration', () => {
	it('records a currency set before owners could choose one as chosen, so the owner is not asked again', async () => {
		const app = getApp();
		const accounts: Repository<Account> = app.get(getRepositoryToken(Account));
		const fixtures = new BankingFixtures(app);
		const {owner, agent, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: null});
		await fixtures.bankAccounts.delete({id: bankAccount.id});
		await fixtures.createBankAccounts(connection, [{currency: 'EUR'}, {currency: 'GBP'}]);
		const stateless = await createBankingOwner(app, {baseCurrency: null});
		await accounts.query(
			`UPDATE "accounts" SET "baseCurrency" = 'CHF', "baseCurrencyState" = 'PRESET' WHERE "id" = $1`,
			[owner.id],
		);
		await accounts.query(
			`UPDATE "accounts" SET "baseCurrency" = 'USD', "baseCurrencyState" = NULL WHERE "id" = $1`,
			[stateless.owner.id],
		);

		const queryRunner = app.get(DataSource).createQueryRunner();
		try {
			await new ConfirmPresetReportingCurrencies20261119150000().up(queryRunner);
		} finally {
			await queryRunner.release();
		}

		expect(await accounts.findOneByOrFail({id: owner.id})).toMatchObject({
			baseCurrency: 'CHF',
			baseCurrencyState: 'CONFIRMED',
		});
		expect(await accounts.findOneByOrFail({id: stateless.owner.id})).toMatchObject({
			baseCurrency: 'USD',
			baseCurrencyState: 'CONFIRMED',
		});
		await app.get(ReportingCurrencyService).reconcileSafely(owner.id, {historySettled: true});
		expect((await agent.get('/reporting-currency').expect(200)).body as ReportingCurrency).toMatchObject({
			currency: 'CHF',
			confirmed: true,
			setupRequired: false,
		});
	});
});
