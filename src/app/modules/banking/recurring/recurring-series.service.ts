import {ConflictException, Injectable, NotFoundException, OnApplicationBootstrap} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Repository} from 'typeorm';

import {Account} from '@modules/account/account.entity';

import {
	BANKING_RECURRING_CONTINUATION_CHANGED,
	BANKING_RECURRING_SERIES_NOT_FOUND,
} from '../api/constants/banking-messages.constants';
import type {
	RecurringContinuationDto,
	RecurringSeriesDto,
	RecurringSeriesListResponseDto,
	RecurringSeriesQueryDto,
	RecurringSeriesSummaryResponseDto,
} from '../api/dtos/recurring-series.dto';
import {BankTransaction} from '../bank-transaction.entity';
import type {BankTransactionCategory} from '../categorization/bank-transaction-category';
import {SQL_INTERNAL} from '../services/bank-transaction-filters';
import {formatCents} from '../summary/bank-transaction-summary';
import {type ContinuationPair, findContinuationPairs} from './recurring-continuation';
import {RecurringContinuationChoice} from './recurring-continuation-choice.entity';
import {type RecurringEvidence, inferRecurringIdentities} from './recurring-payee-identity';
import {RecurringSeriesDecision} from './recurring-series-decision.entity';
import {type DetectedRecurringSeries, UNDATED, atDate, detectRecurringSeries} from './recurring-series-detection';
import {isOrdinaryRetailExpense} from './recurring-series-eligibility';
import {RecurringSnapshot} from './recurring-snapshot.entity';

const REFUND = 'REFUND' satisfies BankTransactionCategory;
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
	saved: RecurringContinuationChoice[];
};

/** A detected series as stored: amounts as strings, plus whether it is ordinary retail. */
type StoredSeries = Omit<DetectedRecurringSeries, 'monthlyEquivalent'> & {
	monthlyEquivalent: string | null;
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
	retail: Set<DetectedRecurringSeries>;
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
export class RecurringSeriesService implements OnApplicationBootstrap {
	constructor(
		@InjectRepository(BankTransaction)
		private readonly bankTransactionRepository: Repository<BankTransaction>,
		@InjectRepository(RecurringSeriesDecision)
		private readonly decisionRepository: Repository<RecurringSeriesDecision>,
		@InjectRepository(RecurringContinuationChoice)
		private readonly continuationRepository: Repository<RecurringContinuationChoice>,
		@InjectRepository(RecurringSnapshot)
		private readonly snapshotRepository: Repository<RecurringSnapshot>,
	) {}

	/** Stored results come from the detection rules of the running version only. */
	async onApplicationBootstrap() {
		await this.snapshotRepository.clear();
	}

	async list(account: Pick<Account, 'id' | 'baseCurrency'>, {direction, asOf}: RecurringSeriesQueryDto) {
		return listFor(await this.readState(account.id, asOf), direction, account.baseCurrency);
	}

	/** Both lists' totals and the next payments due, from one read. */
	async summary(
		{id: accountId, baseCurrency}: Pick<Account, 'id' | 'baseCurrency'>,
		asOf: string,
	): Promise<RecurringSeriesSummaryResponseDto> {
		const state = await this.readState(accountId, asOf);
		const [expenses, income] = (['EXPENSE', 'INCOME'] as const).map((direction) =>
			listFor(state, direction, baseCurrency),
		);
		const upcoming = [...expenses.series, ...income.series]
			.filter(({hidden, status}) => !hidden && status === 'ACTIVE')
			.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate) || a.key.localeCompare(b.key))
			.slice(0, UPCOMING_COUNT)
			.map(({key, name, direction, nextExpectedDate, typicalAmount, currency}) => ({
				key,
				name,
				direction,
				nextExpectedDate,
				typicalAmount,
				currency,
			}));
		return {
			expenseMonthlyTotal: expenses.monthlyTotal,
			incomeMonthlyTotal: income.monthlyTotal,
			upcoming,
			unconvertedCount: expenses.unconvertedCount + income.unconvertedCount,
			baseCurrency,
		};
	}

	/** Hides a series detected right now, or shows it again; an unknown or another owner's key is not found. */
	async updateHidden(accountId: Account['id'], seriesKey: string, hidden: boolean) {
		const {detected, decisionBySeries} = await this.readState(accountId, today());
		const series = detected.find((entry) => entry.key === seriesKey);
		if (!series) throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		// Replace every decision owned by this current series, including older ones from merged parts.
		const superseded = decisionBySeries.get(seriesKey) ?? [];
		await this.decisionRepository.manager.transaction(async (manager) => {
			if (superseded.length > 0) {
				await manager.delete(
					RecurringSeriesDecision,
					superseded.map(({id}) => id),
				);
			}
			if (hidden) {
				await manager.insert(RecurringSeriesDecision, {
					accountId,
					seriesKey,
					decision: 'DISMISSED',
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
		const {continuationBySeries, choiceIds} = await this.readState(accountId, today());
		const continuation = continuationBySeries.get(seriesKey);
		if (!continuation || continuation.linked === linked) {
			throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		}
		await this.continuationRepository.manager.transaction(async (manager) => {
			// One owner's answers change one at a time, and only from the state this answer was given on.
			await manager.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
			const current = await manager.find(RecurringContinuationChoice, {select: {id: true}, where: {accountId}});
			if (current.length !== choiceIds.size || current.some(({id}) => !choiceIds.has(id))) {
				throw new ConflictException(BANKING_RECURRING_CONTINUATION_CHANGED);
			}
			if (continuation.saved.length > 0) {
				await manager.delete(
					RecurringContinuationChoice,
					continuation.saved.map(({id}) => id),
				);
			}
			if (!linked) {
				await manager.insert(RecurringContinuationChoice, {
					accountId,
					choice: 'SEPARATE',
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
		// Keys and payments don't depend on the date; only status and flags do.
		const today = new Date().toISOString().slice(0, 10);
		const {detected} = await this.readState(accountId, today);
		const series = detected.find((entry) => entry.key === seriesKey);
		if (!series) throw new NotFoundException(BANKING_RECURRING_SERIES_NOT_FOUND);
		return series;
	}

	private async readState(
		accountId: Account['id'],
		today: string,
	): Promise<{
		detected: DetectedRecurringSeries[];
		decisionBySeries: Map<string, RecurringSeriesDecision[]>;
		continuationBySeries: Map<string, Continuation>;
		choiceIds: Set<string>;
	}> {
		const [{series, pairs, retail}, decisions, choices] = await Promise.all([
			this.detect(accountId),
			this.decisionRepository.find({where: {accountId}}),
			this.continuationRepository.find({where: {accountId}, order: {createdAt: 'ASC', id: 'ASC'}}),
		]);
		const dated = new Map(series.map((entry) => [entry, atDate(entry, today)]));
		const isRetail = new Set([...retail].map((entry) => dated.get(entry) ?? entry));
		const datedPairs = pairs.map(({older, newer, joined}) => {
			const datedJoined = atDate(joined, today);
			if (retail.has(joined)) isRetail.add(datedJoined);
			return {older: dated.get(older)!, newer: dated.get(newer)!, joined: datedJoined};
		});
		const {detected, continuations} = linkContinuations([...dated.values()], datedPairs, choices);
		const decisionBySeries = resolveDecisions(detected, decisions);
		return {
			detected: detected.filter((entry) => decisionBySeries.has(entry.key) || !isRetail.has(entry)),
			decisionBySeries,
			continuationBySeries: continuations,
			choiceIds: new Set(choices.map(({id}) => id)),
		};
	}

	/** The stored detection while the owner's payments are unchanged; otherwise detects again and stores it. */
	private async detect(accountId: Account['id']): Promise<Detection> {
		const [{version}] = await this.candidateRows(accountId)
			.select(
				`md5(string_agg(concat_ws('|', ${CANDIDATE_COLUMNS.map(([sql]) => sql).join(', ')}), ',' ORDER BY "transaction"."id"))`,
				'version',
			)
			.getRawMany<{version: string | null}>();
		const inputVersion = version ?? 'none';
		const stored = await this.snapshotRepository.findOneBy({accountId});
		if (stored?.inputVersion === inputVersion) return fromPayload(stored.payload as SnapshotPayload);

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
			[...series, ...pairs.map(({joined}) => joined)].filter((entry) =>
				isOrdinaryRetailExpense(entry, candidatesById),
			),
		);
		const detection = {series, pairs, retail};
		await this.snapshotRepository.upsert({accountId, inputVersion, payload: toPayload(detection)}, ['accountId']);
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

type ReadState = Awaited<ReturnType<RecurringSeriesService['readState']>>;

/** One direction's series, shown before hidden, with the monthly total of shown active series. */
function listFor(
	{
		detected,
		decisionBySeries,
		continuationBySeries,
	}: Pick<ReadState, 'detected' | 'decisionBySeries' | 'continuationBySeries'>,
	direction: RecurringSeriesQueryDto['direction'],
	baseCurrency: string | null,
): RecurringSeriesListResponseDto {
	const series = detected
		.filter((entry) => entry.direction === direction)
		.map((entry) => ({entry, hidden: isHidden(entry, decisionBySeries.get(entry.key) ?? [])}))
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
 * it counts again. Older confirmations no longer matter; conflicting saved decisions leave the series shown.
 */
function isHidden(entry: DetectedRecurringSeries, decisions: readonly RecurringSeriesDecision[]): boolean {
	if (decisions.length === 0 || decisions.some(({decision}) => decision !== 'DISMISSED')) return false;
	// Only a restart after the last payment the owner hid brings the series back. Ids are in date order.
	const decided = new Set(decisions.flatMap(({transactionIds}) => transactionIds));
	const lastDecided = entry.transactionIds.findLastIndex((id) => decided.has(id));
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
	choices: readonly RecurringContinuationChoice[],
): {detected: DetectedRecurringSeries[]; continuations: Map<string, Continuation>} {
	let detected = series;
	const continuations = new Map<string, Continuation>();
	const separate = choices.filter(({choice}) => choice === 'SEPARATE');
	for (const {older, newer, joined} of pairs) {
		const saved = separate.filter((choice) => answers(choice, older, newer));
		const linked = saved.length === 0;
		if (linked) detected = [...detected.filter((entry) => entry !== older && entry !== newer), joined];
		for (const {key} of linked ? [older, newer, joined] : [older, newer]) {
			continuations.set(key, {linked, older, newer, saved});
		}
	}
	return {detected, continuations};
}

/** Whether a saved answer was given for this pair: each side still holds a payment it was answered on. */
function answers(
	choice: RecurringContinuationChoice,
	older: DetectedRecurringSeries,
	newer: DetectedRecurringSeries,
): boolean {
	return (
		older.transactionIds.some((id) => choice.olderTransactionIds.includes(id)) &&
		newer.transactionIds.some((id) => choice.newerTransactionIds.includes(id))
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

/** A joined series shows the earlier history it includes. */
function shownContinuation(
	entry: DetectedRecurringSeries,
	continuation: Continuation | undefined,
): RecurringContinuationDto | null {
	if (!continuation?.linked || entry === continuation.older || entry === continuation.newer) return null;
	const {older} = continuation;
	return {previousName: older.name, previousFirstDate: older.firstDate, previousLastDate: older.lastDate};
}

/**
 * Assigns each matching saved decision to one current series: its own key, otherwise the most shared
 * payments (ties by series key). Updates replace the whole group without changing snapshots or decisions
 * assigned to siblings.
 */
function resolveDecisions(
	detected: readonly DetectedRecurringSeries[],
	decisions: readonly RecurringSeriesDecision[],
): Map<string, RecurringSeriesDecision[]> {
	const result = new Map<string, RecurringSeriesDecision[]>();
	for (const decision of decisions) {
		let best = detected.find(({key}) => key === decision.seriesKey);
		if (!best) {
			const decided = new Set(decision.transactionIds);
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
		assigned.push(decision);
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
		monthlyEquivalent: entry.monthlyEquivalent === null ? null : String(entry.monthlyEquivalent),
		retail: retail.has(entry),
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
	const retail = new Set<DetectedRecurringSeries>();
	const restored = ({retail: isRetail, monthlyEquivalent, ...entry}: StoredSeries): DetectedRecurringSeries => {
		const series = {...entry, monthlyEquivalent: monthlyEquivalent === null ? null : BigInt(monthlyEquivalent)};
		if (isRetail) retail.add(series);
		return series;
	};
	const series = payload.series.map(restored);
	const pairs = payload.pairs.map(({older, newer, joined}) => ({
		older: series[older],
		newer: series[newer],
		joined: restored(joined),
	}));
	return {series, pairs, retail};
}
