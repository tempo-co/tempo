import {type MatchIncomingRow, type MatchOutcome, matchDay} from '@modules/banking/bank-transaction-matcher';
import {type FinalSyncDays, isFinalSyncDay} from '@modules/banking/sync-coverage';

/** A file row's outcome at import: the duplicate ladder's, or not added because bank sync never sent it. */
export type ImportOutcome = MatchOutcome | {kind: 'notInBank'; candidateIds: string[]};

/**
 * The ladder's outcomes with one rule on top: on a day bank sync is final for, a file row the ladder did not match is
 * a payment sync never sent, so it is neither added nor asked about. Matched rows, and every row of another day,
 * keep the ladder's outcome.
 */
export function decideOnFinalDays(
	rows: readonly Pick<MatchIncomingRow, 'bookingDate' | 'valueDate'>[],
	outcomes: readonly MatchOutcome[],
	finalDays: FinalSyncDays | null,
): ImportOutcome[] {
	return outcomes.map((outcome, index) =>
		outcome.kind === 'matched' || !isFinalSyncDay(matchDay(rows[index]), finalDays)
			? outcome
			: {kind: 'notInBank', candidateIds: outcome.kind === 'doubtful' ? outcome.candidateIds : []},
	);
}
