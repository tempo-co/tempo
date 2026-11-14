import type {CsvLayout} from '../parsers/csv-layout';
import type {NormalizedStatement, ParseRefusalCode, ParseRunnerOutput} from '../parsers/parse-result';
import type {TableSample} from '../parsers/table-sample';

/** The request line before the file's bytes: the owner's saved layouts fit easily. */
export const MAX_REQUEST_BYTES = 1024 * 1024;

/** The first line the parent writes to the parse child's stdin; the file's bytes follow it. */
export type ParseChildRequest =
	/** The owner's saved layouts, newest first. */
	{mode: 'parse'; layouts: CsvLayout[]} | {mode: 'sample'} | {mode: 'preview'; layout: CsvLayout};

export type SampleChildOutput = {ok: true; sample: TableSample} | {ok: false; code: ParseRefusalCode};

export type PreviewChildOutput =
	| {ok: true; statements: NormalizedStatement[]; dateCheck: {written: string; date: string} | null}
	| {ok: false; code: ParseRefusalCode | 'layout_not_mappable'};

/** What the parse child writes to stdout, by request mode. */
export type ParseChildOutput = ParseRunnerOutput | SampleChildOutput | PreviewChildOutput;
