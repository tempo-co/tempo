import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {format, resolveConfig} from 'prettier';

import {toInputContract} from '../src/app/modules/banking/categorization/bank-transaction-categorization-input.schema';

/**
 * Writes the request schemas into the categorization contract's `input`, generated from the API's zod input schema
 * (`docs/categorization.md`).
 *
 *   npm run contract:input
 */
async function writeContractInput(): Promise<void> {
	const path = join(
		__dirname,
		'../src/app/modules/banking/categorization/providers/claude-categorization-contract.json',
	);
	const contract = JSON.parse(readFileSync(path, 'utf8'));
	contract.input = toInputContract().input;
	const {useTabs, tabWidth, printWidth, bracketSpacing, endOfLine} = (await resolveConfig(path)) ?? {};
	const formatted = await format(JSON.stringify(contract, null, '\t'), {
		parser: 'json',
		useTabs,
		tabWidth,
		printWidth,
		bracketSpacing,
		endOfLine,
	});
	writeFileSync(path, formatted);
}

void writeContractInput();
