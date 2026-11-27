import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
	MATCH_WINDOW_DAYS,
	MatchExistingRow,
	MatchOutcome,
	REFERENCE_FALLBACK_MIN_PROBED_ROWS_BETWEEN_FILES,
	matchDay,
	matchTransactions,
	matchWithReferenceFallback,
} from '@modules/banking/bank-transaction-matcher';
import {findFileAnchor} from '@modules/banking/file-account-balance';
import {buildLayout} from '@modules/file-import/bank-import-layout.service';
import {groupByAccount, statementNumbering, toMatchRow} from '@modules/file-import/bank-import.service';
import {
	LAYOUT_ANSWER_JSON_SCHEMA,
	LAYOUT_MAPPER_INSTRUCTIONS,
	layoutAnswerSchema,
	toMapperInput,
} from '@modules/file-import/mapper/layout-mapper.contract';
import {validateCsvLayout} from '@modules/file-import/parsers/csv-layout';
import {readCsvLayout} from '@modules/file-import/parsers/csv-layout-reader';
import {parseDecimal} from '@modules/file-import/parsers/decimal';
import {parseFile} from '@modules/file-import/parsers/parse-file';
import {
	NormalizedRow,
	NormalizedStatement,
	ParseRefusal,
	StatementBalance,
} from '@modules/file-import/parsers/parse-result';
import {sampleTable} from '@modules/file-import/parsers/table-sample';

/** The folder of the real-file corpus (see `docs/real-file-corpus.md`); the check is skipped without it. */
export const CORPUS_ENV = 'WISP_IMPORT_CORPUS';
/** `subscription`: also rerun the column mapper on each CSV file through the local `claude` CLI. Off by default. */
export const MAPPER_ENV = 'WISP_IMPORT_CORPUS_MAPPER';

export type CorpusEntry = {
	id: string;
	/** Relative to the corpus folder. */
	file: string;
	/** A bank id of `BANK_LIST`, or the id a later layout will give a bank not listed yet. */
	bank: string;
};

type TruthRow = {
	date: string;
	valueDate?: string | null;
	amount: string;
	currency: string;
	iban: string | null;
	cp: string | null;
	desc: string[];
	descOptional: string[];
	balance: string | null;
};

export type Truth = {
	id: string;
	kind: 'csv' | 'camt' | 'mt940' | 'ofx';
	expect: 'read' | {refused: string};
	rows: TruthRow[];
	/**
	 * The account's balance after the import, by `<account>|<currency>`, where the file states one. The account is
	 * `None` for a file that names none: its one account in that currency.
	 */
	closing: Record<string, string>;
	/** The file's balances let an altered amount or a missing row be detected. */
	detectable: boolean;
	/** Byte offsets: a digit of one row's amount, and one middle row's lines. */
	damage: {amountDigit: number; row: [number, number]} | null;
};

export type DamageKind = 'altered amount' | 'removed middle row' | 'cut mid-row';

export type FileResult = {
	entry: CorpusEntry;
	/** What read the file: built-in layout ids and standard formats; empty when it was refused. */
	readers: string[];
	rows: number;
	/** Field problems against the truth; empty when every field matches. */
	problems: string[];
	/** Rows the second import of the same file added (or left doubtful). */
	reimportAdded: number | null;
	/** Accounts whose balance after the import was compared with the file's, and the ones that differ. */
	balances: {checked: number; wrong: string[]};
	/** Per damaged copy: refused, or read; `required` where the file's balances allow detecting it. */
	damage: {kind: DamageKind; refused: boolean; required: boolean}[];
	passed: boolean;
};

/** A verified bank proven only on the owner's own export, which never enters the corpus. */
export type OwnerProvenBank = {bank: string; note: string};

export function loadCorpus(dir: string): {
	entries: CorpusEntry[];
	ownerProven: OwnerProvenBank[];
	truth: (id: string) => Truth;
} {
	const manifest = JSON.parse(readFileSync(join(dir, 'corpus.json'), 'utf8')) as {
		files: CorpusEntry[];
		ownerProven?: OwnerProvenBank[];
	};
	return {
		entries: manifest.files,
		ownerProven: manifest.ownerProven ?? [],
		truth: (id) => JSON.parse(readFileSync(join(dir, 'truth', `${id}.json`), 'utf8')) as Truth,
	};
}

export function checkFile(dir: string, entry: CorpusEntry, truth: Truth): FileResult {
	const bytes = readFileSync(join(dir, entry.file));
	const result: FileResult = {
		entry,
		readers: [],
		rows: 0,
		problems: [],
		reimportAdded: null,
		balances: {checked: 0, wrong: []},
		damage: [],
		passed: false,
	};
	const outcome = parse(bytes);
	if ('refused' in outcome) {
		const expected = typeof truth.expect === 'object' ? truth.expect.refused : null;
		if (expected !== outcome.refused) {
			const near = outcome.layout ? ` (its rows did not read as ${outcome.layout})` : '';
			result.problems.push(
				`refused ${outcome.refused}${near}, expected ${expected ? `refusal ${expected}` : 'a read'}`,
			);
		}
		result.passed = result.problems.length === 0;
		return result;
	}
	if (typeof truth.expect === 'object') result.problems.push(`read, expected refusal ${truth.expect.refused}`);
	const {statements, layouts, formats} = outcome.result;
	result.readers = [...layouts, ...formats.filter((format) => format !== 'csv')];
	const rows = flatten(statements);
	result.rows = rows.length;
	result.problems.push(...compareRows(rows, truth));

	const store = new AccountStore();
	store.importDrop(statements);
	result.balances = compareBalances(store.balances(), truth.closing);
	result.reimportAdded = store.importDrop(statements);
	if (result.reimportAdded > 0) result.problems.push(`re-import added ${result.reimportAdded} row(s)`);
	result.problems.push(...result.balances.wrong);

	if (truth.damage) {
		const {amountDigit, row} = truth.damage;
		const required = truth.detectable && truth.rows.length >= 3;
		const altered = Buffer.from(bytes);
		altered[amountDigit] = altered[amountDigit] === 0x39 ? 0x30 : altered[amountDigit] + 1;
		const copies: [DamageKind, Buffer][] = [
			['altered amount', altered],
			['removed middle row', Buffer.concat([bytes.subarray(0, row[0]), bytes.subarray(row[1])])],
			['cut mid-row', bytes.subarray(0, row[0] + Math.floor((row[1] - row[0]) / 2))],
		];
		for (const [kind, copy] of copies) {
			const refused = 'refused' in parse(copy);
			result.damage.push({kind, refused, required});
			if (required && !refused) result.problems.push(`${kind}: read, not refused`);
		}
	}
	result.passed = result.problems.length === 0;
	return result;
}

/** The column mapper's layout for a CSV file, asked through the local `claude` CLI, read alone and compared. */
export function rerunMapper(dir: string, entry: CorpusEntry, truth: Truth, model: string): string[] {
	const bytes = readFileSync(join(dir, entry.file));
	const sample = sampleTable(bytes);
	if (!sample) return ['no table found'];
	const run = spawnSync(
		'claude',
		[
			'-p',
			'--model',
			model,
			'--effort',
			'low',
			'--tools',
			'',
			'--setting-sources',
			'',
			'--system-prompt',
			LAYOUT_MAPPER_INSTRUCTIONS,
			'--json-schema',
			JSON.stringify(LAYOUT_ANSWER_JSON_SCHEMA),
			'--output-format',
			'json',
			JSON.stringify(toMapperInput(sample)),
		],
		// Without an API key the CLI runs on the signed-in subscription, never on the paid API; outside the repo it
		// reads no project instructions.
		{encoding: 'utf8', env: withoutApiKey(), cwd: tmpdir(), timeout: 120_000},
	);
	if (run.status !== 0) return [`claude exited ${run.status}`];
	const answer = layoutAnswerSchema.safeParse(
		(JSON.parse(run.stdout) as {structured_output?: unknown}).structured_output,
	);
	if (!answer.success) return ['no valid answer'];
	const built = buildLayout(answer.data, sample, truth.rows[0]?.currency ?? 'EUR');
	const valid = built && validateCsvLayout(built.layout);
	if (!valid || !valid.ok) return ['layout not mappable'];
	try {
		const read = readCsvLayout(bytes, [valid.layout], {owned: true});
		return read ? compareRows(flatten(read.statements), truth) : ['the layout does not read the file'];
	} catch (error) {
		return [`refused ${error instanceof ParseRefusal ? error.code : String(error)}`];
	}
}

function withoutApiKey(): NodeJS.ProcessEnv {
	const env = {...process.env};
	delete env.ANTHROPIC_API_KEY;
	return env;
}

type FlatRow = NormalizedRow & {account: string | null};

function parse(bytes: Buffer): {result: ReturnType<typeof parseFile>} | {refused: string; layout: string | null} {
	try {
		return {result: parseFile(bytes)};
	} catch (error) {
		if (error instanceof ParseRefusal) return {refused: error.code, layout: error.layout};
		throw error;
	}
}

function flatten(statements: readonly NormalizedStatement[]): FlatRow[] {
	return statements.flatMap((statement) =>
		statement.rows.map((row) => ({...row, account: statement.accountIban ?? statement.accountOtherId})),
	);
}

const norm = (text: string | null | undefined) => (text ?? '').toLowerCase().replace(/[^0-9a-z]/g, '');
/** Exact units of 10^-8, so amounts compare and sum without rounding. */
const units = (value: string) => {
	const parsed = parseDecimal(value.trim(), '.');
	if (!parsed) throw new Error('not a plain decimal');
	return parsed.units;
};
const decimal = (value: string) => units(value).toString();
const sameAccount = (left: string, right: string) => norm(left) === norm(right);

/**
 * Field by field. Each truth row is paired with a read row of the same account, day and amount, one that matches
 * every field when there is one, so the order rows are read in never matters. A balance the file states only per
 * statement (CAMT, MT940, OFX) is checked through the account's balance, not per row.
 */
function compareRows(rows: FlatRow[], truth: Truth): string[] {
	if (rows.length !== truth.rows.length) return [`${rows.length} rows read, ${truth.rows.length} in the file`];
	const day = (row: FlatRow) => row.bookingDate ?? row.valueDate;
	const rowProblems = (row: FlatRow, t: TruthRow): string[] => {
		const found: string[] = [];
		if (t.valueDate && row.valueDate !== t.valueDate) found.push('value date');
		if (row.currency !== t.currency) found.push('currency');
		if (!t.iban && row.account) found.push('account not in the file');
		if (truth.kind === 'csv') {
			if ((row.balanceAfter === null) !== (t.balance === null)) {
				found.push(t.balance === null ? 'balance not in the file' : 'balance missing');
			} else if (row.balanceAfter !== null && decimal(row.balanceAfter) !== decimal(t.balance!))
				found.push('balance');
		}
		if (t.cp && !norm(row.counterpartyName)) found.push('counterparty missing');
		else if (t.cp && norm(row.counterpartyName) !== norm(t.cp)) found.push('counterparty');
		else if (!t.cp && norm(row.counterpartyName)) found.push('counterparty not in the file');
		const text = norm([row.description, row.remittanceInformation].join(' '));
		if (t.desc.some((part) => !text.includes(norm(part)))) found.push('description missing text');
		return found;
	};
	const unpaired = new Set(rows);
	const problems = new Map<string, number>();
	const note = (field: string) => problems.set(field, (problems.get(field) ?? 0) + 1);
	for (const t of truth.rows) {
		const alike = [...unpaired].filter(
			(row) =>
				day(row) === t.date &&
				decimal(row.amount) === decimal(t.amount) &&
				(t.iban ? !!row.account && sameAccount(row.account, t.iban) : true),
		);
		const paired = alike.find((row) => rowProblems(row, t).length === 0) ?? alike[0];
		if (!paired) {
			note('no row with its account, date and amount');
			continue;
		}
		unpaired.delete(paired);
		rowProblems(paired, t).forEach(note);
	}
	return [...problems].map(([field, count]) => `${field}: ${count} row(s)`);
}

function compareBalances(balances: Map<string, string | null>, closing: Record<string, string>) {
	const wrong: string[] = [];
	let checked = 0;
	for (const [key, expected] of Object.entries(closing)) {
		const [account, currency] = splitKey(key);
		const found = [...balances].find(([accountKey]) => {
			const [id, ccy] = splitKey(accountKey);
			return ccy === currency && (account === TRUTH_NO_ACCOUNT || sameAccount(id, account));
		});
		checked += 1;
		if (!found) wrong.push(`balance: no account for a stated closing balance`);
		else if (found[1] === null || found[1] !== decimal(expected)) wrong.push('balance: differs from the file');
	}
	return {checked, wrong};
}

/** The account of a truth's closing balance for a file that names no account. */
const TRUTH_NO_ACCOUNT = 'None';

function splitKey(key: string): [string, string] {
	const at = key.lastIndexOf('|');
	return [key.slice(0, at), key.slice(at + 1)];
}

type StoredRow = MatchExistingRow & {bookingDate: string | null; numbering: string; importId: string};

/**
 * Imported-files accounts as an import writes them (`BankImportService.importFiles`): a drop's statements grouped
 * and joined per account and format, each format's rows run through the duplicate ladder against the rows stored so
 * far, the new ones stored; the balance is the newer of the rows' anchor and the newest stated closing balance, plus
 * the rows booked after it (`FileAccountBalanceService`).
 */
class AccountStore {
	private readonly accounts = new Map<string, {rows: StoredRow[]; closings: StatementBalance[]}>();
	private imports = 0;

	/** Returns how many rows the drop added or left doubtful. */
	importDrop(statements: readonly NormalizedStatement[]): number {
		const importId = String(++this.imports);
		const evidence = new Map(statements.map((statement) => [statement, 1]));
		let added = 0;
		for (const account of groupByAccount(statements, new Map(), evidence)) {
			const key = JSON.stringify([account.identifier, account.currency]);
			const stored = this.accounts.get(key) ?? {rows: [], closings: []};
			this.accounts.set(key, stored);
			const fileIbanConfirmed = !!account.iban;
			for (const {format, layout, rows, newestFirst} of account.byFormat) {
				const numbering = statementNumbering(format, layout);
				const candidates = this.candidates(stored.rows, rows, fileIbanConfirmed ? numbering : null);
				const incoming = rows.map(toMatchRow);
				const outcomes: MatchOutcome[] = fileIbanConfirmed
					? matchWithReferenceFallback(incoming, candidates, {
							pairLookAlikeGroups: true,
							minProbedRows: REFERENCE_FALLBACK_MIN_PROBED_ROWS_BETWEEN_FILES,
						}).outcomes
					: matchTransactions(incoming, candidates);
				const fresh = new Set(rows.filter((_, i) => outcomes[i].kind === 'new'));
				added += outcomes.filter(({kind}) => kind !== 'matched').length;
				for (const row of newestFirst.filter((candidate) => fresh.has(candidate))) {
					stored.rows.push({
						...toMatchRow(row),
						id: String(stored.rows.length + 1),
						createdAt: new Date(stored.rows.length),
						bookingDate: row.bookingDate ?? row.valueDate ?? row.transactionDate,
						numbering,
						importId,
					});
				}
			}
			if (account.closingBalance) stored.closings.push(account.closingBalance);
		}
		return added;
	}

	/** Each account's balance by `<identifier>|<currency>`; null where nothing anchors it. */
	balances(): Map<string, string | null> {
		const out = new Map<string, string | null>();
		for (const [key, {rows, closings}] of this.accounts) {
			const [identifier, currency] = JSON.parse(key) as [string, string];
			const rowAnchor = findFileAnchor(
				rows.flatMap(({bookingDate, amount, balanceAfter}) =>
					bookingDate && balanceAfter !== null ? [{bookingDate, amount, balanceAfter}] : [],
				),
			);
			const closing = [...closings].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
			const anchor = closing && !(rowAnchor && rowAnchor.date >= closing.date) ? closing : rowAnchor;
			const balance = anchor
				? rows
						.filter(({bookingDate}) => bookingDate !== null && bookingDate > anchor.date)
						.reduce((total, {amount}) => total + units(amount), units(anchor.amount))
						.toString()
				: null;
			out.set(`${identifier}|${currency}`, balance);
		}
		return out;
	}

	/** The stored rows within the ladder's window of the incoming days (`findMatchCandidates`). */
	private candidates(
		stored: StoredRow[],
		rows: readonly NormalizedRow[],
		numbering: string | null,
	): MatchExistingRow[] {
		const days = rows.flatMap((row) => matchDay(row) ?? []).sort();
		if (days.length === 0) return [];
		const from = shiftDay(days[0], -MATCH_WINDOW_DAYS);
		const to = shiftDay(days.at(-1)!, MATCH_WINDOW_DAYS);
		return stored
			.filter(({bookingDate}) => bookingDate !== null && bookingDate >= from && bookingDate <= to)
			.map(({numbering: rowNumbering, importId, ...row}) => ({
				...row,
				source: importId,
				sameNumbering: numbering === null || rowNumbering === numbering,
			}));
	}
}

function shiftDay(day: string, days: number): string {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

export function corpusDir(): string | null {
	const dir = process.env[CORPUS_ENV];
	if (!dir) return null;
	if (!existsSync(join(dir, 'corpus.json')))
		throw new Error(`${CORPUS_ENV} names no corpus folder with a corpus.json`);
	return dir;
}
