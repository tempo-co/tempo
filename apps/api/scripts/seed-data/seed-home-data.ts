import {INestApplicationContext} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankImport} from '@modules/file-import/bank-import.entity';

import {BankingFixtures, bookedRow} from './banking-fixtures';
import {HOME_ACCOUNT_EMAIL} from './seed.constants';

/** April to September 2026: the six complete months the usual pace of October averages. */
const USUAL_MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
/** Groceries on the 5th, 12th and 20th of each usual month, varying a little month to month. */
const GROCERIES = [
	['-62.40', '-48.10', '-81.25'],
	['-55.00', '-51.30', '-77.80'],
	['-70.15', '-44.60', '-90.05'],
	['-58.70', '-49.95', '-84.40'],
	['-66.20', '-53.35', '-79.10'],
	['-61.85', '-47.70', '-88.65'],
];

const payee = (name: string, category: string | null) => ({counterpartyName: name, description: name, category});

/**
 * Seeds the owner Home's flow reads, seen on 20 October 2026: a synced current account whose last successful sync was
 * on 14 October, with history from March, so April to September are six complete months; and an imported-files
 * savings account whose newest import runs to 2 October. October holds two rows to check. Nothing changes its data.
 */
export async function seedHomeData(app: INestApplicationContext) {
	const accounts = app.get<Repository<Account>>(getRepositoryToken(Account));
	const imports = app.get<Repository<BankImport>>(getRepositoryToken(BankImport));
	const fixtures = new BankingFixtures(app);
	const account = await accounts.findOneByOrFail({email: HOME_ACCOUNT_EMAIL});
	await accounts.update(account.id, {
		baseCurrency: 'EUR',
		baseCurrencyState: 'CONFIRMED',
		timeZone: 'Europe/Amsterdam',
	});

	const synced = await fixtures.createConnection(account, {
		aspspName: 'Example Bank',
		providerSessionId: 'seed-home-session',
		lastSyncedAt: new Date('2026-10-14T09:00:00.000Z'),
	});
	await fixtures.createSyncRun(synced, {
		startedAt: new Date('2026-10-14T08:59:50.000Z'),
		finishedAt: new Date('2026-10-14T09:00:00.000Z'),
		requestedTo: '2026-10-14',
	});
	const current = await fixtures.createBankAccount(synced, {
		providerAccountId: 'seed-home-account',
		identificationHash: 'seed-home-hash',
		name: 'Current account',
		cashAccountType: 'CACC',
		currentBalanceAmount: '2184.60',
		currentBalanceType: 'AVAILABLE',
		balanceUpdatedAt: new Date('2026-10-14T09:00:00.000Z'),
	});
	await fixtures.createTransactions(current, [
		bookedRow('2026-03-28', '-35.00', payee('Example Cafe', 'EATING_OUT')),
		...USUAL_MONTHS.flatMap((month, index) => [
			bookedRow(`${month}-01`, '-950.00', payee('Example Housing', 'HOUSING_AND_UTILITIES')),
			bookedRow(`${month}-05`, GROCERIES[index][0], payee('Example Market', 'GROCERIES')),
			bookedRow(`${month}-08`, '-32.50', payee('Example Cafe', 'EATING_OUT')),
			bookedRow(`${month}-12`, GROCERIES[index][1], payee('Example Market', 'GROCERIES')),
			bookedRow(`${month}-20`, GROCERIES[index][2], payee('Example Market', 'GROCERIES')),
			bookedRow(`${month}-25`, '2600.00', payee('Example Employer', 'INCOME')),
		]),
		bookedRow('2026-10-01', '-950.00', payee('Example Housing', 'HOUSING_AND_UTILITIES')),
		bookedRow('2026-10-04', '-41.20', payee('Example Market', 'GROCERIES')),
		bookedRow('2026-10-08', '-28.90', payee('Example Cafe', 'EATING_OUT')),
		bookedRow('2026-10-11', '-64.00', payee('Example Shop', 'NEEDS_REVIEW')),
		bookedRow('2026-10-13', '-19.99', payee('Example Bookshop', 'NEEDS_REVIEW')),
	]);

	const files = await fixtures.createConnection(account, {
		provider: 'file',
		aspspName: 'Imported files',
		aspspCountry: 'ZZ',
		consentValidUntil: null,
	});
	const savings = await fixtures.createBankAccount(files, {
		providerAccountId: 'seed-home-savings',
		identificationHash: 'seed-home-savings-hash',
		name: 'Savings',
		cashAccountType: 'SVGS',
		currentBalanceAmount: '5400.00',
		balanceUpdatedAt: new Date('2026-10-02T00:00:00.000Z'),
	});
	await fixtures.createTransactions(savings, [
		bookedRow('2026-09-03', '200.00', payee('Example Interest', 'INCOME')),
		bookedRow('2026-10-02', '-15.00', payee('Example Fees', 'SERVICES')),
	]);
	await imports.save(
		imports.create({
			accountId: account.id,
			bankConnectionId: files.id,
			fileHash: 'seed-home-import',
			format: 'camt053',
			filesCount: 1,
			rowsParsed: 2,
			rowsAdded: 2,
			rowsAlreadyPresent: 0,
			dateFrom: '2026-09-01',
			dateTo: '2026-10-02',
			bankAccountIds: [savings.id],
			createdBankAccountIds: [savings.id],
		}),
	);
}
