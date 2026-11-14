import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {EnableBankingTransaction, EnableBankingTransactionsResult} from '@modules/banking/enable-banking.types';

import {BankingFixtures} from '../../scripts/seed-data/banking-fixtures';
import {createVerifiedAccount} from './auth-utils';
import {MAILPIT_API_URL} from './email-utils';

/**
 * A real verified owner with one empty bank account; transaction history stays with the scenario. A base currency
 * passed here counts as one the owner chose.
 */
export async function createBankingOwner(
	app: INestApplication,
	{baseCurrency}: {baseCurrency: Account['baseCurrency']},
) {
	const fresh = await createVerifiedAccount(app.getHttpServer(), MAILPIT_API_URL);
	const accounts = app.get<Repository<Account>>(getRepositoryToken(Account));
	await accounts.update({id: fresh.id}, {baseCurrency, baseCurrencyState: baseCurrency ? 'CONFIRMED' : null});
	const owner = await accounts.findOneByOrFail({id: fresh.id});
	const fixtures = new BankingFixtures(app);
	const connection = await fixtures.createConnection(owner);
	const bankAccount = await fixtures.createBankAccount(connection);
	return {owner, agent: fresh.agent, connection, bankAccount};
}

/** What a mocked transaction fetch resolves to: these rows, plus how many unreadable rows the provider sent. */
export function fetchedTransactions(
	transactions: EnableBankingTransaction[],
	unparseableCount = 0,
): EnableBankingTransactionsResult {
	return {transactions, unparseableCount};
}
