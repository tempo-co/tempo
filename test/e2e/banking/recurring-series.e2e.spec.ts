import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {randomUUID} from 'node:crypto';
import TestAgent from 'supertest/lib/agent';
import {In, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {RecurringPayeeAlias} from '@modules/banking/recurring/recurring-payee-alias.entity';
import {RecurringSeriesDecision} from '@modules/banking/recurring/recurring-series-decision.entity';
import {seriesKey} from '@modules/banking/recurring/recurring-series-detection';

import {
	BankingFixtures,
	CURRENCY_EXCHANGE_EVENT,
	bookedRow as fixtureBookedRow,
} from '../../../scripts/seed-data/banking-fixtures';
import {
	SESSION_TEST_ACCOUNT_EMAIL,
	SESSION_TEST_ACCOUNT_PASSWORD,
	VERIFIED_ACCOUNT_EMAIL,
	VERIFIED_ACCOUNT_PASSWORD,
} from '../../../scripts/seed-data/seed.constants';
import {getApp, loginAgent} from '../../setup/e2e.setup';

const AS_OF = '2026-10-17';
const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

// These fixtures are bills unless a test explicitly supplies ordinary retail or another payment purpose.
const bookedRow: typeof fixtureBookedRow = (date, amount, overrides = {}) =>
	fixtureBookedRow(date, amount, {category: 'SUBSCRIPTIONS', ...overrides});

type SeriesBody = {
	key: string;
	name: string;
	cadence: string;
	amountKind: string;
	currency: string;
	typicalAmount: string;
	monthlyEquivalent: string | null;
	transactionCount: number;
	nextExpectedDate: string;
	status: string;
	flags: string[];
	decision: string | null;
};

function monthly(day: string, amount: string, counterpartyName: string, overrides: Record<string, unknown> = {}) {
	return MONTHS.map((month) =>
		bookedRow(`${month}-${day}`, amount, {counterpartyName, description: counterpartyName, ...overrides}),
	);
}

describe('RecurringSeries', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let owner: Account;
	let otherOwner: Account;
	let ownerAgent: TestAgent;
	let otherAgent: TestAgent;
	let ownerBankAccount: BankAccount;

	const list = async (agent: TestAgent, direction = 'EXPENSE') =>
		(await agent.get('/recurring-series').query({asOf: AS_OF, direction}).expect(200)).body as {
			series: SeriesBody[];
			confirmedMonthlyTotal: string;
			unconvertedConfirmedCount: number;
			baseCurrency: string | null;
		};
	const byName = (series: SeriesBody[], name: string) => series.filter((entry) => entry.name === name);

	beforeAll(async () => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		const accounts: Repository<Account> = app.get(getRepositoryToken(Account));
		const accountService = app.get(AccountService);
		owner = (await accountService.findByEmail(VERIFIED_ACCOUNT_EMAIL))!;
		otherOwner = (await accountService.findByEmail(SESSION_TEST_ACCOUNT_EMAIL))!;
		ownerAgent = await loginAgent(app.getHttpServer(), VERIFIED_ACCOUNT_EMAIL, VERIFIED_ACCOUNT_PASSWORD);
		otherAgent = await loginAgent(app.getHttpServer(), SESSION_TEST_ACCOUNT_EMAIL, SESSION_TEST_ACCOUNT_PASSWORD);
		await accounts.update({id: owner.id}, {baseCurrency: 'EUR'});

		ownerBankAccount = await fixtures.createBankAccount(await fixtures.createConnection(owner));
		const ownerGbpAccount = await fixtures.createBankAccount(await fixtures.createConnection(owner), {
			currency: 'GBP',
		});
		const otherBankAccount = await fixtures.createBankAccount(await fixtures.createConnection(otherOwner));

		await fixtures.createTransactions(ownerBankAccount, [
			...monthly('03', '-29.99', 'Example Gym', {category: 'SUBSCRIPTIONS'}),
			// Price step on the last payment.
			...monthly('08', '-10.00', 'Example Streaming').slice(0, 5),
			bookedRow('2026-10-08', '-11.50', {
				counterpartyName: 'Example Streaming',
				description: 'Example Streaming',
			}),
			// Late: the October payment was due on the 14th and has not arrived.
			...monthly('14', '-45.00', 'Example Phone').slice(0, 5),
			// Ended in June.
			...monthly('02', '-15.00', 'Example Magazine').slice(0, 2),
			bookedRow('2026-04-02', '-15.00', {counterpartyName: 'Example Magazine', description: 'Example Magazine'}),
			...['2024-09-12', '2025-09-12', '2026-09-14'].map((date) =>
				bookedRow(date, '-120.00', {
					counterpartyName: 'Example Insurer',
					description: 'Example Insurer',
					category: 'INSURANCE',
				}),
			),
			// Irregular purchases at one shop.
			...['2026-06-02', '2026-06-20', '2026-07-30', '2026-08-04', '2026-09-27', '2026-10-01'].map((date) =>
				bookedRow(date, '-15.00', {counterpartyName: 'Example Shop', description: 'Example Shop'}),
			),
			// Monthly own transfers, currency exchanges, refunds and pending rows are never recurring payments.
			...monthly('10', '-200.00', 'Example Savings', {ownTransferEvidence: 'IBAN', category: 'TRANSFER_OUT'}),
			...monthly('11', '-50.00', 'Example Exchange', {
				category: null,
				categoryStatus: 'NOT_APPLICABLE',
				...CURRENCY_EXCHANGE_EVENT,
			}),
			...monthly('12', '5.00', 'Example Refunder', {category: 'REFUND'}),
			...monthly('13', '-7.00', 'Example Pending', {transactionStatus: 'PDNG'}),
			...monthly('25', '2500.00', 'Example Employer', {category: 'INCOME'}),
			// A bank that marks settled payments COMPLETED, then switches format: the person's name moves from the
			// description to the counterparty, with accents and without a middle name.
			...MONTHS.slice(0, 4).map((month, index) =>
				bookedRow(`${month}-27`, '-650.00', {
					// A row without any status counts as settled too.
					transactionStatus: index === 0 ? null : 'COMPLETED',
					counterpartyName: null,
					description: 'Transfer to ALEX-SAM EXAMPLE',
					category: 'HOUSING_AND_UTILITIES',
				}),
			),
			bookedRow('2026-09-27', '-650.00', {
				counterpartyName: 'Alex Exämple',
				description: 'rent',
				category: 'HOUSING_AND_UTILITIES',
			}),
		]);
		await fixtures.createTransactions(ownerGbpAccount, [
			...monthly('03', '-29.99', 'Example Gym', {currency: 'GBP', amountInBaseCurrency: '-34.50'}),
		]);
		await fixtures.createTransactions(otherBankAccount, monthly('04', '-60.00', 'Example Club'));
	});

	it('recurring aliases: applies only the owners approved mappings and keeps source rows unchanged', async () => {
		const aliases: Repository<RecurringPayeeAlias> = app.get(getRepositoryToken(RecurringPayeeAlias));
		const oldName = 'Example Mapped Legacy';
		const currentName = 'Example Mapped Current';
		const seed = async (bankAccount: BankAccount) =>
			fixtures.createTransactions(
				bankAccount,
				MONTHS.map((month, index) =>
					bookedRow(`${month}-03`, index < 3 ? '-40.00' : '-68.00', {
						counterpartyName: index < 3 ? oldName : currentName,
						description: index < 3 ? oldName : currentName,
						category: 'INSURANCE',
					}),
				),
			);
		const rows = await seed(ownerBankAccount);
		const otherRows = await seed(await fixtures.createBankAccount(await fixtures.createConnection(otherOwner)));
		const ids = rows.map(({id}) => id);
		const snapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
		const payeeGroupId = randomUUID();
		await aliases.insert(
			[rows[0], rows[3]].map((row) => ({
				accountId: owner.id,
				merchantKey: row.merchantKey!,
				category: 'INSURANCE',
				payeeGroupId,
			})),
		);
		const selected = (series: SeriesBody[]) => series.filter(({name}) => [oldName, currentName].includes(name));
		const beforeTotal = (await list(ownerAgent)).confirmedMonthlyTotal;
		const result = selected((await list(ownerAgent)).series);
		expect(result).toEqual([
			expect.objectContaining({name: currentName, transactionCount: 6, monthlyEquivalent: '68.00'}),
		]);
		expect(selected((await list(otherAgent)).series)).toHaveLength(2);
		const drill = await ownerAgent
			.get('/bank-transactions')
			.query({filter: {recurringSeriesKey: result[0].key}, pagination: {pageIndex: 0, pageSize: 50}})
			.expect(200);
		expect(drill.body.total).toBe(ids.length);
		expect(drill.body.transactions.map((row: {id: string}) => row.id).sort()).toEqual([...ids].sort());
		await ownerAgent.patch(`/recurring-series/${result[0].key}/decision`).send({decision: 'CONFIRMED'}).expect(204);
		const afterTotal = (await list(ownerAgent)).confirmedMonthlyTotal;
		expect(BigInt(afterTotal.replace('.', '')) - BigInt(beforeTotal.replace('.', ''))).toBe(6800n);
		expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(snapshot);
		await ownerAgent.patch(`/recurring-series/${result[0].key}/decision`).send({decision: null}).expect(204);
		await fixtures.transactions.delete([...ids, ...otherRows.map(({id}) => id)]);
		await aliases.delete({accountId: owner.id, payeeGroupId});
	});

	it.each([
		[
			'interleaved aliases',
			3,
			0,
			true,
			['50.00', '25.00', '100.00', '75.00', '40.00', '60.00'],
			'55.00',
			'2027-01-10',
		],
		['long same-account history', 2, 24, true, ['50.00', '25.00', '100.00', '75.00'], '62.50', '2026-11-10'],
		['long moved-account history', 2, 24, false, ['50.00', '25.00', '100.00', '75.00'], '62.50', '2026-11-10'],
	] as const)(
		'current naming period: preserves confirmed cost and exact membership for %s',
		async (label, aliasCount, oldCount, sameAccount, amounts, cost, due) => {
			const aliases: Repository<RecurringPayeeAlias> = app.get(getRepositoryToken(RecurringPayeeAlias));
			const decisions: Repository<RecurringSeriesDecision> = app.get(getRepositoryToken(RecurringSeriesDecision));
			const connection = await fixtures.createConnection(owner);
			const bank = await fixtures.createBankAccount(connection);
			const oldBank = sameAccount ? bank : await fixtures.createBankAccount(connection);
			const payeeGroupId = randomUUID();
			const name = `Example Complete Period ${label}`;
			let asOf: string = due;
			const read = async () =>
				(await ownerAgent.get('/recurring-series').query({asOf, direction: 'EXPENSE'}).expect(200))
					.body as Awaited<ReturnType<typeof list>>;
			const keys: string[] = [];
			try {
				const current = await fixtures.createTransactions(
					bank,
					amounts.map((amount, index) =>
						bookedRow(`2026-${String(index + 7).padStart(2, '0')}-10`, `-${amount}`, {
							counterpartyName: `${name} Alias ${index % aliasCount}`,
							description: name,
						}),
					),
				);
				await aliases.insert(
					[...new Set(current.map(({merchantKey}) => merchantKey!))].map((merchantKey) => ({
						accountId: owner.id,
						merchantKey,
						category: 'SUBSCRIPTIONS',
						payeeGroupId,
					})),
				);
				const previous = await fixtures.createTransactions(
					oldBank,
					Array.from({length: oldCount}, (_, index) =>
						bookedRow(new Date(Date.UTC(2024, index + 6, 3)).toISOString().slice(0, 10), '-16.00', {
							counterpartyName: `${name} Historical`,
							description: name,
						}),
					),
				);
				const ids = [...previous, ...current].map(({id}) => id);
				const snapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
				const before = await read();
				const baseline = before.series.find(
					({name: entryName}) => entryName === current.at(-1)!.displayDescription,
				)!;
				expect(baseline).toMatchObject({
					amountKind: 'VARIABLE',
					typicalAmount: cost,
					monthlyEquivalent: cost,
					transactionCount: current.length,
					nextExpectedDate: due,
					status: 'ACTIVE',
				});
				keys.push(baseline.key);
				await ownerAgent
					.patch(`/recurring-series/${baseline.key}/decision`)
					.send({decision: 'CONFIRMED'})
					.expect(204);
				if (previous.length) {
					await aliases.insert({
						accountId: owner.id,
						merchantKey: previous[0].merchantKey!,
						category: 'SUBSCRIPTIONS',
						payeeGroupId,
					});
				}
				const saved = await decisions.find({
					where: {accountId: owner.id, seriesKey: In(keys)},
					order: {id: 'ASC'},
				});
				for (let attempt = 0; attempt < 2; attempt++) {
					const result = await read();
					const linked = result.series.filter(({name: entryName}) => entryName.startsWith(name));
					expect(linked).toEqual([
						expect.objectContaining({
							amountKind: 'VARIABLE',
							typicalAmount: cost,
							monthlyEquivalent: cost,
							transactionCount: ids.length,
							nextExpectedDate: due,
							status: 'ACTIVE',
							decision: 'CONFIRMED',
						}),
					]);
					keys.push(linked[0].key);
					expect(
						BigInt(result.confirmedMonthlyTotal.replace('.', '')) -
							BigInt(before.confirmedMonthlyTotal.replace('.', '')),
					).toBe(BigInt(cost.replace('.', '')));
					const drill = await ownerAgent
						.get('/bank-transactions')
						.query({
							filter: {recurringSeriesKey: linked[0].key},
							pagination: {pageIndex: 0, pageSize: 50},
						})
						.expect(200);
					expect(drill.body.total).toBe(ids.length);
					expect(drill.body.transactions.map(({id}: {id: string}) => id).sort()).toEqual([...ids].sort());
					expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(
						snapshot,
					);
					expect(
						await decisions.find({where: {accountId: owner.id, seriesKey: In(keys)}, order: {id: 'ASC'}}),
					).toEqual(saved);
				}
				const linkedKey = keys.at(-1)!;
				const returnedName =
					previous.length && sameAccount ? previous[0].counterpartyName : current[0].counterpartyName;
				const returned = await fixtures.createTransaction(
					bank,
					bookedRow(due, '-50.00', {counterpartyName: returnedName, description: name}),
				);
				ids.push(returned.id);
				const continued = await read();
				const continuedDue = new Date(Date.UTC(Number(due.slice(0, 4)), Number(due.slice(5, 7)), 10))
					.toISOString()
					.slice(0, 10);
				expect(continued.series.filter(({key}) => key === linkedKey)).toEqual([
					expect.objectContaining({
						amountKind: 'VARIABLE',
						typicalAmount: '50.00',
						monthlyEquivalent: '50.00',
						transactionCount: ids.length,
						nextExpectedDate: continuedDue,
						status: 'ACTIVE',
						decision: 'CONFIRMED',
					}),
				]);
				expect(
					BigInt(continued.confirmedMonthlyTotal.replace('.', '')) -
						BigInt(before.confirmedMonthlyTotal.replace('.', '')),
				).toBe(5000n);
				const continuedDrill = await ownerAgent
					.get('/bank-transactions')
					.query({
						filter: {recurringSeriesKey: linkedKey},
						pagination: {pageIndex: 0, pageSize: 50},
					})
					.expect(200);
				expect(continuedDrill.body.total).toBe(ids.length);
				expect(continuedDrill.body.transactions.map(({id}: {id: string}) => id).sort()).toEqual(
					[...ids].sort(),
				);
				expect(
					await decisions.find({where: {accountId: owner.id, seriesKey: In(keys)}, order: {id: 'ASC'}}),
				).toEqual(saved);
				expect(
					await fixtures.transactions.find({
						where: {id: In(ids.filter((id) => id !== returned.id))},
						order: {id: 'ASC'},
					}),
				).toEqual(snapshot);
				const continuedSnapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
				await ownerAgent
					.patch(`/recurring-series/${linkedKey}/decision`)
					.send({decision: 'DISMISSED'})
					.expect(204);
				expect((await read()).series.find(({key}) => key === linkedKey)?.decision).toBe('DISMISSED');
				const dismissed = await decisions.findBy({accountId: owner.id, seriesKey: linkedKey});
				expect(dismissed).toEqual([expect.objectContaining({decision: 'DISMISSED', transactionIds: ids})]);
				asOf = continuedDue;
				const next = await fixtures.createTransaction(
					bank,
					bookedRow(continuedDue, '-50.00', {
						counterpartyName: returnedName,
						description: name,
					}),
				);
				const after = await read();
				expect(after.series.filter(({key}) => key === linkedKey)).toEqual([
					expect.objectContaining({
						transactionCount: ids.length + 1,
						status: 'ACTIVE',
						decision: 'DISMISSED',
					}),
				]);
				expect(after.confirmedMonthlyTotal).toBe(before.confirmedMonthlyTotal);
				const drill = await ownerAgent
					.get('/bank-transactions')
					.query({
						filter: {recurringSeriesKey: linkedKey},
						pagination: {pageIndex: 0, pageSize: 50},
					})
					.expect(200);
				expect(drill.body.total).toBe(ids.length + 1);
				expect(drill.body.transactions.map(({id}: {id: string}) => id).sort()).toEqual(
					[...ids, next.id].sort(),
				);
				expect(await decisions.findBy({accountId: owner.id, seriesKey: linkedKey})).toEqual(dismissed);
				expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(
					continuedSnapshot,
				);
				const expected = after.series.find(({key}) => key === linkedKey)!.nextExpectedDate;
				asOf = new Date(Date.parse(`${expected}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
				const late = await fixtures.createTransaction(
					bank,
					bookedRow(asOf, '-50.00', {
						counterpartyName: returnedName,
						description: name,
					}),
				);
				expect((await read()).series.filter(({key}) => key === linkedKey)).toEqual([
					expect.objectContaining({decision: null, status: 'ACTIVE', transactionCount: ids.length + 2}),
				]);
				const restartedDrill = await ownerAgent
					.get('/bank-transactions')
					.query({
						filter: {recurringSeriesKey: linkedKey},
						pagination: {pageIndex: 0, pageSize: 50},
					})
					.expect(200);
				expect(restartedDrill.body.total).toBe(ids.length + 2);
				expect(restartedDrill.body.transactions.map(({id}: {id: string}) => id).sort()).toEqual(
					[...ids, next.id, late.id].sort(),
				);
				expect(await decisions.findBy({accountId: owner.id, seriesKey: linkedKey})).toEqual(dismissed);
				expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(
					continuedSnapshot,
				);
			} finally {
				if (keys.length) await decisions.delete({accountId: owner.id, seriesKey: In(keys)});
				await aliases.delete({accountId: owner.id, payeeGroupId});
				await fixtures.connections.delete(connection.id);
			}
		},
	);

	it('retail suggestions: excludes ordinary retail without banning weekly bills or income', async () => {
		const weeklyDates = ['2026-09-19', '2026-09-26', '2026-10-03'];
		const retail = await fixtures.createTransactions(ownerBankAccount, [
			...weeklyDates.map((date) =>
				bookedRow(date, '-8.00', {
					counterpartyName: 'Example Ordinary Grocery',
					description: 'Example Ordinary Grocery',
					category: 'FOOD_AND_DRINK',
				}),
			),
			...monthly('09', '-16.00', 'Example Ordinary Shop', {category: 'SHOPPING'}),
		]);
		const bills = await fixtures.createTransactions(ownerBankAccount, [
			...weeklyDates.map((date) =>
				bookedRow(date, '-8.00', {
					counterpartyName: 'Example Weekly Lessons',
					description: 'Example Weekly Lessons',
					category: 'SUBSCRIPTIONS',
				}),
			),
			...weeklyDates.map((date) =>
				bookedRow(date, '36.00', {
					counterpartyName: 'Example Weekly Employer',
					description: 'Example Weekly Employer',
					category: 'INCOME',
				}),
			),
			...['2026-04-05', '2026-07-05', '2026-10-05'].map((date) =>
				bookedRow(date, '-90.00', {
					counterpartyName: 'Example Quarterly Bill',
					description: 'Example Quarterly Bill',
					category: 'SUBSCRIPTIONS',
				}),
			),
			...MONTHS.map((month, index) =>
				bookedRow(`${month}-07`, '-20.00', {
					counterpartyName: 'Example Mixed Purpose',
					description: 'Example Mixed Purpose',
					category: index === 0 ? 'SHOPPING' : 'SUBSCRIPTIONS',
				}),
			),
		]);
		const names = (await list(ownerAgent)).series.map(({name}) => name);
		expect(names).not.toContain('Example Ordinary Grocery');
		expect(names).not.toContain('Example Ordinary Shop');
		expect(names).toEqual(
			expect.arrayContaining(['Example Weekly Lessons', 'Example Quarterly Bill', 'Example Mixed Purpose']),
		);
		expect((await list(ownerAgent, 'INCOME')).series).toEqual(
			expect.arrayContaining([expect.objectContaining({name: 'Example Weekly Employer', cadence: 'WEEKLY'})]),
		);
		const hiddenKey = seriesKey(retail[0].merchantKey!, 'EUR', retail[0].id);
		await ownerAgent.patch(`/recurring-series/${hiddenKey}/decision`).send({decision: 'CONFIRMED'}).expect(404);
		await ownerAgent
			.get('/bank-transactions')
			.query({filter: {recurringSeriesKey: hiddenKey}})
			.expect(404);
		await fixtures.transactions.delete([...retail, ...bills].map(({id}) => id));
	});

	it.each([
		['CONFIRMED', 'CONFIRMED'],
		['DISMISSED', 'DISMISSED'],
		['CONFLICT', null],
	] as const)('retail suggestions: respects prior retail %s choices until reset', async (choice, expected) => {
		const name = `Example Chosen Retail ${choice}`;
		const rows = await fixtures.createTransactions(
			ownerBankAccount,
			MONTHS.map((month, index) =>
				bookedRow(`${month}-09`, index < 3 ? '-12.00' : '-24.00', {
					counterpartyName: name,
					description: name,
					category: 'FOOD_AND_DRINK',
				}),
			),
		);
		const ids = rows.map(({id}) => id);
		const snapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
		const totalBefore = (await list(ownerAgent)).confirmedMonthlyTotal;
		const decisions: Repository<RecurringSeriesDecision> = app.get(getRepositoryToken(RecurringSeriesDecision));
		await decisions.insert(
			(choice === 'CONFLICT' ? [0, 3] : [0]).map((offset) => ({
				accountId: owner.id,
				seriesKey: seriesKey(rows[offset].merchantKey!, 'EUR', rows[offset].id),
				decision:
					choice === 'CONFLICT' ? (offset === 0 ? ('CONFIRMED' as const) : ('DISMISSED' as const)) : choice,
				transactionIds: choice === 'CONFLICT' ? ids.slice(offset, offset + 3) : ids,
			})),
		);
		const result = await list(ownerAgent);
		const chosen = byName(result.series, name);
		expect(chosen).toEqual([expect.objectContaining({transactionCount: 6, decision: expected})]);
		expect(BigInt(result.confirmedMonthlyTotal.replace('.', '')) - BigInt(totalBefore.replace('.', ''))).toBe(
			expected === 'CONFIRMED' ? 2400n : 0n,
		);
		await ownerAgent
			.get('/bank-transactions')
			.query({filter: {recurringSeriesKey: chosen[0].key}})
			.expect(200);
		await ownerAgent.patch(`/recurring-series/${chosen[0].key}/decision`).send({decision: null}).expect(204);
		expect(byName((await list(ownerAgent)).series, name)).toEqual([]);
		expect(
			await decisions.countBy({
				accountId: owner.id,
				seriesKey: In([0, 3].map((offset) => seriesKey(rows[offset].merchantKey!, 'EUR', rows[offset].id))),
			}),
		).toBe(0);
		expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(snapshot);
		await fixtures.transactions.delete(ids);
	});

	it.each([
		['CONFIRMED', 'CONFIRMED', 'CONFIRMED'],
		['DISMISSED', 'DISMISSED', 'DISMISSED'],
		['CONFIRMED', 'DISMISSED', null],
	] as const)(
		'regrouped decisions: reconciles %s/%s across names and bank accounts',
		async (first, second, expected) => {
			const aliases: Repository<RecurringPayeeAlias> = app.get(getRepositoryToken(RecurringPayeeAlias));
			const decisions: Repository<RecurringSeriesDecision> = app.get(getRepositoryToken(RecurringSeriesDecision));
			const oldName = `Example Linked Old ${first} ${second}`;
			const newName = `Example Linked New ${first} ${second}`;
			const otherBank = await fixtures.createBankAccount(await fixtures.createConnection(owner));
			const rows = [
				...(await fixtures.createTransactions(ownerBankAccount, monthly('07', '-24.00', oldName).slice(0, 3))),
				...(await fixtures.createTransactions(otherBank, monthly('07', '-48.00', newName).slice(3))),
			];
			const ids = rows.map(({id}) => id);
			const snapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
			const legacyKeys = [0, 3].map((offset) => seriesKey(rows[offset].merchantKey!, 'EUR', rows[offset].id));
			const totalBefore = (await list(ownerAgent)).confirmedMonthlyTotal;
			await decisions.insert(
				[0, 3].map((offset, index) => ({
					accountId: owner.id,
					seriesKey: legacyKeys[index],
					decision: index === 0 ? first : second,
					transactionIds: ids.slice(offset, offset + 3),
				})),
			);
			const payeeGroupId = randomUUID();
			await aliases.insert(
				[0, 3].map((offset) => ({
					accountId: owner.id,
					merchantKey: rows[offset].merchantKey!,
					category: 'SUBSCRIPTIONS',
					payeeGroupId,
				})),
			);
			const result = await list(ownerAgent);
			const merged = byName(result.series, newName);
			expect(merged).toEqual([
				expect.objectContaining({transactionCount: 6, monthlyEquivalent: '48.00', decision: expected}),
			]);
			expect(BigInt(result.confirmedMonthlyTotal.replace('.', '')) - BigInt(totalBefore.replace('.', ''))).toBe(
				expected === 'CONFIRMED' ? 4800n : 0n,
			);
			const drill = await ownerAgent
				.get('/bank-transactions')
				.query({
					filter: {recurringSeriesKey: merged[0].key},
					pagination: {pageIndex: 0, pageSize: 50},
				})
				.expect(200);
			expect(drill.body.transactions.map((row: {id: string}) => row.id).sort()).toEqual([...ids].sort());
			await ownerAgent.patch(`/recurring-series/${merged[0].key}/decision`).send({decision: null}).expect(204);
			expect(byName((await list(ownerAgent)).series, newName)[0].decision).toBeNull();
			expect(await decisions.countBy({accountId: owner.id, seriesKey: In(legacyKeys)})).toBe(0);
			expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(snapshot);
			await fixtures.transactions.delete(ids);
			await aliases.delete({accountId: owner.id, payeeGroupId});
		},
	);

	it.each([
		[
			'cross-account variable bills',
			['-50.00', '-25.00', '-100.00', '-75.00'],
			false,
			false,
			'VARIABLE',
			'62.50',
			6250n,
		],
		[
			'cross-account alternating aliases',
			['-17.00', '-17.00', '-17.00', '-17.00'],
			true,
			false,
			'FIXED',
			'17.00',
			1700n,
		],
		[
			'same-account variable alternating aliases',
			['-50.00', '-25.00', '-100.00', '-75.00'],
			true,
			true,
			'VARIABLE',
			'62.50',
			6250n,
		],
		[
			'same-account fixed alternating aliases',
			['-17.00', '-17.00', '-17.00', '-17.00'],
			true,
			true,
			'FIXED',
			'17.00',
			1700n,
		],
	] as const)(
		'current-stream continuation: retains %s through linking, grace and drill-through',
		async (label, amounts, alternateAliases, sameAccount, amountKind, typicalAmount, cost) => {
			const aliases: Repository<RecurringPayeeAlias> = app.get(getRepositoryToken(RecurringPayeeAlias));
			const decisions: Repository<RecurringSeriesDecision> = app.get(getRepositoryToken(RecurringSeriesDecision));
			const name = `Example Current Stream ${label}`;
			const oldName = `Example Previous Stream ${label}`;
			const connection = await fixtures.createConnection(owner);
			const currentBank = await fixtures.createBankAccount(connection);
			const payeeGroupId = randomUUID();
			const readAt = async (asOf: string) =>
				(await ownerAgent.get('/recurring-series').query({asOf, direction: 'EXPENSE'}).expect(200))
					.body as Awaited<ReturnType<typeof list>>;
			const current = await fixtures.createTransactions(
				currentBank,
				['2026-07', '2026-08', '2026-09', '2026-10'].map((month, index) =>
					bookedRow(`${month}-10`, amounts[index], {
						counterpartyName: alternateAliases && index % 2 === 0 ? `${name} Alternate` : name,
						description: name,
					}),
				),
			);
			const ids = current.map(({id}) => id);
			const legacyKeys: string[] = [];
			try {
				await aliases.insert(
					[...new Set(current.map(({merchantKey}) => merchantKey!))].map((merchantKey) => ({
						accountId: owner.id,
						merchantKey,
						category: 'SUBSCRIPTIONS',
						payeeGroupId,
					})),
				);
				const [baseline] = byName((await readAt('2026-11-10')).series, name);
				expect(baseline).toMatchObject({
					amountKind,
					typicalAmount,
					monthlyEquivalent: typicalAmount,
					transactionCount: 4,
					nextExpectedDate: '2026-11-10',
					status: 'ACTIVE',
				});
				const drill = async (key: string, expectedIds: string[]) => {
					const response = await ownerAgent
						.get('/bank-transactions')
						.query({filter: {recurringSeriesKey: key}, pagination: {pageIndex: 0, pageSize: 50}})
						.expect(200);
					expect(response.body.total).toBe(expectedIds.length);
					expect(response.body.transactions.map((row: {id: string}) => row.id).sort()).toEqual(
						[...expectedIds].sort(),
					);
				};
				await drill(baseline.key, ids);
				const previous = await fixtures.createTransactions(
					sameAccount ? currentBank : ownerBankAccount,
					['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].map((month) =>
						bookedRow(`${month}-03`, '-16.00', {counterpartyName: oldName, description: oldName}),
					),
				);
				ids.push(...previous.map(({id}) => id));
				const snapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
				const dates = ['2026-11-10', '2026-11-11', '2026-11-15', '2026-11-16'];
				const totalsBefore = await Promise.all(
					dates.map(async (date) => (await readAt(date)).confirmedMonthlyTotal),
				);
				legacyKeys.push(seriesKey(previous[0].merchantKey!, 'EUR', previous[0].id), baseline.key);
				await decisions.insert(
					[previous, current].map((rows, index) => ({
						accountId: owner.id,
						seriesKey: legacyKeys[index],
						decision: 'CONFIRMED' as const,
						transactionIds: rows.map(({id}) => id),
					})),
				);
				const savedDecisions = await decisions.find({
					where: {accountId: owner.id, seriesKey: In(legacyKeys)},
					order: {id: 'ASC'},
				});
				await aliases.insert({
					accountId: owner.id,
					merchantKey: previous[0].merchantKey!,
					category: 'SUBSCRIPTIONS',
					payeeGroupId,
				});
				let linkedKey: string | undefined;
				for (const [index, date] of dates.entries()) {
					const result = await readAt(date);
					const linked = byName(result.series, name);
					const ended = date === '2026-11-16';
					expect(linked).toEqual([
						expect.objectContaining({
							amountKind: baseline.amountKind,
							typicalAmount: baseline.typicalAmount,
							monthlyEquivalent: baseline.monthlyEquivalent,
							transactionCount: ids.length,
							firstDate: '2026-01-03',
							lastDate: '2026-10-10',
							nextExpectedDate: baseline.nextExpectedDate,
							status: ended ? 'ENDED' : 'ACTIVE',
							decision: 'CONFIRMED',
						}),
					]);
					linkedKey ??= linked[0].key;
					expect(linked[0].key).toBe(linkedKey);
					expect(linked[0].flags.includes('LATE')).toBe(!ended && date > '2026-11-10');
					if (ended) expect(linked[0].flags).toEqual([]);
					expect(
						BigInt(result.confirmedMonthlyTotal.replace('.', '')) -
							BigInt(totalsBefore[index].replace('.', '')),
					).toBe(ended ? 0n : cost);
					await drill(linked[0].key, ids);
				}
				expect(
					await decisions.find({where: {accountId: owner.id, seriesKey: In(legacyKeys)}, order: {id: 'ASC'}}),
				).toEqual(savedDecisions);
				expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(snapshot);
				await ownerAgent.patch(`/recurring-series/${linkedKey}/decision`).send({decision: null}).expect(204);
				expect(byName((await readAt('2026-11-10')).series, name)[0].decision).toBeNull();
				expect(await decisions.countBy({accountId: owner.id, seriesKey: In(legacyKeys)})).toBe(0);
				legacyKeys.push(linkedKey!);
				await ownerAgent
					.patch(`/recurring-series/${linkedKey}/decision`)
					.send({decision: 'DISMISSED'})
					.expect(204);
				const dismissed = await decisions.findBy({accountId: owner.id, seriesKey: linkedKey});
				expect(dismissed).toEqual([
					expect.objectContaining({
						decision: 'DISMISSED',
						transactionIds: [...previous, ...current].map(({id}) => id),
					}),
				]);
				const next = await fixtures.createTransaction(
					currentBank,
					bookedRow('2026-11-10', amounts[0], {
						counterpartyName: sameAccount ? previous[0].counterpartyName : current[0].counterpartyName,
						description: name,
					}),
				);
				ids.push(next.id);
				const after = await readAt('2026-11-11');
				expect(after.series.filter(({key}) => key === linkedKey)).toEqual([
					expect.objectContaining({
						key: linkedKey,
						decision: 'DISMISSED',
						amountKind,
						typicalAmount: amountKind === 'VARIABLE' ? '50.00' : '17.00',
						monthlyEquivalent: amountKind === 'VARIABLE' ? '50.00' : '17.00',
						transactionCount: ids.length,
						nextExpectedDate: '2026-12-10',
						status: 'ACTIVE',
					}),
				]);
				expect(after.confirmedMonthlyTotal).toBe(totalsBefore[1]);
				await drill(linkedKey!, ids);
				expect(await decisions.findBy({accountId: owner.id, seriesKey: linkedKey})).toEqual(dismissed);
				expect(
					await fixtures.transactions.find({
						where: {id: In(ids.filter((id) => id !== next.id))},
						order: {id: 'ASC'},
					}),
				).toEqual(snapshot);
				const beforeRestart = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
				const late = await fixtures.createTransaction(
					currentBank,
					bookedRow('2026-12-16', amounts[0], {
						counterpartyName: sameAccount ? previous[0].counterpartyName : current[0].counterpartyName,
						description: name,
					}),
				);
				ids.push(late.id);
				expect((await readAt('2026-12-16')).series.filter(({key}) => key === linkedKey)).toEqual([
					expect.objectContaining({
						decision: null,
						amountKind,
						typicalAmount: amountKind === 'VARIABLE' ? '50.00' : '17.00',
						monthlyEquivalent: amountKind === 'VARIABLE' ? '50.00' : '17.00',
						transactionCount: ids.length,
						nextExpectedDate: '2027-01-10',
						status: 'ACTIVE',
					}),
				]);
				await drill(linkedKey!, ids);
				expect(await decisions.findBy({accountId: owner.id, seriesKey: linkedKey})).toEqual(dismissed);
				expect(
					await fixtures.transactions.find({
						where: {id: In(ids.filter((id) => id !== late.id))},
						order: {id: 'ASC'},
					}),
				).toEqual(beforeRestart);
			} finally {
				if (legacyKeys.length) await decisions.delete({accountId: owner.id, seriesKey: In(legacyKeys)});
				await aliases.delete({accountId: owner.id, payeeGroupId});
				await fixtures.transactions.delete(ids);
				await fixtures.connections.delete(connection.id);
			}
		},
	);

	it('current-stream continuation: preserves a qualified raw-name anchor across recognized price parts', async () => {
		const aliases: Repository<RecurringPayeeAlias> = app.get(getRepositoryToken(RecurringPayeeAlias));
		const decisions: Repository<RecurringSeriesDecision> = app.get(getRepositoryToken(RecurringSeriesDecision));
		const name = 'Example Reconciled Current Prices';
		const oldName = 'Example Reconciled Legacy Prices';
		const connection = await fixtures.createConnection(owner);
		const bank = await fixtures.createBankAccount(connection);
		const payeeGroupId = randomUUID();
		const keys: string[] = [];
		const readAt = async (asOf = '2037-04-24') =>
			(await ownerAgent.get('/recurring-series').query({asOf, direction: 'EXPENSE'}).expect(200)).body as Awaited<
				ReturnType<typeof list>
			>;
		const row = (date: string, amount: string, counterpartyName = name) =>
			bookedRow(date, amount, {counterpartyName, description: counterpartyName});
		try {
			const current = await fixtures.createTransactions(bank, [
				...['2036-07', '2036-08', '2036-09', '2036-10', '2036-11'].map((month) => row(`${month}-24`, '-70.00')),
				...['2036-12-19', '2037-01-17', '2037-02-15', '2037-03-13'].map((date) => row(date, '-21.00')),
			]);
			const [baseline] = byName((await readAt()).series, name);
			expect(baseline).toMatchObject({
				amountKind: 'FIXED',
				typicalAmount: '21.00',
				monthlyEquivalent: '21.00',
				transactionCount: current.length,
				nextExpectedDate: '2037-04-24',
				status: 'ACTIVE',
			});
			const previous = await fixtures.createTransactions(
				bank,
				['2036-01', '2036-02', '2036-03', '2036-04', '2036-05', '2036-06'].map((month) =>
					row(`${month}-03`, '-20.00', oldName),
				),
			);
			const noise = await fixtures.createTransactions(
				bank,
				['2036-02-20', '2036-08-24'].map((date) => row(date, '-0.10')),
			);
			const ids = [...previous, ...current].map(({id}) => id);
			const allIds = [...ids, ...noise.map(({id}) => id)];
			const snapshot = await fixtures.transactions.find({where: {id: In(allIds)}, order: {id: 'ASC'}});
			await aliases.insert(
				[previous[0], current[0]].map(({merchantKey}) => ({
					accountId: owner.id,
					merchantKey: merchantKey!,
					category: 'SUBSCRIPTIONS',
					payeeGroupId,
				})),
			);
			const before = await readAt();
			const [linked] = byName(before.series, name);
			keys.push(linked.key);
			expect(byName(before.series, name)).toEqual([
				expect.objectContaining({
					amountKind: baseline.amountKind,
					typicalAmount: baseline.typicalAmount,
					monthlyEquivalent: baseline.monthlyEquivalent,
					nextExpectedDate: baseline.nextExpectedDate,
					status: baseline.status,
					transactionCount: ids.length,
				}),
			]);
			const drill = async (expectedIds: string[]) => {
				const response = await ownerAgent
					.get('/bank-transactions')
					.query({filter: {recurringSeriesKey: linked.key}, pagination: {pageIndex: 0, pageSize: 50}})
					.expect(200);
				expect(response.body.total).toBe(expectedIds.length);
				expect(response.body.transactions.map((entry: {id: string}) => entry.id).sort()).toEqual(
					[...expectedIds].sort(),
				);
			};
			await drill(ids);
			await ownerAgent
				.patch(`/recurring-series/${linked.key}/decision`)
				.send({decision: 'CONFIRMED'})
				.expect(204);
			const confirmed = await readAt();
			expect(byName(confirmed.series, name)[0].decision).toBe('CONFIRMED');
			expect(
				BigInt(confirmed.confirmedMonthlyTotal.replace('.', '')) -
					BigInt(before.confirmedMonthlyTotal.replace('.', '')),
			).toBe(2100n);
			await ownerAgent
				.patch(`/recurring-series/${linked.key}/decision`)
				.send({decision: 'DISMISSED'})
				.expect(204);
			expect(byName((await readAt()).series, name)[0].decision).toBe('DISMISSED');
			const saved = await decisions.findBy({accountId: owner.id, seriesKey: linked.key});
			expect(saved).toEqual([expect.objectContaining({decision: 'DISMISSED', transactionIds: ids})]);
			const next = await fixtures.createTransaction(bank, row(baseline.nextExpectedDate, '-21.00'));
			const after = await readAt('2037-04-25');
			expect(byName(after.series, name)).toEqual([
				expect.objectContaining({
					key: linked.key,
					decision: 'DISMISSED',
					monthlyEquivalent: '21.00',
					nextExpectedDate: '2037-05-24',
					status: 'ACTIVE',
					transactionCount: ids.length + 1,
				}),
			]);
			expect(after.confirmedMonthlyTotal).toBe(before.confirmedMonthlyTotal);
			await drill([...ids, next.id]);
			expect(await decisions.findBy({accountId: owner.id, seriesKey: linked.key})).toEqual(saved);
			expect(await fixtures.transactions.find({where: {id: In(allIds)}, order: {id: 'ASC'}})).toEqual(snapshot);
		} finally {
			if (keys.length) await decisions.delete({accountId: owner.id, seriesKey: In(keys)});
			await aliases.delete({accountId: owner.id, payeeGroupId});
			await fixtures.connections.delete(connection.id);
		}
	});

	it('lists recurring payments with cadence, amounts and flags', async () => {
		const {series, baseCurrency} = await list(ownerAgent);

		expect(baseCurrency).toBe('EUR');
		expect(byName(series, 'Example Gym')).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					cadence: 'MONTHLY',
					amountKind: 'FIXED',
					currency: 'EUR',
					typicalAmount: '29.99',
					monthlyEquivalent: '29.99',
					transactionCount: 6,
					nextExpectedDate: '2026-11-03',
					status: 'ACTIVE',
					flags: [],
					decision: null,
				}),
				// The same shop in another currency is its own series, costed in the base currency.
				expect.objectContaining({currency: 'GBP', typicalAmount: '29.99', monthlyEquivalent: '34.50'}),
			]),
		);
		expect(byName(series, 'Example Streaming')).toEqual([
			expect.objectContaining({typicalAmount: '10.00', monthlyEquivalent: '11.50', flags: ['PRICE_INCREASED']}),
		]);
		expect(byName(series, 'Example Phone')).toEqual([
			expect.objectContaining({status: 'ACTIVE', flags: ['LATE'], nextExpectedDate: '2026-10-14'}),
		]);
		expect(byName(series, 'Example Magazine')).toEqual([expect.objectContaining({status: 'ENDED'})]);
		expect(byName(series, 'Example Insurer')).toEqual([
			expect.objectContaining({cadence: 'YEARLY', monthlyEquivalent: '10.00', decision: null}),
		]);
	});

	it('finds rent across a settled status and a change in how the bank names the payee', async () => {
		const rent = (await list(ownerAgent)).series.filter(({typicalAmount}) => typicalAmount === '650.00');

		expect(rent).toEqual([
			expect.objectContaining({
				cadence: 'MONTHLY',
				transactionCount: 5,
				nextExpectedDate: '2026-10-27',
				status: 'ACTIVE',
			}),
		]);
	});

	it('leaves out irregular, internal, refunded and pending payments, income and other owners', async () => {
		const names = (await list(ownerAgent)).series.map(({name}) => name);

		for (const excluded of [
			'Example Shop',
			'Example Savings',
			'Example Exchange',
			'Example Refunder',
			'Example Pending',
			'Example Employer',
			'Example Club',
		]) {
			expect(names).not.toContain(excluded);
		}
		expect((await list(otherAgent)).series.map(({name}) => name)).toEqual(['Example Club']);
	});

	it('lists recurring income separately', async () => {
		expect((await list(ownerAgent, 'INCOME')).series).toEqual([
			expect.objectContaining({name: 'Example Employer', cadence: 'MONTHLY', typicalAmount: '2500.00'}),
		]);
	});

	it('confirms and dismisses series without touching their transactions', async () => {
		const before = await list(ownerAgent);
		const gym = before.series.find((entry) => entry.name === 'Example Gym' && entry.currency === 'EUR')!;
		const streaming = byName(before.series, 'Example Streaming')[0];
		const gymRows = await fixtures.transactions.find({
			where: {bankAccountId: ownerBankAccount.id, counterpartyName: In(['Example Gym', 'Example Streaming'])},
			order: {id: 'ASC'},
		});
		const snapshot = gymRows.map(({id, category, categorySource, merchantKey, updatedAt}) => ({
			id,
			category,
			categorySource,
			merchantKey,
			updatedAt,
		}));

		await ownerAgent.patch(`/recurring-series/${gym.key}/decision`).send({decision: 'CONFIRMED'}).expect(204);
		await ownerAgent.patch(`/recurring-series/${streaming.key}/decision`).send({decision: 'DISMISSED'}).expect(204);

		const after = await list(ownerAgent);
		expect(after.series[0]).toMatchObject({key: gym.key, decision: 'CONFIRMED'});
		expect(after.series.at(-1)).toMatchObject({key: streaming.key, decision: 'DISMISSED'});
		expect(after).toMatchObject({confirmedMonthlyTotal: '29.99', unconvertedConfirmedCount: 0});

		const rowsAfter = await fixtures.transactions.find({
			where: {id: In(snapshot.map(({id}) => id))},
			order: {id: 'ASC'},
		});
		expect(
			rowsAfter.map(({id, category, categorySource, merchantKey, updatedAt}) => ({
				id,
				category,
				categorySource,
				merchantKey,
				updatedAt,
			})),
		).toEqual(snapshot);
	});

	it('keeps a dismissed series dismissed when new payments arrive, until the owner undoes it', async () => {
		const streaming = byName((await list(ownerAgent)).series, 'Example Streaming')[0];
		await ownerAgent.patch(`/recurring-series/${streaming.key}/decision`).send({decision: 'DISMISSED'}).expect(204);

		await fixtures.createTransaction(
			ownerBankAccount,
			bookedRow('2026-10-16', '-11.50', {
				counterpartyName: 'Example Streaming',
				description: 'Example Streaming',
			}),
		);
		const [stillDismissed] = byName((await list(ownerAgent)).series, 'Example Streaming');
		expect(stillDismissed).toMatchObject({key: streaming.key, decision: 'DISMISSED', transactionCount: 7});

		await ownerAgent.patch(`/recurring-series/${streaming.key}/decision`).send({decision: null}).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Streaming')[0].decision).toBeNull();
	});

	it('keeps a decision when a series is reclassified', async () => {
		const utility = {counterpartyName: 'Example Utility', description: 'Example Utility'};
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-06-20', '-10.00', utility),
			bookedRow('2026-07-20', '-20.00', utility),
			bookedRow('2026-08-20', '-20.00', utility),
		]);
		const [variable] = byName((await list(ownerAgent)).series, 'Example Utility');
		expect(variable).toMatchObject({amountKind: 'VARIABLE', transactionCount: 3});
		await ownerAgent.patch(`/recurring-series/${variable.key}/decision`).send({decision: 'CONFIRMED'}).expect(204);

		// The amount settles, so the series becomes a fixed one starting at another payment.
		await fixtures.createTransaction(ownerBankAccount, bookedRow('2026-09-20', '-20.00', utility));
		const [fixed] = byName((await list(ownerAgent)).series, 'Example Utility');
		expect(fixed).toMatchObject({amountKind: 'FIXED', decision: 'CONFIRMED'});
		expect(fixed.key).not.toBe(variable.key);

		// Undoing under the new key clears the inherited decision too.
		await ownerAgent.patch(`/recurring-series/${fixed.key}/decision`).send({decision: null}).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Utility')[0].decision).toBeNull();
	});

	it('gives a split series’ decision to one part only, so changing one leaves the other alone', async () => {
		const water = {counterpartyName: 'Example Water', description: 'Example Water'};
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-05-21', '-10.00', water),
			bookedRow('2026-06-21', '-20.00', water),
			bookedRow('2026-07-21', '-20.00', water),
		]);
		const [variable] = byName((await list(ownerAgent)).series, 'Example Water');
		expect(variable).toMatchObject({amountKind: 'VARIABLE'});
		await ownerAgent.patch(`/recurring-series/${variable.key}/decision`).send({decision: 'CONFIRMED'}).expect(204);

		// Two plans billed side by side split it into two fixed series.
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-08-21', '2026-09-21', '2026-10-16'].flatMap((date) => [
				bookedRow(date, '-10.00', water),
				bookedRow(date, '-20.00', water),
			]),
		);
		const parts = byName((await list(ownerAgent)).series, 'Example Water');
		expect(parts).toHaveLength(2);
		const confirmed = parts.filter(({decision}) => decision === 'CONFIRMED');
		expect(confirmed).toHaveLength(1);
		const other = parts.find(({key}) => key !== confirmed[0].key)!;

		await ownerAgent.patch(`/recurring-series/${other.key}/decision`).send({decision: 'DISMISSED'}).expect(204);
		await ownerAgent.patch(`/recurring-series/${other.key}/decision`).send({decision: null}).expect(204);
		const after = byName((await list(ownerAgent)).series, 'Example Water');
		expect(after.find(({key}) => key === confirmed[0].key)?.decision).toBe('CONFIRMED');
		expect(after.find(({key}) => key === other.key)?.decision).toBeNull();
	});

	it('resets a merged series fully, whatever its parts were decided as', async () => {
		const internet = {counterpartyName: 'Example Internet', description: 'Example Internet'};
		const initialRows = await fixtures.createTransactions(ownerBankAccount, [
			...['2026-01-22', '2026-02-22', '2026-03-22'].map((date) => bookedRow(date, '-10.00', internet)),
			...['2026-04-22', '2026-05-22', '2026-06-22'].map((date) => bookedRow(date, '-20.00', internet)),
		]);
		const decisions: Repository<RecurringSeriesDecision> = app.get(getRepositoryToken(RecurringSeriesDecision));
		// Existing decisions from when sequential prices were separate histories.
		await decisions.insert(
			[0, 3].map((offset) => ({
				accountId: owner.id,
				seriesKey: seriesKey(initialRows[offset].merchantKey!, 'EUR', initialRows[offset].id),
				decision: offset === 0 ? ('CONFIRMED' as const) : ('DISMISSED' as const),
				transactionIds: initialRows.slice(offset, offset + 3).map(({id}) => id),
			})),
		);

		// Rising amounts merge both into one variable series.
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-07-22', '-30.00', internet),
			bookedRow('2026-08-22', '-40.00', internet),
			bookedRow('2026-09-22', '-50.00', internet),
		]);
		const [merged] = byName((await list(ownerAgent)).series, 'Example Internet');
		expect(merged).toMatchObject({amountKind: 'VARIABLE', transactionCount: 9});
		expect(merged.decision).toBeNull();

		await ownerAgent.patch(`/recurring-series/${merged.key}/decision`).send({decision: null}).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Internet')[0].decision).toBeNull();
	});

	it('does not move a reset decision to the other part of a split', async () => {
		const supplier = {counterpartyName: 'Example Supplier', description: 'Example Supplier'};
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-05-17', '-30.00', supplier),
			bookedRow('2026-06-17', '-10.00', supplier),
			bookedRow('2026-07-17', '-20.00', supplier),
		]);
		const [variable] = byName((await list(ownerAgent)).series, 'Example Supplier');
		expect(variable.amountKind).toBe('VARIABLE');
		await ownerAgent.patch(`/recurring-series/${variable.key}/decision`).send({decision: 'CONFIRMED'}).expect(204);

		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-08-17', '2026-09-17', '2026-10-17'].flatMap((date) => [
				bookedRow(date, '-10.00', supplier),
				bookedRow(date, '-20.00', supplier),
			]),
		);
		const parts = byName((await list(ownerAgent)).series, 'Example Supplier');
		expect(parts).toHaveLength(2);
		expect(parts.every(({key}) => key !== variable.key)).toBe(true);
		const confirmed = parts.filter(({decision}) => decision === 'CONFIRMED');
		expect(confirmed).toHaveLength(1);
		await ownerAgent.patch(`/recurring-series/${confirmed[0].key}/decision`).send({decision: null}).expect(204);
		const reset = byName((await list(ownerAgent)).series, 'Example Supplier');
		expect(reset.map(({decision}) => decision)).toEqual([null, null]);
	});

	it('suggests a dismissed series again when its payments restart after stopping', async () => {
		const club = {counterpartyName: 'Example Club Membership', description: 'Example Club Membership'};
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-04-05', '2026-05-05', '2026-06-05'].map((date) => bookedRow(date, '-19.00', club)),
		);
		const [stopped] = byName((await list(ownerAgent)).series, 'Example Club Membership');
		expect(stopped).toMatchObject({status: 'ENDED'});
		await ownerAgent.patch(`/recurring-series/${stopped.key}/decision`).send({decision: 'DISMISSED'}).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Club Membership')[0].decision).toBe('DISMISSED');

		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-09-05', '2026-10-05'].map((date) => bookedRow(date, '-19.00', club)),
		);
		const [restarted] = byName((await list(ownerAgent)).series, 'Example Club Membership');
		expect(restarted).toMatchObject({key: stopped.key, status: 'ACTIVE', decision: null});
		// The stored dismissal is untouched; dismissing again covers the restart.
		const decisions: Repository<RecurringSeriesDecision> = app.get(getRepositoryToken(RecurringSeriesDecision));
		const stored = await decisions.findBy({accountId: owner.id, seriesKey: stopped.key});
		expect(stored).toEqual([expect.objectContaining({decision: 'DISMISSED', transactionIds: expect.any(Array)})]);
		expect(stored[0].transactionIds).toHaveLength(3);
		await ownerAgent.patch(`/recurring-series/${stopped.key}/decision`).send({decision: 'DISMISSED'}).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Club Membership')[0].decision).toBe('DISMISSED');
	});

	it('keeps a dismissal when backfilled history contains an older restart', async () => {
		const supplier = {counterpartyName: 'Example Historical Supplier', description: 'Example Historical Supplier'};
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-08-05', '2026-09-05', '2026-10-05'].map((date) => bookedRow(date, '-20.00', supplier)),
		);
		const [fixed] = byName((await list(ownerAgent)).series, 'Example Historical Supplier');
		await ownerAgent.patch(`/recurring-series/${fixed.key}/decision`).send({decision: 'DISMISSED'}).expect(204);

		// Older history changes the amount classification, but its late arrival predates the dismissed payments.
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-05-05', '2026-06-05', '2026-07-11'].map((date) => bookedRow(date, '-10.00', supplier)),
		);
		expect(byName((await list(ownerAgent)).series, 'Example Historical Supplier')).toEqual([
			expect.objectContaining({amountKind: 'FIXED', transactionCount: 6, decision: 'DISMISSED'}),
		]);
	});

	it('keeps a confirmed series confirmed when its payments restart after stopping', async () => {
		const pool = {counterpartyName: 'Example Pool', description: 'Example Pool'};
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-03-06', '2026-04-06', '2026-05-06'].map((date) => bookedRow(date, '-21.00', pool)),
		);
		const [stopped] = byName((await list(ownerAgent)).series, 'Example Pool');
		await ownerAgent.patch(`/recurring-series/${stopped.key}/decision`).send({decision: 'CONFIRMED'}).expect(204);
		const totalBeforeRestart = Number((await list(ownerAgent)).confirmedMonthlyTotal);
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-09-06', '2026-10-06'].map((date) => bookedRow(date, '-21.00', pool)),
		);

		const {series, confirmedMonthlyTotal} = await list(ownerAgent);
		expect(byName(series, 'Example Pool')).toEqual([
			expect.objectContaining({key: stopped.key, status: 'ACTIVE', decision: 'CONFIRMED'}),
		]);
		// The stopped series added nothing before; the restart adds its monthly cost.
		expect(Number(confirmedMonthlyTotal) - totalBeforeRestart).toBeCloseTo(21, 2);
	});

	it.each([
		['CONFIRMED', 'CONFIRMED', 'CONFIRMED'],
		['DISMISSED', 'DISMISSED', 'DISMISSED'],
		['CONFIRMED', 'DISMISSED', null],
	] as const)(
		'reconciles saved %s/%s decisions when sequential prices become one history',
		async (first, second, expected) => {
			const name = `Example Sequential ${first} ${second}`;
			const totalBefore = (await list(ownerAgent)).confirmedMonthlyTotal;
			const rows = await fixtures.createTransactions(
				ownerBankAccount,
				MONTHS.map((month, index) =>
					bookedRow(`${month}-09`, index < 3 ? '-24.00' : '-48.00', {
						counterpartyName: name,
						description: name,
						category: 'SUBSCRIPTIONS',
					}),
				),
			);
			const snapshot = await fixtures.transactions.find({
				where: {id: In(rows.map(({id}) => id))},
				order: {id: 'ASC'},
			});
			const decisions: Repository<RecurringSeriesDecision> = app.get(getRepositoryToken(RecurringSeriesDecision));
			// Snapshots written by the earlier detector when the two prices were separate series.
			await decisions.insert(
				[0, 3].map((offset, index) => ({
					accountId: owner.id,
					seriesKey: seriesKey(rows[offset].merchantKey!, 'EUR', rows[offset].id),
					decision: index === 0 ? first : second,
					transactionIds: rows.slice(offset, offset + 3).map(({id}) => id),
				})),
			);
			const result = await list(ownerAgent);
			expect(byName(result.series, name)).toEqual([
				expect.objectContaining({
					amountKind: 'FIXED',
					transactionCount: 6,
					monthlyEquivalent: '48.00',
					decision: expected,
				}),
			]);
			expect(Number(result.confirmedMonthlyTotal) - Number(totalBefore)).toBeCloseTo(
				expected === 'CONFIRMED' ? 48 : 0,
				2,
			);
			const [merged] = byName(result.series, name);
			await ownerAgent.patch(`/recurring-series/${merged.key}/decision`).send({decision: null}).expect(204);
			expect(byName((await list(ownerAgent)).series, name)[0].decision).toBeNull();
			expect(
				await decisions.countBy({
					accountId: owner.id,
					seriesKey: In([0, 3].map((offset) => seriesKey(rows[offset].merchantKey!, 'EUR', rows[offset].id))),
				}),
			).toBe(0);
			expect(
				await fixtures.transactions.find({where: {id: In(rows.map(({id}) => id))}, order: {id: 'ASC'}}),
			).toEqual(snapshot);
		},
	);

	it('keeps confirmation through a price change without absorbing a concurrent plan', async () => {
		const name = 'Example Parallel Memberships';
		const samePayee = {counterpartyName: name, description: name, category: 'SUBSCRIPTIONS' as const};
		await fixtures.createTransactions(ownerBankAccount, [
			...MONTHS.slice(0, 3).map((month) => bookedRow(`${month}-07`, '-24.00', samePayee)),
			...MONTHS.map((month) => bookedRow(`${month}-19`, '-96.00', samePayee)),
		]);
		const old = byName((await list(ownerAgent)).series, name).find(
			({monthlyEquivalent}) => monthlyEquivalent === '24.00',
		)!;
		await ownerAgent.patch(`/recurring-series/${old.key}/decision`).send({decision: 'CONFIRMED'}).expect(204);
		await fixtures.createTransactions(
			ownerBankAccount,
			MONTHS.slice(3).map((month) => bookedRow(`${month}-07`, '-48.00', samePayee)),
		);
		expect(byName((await list(ownerAgent)).series, name)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: old.key,
					amountKind: 'FIXED',
					monthlyEquivalent: '48.00',
					transactionCount: 6,
					decision: 'CONFIRMED',
				}),
				expect.objectContaining({monthlyEquivalent: '96.00', transactionCount: 6, decision: null}),
			]),
		);
		expect(byName((await list(ownerAgent)).series, name)).toHaveLength(2);
	});

	it('needs stronger evidence for an annual suggestion than two ordinary purchases', async () => {
		const variants = [
			['Example Annual Grocery', 'FOOD_AND_DRINK', 2],
			['Example Annual Unknown', null, 2],
			['Example Annual Membership', 'SUBSCRIPTIONS', 2],
			['Example Annual Cover', 'INSURANCE', 3],
		] as const;
		for (const [name, category, count] of variants) {
			await fixtures.createTransactions(
				ownerBankAccount,
				Array.from({length: count}, (_, index) =>
					bookedRow(`${2024 + index}-02-18`, '-84.00', {counterpartyName: name, description: name, category}),
				),
			);
		}
		const {series} = await list(ownerAgent);
		for (const [name, , count] of variants) {
			const entries = byName(series, name);
			if (name.endsWith('Grocery') || name.endsWith('Unknown')) expect(entries).toEqual([]);
			else expect(entries).toEqual([expect.objectContaining({cadence: 'YEARLY', transactionCount: count})]);
		}
	});

	it('rejects keys that are invalid, unknown or another owner’s', async () => {
		const [club] = (await list(otherAgent)).series;

		await ownerAgent.patch(`/recurring-series/${club.key}/decision`).send({decision: 'CONFIRMED'}).expect(404);
		await ownerAgent.patch(`/recurring-series/${club.key}/decision`).send({decision: null}).expect(404);
		await ownerAgent
			.patch(`/recurring-series/${'0'.repeat(32)}/decision`)
			.send({decision: 'CONFIRMED'})
			.expect(404);
		await ownerAgent.patch('/recurring-series/not-a-key/decision').send({decision: 'CONFIRMED'}).expect(400);
		await otherAgent.patch(`/recurring-series/${club.key}/decision`).send({decision: 'MAYBE'}).expect(400);
		await ownerAgent.get('/recurring-series').query({asOf: AS_OF, direction: 'UNKNOWN'}).expect(400);
		await ownerAgent.get('/recurring-series').expect(400);
		await ownerAgent
			.get('/bank-transactions')
			.query({filter: {recurringSeriesKey: club.key}})
			.expect(404);
	});

	it('drills through to exactly the series payments', async () => {
		const gym = (await list(ownerAgent)).series.find(
			(entry) => entry.name === 'Example Gym' && entry.currency === 'EUR',
		)!;

		const response = await ownerAgent
			.get('/bank-transactions')
			.query({filter: {recurringSeriesKey: gym.key}, pagination: {pageIndex: 0, pageSize: 50}})
			.expect(200);

		expect(response.body.total).toBe(gym.transactionCount);
		expect(
			response.body.transactions.every(
				(row: {counterpartyName: string; currency: string}) =>
					row.counterpartyName === 'Example Gym' && row.currency === 'EUR',
			),
		).toBe(true);
	});
});
