import {readFile, writeFile} from 'node:fs/promises';
import ts from 'typescript';

// Both modules have type-only imports at most. Transpiling them reads their values without building the contracts
// package or loading the Nest app.
async function load(path) {
	const source = await readFile(new URL(path, import.meta.url), 'utf8');
	const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ES2022}}).outputText;
	return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const contracts = await load('../../../../packages/contracts/src/categories.ts');
const api = await load('../../src/app/modules/banking/categorization/bank-transaction-category.ts');
await writeFile(
	new URL('../src/categories.generated.ts', import.meta.url),
	`// Generated from @tempo/contracts and the API category definitions. Do not edit.\nexport const CATEGORY_VALUES = ${JSON.stringify(contracts.BANK_TRANSACTION_CATEGORY_FILTER_VALUES)} as const;\nexport const CATEGORY_DEFINITIONS = ${JSON.stringify(api.BANK_TRANSACTION_CATEGORY_DEFINITIONS)} as const;\n`,
);
