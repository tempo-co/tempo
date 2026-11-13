import {INestApplication} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {DeepPartial, IsNull, Not} from 'typeorm';

import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '@modules/banking/bank-transaction-financial-event';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {OwnTransferService} from '@modules/banking/services/own-transfer.service';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const IBANS = ['NL91ABNA0417164300', 'GB82WEST12345698765432', 'DE89370400440532013000'];
/** Not stored on its account at first: a recompute fills it in once a row names it. */
const UNSTORED_IBAN = 'FR1420041010050500013M02606';
/** Few enough that legs compete for partners, enough that one round's edits leave most amounts untouched. */
const AMOUNTS = Array.from({length: 20}, (_, index) => `${10 + index * 5}.50`);
const HOLDER = 'Jane Example';
const OTHER_PERSON = 'John Sample';

/** Enable Banking's identification hash of an IBAN in a currency, so the recompute can verify it. */
function identificationHash(iban: string, currency: string): string {
	const header = Buffer.from(
		JSON.stringify([
			['account', 'account_id', 'iban'],
			['account', 'currency'],
		]),
	);
	const digest = createHash('sha256').update(`[\n"${iban}",\n"${currency}"\n]`).digest();
	return `${header.toString('base64url')}.${digest.toString('base64url')}`;
}

/** A small deterministic generator, so a failure reproduces. */
function random(seed: number) {
	let state = seed;
	const next = () => {
		state = (state + 0x6d2b79f5) | 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
	return {
		chance: (probability: number) => next() < probability,
		pick: <T>(values: readonly T[]) => values[Math.floor(next() * values.length)],
		integer: (max: number) => Math.floor(next() * max),
	};
}

describe('OwnTransferService', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let service: OwnTransferService;

	beforeAll(() => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		service = app.get(OwnTransferService);
	});

	it('recomputes around changed rows with the same result as recomputing the whole history', async () => {
		const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: 'EUR'});
		await fixtures.bankAccounts.update(bankAccount.id, {iban: IBANS[0], name: HOLDER});
		const accounts = [
			await fixtures.bankAccounts.findOneByOrFail({id: bankAccount.id}),
			...(await fixtures.createBankAccounts(connection, [
				{iban: IBANS[1], name: HOLDER},
				{iban: IBANS[2], name: HOLDER},
				{iban: null, name: HOLDER, identificationHash: identificationHash(UNSTORED_IBAN, 'EUR')},
			])),
		];
		const generator = random(20261113);
		const named = `SEPA Overboeking Naam: ${HOLDER} Omschrijving: savings`;
		const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
		const rowValues = (offset = generator.integer(28)): DeepPartial<BankTransaction> => {
			const debit = generator.chance(0.5);
			const date = day(offset);
			return {
				amount: `${debit ? '-' : ''}${generator.pick(AMOUNTS)}`,
				creditDebitIndicator: debit ? 'DBIT' : 'CRDT',
				bookingDate: date,
				valueDate: date,
				transactionStatus: generator.chance(0.1) ? 'PDNG' : 'BOOK',
				transactionType: generator.chance(0.1) ? 'CARD_PAYMENT' : null,
				counterpartyIban: generator.chance(0.4) ? generator.pick(IBANS) : null,
				// The holder's own name is name evidence; another person's name is not.
				counterpartyName: generator.chance(0.3)
					? generator.pick([HOLDER, HOLDER.toUpperCase(), OTHER_PERSON])
					: null,
				description: generator.chance(0.2) ? named : 'Example Shop',
				ownTransferOverride: generator.chance(0.05) ? generator.pick(['MARKED', 'UNMARKED']) : null,
				financialEventType: generator.chance(0.05)
					? BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE
					: null,
			};
		};
		/** Random rows, half of them with a transfer leg on another account that may or may not answer them. */
		const createRows = async (count: number) => {
			const rows: Array<[(typeof accounts)[number], DeepPartial<BankTransaction>]> = [];
			for (let index = 0; index < count; index++) {
				const account = generator.pick(accounts);
				const offset = generator.integer(28);
				const values = rowValues(offset);
				rows.push([account, values]);
				if (!generator.chance(0.5)) continue;
				const other = generator.pick(accounts.filter(({id}) => id !== account.id));
				// Up to seven days later: some legs fall outside the pairing window.
				const partnerOffset = offset + generator.integer(8);
				if (generator.chance(0.6)) values.counterpartyIban = other.iban;
				rows.push([
					other,
					{
						...rowValues(partnerOffset),
						amount: String(values.amount).startsWith('-')
							? String(values.amount).slice(1)
							: `-${values.amount}`,
						creditDebitIndicator: values.creditDebitIndicator === 'DBIT' ? 'CRDT' : 'DBIT',
						counterpartyIban: generator.chance(0.5) ? account.iban : null,
						description: generator.chance(0.5) ? named : 'Example Shop',
					},
				]);
			}
			const created = [];
			for (const [account, values] of rows) created.push(await fixtures.createTransaction(account, values));
			return created.map(({id}) => id);
		};
		const snapshot = async () => ({
			transactions: await fixtures.transactions.find({
				select: {
					id: true,
					ownTransferEvidence: true,
					ownTransferCounterpartId: true,
					category: true,
					categoryStatus: true,
					categoryProvider: true,
				},
				where: accounts.map(({id}) => ({bankAccountId: id})),
				order: {id: 'ASC'},
			}),
			ibans: (
				await fixtures.bankAccounts.find({where: {bankConnection: {id: connection.id}}, order: {id: 'ASC'}})
			).map(({iban}) => iban),
		});

		const ids = await createRows(150);
		await service.recomputeForOwner(owner.id);
		await expect(service.recomputeForOwner(owner.id, {transactionIds: []})).resolves.toMatchObject({
			transactionsChanged: 0,
		});

		let scopedChanges = 0;
		let removedPendingPairs = 0;
		for (let round = 0; round < 8; round++) {
			const changed = await createRows(4);
			// A pending transfer with evidence of its own and its booked leg, so later rounds have a pair to remove.
			const pendingAmount = generator.pick(AMOUNTS);
			const pendingDate = day(generator.integer(28));
			for (const [account, values] of [
				[
					accounts[0],
					{amount: `-${pendingAmount}`, transactionStatus: 'PDNG', counterpartyIban: accounts[1].iban},
				],
				[accounts[1], {amount: pendingAmount, transactionStatus: 'BOOK'}],
			] as const) {
				const transaction = await fixtures.createTransaction(account, {
					...values,
					creditDebitIndicator: values.amount.startsWith('-') ? 'DBIT' : 'CRDT',
					bookingDate: pendingDate,
					valueDate: pendingDate,
					description: 'Example Shop',
				});
				changed.push(transaction.id);
			}
			for (let edit = 0; edit < 12; edit++) {
				const id = generator.pick(ids);
				const {
					amount,
					bookingDate,
					transactionStatus,
					financialEventType,
					counterpartyIban,
					counterpartyName,
					ownTransferOverride,
				} = rowValues();
				const update = generator.pick([
					{amount},
					{bookingDate, valueDate: bookingDate},
					{transactionStatus},
					{financialEventType},
					{counterpartyIban},
					{counterpartyName},
					{counterpartyName: generator.pick([HOLDER, OTHER_PERSON])},
					{ownTransferOverride},
				]);
				await fixtures.transactions.update(id, update as DeepPartial<BankTransaction>);
				changed.push(id);
			}
			// A paired leg moving to another amount frees its former counterpart, which only the old amount's rows decide.
			const paired = await fixtures.transactions.find({
				select: {id: true, amount: true},
				where: accounts.map(({id}) => ({bankAccountId: id, ownTransferCounterpartId: Not(IsNull())})),
				order: {id: 'ASC'},
			});
			const moved = generator.pick(paired);
			await fixtures.transactions.update(moved.id, {amount: `${moved.amount.startsWith('-') ? '-' : ''}7.25`});
			changed.push(moved.id);
			// A sync that removes a paired pending leg scopes in its former counterpart, which the leg can no longer name.
			const pairedPending = await fixtures.transactions.find({
				select: {id: true, ownTransferCounterpartId: true},
				where: accounts.map(({id}) => ({
					bankAccountId: id,
					transactionStatus: 'PDNG',
					ownTransferCounterpartId: Not(IsNull()),
				})),
				order: {id: 'ASC'},
			});
			if (pairedPending.length > 0) {
				const removed = generator.pick(pairedPending);
				await fixtures.transactions.delete(removed.id);
				removedPendingPairs += 1;
				changed.push(removed.ownTransferCounterpartId!);
			}
			if (round === 5) {
				changed.push(...(await createRows(1)));
				await fixtures.transactions.update(changed.at(-1)!, {counterpartyIban: UNSTORED_IBAN, currency: 'EUR'});
			}
			ids.push(...changed);

			scopedChanges += (await service.recomputeForOwner(owner.id, {transactionIds: changed})).transactionsChanged;
			const scoped = await snapshot();
			await expect(service.recomputeForOwner(owner.id)).resolves.toEqual({
				accountIbansAdded: 0,
				transactionsChanged: 0,
				changedIds: [],
			});
			expect(await snapshot()).toEqual(scoped);
		}
		// The edits paired and unpaired legs, and the named IBAN was filled in.
		expect(scopedChanges).toBeGreaterThan(20);
		expect(removedPendingPairs).toBeGreaterThan(4);
		expect((await snapshot()).ibans).toContain(UNSTORED_IBAN);
		// Some name evidence came only from a counterparty name the rounds set or changed.
		const nameOnly = await fixtures.transactions.countBy(
			accounts.map(({id}) => ({bankAccountId: id, ownTransferEvidence: 'NAME', description: 'Example Shop'})),
		);
		expect(nameOnly).toBeGreaterThan(2);
	}, 30_000);
});
