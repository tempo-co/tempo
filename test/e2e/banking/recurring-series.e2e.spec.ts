import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import TestAgent from 'supertest/lib/agent';
import {ArrayContains, DataSource, In, Repository, SelectQueryBuilder} from 'typeorm';

import {ConfigurationService} from '@core/config/config.service';
import {Account} from '@modules/account/account.entity';
import {AccountService} from '@modules/account/account.service';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {RecurringContinuationUnlink} from '@modules/banking/recurring/recurring-continuation-unlink.entity';
import * as detection from '@modules/banking/recurring/recurring-series-detection';
import {seriesKey} from '@modules/banking/recurring/recurring-series-detection';
import {RecurringSeriesHide} from '@modules/banking/recurring/recurring-series-hide.entity';
import {
	RECURRING_DETECTION_RULES_VERSION,
	RecurringSeriesService,
} from '@modules/banking/recurring/recurring-series.service';
import {RecurringSnapshot} from '@modules/banking/recurring/recurring-snapshot.entity';
import {parseCents} from '@modules/banking/summary/bank-transaction-summary';

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
import {createVerifiedAccount} from '../../utils/auth-utils';

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
	priceChange: {amount: string; since: string} | null;
	hidden: boolean;
};

/** A structured SEPA debit text naming `name` as the payee, the evidence that links a renamed payee. */
function sepaNaming(name: string) {
	return `SEPA Incasso Naam: ${name} IBAN: NL91ABNA0417164300`;
}

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

	type ListBody = {
		series: SeriesBody[];
		monthlyTotal: string;
		unconvertedCount: number;
		baseCurrency: string | null;
	};
	/** Bills and income come from one read. */
	const lists = async (agent: TestAgent, asOf: string = AS_OF) =>
		(await agent.get('/recurring-series').query({asOf}).expect(200)).body as {expenses: ListBody; income: ListBody};
	const list = async (agent: TestAgent, direction: 'EXPENSE' | 'INCOME' = 'EXPENSE') => {
		const {expenses, income} = await lists(agent);
		return direction === 'EXPENSE' ? expenses : income;
	};
	const byName = <T extends SeriesBody>(series: T[], name: string) => series.filter((entry) => entry.name === name);
	const hide = (agent: TestAgent, key: string, hidden = true) =>
		agent.patch(`/recurring-series/${key}/hidden`).send({hidden});

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
			// description to the counterparty, with accents but the full name retained.
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
				counterpartyName: 'Alex-Sam Exämple',
				description: 'rent',
				category: 'HOUSING_AND_UTILITIES',
			}),
		]);
		await fixtures.createTransactions(ownerGbpAccount, [
			...monthly('03', '-29.99', 'Example Gym', {currency: 'GBP', amountInBaseCurrency: '-34.50'}),
		]);
		await fixtures.createTransactions(otherBankAccount, monthly('04', '-60.00', 'Example Club'));
	});

	it('recognizes one payee across the bank’s name formats for a new owner with no setup', async () => {
		const httpServer = app.getHttpServer();
		const fresh = await createVerifiedAccount(httpServer, app.get(ConfigurationService).get('EMAIL_UI_URL'));
		const freshOwner = (await app.get(AccountService).findByEmail(fresh.credentials.email))!;
		const connection = await fixtures.createConnection(freshOwner);
		const bank = await fixtures.createBankAccount(connection);
		const newBank = await fixtures.createBankAccount(connection);
		try {
			// The bank first names the payee only in a transfer description, later as the counterparty.
			const rows = await fixtures.createTransactions(
				bank,
				MONTHS.map((month, index) =>
					bookedRow(`${month}-05`, '-80.00', {
						category: 'EDUCATION',
						transactionType: 'TRANSFER',
						...(index < 3
							? {counterpartyName: null, description: 'To Example Academy'}
							: {counterpartyName: 'Example Academy', description: null}),
					}),
				),
			);
			// One plan moves to another bank account under the same name; a second plan stays on the first account.
			const moved = await Promise.all(
				MONTHS.map((month, index) =>
					fixtures.createTransaction(
						index < 3 ? bank : newBank,
						bookedRow(`${month}-08`, '-12.00', {counterpartyName: 'Example Stream', description: null}),
					),
				),
			);
			const parallel = await fixtures.createTransactions(
				bank,
				monthly('20', '-30.00', 'Example Stream', {description: null}),
			);
			const ids = rows.map(({id}) => id);
			const snapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
			const read = async () =>
				(await fresh.agent.get('/recurring-series').query({asOf: AS_OF}).expect(200)).body.expenses as Awaited<
					ReturnType<typeof list>
				>;

			const {series} = await read();
			expect(byName(series, 'Example Academy')).toEqual([
				expect.objectContaining({
					transactionCount: 6,
					monthlyEquivalent: '80.00',
					nextExpectedDate: '2026-11-05',
					status: 'ACTIVE',
					hidden: false,
				}),
			]);
			expect(byName(series, 'Example Stream')).toEqual([
				expect.objectContaining({
					transactionCount: 6,
					monthlyEquivalent: '30.00',
					nextExpectedDate: '2026-11-20',
				}),
				expect.objectContaining({
					transactionCount: 6,
					monthlyEquivalent: '12.00',
					nextExpectedDate: '2026-11-08',
				}),
			]);
			const streamDrills = await Promise.all(
				byName(series, 'Example Stream').map(async ({key}) =>
					(
						await fresh.agent
							.get('/bank-transactions')
							.query({filter: {recurringSeriesKey: key}, pagination: {pageIndex: 0, pageSize: 50}})
							.expect(200)
					).body.transactions
						.map(({id}: {id: string}) => id)
						.sort(),
				),
			);
			expect(streamDrills).toEqual([parallel, moved].map((part) => part.map(({id}) => id).sort()));
			const [academy] = byName(series, 'Example Academy');
			const drill = await fresh.agent
				.get('/bank-transactions')
				.query({filter: {recurringSeriesKey: academy.key}, pagination: {pageIndex: 0, pageSize: 50}})
				.expect(200);
			expect(drill.body.transactions.map(({id}: {id: string}) => id).sort()).toEqual([...ids].sort());
			const totals = await fresh.agent
				.get('/bank-transactions/totals')
				.query({filter: {recurringSeriesKey: academy.key}})
				.expect(200);
			expect(totals.body).toMatchObject({count: rows.length, spending: '480.00', income: '0.00', net: '-480.00'});
			const laterTotals = await fresh.agent
				.get('/bank-transactions/totals')
				.query({filter: {recurringSeriesKey: academy.key, bookingDate: {from: '2026-08-01'}}})
				.expect(200);
			expect(laterTotals.body).toMatchObject({count: 3, spending: '240.00', income: '0.00', net: '-240.00'});
			await ownerAgent
				.get('/bank-transactions/totals')
				.query({filter: {recurringSeriesKey: academy.key}})
				.expect(404);
			// Every detected series counts without the owner doing anything.
			expect((await read()).monthlyTotal).toBe('122.00');
			expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(snapshot);
			expect(byName((await list(ownerAgent)).series, 'Example Academy')).toEqual([]);
		} finally {
			await fixtures.connections.delete(connection.id);
		}
	});

	it('links a renamed payee from bank evidence for each owner separately, keeping source rows unchanged', async () => {
		const oldName = 'Example Renamed Legacy';
		const currentName = 'Example Renamed Current';
		const seed = async (bankAccount: BankAccount) =>
			fixtures.createTransactions(
				bankAccount,
				MONTHS.map((month, index) =>
					bookedRow(`${month}-03`, index < 3 ? '-40.00' : '-68.00', {
						counterpartyName: index < 3 ? oldName : currentName,
						// The bank's structured record already names the current entity on the older payments.
						description: sepaNaming(currentName),
						category: 'INSURANCE',
					}),
				),
			);
		const rows = await seed(ownerBankAccount);
		const otherRows = await seed(await fixtures.createBankAccount(await fixtures.createConnection(otherOwner)));
		const ids = rows.map(({id}) => id);
		const snapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
		const selected = (series: SeriesBody[]) => series.filter(({name}) => [oldName, currentName].includes(name));
		const beforeTotal = (await list(ownerAgent)).monthlyTotal;
		const result = selected((await list(ownerAgent)).series);
		expect(result).toEqual([
			expect.objectContaining({name: currentName, transactionCount: 6, monthlyEquivalent: '68.00'}),
		]);
		const otherResult = selected((await list(otherAgent)).series);
		expect(otherResult).toEqual([expect.objectContaining({name: currentName, transactionCount: 6})]);
		expect(otherResult[0].key).not.toBe(result[0].key);
		const drill = await ownerAgent
			.get('/bank-transactions')
			.query({filter: {recurringSeriesKey: result[0].key}, pagination: {pageIndex: 0, pageSize: 50}})
			.expect(200);
		expect(drill.body.total).toBe(ids.length);
		expect(drill.body.transactions.map((row: {id: string}) => row.id).sort()).toEqual([...ids].sort());
		await hide(ownerAgent, result[0].key).expect(204);
		const afterTotal = (await list(ownerAgent)).monthlyTotal;
		expect(parseCents(afterTotal) - parseCents(beforeTotal)).toBe(-6800n);
		expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(snapshot);
		await hide(ownerAgent, result[0].key, false).expect(204);
		expect((await list(ownerAgent)).monthlyTotal).toBe(beforeTotal);
		await fixtures.transactions.delete([...ids, ...otherRows.map(({id}) => id)]);
	});

	it.each([
		[
			'interleaved names',
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
		'current naming period: preserves cost, hiding and exact membership for %s',
		async (label, nameCount, oldCount, sameAccount, amounts, cost, due) => {
			const hides: Repository<RecurringSeriesHide> = app.get(getRepositoryToken(RecurringSeriesHide));
			const connection = await fixtures.createConnection(owner);
			const bank = await fixtures.createBankAccount(connection);
			const oldBank = sameAccount ? bank : await fixtures.createBankAccount(connection);
			const name = `Example Complete Period ${label}`;
			let asOf: string = due;
			const read = async () =>
				(await ownerAgent.get('/recurring-series').query({asOf}).expect(200)).body.expenses as Awaited<
					ReturnType<typeof list>
				>;
			const keys: string[] = [];
			try {
				const current = await fixtures.createTransactions(
					bank,
					amounts.map((amount, index) =>
						bookedRow(`2026-${String(index + 7).padStart(2, '0')}-10`, `-${amount}`, {
							counterpartyName: `${name} Variant ${index % nameCount}`,
							description: sepaNaming(name),
						}),
					),
				);
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
				// Older payments from the same payee arrive later, under a historical name.
				const previous = await fixtures.createTransactions(
					oldBank,
					Array.from({length: oldCount}, (_, index) =>
						bookedRow(new Date(Date.UTC(2024, index + 6, 3)).toISOString().slice(0, 10), '-16.00', {
							counterpartyName: `${name} Historical`,
							description: sepaNaming(name),
						}),
					),
				);
				const ids = [...previous, ...current].map(({id}) => id);
				const snapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
				const saved = await hides.find({
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
							hidden: false,
						}),
					]);
					keys.push(linked[0].key);
					// The older history joins the series without adding to the total.
					expect(result.monthlyTotal).toBe(before.monthlyTotal);
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
						await hides.find({where: {accountId: owner.id, seriesKey: In(keys)}, order: {id: 'ASC'}}),
					).toEqual(saved);
				}
				const linkedKey = keys.at(-1)!;
				const returnedName =
					previous.length && sameAccount ? previous[0].counterpartyName : current[0].counterpartyName;
				const returned = await fixtures.createTransaction(
					bank,
					bookedRow(due, '-50.00', {counterpartyName: returnedName, description: sepaNaming(name)}),
				);
				ids.push(returned.id);
				const usual = nameCount === 3 ? '55.00' : '50.00';
				const continued = await read();
				const continuedDue = new Date(Date.UTC(Number(due.slice(0, 4)), Number(due.slice(5, 7)), 10))
					.toISOString()
					.slice(0, 10);
				expect(continued.series.filter(({key}) => key === linkedKey)).toEqual([
					expect.objectContaining({
						amountKind: 'VARIABLE',
						// The median of the latest six payments; the month the 50.00 was paid in costs 50.00.
						typicalAmount: usual,
						monthlyEquivalent: '50.00',
						transactionCount: ids.length,
						nextExpectedDate: continuedDue,
						status: 'ACTIVE',
						hidden: false,
					}),
				]);
				expect(parseCents(continued.monthlyTotal) - parseCents(before.monthlyTotal)).toBe(
					5000n - parseCents(cost),
				);
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
					await hides.find({where: {accountId: owner.id, seriesKey: In(keys)}, order: {id: 'ASC'}}),
				).toEqual(saved);
				expect(
					await fixtures.transactions.find({
						where: {id: In(ids.filter((id) => id !== returned.id))},
						order: {id: 'ASC'},
					}),
				).toEqual(snapshot);
				const continuedSnapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
				// Totals are compared on one date: other series may end between dates.
				asOf = continuedDue;
				const shownTotal = (await read()).monthlyTotal;
				asOf = due;
				await hide(ownerAgent, linkedKey).expect(204);
				expect((await read()).series.find(({key}) => key === linkedKey)?.hidden).toBe(true);
				const dismissed = await hides.findBy({accountId: owner.id, seriesKey: linkedKey});
				expect(dismissed).toEqual([expect.objectContaining({transactionIds: ids})]);
				asOf = continuedDue;
				const next = await fixtures.createTransaction(
					bank,
					bookedRow(continuedDue, '-50.00', {
						counterpartyName: returnedName,
						description: sepaNaming(name),
					}),
				);
				const after = await read();
				expect(after.series.filter(({key}) => key === linkedKey)).toEqual([
					expect.objectContaining({
						transactionCount: ids.length + 1,
						status: 'ACTIVE',
						hidden: true,
					}),
				]);
				// Next month it would have cost its usual amount.
				expect(parseCents(after.monthlyTotal) - parseCents(shownTotal)).toBe(-parseCents(usual));
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
				expect(await hides.findBy({accountId: owner.id, seriesKey: linkedKey})).toEqual(dismissed);
				expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(
					continuedSnapshot,
				);
				const expected = after.series.find(({key}) => key === linkedKey)!.nextExpectedDate;
				asOf = new Date(Date.parse(`${expected}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
				const late = await fixtures.createTransaction(
					bank,
					bookedRow(asOf, '-50.00', {
						counterpartyName: returnedName,
						description: sepaNaming(name),
					}),
				);
				expect((await read()).series.filter(({key}) => key === linkedKey)).toEqual([
					expect.objectContaining({hidden: false, status: 'ACTIVE', transactionCount: ids.length + 2}),
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
				expect(await hides.findBy({accountId: owner.id, seriesKey: linkedKey})).toEqual(dismissed);
				expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(
					continuedSnapshot,
				);
			} finally {
				if (keys.length) await hides.delete({accountId: owner.id, seriesKey: In(keys)});
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
		await hide(ownerAgent, hiddenKey).expect(404);
		await ownerAgent
			.get('/bank-transactions')
			.query({filter: {recurringSeriesKey: hiddenKey}})
			.expect(404);
		await fixtures.transactions.delete([...retail, ...bills].map(({id}) => id));
	});

	it('retail suggestions: keeps a retail series hidden earlier listed as hidden until shown again', async () => {
		const name = 'Example Hidden Retail';
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
		const totalBefore = (await list(ownerAgent)).monthlyTotal;
		const hides: Repository<RecurringSeriesHide> = app.get(getRepositoryToken(RecurringSeriesHide));
		await hides.insert({
			accountId: owner.id,
			seriesKey: seriesKey(rows[0].merchantKey!, 'EUR', rows[0].id),
			transactionIds: ids,
		});
		const result = await list(ownerAgent);
		const chosen = byName(result.series, name);
		expect(chosen).toEqual([expect.objectContaining({transactionCount: 6, hidden: true})]);
		expect(parseCents(result.monthlyTotal) - parseCents(totalBefore)).toBe(0n);
		await ownerAgent
			.get('/bank-transactions')
			.query({filter: {recurringSeriesKey: chosen[0].key}})
			.expect(200);
		await hide(ownerAgent, chosen[0].key, false).expect(204);
		expect(byName((await list(ownerAgent)).series, name)).toEqual([]);
		expect(
			await hides.countBy({
				accountId: owner.id,
				seriesKey: In([0, 3].map((offset) => seriesKey(rows[offset].merchantKey!, 'EUR', rows[offset].id))),
			}),
		).toBe(0);
		expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(snapshot);
		await fixtures.transactions.delete(ids);
	});

	it.each([[true], [false]] as const)(
		'regrouped hides: hides parts hidden %s as one series across names and bank accounts',
		async (bothHidden) => {
			const hidden = true;
			const label = bothHidden ? 'Both' : 'First';
			const hides: Repository<RecurringSeriesHide> = app.get(getRepositoryToken(RecurringSeriesHide));
			const oldName = `Example Linked Old ${label}`;
			const newName = `Example Linked New ${label}`;
			const otherBank = await fixtures.createBankAccount(await fixtures.createConnection(owner));
			const rows = [
				...(await fixtures.createTransactions(
					ownerBankAccount,
					monthly('07', '-24.00', oldName, {description: sepaNaming(newName)}).slice(0, 3),
				)),
				...(await fixtures.createTransactions(otherBank, monthly('07', '-48.00', newName).slice(3))),
			];
			const ids = rows.map(({id}) => id);
			const snapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
			const legacyKeys = [0, 3].map((offset) => seriesKey(rows[offset].merchantKey!, 'EUR', rows[offset].id));
			const totalBefore = (await list(ownerAgent)).monthlyTotal;
			await hides.insert(
				(bothHidden ? [0, 3] : [0]).map((offset, index) => ({
					accountId: owner.id,
					seriesKey: legacyKeys[index],
					transactionIds: ids.slice(offset, offset + 3),
				})),
			);
			const result = await list(ownerAgent);
			const merged = byName(result.series, newName);
			expect(merged).toEqual([
				expect.objectContaining({transactionCount: 6, monthlyEquivalent: '48.00', hidden}),
			]);
			// The series already counted before; only hiding takes it out.
			expect(parseCents(result.monthlyTotal) - parseCents(totalBefore)).toBe(hidden ? -4800n : 0n);
			const drill = await ownerAgent
				.get('/bank-transactions')
				.query({
					filter: {recurringSeriesKey: merged[0].key},
					pagination: {pageIndex: 0, pageSize: 50},
				})
				.expect(200);
			expect(drill.body.transactions.map((row: {id: string}) => row.id).sort()).toEqual([...ids].sort());
			await hide(ownerAgent, merged[0].key, false).expect(204);
			expect(byName((await list(ownerAgent)).series, newName)[0].hidden).toBe(false);
			expect(await hides.countBy({accountId: owner.id, seriesKey: In(legacyKeys)})).toBe(0);
			expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(snapshot);
			await fixtures.transactions.delete(ids);
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
			'cross-account alternating names',
			['-17.00', '-17.00', '-17.00', '-17.00'],
			true,
			false,
			'FIXED',
			'17.00',
			1700n,
		],
		[
			'same-account variable alternating names',
			['-50.00', '-25.00', '-100.00', '-75.00'],
			true,
			true,
			'VARIABLE',
			'62.50',
			6250n,
		],
		[
			'same-account fixed alternating names',
			['-17.00', '-17.00', '-17.00', '-17.00'],
			true,
			true,
			'FIXED',
			'17.00',
			1700n,
		],
	] as const)(
		'current-stream continuation: retains %s through linking, grace and drill-through',
		async (label, amounts, alternateNames, sameAccount, amountKind, typicalAmount, cost) => {
			const hides: Repository<RecurringSeriesHide> = app.get(getRepositoryToken(RecurringSeriesHide));
			const name = `Example Current Stream ${label}`;
			const oldName = `Example Previous Stream ${label}`;
			const connection = await fixtures.createConnection(owner);
			const currentBank = await fixtures.createBankAccount(connection);
			const readAt = async (asOf: string) =>
				(await ownerAgent.get('/recurring-series').query({asOf}).expect(200)).body.expenses as Awaited<
					ReturnType<typeof list>
				>;
			const dates = ['2026-11-10', '2026-11-11', '2026-11-15', '2026-11-16'];
			const totalsWithout = await Promise.all(dates.map(async (date) => (await readAt(date)).monthlyTotal));
			const current = await fixtures.createTransactions(
				currentBank,
				['2026-07', '2026-08', '2026-09', '2026-10'].map((month, index) =>
					bookedRow(`${month}-10`, amounts[index], {
						counterpartyName: alternateNames && index % 2 === 0 ? `${name} Alternate` : name,
						description: sepaNaming(name),
					}),
				),
			);
			const ids = current.map(({id}) => id);
			const legacyKeys: string[] = [];
			try {
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
						bookedRow(`${month}-03`, '-16.00', {counterpartyName: oldName, description: sepaNaming(name)}),
					),
				);
				ids.push(...previous.map(({id}) => id));
				const snapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
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
							hidden: false,
						}),
					]);
					linkedKey ??= linked[0].key;
					expect(linked[0].key).toBe(linkedKey);
					expect(linked[0].flags.includes('LATE')).toBe(!ended && date > '2026-11-10');
					if (ended) expect(linked[0].flags).toEqual([]);
					expect(parseCents(result.monthlyTotal) - parseCents(totalsWithout[index])).toBe(ended ? 0n : cost);
					await drill(linked[0].key, ids);
				}
				expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(snapshot);
				legacyKeys.push(linkedKey!);
				await hide(ownerAgent, linkedKey!).expect(204);
				const dismissed = await hides.findBy({accountId: owner.id, seriesKey: linkedKey});
				expect(dismissed).toEqual([
					expect.objectContaining({
						transactionIds: [...previous, ...current].map(({id}) => id),
					}),
				]);
				const next = await fixtures.createTransaction(
					currentBank,
					bookedRow('2026-11-10', amounts[0], {
						counterpartyName: sameAccount ? previous[0].counterpartyName : current[0].counterpartyName,
						description: sepaNaming(name),
					}),
				);
				ids.push(next.id);
				const after = await readAt('2026-11-11');
				expect(after.series.filter(({key}) => key === linkedKey)).toEqual([
					expect.objectContaining({
						key: linkedKey,
						hidden: true,
						amountKind,
						typicalAmount: amountKind === 'VARIABLE' ? '50.00' : '17.00',
						monthlyEquivalent: amountKind === 'VARIABLE' ? '50.00' : '17.00',
						transactionCount: ids.length,
						nextExpectedDate: '2026-12-10',
						status: 'ACTIVE',
					}),
				]);
				expect(after.monthlyTotal).toBe(totalsWithout[1]);
				await drill(linkedKey!, ids);
				expect(await hides.findBy({accountId: owner.id, seriesKey: linkedKey})).toEqual(dismissed);
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
						description: sepaNaming(name),
					}),
				);
				ids.push(late.id);
				expect((await readAt('2026-12-16')).series.filter(({key}) => key === linkedKey)).toEqual([
					expect.objectContaining({
						hidden: false,
						amountKind,
						typicalAmount: amountKind === 'VARIABLE' ? '50.00' : '17.00',
						monthlyEquivalent: amountKind === 'VARIABLE' ? '50.00' : '17.00',
						transactionCount: ids.length,
						nextExpectedDate: '2027-01-10',
						status: 'ACTIVE',
					}),
				]);
				await drill(linkedKey!, ids);
				expect(await hides.findBy({accountId: owner.id, seriesKey: linkedKey})).toEqual(dismissed);
				expect(
					await fixtures.transactions.find({
						where: {id: In(ids.filter((id) => id !== late.id))},
						order: {id: 'ASC'},
					}),
				).toEqual(beforeRestart);
			} finally {
				if (legacyKeys.length) await hides.delete({accountId: owner.id, seriesKey: In(legacyKeys)});
				await fixtures.transactions.delete(ids);
				await fixtures.connections.delete(connection.id);
			}
		},
	);

	it('current-stream continuation: preserves a qualified raw-name anchor across recognized price parts', async () => {
		const hides: Repository<RecurringSeriesHide> = app.get(getRepositoryToken(RecurringSeriesHide));
		const name = 'Example Reconciled Current Prices';
		const oldName = 'Example Reconciled Legacy Prices';
		const connection = await fixtures.createConnection(owner);
		const bank = await fixtures.createBankAccount(connection);
		const keys: string[] = [];
		const readAt = async (asOf = '2037-04-24') =>
			(await ownerAgent.get('/recurring-series').query({asOf}).expect(200)).body.expenses as Awaited<
				ReturnType<typeof list>
			>;
		const row = (date: string, amount: string, counterpartyName = name) =>
			bookedRow(date, amount, {counterpartyName, description: sepaNaming(name)});
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
			await hide(ownerAgent, linked.key).expect(204);
			const hidden = await readAt();
			expect(byName(hidden.series, name)[0].hidden).toBe(true);
			expect(parseCents(hidden.monthlyTotal) - parseCents(before.monthlyTotal)).toBe(-2100n);
			const saved = await hides.findBy({accountId: owner.id, seriesKey: linked.key});
			expect(saved).toEqual([expect.objectContaining({transactionIds: ids})]);
			const next = await fixtures.createTransaction(bank, row(baseline.nextExpectedDate, '-21.00'));
			const after = await readAt('2037-04-25');
			expect(byName(after.series, name)).toEqual([
				expect.objectContaining({
					key: linked.key,
					hidden: true,
					monthlyEquivalent: '21.00',
					nextExpectedDate: '2037-05-24',
					status: 'ACTIVE',
					transactionCount: ids.length + 1,
				}),
			]);
			expect(after.monthlyTotal).toBe(hidden.monthlyTotal);
			await drill([...ids, next.id]);
			expect(await hides.findBy({accountId: owner.id, seriesKey: linked.key})).toEqual(saved);
			expect(await fixtures.transactions.find({where: {id: In(allIds)}, order: {id: 'ASC'}})).toEqual(snapshot);
		} finally {
			if (keys.length) await hides.delete({accountId: owner.id, seriesKey: In(keys)});
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
					priceChange: null,
					hidden: false,
				}),
				// The same shop in another currency is its own series, costed in the base currency.
				expect.objectContaining({currency: 'GBP', typicalAmount: '29.99', monthlyEquivalent: '34.50'}),
			]),
		);
		expect(byName(series, 'Example Streaming')).toEqual([
			expect.objectContaining({
				typicalAmount: '11.50',
				monthlyEquivalent: '11.50',
				flags: [],
				priceChange: {amount: '1.50', since: '2026-10-08'},
			}),
		]);
		expect(byName(series, 'Example Phone')).toEqual([
			expect.objectContaining({status: 'ACTIVE', flags: ['LATE'], nextExpectedDate: '2026-10-14'}),
		]);
		expect(byName(series, 'Example Magazine')).toEqual([expect.objectContaining({status: 'ENDED'})]);
		expect(byName(series, 'Example Insurer')).toEqual([
			expect.objectContaining({cadence: 'YEARLY', monthlyEquivalent: '10.00', hidden: false}),
		]);
	});

	it('shows a varying bill at its usual amount with its range and recent payments, flagging a high latest one', async () => {
		const fresh = await createVerifiedAccount(
			app.getHttpServer(),
			app.get(ConfigurationService).get('EMAIL_UI_URL'),
		);
		const freshOwner = (await app.get(AccountService).findByEmail(fresh.credentials.email))!;
		await app.get(getRepositoryToken(Account)).update({id: freshOwner.id}, {baseCurrency: 'EUR'});
		const connection = await fixtures.createConnection(freshOwner);
		try {
			const bank = await fixtures.createBankAccount(connection);
			const amounts = ['61.00', '95.00', '48.00', '80.00', '77.00', '160.00'];
			const rows = await fixtures.createTransactions(
				bank,
				MONTHS.map((month, index) =>
					bookedRow(`${month}-05`, `-${amounts[index]}`, {
						counterpartyName: 'Example Energy',
						description: 'Example Energy',
						category: 'UTILITIES',
					}),
				),
			);
			const read = async (asOf: string) =>
				(await fresh.agent.get('/recurring-series').query({asOf}).expect(200)).body.expenses;

			const paid = await read(AS_OF);
			expect(paid.series).toEqual([
				expect.objectContaining({
					name: 'Example Energy',
					amountKind: 'VARIABLE',
					typicalAmount: '78.50',
					latestAmount: '160.00',
					amountRange: {low: '48.00', high: '160.00'},
					recentPayments: rows.map(({bookingDate}, index) => ({date: bookingDate, amount: amounts[index]})),
					// This month's bill is in, so the month costs what was paid.
					monthlyEquivalent: '160.00',
					flags: ['HIGHER_THAN_USUAL'],
				}),
			]);
			expect(paid.monthlyTotal).toBe('160.00');
			// Next month the usual amount is expected again.
			const next = await read('2026-11-02');
			expect(next.series).toEqual([expect.objectContaining({monthlyEquivalent: '78.50'})]);
			expect(next.monthlyTotal).toBe('78.50');
			expect(
				(await fresh.agent.get('/recurring-series/summary').query({asOf: AS_OF}).expect(200)).body,
			).toMatchObject({
				expenseMonthlyTotal: '160.00',
				upcoming: [expect.objectContaining({typicalAmount: '78.50', amountKind: 'VARIABLE'})],
			});
		} finally {
			await fixtures.connections.delete(connection.id);
		}
	});

	it('finds rent across a settled status and a change in how the bank names the payee', async () => {
		const ds = app.get(DataSource);
		const runner = ds.createQueryRunner();
		const hides: Repository<RecurringSeriesHide> = app.get(getRepositoryToken(RecurringSeriesHide));
		const rentRows = await fixtures.transactions.findBy({bankAccountId: ownerBankAccount.id, amount: '-650.00'});
		const ids = rentRows.map(({id}) => id);
		try {
			for (const row of rentRows) {
				await runner.query('UPDATE bank_transactions SET "merchantKey" = $1 WHERE id = $2', [
					row.counterpartyName ? 'EXPENSE:alex-sam exämple' : 'EXPENSE:transfer to alex-sam example',
					row.id,
				]);
			}
			const before = await list(ownerAgent);
			const legacy = before.series.find(({typicalAmount}) => typicalAmount === '650.00')!;
			await hide(ownerAgent, legacy.key).expect(204);
			const saved = await hides.findBy({accountId: owner.id, seriesKey: legacy.key});
			const source = await runner.query(
				"SELECT to_jsonb(t) - 'merchantKey' AS state FROM bank_transactions t WHERE id = ANY($1::uuid[]) ORDER BY id",
				[ids],
			);
			const migration = ds.migrations.find(
				(entry) => entry.name === 'RefreshBankTransactionMerchantKeysForTransferPayees20261023230000',
			)!;
			await migration.up(runner);
			const result = await list(ownerAgent);
			const rent = result.series.filter(({typicalAmount}) => typicalAmount === '650.00');

			expect(rent).toEqual([
				expect.objectContaining({
					cadence: 'MONTHLY',
					transactionCount: 5,
					nextExpectedDate: '2026-10-27',
					status: 'ACTIVE',
					hidden: true,
				}),
			]);
			expect(rent[0].key).not.toBe(legacy.key);
			expect(result.monthlyTotal).toBe(before.monthlyTotal);
			expect(await hides.findBy({accountId: owner.id, seriesKey: legacy.key})).toEqual(saved);
			expect(
				await runner.query(
					"SELECT to_jsonb(t) - 'merchantKey' AS state FROM bank_transactions t WHERE id = ANY($1::uuid[]) ORDER BY id",
					[ids],
				),
			).toEqual(source);
			const drill = await ownerAgent
				.get('/bank-transactions')
				.query({filter: {recurringSeriesKey: rent[0].key}})
				.expect(200);
			expect(drill.body.transactions.map(({id}: {id: string}) => id).sort()).toEqual([...ids].sort());
			await hide(ownerAgent, rent[0].key, false).expect(204);
			expect(parseCents((await list(ownerAgent)).monthlyTotal) - parseCents(before.monthlyTotal)).toBe(65000n);
		} finally {
			await runner.release();
		}
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

	it('lists recurring income apart from bills in the same read', async () => {
		const {expenses, income} = await lists(ownerAgent);
		expect(income.series).toEqual([
			expect.objectContaining({name: 'Example Employer', cadence: 'MONTHLY', typicalAmount: '2500.00'}),
		]);
		expect(expenses.series.every(({name}) => name !== 'Example Employer')).toBe(true);
	});

	it('counts every series by default and hides one without touching its transactions', async () => {
		const before = await list(ownerAgent);
		const streaming = byName(before.series, 'Example Streaming')[0];
		expect(before.series.every(({hidden}) => !hidden)).toBe(true);
		expect(before.unconvertedCount).toBe(0);
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

		await hide(ownerAgent, streaming.key).expect(204);

		const after = await list(ownerAgent);
		expect(after.series.at(-1)).toMatchObject({key: streaming.key, hidden: true});
		expect(parseCents(after.monthlyTotal) - parseCents(before.monthlyTotal)).toBe(-1150n);

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
		await hide(ownerAgent, streaming.key, false).expect(204);
		expect((await list(ownerAgent)).monthlyTotal).toBe(before.monthlyTotal);
	});

	it('keeps one hide when two hides of the same series arrive at once', async () => {
		const hides: Repository<RecurringSeriesHide> = app.get(getRepositoryToken(RecurringSeriesHide));
		const streaming = byName((await list(ownerAgent)).series, 'Example Streaming')[0];
		try {
			for (let attempt = 0; attempt < 3; attempt++) {
				const responses = await Promise.all([hide(ownerAgent, streaming.key), hide(ownerAgent, streaming.key)]);
				expect(responses.map(({status}) => status)).toEqual([204, 204]);
				expect(await hides.countBy({accountId: owner.id, seriesKey: streaming.key})).toBe(1);
				await hide(ownerAgent, streaming.key, false).expect(204);
			}
		} finally {
			await hides.delete({accountId: owner.id, seriesKey: streaming.key});
		}
	});

	it('keeps a hidden series hidden when new payments arrive, until the owner shows it again', async () => {
		const streaming = byName((await list(ownerAgent)).series, 'Example Streaming')[0];
		await hide(ownerAgent, streaming.key).expect(204);

		await fixtures.createTransaction(
			ownerBankAccount,
			bookedRow('2026-10-16', '-11.50', {
				counterpartyName: 'Example Streaming',
				description: 'Example Streaming',
			}),
		);
		const [stillDismissed] = byName((await list(ownerAgent)).series, 'Example Streaming');
		expect(stillDismissed).toMatchObject({key: streaming.key, hidden: true, transactionCount: 7});

		await hide(ownerAgent, streaming.key, false).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Streaming')[0].hidden).toBe(false);
	});

	it('keeps a series hidden when it is reclassified', async () => {
		const utility = {counterpartyName: 'Example Utility', description: 'Example Utility'};
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-06-20', '-10.00', utility),
			bookedRow('2026-07-20', '-20.00', utility),
			bookedRow('2026-08-20', '-20.00', utility),
		]);
		const [variable] = byName((await list(ownerAgent)).series, 'Example Utility');
		expect(variable).toMatchObject({amountKind: 'VARIABLE', transactionCount: 3});
		await hide(ownerAgent, variable.key).expect(204);

		// The amount settles; the payments stay one stream on one rhythm, so the series stays hidden.
		await fixtures.createTransaction(ownerBankAccount, bookedRow('2026-09-20', '-20.00', utility));
		const [fixed] = byName((await list(ownerAgent)).series, 'Example Utility');
		expect(fixed).toMatchObject({
			key: variable.key,
			amountKind: 'FIXED',
			hidden: true,
			transactionCount: 4,
			priceChange: {amount: '10.00', since: '2026-07-20'},
		});

		await hide(ownerAgent, fixed.key, false).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Utility')[0].hidden).toBe(false);
	});

	it('keeps a split series hidden on one part only, so changing one leaves the other alone', async () => {
		const water = {counterpartyName: 'Example Water', description: 'Example Water'};
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-05-21', '-20.00', water),
			bookedRow('2026-06-21', '-10.00', water),
			bookedRow('2026-07-21', '-20.00', water),
		]);
		const [variable] = byName((await list(ownerAgent)).series, 'Example Water');
		expect(variable).toMatchObject({amountKind: 'VARIABLE'});
		await hide(ownerAgent, variable.key).expect(204);

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
		const hidden = parts.filter((part) => part.hidden);
		expect(hidden).toHaveLength(1);
		const other = parts.find(({key}) => key !== hidden[0].key)!;

		await hide(ownerAgent, other.key).expect(204);
		await hide(ownerAgent, other.key, false).expect(204);
		const after = byName((await list(ownerAgent)).series, 'Example Water');
		expect(after.find(({key}) => key === hidden[0].key)?.hidden).toBe(true);
		expect(after.find(({key}) => key === other.key)?.hidden).toBe(false);
	});

	it('shows a merged series again in full when it is shown again', async () => {
		const internet = {counterpartyName: 'Example Internet', description: 'Example Internet'};
		const initialRows = await fixtures.createTransactions(ownerBankAccount, [
			...['2026-01-22', '2026-02-22', '2026-03-22'].map((date) => bookedRow(date, '-10.00', internet)),
			...['2026-04-22', '2026-05-22', '2026-06-22'].map((date) => bookedRow(date, '-20.00', internet)),
		]);
		const hides: Repository<RecurringSeriesHide> = app.get(getRepositoryToken(RecurringSeriesHide));
		// Hides from when sequential prices were separate histories.
		await hides.insert(
			[0, 3].map((offset) => ({
				accountId: owner.id,
				seriesKey: seriesKey(initialRows[offset].merchantKey!, 'EUR', initialRows[offset].id),
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
		expect(merged).toMatchObject({amountKind: 'VARIABLE', transactionCount: 9, hidden: true});

		await hide(ownerAgent, merged.key, false).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Internet')[0].hidden).toBe(false);
		expect(await hides.countBy({accountId: owner.id, transactionIds: ArrayContains([initialRows[0].id])})).toBe(0);
	});

	it('does not move a hide that was undone to the other part of a split', async () => {
		const supplier = {counterpartyName: 'Example Supplier', description: 'Example Supplier'};
		await fixtures.createTransactions(ownerBankAccount, [
			bookedRow('2026-05-17', '-30.00', supplier),
			bookedRow('2026-06-17', '-20.00', supplier),
			bookedRow('2026-07-17', '-20.00', supplier),
		]);
		const [variable] = byName((await list(ownerAgent)).series, 'Example Supplier');
		expect(variable.amountKind).toBe('VARIABLE');
		await hide(ownerAgent, variable.key).expect(204);

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
		const hidden = parts.filter((part) => part.hidden);
		expect(hidden).toHaveLength(1);
		await hide(ownerAgent, hidden[0].key, false).expect(204);
		const reset = byName((await list(ownerAgent)).series, 'Example Supplier');
		expect(reset.map((part) => part.hidden)).toEqual([false, false]);
	});

	it('counts a hidden series again when its payments restart after stopping', async () => {
		const club = {counterpartyName: 'Example Club Membership', description: 'Example Club Membership'};
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-04-05', '2026-05-05', '2026-06-05'].map((date) => bookedRow(date, '-19.00', club)),
		);
		const [stopped] = byName((await list(ownerAgent)).series, 'Example Club Membership');
		expect(stopped).toMatchObject({status: 'ENDED'});
		await hide(ownerAgent, stopped.key).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Club Membership')[0].hidden).toBe(true);

		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-09-05', '2026-10-05'].map((date) => bookedRow(date, '-19.00', club)),
		);
		const [restarted] = byName((await list(ownerAgent)).series, 'Example Club Membership');
		expect(restarted).toMatchObject({key: stopped.key, status: 'ACTIVE', hidden: false});
		// The stored hide is untouched; hiding again covers the restart.
		const hides: Repository<RecurringSeriesHide> = app.get(getRepositoryToken(RecurringSeriesHide));
		const stored = await hides.findBy({accountId: owner.id, seriesKey: stopped.key});
		expect(stored).toEqual([expect.objectContaining({transactionIds: expect.any(Array)})]);
		expect(stored[0].transactionIds).toHaveLength(3);
		await hide(ownerAgent, stopped.key).expect(204);
		expect(byName((await list(ownerAgent)).series, 'Example Club Membership')[0].hidden).toBe(true);
	});

	it('keeps a series hidden when backfilled history contains an older restart', async () => {
		const supplier = {counterpartyName: 'Example Historical Supplier', description: 'Example Historical Supplier'};
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-08-05', '2026-09-05', '2026-10-05'].map((date) => bookedRow(date, '-20.00', supplier)),
		);
		const [fixed] = byName((await list(ownerAgent)).series, 'Example Historical Supplier');
		await hide(ownerAgent, fixed.key).expect(204);

		// Older history changes the amount classification, but its late arrival predates the dismissed payments.
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-05-05', '2026-06-05', '2026-07-11'].map((date) => bookedRow(date, '-10.00', supplier)),
		);
		expect(byName((await list(ownerAgent)).series, 'Example Historical Supplier')).toEqual([
			expect.objectContaining({amountKind: 'FIXED', transactionCount: 6, hidden: true}),
		]);
	});

	it('adds a stopped series back to the total when its payments restart', async () => {
		const pool = {counterpartyName: 'Example Pool', description: 'Example Pool'};
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-03-06', '2026-04-06', '2026-05-06'].map((date) => bookedRow(date, '-21.00', pool)),
		);
		const [stopped] = byName((await list(ownerAgent)).series, 'Example Pool');
		const totalBeforeRestart = Number((await list(ownerAgent)).monthlyTotal);
		await fixtures.createTransactions(
			ownerBankAccount,
			['2026-09-06', '2026-10-06'].map((date) => bookedRow(date, '-21.00', pool)),
		);

		const {series, monthlyTotal} = await list(ownerAgent);
		expect(byName(series, 'Example Pool')).toEqual([
			expect.objectContaining({key: stopped.key, status: 'ACTIVE', hidden: false}),
		]);
		// The stopped series added nothing before; the restart adds its monthly cost.
		expect(Number(monthlyTotal) - totalBeforeRestart).toBeCloseTo(21, 2);
	});

	it.each([[true], [false]] as const)(
		'keeps hiding when sequential prices become one history, both parts hidden %s',
		async (bothHidden) => {
			const hidden = true;
			const name = `Example Sequential ${bothHidden ? 'Both' : 'First'}`;
			const totalBefore = (await list(ownerAgent)).monthlyTotal;
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
			const hides: Repository<RecurringSeriesHide> = app.get(getRepositoryToken(RecurringSeriesHide));
			// Hides saved when the two prices were separate series.
			await hides.insert(
				(bothHidden ? [0, 3] : [0]).map((offset) => ({
					accountId: owner.id,
					seriesKey: seriesKey(rows[offset].merchantKey!, 'EUR', rows[offset].id),
					transactionIds: rows.slice(offset, offset + 3).map(({id}) => id),
				})),
			);
			const result = await list(ownerAgent);
			expect(byName(result.series, name)).toEqual([
				expect.objectContaining({
					amountKind: 'FIXED',
					transactionCount: 6,
					monthlyEquivalent: '48.00',
					hidden,
				}),
			]);
			expect(parseCents(result.monthlyTotal) - parseCents(totalBefore)).toBe(hidden ? 0n : 4800n);
			const [merged] = byName(result.series, name);
			await hide(ownerAgent, merged.key, false).expect(204);
			expect(byName((await list(ownerAgent)).series, name)[0].hidden).toBe(false);
			expect(
				await hides.countBy({
					accountId: owner.id,
					seriesKey: In([0, 3].map((offset) => seriesKey(rows[offset].merchantKey!, 'EUR', rows[offset].id))),
				}),
			).toBe(0);
			expect(
				await fixtures.transactions.find({where: {id: In(rows.map(({id}) => id))}, order: {id: 'ASC'}}),
			).toEqual(snapshot);
		},
	);

	it('keeps a series hidden through a price change without hiding a concurrent plan', async () => {
		const name = 'Example Parallel Memberships';
		const samePayee = {counterpartyName: name, description: name, category: 'SUBSCRIPTIONS' as const};
		await fixtures.createTransactions(ownerBankAccount, [
			...MONTHS.slice(0, 3).map((month) => bookedRow(`${month}-07`, '-24.00', samePayee)),
			...MONTHS.map((month) => bookedRow(`${month}-19`, '-96.00', samePayee)),
		]);
		const old = byName((await list(ownerAgent)).series, name).find(
			({monthlyEquivalent}) => monthlyEquivalent === '24.00',
		)!;
		await hide(ownerAgent, old.key).expect(204);
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
					hidden: true,
				}),
				expect.objectContaining({monthlyEquivalent: '96.00', transactionCount: 6, hidden: false}),
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

	describe('automatic continuations', () => {
		type Continuation = {
			previousName: string;
			previousFirstDate: string;
			previousLastDate: string;
			linked: boolean;
		} | null;
		type LinkSeries = SeriesBody & {continuation: Continuation; firstDate: string; lastDate: string};

		/** A plan paid under a company name, then from another account under its branch name. */
		async function renamedPlan(newerAmount = '-25.00') {
			const fresh = await createVerifiedAccount(
				app.getHttpServer(),
				app.get(ConfigurationService).get('EMAIL_UI_URL'),
			);
			const freshOwner = (await app.get(AccountService).findByEmail(fresh.credentials.email))!;
			const connection = await fixtures.createConnection(freshOwner);
			const [first, second] = [
				await fixtures.createBankAccount(connection),
				await fixtures.createBankAccount(connection),
			];
			const older = await fixtures.createTransactions(
				first,
				['2026-01-11', '2026-02-11', '2026-03-11'].map((date) =>
					bookedRow(date, '-24.00', {counterpartyName: 'Example Motion Ltd', description: null}),
				),
			);
			const newer = await fixtures.createTransactions(
				second,
				['2026-07-12', '2026-08-12', '2026-09-12', '2026-10-12'].map((date) =>
					bookedRow(date, newerAmount, {counterpartyName: 'Example Motion Exampletown', description: null}),
				),
			);
			const read = async () =>
				(await fresh.agent.get('/recurring-series').query({asOf: AS_OF}).expect(200)).body.expenses as Omit<
					Awaited<ReturnType<typeof list>>,
					'series'
				> & {series: LinkSeries[]};
			const drill = async (key: string) =>
				(
					await fresh.agent
						.get('/bank-transactions')
						.query({filter: {recurringSeriesKey: key}, pagination: {pageIndex: 0, pageSize: 50}})
						.expect(200)
				).body.transactions
					.map(({id}: {id: string}) => id)
					.sort();
			const link = (key: string, linked: boolean) =>
				fresh.agent.patch(`/recurring-series/${key}/continuation`).send({linked});
			return {fresh, freshOwner, connection, first, older, newer, read, drill, link};
		}

		const sorted = (rows: {id: string}[]) => rows.map(({id}) => id).sort();

		it('links a renamed history automatically, and unlinks or links it again on request', async () => {
			const {fresh, freshOwner, connection, older, newer, read, drill, link} = await renamedPlan();
			try {
				const ids = [...older, ...newer].map(({id}) => id);
				const snapshot = await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}});
				const linked = await read();
				expect(linked.series).toEqual([
					expect.objectContaining({
						name: 'Example Motion Exampletown',
						transactionCount: 7,
						firstDate: '2026-01-11',
						lastDate: '2026-10-12',
						typicalAmount: '25.00',
						nextExpectedDate: '2026-11-12',
						status: 'ACTIVE',
						hidden: false,
						continuation: {
							previousName: 'Example Motion Ltd',
							previousFirstDate: '2026-01-11',
							previousLastDate: '2026-03-11',
							linked: true,
						},
					}),
				]);
				expect(linked.monthlyTotal).toBe('25.00');
				const [joined] = linked.series;
				expect(await drill(joined.key)).toEqual([...ids].sort());
				await link(joined.key, true).expect(404);

				// Unlinking shows both histories apart; only the newer one still counts.
				await link(joined.key, false).expect(204);
				const unlinked = await read();
				const [previous] = byName(unlinked.series, 'Example Motion Ltd');
				const [current] = byName(unlinked.series, 'Example Motion Exampletown');
				expect(unlinked.series).toHaveLength(2);
				expect(previous).toMatchObject({status: 'ENDED', transactionCount: 3, continuation: null});
				// The newer history keeps the pair, so it can be linked again after the undo toast is gone.
				expect(current).toMatchObject({
					status: 'ACTIVE',
					transactionCount: 4,
					continuation: {
						previousName: 'Example Motion Ltd',
						previousFirstDate: '2026-01-11',
						previousLastDate: '2026-03-11',
						linked: false,
					},
				});
				expect(unlinked.monthlyTotal).toBe('25.00');
				expect(await drill(previous.key)).toEqual(sorted(older));
				expect(await drill(current.key)).toEqual(sorted(newer));
				const unlinks: Repository<RecurringContinuationUnlink> = app.get(
					getRepositoryToken(RecurringContinuationUnlink),
				);
				expect(await unlinks.findBy({accountId: freshOwner.id})).toEqual([
					expect.objectContaining({
						olderTransactionIds: older.map(({id}) => id),
						newerTransactionIds: newer.map(({id}) => id),
					}),
				]);
				await link(current.key, false).expect(404);

				// Undo from the joined key the web still holds links them again.
				await link(joined.key, true).expect(204);
				expect((await read()).series).toEqual([
					expect.objectContaining({key: joined.key, transactionCount: 7}),
				]);
				await link(joined.key, false).expect(204);

				// Either history links them again; the web sends the newer one's key.
				for (const key of [current.key, previous.key]) {
					await link(key, true).expect(204);
					expect((await read()).series).toEqual([
						expect.objectContaining({
							key: joined.key,
							transactionCount: 7,
							continuation: expect.objectContaining({linked: true}),
						}),
					]);
					if (key === current.key) await link(joined.key, false).expect(204);
				}
				expect(await unlinks.countBy({accountId: freshOwner.id})).toBe(0);

				expect(await fixtures.transactions.find({where: {id: In(ids)}, order: {id: 'ASC'}})).toEqual(snapshot);
				await ownerAgent
					.patch(`/recurring-series/${joined.key}/continuation`)
					.send({linked: false})
					.expect(404);
				await link('not-a-key', false).expect(400);
				await link(joined.key, 'MAYBE' as never).expect(400);
				await fresh.agent.patch(`/recurring-series/${joined.key}/continuation`).send({}).expect(400);
			} finally {
				await fixtures.connections.delete(connection.id);
			}
		});

		it('hides a linked history as a whole, and unlinking keeps other series alone', async () => {
			const {connection, first, read, link, fresh} = await renamedPlan();
			try {
				await fixtures.createTransactions(
					first,
					monthly('20', '-9.00', 'Example Other Club', {description: null}),
				);
				const [joined] = byName((await read()).series, 'Example Motion Exampletown');
				expect(joined).toMatchObject({transactionCount: 7});
				expect((await read()).monthlyTotal).toBe('34.00');

				await hide(fresh.agent, joined.key).expect(204);
				const hidden = await read();
				expect(hidden.series.map(({name, hidden}) => [name, hidden])).toEqual([
					['Example Other Club', false],
					['Example Motion Exampletown', true],
				]);
				expect(hidden.monthlyTotal).toBe('9.00');

				await hide(fresh.agent, joined.key, false).expect(204);
				await link(joined.key, false).expect(204);
				const unlinked = await read();
				expect(unlinked.series.map(({name, hidden}) => [name, hidden]).sort()).toEqual([
					['Example Motion Exampletown', false],
					['Example Motion Ltd', false],
					['Example Other Club', false],
				]);
				expect(unlinked.monthlyTotal).toBe('34.00');
			} finally {
				await fixtures.connections.delete(connection.id);
			}
		});

		it('keeps one answer when two clients unlink at the same moment', async () => {
			const {freshOwner, connection, read, link} = await renamedPlan();
			try {
				const [joined] = byName((await read()).series, 'Example Motion Exampletown');
				const statuses = (await Promise.all([link(joined.key, false), link(joined.key, false)])).map(
					({status}) => status,
				);
				// The later request either finds the pair already unlinked or loses the race to it.
				expect(statuses.sort((a, b) => a - b)).toEqual([204, statuses.includes(409) ? 409 : 404]);
				const unlinks: Repository<RecurringContinuationUnlink> = app.get(
					getRepositoryToken(RecurringContinuationUnlink),
				);
				expect(await unlinks.countBy({accountId: freshOwner.id})).toBe(1);
			} finally {
				await fixtures.connections.delete(connection.id);
			}
		});

		it('stops linking when an even older history makes the continuation ambiguous', async () => {
			const {connection, first, read, link} = await renamedPlan();
			try {
				const [joined] = byName((await read()).series, 'Example Motion Exampletown');
				// Older payments from a reconnected bank appear under the shortest form of the name, which either later
				// name could continue.
				await fixtures.createTransactions(
					first,
					['2025-08-10', '2025-09-10', '2025-10-10'].map((date) =>
						bookedRow(date, '-24.00', {counterpartyName: 'Example', description: null}),
					),
				);
				const {series} = await read();
				expect(
					[...series]
						.sort((a, b) => a.name.localeCompare(b.name))
						.map(({name, continuation}) => [name, continuation]),
				).toEqual([
					['Example', null],
					['Example Motion Exampletown', null],
					['Example Motion Ltd', null],
				]);
				await link(joined.key, false).expect(404);
			} finally {
				await fixtures.connections.delete(connection.id);
			}
		});

		it('links nothing when the later history’s price does not continue the earlier one', async () => {
			const {connection, read} = await renamedPlan('-71.00');
			try {
				const {series} = await read();
				expect(series.map(({continuation}) => continuation)).toEqual([null, null]);
				expect(series).toHaveLength(2);
			} finally {
				await fixtures.connections.delete(connection.id);
			}
		});
	});

	it('rejects keys that are invalid, unknown or another owner’s', async () => {
		const [club] = (await list(otherAgent)).series;

		await hide(ownerAgent, club.key).expect(404);
		await hide(ownerAgent, club.key, false).expect(404);
		await hide(ownerAgent, '0'.repeat(32)).expect(404);
		await hide(ownerAgent, 'not-a-key').expect(400);
		await otherAgent.patch(`/recurring-series/${club.key}/hidden`).send({hidden: 'MAYBE'}).expect(400);
		await otherAgent.patch(`/recurring-series/${club.key}/hidden`).send({}).expect(400);
		await ownerAgent.get('/recurring-series').expect(400);
		await ownerAgent
			.get('/bank-transactions')
			.query({filter: {recurringSeriesKey: club.key}})
			.expect(404);
	});

	it('reads and stores one coherent payment version while the ledger changes', async () => {
		const fresh = await createVerifiedAccount(
			app.getHttpServer(),
			app.get(ConfigurationService).get('EMAIL_UI_URL'),
		);
		const account = (await app.get(AccountService).findByEmail(fresh.credentials.email))!;
		const connection = await fixtures.createConnection(account);
		const bank = await fixtures.createBankAccount(connection);
		const rows = await fixtures.createTransactions(
			bank,
			monthly('12', '-40.00', 'Example Snapshot Race').slice(0, 3),
		);
		const read = SelectQueryBuilder.prototype.getRawMany;
		let concurrentPayment: BankTransaction | undefined;
		let armed = true;
		const query = jest.spyOn(SelectQueryBuilder.prototype, 'getRawMany').mockImplementation(async function (
			this: SelectQueryBuilder<BankTransaction>,
		) {
			const result = await read.call(this);
			if (armed && this.getParameters().accountId === account.id && this.getQuery().includes('md5(string_agg')) {
				armed = false;
				// A separate connection commits a payment after the hash's database read.
				concurrentPayment = await fixtures.createTransaction(
					bank,
					bookedRow('2026-08-12', '-40.00', {
						counterpartyName: 'Example Snapshot Race',
					}),
				);
			}
			return result;
		});
		try {
			await fresh.agent.get('/recurring-series').query({asOf: AS_OF}).expect(200);
			expect(concurrentPayment).toBeDefined();
			query.mockRestore();
			await fixtures.transactions.delete(concurrentPayment!.id);
			const response = await fresh.agent.get('/recurring-series').query({asOf: AS_OF}).expect(200);
			const [series] = byName(response.body.expenses.series, 'Example Snapshot Race');
			expect(series.transactionCount).toBe(rows.length);
			const drill = await fresh.agent
				.get('/bank-transactions')
				.query({filter: {recurringSeriesKey: series.key}})
				.expect(200);
			expect(drill.body.total).toBe(series.transactionCount);
			expect(drill.body.transactions.map(({id}: {id: string}) => id).sort()).toEqual(
				rows.map(({id}) => id).sort(),
			);
		} finally {
			query.mockRestore();
			await fixtures.connections.delete(connection.id);
		}
	});

	it.each(['hash', 'rows', 'commit', 'upsert'] as const)('retries after a failed snapshot %s', async (phase) => {
		const fresh = await createVerifiedAccount(
			app.getHttpServer(),
			app.get(ConfigurationService).get('EMAIL_UI_URL'),
		);
		const account = (await app.get(AccountService).findByEmail(fresh.credentials.email))!;
		const connection = await fixtures.createConnection(account);
		const bank = await fixtures.createBankAccount(connection);
		const rows = await fixtures.createTransactions(
			bank,
			monthly('12', '-40.00', 'Example Snapshot Retry').slice(0, 3),
		);
		const snapshots: Repository<RecurringSnapshot> = app.get(getRepositoryToken(RecurringSnapshot));
		const upsert = jest.spyOn(snapshots, 'upsert');
		if (phase === 'upsert') upsert.mockRejectedValueOnce(new Error('Synthetic snapshot write failure'));
		const read = SelectQueryBuilder.prototype.getRawMany;
		let armed = true;
		let restoreCommit: (() => void) | undefined;
		const query = jest.spyOn(SelectQueryBuilder.prototype, 'getRawMany').mockImplementation(async function (
			this: SelectQueryBuilder<BankTransaction>,
		) {
			const owner = this.getParameters().accountId === account.id;
			const hash = this.getQuery().includes('md5(string_agg');
			if (armed && owner && ((phase === 'hash' && hash) || (phase === 'rows' && !hash))) {
				armed = false;
				throw new Error('Synthetic snapshot read failure');
			}
			const result = await read.call(this);
			if (armed && owner && hash && phase === 'commit') {
				armed = false;
				const commit = jest
					.spyOn(this.queryRunner!, 'commitTransaction')
					.mockRejectedValueOnce(new Error('Synthetic snapshot commit failure'));
				restoreCommit = () => commit.mockRestore();
			}
			return result;
		});
		try {
			await fresh.agent.get('/recurring-series').query({asOf: AS_OF}).expect(500);
			query.mockRestore();
			restoreCommit?.();
			upsert.mockRestore();
			const response = await fresh.agent.get('/recurring-series').query({asOf: AS_OF}).expect(200);
			expect(byName(response.body.expenses.series, 'Example Snapshot Retry')).toEqual([
				expect.objectContaining({transactionCount: rows.length, typicalAmount: '40.00'}),
			]);
		} finally {
			query.mockRestore();
			restoreCommit?.();
			upsert.mockRestore();
			await fixtures.connections.delete(connection.id);
		}
	});

	it('keeps stored detections across restarts and detects again when the detection rules change', async () => {
		const snapshots: Repository<RecurringSnapshot> = app.get(getRepositoryToken(RecurringSnapshot));
		// A restarted app is a new service on the same database, with nothing kept in memory.
		const restarted = new RecurringSeriesService(
			app.get(getRepositoryToken(BankTransaction)),
			app.get(getRepositoryToken(RecurringSeriesHide)),
			app.get(getRepositoryToken(RecurringContinuationUnlink)),
			snapshots,
		);
		const readRestarted = async () =>
			JSON.parse(JSON.stringify(await restarted.list({id: owner.id, baseCurrency: 'EUR'}, AS_OF))) as unknown;
		const detect = jest.spyOn(detection, 'detectUndatedRecurringSeries');
		try {
			const before = await list(ownerAgent);
			const payload = (await snapshots.findOneByOrFail({accountId: owner.id})).payload as {
				series: Record<string, unknown>[];
				pairs: {joined: Record<string, unknown>}[];
			};
			expect(payload.series.length).toBeGreaterThan(0);
			for (const entry of [...payload.series, ...payload.pairs.map(({joined}) => joined)]) {
				expect(entry).not.toHaveProperty('monthlyEquivalent');
				expect(entry).not.toHaveProperty('status');
				expect(entry).not.toHaveProperty('flags');
			}
			detect.mockClear();
			// Starting the app again keeps what was stored.
			expect(await readRestarted()).toEqual(await lists(ownerAgent));
			expect(detect).not.toHaveBeenCalled();

			// A detection stored under other rules is not reused.
			await snapshots.update({accountId: owner.id}, {rulesVersion: 'older-rules'});
			expect(await list(ownerAgent)).toEqual(before);
			expect(detect).toHaveBeenCalledTimes(1);
			expect(await snapshots.findOneByOrFail({accountId: owner.id})).toMatchObject({
				rulesVersion: RECURRING_DETECTION_RULES_VERSION,
			});
		} finally {
			detect.mockRestore();
		}
	});

	it.each(['unchanged', 'changed'] as const)(
		'detects once when reads after a change overlap (%s inputs)',
		async (inputs) => {
			const extra = await fixtures.createTransactions(
				ownerBankAccount,
				monthly('17', '-9.00', 'Example Shared Bill', {category: 'SUBSCRIPTIONS'}),
			);
			const server = app.getHttpServer();
			await app.listen(0, '127.0.0.1');
			let hashes = 0;
			let allHashed!: () => void;
			const snapshotsStarted = new Promise<void>((resolve) => (allHashed = resolve));
			let releaseFollowers!: () => void;
			const leaderFinished = new Promise<void>((resolve) => (releaseFollowers = resolve));
			const read = SelectQueryBuilder.prototype.getRawMany;
			const query = jest.spyOn(SelectQueryBuilder.prototype, 'getRawMany').mockImplementation(async function (
				this: SelectQueryBuilder<BankTransaction>,
			) {
				const result = await read.call(this);
				if (this.getParameters().accountId === owner.id && this.getQuery().includes('md5(string_agg')) {
					const position = ++hashes;
					if (position === 3) allHashed();
					if (position <= 3) {
						// All three database snapshots precede the write; followers resume after the leader responds.
						await snapshotsStarted;
						if (position > 1) await leaderFinished;
					}
				}
				return result;
			});
			const detect = jest.spyOn(detection, 'detectUndatedRecurringSeries');
			const pending = [list(ownerAgent), lists(ownerAgent), list(ownerAgent)] as const;
			try {
				await Promise.race(pending);
				expect(detect).toHaveBeenCalledTimes(1);
				if (inputs === 'changed') {
					// A newer input version can finish while readers of the previous version are paused.
					await fixtures.transactions.update(
						{id: In(extra.map(({id}) => id))},
						{displayDescription: 'Example Updated Bill'},
					);
				}
				const current = await list(ownerAgent);
				expect(
					byName(current.series, inputs === 'changed' ? 'Example Updated Bill' : 'Example Shared Bill'),
				).toHaveLength(1);
				const detections = inputs === 'changed' ? 2 : 1;
				expect(detect).toHaveBeenCalledTimes(detections);
				releaseFollowers();
				const reads = await Promise.all(pending);
				expect(byName(reads[0].series, 'Example Shared Bill')).toHaveLength(1);
				expect(reads[1].expenses).toEqual(reads[0]);
				expect(reads[2]).toEqual(reads[0]);
				expect(detect).toHaveBeenCalledTimes(detections);
				expect(await list(ownerAgent)).toEqual(current);
				expect(detect).toHaveBeenCalledTimes(detections);
			} finally {
				allHashed();
				releaseFollowers();
				await Promise.allSettled(pending);
				query.mockRestore();
				detect.mockRestore();
				await new Promise<void>((resolve, reject) =>
					server.close((error?: Error) => (error ? reject(error) : resolve())),
				);
				await fixtures.transactions.delete(extra.map(({id}) => id));
			}
		},
	);

	it('detects once per change in the payments it reads, not on every read', async () => {
		const detect = jest.spyOn(detection, 'detectUndatedRecurringSeries');
		const dating = jest.spyOn(detection, 'atDate');
		try {
			const before = await list(ownerAgent);
			detect.mockClear();
			expect(await list(ownerAgent)).toEqual(before);
			expect(await list(ownerAgent, 'INCOME')).toEqual(expect.objectContaining({series: expect.any(Array)}));
			expect(detect).not.toHaveBeenCalled();

			// Hiding is the owner's answer, not a change in payments: no new detection.
			const [gym] = byName(before.series, 'Example Gym');
			dating.mockClear();
			await hide(ownerAgent, gym.key).expect(204);
			expect(await app.get(RecurringSeriesService).findTransactionIds(owner.id, gym.key)).toHaveLength(
				gym.transactionCount,
			);
			expect(dating).not.toHaveBeenCalled();
			expect((await list(ownerAgent)).series.find(({key}) => key === gym.key)?.hidden).toBe(true);
			dating.mockClear();
			await hide(ownerAgent, gym.key, false).expect(204);
			expect(dating).not.toHaveBeenCalled();
			expect(detect).not.toHaveBeenCalled();

			// A new payment is detected on the next read.
			const extra = await fixtures.createTransactions(
				ownerBankAccount,
				monthly('16', '-7.00', 'Example Cache Bill', {category: 'SUBSCRIPTIONS'}),
			);
			expect(byName((await list(ownerAgent)).series, 'Example Cache Bill')).toHaveLength(1);
			expect(detect).toHaveBeenCalled();

			// So is a category change that skips the row's update timestamp.
			detect.mockClear();
			await fixtures.transactions
				.createQueryBuilder()
				.update()
				.set({category: 'FOOD_AND_DRINK', updatedAt: () => '"updatedAt"'})
				.whereInIds(extra.map(({id}) => id))
				.execute();
			expect(byName((await list(ownerAgent)).series, 'Example Cache Bill')).toEqual([]);
			expect(detect).toHaveBeenCalled();
			await fixtures.transactions.delete(extra.map(({id}) => id));

			// Moving text between fields is a change too: a yearly plan of two payments counts only as a subscription.
			const annual = await fixtures.createTransactions(
				ownerBankAccount,
				['2025-09-21', '2026-09-21'].map((date) =>
					bookedRow(date, '-60.00', {
						counterpartyName: 'Example Cache Annual',
						description: 'Example Cache Annual',
						category: 'SUBSCRIPTIONS',
					}),
				),
			);
			expect(byName((await list(ownerAgent)).series, 'Example Cache Annual')).toHaveLength(1);
			await fixtures.transactions
				.createQueryBuilder()
				.update()
				.set({
					category: null,
					description: 'SUBSCRIPTIONS|Example Cache Annual',
					updatedAt: () => '"updatedAt"',
				})
				.whereInIds(annual.map(({id}) => id))
				.execute();
			expect(byName((await list(ownerAgent)).series, 'Example Cache Annual')).toEqual([]);
			await fixtures.transactions.delete(annual.map(({id}) => id));
		} finally {
			dating.mockRestore();
			detect.mockRestore();
		}
	});

	it('summarizes counted bills and income with the next payments due', async () => {
		const summary = async (asOf = AS_OF) =>
			(await ownerAgent.get('/recurring-series/summary').query({asOf}).expect(200)).body as {
				expenseMonthlyTotal: string;
				incomeMonthlyTotal: string;
				upcoming: {
					key: string;
					name: string;
					direction: string;
					nextExpectedDate: string;
					typicalAmount: string;
				}[];
				expenseUnconvertedCount: number;
				incomeUnconvertedCount: number;
				baseCurrency: string | null;
			};
		const [{expenses, income}, result] = [await lists(ownerAgent), await summary()];
		expect(result).toMatchObject({
			expenseMonthlyTotal: expenses.monthlyTotal,
			incomeMonthlyTotal: income.monthlyTotal,
			expenseUnconvertedCount: expenses.unconvertedCount,
			incomeUnconvertedCount: income.unconvertedCount,
			baseCurrency: 'EUR',
		});
		// The three soonest of the counted bills and income; late ones are still due.
		const due = [...expenses.series, ...income.series]
			.filter(({hidden, status}) => !hidden && status === 'ACTIVE')
			.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate) || a.key.localeCompare(b.key))
			.slice(0, 3);
		expect(due).toHaveLength(3);
		expect(result.upcoming.map(({key}) => key)).toEqual(due.map(({key}) => key));
		expect(result.upcoming[0]).toEqual({
			key: due[0].key,
			name: due[0].name,
			direction: 'EXPENSE',
			nextExpectedDate: due[0].nextExpectedDate,
			typicalAmount: due[0].typicalAmount,
			amountKind: due[0].amountKind,
			currency: due[0].currency,
		});

		// A hidden series leaves both the total and the upcoming payments.
		await hide(ownerAgent, due[0].key).expect(204);
		const hidden = await summary();
		expect(hidden.upcoming.map(({key}) => key)).not.toContain(due[0].key);
		expect(parseCents(hidden.expenseMonthlyTotal)).toBeLessThan(parseCents(result.expenseMonthlyTotal));
		await hide(ownerAgent, due[0].key, false).expect(204);

		// Income not converted yet is left out of the income total only, never counted against the bills.
		const unconverted = await fixtures.createTransactions(
			ownerBankAccount,
			monthly('19', '900.00', 'Example Foreign Payroll', {currency: 'USD', amountInBaseCurrency: null}),
		);
		expect(await summary()).toMatchObject({
			expenseUnconvertedCount: result.expenseUnconvertedCount,
			incomeUnconvertedCount: result.incomeUnconvertedCount + 1,
		});
		await fixtures.transactions.delete(unconverted.map(({id}) => id));

		expect((await otherAgent.get('/recurring-series/summary').query({asOf: AS_OF}).expect(200)).body).toMatchObject(
			{
				upcoming: [expect.objectContaining({name: 'Example Club'})],
			},
		);
		await ownerAgent.get('/recurring-series/summary').expect(400);
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
