import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {format, resolveConfig} from 'prettier';

import {toBridgeInputContract} from '../src/app/modules/banking/categorization/bank-transaction-categorization-input.schema';

/**
 * Writes the request schemas the subscription bridge validates into `claude-bridge/contract.json`, generated from the
 * API's zod input schema. A change here changes the contract fingerprint: deploy the API first, then reinstall the
 * bridge (`docs/categorization.md`).
 *
 *   npm run contract:input
 */
async function writeContractInput(): Promise<void> {
	const path = join(__dirname, '../claude-bridge/contract.json');
	const contract = JSON.parse(readFileSync(path, 'utf8'));
	contract.input = toBridgeInputContract().input;
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
