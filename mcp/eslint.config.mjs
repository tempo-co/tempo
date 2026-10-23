import tseslint from 'typescript-eslint';
export default tseslint.config(
	{ignores: ['dist/**', 'node_modules/**', 'src/*.generated.ts']},
	...tseslint.configs.recommended,
	{rules: {'@typescript-eslint/no-explicit-any': 'error'}},
);
