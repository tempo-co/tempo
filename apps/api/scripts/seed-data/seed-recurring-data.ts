import {INestApplicationContext} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {BankingFixtures, bookedRow} from './banking-fixtures';
import {RECURRING_ACCOUNT_EMAIL} from './seed.constants';

const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const ENERGY = ['61.00', '95.00', '48.00', '80.00', '77.00'];

const payee = (name: string, category: string) => ({counterpartyName: name, description: name, category});

/**
 * Seeds an owner whose payments, seen on 15 October 2026, fill each of the month's groups: a gym paid on the 3rd, a
 * varying energy bill late since the 12th, internet coming up on the 20th, salary due on the 25th, and a quarterly
 * insurance with nothing in October. Only the Recurring flow reads it; the flow puts back what it hides.
 */
export async function seedRecurringData(app: INestApplicationContext) {
	const accounts = app.get<Repository<Account>>(getRepositoryToken(Account));
	const fixtures = new BankingFixtures(app);
	const account = await accounts.findOneByOrFail({email: RECURRING_ACCOUNT_EMAIL});
	await accounts.update(account.id, {baseCurrency: 'EUR', baseCurrencyState: 'CONFIRMED'});
	const bankAccount = await fixtures.createBankAccount(
		await fixtures.createConnection(account, {
			providerSessionId: 'seed-recurring-session',
			lastSyncedAt: new Date('2026-10-14T12:00:00.000Z'),
		}),
		{providerAccountId: 'seed-recurring-account', identificationHash: 'seed-recurring-hash'},
	);
	await fixtures.createTransactions(bankAccount, [
		...MONTHS.map((month) => bookedRow(`${month}-03`, '-29.99', payee('Example Gym', 'HEALTH'))),
		...ENERGY.map((amount, month) =>
			bookedRow(`${MONTHS[month]}-12`, `-${amount}`, payee('Example Energy', 'UTILITIES')),
		),
		...MONTHS.slice(0, 5).map((month) => bookedRow(`${month}-20`, '-40.00', payee('Example Internet', 'SERVICES'))),
		...MONTHS.slice(0, 5).map((month) => bookedRow(`${month}-25`, '2500.00', payee('Example Employer', 'INCOME'))),
		...['2026-02-25', '2026-05-25', '2026-08-25'].map((date) =>
			bookedRow(date, '-90.00', payee('Example Insurer', 'INSURANCE')),
		),
	]);
}
