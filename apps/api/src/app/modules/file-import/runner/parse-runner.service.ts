import {Injectable} from '@nestjs/common';

import {ParseOutcome, parseChildArgs, runParseChild} from './parse-runner';

const MAX_CONCURRENT_PARSES = 2;

/** Runs parse children, at most two at a time per API process; further parses wait for a free slot. */
@Injectable()
export class ParseRunnerService {
	private readonly args = parseChildArgs();
	private active = 0;
	private readonly waiting: (() => void)[] = [];

	async parse(bytes: Buffer): Promise<ParseOutcome> {
		// A finishing parse hands its slot straight to the next waiter, so no newcomer can take it in between.
		if (this.active >= MAX_CONCURRENT_PARSES) await new Promise<void>((resolve) => this.waiting.push(resolve));
		else this.active++;
		try {
			return await runParseChild(bytes, {args: this.args});
		} finally {
			const next = this.waiting.shift();
			if (next) next();
			else this.active--;
		}
	}
}
