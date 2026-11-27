import {INestApplicationContext} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankingFixtures, bookedRow} from './banking-fixtures';
import {LEFT_OUT_ACCOUNT_EMAIL} from './seed.constants';

/** Fixed ids, so the web spec can count every row in totals again before each run. */
export const SEEDED_LEFT_OUT_IDS = {
	cafe: '00000000-0000-4000-8000-000000000501',
	bookshop: '00000000-0000-4000-8000-000000000502',
	market: '00000000-0000-4000-8000-000000000503',
	salary: '00000000-0000-4000-8000-000000000504',
} as const;

/**
 * Seeds an owner for leaving rows out of totals: three payments (Example Cafe, Example Bookshop, Example Market) and a
 * salary, all counted, in EUR.
 */
export async function seedLeftOutData(app: INestApplicationContext) {
	const accounts = app.get<Repository<Account>>(getRepositoryToken(Account));
	const account = await accounts.findOneByOrFail({email: LEFT_OUT_ACCOUNT_EMAIL});
	await accounts.update(account.id, {baseCurrency: 'EUR', baseCurrencyState: 'CONFIRMED'});
	const fixtures = new BankingFixtures(app);
	const connection = await fixtures.createConnection(account, {
		providerSessionId: 'seed-left-out-session',
		lastSyncedAt: new Date('2026-09-21T12:00:00.000Z'),
	});
	const bankAccount = await fixtures.createBankAccount(connection, {
		providerAccountId: 'seed-left-out-account',
		identificationHash: 'seed-left-out-hash',
	});
	const ids = SEEDED_LEFT_OUT_IDS;
	const payee = (name: string) => ({description: name, counterpartyName: name});
	await fixtures.createTransactions(bankAccount, [
		bookedRow('2026-09-20', '-4.50', {id: ids.cafe, ...payee('Example Cafe'), category: 'EATING_OUT'}),
		bookedRow('2026-09-18', '-12.00', {id: ids.bookshop, ...payee('Example Bookshop')}),
		bookedRow('2026-09-15', '-23.40', {id: ids.market, ...payee('Example Market'), category: 'GROCERIES'}),
		bookedRow('2026-09-01', '1500.00', {id: ids.salary, ...payee('Example Employer'), category: 'INCOME'}),
	]);
}
