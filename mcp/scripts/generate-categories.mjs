import {readFile, writeFile} from 'node:fs/promises';
import ts from 'typescript';

// This leaf module has type-only imports. Transpilation removes them without loading the Nest app.
const source = await readFile(
	new URL('../../src/app/modules/banking/categorization/bank-transaction-category.ts', import.meta.url),
	'utf8',
);
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ES2022}}).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
await writeFile(
	new URL('../src/categories.generated.ts', import.meta.url),
	`// Generated from the API category leaf module. Do not edit.\nexport const CATEGORY_VALUES = ${JSON.stringify(api.BANK_TRANSACTION_CATEGORY_FILTER_VALUES)} as const;\nexport const CATEGORY_DEFINITIONS = ${JSON.stringify(api.BANK_TRANSACTION_CATEGORY_DEFINITIONS)} as const;\n`,
);
