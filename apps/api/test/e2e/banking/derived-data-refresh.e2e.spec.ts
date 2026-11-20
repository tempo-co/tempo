import {INestApplication} from '@nestjs/common';
import {getRepositoryToken} from '@nestjs/typeorm';
import {DeepPartial, Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';
import {BankAccount} from '@modules/banking/bank-account.entity';
import {BANK_TRANSACTION_FINANCIAL_EVENT_TYPES} from '@modules/banking/bank-transaction-financial-event';
import {BankTransaction} from '@modules/banking/bank-transaction.entity';
import {CategorizationScheduler} from '@modules/banking/categorization/categorization-scheduler.service';
import * as exchangeRecompute from '@modules/banking/currency-exchange/currency-exchange-recompute';
import {MerchantLogoService} from '@modules/banking/merchant-logos/merchant-logo.service';
import {DerivedDataRefreshService} from '@modules/banking/services/derived-data-refresh.service';

import {BankingFixtures} from '../../../scripts/seed-data/banking-fixtures';
import {getApp} from '../../setup/e2e.setup';
import {createBankingOwner} from '../../utils/banking-utils';

const HOLDER = 'Jane Example';
const EUR_IBAN = 'NL91ABNA0417164300';
const SAVINGS_IBAN = 'DE89370400440532013000';
const USD_IBAN = 'GB82WEST12345698765432';

describe('DerivedDataRefreshService', () => {
	let app: INestApplication;
	let fixtures: BankingFixtures;
	let accounts: Repository<Account>;
	let service: DerivedDataRefreshService;
	let enqueueCategorization: jest.SpyInstance;
	let enqueueLogos: jest.SpyInstance;

	beforeAll(() => {
		app = getApp();
		fixtures = new BankingFixtures(app);
		accounts = app.get(getRepositoryToken(Account));
		service = app.get(DerivedDataRefreshService);
	});

	beforeEach(() => {
		enqueueCategorization = jest.spyOn(app.get(CategorizationScheduler), 'enqueueForTransactions');
		enqueueLogos = jest.spyOn(app.get(MerchantLogoService), 'enqueueForOwnerSafely');
	});

	afterEach(() => jest.restoreAllMocks());

	/**
	 * An owner who has not chosen a reporting currency, with a EUR current account, a EUR savings account and a USD
	 * account, all in the holder's name, and no history yet.
	 */
	async function createOwner() {
		const {owner, connection, bankAccount} = await createBankingOwner(app, {baseCurrency: null});
		await fixtures.bankAccounts.update(bankAccount.id, {iban: EUR_IBAN, name: HOLDER, currency: 'EUR'});
		const [savings, usd] = await fixtures.createBankAccounts(connection, [
			{iban: SAVINGS_IBAN, name: HOLDER, currency: 'EUR'},
			{iban: USD_IBAN, name: HOLDER, currency: 'USD'},
		]);
		const current = await fixtures.bankAccounts.findOneByOrFail({id: bankAccount.id});
		return {owner, current, savings, usd};
	}

	/** A transfer from the current account to savings: the debit names the savings IBAN. */
	async function createSavingsTransfer(current: BankAccount, savings: BankAccount, amount: string, day: string) {
		const leg: DeepPartial<BankTransaction> = {bookingDate: day, valueDate: day, description: 'Savings top-up'};
		return [
			await fixtures.createTransaction(current, {
				...leg,
				amount: `-${amount}`,
				creditDebitIndicator: 'DBIT',
				counterpartyIban: SAVINGS_IBAN,
			}),
			await fixtures.createTransaction(savings, {...leg, amount, creditDebitIndicator: 'CRDT'}),
		] as const;
	}

	/** A EUR to USD exchange whose debit names the holder, which alone would read as an own transfer. */
	async function createExchange(current: BankAccount, usd: BankAccount) {
		const leg: DeepPartial<BankTransaction> = {
			bookingDate: '2026-01-10',
			valueDate: '2026-01-10',
			description: 'Exchanged to USD',
		};
		return [
			await fixtures.createTransaction(current, {
				...leg,
				amount: '-10.00',
				currency: 'EUR',
				creditDebitIndicator: 'DBIT',
				counterpartyName: HOLDER,
			}),
			await fixtures.createTransaction(usd, {
				...leg,
				amount: '12.00',
				currency: 'USD',
				creditDebitIndicator: 'CRDT',
			}),
		] as const;
	}

	const labels = async (...transactions: Array<{id: string}>) =>
		(
			await fixtures.transactions.find({
				select: {id: true, financialEventType: true, ownTransferEvidence: true, ownTransferCounterpartId: true},
				where: transactions.map(({id}) => ({id})),
			})
		)
			.sort(
				(a, b) => transactions.findIndex(({id}) => id === a.id) - transactions.findIndex(({id}) => id === b.id),
			)
			.map(({financialEventType, ownTransferEvidence, ownTransferCounterpartId}) => ({
				financialEventType,
				ownTransferEvidence,
				ownTransferCounterpartId,
			}));

	const exchangeLeg = {
		financialEventType: BANK_TRANSACTION_FINANCIAL_EVENT_TYPES.CURRENCY_EXCHANGE,
		ownTransferEvidence: null,
		ownTransferCounterpartId: null,
	};
	const unlabelled = {financialEventType: null, ownTransferEvidence: null, ownTransferCounterpartId: null};
	const ownTransferLeg = (counterpart: {id: string}) => ({
		financialEventType: null,
		ownTransferEvidence: 'IBAN',
		ownTransferCounterpartId: counterpart.id,
	});

	it('after a sync write, settles the reporting currency, labels the written rows and queues them for categorization and logos', async () => {
		const {owner, current, savings, usd} = await createOwner();
		const [exchangeDebit, exchangeCredit] = await createExchange(current, usd);
		const [writtenDebit, writtenCredit] = await createSavingsTransfer(current, savings, '25.00', '2026-01-12');
		// The pending row the sync removed was paired with this one; the pair it forms now is found only through it.
		const [formerCounterpart, formerCounterpartPartner] = await createSavingsTransfer(
			current,
			savings,
			'40.00',
			'2026-01-14',
		);
		// Untouched by the sync, so its own-transfer labels wait for the daily whole-history recompute.
		const [untouchedDebit, untouchedCredit] = await createSavingsTransfer(current, savings, '55.00', '2026-01-16');
		const writtenIds = [exchangeDebit.id, exchangeCredit.id, writtenDebit.id, writtenCredit.id];

		await service.refresh(owner.id, {
			kind: 'sync-write',
			writtenIds,
			formerCounterpartIds: [formerCounterpart.id],
		});

		expect(await labels(exchangeDebit, exchangeCredit)).toEqual([exchangeLeg, exchangeLeg]);
		expect(await labels(writtenDebit, writtenCredit)).toEqual([
			ownTransferLeg(writtenCredit),
			ownTransferLeg(writtenDebit),
		]);
		expect(await labels(formerCounterpart, formerCounterpartPartner)).toEqual([
			ownTransferLeg(formerCounterpartPartner),
			ownTransferLeg(formerCounterpart),
		]);
		expect(await labels(untouchedDebit, untouchedCredit)).toEqual([unlabelled, unlabelled]);
		// The history is settled and holds two currencies, so the owner is asked to choose.
		expect(await accounts.findOneByOrFail({id: owner.id})).toMatchObject({baseCurrencyState: 'SETUP_PENDING'});
		expect(enqueueCategorization).toHaveBeenCalledWith(writtenIds);
		expect(enqueueLogos).toHaveBeenCalledWith(owner.id, writtenIds);
	});

	it('after a sync write whose exchange recompute fails, labels own transfers over the whole history', async () => {
		const {owner, current, savings} = await createOwner();
		const [writtenDebit, writtenCredit] = await createSavingsTransfer(current, savings, '25.00', '2026-01-12');
		const [untouchedDebit, untouchedCredit] = await createSavingsTransfer(current, savings, '55.00', '2026-01-16');
		jest.spyOn(exchangeRecompute, 'recomputeCurrencyExchanges').mockRejectedValueOnce(
			new Error('Synthetic exchange recompute failure'),
		);

		await service.refresh(owner.id, {
			kind: 'sync-write',
			writtenIds: [writtenDebit.id, writtenCredit.id],
			formerCounterpartIds: [],
		});

		// Which rows the failed recompute reclassified is unknown, so no row is out of scope.
		expect(await labels(writtenDebit, writtenCredit, untouchedDebit, untouchedCredit)).toEqual([
			ownTransferLeg(writtenCredit),
			ownTransferLeg(writtenDebit),
			ownTransferLeg(untouchedCredit),
			ownTransferLeg(untouchedDebit),
		]);
		expect(enqueueCategorization).toHaveBeenCalledWith([writtenDebit.id, writtenCredit.id]);
	});

	it('after a file write, settles the reporting currency, labels the whole history and queues the written rows for categorization and the owner for logos', async () => {
		const {owner, current, savings, usd} = await createOwner();
		const [exchangeDebit, exchangeCredit] = await createExchange(current, usd);
		const [writtenDebit, writtenCredit] = await createSavingsTransfer(current, savings, '25.00', '2026-01-12');
		const [untouchedDebit, untouchedCredit] = await createSavingsTransfer(current, savings, '55.00', '2026-01-16');
		const writtenIds = [writtenDebit.id, writtenCredit.id];

		await service.refresh(owner.id, {kind: 'file-write', writtenIds});

		expect(
			await labels(exchangeDebit, exchangeCredit, writtenDebit, writtenCredit, untouchedDebit, untouchedCredit),
		).toEqual([
			exchangeLeg,
			exchangeLeg,
			ownTransferLeg(writtenCredit),
			ownTransferLeg(writtenDebit),
			ownTransferLeg(untouchedCredit),
			ownTransferLeg(untouchedDebit),
		]);
		// The import's history is complete once it commits and holds two currencies, so the owner is asked to choose.
		expect(await accounts.findOneByOrFail({id: owner.id})).toMatchObject({baseCurrencyState: 'SETUP_PENDING'});
		expect(enqueueCategorization).toHaveBeenCalledWith(writtenIds);
		expect(enqueueLogos).toHaveBeenCalledWith(owner.id, undefined);
	});

	it('queues the written rows for logos when queueing them for categorization fails', async () => {
		const {owner, current, savings} = await createOwner();
		const [writtenDebit, writtenCredit] = await createSavingsTransfer(current, savings, '25.00', '2026-01-12');
		const writtenIds = [writtenDebit.id, writtenCredit.id];
		enqueueCategorization.mockRejectedValueOnce(new Error('Synthetic categorization enqueue failure'));

		await expect(
			service.refresh(owner.id, {kind: 'sync-write', writtenIds, formerCounterpartIds: []}),
		).resolves.toBeUndefined();

		expect(enqueueLogos).toHaveBeenCalledWith(owner.id, writtenIds);
	});

	it.each([
		['an authorization', 'authorization'],
		['a removal', 'removal'],
	] as const)(
		'after %s, labels exchanges and own transfers over the whole history and leaves a choice among several currencies for the sync',
		async (_, kind) => {
			const {owner, current, savings, usd} = await createOwner();
			const [exchangeDebit, exchangeCredit] = await createExchange(current, usd);
			const [transferDebit, transferCredit] = await createSavingsTransfer(
				current,
				savings,
				'55.00',
				'2026-01-16',
			);

			await service.refresh(owner.id, {kind});

			// The savings transfer is no exchange leg, so only a whole-history own-transfer recompute labels it.
			expect(await labels(exchangeDebit, exchangeCredit, transferDebit, transferCredit)).toEqual([
				exchangeLeg,
				exchangeLeg,
				ownTransferLeg(transferCredit),
				ownTransferLeg(transferDebit),
			]);
			// No history has been fetched yet, so the owner is not asked to choose among the two currencies.
			expect(await accounts.findOneByOrFail({id: owner.id})).toMatchObject({baseCurrencyState: null});
			expect(enqueueCategorization).not.toHaveBeenCalled();
			expect(enqueueLogos).not.toHaveBeenCalled();
		},
	);

	it('after a failed sync write, labels exchanges and own transfers over the whole history', async () => {
		const {owner, current, savings, usd} = await createOwner();
		const [exchangeDebit, exchangeCredit] = await createExchange(current, usd);
		const [transferDebit, transferCredit] = await createSavingsTransfer(current, savings, '55.00', '2026-01-16');

		await service.refresh(owner.id, {kind: 'failed-sync-write'});

		expect(await labels(exchangeDebit, exchangeCredit, transferDebit, transferCredit)).toEqual([
			exchangeLeg,
			exchangeLeg,
			ownTransferLeg(transferCredit),
			ownTransferLeg(transferDebit),
		]);
	});
});
