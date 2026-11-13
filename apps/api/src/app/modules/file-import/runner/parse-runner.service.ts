import {Injectable} from '@nestjs/common';

import {CsvLayout} from '../parsers/csv-layout';
import {
	ParseOutcome,
	PreviewOutcome,
	SampleOutcome,
	parseChildArgs,
	previewInChild,
	runParseChild,
	sampleInChild,
} from './parse-runner';

const MAX_CONCURRENT_PARSES = 2;

/** Runs parse children, at most two at a time per API process; further parses wait for a free slot. */
@Injectable()
export class ParseRunnerService {
	private readonly args = parseChildArgs();
	private active = 0;
	private readonly waiting: (() => void)[] = [];

	/** The file's statements; `owned` are the owner's saved layouts, newest first, tried after the built-in ones. */
	parse(bytes: Buffer, owned: readonly CsvLayout[] = []): Promise<ParseOutcome> {
		return this.inSlot(() => runParseChild(bytes, {args: this.args}, owned));
	}

	/** The file's table and its masked sample for the column mapper. */
	sample(bytes: Buffer): Promise<SampleOutcome> {
		return this.inSlot(() => sampleInChild(bytes, {args: this.args}));
	}

	/** The file read with one proposed layout alone. */
	preview(bytes: Buffer, layout: CsvLayout): Promise<PreviewOutcome> {
		return this.inSlot(() => previewInChild(bytes, layout, {args: this.args}));
	}

	private async inSlot<T>(run: () => Promise<T>): Promise<T> {
		// A finishing parse hands its slot straight to the next waiter, so no newcomer can take it in between.
		if (this.active >= MAX_CONCURRENT_PARSES) await new Promise<void>((resolve) => this.waiting.push(resolve));
		else this.active++;
		try {
			return await run();
		} finally {
			const next = this.waiting.shift();
			if (next) next();
			else this.active--;
		}
	}
}
