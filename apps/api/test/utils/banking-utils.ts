import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';

import {BankingFixtures} from '../../scripts/seed-data/banking-fixtures';
import {createVerifiedAccount} from './auth-utils';

/** A real verified owner with one empty bank account; transaction history stays with the scenario. */
export async function createBankingOwner(
	app: INestApplication,
	{baseCurrency}: {baseCurrency: Account['baseCurrency']},
) {
	const fresh = await createVerifiedAccount(app.getHttpServer(), app.get(ConfigurationService).get('EMAIL_UI_URL'));
	const accounts = app.get<Repository<Account>>(getRepositoryToken(Account));
	await accounts.update({id: fresh.id}, {baseCurrency});
	const owner = await accounts.findOneByOrFail({id: fresh.id});
	const fixtures = new BankingFixtures(app);
	const connection = await fixtures.createConnection(owner);
	const bankAccount = await fixtures.createBankAccount(connection);
	return {owner, agent: fresh.agent, connection, bankAccount};
}
