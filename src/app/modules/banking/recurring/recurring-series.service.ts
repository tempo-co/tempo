import {ConflictException, Injectable, NotFoundException} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {
	BANKING_RECURRING_CONTINUATION_CHANGED,
	BANKING_RECURRING_SERIES_NOT_FOUND,
} from '../api/constants/banking-messages.constants';
import type {
	RecurringContinuationDto,
	RecurringSeriesDirection,
	RecurringSeriesDto,
	RecurringSeriesListDto,
	RecurringSeriesListsResponseDto,
	RecurringSeriesSummaryResponseDto,
} from '../api/dtos/recurring-series.dto';
import {BankTransaction} from '../bank-transaction.entity';
import type {BankTransactionCategory} from '../categorization/bank-transaction-category';
import {SQL_INTERNAL} from '../services/bank-transaction-filters';
import {formatCents} from '../summary/bank-transaction-summary';
import {type ContinuationPair, findContinuationPairs} from './recurring-continuation';
import {RecurringContinuationUnlink} from './recurring-continuation-unlink.entity';
import {type RecurringEvidence, inferRecurringIdentities} from './recurring-payee-identity';
import {type DetectedRecurringSeries, UNDATED, atDate, detectRecurringSeries} from './recurring-series-detection';
import {isOrdinaryRetailExpense} from './recurring-series-eligibility';
import {RecurringSeriesHide} from './recurring-series-hide.entity';
import {RecurringSnapshot} from './recurring-snapshot.entity';

const REFUND = 'REFUND' satisfies BankTransactionCategory;
/**
 * Bump whenever a change makes detection or its stored payload differ for the same payments: detection rules in
 * `recurring-series-detection`, `recurring-payee-identity`, `recurring-continuation` or `recurring-series-eligibility`,
 * or the payload shape in `toPayload`. Stored detections from other rules are not reused.
 */
export const RECURRING_DETECTION_RULES_VERSION = '4';
const UPCOMING_COUNT = 3;
/** Every payment field detection reads; the stored detection's version is a hash over all of them. */
const CANDIDATE_COLUMNS: readonly [sql: string, alias: keyof CandidateRow][] = [
	['"transaction"."id"', 'id'],
	['"transaction"."bankAccountId"', 'bankAccountId'],
	['"transaction"."bookingDate"::text', 'date'],
	['"transaction"."merchantKey"', 'merchantKey'],
	['"transaction"."currency"', 'currency'],
	['ROUND(ABS("transaction"."amount") * 100)::text', 'amountCents'],
	['ROUND(ABS("transaction"."amountInBaseCurrency") * 100)::text', 'baseAmountCents'],
	['"transaction"."displayDescription"', 'name'],
	['"transaction"."category"', 'category'],
	['"transaction"."description"', 'description'],
	['"transaction"."counterpartyName"', 'counterpartyName'],
	['"transaction"."transactionType"', 'transactionType'],
];

/** Two successive histories of one obligation: joined automatically, or kept apart because the owner unlinked them. */
type Continuation = {
	linked: boolean;
	older: DetectedRecurringSeries;
	newer: DetectedRecurringSeries;
	/** The owner's unlink answers for this pair. */
	saved: RecurringContinuationUnlink[];
};

/** Cents stored as strings, since JSON has no bigint. */
const CENTS_FIELDS = ['monthlyEquivalent', 'usualMonthlyEquivalent', 'paidMonthlyEquivalent'] as const;
type CentsField = (typeof CENTS_FIELDS)[number];
/** A detected series as stored: amounts as strings, plus whether it is ordinary retail. */
type StoredSeries = Omit<DetectedRecurringSeries, CentsField> & {[field in CentsField]: string | null} & {
	retail: boolean;
};
type SnapshotPayload = {
	series: StoredSeries[];
	/** Pairs refer to `series` by index. */
	pairs: {older: number; newer: number; joined: StoredSeries}[];
};

/** The series and pairs of one owner, detected without a date. */
type Detection = {
	series: DetectedRecurringSeries[];
	pairs: ContinuationPair[];
	/** Keys of series that are ordinary retail, shown only once the owner decided on them. */
	retail: Set<string>;
};

/** What a read needs: the dated series after linking, and the owner's answers resolved onto them. */
type ReadState = {
	detected: DetectedRecurringSeries[];
	hidesBySeries: Map<string, RecurringSeriesHide[]>;
	continuationBySeries: Map<string, Continuation>;
	unlinkIds: Set<string>;
};

type CandidateRow = {
	id: string;
	bankAccountId: string;
	date: string;
	merchantKey: string;
	currency: string;
	amountCents: string;
	baseAmountCents: string | null;
	name: string;
	category: string | null;
	description: string | null;
	counterpartyName: string | null;
	transactionType: string | null;
};

/**
 * Detects recurring payments once per change in an owner's payments and stores the result; each read dates it and
 * applies the owner's hidden series and unlinked histories.
 */
@Injectable()
export class RecurringSeriesService {
	constructor(
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
		@InjectRepository(RecurringSeriesHide)
		private readonly hideRepository: Repository<RecurringSeriesHide>,
		@InjectRepository(RecurringContinuationUnlink)
		private readonly unlinkRepository: Repository<RecurringContinuationUnlink>,
		@InjectRepository(RecurringSnapshot)
		private readonly snapshotRepository: Repository<RecurringSnapshot>,
	) {}

	/** Detections under way, by owner and input version, so reads that overlap share one. */
	private readonly detecting = new Map<string, Promise<Detection>>();

	/** Bills and income from one read. */
	async list(
		{id: accountId, baseCurrency}: Pick<Account, 'id' | 'baseCurrency'>,
		asOf: string,
	): Promise<RecurringSeriesListsResponseDto> {
		const state = await this.readState(accountId, asOf);
		return {expenses: listFor(state, 'EXPENSE', baseCurrency), income: listFor(state, 'INCOME', baseCurrency)};
	}

	/** Both lists' totals and the next payments due, from one read. */
	async summary(
		{id: accountId, baseCurrency}: Pick<Account, 'id' | 'baseCurrency'>,
		asOf: string,
	): Promise<RecurringSeriesSummaryResponseDto> {
		const {expenses, income} = await this.list({id: accountId, baseCurrency}, asOf);
		const upcoming = [...expenses.series, ...income.series]
			.filter(({hidden, status}) => !hidden && status === 'ACTIVE')
			.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate) || a.key.localeCompare(b.key))
			.slice(0, UPCOMING_COUNT)
			.map(({key, name, direction, nextExpectedDate, typicalAmount, amountKind, currency}) => ({
				key,
				name,
				direction,
				nextExpectedDate,
				typicalAmount,
				amountKind,
				currency,
			}));
		return {
			expenseMonthlyTotal: expenses.monthlyTotal,
			incomeMonthlyTotal: income.monthlyTotal,
			upcoming,
			expenseUnconvertedCount: expenses.unconvertedCount,
			incomeUnconvertedCount: income.unconvertedCount,
			baseCurrency,
		};
	}

	/** Hides a series detected right now, or shows it again; an unknown or another owner's key is not found. */
	async updateHidden(accountId: Account['id'], seriesKey: string, hidden: boolean) {
		const {detected} = await this.readState(accountId, today());
		const series = detected.find((entry) => entry.key === seriesKey);
		if (!series) throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		await this.hideRepository.manager.transaction(async (manager) => {
			// One owner's answers change one at a time, so two taps cannot both add a hide.
			await manager.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
			// Replace every hide owned by this current series, including older ones from merged parts.
			const hides = await manager.find(RecurringSeriesHide, {where: {accountId}});
			const superseded = assignHides(detected, hides).get(seriesKey) ?? [];
			if (superseded.length > 0) {
				await manager.delete(
					RecurringSeriesHide,
					superseded.map(({id}) => id),
				);
			}
			if (hidden) {
				await manager.insert(RecurringSeriesHide, {
					accountId,
					seriesKey,
					transactionIds: series.transactionIds,
				});
			}
		});
	}

	/**
	 * Unlinks an automatically joined history (`linked: false`), or joins it again (`linked: true`). The key may be the
	 * joined series or either history of the pair; the request must change the pair's state.
	 */
	async updateContinuation(accountId: Account['id'], seriesKey: string, linked: boolean) {
		const {continuationBySeries, unlinkIds} = await this.readState(accountId, today());
		const continuation = continuationBySeries.get(seriesKey);
		if (!continuation || continuation.linked === linked) {
			throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		}
		await this.unlinkRepository.manager.transaction(async (manager) => {
			// One owner's answers change one at a time, and only from the state this answer was given on.
			await manager.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
			const current = await manager.find(RecurringContinuationUnlink, {select: {id: true}, where: {accountId}});
			if (current.length !== unlinkIds.size || current.some(({id}) => !unlinkIds.has(id))) {
				throw new ConflictException(BANKING_RECURRING_CONTINUATION_CHANGED);
			}
			if (continuation.saved.length > 0) {
				await manager.delete(
					RecurringContinuationUnlink,
					continuation.saved.map(({id}) => id),
				);
			}
			if (!linked) {
				await manager.insert(RecurringContinuationUnlink, {
					accountId,
					olderTransactionIds: continuation.older.transactionIds,
					newerTransactionIds: continuation.newer.transactionIds,
				});
			}
		});
	}

	/** The ids of a series' payments, for the transactions list's drill-through filter. */
	async findTransactionIds(accountId: Account['id'], seriesKey: string): Promise<string[]> {
		return (await this.findDetected(accountId, seriesKey)).transactionIds;
	}

	private async findDetected(accountId: Account['id'], seriesKey: string): Promise<DetectedRecurringSeries> {
		// Keys and payments don't depend on the date; only status, flags, price label and this month's cost do.
		const {detected} = await this.readState(accountId, today());
		const series = detected.find((entry) => entry.key === seriesKey);
		if (!series) throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		return series;
	}

	private async readState(accountId: Account['id'], today: string): Promise<ReadState> {
		const [{series, pairs, retail}, hides, unlinks] = await Promise.all([
			this.detect(accountId),
			this.hideRepository.find({where: {accountId}}),
			this.unlinkRepository.find({where: {accountId}, order: {createdAt: 'ASC', id: 'ASC'}}),
		]);
		const dated = new Map(series.map((entry) => [entry, atDate(entry, today)]));
		const datedPairs = pairs.map(({older, newer, joined}) => ({
			older: dated.get(older)!,
			newer: dated.get(newer)!,
			joined: atDate(joined, today),
		}));
		const {detected, continuations} = linkContinuations([...dated.values()], datedPairs, unlinks);
		const hidesBySeries = assignHides(detected, hides);
		return {
			detected: detected.filter((entry) => hidesBySeries.has(entry.key) || !retail.has(entry.key)),
			hidesBySeries,
			continuationBySeries: continuations,
			unlinkIds: new Set(unlinks.map(({id}) => id)),
		};
	}

	/** The stored detection while the owner's payments are unchanged; otherwise detects again and stores it. */
	private async detect(accountId: Account['id']): Promise<Detection> {
		const [[{version}], stored] = await Promise.all([
			this.candidateRows(accountId)
				.select(
					`md5(string_agg(json_build_array(${CANDIDATE_COLUMNS.map(([sql]) => sql).join(', ')})::text, ',' ORDER BY "transaction"."id"))`,
					'version',
				)
				.getRawMany<{version: string | null}>(),
			this.snapshotRepository.findOneBy({accountId}),
		]);
		const inputVersion = version ?? 'none';
		if (stored?.inputVersion === inputVersion && stored.rulesVersion === RECURRING_DETECTION_RULES_VERSION)
			return fromPayload(stored.payload as SnapshotPayload);

		const running = `${accountId}\u0000${inputVersion}`;
		const shared = this.detecting.get(running);
		if (shared) return shared;
		const detection = this.detectAndStore(accountId, inputVersion).finally(() => this.detecting.delete(running));
		this.detecting.set(running, detection);
		return detection;
	}

	private async detectAndStore(accountId: Account['id'], inputVersion: string): Promise<Detection> {
		const query = this.candidateRows(accountId).select(CANDIDATE_COLUMNS[0][0], CANDIDATE_COLUMNS[0][1]);
		for (const [sql, alias] of CANDIDATE_COLUMNS.slice(1)) query.addSelect(sql, alias);
		const rows = await query.getRawMany<CandidateRow>();
		const evidence: RecurringEvidence[] = rows.map((row) => ({
			id: row.id,
			bankAccountId: row.bankAccountId,
			date: row.date,
			merchantKey: row.merchantKey,
			currency: row.currency,
			amountCents: BigInt(row.amountCents),
			baseAmountCents: row.baseAmountCents === null ? null : BigInt(row.baseAmountCents),
			name: row.name,
			category: row.category,
			description: row.description,
			counterpartyName: row.counterpartyName,
			transactionType: row.transactionType,
		}));
		const candidates = inferRecurringIdentities(evidence);
		const candidatesById = new Map(candidates.map((row) => [row.id, row]));
		const series = detectRecurringSeries(candidates, UNDATED);
		const pairs = findContinuationPairs(series, candidatesById, UNDATED);
		const retail = new Set(
			[...series, ...pairs.map(({joined}) => joined)]
				.filter((entry) => isOrdinaryRetailExpense(entry, candidatesById))
				.map(({key}) => key),
		);
		const detection = {series, pairs, retail};
		await this.snapshotRepository.upsert(
			{accountId, inputVersion, rulesVersion: RECURRING_DETECTION_RULES_VERSION, payload: toPayload(detection)},
			['accountId'],
		);
		return detection;
	}

	/** The owner's payments that can be recurring: settled, booked, not internal, refunded or zero. */
	private candidateRows(accountId: Account['id']) {
		return this.bankTransactionRepository
			.createQueryBuilder('transaction')
			.innerJoin('transaction.bankAccount', 'bankAccount')
			.innerJoin('bankAccount.bankConnection', 'connection')
			.where('connection.accountId = :accountId', {accountId})
			.andWhere('transaction.merchantKey IS NOT NULL')
			.andWhere('transaction.bookingDate IS NOT NULL')
			.andWhere("UPPER(transaction.transactionStatus) IS DISTINCT FROM 'PDNG'")
			.andWhere("transaction.creditDebitIndicator IN ('DBIT', 'CRDT')")
			.andWhere('transaction.category IS DISTINCT FROM :refund', {refund: REFUND})
			.andWhere(`NOT ${SQL_INTERNAL}`)
			.andWhere('transaction.amount <> 0');
	}
}

/** One direction's series, shown before hidden, with the monthly total of shown active series. */
function listFor(
	{
		detected,
		hidesBySeries,
		continuationBySeries,
	}: Pick<ReadState, 'detected' | 'hidesBySeries' | 'continuationBySeries'>,
	direction: RecurringSeriesDirection,
	baseCurrency: string | null,
): RecurringSeriesListDto {
	const series = detected
		.filter((entry) => entry.direction === direction)
		.map((entry) => ({entry, hidden: isHidden(entry, hidesBySeries.get(entry.key) ?? [])}))
		.sort(
			(a, b) =>
				Number(a.hidden) - Number(b.hidden) ||
				Number(a.entry.status === 'ENDED') - Number(b.entry.status === 'ENDED') ||
				compareDescending(a.entry.monthlyEquivalent, b.entry.monthlyEquivalent) ||
				a.entry.name.localeCompare(b.entry.name) ||
				a.entry.key.localeCompare(b.entry.key),
		);

	// Every detected series counts until the owner hides it.
	const counted = series.filter(({entry, hidden}) => !hidden && entry.status === 'ACTIVE');
	const monthlyTotal = counted.reduce((sum, {entry}) => sum + (entry.monthlyEquivalent ?? 0n), 0n);

	return {
		series: series.map(({entry, hidden}) =>
			toResponse(entry, hidden, shownContinuation(entry, continuationBySeries.get(entry.key))),
		),
		monthlyTotal: formatCents(monthlyTotal),
		unconvertedCount: counted.filter(({entry}) => entry.monthlyEquivalent === null).length,
		baseCurrency,
	};
}

/**
 * A hidden series stays hidden for the payments it was hidden on. When payments restart after the series had stopped,
 * it counts again.
 */
function isHidden(entry: DetectedRecurringSeries, hides: readonly RecurringSeriesHide[]): boolean {
	if (hides.length === 0) return false;
	// Only a restart after the last payment the owner hid brings the series back. Ids are in date order.
	const hiddenIds = new Set(hides.flatMap(({transactionIds}) => transactionIds));
	const lastDecided = entry.transactionIds.findLastIndex((id) => hiddenIds.has(id));
	const later = new Set(entry.transactionIds.slice(lastDecided + 1));
	return !entry.restartTransactionIds.some((id) => later.has(id));
}

/**
 * Joins every history that continues an earlier one unless the owner unlinked the pair. Each pair is reachable from
 * the joined series and from both of its histories, so an unlink can be undone from either side. Hidden series are
 * resolved on the joined result, so hiding a joined series hides all of it.
 */
function linkContinuations(
	series: DetectedRecurringSeries[],
	pairs: readonly ContinuationPair[],
	unlinks: readonly RecurringContinuationUnlink[],
): {detected: DetectedRecurringSeries[]; continuations: Map<string, Continuation>} {
	let detected = series;
	const continuations = new Map<string, Continuation>();
	for (const {older, newer, joined} of pairs) {
		const saved = unlinks.filter((unlink) => answers(unlink, older, newer));
		const linked = saved.length === 0;
		if (linked) detected = [...detected.filter((entry) => entry !== older && entry !== newer), joined];
		// The joined key stays reachable after an unlink, so an undo can use the key the owner acted on.
		for (const {key} of [older, newer, joined]) continuations.set(key, {linked, older, newer, saved});
	}
	return {detected, continuations};
}

/** Whether a saved unlink was given for this pair: each side still holds a payment it was unlinked on. */
function answers(
	unlink: RecurringContinuationUnlink,
	older: DetectedRecurringSeries,
	newer: DetectedRecurringSeries,
): boolean {
	return (
		older.transactionIds.some((id) => unlink.olderTransactionIds.includes(id)) &&
		newer.transactionIds.some((id) => unlink.newerTransactionIds.includes(id))
	);
}

function toResponse(
	entry: DetectedRecurringSeries,
	hidden: boolean,
	continuation: RecurringContinuationDto | null,
): RecurringSeriesDto {
	return {
		key: entry.key,
		name: entry.name,
		direction: entry.direction,
		cadence: entry.cadence,
		amountKind: entry.amountKind,
		currency: entry.currency,
		typicalAmount: entry.typicalAmount,
		latestAmount: entry.latestAmount,
		monthlyEquivalent: entry.monthlyEquivalent === null ? null : formatCents(entry.monthlyEquivalent),
		amountRange: entry.amountRange,
		recentPayments: entry.recentPayments,
		transactionCount: entry.transactionIds.length,
		firstDate: entry.firstDate,
		lastDate: entry.lastDate,
		nextExpectedDate: entry.nextExpectedDate,
		status: entry.status,
		flags: entry.flags,
		priceChange: entry.priceChange,
		hidden,
		continuation,
	};
}

/**
 * A joined series shows the earlier history it includes. After an unlink the newer history shows it too, so the owner
 * can link them again; the older one shows nothing.
 */
function shownContinuation(
	entry: DetectedRecurringSeries,
	continuation: Continuation | undefined,
): RecurringContinuationDto | null {
	if (!continuation) return null;
	const {linked, older, newer} = continuation;
	if (linked ? entry === older || entry === newer : entry !== newer) return null;
	return {previousName: older.name, previousFirstDate: older.firstDate, previousLastDate: older.lastDate, linked};
}

/**
 * Assigns each saved hide to one current series: its own key, otherwise the most shared payments (ties by series key).
 * Updates replace the whole group without changing hides assigned to siblings.
 */
function assignHides(
	detected: readonly DetectedRecurringSeries[],
	hides: readonly RecurringSeriesHide[],
): Map<string, RecurringSeriesHide[]> {
	const result = new Map<string, RecurringSeriesHide[]>();
	for (const hide of hides) {
		let best = detected.find(({key}) => key === hide.seriesKey);
		if (!best) {
			const decided = new Set(hide.transactionIds);
			let bestShared = 0;
			for (const series of detected) {
				const shared = series.transactionIds.filter((id) => decided.has(id)).length;
				if (shared > bestShared || (shared === bestShared && shared > 0 && best && series.key < best.key)) {
					best = series;
					bestShared = shared;
				}
			}
		}
		if (!best) continue;
		const assigned = result.get(best.key) ?? [];
		assigned.push(hide);
		result.set(best.key, assigned);
	}
	return result;
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function compareDescending(a: bigint | null, b: bigint | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a > b ? -1 : 1;
}

function toPayload({series, pairs, retail}: Detection): SnapshotPayload {
	const stored = (entry: DetectedRecurringSeries): StoredSeries => ({
		...entry,
		...mapCents(entry, (cents) => (cents === null ? null : String(cents))),
		retail: retail.has(entry.key),
	});
	const index = new Map(series.map((entry, position) => [entry, position]));
	return {
		series: series.map(stored),
		pairs: pairs.map(({older, newer, joined}) => ({
			older: index.get(older)!,
			newer: index.get(newer)!,
			joined: stored(joined),
		})),
	};
}

function fromPayload(payload: SnapshotPayload): Detection {
	const retail = new Set<string>();
	const restored = ({retail: isRetail, ...entry}: StoredSeries): DetectedRecurringSeries => {
		if (isRetail) retail.add(entry.key);
		return {...entry, ...mapCents(entry, (cents) => (cents === null ? null : BigInt(cents)))};
	};
	const series = payload.series.map(restored);
	const pairs = payload.pairs.map(({older, newer, joined}) => ({
		older: series[older],
		newer: series[newer],
		joined: restored(joined),
	}));
	return {series, pairs, retail};
}

function mapCents<From, To>(entry: {[field in CentsField]: From}, map: (cents: From) => To) {
	return Object.fromEntries(CENTS_FIELDS.map((field) => [field, map(entry[field])])) as {[field in CentsField]: To};
}
