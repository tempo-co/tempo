import {BANK_LIST} from '@tempo/contracts';

import {
	CORPUS_ENV,
	FileResult,
	MAPPER_ENV,
	OwnerProvenBank,
	checkFile,
	corpusDir,
	loadCorpus,
	rerunMapper,
} from './import-corpus';

const dir = corpusDir();

if (!dir) {
	describe('the real-file import corpus', () => {
		it(`is skipped: ${CORPUS_ENV} is not set`, () => {
			process.stdout.write(`Real-file corpus check skipped: set ${CORPUS_ENV} to the corpus folder.\n`);
		});
	});
} else {
	const {entries, ownerProven, truth} = loadCorpus(dir);
	const results = new Map<string, FileResult>();
	const resultOf = (id: string) => {
		const entry = entries.find((candidate) => candidate.id === id)!;
		if (!results.has(id)) results.set(id, checkFile(dir, entry, truth(id)));
		return results.get(id)!;
	};
	const verified = BANK_LIST.filter(({status}) => status === 'verified');
	const proven = new Set(ownerProven.map(({bank}) => bank));

	describe('the real-file import corpus', () => {
		it.each(entries.map(({id}) => id))(
			'%s reads every field as its truth, re-imports adding nothing, holds its balance and refuses damaged copies',
			(id) => {
				expect(resultOf(id).problems).toEqual([]);
			},
		);

		it.each(verified.filter(({id}) => !proven.has(id)).map(({id}) => id))(
			'verified bank %s has a passing file read by one of its readers',
			(bank) => {
				const {layouts, formats} = verified.find(({id}) => id === bank)!;
				const readers: readonly string[] = [...layouts, ...formats];
				const passing = entries.filter(
					({id, bank: fileBank}) =>
						fileBank === bank &&
						resultOf(id).passed &&
						resultOf(id).readers.some((reader) => readers.includes(reader)),
				);
				expect(passing.map(({id}) => id)).not.toEqual([]);
			},
		);

		if (process.env[MAPPER_ENV] === 'subscription') {
			const model = process.env.FILE_IMPORT_MAPPER_MODEL ?? 'claude-sonnet-5-5';
			it.each(entries.filter(({file}) => file.endsWith('.csv')).map(({id}) => id))(
				'the column mapper maps %s as its truth',
				(id) => {
					const entry = entries.find((candidate) => candidate.id === id)!;
					expect(rerunMapper(dir, entry, truth(id), model)).toEqual([]);
				},
				180_000,
			);
		}

		afterAll(() =>
			process.stdout.write(
				summary(
					entries.map(({id}) => resultOf(id)),
					verified.map(({id}) => id),
					ownerProven,
				),
			),
		);
	});
}

/** Counts only, plus each failing file's id and problems: never a row's content. */
function summary(results: FileResult[], verifiedBanks: string[], ownerProven: OwnerProvenBank[]): string {
	const failed = results.filter(({passed}) => !passed);
	const damage = results.flatMap((result) => result.damage);
	const required = damage.filter((copy) => copy.required);
	const balances = results.map((result) => result.balances);
	const banksWithFile = new Set(results.filter(({passed}) => passed).map(({entry}) => entry.bank));
	const provenBanks = ownerProven.map(({bank}) => bank);
	const lacking = verifiedBanks.filter((bank) => !banksWithFile.has(bank) && !provenBanks.includes(bank));
	const unlisted = [...new Set(results.map(({entry}) => entry.bank))].filter((bank) => !verifiedBanks.includes(bank));
	const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
	return [
		'',
		'Real-file corpus',
		`  files: ${results.length} (${results.length - failed.length} pass, ${failed.length} fail)`,
		`  rows read: ${sum(results.map(({rows}) => rows))}`,
		`  re-import added: ${sum(results.map(({reimportAdded}) => reimportAdded ?? 0))} row(s)`,
		`  stated balances held: ${sum(balances.map(({checked, wrong}) => checked - wrong.length))} of ${sum(balances.map(({checked}) => checked))}`,
		`  damaged copies refused: ${required.filter(({refused}) => refused).length} of ${required.length} detectable; ${damage.filter(({required: needed, refused}) => !needed && refused).length} of ${damage.length - required.length} others`,
		`  verified banks with a passing file: ${verifiedBanks.length - lacking.length} of ${verifiedBanks.length}${lacking.length ? `; none for ${lacking.join(', ')}` : ''}`,
		...ownerProven
			.filter(({bank}) => verifiedBanks.includes(bank) && !banksWithFile.has(bank))
			.map(({bank, note}) => `  ${bank}: proven on the owner's own export, no corpus file (${note})`),
		...(unlisted.length
			? [`  files of banks the list does not verify (checked, not required): ${unlisted.join(', ')}`]
			: []),
		...failed.map(({entry, problems}) => `  FAIL ${entry.id}: ${problems.join('; ')}`),
		'',
	].join('\n');
}
