const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettierConfig = require('eslint-config-prettier/flat');

const bankingImportMessage = 'Banking never imports from file import; file import maps its rows to banking types.';
const FILE_IMPORT_TABLES = '\\bbank_import';
const RECURRING_TABLES = '\\brecurring_(series_hides|snapshots|continuation_unlinks)\\b';

/** Refuses string and template literals that name another module's tables. */
function namesTables(pattern, owner) {
	const message = `Only ${owner} names its tables; call the module that owns them.`;
	return [
		{selector: `Literal[value=/${pattern}/]`, message},
		{selector: `TemplateElement[value.raw=/${pattern}/]`, message},
	];
}

module.exports = [
	{
		ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
	},
	...tseslint.configs['flat/recommended-type-checked'],
	{
		files: ['src/**/*.ts', 'test/**/*.ts'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: __dirname,
				sourceType: 'module',
			},
		},
		rules: {
			'@typescript-eslint/explicit-function-return-type': 'off',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', ignoreRestSiblings: true}],
			'no-console': 'off',
		},
	},
	{
		// Tests stay at the non-type-checked level: supertest bodies, jest mocks and their casts are untyped,
		// so these rules flag almost every assertion and mock without finding real bugs.
		files: ['test/**/*.ts', 'src/**/*.spec.ts'],
		rules: {
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/unbound-method': 'off',
			'@typescript-eslint/require-await': 'off',
			'@typescript-eslint/no-unnecessary-type-assertion': 'off',
			'@typescript-eslint/no-base-to-string': 'off',
			'@typescript-eslint/restrict-template-expressions': 'off',
			'@typescript-eslint/no-duplicate-type-constituents': 'off',
		},
	},
	{
		// File import depends on banking, never the reverse: banking reaches import records, doubtful rows and
		// recurring hides through the modules that own them (`ImportedRowRecords`, `recurring/`).
		files: ['src/app/modules/banking/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{patterns: [{group: ['@modules/file-import/*', '**/file-import/*'], message: bankingImportMessage}]},
			],
			'no-restricted-syntax': ['error', ...namesTables(FILE_IMPORT_TABLES, 'file import')],
		},
	},
	{
		files: ['src/app/modules/banking/**/*.ts'],
		ignores: ['src/app/modules/banking/recurring/**'],
		rules: {
			'no-restricted-syntax': [
				'error',
				...namesTables(FILE_IMPORT_TABLES, 'file import'),
				...namesTables(RECURRING_TABLES, 'recurring'),
			],
		},
	},
	prettierConfig,
];
